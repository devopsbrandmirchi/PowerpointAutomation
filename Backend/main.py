from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Any, Optional
import json
import os
import queue
import threading
import asyncio
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from fastapi.responses import StreamingResponse

# PPT Generator
from auction_insights import generate_auction_xlsx, upload_excel_to_drive
from pptx_fill import run_ppt_job
from sync_ads_to_db_GA4 import sync_ga4_data
from combined import _normalize_customer_id, _normalize_ga4_property_id


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

CLIENT_CONFIG_TABLE = os.environ.get("SUPABASE_CLIENT_TABLE", "google_ads_accounts")

AUCTION_INSIGHTS_DRIVE_FOLDER_ID = os.environ.get(
    "AUCTION_INSIGHTS_DRIVE_FOLDER_ID",
    "1pR1oWgzhA51YZm1c9MnZt3LULHLp_gAJ",
)
AUCTION_INSIGHTS_DRIVE_FOLDER_URL = f"https://drive.google.com/drive/folders/{AUCTION_INSIGHTS_DRIVE_FOLDER_ID}"


def _parse_cors_origins(raw: Optional[str]) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [p.strip().rstrip("/") for p in str(raw).split(",") if p.strip()]


def _build_cors_kwargs() -> dict:
    """
    CORS for local dev + Vercel (and other frontends).

    - Browsers reject allow_origins=['*'] together with allow_credentials=True.
      We never combine those two.

    Set in .env:
      CORS_ORIGINS=https://your-app.vercel.app,https://www.yourdomain.com
      FRONTEND_URL=https://your-app.vercel.app   (optional single origin, merged in)

    Vercel preview URLs (branch deploys) change each time; allow them with:
      CORS_ORIGIN_REGEX=https://.*\\.vercel\\.app

    Open API to any origin (no cookies / credentialed browser calls):
      CORS_ALLOW_ALL=true
    """
    allow_all = os.environ.get("CORS_ALLOW_ALL", "").lower() in ("1", "true", "yes")
    if allow_all:
        return {
            "allow_origins": ["*"],
            "allow_origin_regex": None,
            "allow_credentials": False,
            "allow_methods": ["*"],
            "allow_headers": ["*"],
        }

    origins: set[str] = set()
    for o in (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ):
        origins.add(o)
    origins.update(_parse_cors_origins(os.environ.get("CORS_ORIGINS")))
    origins.update(_parse_cors_origins(os.environ.get("FRONTEND_URL")))

    regex = (os.environ.get("CORS_ORIGIN_REGEX") or "").strip() or None

    origin_list = sorted(origins)
    if not origin_list and not regex:
        # Safe default for local scripts / quick tests (no credentials).
        return {
            "allow_origins": ["*"],
            "allow_origin_regex": None,
            "allow_credentials": False,
            "allow_methods": ["*"],
            "allow_headers": ["*"],
        }

    return {
        "allow_origins": origin_list,
        "allow_origin_regex": regex,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }


app = FastAPI(title="Wheeler Automation API")

app.add_middleware(CORSMiddleware, **_build_cors_kwargs())

executor = ThreadPoolExecutor(max_workers=5)
_sb = None

def get_supabase():
    global _sb
    if _sb is False:
        return None
    if _sb is not None:
        return _sb
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        _sb = False
        return None
    from supabase import create_client
    _sb = create_client(url, key)
    return _sb


# ==========================================
# --- 1. PYDANTIC MODELS ---
# ==========================================

class GenerateRequest(BaseModel):
    client_id: str
    start_date: str
    end_date: str
    generate_ppt: bool = True
    prev_start_date: Optional[str] = None
    prev_end_date: Optional[str] = None

class AuctionInsightsRequest(BaseModel):
    customer_id: str
    month_label: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class AutomationLogCreate(BaseModel):
    status: str
    job_type: str = "report_generation"
    client_key: Optional[str] = None
    client_name: Optional[str] = None
    message: str
    duration_ms: Optional[int] = None
    triggered_by: str = "user"

class GeneratedReportCreate(BaseModel):
    folder_date: str
    report_range_start: str
    report_range_end: str
    client_key: str
    client_name: Optional[str] = None
    export_mode: str
    files: list[dict[str, Any]] = Field(default_factory=list)

class GeneratedReportFilesPatch(BaseModel):
    files: list[dict[str, Any]] = Field(default_factory=list)


class Ga4SyncStreamRequest(BaseModel):
    """Optional client_id = sync only that dealer; omit or null = all rows (CLI-style)."""

    client_id: Optional[str] = None


