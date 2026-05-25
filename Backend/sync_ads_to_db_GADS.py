import os
from datetime import datetime
from supabase import create_client, Client
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException
from dotenv import load_dotenv

load_dotenv()

# --- 1. SUPABASE SETUP ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://rllwmeqingvuohyctddg.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_KEY:
    print("WARNING: Please set SUPABASE_SERVICE_KEY in your .env file!")
    exit()

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- 2. GOOGLE ADS SETUP ---
client = GoogleAdsClient.load_from_storage("google-ads.yaml")

# SAFETY FIX: Save the default manager ID from your YAML file so we can switch back to it safely!
DEFAULT_LOGIN_CUSTOMER_ID = getattr(client, 'login_customer_id', None)


def sync_google_ads_data(client, customer_id, db_client_id):
    ga_service = client.get_service("GoogleAdsService")

    START_DATE = '2026-01-01'
    # Automatically get today's date formatted as YYYY-MM-DD
    END_DATE = datetime.now().strftime('%Y-%m-%d') 

    # Added the 'advertising_channel_type' filter to match your UI screenshot perfectly
    query = f"""
        SELECT
          segments.date,
          campaign.id,
          campaign.name,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.average_cpc,
          metrics.ctr,
          metrics.search_impression_share
        FROM campaign
        WHERE segments.date BETWEEN '{START_DATE}' AND '{END_DATE}'
          AND campaign.advertising_channel_type = 'SEARCH'
        ORDER BY segments.date DESC
    """

    request = client.get_type("SearchGoogleAdsRequest")
    request.customer_id = customer_id
    request.query = query
    response = ga_service.search(request=request)

    extracted_data = []

    for row in response:
        row_data = {
            "client_id": db_client_id,  
            "customer_id": customer_id,
            "date": row.segments.date,
            "campaign_id": str(row.campaign.id),
            "campaign_name": row.campaign.name,
            "cost": row.metrics.cost_micros / 1000000,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "cpc": row.metrics.average_cpc / 1000000,
            "ctr": row.metrics.ctr,
            "impression_share": (
                            row.metrics.search_impression_share
                            if row.metrics.search_impression_share not in (0.0, None)
                            and row.metrics.search_impression_share <= 1.0
                            else None
                        ),
        }
        extracted_data.append(row_data)

    if not extracted_data:
        print(f"  -> No data found for {customer_id} in the specified date range.")
        return

    # --- 3. DEDUPLICATION ---
    print(f"  -> Cleaning old data for {customer_id} to prevent duplicates...")
    supabase.table('google_ads_metrics') \
        .delete() \
        .eq('customer_id', customer_id) \
        .gte('date', START_DATE) \
        .lte('date', END_DATE) \
        .execute()

    # --- 4. INSERT INTO SUPABASE ---
    print(f"  -> Found {len(extracted_data)} rows. Inserting fresh data into Supabase...")
    supabase.table('google_ads_metrics').insert(extracted_data).execute()
    print(f"  -> Success! Data pushed for {customer_id}.")


def run_all_accounts():
    print("Fetching accounts from Supabase...")
    
    # Grab the accounts along with the new login_customer_id column
    response = supabase.table('google_ads_accounts').select('client_id, customer_id, descriptive_name, login_customer_id').execute()
    accounts = response.data

    if not accounts:
        print("No accounts found in the google_ads_accounts table.")
        return

    print(f"Found {len(accounts)} accounts. Starting historical data sync...\n")

    for account in accounts:
        raw_customer_id = str(account['customer_id']).replace("-", "").strip()
        db_client_id = str(account['client_id'])
        client_name = account.get('descriptive_name', 'Unknown')
        
        # Grab the manager ID from the database row
        manager_id = account.get('login_customer_id')
        
        print(f"--- Processing: {client_name} (ID: {raw_customer_id}) ---")
        
        try:
            # Dynamically inject the Manager ID into the Google Ads Client
            if manager_id and str(manager_id).strip():
                clean_manager_id = str(manager_id).replace("-", "").strip()
                client.login_customer_id = clean_manager_id
            else:
                # Re-apply the default YAML manager ID to prevent old overrides from sticking
                client.login_customer_id = DEFAULT_LOGIN_CUSTOMER_ID
                
            sync_google_ads_data(client, raw_customer_id, db_client_id)
            
        except GoogleAdsException as ex:
            print(f"  -> Google Ads API Error for {raw_customer_id}: {ex.failure.errors[0].message}")
        except Exception as e:
            print(f"  -> Unexpected error for {raw_customer_id}: {e}")


if __name__ == "__main__":
    run_all_accounts()