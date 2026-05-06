"""
GA4 → Supabase sync for channel metrics + button events into `ga4_metrics`.
Used by FastAPI `/ga4-sync-stream` and Dealer configuration “Sync GA4”.
"""
import os
from pathlib import Path
from typing import Any, Callable, Optional

from dotenv import load_dotenv
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
from supabase import Client, create_client
from google_credentials import resolve_google_credentials_path

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

MASTER_TABLE = os.environ.get("SUPABASE_CLIENT_TABLE", "google_ads_accounts")
METRICS_TABLE = "ga4_metrics"


def _resolve_ga4_credentials_file() -> str:
    return resolve_google_credentials_path(BASE_DIR)

# --- EXACT BUTTON LIST (must match events in GA4 UI) ---
BUTTON_EVENT_NAMES = [
    "contact_us_btn",
    "delivery_estimate_btn",
    "get_prequalified_btn",
    "contact_sales_btn",
    "apply_for_financing_btn",
    "unlock_internet_price_btn",
    "value_your_trade_in_btn",
    "Get Lowest Price Btn",
]
NORMALIZED_BUTTONS = [name.lower().strip() for name in BUTTON_EVENT_NAMES]


def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise EnvironmentError("Missing SUPABASE_URL or SUPABASE_KEY in .env")
    return create_client(url, key)


def get_ga4_client() -> BetaAnalyticsDataClient:
    credentials_file = _resolve_ga4_credentials_file()
    return BetaAnalyticsDataClient.from_service_account_file(credentials_file)


def fetch_accounts(sb: Client, client_id: Optional[str] = None) -> list[dict[str, Any]]:
    q = sb.table(MASTER_TABLE).select("client_id, customer_id, descriptive_name, ga4_property_id")
    if client_id and str(client_id).strip():
        q = q.eq("client_id", str(client_id).strip())
    res = q.execute()
    return res.data or []


def _sync_one_property_metrics(
    property_id: str,
    customer_id: str,
    db_client_id: str,
    sb: Client,
    ga4_client: BetaAnalyticsDataClient,
    log_fn: Callable[[str], None],
) -> str:
    """Returns 'ok' | 'no_data' | 'error'."""
    pid = str(property_id).replace("properties/", "").strip()
    log_fn(f"Fetching GA4 data for Property {pid}…")

    request_traffic = RunReportRequest(
        property=f"properties/{pid}",
        dimensions=[
            Dimension(name="date"),
            Dimension(name="sessionDefaultChannelGroup"),
        ],
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="sessions"),
            Metric(name="averageSessionDuration"),
            Metric(name="totalUsers"),
            Metric(name="bounceRate"),
        ],
        date_ranges=[DateRange(start_date="2026-01-01", end_date="today")],
        limit=250000,
    )

    try:
        traffic_response = ga4_client.run_report(request_traffic)
    except Exception as e:
        log_fn(f"  -> Failed to fetch traffic data: {e}")
        return "error"

    master_data: dict[str, dict[str, Any]] = {}

    for row in traffic_response.rows:
        raw_date = row.dimension_values[0].value
        formatted_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
        channel = row.dimension_values[1].value
        row_key = f"{formatted_date}_{channel}"
        master_data[row_key] = {
            "client_id": db_client_id,
            "customer_id": str(customer_id).strip(),
            "date": formatted_date,
            "channel": channel,
            "vdp_views": int(row.metric_values[0].value),
            "sessions": int(row.metric_values[1].value),
            "avg_session_duration": float(row.metric_values[2].value),
            "users": int(row.metric_values[3].value),
            "bounce_rate": float(row.metric_values[4].value),
            "button_interactions": 0,
            "form_fills": 0,
        }

    request_events = RunReportRequest(
        property=f"properties/{pid}",
        dimensions=[
            Dimension(name="date"),
            Dimension(name="sessionDefaultChannelGroup"),
            Dimension(name="eventName"),
        ],
        metrics=[Metric(name="eventCount")],
        date_ranges=[DateRange(start_date="2026-01-01", end_date="today")],
        limit=250000,
    )

    try:
        event_response = ga4_client.run_report(request_events)
    except Exception as e:
        log_fn(f"  -> Failed to fetch event data: {e}")
        return "error"

    for row in event_response.rows:
        raw_date = row.dimension_values[0].value
        formatted_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
        channel = row.dimension_values[1].value
        raw_event_name = row.dimension_values[2].value
        safe_event_name = raw_event_name.lower().strip()
        event_count = int(row.metric_values[0].value)
        row_key = f"{formatted_date}_{channel}"

        if safe_event_name in NORMALIZED_BUTTONS:
            if row_key not in master_data:
                master_data[row_key] = {
                    "client_id": db_client_id,
                    "customer_id": str(customer_id).strip(),
                    "date": formatted_date,
                    "channel": channel,
                    "vdp_views": 0,
                    "sessions": 0,
                    "avg_session_duration": 0.0,
                    "users": 0,
                    "bounce_rate": 0.0,
                    "button_interactions": 0,
                    "form_fills": 0,
                }
            master_data[row_key]["button_interactions"] += event_count

    extracted_data = list(master_data.values())

    if not extracted_data:
        log_fn(f"  -> No data found for GA4 Property {pid}.")
        return "no_data"

    log_fn(f"  -> Found {len(extracted_data)} total rows with merged events. Upserting into Supabase…")

    try:
        sb.table(METRICS_TABLE).upsert(extracted_data, on_conflict="customer_id,date,channel").execute()
        log_fn(f"  -> Success! Data pushed to '{METRICS_TABLE}' for property {pid}.")
        return "ok"
    except Exception as e:
        log_fn(f"  -> Supabase Upsert Error: {e}")
        return "error"