# ==========================================
# --- 3. HELPER FUNCTIONS & WORKERS ---
# ==========================================

def _automation_log_to_api(row: dict) -> dict:
    return {
        "id": str(row.get("id", "")),
        "occurredAt": row.get("occurred_at"),
        "status": row.get("status"),
        "jobType": row.get("job_type"),
        "clientKey": row.get("client_key"),
        "clientName": row.get("client_name"),
        "message": row.get("message"),
        "durationMs": row.get("duration_ms"),
        "triggeredBy": row.get("triggered_by"),
    }

def _generated_report_to_api(row: dict) -> dict:
    files = row.get("files") or []
    if isinstance(files, str):
        try: files = json.loads(files)
        except: files = []
    fd = row.get("folder_date")
    rs = row.get("report_range_start")
    re = row.get("report_range_end")
    ca = row.get("created_at")
    return {
        "id": str(row.get("id", "")),
        "folderDate": fd.isoformat()[:10] if hasattr(fd, "isoformat") else str(fd)[:10],
        "reportRangeStart": rs.isoformat()[:10] if hasattr(rs, "isoformat") else str(rs)[:10],
        "reportRangeEnd": re.isoformat()[:10] if hasattr(re, "isoformat") else str(re)[:10],
        "createdAt": ca if isinstance(ca, str) else (ca.isoformat() if hasattr(ca, "isoformat") else str(ca)),
        "clientKey": row.get("client_key"),
        "clientName": row.get("client_name"),
        "exportMode": row.get("export_mode"),
        "files": files if isinstance(files, list) else [],
    }


def _normalize_report_files(files: list[dict[str, Any]], export_mode: Optional[str] = None) -> list[dict[str, Any]]:
    """
    Ensure stored files keep a usable URL.
    For Auction exports, fallback to the known Drive folder URL when driveUrl is missing.
    """
    normalized: list[dict[str, Any]] = []
    mode = str(export_mode or "").strip().lower()
    for f in files or []:
        if not isinstance(f, dict):
            continue
        item = dict(f)
        drive_url = item.get("driveUrl") or item.get("drive_url")
        kind = str(item.get("kind") or "").strip().lower()
        label = str(item.get("label") or "").strip().lower()

        is_auction_file = kind == "xlsx" or "auction" in label or mode == "auction"
        if not drive_url and is_auction_file:
            drive_url = AUCTION_INSIGHTS_DRIVE_FOLDER_URL

        item["driveUrl"] = drive_url
        # Keep snake_case mirror for compatibility with mixed consumers.
        item["drive_url"] = drive_url
        normalized.append(item)
    return normalized

