/**
 * CLI-aligned report build — mirrors manual Backend/combined.py + Backend/pptx_fill.py.
 *
 * Manual flow:
 *   combined.py  → build_full_data(customer_id, start, end)
 *   pptx_fill.py → run_ppt_job(cfg, start, end, month_label)  [cfg from Supabase / JSON]
 *
 * Frontend must NOT compute GA4. It sends the same POST body the CLI path expects and
 * displays the backend stream (build_full_data → fill_presentation → Drive upload).
 */
import { getApiBase, postGenerateStream } from './api';
import {
  appendStreamLog,
  createPptStreamHandler,
  monthLabelFromEndDate,
  resolvePrevDates,
} from './dashboardGenerate';

/**
 * Build POST body identical to manual pptx_fill / combined.py CLI:
 * - client_id only (customer_id resolved server-side from Supabase — never sent from UI)
 * - prev_* omitted when auto so combined.py uses relativedelta(months=1)
 *
 * @param {{
 *   clientId: string,
 *   startDate: string,
 *   endDate: string,
 *   prevDateAuto?: boolean,
 *   prevStartDate?: string,
 *   prevEndDate?: string,
 * }} params
 */
export function buildCliPptRequest({
  clientId,
  startDate,
  endDate,
  prevDateAuto = true,
  prevStartDate,
  prevEndDate,
}) {
  const body = {
    client_id: String(clientId || '').trim(),
    start_date: startDate,
    end_date: endDate,
    generate_ppt: true,
  };
  if (!prevDateAuto) {
    const ps = String(prevStartDate || '').trim();
    const pe = String(prevEndDate || '').trim();
    if (ps && pe) {
      body.prev_start_date = ps;
      body.prev_end_date = pe;
    }
  }
  return body;
}

/**
 * UI summary of what the CLI build will run (shown before / during generation).
 * @param {{
 *   selectedMeta?: { id?: string, name?: string, customer_id?: string },
 *   startDate: string,
 *   endDate: string,
 *   prevDateAuto?: boolean,
 *   prevManualStart?: string,
 *   prevManualEnd?: string,
 * }} opts
 */
export function describeCliBuildPlan({
  selectedMeta,
  startDate,
  endDate,
  prevDateAuto = true,
  prevManualStart = '',
  prevManualEnd = '',
}) {
  const { prevStartDate, prevEndDate } = resolvePrevDates({
    prevDateAuto,
    reportStartDate: startDate,
    reportEndDate: endDate,
    prevManualStart,
    prevManualEnd,
  });
  const request = buildCliPptRequest({
    clientId: selectedMeta?.id || '',
    startDate,
    endDate,
    prevDateAuto,
    prevStartDate,
    prevEndDate,
  });
  return {
    apiBase: getApiBase(),
    monthLabel: monthLabelFromEndDate(endDate),
    dealerName: selectedMeta?.name || selectedMeta?.id || '—',
    customerIdHint: selectedMeta?.customer_id || '—',
    currentRange: `${startDate} → ${endDate}`,
    previousRange: prevDateAuto
      ? `${prevStartDate} → ${prevEndDate} (auto — combined.py relativedelta)`
      : `${prevStartDate} → ${prevEndDate} (manual)`,
    requestBody: request,
    pipeline: ['load_client_config(client_id)', 'build_full_data()', 'fill_presentation()', 'Drive upload'],
  };
}

export function parseGa4TotalsFromLogs(streamLogLines) {
  const line = streamLogLines.find((l) => typeof l.text === 'string' && l.text.includes('GA4 totals:'));
  if (!line) return null;
  const m = line.text.match(
    /views=([\d,]+)\s+sessions=([\d,]+)\s+users=([\d,]+)\s+bounce=([\d.]+%)/,
  );
  if (!m) return { raw: line.text };
  return {
    raw: line.text,
    views: m[1],
    sessions: m[2],
    users: m[3],
    bounce: m[4],
  };
}

function pptStatusMessage(result) {
  if (result?.ppt_error) return `PPT error: ${result.ppt_error}`;
  if (result?.ppt) return 'PPT uploaded.';
  return 'PPT not returned.';
}

/**
 * Run CLI-aligned PPT build: combined.py data + pptx_fill.py template fill.
 * @param {Parameters<typeof buildCliPptRequest>[0]} params
 * @param {(lines: import('./dashboardGenerate').StreamLogLine[] | ((prev: any[]) => any[])) => void} setStreamLogLines
 */
export async function runCliPptBuild(params, setStreamLogLines) {
  const body = buildCliPptRequest(params);
  const plan = describeCliBuildPlan({
    selectedMeta: { id: params.clientId, customer_id: params.customerIdHint },
    startDate: params.startDate,
    endDate: params.endDate,
    prevDateAuto: params.prevDateAuto,
    prevManualStart: params.prevDateAuto ? '' : params.prevStartDate,
    prevManualEnd: params.prevDateAuto ? '' : params.prevEndDate,
  });

  appendStreamLog(
    setStreamLogLines,
    `CLI build → POST ${plan.apiBase}/generate-stream`,
    'cli',
  );
  appendStreamLog(
    setStreamLogLines,
    `  client_id=${body.client_id} | ${plan.currentRange} | month=${plan.monthLabel}`,
    'cli',
  );
  appendStreamLog(
    setStreamLogLines,
    '  (customer_id from Supabase DB — same as python pptx_fill.py config JSON)',
    'cli',
  );

  const t0 = performance.now();
  const handler = createPptStreamHandler(setStreamLogLines);
  const result = await postGenerateStream(body, handler);
  const durationMs = Math.round(performance.now() - t0);

  return {
    result,
    durationMs,
    logMessage: pptStatusMessage(result),
    hasError: Boolean(result?.ppt_error),
    requestBody: body,
  };
}
