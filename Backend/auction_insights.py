from google.ads.googleads.client import GoogleAdsClient
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import os
import tempfile
from drive_utils import get_drive_service, download_file, update_file


# Header styling for Excel tabs
HEADER_FILL = PatternFill(fill_type='solid', fgColor='1F4E79')
HEADER_FONT = Font(name='Calibri', color='FFFFFF', bold=True, size=11)
THIN_BORDER = Border(
    bottom=Side(border_style='thin', color='DDDDDD')
)


def get_ads_client():
    """Load Google Ads client from config file."""
    return GoogleAdsClient.load_from_storage(
        os.environ.get('GOOGLE_ADS_YAML', 'backend/google-ads.yaml')
    )


def pull_auction_insights(ads_client, customer_id, campaign_id, start_date, end_date):
    """Pull Auction Insights report from Google Ads API for one campaign.
    
    Returns a list of rows, each row is a list of values:
    [domain, impression_share, overlap_rate, outranking_share, 
     position_above_rate, top_of_page_rate]"""

    # GAQL (Google Ads Query Language) — like SQL for Google Ads
    query = f"""
        SELECT
            auction_insight.domain,
            metrics.auction_insight_search_impression_share,
            metrics.auction_insight_search_overlap_rate,
            metrics.auction_insight_search_outranking_share,
            metrics.auction_insight_search_position_above_rate,
            metrics.auction_insight_search_top_impression_percentage
        FROM campaign
        WHERE campaign.id = {campaign_id}
            AND segments.date BETWEEN '{start_date}' AND '{end_date}'
        ORDER BY metrics.auction_insight_search_impression_share DESC
    """

    ga_service = ads_client.get_service('GoogleAdsService')
    response = ga_service.search(customer_id=str(customer_id), query=query)

    rows = []
    for row in response:
        m = row.metrics
        rows.append([
            row.auction_insight.domain,
            f"{m.auction_insight_search_impression_share * 100:.1f}%",
            f"{m.auction_insight_search_overlap_rate * 100:.1f}%",
            f"{m.auction_insight_search_outranking_share * 100:.1f}%",
            f"{m.auction_insight_search_position_above_rate * 100:.1f}%",
            f"{m.auction_insight_search_top_impression_percentage * 100:.1f}%",
        ])

    print(f"  Auction insights: {len(rows)} competitors found")
    return rows


def pull_search_terms(ads_client, customer_id, campaign_id, start_date, end_date):
    """Pull Search Terms report from Google Ads API for one campaign.
    
    Returns list of rows:
    [search_term, match_type, impressions, clicks, ctr, cpc, conversions]"""

    query = f"""
        SELECT
            search_term_view.search_term,
            segments.keyword.info.match_type,
            metrics.impressions,
            metrics.clicks,
            metrics.ctr,
            metrics.average_cpc,
            metrics.conversions
        FROM search_term_view
        WHERE campaign.id = {campaign_id}
            AND segments.date BETWEEN '{start_date}' AND '{end_date}'
        ORDER BY metrics.impressions DESC
        LIMIT 200
    """

    ga_service = ads_client.get_service('GoogleAdsService')
    response = ga_service.search(customer_id=str(customer_id), query=query)

    rows = []
    for row in response:
        m = row.metrics
        rows.append([
            row.search_term_view.search_term,
            row.segments.keyword.info.match_type.name.replace('_', ' ').title(),
            m.impressions,
            m.clicks,
            f"{m.ctr * 100:.2f}%",
            f"${m.average_cpc / 1_000_000:.2f}",  # micros to dollars
            round(m.conversions, 1),
        ])

    print(f"  Search terms: {len(rows)} terms found")
    return rows


def write_excel_tab(workbook, tab_name, headers, rows, header_color='1F4E79'):
    """Write a new tab to an Excel workbook with styled headers.
    
    If a tab with the same name already exists, it is deleted first
    (this allows safe reruns if you need to regenerate a month)."""

    # Delete existing tab if it exists (safe to rerun)
    if tab_name in workbook.sheetnames:
        del workbook[tab_name]
        print(f"  Replaced existing tab: {tab_name}")

    ws = workbook.create_sheet(title=tab_name)

    # Write headers with styling
    header_fill = PatternFill(fill_type='solid', fgColor=header_color)
    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.fill = header_fill
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal='center', vertical='center')

    # Set row height for header
    ws.row_dimensions[1].height = 20

    # Write data rows
    for row_idx, row_data in enumerate(rows, 2):
        for col_idx, value in enumerate(row_data, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.alignment = Alignment(vertical='center')
            cell.border = THIN_BORDER

    # Auto-fit column widths (approximate)
    for col in ws.columns:
        max_length = 0
        for cell in col:
            try:
                if cell.value:
                    max_length = max(max_length, len(str(cell.value)))
            except:
                pass
        ws.column_dimensions[col[0].column_letter].width = min(max_length + 4, 50)

    print(f"  Tab written: {tab_name} ({len(rows)} rows)")
    return ws


def run_auction_job(cfg, start_date, end_date, month_label):
    """Main function to update the Auction Insights Excel file.
    
    Downloads existing Excel from Drive, adds new tabs, uploads back.
    All previous months tabs are preserved."""

    drive     = get_drive_service()
    ads_client = get_ads_client()
    customer_id = cfg['google_ads_customer_id'].replace('-', '')

    AUCTION_HEADERS = [
        'Competitor Domain', 'Impression Share', 'Overlap Rate',
        'Outranking Share', 'Position Above Rate', 'Top of Page Rate'
    ]
    SEARCH_HEADERS = [
        'Search Term', 'Match Type', 'Impressions',
        'Clicks', 'CTR', 'Avg CPC', 'Conversions'
    ]

    with tempfile.TemporaryDirectory() as tmp_dir:
        local_excel = os.path.join(tmp_dir, 'auction_insights.xlsx')

        # CRITICAL: Always download existing file to preserve history
        print("Downloading existing Excel from Google Drive...")
        download_file(drive, cfg['excel_drive_id'], local_excel)
        wb = load_workbook(local_excel)
        print(f"Existing tabs: {wb.sheetnames}")

        # Process each campaign
        for campaign_id, campaign_name in cfg['campaigns'].items():
            print(f"\nProcessing campaign: {campaign_name} ({campaign_id})")

            # Pull Auction Insights
            auction_rows = pull_auction_insights(
                ads_client, customer_id, campaign_id, start_date, end_date
            )
            auction_tab = f"{month_label} - {campaign_name} - Auction"
            # Excel tab names max 31 chars
            if len(auction_tab) > 31:
                auction_tab = auction_tab[:31]
            write_excel_tab(wb, auction_tab, AUCTION_HEADERS, auction_rows, '1F4E79')

            # Pull Search Terms
            search_rows = pull_search_terms(
                ads_client, customer_id, campaign_id, start_date, end_date
            )
            search_tab = f"{month_label} - {campaign_name} - Search Terms"
            if len(search_tab) > 31:
                search_tab = search_tab[:28] + "..."
            write_excel_tab(wb, search_tab, SEARCH_HEADERS, search_rows, '375623')

        # Save locally then upload back to Drive
        wb.save(local_excel)
        print(f"\nUploading updated Excel back to Google Drive...")
        updated = update_file(
            drive,
            cfg['excel_drive_id'],
            local_excel,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        print(f"Excel updated successfully")
        return {
            'drive_url': updated.get('webViewLink'),
            'tabs_added': len(cfg['campaigns']) * 2
        }