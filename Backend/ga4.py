from supabase import create_client
from datetime import datetime
from dateutil.relativedelta import relativedelta
import os
from dotenv import load_dotenv

load_dotenv()

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

def format_duration(seconds):
    if not seconds or seconds == 0:
        return "0m 00s"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes}m {secs:02d}s"

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

def aggregate_ga4(rows):
    if not rows:
        return {
            'users': 0, 'sessions': 0, 'bounce_rate': 0,
            'avg_session_duration': 0, 'vdp_views': 0,
            'button_interactions': 0, 'form_fills': 0
        }
    
    total_users = sum(r.get('users', 0) for r in rows)
    total_sessions = sum(r.get('sessions', 0) for r in rows)
    
    # Weighted averages for accurate dashboard matching
    weighted_bounce = sum(r.get('bounce_rate', 0) * r.get('sessions', 0) for r in rows)
    weighted_duration = sum(r.get('avg_session_duration', 0) * r.get('sessions', 0) for r in rows)
    
    final_bounce = weighted_bounce / total_sessions if total_sessions > 0 else 0
    final_duration = weighted_duration / total_sessions if total_sessions > 0 else 0
    
    return {
        'users':               total_users,
        'sessions':            total_sessions,
        'bounce_rate':         final_bounce,
        'avg_session_duration':final_duration,
        'vdp_views':           sum(r.get('vdp_views', 0) for r in rows),
        'button_interactions': sum(r.get('button_interactions', 0) for r in rows),
        'form_fills':          sum(r.get('form_fills', 0) for r in rows),
    }

def fetch_ga4_only(customer_id, start_date, end_date):
    ga4_paid_raw = sb.table('ga4_metrics') \
        .select('*') \
        .eq('customer_id', customer_id) \
        .eq('channel', 'Paid Search') \
        .gte('date', start_date) \
        .lte('date', end_date) \
        .execute()

    ga4_org_raw = sb.table('ga4_metrics') \
        .select('*') \
        .eq('customer_id', customer_id) \
        .eq('channel', 'Organic Search') \
        .gte('date', start_date) \
        .lte('date', end_date) \
        .execute()

    ga4_cross_raw = sb.table('ga4_metrics') \
        .select('*') \
        .eq('customer_id', customer_id) \
        .eq('channel', 'Cross-network') \
        .gte('date', start_date) \
        .lte('date', end_date) \
        .execute()

    return {
        'ga4_paid':  aggregate_ga4(ga4_paid_raw.data),
        'ga4_org':   aggregate_ga4(ga4_org_raw.data),
        'ga4_cross': aggregate_ga4(ga4_cross_raw.data),
    }

def build_ga4_data(customer_id, start_date, end_date):
    current = fetch_ga4_only(customer_id, start_date, end_date)

    s = datetime.strptime(start_date, '%Y-%m-%d')
    e = datetime.strptime(end_date, '%Y-%m-%d')
    prev_start = (s - relativedelta(months=1)).strftime('%Y-%m-%d')
    prev_end   = (e - relativedelta(months=1)).strftime('%Y-%m-%d')

    previous = fetch_ga4_only(customer_id, prev_start, prev_end)

    p = current['ga4_paid']
    o = current['ga4_org']
    c = current['ga4_cross']
    
    pp = previous['ga4_paid']
    po = previous['ga4_org']
    pc = previous['ga4_cross']

    data = {
        # --- GA4 PAID SEARCH ---
        'ga4_paid_views':        format_number(p['vdp_views']),
        'ga4_paid_sessions':     format_number(p['sessions']),
        'ga4_paid_duration':     format_duration(p['avg_session_duration']),
        'ga4_paid_users':        format_number(p['users']),
        'ga4_paid_bounce':       format_percent(p['bounce_rate'] * 100),

        'ga4_paid_users_prev':   format_number(pp['users']),
        'ga4_paid_sessions_prev':format_number(pp['sessions']),
        'ga4_paid_users_pct':    get_pct_change(p['users'], pp['users']),
        'ga4_paid_sessions_pct': get_pct_change(p['sessions'], pp['sessions']),

        # --- GA4 CROSS NETWORK (PMAX) ---
        'ga4_cross_views':        format_number(c['vdp_views']),
        'ga4_cross_sessions':     format_number(c['sessions']),
        'ga4_cross_duration':     format_duration(c['avg_session_duration']),
        'ga4_cross_users':        format_number(c['users']),
        'ga4_cross_bounce':       format_percent(c['bounce_rate'] * 100),

        'ga4_cross_users_prev':   format_number(pc['users']),
        'ga4_cross_sessions_prev':format_number(pc['sessions']),
        'ga4_cross_users_pct':    get_pct_change(c['users'], pc['users']),
        'ga4_cross_sessions_pct': get_pct_change(c['sessions'], pc['sessions']),

        # --- GA4 ORGANIC ---
        'ga4_org_views':         format_number(o['vdp_views']),
        'ga4_org_sessions':      format_number(o['sessions']),
        'ga4_org_duration':      format_duration(o['avg_session_duration']),
        'ga4_org_users':         format_number(o['users']),
        'ga4_org_bounce':        format_percent(o['bounce_rate'] * 100),
    }

    return data

if __name__ == '__main__':
    TEST_CUSTOMER_ID = 5691491477 
    # Make sure these dates EXACTLY match the date picker in your GA4 screenshot
    START_DATE = '2026-03-01'
    END_DATE = '2026-04-13' 
    
    result = build_ga4_data(TEST_CUSTOMER_ID, START_DATE, END_DATE)
    print("\n=== GA4 DATA RETURNED ===")
    for key, value in result.items():
        print(f"  {key}: {value}")