def load_client_config(client_id: str):
    sb = get_supabase()
    if not sb:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    res = sb.table(CLIENT_CONFIG_TABLE).select("*").eq("client_id", client_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")
    client_data = res.data[0]
    
    raw_customer_id = client_data.get("customer_id")
    normalized_customer_id = _normalize_customer_id(raw_customer_id) or (
        str(raw_customer_id).strip() if raw_customer_id is not None else ""
    )
    if not normalized_customer_id:
        raise HTTPException(
            status_code=400,
            detail=f"Client '{client_id}' has no valid customer_id in {CLIENT_CONFIG_TABLE}.",
        )

    return {
        "client_id": client_id,
        "client_name": client_data.get("descriptive_name", client_id),
        "customer_id": normalized_customer_id,
        "template_drive_id": client_data.get("template_drive_id"),
        "output_file_drive_id": client_data.get("output_file_drive_id"),
        "ga4_property_id": _normalize_ga4_property_id(client_data.get("ga4_property_id")) or None,
    }

def make_month_label(end_date: str) -> str:
    d = datetime.strptime(end_date, "%Y-%m-%d")
    return d.strftime("%B_%Y")

def _generate_worker_sync(request: GenerateRequest, cfg: dict, month_label: str, out_q: queue.Queue):
    result: dict = {}
    def forward(ev: dict):
        out_q.put({"event": "progress", "payload": ev})

    try:
        if request.generate_ppt:
            try:
                ppt = run_ppt_job(
                    cfg,
                    request.start_date,
                    request.end_date,
                    month_label,
                    progress_cb=forward,
                    prev_start_date=request.prev_start_date,
                    prev_end_date=request.prev_end_date,
                )
                result["ppt"] = ppt
            except Exception as e:
                result["ppt_error"] = str(e)
                forward({"kind": "log", "message": f"ERROR (PowerPoint): {e}"})

        out_q.put({"event": "result", "data": result})
    except Exception as e:
        out_q.put({"event": "error", "detail": str(e)})
    finally:
        out_q.put(None)


def _ga4_sync_worker(out_q: queue.Queue, client_id: Optional[str] = None):
    """Runs GA4 → Supabase `ga4_metrics` (sync_ads_to_db_GA4); streams log lines like generate-stream."""

    def forward(msg: str):
        out_q.put({"event": "progress", "payload": {"kind": "log", "message": msg}})

    try:
        summary = sync_ga4_data(log_callback=forward, client_id=client_id)
        out_q.put({"event": "result", "data": summary})
    except Exception as e:
        out_q.put({"event": "error", "detail": str(e)})
    finally:
        out_q.put(None)


def _auction_insights_worker(body: "AuctionInsightsRequest", out_q: queue.Queue):
    """Generates Auction Insights Excel + uploads to Drive while streaming log lines."""

    def forward(msg: str):
        out_q.put({"event": "progress", "payload": {"kind": "log", "message": msg}})

    result: dict = {}
    try:
        customer_id = str(body.customer_id or "").strip()
        month_label = str(body.month_label or "").strip()
        if not customer_id:
            raise ValueError("customer_id is required.")
        if not month_label:
            raise ValueError("month_label is required.")

        forward(f"Started Auction Report for customer {customer_id} ({month_label}).")

        sb = get_supabase()
        dealer_name = customer_id
        if sb:
            try:
                cfg_res = (
                    sb.table(CLIENT_CONFIG_TABLE)
                    .select("descriptive_name")
                    .eq("customer_id", customer_id)
                    .limit(1)
                    .execute()
                )
                cfg_row = (cfg_res.data or [{}])[0]
                dealer_name = cfg_row.get("descriptive_name") or customer_id
            except Exception as cfe:
                forward(f"WARNING: could not fetch dealer name from Supabase: {cfe}")

        drive_folder_id = AUCTION_INSIGHTS_DRIVE_FOLDER_ID
        forward(f"Drive folder ready (id: {drive_folder_id}).")

        start_date = (str(body.start_date or "").strip() or None)
        end_date = (str(body.end_date or "").strip() or None)
        if start_date and end_date:
            forward(
                f"Fetching Auction data from Supabase for {dealer_name} "
                f"(report_date {start_date} → {end_date})…"
            )
        else:
            forward(f"Fetching Auction data from Supabase for {dealer_name} ({month_label})…")

        local_file = generate_auction_xlsx(
            customer_id,
            month_label,
            dealer_name=dealer_name,
            start_date=start_date,
            end_date=end_date,
        )
        if not local_file:
            forward(
                f"ERROR: No auction rows found in Supabase for {customer_id} / {month_label}."
            )
            result["excel_error"] = (
                f"No Auction data found for {customer_id} in {month_label}."
            )
            out_q.put({"event": "result", "data": result})
            return

        forward(f"Excel generated locally: {local_file}")

        drive_url = None
        forward("Uploading Excel to Google Drive…")
        try:
            drive_url = upload_excel_to_drive(local_file, drive_folder_id)
        except Exception as ue:
            forward(f"ERROR (Drive upload): {ue}")
        if drive_url:
            forward(f"Uploaded successfully. URL: {drive_url}")
        else:
            forward("ERROR: Drive upload did not return a link.")
            result["excel_error"] = (
                "Excel was generated locally but Drive upload failed. "
                "Please check service-account access to the target folder."
            )

        result["excel"] = {
            "filename": os.path.basename(str(local_file)),
            "drive_url": drive_url,
            "folder_url": AUCTION_INSIGHTS_DRIVE_FOLDER_URL,
            "message": (
                "Auction Insights uploaded to Google Drive."
                if drive_url
                else "Auction Insights file was not uploaded to Drive."
            ),
        }
        forward("=== RESULT ===")
        forward(result["excel"]["message"])

        out_q.put({"event": "result", "data": result})
    except Exception as e:
        forward(f"ERROR: {e}")
        out_q.put({"event": "error", "detail": str(e)})
    finally:
        out_q.put(None)


# ==========================================
# --- 4. API ENDPOINTS ---
# ==========================================

@app.get("/")
def root():
    return {"status": "Wheeler Automation API is running"}

@app.get("/clients")
def list_clients():
    sb = get_supabase()
    if not sb: return []
    try:
        res = sb.table(CLIENT_CONFIG_TABLE).select("*").execute()
        out = []
        for row in res.data or []:
            cid = row.get("client_id")
            if not cid: continue
            has_config = bool(row.get("template_drive_id") and row.get("output_file_drive_id"))
            out.append({
                "id": cid,
                "name": row.get("descriptive_name") or cid,
                "customer_id": row.get("customer_id"),
                "has_config": has_config,
            })
        return sorted(out, key=lambda x: str(x["name"]).lower())
    except Exception as e:
        print(f"Error fetching clients: {e}")
        return []

@app.post("/generate")
async def generate(request: GenerateRequest):
    try:
        s = datetime.strptime(request.start_date, "%Y-%m-%d")
        e = datetime.strptime(request.end_date, "%Y-%m-%d")
        if s >= e: raise HTTPException(status_code=400, detail="Start date must be before end date")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    cfg = load_client_config(request.client_id)
    month_label = make_month_label(request.end_date)
    result = {}
    loop = asyncio.get_running_loop()

    if request.generate_ppt:
        try:
            result["ppt"] = await loop.run_in_executor(
                executor,
                lambda: run_ppt_job(
                    cfg,
                    request.start_date,
                    request.end_date,
                    month_label,
                    prev_start_date=request.prev_start_date,
                    prev_end_date=request.prev_end_date,
                ),
            )
        except Exception as e:
            result["ppt_error"] = str(e)

    return result

@app.post("/generate-stream")
async def generate_stream(request: GenerateRequest):
    try:
        s = datetime.strptime(request.start_date, "%Y-%m-%d")
        e = datetime.strptime(request.end_date, "%Y-%m-%d")
        if s >= e: raise HTTPException(status_code=400, detail="Start date must be before end date")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    cfg = load_client_config(request.client_id)
    month_label = make_month_label(request.end_date)
    out_q: queue.Queue = queue.Queue()
    loop = asyncio.get_running_loop()

    threading.Thread(target=_generate_worker_sync, args=(request, cfg, month_label, out_q), daemon=True).start()

    async def event_iter():
        while True:
            item = await loop.run_in_executor(None, out_q.get)
            if item is None: break
            yield f"data: {json.dumps(item, default=str)}\n\n"
            await asyncio.sleep(0)

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(event_iter(), media_type="text/event-stream", headers=headers)


@app.post("/ga4-sync-stream")
async def ga4_sync_stream(body: Ga4SyncStreamRequest):
    """Stream GA4 channel + button metrics into `ga4_metrics` (sync_ads_to_db_GA4). client_id = one dealer; omit = all."""
    out_q: queue.Queue = queue.Queue()
    loop = asyncio.get_running_loop()
    cid = body.client_id.strip() if body.client_id and str(body.client_id).strip() else None
    threading.Thread(target=_ga4_sync_worker, args=(out_q, cid), daemon=True).start()

    async def event_iter():
        while True:
            item = await loop.run_in_executor(None, out_q.get)
            if item is None:
                break
            yield f"data: {json.dumps(item, default=str)}\n\n"
            await asyncio.sleep(0)

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(event_iter(), media_type="text/event-stream", headers=headers)

@app.post("/api/reports/generate-auction-insights")
def generate_auction_insights_report(body: AuctionInsightsRequest):
    """Synchronous fallback. Prefer /api/reports/generate-auction-insights-stream for live logs."""
    out_q: queue.Queue = queue.Queue()
    threading.Thread(target=_auction_insights_worker, args=(body, out_q), daemon=True).start()
    final_result: dict = {}
    error_detail: Optional[str] = None
    while True:
        item = out_q.get()
        if item is None:
            break
        if item.get("event") == "result":
            final_result = item.get("data") or {}
        elif item.get("event") == "error":
            error_detail = item.get("detail") or "Unknown error"

    if error_detail:
        raise HTTPException(status_code=500, detail=error_detail)
    excel = (final_result or {}).get("excel") or {}
    return {
        "status": "success" if excel.get("drive_url") else "partial",
        "filename": excel.get("filename"),
        "drive_url": excel.get("drive_url"),
        "folder_url": excel.get("folder_url"),
        "message": excel.get("message")
        or final_result.get("excel_error")
        or "Auction Insights run finished.",
    }


@app.post("/api/reports/generate-auction-insights-stream")
async def generate_auction_insights_stream(body: AuctionInsightsRequest):
    """Stream live progress (logs + final result) for Auction Insights generation."""
    out_q: queue.Queue = queue.Queue()
    loop = asyncio.get_running_loop()
    threading.Thread(target=_auction_insights_worker, args=(body, out_q), daemon=True).start()

    async def event_iter():
        while True:
            item = await loop.run_in_executor(None, out_q.get)
            if item is None:
                break
            yield f"data: {json.dumps(item, default=str)}\n\n"
            await asyncio.sleep(0)

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(event_iter(), media_type="text/event-stream", headers=headers)


# ==========================================
# --- 5. LOGS & DB REPORTS ---
# ==========================================

@app.get("/automation-logs")
def list_automation_logs():
    sb = get_supabase()
    if not sb: raise HTTPException(status_code=503, detail="Supabase not configured.")
    try:
        res = sb.table("automation_logs").select("*").order("occurred_at", desc=True).limit(500).execute()
        return [_automation_log_to_api(r) for r in (res.data or [])]
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

@app.post("/automation-logs")
def create_automation_log(entry: AutomationLogCreate):
    sb = get_supabase()
    if not sb: raise HTTPException(status_code=503, detail="Supabase not configured.")
    try:
        row = {"status": entry.status, "job_type": entry.job_type, "client_key": entry.client_key, "client_name": entry.client_name, "message": entry.message, "duration_ms": entry.duration_ms, "triggered_by": entry.triggered_by}
        res = sb.table("automation_logs").insert(row).execute()
        if res.data: return _automation_log_to_api(res.data[0])
        return {"ok": True}
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

@app.get("/drive-reports")
def list_drive_reports():
    sb = get_supabase()
    if not sb: raise HTTPException(status_code=503, detail="Supabase not configured.")
    try:
        res = sb.table("generated_reports").select("*").order("created_at", desc=True).limit(500).execute()
        return [_generated_report_to_api(r) for r in (res.data or [])]
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

@app.post("/drive-reports")
def create_drive_report(entry: GeneratedReportCreate):
    sb = get_supabase()
    if not sb: raise HTTPException(status_code=503, detail="Supabase not configured.")
    try:
        row = {
            "folder_date": entry.folder_date[:10],
            "report_range_start": entry.report_range_start[:10],
            "report_range_end": entry.report_range_end[:10],
            "client_key": entry.client_key,
            "client_name": entry.client_name,
            "export_mode": entry.export_mode,
            "files": _normalize_report_files(entry.files, export_mode=entry.export_mode),
        }
        res = sb.table("generated_reports").insert(row).execute()
        if res.data: return _generated_report_to_api(res.data[0])
        return {"ok": True}
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

@app.delete("/drive-reports/{report_id}")
def delete_drive_report(report_id: str):
    sb = get_supabase()
    if not sb: raise HTTPException(status_code=503, detail="Supabase not configured.")
    try:
        sb.table("generated_reports").delete().eq("id", str(report_id).strip()).execute()
        return {"ok": True, "deleted": True}
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

@app.patch("/drive-reports/{report_id}")
def patch_drive_report_files(report_id: str, body: GeneratedReportFilesPatch):
    sb = get_supabase()
    if not sb: raise HTTPException(status_code=503, detail="Supabase not configured.")
    rid = str(report_id).strip()
    try:
        if not body.files:
            sb.table("generated_reports").delete().eq("id", rid).execute()
            return {"ok": True, "deleted": True}
        existing = sb.table("generated_reports").select("export_mode").eq("id", rid).limit(1).execute()
        export_mode = None
        if existing.data:
            export_mode = existing.data[0].get("export_mode")
        safe_files = _normalize_report_files(body.files, export_mode=export_mode)
        res = sb.table("generated_reports").update({"files": safe_files}).eq("id", rid).execute()
        if res.data: return _generated_report_to_api(res.data[0])
        return {"ok": True}
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

if __name__ == "__main__":
    # ==========================================
    # --- TEST MODE (Run Script Directly) ---
    # ==========================================
    # Change this to True when you want to test the script without starting the server
    RUN_TEST_MODE = True  
    
    if RUN_TEST_MODE:
        print("\n=== RUNNING IN TEST MODE ===")
        TEST_CLIENT_ID = "replace-with-client-id"
        START_DATE = "2026-03-01"
        END_DATE = "2026-03-31"
        MONTH_LABEL = "March 2026"
        
        # This runs the PPT job only (Auction Insights flow removed).
        cfg = load_client_config(TEST_CLIENT_ID)
        result = run_ppt_job(cfg, START_DATE, END_DATE, MONTH_LABEL)
        print(result)
        print("=== TEST COMPLETE ===\n")
        
    # ==========================================
    # --- SERVER MODE (Run FastAPI) ---
    # ==========================================
    else:
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)