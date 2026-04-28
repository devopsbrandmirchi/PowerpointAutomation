import os
from pathlib import Path
from typing import Any, Callable, Optional
from dotenv import load_dotenv
from supabase import create_client
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    RunReportRequest,
)

BASE_DIR         = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

CREDENTIALS_FILE = str(BASE_DIR / "ga4-credentials.json")
# print(f"DEBUG: I am actually using this exact file: {CREDENTIALS_FILE}")

# Force the script to ignore the .env and ONLY use the perfect GA4 file

# print(f"DEBUG: I am now using this file: {CREDENTIALS_FILE}")

MASTER_TABLE     = os.environ.get("SUPABASE_CLIENT_TABLE", "google_ads_accounts")
METRICS_TABLE    = "ga4_raw_metrics"


def get_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise EnvironmentError("Missing SUPABASE_URL or SUPABASE_KEY in .env")
    return create_client(url, key)


def get_ga4_client():
    if not os.path.isfile(CREDENTIALS_FILE):
        raise FileNotFoundError(
            f"Missing credentials file: {CREDENTIALS_FILE}\n"
            "Download your Service Account JSON from Google Cloud Console."
        )
    return BetaAnalyticsDataClient.from_service_account_file(CREDENTIALS_FILE)


def fetch_ga4_accounts(sb, client_id: Optional[str] = None):
    """
    Fetches accounts from the master table.
    If client_id is set, only that row (for per-dealer sync from the UI).
    """
    q = sb.table(MASTER_TABLE).select("id, client_id, ga4_property_id, descriptive_name")
    if client_id and str(client_id).strip():
        q = q.eq("client_id", str(client_id).strip())
    res = q.execute()
    return res.data or []


def build_ga4_request(property_id: str) -> RunReportRequest:
    return RunReportRequest(
        property=property_id,
        dimensions=[
            Dimension(name="date"),
            Dimension(name="pageLocation"),
            Dimension(name="pagePath"),
            Dimension(name="pageTitle"),
            Dimension(name="sessionCampaignName"),
            Dimension(name="sessionDefaultChannelGroup"),
        ],
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="totalUsers"),
            Metric(name="sessions"),
            Metric(name="newUsers"),
        ],
        date_ranges=[DateRange(start_date="30daysAgo", end_date="today")],
    )


def parse_ga4_rows(response, account: dict) -> list:
    client_id         = account.get("client_id")
    raw_property_id   = account.get("ga4_property_id", "")
    account_name      = account.get("descriptive_name", client_id)
    clean_property_id = str(raw_property_id).replace("properties/", "")

    # THE FIX: A dictionary to combine duplicates before hitting Supabase
    aggregated_data = {}

    for row in response.rows:
        dv = row.dimension_values
        mv = row.metric_values

        raw_date       = dv[0].value
        formatted_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
        page_location  = dv[1].value
        page_path      = dv[2].value
        page_title     = dv[3].value
        session_camp   = dv[4].value
        channel        = dv[5].value.lower().replace(" ", "_").replace("/", "_")

        # This key matches your Supabase UNIQUE constraint perfectly
        unique_key = (client_id, clean_property_id, formatted_date, page_path, channel)

        views       = int(mv[0].value)
        total_users = int(mv[1].value)
        sessions    = int(mv[2].value)
        new_users   = int(mv[3].value)

        if unique_key in aggregated_data:
            # If we already have this row, ADD the metrics together
            aggregated_data[unique_key]["views"]       += views
            aggregated_data[unique_key]["total_users"] += total_users
            aggregated_data[unique_key]["sessions"]    += sessions
            aggregated_data[unique_key]["new_users"]   += new_users
        else:
            # If it's a new row, create it
            aggregated_data[unique_key] = {
                "client_id":            client_id,
                "ga4_property_id":      clean_property_id,
                "account_name":         account_name,
                "report_date":          formatted_date,
                "page_location":        page_location,  # Keeps the first URL variant seen
                "page_path":            page_path,
                "page_title":           page_title,     # Keeps the first Title seen
                "session_campaign":     session_camp,   # Keeps the first Campaign seen
                "channel":              channel,
                "views":                views,
                "total_users":          total_users,
                "sessions":             sessions,
                "new_users":            new_users,
            }

    # Convert the clean, deduplicated dictionary back into a list for Supabase
    return list(aggregated_data.values())


def push_to_supabase(sb, rows: list, batch_size: int = 1000, log_fn: Optional[Callable[[str], None]] = None):
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        sb.table(METRICS_TABLE).upsert(
            chunk,
            on_conflict="client_id,ga4_property_id,report_date,page_path,channel",
        ).execute()
    msg = f"  Pushed {len(rows)} rows to '{METRICS_TABLE}'"
    print(msg)
    if log_fn:
        log_fn(msg)


def sync_ga4_data(
    log_callback: Optional[Callable[[str], None]] = None,
    client_id: Optional[str] = None,
) -> dict[str, Any]:
    """
    Pull GA4 into Supabase (ga4_raw_metrics). Optional log_callback receives each log line (also printed).
    If client_id is set, only that dealer row is synced (one-by-one from Dealer configuration).
    Returns summary counts for API/UI.
    """

    def emit(msg: str) -> None:
        print(msg)
        if log_callback:
            log_callback(msg)

    sb = get_supabase()
    ga4_client = get_ga4_client()

    cid = str(client_id).strip() if client_id else None
    accounts = fetch_ga4_accounts(sb, client_id=cid)
    scope = f"client_id={cid!r}" if cid else "all accounts"
    emit(f"\n=== STARTING GA4 SYNC ({scope}) — {len(accounts)} row(s) ===\n")

    if cid and len(accounts) == 0:
        raise ValueError(f"No dealer row in '{MASTER_TABLE}' for client_id={cid!r}.")

    success_count = 0
    fail_count = 0
    skipped_no_property = 0
    no_rows = 0

    for account in accounts:
        client_id = account.get("client_id")
        raw_property_id = account.get("ga4_property_id")
        account_name = account.get("descriptive_name", client_id)

        if not raw_property_id or str(raw_property_id).strip() == "":
            emit(f"Skipping '{account_name}': Missing ga4_property_id.")
            skipped_no_property += 1
            continue

        property_id = str(raw_property_id).strip()
        if not property_id.startswith("properties/"):
            property_id = f"properties/{property_id}"

        emit(f"Syncing: {account_name}  |  Property: {property_id}")

        try:
            request = build_ga4_request(property_id)
            response = ga4_client.run_report(request)

            if not response.rows:
                emit("  No data returned for this period.")
                no_rows += 1
                continue

            db_rows = parse_ga4_rows(response, account)
            emit(f"  {len(db_rows)} rows fetched across all channels")
            push_to_supabase(sb, db_rows, log_fn=emit)
            success_count += 1

        except Exception as e:
            emit(f"  Error for '{account_name}': {e}")
            fail_count += 1

    emit("\n=== GA4 SYNC COMPLETE ===")
    emit(f"  Success : {success_count}")
    emit(f"  Failed  : {fail_count}")
    emit(f"  Skipped (no property id) : {skipped_no_property}")
    emit(f"  No GA4 rows (empty response) : {no_rows}")
    emit(f"  Total accounts in table : {len(accounts)}\n")

    return {
        "success_count": success_count,
        "fail_count": fail_count,
        "skipped_no_property": skipped_no_property,
        "no_rows": no_rows,
        "accounts_total": len(accounts),
        "client_id": cid,
    }


if __name__ == "__main__":
    sync_ga4_data()
