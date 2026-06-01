/**
 * Report generation helpers for the Dashboard — API calls, date windows, stream handlers.
 * Keep Dashbaord.jsx UI-only; import from here.
 */
import { buildGeneratedFiles } from './wheelerDrive';
import {
  postAutomationLog,
  postDriveReport,
  postGenerateAuctionInsightsStream,
  postGeneratePptStream,
} from './api';
import { writeDriveReportPing } from './driveReportPing';

export function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function deriveOverallPercent(lines) {
  let p = 3;
  for (const line of lines) {
    if (line.downloadPercent != null) p = Math.max(p, 8 + line.downloadPercent * 0.27);
    const t = line.text;
    if (typeof t !== 'string') continue;
    if (t.includes('Downloaded to:')) p = Math.max(p, 36);
    if (t.includes('Data fetched:')) p = Math.max(p, 48);
    if (t.includes('GA4 totals:')) p = Math.max(p, 50);
    if (t.includes('Filling the template')) p = Math.max(p, 55);
    if (t.includes('PPT filled successfully')) p = Math.max(p, 68);
    if (t.includes('Placeholders replaced')) p = Math.max(p, 74);
    if (t.includes('Uploading and overwriting')) p = Math.max(p, 82);
    if (t.includes('Updated and renamed')) p = Math.max(p, 92);
    if (t.includes('Started Auction Report')) p = Math.max(p, 8);
    if (t.includes('Looking up dealer Drive folder')) p = Math.max(p, 18);
    if (t.includes('Drive folder ready')) p = Math.max(p, 28);
    if (t.includes('Fetching Auction data')) p = Math.max(p, 42);
    if (t.includes('Excel generated locally')) p = Math.max(p, 65);
    if (t.includes('Uploading Excel to Google Drive')) p = Math.max(p, 80);
    if (t.includes('Uploaded successfully')) p = Math.max(p, 96);
    if (t.includes('=== RESULT ===')) p = 100;
    if (t.includes('URL:')) p = Math.max(p, 98);
    if (t.includes('ERROR')) p = Math.min(p, 95);
  }
  return Math.min(100, Math.round(p));
}

export function initialReportRange() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: ymd(first), end: ymd(last) };
}

