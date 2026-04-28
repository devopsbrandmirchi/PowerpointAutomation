import json
from google.ads.googleads.client import GoogleAdsClient

# Initialize the client
client = GoogleAdsClient.load_from_storage("google-ads.yml")

# Put the 10-digit ID of the SPECIFIC CLIENT account here (no dashes)
CUSTOMER_ID = "5691491477" 

def run_test_and_save_json(client, customer_id):
    ga_service = client.get_service("GoogleAdsService")

    # The updated GAQL Query with all requested columns
    query = """
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
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY segments.date DESC
        LIMIT 5
    """

    print("Fetching expanded data from Google Ads...")
    request = client.get_type("SearchGoogleAdsRequest")
    request.customer_id = customer_id
    request.query = query
    response = ga_service.search(request=request)

    extracted_data = []

    # Loop through the response and build the dictionary mapping to your DB structure
    for row in response:
        row_data = {
            "date": row.segments.date,
            "campaign_id": str(row.campaign.id),
            "campaign_name": row.campaign.name,
            # Convert micros to actual dollars
            "cost": row.metrics.cost_micros / 1000000,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            # Average CPC is also returned in micros, so we divide by 1,000,000
            "cpc": row.metrics.average_cpc / 1000000,
            # CTR comes back as a decimal (e.g., 0.05 means 5%)
            "ctr": row.metrics.ctr,
            # Impression share is also a decimal
            "impression_share": row.metrics.search_impression_share
        }
        extracted_data.append(row_data)

    # Save to JSON
    with open("google_ads_expanded_data.json", "w") as json_file:
        json.dump(extracted_data, json_file, indent=4)
        
    print("Success! Expanded data saved to google_ads_expanded_data.json")

if __name__ == "__main__":
    run_test_and_save_json(client, CUSTOMER_ID)