def sync_ga4_data(
    log_callback: Optional[Callable[[str], None]] = None,
    client_id: Optional[str] = None,
) -> dict[str, Any]:
    """
    Pull GA4 channel + button metrics into `ga4_metrics` (sync_ads_to_db_GA4 pipeline).
    Optional client_id = only that dealer row. log_callback receives each log line (also printed).
    """
    def emit(msg: str) -> None:
        print(msg)
        if log_callback:
            log_callback(msg)

    sb = get_supabase()
    ga4_client = get_ga4_client()

    cid = str(client_id).strip() if client_id else None
    accounts = fetch_accounts(sb, client_id=cid)
    scope = f"client_id={cid!r}" if cid else "all accounts"
    emit(f"\n=== GA4 metrics sync ({scope}) — {len(accounts)} row(s) ===\n")

    if cid and len(accounts) == 0:
        raise ValueError(f"No dealer row in '{MASTER_TABLE}' for client_id={cid!r}.")

    success_count = 0
    fail_count = 0
    skipped_no_property = 0
    no_rows = 0

    for account in accounts:
        ga4_prop = account.get("ga4_property_id")
        name = account.get("descriptive_name") or account.get("client_id")
        db_client_id = str(account.get("client_id") or "").strip()
        raw_cust = account.get("customer_id")
        if not raw_cust:
            emit(f"Skipping '{name}': missing customer_id.")
            skipped_no_property += 1
            continue
        customer_id = str(raw_cust).replace("-", "").strip()

        if not ga4_prop or str(ga4_prop).strip() == "":
            emit(f"Skipping '{name}': Missing ga4_property_id.")
            skipped_no_property += 1
            continue

        emit(f"\n--- Processing GA4: {name} ---")
        try:
            outcome = _sync_one_property_metrics(
                str(ga4_prop).strip(),
                customer_id,
                db_client_id,
                sb,
                ga4_client,
                emit,
            )
            if outcome == "ok":
                success_count += 1
            elif outcome == "no_data":
                no_rows += 1
            else:
                fail_count += 1
        except Exception as e:
            emit(f"  -> GA4 API Error: {e}")
            fail_count += 1

    emit("\n=== GA4 METRICS SYNC COMPLETE ===")
    emit(f"  Success : {success_count}")
    emit(f"  Failed  : {fail_count}")
    emit(f"  Skipped (missing ids) : {skipped_no_property}")
    emit(f"  No data (empty GA4) : {no_rows}")
    emit(f"  Total rows in scope : {len(accounts)}\n")

    return {
        "success_count": success_count,
        "fail_count": fail_count,
        "skipped_no_property": skipped_no_property,
        "no_rows": no_rows,
        "accounts_total": len(accounts),
        "client_id": cid,
        "metrics_table": METRICS_TABLE,
    }


if __name__ == "__main__":
    sync_ga4_data()
