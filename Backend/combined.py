from supabase import create_client
from datetime import datetime
from dateutil.relativedelta import relativedelta
import os
from dotenv import load_dotenv

# GA4 Client
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest

load_dotenv()

# Setup Supabase
sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

# Account row table
CLIENT_ACCOUNT_TABLE = os.environ.get("SUPABASE_CLIENT_TABLE", "google_ads_accounts")

# Setup GA4 Authentication
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "ga4-credentials.json"
ga4_client = BetaAnalyticsDataClient()

# --- UTILITIES ---
def format_duration(seconds):
    if not seconds or seconds == 0:
        return "0m 00s"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes}m {secs:02d}s"

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
    """Calculates Month-over-Month Growth (Current - Previous) / Previous * 100"""
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

def get_share_pct(part, total):
    """Calculates the Channel's Share of the Total (Part / Total) * 100"""
    if not total or total == 0:
        return "0.00%"
    return f"{(part / total) * 100:.2f}%"

# --- THE FIX: PAGINATION HELPER ---
def fetch_supabase_paginated(table_name, customer_id, start_date, end_date, columns='*'):
    """Bypasses Supabase 1,000 row hard limit by fetching data in chunks."""
    all_data = []
    offset = 0
    limit_size = 1000
    
    while True:
        response = sb.table(table_name) \
            .select(columns) \
            .eq('customer_id', customer_id) \
            .gte('date', start_date) \
            .lte('date', end_date) \
            .range(offset, offset + limit_size - 1) \
            .execute()
            
        data = response.data
        if not data:
            break
        
        all_data.extend(data)
        
        # If we got less than 1000 rows, we've reached the end of the database
        if len(data) < limit_size:
            break
            
        offset += limit_size
        
    return all_data

# --- AGGREGATION LOGIC ---
def aggregate_ads(rows):
    if not rows:
        return {'cost': 0, 'impressions': 0, 'clicks': 0, 'cpc': 0, 'ctr': 0, 'impression_share': 0}
    
    total_cost        = sum(r.get('cost', 0) for r in rows)
    total_clicks      = sum(r.get('clicks', 0) for r in rows)
    total_impressions = sum(r.get('impressions', 0) for r in rows)
    true_cpc          = total_cost / total_clicks if total_clicks > 0 else 0
    true_ctr          = total_clicks / total_impressions if total_impressions > 0 else 0

    total_eligible = 0
    total_actual   = 0

    for r in rows:
        impr   = r.get('impressions', 0)
        is_val = r.get('impression_share', 0)

        if impr > 0 and is_val and is_val > 0:
            total_eligible += impr / is_val
            total_actual   += impr

    true_impr_share = total_actual / total_eligible if total_eligible > 0 else 0

    return {
        'cost':             total_cost,
        'impressions':      total_impressions,
        'clicks':           total_clicks,
        'cpc':              true_cpc,
        'ctr':              true_ctr,
        'impression_share': true_impr_share,
    }
    
