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

# THE FIX: Updated to your new table name
METRICS_TABLE    = "smart_ga4_data"


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
            # THE FIX: Added Source and Medium dimensions
            Dimension(name="sessionSource"),
            Dimension(name="sessionMedium"),
            Dimension(name="sessionSourceMedium"),
        ],
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="totalUsers"),
            Metric(name="sessions"),
            Metric(name="newUsers"),
        ],
        # THE FIX: Hardcoded date range as requested
        date_ranges=[DateRange(start_date="2026-01-01", end_date="today")],
    )


def parse_ga4_rows(response, account: dict) -> list:
    client_id         = account.get("client_id")
    raw_property_id   = account.get("ga4_property_id", "")
    account_name      = account.get("descriptive_name", client_id)
    clean_property_id = str(raw_property_id).replace("properties/", "")

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
        
        # Extract new dimensions
        source         = dv[6].value
        medium         = dv[7].value
        source_medium  = dv[8].value

        # THE FIX: Added source and medium to the unique key for perfect deduplication
        unique_key = (client_id, clean_property_id, formatted_date, page_path, channel, source, medium)

        views       = int(mv[0].value)
        total_users = int(mv[1].value)
        sessions    = int(mv[2].value)
        new_users   = int(mv[3].value)

        if unique_key in aggregated_data:
            aggregated_data[unique_key]["views"]       += views
            aggregated_data[unique_key]["total_users"] += total_users
            aggregated_data[unique_key]["sessions"]    += sessions
            aggregated_data[unique_key]["new_users"]   += new_users
        else:
            aggregated_data[unique_key] = {
                "client_id":            client_id,
                "ga4_property_id":      clean_property_id,
                "account_name":         account_name,
                "report_date":          formatted_date,
                "page_location":        page_location,
                "page_path":            page_path,
                "page_title":           page_title,
                "session_campaign":     session_camp,
                "channel":              channel,
                "source":               source,
                "medium":               medium,
                "source_medium":        source_medium,
                "views":                views,
                "total_users":          total_users,
                "sessions":             sessions,
                "new_users":            new_users,
            }

    return list(aggregated_data.values())


def push_to_supabase(sb, rows: list, batch_size: int = 1000, log_fn: Optional[Callable[[str], None]] = None):
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        sb.table(METRICS_TABLE).upsert(
            chunk,
            # THE FIX: Match the unique constraint from the SQL table
            on_conflict="client_id,ga4_property_id,report_date,page_path,channel,source,medium",
        ).execute()
    msg = f"  Pushed {len(rows)} rows to '{METRICS_TABLE}'"
    print(msg)
    if log_fn:
        log_fn(msg)


def sync_ga4_data(
    log_callback: Optional[Callable[[str], None]] = None,
    client_id: Optional[str] = None,
) -> dict[str, Any]:

    def emit(msg: str) -> None:
        print(msg)
        if log_callback:
            log_callback(msg)

    sb = get_supabase()
    ga4_client = get_ga4_client()

    # THE FIX: Hardcoded bypass for the specific account you requested
    accounts = [
        {
            "client_id": "5691491477",
            "ga4_property_id": "394545160",
            "descriptive_name": "Hardcoded GA4 Client"
        }
    ]
    
    emit(f"\n=== STARTING GA4 SYNC (Hardcoded Account) — {len(accounts)} row(s) ===\n")

    success_count = 0
    fail_count = 0
    skipped_no_property = 0
    no_rows = 0

    for account in accounts:
        client_id = account.get("client_id")
        raw_property_id = account.get("ga4_property_id")
        account_name = account.get("descriptive_name", client_id)

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
    emit(f"  No GA4 rows (empty response) : {no_rows}\n")

    return {
        "success_count": success_count,
        "fail_count": fail_count,
        "skipped_no_property": skipped_no_property,
        "no_rows": no_rows,
        "accounts_total": len(accounts),
        "client_id": client_id,
    }


if __name__ == "__main__":
    sync_ga4_data()