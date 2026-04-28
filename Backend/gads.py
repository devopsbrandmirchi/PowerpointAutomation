from supabase import create_client
from datetime import datetime
from dateutil.relativedelta import relativedelta
import os
from dotenv import load_dotenv

load_dotenv()

# Connect to Supabase using environment variables
sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

# --- UTILITIES ---
def format_currency(value):
    if not value:
        return "$0.00"
    return f"${value:,.2f}"

def format_number(value):
    if not value:
        return "0"
    return f"{int(value):,}"

def format_percent(value, multiply_by_100=False):
    if not value:
        return "0.00%"
    if multiply_by_100:
        return f"{value * 100:.2f}%"
    return f"{value:.2f}%"

def get_pct_change(current, previous):
    try:
        curr = float(str(current).replace('$','').replace(',','').replace('%',''))
        prev = float(str(previous).replace('$','').replace(',','').replace('%',''))
        if prev == 0:
            return "N/A"
        change = ((curr - prev) / prev) * 100
        sign = "+" if change >= 0 else ""
        return f"{sign}{change:.2f}%"
    except:
        return "N/A"

# --- GOOGLE ADS LOGIC ---
def aggregate_ads(rows):
    if not rows:
        return {'cost': 0, 'impressions': 0, 'clicks': 0, 'cpc': 0, 'ctr': 0, 'impression_share': 0}
    return {
        'cost':             sum(r.get('cost', 0) for r in rows),
        'impressions':      sum(r.get('impressions', 0) for r in rows),
        'clicks':           sum(r.get('clicks', 0) for r in rows),
        'cpc':              sum(r.get('cpc', 0) for r in rows) / len(rows) if len(rows) > 0 else 0,
        'ctr':              sum(r.get('ctr', 0) for r in rows) / len(rows) if len(rows) > 0 else 0,
        'impression_share': sum(r.get('impression_share', 0) for r in rows) / len(rows) if len(rows) > 0 else 0,
    }

def fetch_gads_data(customer_id, start_date, end_date):
    # NOW FILTERING BY customer_id
    ads_raw = sb.table('google_ads_metrics') \
        .select('*') \
        .eq('customer_id', customer_id) \
        .gte('date', start_date) \
        .lte('date', end_date) \
        .execute()

    return {'ads': aggregate_ads(ads_raw.data)}

def build_gads_data(customer_id, start_date, end_date):
    current = fetch_gads_data(customer_id, start_date, end_date)

    s = datetime.strptime(start_date, '%Y-%m-%d')
    e = datetime.strptime(end_date, '%Y-%m-%d')
    prev_start = (s - relativedelta(months=1)).strftime('%Y-%m-%d')
    prev_end   = (e - relativedelta(months=1)).strftime('%Y-%m-%d')

    previous = fetch_gads_data(customer_id, prev_start, prev_end)

    a = current['ads']
    pa = previous['ads']

    data = {
        'ads_cost':              format_currency(a['cost']),
        'ads_impr':              format_number(a['impressions']),
        'ads_clicks':            format_number(a['clicks']),
        'ads_cpc':               format_currency(a['cpc']),
        'ads_ctr':               format_percent(a['ctr'] * 100),
        'ads_impr_share':        format_percent(a['impression_share'] * 100),

        'ads_cost_prev':         format_currency(pa['cost']),
        'ads_impr_prev':         format_number(pa['impressions']),
        'ads_clicks_prev':       format_number(pa['clicks']),
        'ads_cpc_prev':          format_currency(pa['cpc']),
        'ads_ctr_prev':          format_percent(pa['ctr'] * 100),
        'ads_impr_share_prev':   format_percent(pa['impression_share'] * 100),

        'ads_cost_pct':          get_pct_change(a['cost'], pa['cost']),
        'ads_impr_pct':          get_pct_change(a['impressions'], pa['impressions']),
        'ads_clicks_pct':        get_pct_change(a['clicks'], pa['clicks']),
        'ads_cpc_pct':           get_pct_change(a['cpc'], pa['cpc']),
        'ads_ctr_pct':           get_pct_change(a['ctr'], pa['ctr']),
    }
    return data

# ── TEST ──────────────────────────────
if __name__ == '__main__':
    # Put the actual 10-digit Google Ads account ID here (as an integer)
    TEST_CUSTOMER_ID = 5691491477 
    
    result = build_gads_data(TEST_CUSTOMER_ID, '2026-03-01', '2026-03-31')
    
    print("\n=== GOOGLE ADS DATA RETURNED ===")
    for key, value in result.items():
        print(f"  {key}: {value}")