function ymdToParts(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function partsToYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftYmdByMonths(value, months) {
  const parts = ymdToParts(value);
  if (!parts) return value;
  const targetMonth = parts.m - 1 + months;
  const target = new Date(parts.y, targetMonth, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(parts.d, lastDay));
  return partsToYmd(target);
}

export function defaultPrevRange(start, end) {
  return { start: shiftYmdByMonths(start, -1), end: shiftYmdByMonths(end, -1) };
}

export function resolvePrevDates({ prevDateAuto, reportStartDate, reportEndDate, prevManualStart, prevManualEnd }) {
  const auto = defaultPrevRange(reportStartDate, reportEndDate);
  return {
    prevStartDate: prevDateAuto ? auto.start : prevManualStart,
    prevEndDate: prevDateAuto ? auto.end : prevManualEnd,
  };
}

export function monthLabelFromEndDate(endDate) {
  const parsed = new Date(`${endDate}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? endDate
    : parsed.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export function createPptStreamHandler(setStreamLogLines) {
  return (ev) => {
    if (ev.event !== 'progress' || !ev.payload) return;
    const p = ev.payload;
    setStreamLogLines((prev) => {
      if (p.kind === 'download') {
        const msg = p.message ?? `Downloading... ${p.percent ?? 0}%`;
        const last = prev[prev.length - 1];
        if (last?.isDownload) {
          return [
            ...prev.slice(0, -1),
            { ...last, text: msg, downloadPercent: p.percent ?? last.downloadPercent },
          ];
        }
        return [
          ...prev,
          { id: `dl-${Date.now()}`, text: msg, downloadPercent: p.percent, isDownload: true },
        ];
      }
      if (p.kind === 'log' && p.message) {
        return [...prev, { id: `l-${Date.now()}-${prev.length}`, text: p.message }];
      }
      return prev;
    });
  };
}

export function createAuctionLogHandler(setStreamLogLines, idPrefix = 'a') {
  return (ev) => {
    if (ev.event !== 'progress' || !ev.payload) return;
    const p = ev.payload;
    if (p.kind === 'log' && p.message) {
      setStreamLogLines((prev) => [
        ...prev,
        { id: `${idPrefix}-${Date.now()}-${prev.length}`, text: p.message },
      ]);
    }
  };
}

export function appendStreamLog(setStreamLogLines, text, idPrefix = 'x') {
  setStreamLogLines((prev) => [
    ...prev,
    { id: `${idPrefix}-${Date.now()}`, text },
  ]);
}

export function collectGeneratedFiles(clientKey, exportMode, result) {
  const list = [];
  if (result?.ppt) {
    list.push({
      name: result.ppt.filename || `${clientKey}_report.pptx`,
      kind: 'pptx',
      label: 'PowerPoint deck',
      driveUrl: result.ppt.drive_url,
    });
  }
  if (result?.excel) {
    list.push({
      name: result.excel.filename || `Auction_Insights_${clientKey}.xlsx`,
      kind: 'xlsx',
      label: 'Auction Insights Excel',
      driveUrl: result.excel.drive_url,
    });
  }
  if (list.length === 0) {
    return buildGeneratedFiles(clientKey, exportMode).map((f) => ({ ...f, driveUrl: undefined }));
  }
  return list;
}

export function buildAuctionRequest({ customerId, clientId, startDate, endDate }) {
  const cid = customerId ?? clientId;
  return {
    customer_id: String(cid || ''),
    month_label: monthLabelFromEndDate(endDate),
    start_date: startDate,
    end_date: endDate,
  };
}

export function buildPptStreamOptions({
  clientId,
  customerId,
  startDate,
  endDate,
  prevDateAuto,
  prevStartDate,
  prevEndDate,
}) {
  return {
    clientId,
    customerId,
    startDate,
    endDate,
    prevDateAuto,
    prevStartDate,
    prevEndDate,
  };
}

function pptStatusMessage(result) {
  if (result?.ppt_error) return `PPT error: ${result.ppt_error}`;
  if (result?.ppt) return 'PPT uploaded.';
  return 'PPT not returned.';
}

function auctionStatusMessage(result) {
  if (result?.excel_error) return `Auction error: ${result.excel_error}`;
  return result?.excel?.message || 'Auction Insights finished.';
}

export async function logAutomationOutcome({
  clientKey,
  clientName,
  message,
  hasError,
  durationMs,
  status,
}) {
  const resolvedStatus = status ?? (hasError ? 'warning' : 'success');
  await postAutomationLog({
    status: resolvedStatus,
    client_key: clientKey,
    client_name: clientName,
    message,
    duration_ms: durationMs,
  }).catch(() => {});
}

export async function persistDriveReport({
  clientKey,
  clientName,
  exportMode,
  generationResult,
  reportStartDate,
  reportEndDate,
  scopeKey,
}) {
  const folderDate = new Date().toISOString().slice(0, 10);
  const files = collectGeneratedFiles(clientKey, exportMode, generationResult);
  await postDriveReport({
    folder_date: folderDate,
    report_range_start: reportStartDate,
    report_range_end: reportEndDate,
    client_key: clientKey,
    client_name: clientName,
    export_mode: exportMode,
    files,
  }).catch(() => {});
  writeDriveReportPing(
    {
      clientKey,
      clientName,
      reportRangeStart: reportStartDate,
      reportRangeEnd: reportEndDate,
    },
    scopeKey,
  );
}

/** PowerPoint only — calls /generate-stream. */
export async function runDashboardPptGeneration(params, setStreamLogLines) {
  const t0 = performance.now();
  const result = await postGeneratePptStream(
    buildPptStreamOptions(params),
    createPptStreamHandler(setStreamLogLines),
  );
  const durationMs = Math.round(performance.now() - t0);
  return { result, durationMs, logMessage: pptStatusMessage(result), hasError: Boolean(result?.ppt_error) };
}

/** Auction Insights only. */
export async function runDashboardAuctionGeneration(params, setStreamLogLines) {
  const t0 = performance.now();
  const body = buildAuctionRequest(params);
  const result = await postGenerateAuctionInsightsStream(
    body,
    createAuctionLogHandler(setStreamLogLines),
  );
  const durationMs = Math.round(performance.now() - t0);
  return {
    result,
    durationMs,
    logMessage: auctionStatusMessage(result),
    hasError: Boolean(result?.excel_error),
  };
}

/** PPT then Auction — same order as Dashboard “both” mode. */
export async function runDashboardBothGeneration(params, setStreamLogLines) {
  const t0 = performance.now();
  const combined = {};
  let pptFailed = false;

  try {
    const pptResult = await postGeneratePptStream(
      buildPptStreamOptions(params),
      createPptStreamHandler(setStreamLogLines),
    );
    Object.assign(combined, pptResult);
  } catch (e) {
    pptFailed = true;
    combined.ppt_error = e?.message || 'PPT request failed';
    appendStreamLog(setStreamLogLines, `ERROR (PowerPoint): ${combined.ppt_error}`, 'pe');
  }

  appendStreamLog(setStreamLogLines, '— Starting Auction Insights step —', 'sep');

  try {
    const auctionResult = await postGenerateAuctionInsightsStream(
      buildAuctionRequest(params),
      createAuctionLogHandler(setStreamLogLines),
    );
    if (auctionResult?.excel) combined.excel = auctionResult.excel;
    if (auctionResult?.excel_error) combined.excel_error = auctionResult.excel_error;
  } catch (e) {
    combined.excel_error = e?.message || 'Auction Insights request failed';
    appendStreamLog(setStreamLogLines, `ERROR (Auction Insights): ${combined.excel_error}`, 'ae');
  }

  const durationMs = Math.round(performance.now() - t0);
  const hasError = Boolean(combined.ppt_error || combined.excel_error);
  const logMessage = [pptStatusMessage(combined), auctionStatusMessage(combined)].join(' ');

  return {
    result: combined,
    durationMs,
    logMessage,
    hasError,
    pptFailed,
    combinedError:
      pptFailed && combined.excel_error
        ? `PPT: ${combined.ppt_error}; Auction: ${combined.excel_error}`
        : null,
  };
}