def fetch_ga4_live(customer_id, start_date, end_date, ga4_property_id=None):
    empty_data = {'vdp_views': 0, 'sessions': 0, 'avg_session_duration': 0, 'users': 0, 'bounce_rate': 0, 'button_interactions': 0, 'form_fills': 0}
    result = {
        'ga4_paid': empty_data.copy(), 
        'ga4_org': empty_data.copy(), 
        'ga4_cross': empty_data.copy(),
        'ga4_total': empty_data.copy()
    }

    property_id = (str(ga4_property_id).strip() if ga4_property_id else "") or None
    if not property_id:
        account_res = (
            sb.table(CLIENT_ACCOUNT_TABLE).select("ga4_property_id").eq("customer_id", customer_id).execute()
        )
        if not account_res.data or not account_res.data[0].get("ga4_property_id"):
            print(f"Warning: No GA4 Property ID found in database for client {customer_id}.")
            return result
        property_id = str(account_res.data[0]["ga4_property_id"]).strip()

    request_channels = RunReportRequest(
        property=f"properties/{property_id}",
        dimensions=[Dimension(name="sessionDefaultChannelGroup")],
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="sessions"),
            Metric(name="averageSessionDuration"),
            Metric(name="totalUsers"),
            Metric(name="bounceRate")
        ],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    )
    
    request_totals = RunReportRequest(
        property=f"properties/{property_id}",
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="sessions"),
            Metric(name="averageSessionDuration"),
            Metric(name="totalUsers"),
            Metric(name="bounceRate")
        ],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    )

    try:
        response_channels = ga4_client.run_report(request_channels)
        response_totals = ga4_client.run_report(request_totals)
    except Exception as e:
        print(f"GA4 API Live Fetch Error: {e}")
        return result

    channel_map = {
        'Paid Search': 'ga4_paid',
        'Organic Search': 'ga4_org',
        'Cross-network': 'ga4_cross'
    }

    for row in response_channels.rows:
        channel = row.dimension_values[0].value
        if channel in channel_map:
            key = channel_map[channel]
            result[key] = {
                'vdp_views': int(row.metric_values[0].value),
                'sessions': int(row.metric_values[1].value),
                'avg_session_duration': float(row.metric_values[2].value),
                'users': int(row.metric_values[3].value),
                'bounce_rate': float(row.metric_values[4].value),
                'button_interactions': 0,
                'form_fills': 0
            }
            
    if response_totals.rows:
        total_row = response_totals.rows[0]
        result['ga4_total'] = {
            'vdp_views': int(total_row.metric_values[0].value),
            'sessions': int(total_row.metric_values[1].value),
            'avg_session_duration': float(total_row.metric_values[2].value),
            'users': int(total_row.metric_values[3].value),
            'bounce_rate': float(total_row.metric_values[4].value),
            'button_interactions': 0,
            'form_fills': 0
        }
            
    return result

def fetch_data(customer_id, start_date, end_date, ga4_property_id=None):
    ga4_data = fetch_ga4_live(customer_id, start_date, end_date, ga4_property_id=ga4_property_id)
    
    # 1. Safely pull all GA4 Button data using pagination
    try:
        ga4_db_data = fetch_supabase_paginated('ga4_metrics', customer_id, start_date, end_date, 'channel, button_interactions')
        # print(f" -> DEBUG: Downloaded {len(ga4_db_data)} GA4 Button rows for {customer_id}")
        
        for row in ga4_db_data:
            ch = str(row.get('channel', '')).strip()
            btns = int(row.get('button_interactions', 0))
            
            if ch == 'Paid Search':
                ga4_data['ga4_paid']['button_interactions'] += btns
            elif ch == 'Organic Search':
                ga4_data['ga4_org']['button_interactions'] += btns
            elif ch == 'Cross-network':
                ga4_data['ga4_cross']['button_interactions'] += btns
                
            ga4_data['ga4_total']['button_interactions'] += btns
            
    except Exception as e:
        print(f"Error fetching buttons from Supabase: {e}")

    # 2. Safely pull all Google Ads data using pagination
    ads_raw_data = fetch_supabase_paginated('google_ads_metrics', customer_id, start_date, end_date, '*')
    print(f" -> DEBUG: Downloaded {len(ads_raw_data)} Google Ads rows for {customer_id}")

    return {
        'ga4_paid':  ga4_data['ga4_paid'],
        'ga4_org':   ga4_data['ga4_org'],
        'ga4_cross': ga4_data['ga4_cross'],
        'ga4_total': ga4_data['ga4_total'],
        'ads':       aggregate_ads(ads_raw_data),
    }

