# from supabase import create_client
# import os
# from dotenv import load_dotenv

# load_dotenv()

# sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

# # Test — fetch one row to confirm connection and column names
# result = sb.table('google_ads_metrics').select('*').limit(1).execute()
# print("Connection successful")
# print("Sample row:", result.data)
# # print("Columns available:", list(result.data[0].keys()) if result.data else "No data")






import pandas as pd

df = pd.read_csv('ga4_metrics_structure.csv')
print(df.columns.tolist())