/**
 * Base URL for the FastAPI backend (no trailing slash).
 * Set VITE_API_URL in .env.development / .env.production, e.g. http://127.0.0.1:8000
 */
export function getApiBase() {
  const raw = import.meta.env.VITE_API_URL;
  if (raw && String(raw).trim()) return String(raw).replace(/\/$/, '');
  return 'http://pptx.wheeleradconnect.com';
}

export async function fetchClients() {
  const res = await fetch(`${getApiBase()}/clients`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to load clients (${res.status})`);
  }
  return res.json();
}

/**
 * @param {{ client_id: string, start_date: string, end_date: string, generate_ppt: boolean }} body
 */
export async function postGenerate(body) {
  const res = await fetch(`${getApiBase()}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail;
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => d.msg || d).join('; ')
          : res.statusText;
    throw new Error(msg || `Generate failed (${res.status})`);
  }
  return data;
}

/**
 * Streamed generate: calls onProgress({ event: 'progress', payload }) then resolves with final result data object.
 * @param {Record<string, unknown>} body
 * @param {(ev: { event: string, payload?: Record<string, unknown>, data?: unknown, detail?: string }) => void} onProgress
 */
export async function postGenerateStream(body, onProgress) {
  const res = await fetch(`${getApiBase()}/generate-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const j = JSON.parse(errText);
      detail = typeof j?.detail === 'string' ? j.detail : errText;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Generate failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const block of chunks) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.replace(/^data:\s?/, '');
      let ev;
      try {
        ev = JSON.parse(jsonStr);
      } catch {
        continue;
      }
      if (ev.event === 'progress' && onProgress) onProgress(ev);
      if (ev.event === 'result') {
        finalData = ev.data;
        if (onProgress) onProgress(ev);
      }
      if (ev.event === 'error') {
        throw new Error(ev.detail || 'Generate stream error');
      }
    }
  }

  if (finalData == null) throw new Error('Stream ended without a result');
  return finalData;
}

/**
 * Triggers Auction Insights generation from backend (sync fallback).
 * @param {{ customer_id: string, month_label: string, start_date?: string, end_date?: string }} payload
 */
export async function postGenerateAuctionInsights(payload) {
  const res = await fetch(`${getApiBase()}/api/reports/generate-auction-insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
    throw new Error(detail || `Auction insights failed (${res.status})`);
  }
  return data;
}

/**
 * Streamed Auction Insights generation. Emits log lines via onProgress and resolves with final result.
 * Result shape mirrors PPT pipeline: { excel: { filename, drive_url, message } } or { excel_error }.
 * @param {{ customer_id: string, month_label: string, start_date?: string, end_date?: string }} body
 * @param {(ev: { event: string, payload?: Record<string, unknown>, data?: unknown, detail?: string }) => void} onProgress
 */
export async function postGenerateAuctionInsightsStream(body, onProgress) {
  const res = await fetch(`${getApiBase()}/api/reports/generate-auction-insights-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const j = JSON.parse(errText);
      detail = typeof j?.detail === 'string' ? j.detail : errText;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Auction insights stream failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const block of chunks) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.replace(/^data:\s?/, '');
      let ev;
      try {
        ev = JSON.parse(jsonStr);
      } catch {
        continue;
      }
      if (ev.event === 'progress' && onProgress) onProgress(ev);
      if (ev.event === 'result') {
        finalData = ev.data;
        if (onProgress) onProgress(ev);
      }
      if (ev.event === 'error') {
        throw new Error(ev.detail || 'Auction insights stream error');
      }
    }
  }

  if (finalData == null) throw new Error('Stream ended without a result');
  return finalData;
}

/**
 * GA4 → Supabase sync (Backend/sync_ads_to_db_GA4.py → `ga4_metrics`). Streams log lines via onProgress.
 * @param {(ev: { event: string, payload?: Record<string, unknown>, data?: unknown, detail?: string }) => void} onProgress
 * @param {string | null | undefined} clientId If set, sync only this dealer's row (client_id in Supabase).
 */
export async function postGa4SyncStream(onProgress, clientId) {
  const res = await fetch(`${getApiBase()}/ga4-sync-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(clientId && String(clientId).trim() ? { client_id: String(clientId).trim() } : {}),
  });

  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const j = JSON.parse(errText);
      detail = typeof j?.detail === 'string' ? j.detail : errText;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `GA4 sync failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const block of chunks) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.replace(/^data:\s?/, '');
      let ev;
      try {
        ev = JSON.parse(jsonStr);
      } catch {
        continue;
      }
      if (ev.event === 'progress' && onProgress) onProgress(ev);
      if (ev.event === 'result') {
        finalData = ev.data;
        if (onProgress) onProgress(ev);
      }
      if (ev.event === 'error') {
        throw new Error(ev.detail || 'GA4 sync stream error');
      }
    }
  }

  if (finalData == null) throw new Error('GA4 sync ended without a result');
  return finalData;
}

/** @returns {Promise<Array<Record<string, unknown>>>} */
export async function fetchAutomationLogs() {
  const res = await fetch(`${getApiBase()}/automation-logs`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
    throw new Error(detail || `Failed to load logs (${res.status})`);
  }
  return Array.isArray(data) ? data : [];
}

/**
 * @param {{
 *   status: string,
 *   job_type?: string,
 *   client_key?: string,
 *   client_name?: string,
 *   message: string,
 *   duration_ms?: number,
 *   triggered_by?: string,
 * }} payload
 */
export async function postAutomationLog(payload) {
  const res = await fetch(`${getApiBase()}/automation-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_type: 'report_generation',
      triggered_by: 'user',
      ...payload,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
    throw new Error(detail || `Failed to save log (${res.status})`);
  }
  return data;
}

/** @returns {Promise<Array<Record<string, unknown>>>} */
export async function fetchDriveReports() {
  const res = await fetch(`${getApiBase()}/drive-reports`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
    throw new Error(detail || `Failed to load drive reports (${res.status})`);
  }
  return Array.isArray(data) ? data : [];
}

/**
 * @param {{
 *   folder_date: string,
 *   report_range_start: string,
 *   report_range_end: string,
 *   client_key: string,
 *   client_name?: string,
 *   export_mode: string,
 *   files: Array<Record<string, unknown>>,
 * }} payload
 */
export async function postDriveReport(payload) {
  const res = await fetch(`${getApiBase()}/drive-reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
    throw new Error(detail || `Failed to save drive report (${res.status})`);
  }
  return data;
}

/** Deletes one generated_reports row (removes this report from the list; does not delete files in Google Drive). */
export async function deleteDriveReport(reportId) {
  const res = await fetch(`${getApiBase()}/drive-reports/${encodeURIComponent(reportId)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
    throw new Error(detail || `Failed to delete report (${res.status})`);
  }
  return data;
}

/**
 * Replaces files on a report. Pass an empty array to remove the whole report row.
 * @param {string} reportId
 * @param {Array<Record<string, unknown>>} files
 */
export async function patchDriveReportFiles(reportId, files) {
  const res = await fetch(`${getApiBase()}/drive-reports/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
    throw new Error(detail || `Failed to update report files (${res.status})`);
  }
  return data;
}
