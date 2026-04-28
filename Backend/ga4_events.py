import os
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
from dotenv import load_dotenv

load_dotenv()

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "ga4-credentials.json"
ga4_client = BetaAnalyticsDataClient()

# 1. PUT YOUR 9-DIGIT GA4 PROPERTY ID HERE (e.g., "123456789")
PROPERTY_ID = "394545160" 

def discover_events():
    print(f"Asking GA4 for all event names in Property {PROPERTY_ID}...")
    
    request = RunReportRequest(
        property=f"properties/{PROPERTY_ID}",
        dimensions=[Dimension(name="eventName")],
        metrics=[Metric(name="eventCount")],
        # Looking at the last 90 days to make sure we catch everything
        date_ranges=[DateRange(start_date="90daysAgo", end_date="today")],
    )
    
    response = ga4_client.run_report(request)
    
    print("\n=== YOUR EXACT GA4 EVENT NAMES ===")
    for row in response.rows:
        event_name = row.dimension_values[0].value
        count = row.metric_values[0].value
        print(f"- {event_name} (Happened {count} times)")

if __name__ == "__main__":
    discover_events()