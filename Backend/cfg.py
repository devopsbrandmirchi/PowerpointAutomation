from supabase import create_client
import os
from services.auction_service import run_auction_job

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

def generate_client_auction_report(customer_id, start_date, end_date, month_label):
    # 1. Fetch Client Settings from Supabase
    client_res = sb.table('google_ads_accounts').select('customer_id, excel_drive_id').eq('customer_id', customer_id).execute()
    
    if not client_res.data:
        return {"error": "Client not found in database"}
        
    client_data = client_res.data[0]
    
    # 2. Fetch the specific Campaigns you want to track for this client
    # (Assuming you have a table storing campaigns, or you pass them in)
    campaigns_res = sb.table('client_campaigns').select('campaign_id, campaign_name').eq('customer_id', customer_id).execute()
    
    campaign_dict = {}
    for camp in campaigns_res.data:
        campaign_dict[camp['campaign_id']] = camp['campaign_name']

    # 3. Build the exact config your script expects
    cfg = {
        'google_ads_customer_id': client_data['customer_id'],
        'excel_drive_id': client_data['excel_drive_id'], # The specific Google Drive file ID for this client
        'campaigns': campaign_dict
    }

    # 4. Trigger your heavy-lifting script
    try:
        print(f"Starting Auction Job for {customer_id}...")
        result = run_auction_job(cfg, start_date, end_date, month_label)
        
        # 5. Save the updated Drive Link to Supabase so the frontend can display it!
        sb.table('google_ads_accounts').update({'latest_auction_report_url': result['drive_url']}).eq('customer_id', customer_id).execute()
        
        return {"status": "success", "data": result}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}