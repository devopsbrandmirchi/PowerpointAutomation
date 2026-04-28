import os
import tempfile
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from openpyxl import load_workbook
import gc

# Import your existing drive tools
from drive_utils import get_drive_service, download_file

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# 1. ADD YOUR SHEET IDs HERE
SHEET_2_ID = "1A8rKXdsNxGr8BDR55rSy3Trq2ZICqc1qndWGvZxai1Q"   # Top IS & Abs Top IS
SHEET_1_ID = "12PFHI1AtExNkvBsvY9efTJvA4bp6OO4ff2s49rEwTUM"   # Impr. Share & Domains

def get_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    return create_client(url, key)

def clean_value(val):
    """Cleans numeric percentages (< 10%, 80.94%) and standardizes nulls."""
    if not val or val == " --" or val == "--":
        return None
    val_str = str(val).replace('%', '').replace(',', '').strip()
    if '<' in val_str:
        return 0.09 # Convert "< 10%" to 9%
    try:
        if '%' in str(val):
            return round(float(val_str) / 100.0, 4)
        return float(val_str)
    except ValueError:
        return str(val).strip()

def extract_sheet_data(filepath, required_cols):
    """Dynamically finds headers and extracts data as a list of dicts."""
    wb = load_workbook(filepath, data_only=True)
    
    # THE FIX: Wrap in a try/finally to guarantee release
    try:
        sheet = wb.active
        extracted_rows = []
        header_map = {}
        data_started = False
        
        for row in sheet.iter_rows(values_only=True):
            if not any(row):
                continue
                
            row_strs = [str(cell).lower().strip() if cell else "" for cell in row]
            
            if not data_started:
                if "customer id" in row_strs:
                    for idx, col_name in enumerate(row_strs):
                        header_map[col_name] = idx
                    data_started = True
                continue
                
            if data_started:
                def get_val(search_str):
                    for h_name, h_idx in header_map.items():
                        if search_str in h_name:
                            return row[h_idx] if h_idx < len(row) else None
                    return None

                raw_cid = get_val("customer id")
                if not raw_cid or str(raw_cid).lower() == "total":
                    continue
                    
                row_dict = {}
                for req_col in required_cols:
                    row_dict[req_col] = get_val(req_col)
                
                row_dict["customer id"] = str(raw_cid).replace("-", "").strip()
                extracted_rows.append(row_dict)
                
        return extracted_rows
        
    finally:
        # THE FIX: Always close and explicitly delete the reference
        wb.close()
        del wb

def sync_combined_sheets():
    sb = get_supabase()
    drive = get_drive_service()
    report_date = datetime.utcnow().strftime('%Y-%m-%d')
    
    print("=== STARTING DUAL-SHEET INGEST (ACCOUNT LEVEL) ===")

    with tempfile.TemporaryDirectory() as tmp_dir:
        sheet1_path = os.path.join(tmp_dir, 'sheet1.xlsx')
        sheet2_path = os.path.join(tmp_dir, 'sheet2.xlsx')
        
        print("1. Downloading Sheet 1 (Domains & Impr Share)...")
        download_file(drive, SHEET_1_ID, sheet1_path)
        
        print("2. Downloading Sheet 2 (Top IS Metrics)...")
        download_file(drive, SHEET_2_ID, sheet2_path)
        
        print("3. Parsing Data based on exact column headers...")
        # Campaign completely removed from the search targets
        s1_cols = ["customer id", "account", "display url domain", "search impr. share"]
        s2_cols = ["customer id", "search top is", "search abs. top is"]
        
        s1_data = extract_sheet_data(sheet1_path, s1_cols)
        s2_data = extract_sheet_data(sheet2_path, s2_cols)
        
        # Convert Sheet 2 to a dictionary indexed ONLY by Customer_ID
        s2_dict = {}
        for row in s2_data:
            cid = row.get("customer id")
            # If Google exported multiple rows per account, this safely grabs the first valid one
            if cid and cid not in s2_dict:
                s2_dict[cid] = {
                    "top_is": row.get("search top is"),
                    "abs_top_is": row.get("search abs. top is")
                }
            
        print("4. Merging Sheets and Deduplicating...")
        unique_rows = {}
        
        for s1_row in s1_data:
            cid = s1_row.get("customer id")
            domain = str(s1_row.get("display url domain")).strip()
            
            if not cid or not domain or domain.lower() == "none":
                continue
                
            # Create a unique lock for this specific customer and domain combination
            row_key = (cid, domain)
            impr_share = clean_value(s1_row.get("search impr. share"))
            
            # DEDUPLICATION LOGIC: 
            # If this competitor already exists for this customer, only keep the highest impression share!
            if row_key in unique_rows:
                existing_impr = unique_rows[row_key].get("impression_share")
                if impr_share and (not existing_impr or impr_share > existing_impr):
                    unique_rows[row_key]["impression_share"] = impr_share
            else:
                # Brand new competitor domain, add it to our clean dictionary
                matching_s2 = s2_dict.get(cid, {})
                unique_rows[row_key] = {
                    "customer_id": cid,
                    "report_date": report_date,
                    "account_name": str(s1_row.get("account")).strip() if s1_row.get("account") else None,
                    "domain": domain,
                    "impression_share": impr_share,
                    "top_of_page_rate": clean_value(matching_s2.get("top_is")),
                    "absolute_top_of_page_rate": clean_value(matching_s2.get("abs_top_is"))
                }

        # Convert our clean dictionary back into a list for Supabase
        db_rows = list(unique_rows.values())

        if not db_rows:
            print("❌ No valid data found to merge.")
            return

        print(f"5. Pushing {len(db_rows)} deduplicated rows to Supabase...")
        
        batch_size = 1000
        for i in range(0, len(db_rows), batch_size):
            chunk = db_rows[i:i + batch_size]
            sb.table("google_ads_auction_master").upsert(
                chunk, 
                on_conflict="customer_id,report_date,domain"
            ).execute()
            
        print("=== ACCOUNT LEVEL INGEST COMPLETE ===")
        
        # THE FIX: Force Python to let go of the Excel files so Windows can delete the folder!
        gc.collect()

if __name__ == "__main__":
    sync_combined_sheets()