from pptx import Presentation
import os
import tempfile
from drive_utils import get_drive_service, download_file, update_file
from combined import build_full_data

def replace_in_paragraphs(paragraphs, data, slide_num, missing_list, found_list):
    """Smart replace that checks for both {{tag}} and PLACEHOLDER_tag formats."""
    for para in paragraphs:
        # Collect all text in the paragraph
        full_para_text = "".join(run.text for run in para.runs)
        original_text = full_para_text

        # If there's no tag structure at all, skip to save time
        if '{{' not in full_para_text and 'PLACEHOLDER_' not in full_para_text:
            continue

        for key, value in data.items():
            tag1 = f"{{{{{key}}}}}"             # Matches {{ga4_paid_views}}
            tag2 = f"PLACEHOLDER_{key}"         # Matches PLACEHOLDER_ga4_paid_views
            
            if tag1 in full_para_text:
                full_para_text = full_para_text.replace(tag1, str(value))
                found_list.append(key)
            if tag2 in full_para_text:
                full_para_text = full_para_text.replace(tag2, str(value))
                found_list.append(key)

        # If the text changed, update the PowerPoint run
        if full_para_text != original_text:
            if para.runs:
                para.runs[0].text = full_para_text
                # Clear out the old fragmented text runs
                for run in para.runs[1:]:
                    run.text = ""

        # Flag missing placeholders so you know what failed
        if '{{' in full_para_text or 'PLACEHOLDER_' in full_para_text:
             missing_list.append(f"Slide {slide_num}: {full_para_text[:50]}")


def fill_presentation(data, template_path, output_path):
    """Open template, replace tags, save to output."""
    prs = Presentation(template_path)
    placeholders_found = []
    placeholders_missing = []

    for slide_num, slide in enumerate(prs.slides, 1):
        for shape in slide.shapes:
            # Handle tables
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        replace_in_paragraphs(
                            cell.text_frame.paragraphs, data, slide_num, placeholders_missing, placeholders_found
                        )

            # Handle regular text boxes
            if shape.has_text_frame:
                replace_in_paragraphs(
                    shape.text_frame.paragraphs, data, slide_num, placeholders_missing, placeholders_found
                )

    prs.save(output_path)
    print(f"\nPPT filled successfully: {output_path}")
    print(f"Placeholders replaced: {len(placeholders_found)}")
    if placeholders_missing:
        print(f"WARNING — {len(placeholders_missing)} placeholders were typed incorrectly in your PPT:")
        for m in set(placeholders_missing): # Use set to remove duplicates
            print(f"  - {m}")

    return {'found': placeholders_found, 'missing': placeholders_missing}


def run_ppt_job(
    cfg,
    start_date,
    end_date,
    month_label,
    progress_cb=None,
    prev_start_date=None,
    prev_end_date=None,
):
    """progress_cb receives dicts: kind \"log\" | \"download\", optional percent, message."""

    def emit(payload):
        if progress_cb:
            progress_cb(payload)

    drive = get_drive_service()

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
        template_path = os.path.join(tmp_dir, 'template.pptx')
        output_path = os.path.join(tmp_dir, 'output.pptx')

        print("Downloading template from Google Drive...")
        emit({"kind": "log", "message": "Downloading template from Google Drive..."})
        download_file(drive, cfg['template_drive_id'], template_path, progress_cb=emit)

        print("Fetching data from Supabase/GA4...")
        emit({"kind": "log", "message": "Fetching data from Supabase/GA4..."})
        prev_start = (prev_start_date or "").strip() or None
        prev_end = (prev_end_date or "").strip() or None
        data = build_full_data(
            cfg['customer_id'],
            start_date,
            end_date,
            ga4_property_id=cfg.get('ga4_property_id'),
            customer_name_fallback=cfg.get('client_name'),
            prev_start_date=prev_start,
            prev_end_date=prev_end,
            client_id=cfg.get('client_id'),
        )
        print(f"Data fetched: {len(data)} values")
        emit({"kind": "log", "message": f"Data fetched: {len(data)} values"})

        print("Filling the template...")
        emit({"kind": "log", "message": "Filling the template..."})
        result = fill_presentation(data, template_path, output_path)
        print(f"\nPPT filled successfully: {output_path}")
        print(f"Placeholders replaced: {len(result['found'])}")
        emit({"kind": "log", "message": f"PPT filled successfully: {output_path}"})
        emit({"kind": "log", "message": f"Placeholders replaced: {len(result['found'])}"})

        output_filename = f"{cfg['client_name']}_{month_label}_filled.pptx"
        print(f"Uploading and overwriting file on Google Drive...")

        uploaded = update_file(
            drive,
            cfg['output_file_drive_id'],
            output_path,
            output_filename,
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            progress_cb=emit,
        )

        drive_url = uploaded.get('webViewLink')
        emit({"kind": "log", "message": "\n=== RESULT ==="})
        emit({"kind": "log", "message": f"File: {output_filename}"})
        emit({"kind": "log", "message": f"URL:  {drive_url}"})

        return {
            'filename': output_filename,
            'drive_url': drive_url,
            'placeholders_found': len(result['found']),
        }

if __name__ == '__main__':
    import json

    with open('config/zoomers_rv.json') as f:
        cfg = json.load(f)

    result = run_ppt_job(cfg, '2026-04-01', '2026-04-30', 'April_2026')
    
    print("\n=== RESULT ===")
    print(f"File: {result['filename']}")
    print(f"URL:  {result['drive_url']}")