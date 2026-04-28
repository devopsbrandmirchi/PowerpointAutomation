export const DRIVE_REPORT_EVENT = 'pptx:report-saved-to-drive';

/** Stable storage key fragment for sessionStorage (agency / master / sub scope). */
export function drivePingStorageKey(scope = 'default') {
  const s = scope && String(scope).trim() ? String(scope).trim() : 'default';
  const safe = s.replace(/[^a-zA-Z0-9_|.-]/g, '_').slice(0, 200);
  return `pptx_drive_report_ping_${safe}`;
}

export function readDriveReportPing(scope = 'default') {
  try {
    const raw = sessionStorage.getItem(drivePingStorageKey(scope));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.clientKey !== 'string') return null;
    return o;
  } catch {
    return null;
  }
}

/** @param {{ clientKey: string, clientName: string, reportRangeStart: string, reportRangeEnd: string, ts?: number }} detail */
export function writeDriveReportPing(detail, scope = 'default') {
  const payload = { ...detail, ts: detail.ts ?? Date.now() };
  try {
    sessionStorage.setItem(drivePingStorageKey(scope), JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(new CustomEvent(DRIVE_REPORT_EVENT, { detail: payload }));
}

export function clearDriveReportPing(scope = 'default') {
  try {
    sessionStorage.removeItem(drivePingStorageKey(scope));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(DRIVE_REPORT_EVENT, { detail: null }));
}
