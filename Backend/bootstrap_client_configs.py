"""
Create per-account Drive config stubs under Backend/config/ from Supabase google_ads_accounts.

Each file is named config/<client_id>.json (same id as the database row). Existing files are
never overwritten unless you pass --force.

Fill in template_drive_id and output_file_drive_id in Google Drive for each account before running
report generation.

Usage (from Backend/, with .env containing SUPABASE_URL and SUPABASE_KEY):

  python bootstrap_client_configs.py
  python bootstrap_client_configs.py --dry-run
  python bootstrap_client_configs.py --force
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

BASE_DIR = Path(__file__).resolve().parent
CONFIG_DIR = BASE_DIR / "config"

PLACEHOLDER_TEMPLATE = "REPLACE_WITH_GOOGLE_DRIVE_TEMPLATE_FILE_ID"
PLACEHOLDER_OUTPUT = "REPLACE_WITH_GOOGLE_DRIVE_OUTPUT_FILE_ID"


def main():
    parser = argparse.ArgumentParser(description="Bootstrap config/*.json from google_ads_accounts")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing files")
    parser.add_argument("--force", action="store_true", help="Overwrite existing JSON files")
    args = parser.parse_args()

    load_dotenv(BASE_DIR / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_KEY in Backend/.env")

    sb = create_client(url, key)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    res = sb.table("google_ads_accounts").select("client_id, customer_id, descriptive_name").execute()
    rows = res.data or []

    created = 0
    skipped = 0
    for row in rows:
        client_id = row.get("client_id")
        if not client_id:
            continue
        path = CONFIG_DIR / f"{client_id}.json"
        if path.exists() and not args.force:
            skipped += 1
            continue

        payload = {
            "client_name": row.get("descriptive_name") or str(client_id),
            "customer_id": row.get("customer_id"),
            "template_drive_id": PLACEHOLDER_TEMPLATE,
            "output_file_drive_id": PLACEHOLDER_OUTPUT,
        }

        if args.dry_run:
            print(f"Would write: {path.name} ({payload['client_name']!r})")
            created += 1
            continue

        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
            f.write("\n")
        print(f"Wrote: {path.name}")
        created += 1

    print(f"\nDone. Created/updated: {created}, skipped (already exist): {skipped}")


if __name__ == "__main__":
    main()
