from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload
from google.oauth2 import service_account
import os
from pathlib import Path
from google_credentials import resolve_google_credentials_path

SCOPES = ['https://www.googleapis.com/auth/drive']

_BACKEND_DIR = Path(__file__).resolve().parent


def _resolve_service_account_json() -> str:
    """Same JSON as GA4; path relative to Backend/ so cwd does not matter."""
    return resolve_google_credentials_path(_BACKEND_DIR)


def get_drive_service():
    """Create and return an authenticated Google Drive service client."""
    creds = service_account.Credentials.from_service_account_file(
        _resolve_service_account_json(),
        scopes=SCOPES,
    )
    return build('drive', 'v3', credentials=creds)


def download_file(drive_service, file_id, local_path, progress_cb=None):
    """Download a file from Google Drive to a local path.
    Automatically handles exporting Native Google Sheets to .xlsx.
    progress_cb receives dicts: {"kind": "download", "percent": int, "message": str} and final log line."""
    
    # 1. Ask Google what kind of file this is
    file_info = drive_service.files().get(fileId=file_id, fields='mimeType').execute()
    mime_type = file_info.get('mimeType', 'unknown')

    # THE FIX: Print the exact MIME type so we are never flying blind!
    print(f"  -> DEBUG: Google reports this file type as: '{mime_type}'")

    # 2. If it's a native Google Sheet, MUST use export_media
    if mime_type == 'application/vnd.google-apps.spreadsheet':
        msg = "Google Sheet detected! Exporting as Excel binary..."
        print(f"  -> {msg}")
        if progress_cb:
            progress_cb({"kind": "log", "message": msg})
            
        request = drive_service.files().export_media(
            fileId=file_id, 
            mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        
    # 3. THE SAFETY NET: Catch other Google native files (Docs, Slides, Shortcuts, Folders)
    elif mime_type.startswith('application/vnd.google-apps.'):
        error_msg = f"CRITICAL: The File ID provided is a '{mime_type}', NOT a Google Sheet or Excel file! Please update the ID in your database."
        if progress_cb:
            progress_cb({"kind": "log", "message": error_msg})
        raise ValueError(error_msg)

    # 4. If it's already a binary file, use standard get_media
    else:
        msg = "Binary file detected! Downloading directly..."
        print(f"  -> {msg}")
        if progress_cb:
            progress_cb({"kind": "log", "message": msg})
            
        request = drive_service.files().get_media(fileId=file_id)

    # 5. Stream the download
    with open(local_path, 'wb') as f:
        downloader = MediaIoBaseDownload(f, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
            if status:
                pct = int(status.progress() * 100)
                print(f"Downloading... {pct}%")
                if progress_cb:
                    progress_cb(
                        {
                            "kind": "download",
                            "percent": pct,
                            "message": f"Downloading... {pct}%",
                        }
                    )

    print(f"Downloaded to: {local_path}")
    if progress_cb:
        progress_cb({"kind": "log", "message": f"Downloaded to: {local_path}"})
def upload_file(drive_service, local_path, filename, folder_id, mimetype):
    """Upload a local file to a specific Google Drive folder."""
    file_metadata = {
        'name': filename,
        'parents': [folder_id]
    }
    media = MediaFileUpload(local_path, mimetype=mimetype)
    uploaded = drive_service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id,webViewLink'
    ).execute()
    print(f"Uploaded: {filename} (ID: {uploaded.get('id')})")
    return uploaded


def update_file(drive_service, file_id, local_path, filename=None, mimetype=None, progress_cb=None):
    """Update an existing Google Drive file with new content AND optionally rename it."""
    
    # SAFETY NET: If the Auction Script passes the mimetype into the filename slot, fix it instantly!
    if filename and filename.startswith('application/'):
        mimetype = filename
        filename = None

    file_metadata = {}
    if filename:
        file_metadata['name'] = filename

    if progress_cb:
        progress_cb({"kind": "log", "message": "Uploading and overwriting file on Google Drive..."})

    # Removed resumable=True. This forces a direct upload and prevents the freeze!
    media = MediaFileUpload(local_path, mimetype=mimetype)

    updated = drive_service.files().update(
        fileId=file_id,
        body=file_metadata,
        media_body=media,
        fields='id,webViewLink'
    ).execute(num_retries=5)

    msg = f"Updated file: {filename if filename else file_id}"
    print(msg)
    if progress_cb:
        progress_cb({"kind": "log", "message": msg})
    return updated


def check_folder_access(drive_service, folder_id):
    """TEST FUNCTION: Checks if the robot can see inside the folder."""
    print(f"Attempting to peek inside folder ID: {folder_id}...")
    try:
        # Ask Google Drive to list the files inside this specific folder
        results = drive_service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="files(id, name)"
        ).execute()
        
        items = results.get('files', [])
        print(f"\n✅ SUCCESS! The robot has access. Found {len(items)} files in this folder:")
        
        for item in items:
            print(f"  -> {item['name']} (ID: {item['id']})")
            
    except Exception as e:
        print(f"\n❌ ERROR: The robot cannot access this folder.")
        print("Did you remember to 'Share' the folder with the Service Account email address?")
        print(f"Exact error: {e}")


# --- TEST BLOCK ---
if __name__ == '__main__':
    # 1. Put your actual Folder ID here
    TEST_FOLDER_ID = "1TNDCIknVLsccKGolxHMzDju8t7cFMaTN" 
    
    print("Authenticating with Google Drive...")
    drive = get_drive_service()
    
    # 2. Run the access check
    check_folder_access(drive, TEST_FOLDER_ID)