def build_full_data(customer_id, start_date, end_date, ga4_property_id=None):
    current = fetch_data(customer_id, start_date, end_date, ga4_property_id=ga4_property_id)

    s = datetime.strptime(start_date, '%Y-%m-%d')
    
    prev_s = s - relativedelta(months=1)
    prev_start = prev_s.strftime('%Y-%m-%d')
    prev_end = (s - relativedelta(days=1)).strftime('%Y-%m-%d')

    previous = fetch_data(customer_id, prev_start, prev_end, ga4_property_id=ga4_property_id)

    p = current['ga4_paid']
    o = current['ga4_org']
    c = current['ga4_cross']
    t = current['ga4_total']
    a = current['ads']
    
    pp = previous['ga4_paid']
    po = previous['ga4_org']
    pc = previous['ga4_cross']
    pt = previous['ga4_total']
    pa = previous['ads']

    data = {
        # ==========================================
        # --- GA4 GRAND TOTALS (Uses MoM Change) ---
        # ==========================================
        'ga4_total_views':        format_number(t['vdp_views']),
        'ga4_total_sessions':     format_number(t['sessions']),
        'ga4_total_duration':     format_duration(t['avg_session_duration']),
        'ga4_total_users':        format_number(t['users']),
        'ga4_total_bounce':       format_percent(t['bounce_rate'] * 100),
        'ga4_total_buttons':      format_number(t['button_interactions']),

        'ga4_total_views_prev':   format_number(pt['vdp_views']),
        'ga4_total_sessions_prev':format_number(pt['sessions']),
        'ga4_total_duration_prev':format_duration(pt['avg_session_duration']),
        'ga4_total_users_prev':   format_number(pt['users']),
        'ga4_total_bounce_prev':  format_percent(pt['bounce_rate'] * 100),
        'ga4_total_buttons_prev': format_number(pt['button_interactions']),

        'ga4_total_views_pct':    get_pct_change(t['vdp_views'], pt['vdp_views']),
        'ga4_total_sessions_pct': get_pct_change(t['sessions'], pt['sessions']),
        'ga4_total_duration_pct': get_pct_change(t['avg_session_duration'], pt['avg_session_duration']),
        'ga4_total_users_pct':    get_pct_change(t['users'], pt['users']),
        'ga4_total_bounce_pct':   get_pct_change(t['bounce_rate'], pt['bounce_rate']),
        'ga4_total_buttons_pct':  get_pct_change(t['button_interactions'], pt['button_interactions']),

        # ==========================================
        # --- GA4 PAID SEARCH (Uses Share of Total) ---
        # ==========================================
        'ga4_paid_views':        format_number(p['vdp_views']),
        'ga4_paid_sessions':     format_number(p['sessions']),
        'ga4_paid_duration':     format_duration(p['avg_session_duration']),
        'ga4_paid_users':        format_number(p['users']),
        'ga4_paid_bounce':       format_percent(p['bounce_rate'] * 100),
        'ga4_paid_buttons':      format_number(p['button_interactions']),

        'ga4_paid_views_prev':   format_number(pp['vdp_views']),
        'ga4_paid_sessions_prev':format_number(pp['sessions']),
        'ga4_paid_duration_prev':format_duration(pp['avg_session_duration']),
        'ga4_paid_users_prev':   format_number(pp['users']),
        'ga4_paid_bounce_prev':  format_percent(pp['bounce_rate'] * 100),
        'ga4_paid_buttons_prev': format_number(pp['button_interactions']),

        'ga4_paid_views_pct':    get_share_pct(p['vdp_views'], t['vdp_views']),
        'ga4_paid_sessions_pct': get_share_pct(p['sessions'], t['sessions']),
        'ga4_paid_users_pct':    get_share_pct(p['users'], t['users']),
        'ga4_paid_buttons_pct':  get_share_pct(p['button_interactions'], t['button_interactions']),
        'ga4_paid_duration_pct': get_pct_change(p['avg_session_duration'], pp['avg_session_duration']),
        'ga4_paid_bounce_pct':   get_pct_change(p['bounce_rate'], pp['bounce_rate']),

        # ==========================================
        # --- GA4 CROSS NETWORK / PMAX (Uses Share of Total) ---
        # ==========================================
        'ga4_cross_views':        format_number(c['vdp_views']),
        'ga4_cross_sessions':     format_number(c['sessions']),
        'ga4_cross_duration':     format_duration(c['avg_session_duration']),
        'ga4_cross_users':        format_number(c['users']),
        'ga4_cross_bounce':       format_percent(c['bounce_rate'] * 100),
        'ga4_cross_buttons':      format_number(c['button_interactions']),

        'ga4_cross_views_prev':   format_number(pc['vdp_views']),
        'ga4_cross_sessions_prev':format_number(pc['sessions']),
        'ga4_cross_duration_prev':format_duration(pc['avg_session_duration']),
        'ga4_cross_users_prev':   format_number(pc['users']),
        'ga4_cross_bounce_prev':  format_percent(pc['bounce_rate'] * 100),
        'ga4_cross_buttons_prev': format_number(pc['button_interactions']),

        'ga4_cross_views_pct':    get_share_pct(c['vdp_views'], t['vdp_views']),
        'ga4_cross_sessions_pct': get_share_pct(c['sessions'], t['sessions']),
        'ga4_cross_users_pct':    get_share_pct(c['users'], t['users']),
        'ga4_cross_buttons_pct':  get_share_pct(c['button_interactions'], t['button_interactions']),
        'ga4_cross_duration_pct': get_pct_change(c['avg_session_duration'], pc['avg_session_duration']),
        'ga4_cross_bounce_pct':   get_pct_change(c['bounce_rate'], pc['bounce_rate']),

        # ==========================================
        # --- GA4 ORGANIC (Uses Share of Total) ---
        # ==========================================
        'ga4_org_views':         format_number(o['vdp_views']),
        'ga4_org_sessions':      format_number(o['sessions']),
        'ga4_org_duration':      format_duration(o['avg_session_duration']),
        'ga4_org_users':         format_number(o['users']),
        'ga4_org_bounce':        format_percent(o['bounce_rate'] * 100),
        'ga4_org_buttons':       format_number(o['button_interactions']),

        'ga4_org_views_prev':    format_number(po['vdp_views']),
        'ga4_org_sessions_prev': format_number(po['sessions']),
        'ga4_org_duration_prev': format_duration(po['avg_session_duration']),
        'ga4_org_users_prev':    format_number(po['users']),
        'ga4_org_bounce_prev':   format_percent(po['bounce_rate'] * 100),
        'ga4_org_buttons_prev':  format_number(po['button_interactions']),

        'ga4_org_views_pct':     get_share_pct(o['vdp_views'], t['vdp_views']),
        'ga4_org_sessions_pct':  get_share_pct(o['sessions'], t['sessions']),
        'ga4_org_users_pct':     get_share_pct(o['users'], t['users']),
        'ga4_org_buttons_pct':   get_share_pct(o['button_interactions'], t['button_interactions']),
        'ga4_org_duration_pct':  get_pct_change(o['avg_session_duration'], po['avg_session_duration']),
        'ga4_org_bounce_pct':    get_pct_change(o['bounce_rate'], po['bounce_rate']),

        # ==========================================
        # --- GOOGLE ADS LOGIC (Uses MoM Change) ---
        # ==========================================
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
        'ads_impr_share_pct':    get_pct_change(a['impression_share'], pa['impression_share'])
    }

    return data

if __name__ == '__main__':
    TEST_CUSTOMER_ID = 2360685226
    START_DATE = '2026-03-01'
    END_DATE = '2026-03-31' 
    
    result = build_full_data(TEST_CUSTOMER_ID, START_DATE, END_DATE)
    print("\n=== DATA RETURNED ===")
    for key, value in result.items():
        print(f"  {key}: {value}")