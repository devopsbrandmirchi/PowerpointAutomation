from google_auth_oauthlib.flow import InstalledAppFlow

# Replace with the path to your OAuth credentials JSON you just downloaded
flow = InstalledAppFlow.from_client_secrets_file(
    'oauth_credentials.json',
    scopes=['https://www.googleapis.com/auth/adwords']
)
credentials = flow.run_local_server()
print("Refresh token:", credentials.refresh_token)
# Copy this refresh token — you will put it in google-ads.yaml