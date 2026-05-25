import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase, isSupabaseAuthConfigured } from '../lib/supabaseClient';
import { postGa4SyncStream } from '../lib/api';
import { useAgency } from '../context/AgencyContext';

/**
 * Dealer “Sync GA4” → FastAPI `POST /ga4-sync-stream` → `Backend/sync_ads_to_db_GA4.py` → Supabase `ga4_metrics`.
 * DEALER_TABLE must match Backend `SUPABASE_CLIENT_TABLE` (default `google_ads_accounts`).
 */
const DEALER_TABLE = import.meta.env.VITE_SUPABASE_CLIENT_TABLE?.trim() || 'google_ads_accounts';

const GA_SERVICE_ACCOUNT_EMAIL = 'ga4-automation@leisuretime-184200.iam.gserviceaccount.com';
const DEALERS_PER_PAGE = 15;
const DEALER_SAMPLE_CSV_URL = `${import.meta.env.BASE_URL}dealer_import_sample.csv`;

/** Columns for CSV / Excel-style bulk import (header row required). */
const DEALER_CSV_COLUMNS = [
  { key: 'descriptive_name', label: 'descriptive_name', required: true, hint: 'Display name on reports' },
  { key: 'client_id', label: 'client_id', required: true, hint: 'Unique key (e.g. zoomers_rv)' },
  { key: 'customer_id', label: 'customer_id', required: true, hint: 'Google Ads customer ID (digits)' },
  { key: 'template_drive_id', label: 'template_drive_id', required: false, hint: 'Drive template file/folder ID' },
  { key: 'output_file_drive_id', label: 'output_file_drive_id', required: false, hint: 'Drive output file/folder ID' },
  { key: 'ga4_property_id', label: 'ga4_property_id', required: false, hint: 'GA4 property ID (digits)' },
  { key: 'login_customer_id', label: 'login_customer_id', required: false, hint: 'MCC / manager customer ID (optional)' },
];

const HEADER_ALIASES = {
  descriptive_name: ['descriptive_name', 'dealer_name', 'name', 'customer_name', 'account_name'],
  client_id: ['client_id', 'client id', 'clientid'],
  customer_id: ['customer_id', 'customer id', 'google_ads_customer_id', 'ads_customer_id'],
  template_drive_id: ['template_drive_id', 'template drive id', 'template_id'],
  output_file_drive_id: ['output_file_drive_id', 'output_drive_id', 'output file drive id'],
  ga4_property_id: ['ga4_property_id', 'ga4 property id', 'ga4_id', 'property_id'],
  login_customer_id: ['login_customer_id', 'login customer id', 'manager_id', 'mcc_id'],
};

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const na = String(a.descriptive_name || a.client_id || '').toLowerCase();
    const nb = String(b.descriptive_name || b.client_id || '').toLowerCase();
    return na.localeCompare(nb, undefined, { sensitivity: 'base' });
  });
}

function trimVal(v) {
  if (v == null || v === undefined) return '';
  return String(v).trim();
}

function isCompleteValues(t, o, g) {
  return Boolean(trimVal(t) && trimVal(o) && trimVal(g));
}

function isRowComplete(row) {
  return isCompleteValues(row.template_drive_id, row.output_file_drive_id, row.ga4_property_id);
}

function SyncChevron({ open }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** @param {Record<string, unknown> | null | undefined} summary */
function dealerGa4OutcomeOk(summary) {
  if (!summary || typeof summary !== 'object') return false;
  const f = Number(summary.fail_count) || 0;
  if (f > 0) return false;
  const s = Number(summary.success_count) || 0;
  const nr = Number(summary.no_rows) || 0;
  return s > 0 || nr > 0;
}

function rowMatchesSearch(row, q) {
  if (!q) return true;
  const hay = [
    row.descriptive_name,
    row.client_id,
    row.customer_id,
    row.template_drive_id,
    row.output_file_drive_id,
    row.ga4_property_id,
    row.login_customer_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function normalizeCustomerId(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function emptyDealerDraft() {
  return {
    descriptive_name: '',
    customer_id: '',
    template_drive_id: '',
    output_file_drive_id: '',
    ga4_property_id: '',
    login_customer_id: '',
  };
}

function rowToDraft(row) {
  return {
    descriptive_name: row.descriptive_name ?? '',
    customer_id: row.customer_id != null && row.customer_id !== undefined ? String(row.customer_id) : '',
    template_drive_id: row.template_drive_id ?? '',
    output_file_drive_id: row.output_file_drive_id ?? '',
    ga4_property_id:
      row.ga4_property_id != null && row.ga4_property_id !== undefined ? String(row.ga4_property_id) : '',
    login_customer_id:
      row.login_customer_id != null && row.login_customer_id !== undefined ? String(row.login_customer_id) : '',
  };
}

function buildSavePayload(draft) {
  const name = trimVal(draft.descriptive_name);
  const customerId = normalizeCustomerId(draft.customer_id);
  const ga4 = trimVal(draft.ga4_property_id).replace(/\D/g, '') || null;
  const login = normalizeCustomerId(draft.login_customer_id) || null;
  return {
    descriptive_name: name || null,
    customer_id: customerId || null,
    template_drive_id: trimVal(draft.template_drive_id) || null,
    output_file_drive_id: trimVal(draft.output_file_drive_id) || null,
    ga4_property_id: ga4,
    login_customer_id: login,
  };
}

function normHeader(cell) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function mapCsvHeaderIndex(headers) {
  const index = {};
  const norm = headers.map(normHeader);
  for (const col of DEALER_CSV_COLUMNS) {
    const aliases = HEADER_ALIASES[col.key] || [col.key];
    const i = norm.findIndex((h) => aliases.some((a) => normHeader(a) === h || h === normHeader(a)));
    if (i >= 0) index[col.key] = i;
  }
  return index;
}

/** Minimal CSV parser (quoted fields supported). */
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '' && rows.length) return;
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      pushCell();
      continue;
    }
    if (ch === '\n' || (ch === '\r' && next === '\n')) {
      pushCell();
      pushRow();
      if (ch === '\r') i += 1;
      continue;
    }
    if (ch === '\r') {
      pushCell();
      pushRow();
      continue;
    }
    cell += ch;
  }
  pushCell();
  if (row.length) pushRow();
  return rows;
}

function parseDealerCsv(text) {
  const table = parseCsvText(text);
  if (table.length < 2) {
    throw new Error('CSV must include a header row and at least one data row.');
  }
  const headerIdx = mapCsvHeaderIndex(table[0]);
  if (headerIdx.client_id == null || headerIdx.customer_id == null) {
    throw new Error('CSV header must include client_id and customer_id columns.');
  }
  const records = [];
  for (let r = 1; r < table.length; r += 1) {
    const line = table[r];
    if (!line.some((c) => trimVal(c))) continue;
    const rec = {};
    for (const col of DEALER_CSV_COLUMNS) {
      const i = headerIdx[col.key];
      rec[col.key] = i == null ? '' : line[i] ?? '';
    }
    records.push(rec);
  }
  if (!records.length) throw new Error('No data rows found in CSV.');
  return records;
}

function detectGa4ServiceDisabled(logs) {
  const text = Array.isArray(logs) ? logs.join('\n') : '';
  if (!text || !/SERVICE_DISABLED|analyticsdata\.googleapis\.com/i.test(text)) {
    return null;
  }
  const urlMatch = text.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/analyticsdata\.googleapis\.com\/overview\?project=\d+/i);
  const projectMatch = text.match(/project[s]?\/?(\d{6,})/i) || text.match(/project\s+(\d{6,})/i);
  return {
    activationUrl: urlMatch ? urlMatch[0] : null,
    projectId: projectMatch ? projectMatch[1] : null,
  };
}

export default function ConfigDealer() {
  const {
    clientBelongsToActiveAgency,
    registerClientIds,
    activeAgency,
    linkClientToActiveAgency,
    unlinkClientFromAgencyMap,
  } = useAgency();
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dealerPage, setDealerPage] = useState(1);
  /** client_ids currently showing the full form (edit mode) */
  const [editingIds, setEditingIds] = useState(() => new Set());
  /** @type {'create' | 'edit' | null} */
  const [dealerModalMode, setDealerModalMode] = useState(null);
  const [dealerModalClientId, setDealerModalClientId] = useState(null);
  const [dealerModalForm, setDealerModalForm] = useState(emptyDealerDraft);
  const [csvPanelOpen, setCsvPanelOpen] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportResult, setCsvImportResult] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const csvInputRef = useRef(null);

  /** One GA4 sync at a time (any dealer); shows which client_id is running */
  const [ga4SyncingClientId, setGa4SyncingClientId] = useState(null);
  /** @type {Record<string, { status: string, logs: string[], logsOpen: boolean, summary?: Record<string, unknown> | null }>} */
  const [ga4SyncUi, setGa4SyncUi] = useState({});
  const ga4SyncLockRef = useRef(false);

  const load = useCallback(async () => {
    if (!isSupabaseAuthConfigured || !supabase) {
      setLoadError('Supabase URL and anon key are not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
      setRows([]);
      setDrafts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.from(DEALER_TABLE).select('*');
      if (error) throw error;
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      const next = {};
      const incomplete = new Set();
      for (const r of list) {
        const id = r.client_id;
        if (!id) continue;
        next[id] = rowToDraft(r);
        if (!isRowComplete(r)) incomplete.add(id);
      }
      setDrafts(next);
      setEditingIds(incomplete);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load dealer rows');
      setRows([]);
      setDrafts({});
      setEditingIds(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ids = rows.map((r) => r.client_id).filter(Boolean);
    if (ids.length) registerClientIds(ids);
  }, [rows, registerClientIds]);

  const sorted = useMemo(
    () => sortRows(rows.filter((r) => r.client_id && clientBelongsToActiveAgency(r.client_id))),
    [rows, clientBelongsToActiveAgency],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter((row) => rowMatchesSearch(row, q));
  }, [sorted, searchQuery]);

  const dealerPageCount = Math.max(1, Math.ceil(filtered.length / DEALERS_PER_PAGE));

  const paginatedDealers = useMemo(() => {
    const start = (dealerPage - 1) * DEALERS_PER_PAGE;
    return filtered.slice(start, start + DEALERS_PER_PAGE);
  }, [filtered, dealerPage]);

  useEffect(() => {
    setDealerPage(1);
  }, [searchQuery, activeAgency?.id]);

  useEffect(() => {
    if (dealerPage > dealerPageCount) setDealerPage(dealerPageCount);
  }, [dealerPage, dealerPageCount]);

  const setField = (clientId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [clientId]: {
        ...prev[clientId],
        [field]: value,
      },
    }));
  };

  const persistDealer = async (clientId, draft, { isCreate = false } = {}) => {
    if (!supabase || !clientId) return;
    const payload = buildSavePayload(draft);
    if (!payload.customer_id) throw new Error('customer_id is required.');
    if (!payload.descriptive_name) payload.descriptive_name = clientId;

    if (isCreate) {
      const { error } = await supabase.from(DEALER_TABLE).insert({ client_id: clientId, ...payload });
      if (error) throw error;
      const row = { client_id: clientId, ...payload };
      setRows((prev) => sortRows([...prev, row]));
      setDrafts((prev) => ({ ...prev, [clientId]: rowToDraft(row) }));
      linkClientToActiveAgency(clientId);
    } else {
      const { error } = await supabase.from(DEALER_TABLE).update(payload).eq('client_id', clientId);
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) => (r.client_id === clientId ? { ...r, ...payload } : r)),
      );
      setDrafts((prev) => ({ ...prev, [clientId]: rowToDraft({ client_id: clientId, ...payload }) }));
    }
  };

  const saveRow = async (clientId) => {
    if (!supabase || !clientId) return;
    const d = drafts[clientId];
    if (!d) return;
    setSavingId(clientId);
    setSaveError(null);
    try {
      await persistDealer(clientId, d);
      setEditingIds((prev) => {
        const n = new Set(prev);
        n.delete(clientId);
        return n;
      });
    } catch (e) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  const openCreateModal = () => {
    setDealerModalMode('create');
    setDealerModalClientId('');
    setDealerModalForm(emptyDealerDraft());
    setSaveError(null);
  };

  const openEditModal = (row) => {
    const id = row.client_id;
    if (!id) return;
    setDealerModalMode('edit');
    setDealerModalClientId(id);
    setDealerModalForm(rowToDraft(row));
    setSaveError(null);
  };

  const closeDealerModal = () => {
    setDealerModalMode(null);
    setDealerModalClientId(null);
    setDealerModalForm(emptyDealerDraft());
  };

  const saveDealerModal = async () => {
    const isCreate = dealerModalMode === 'create';
    const clientId = isCreate ? trimVal(dealerModalClientId) : dealerModalClientId;
    if (!clientId) {
      setSaveError('client_id is required.');
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(clientId)) {
      setSaveError('client_id may only contain letters, numbers, underscore, dot, and hyphen.');
      return;
    }
    setSavingId(clientId);
    setSaveError(null);
    try {
      await persistDealer(clientId, dealerModalForm, { isCreate });
      closeDealerModal();
    } catch (e) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  const deleteDealer = async (clientId) => {
    if (!supabase || !clientId) return;
    const row = rows.find((r) => r.client_id === clientId);
    const label = row?.descriptive_name || clientId;
    if (!window.confirm(`Delete dealer "${label}" (${clientId})? This cannot be undone.`)) return;
    setDeletingId(clientId);
    setSaveError(null);
    try {
      const { error } = await supabase.from(DEALER_TABLE).delete().eq('client_id', clientId);
      if (error) throw error;
      setRows((prev) => prev.filter((r) => r.client_id !== clientId));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
      setEditingIds((prev) => {
        const n = new Set(prev);
        n.delete(clientId);
        return n;
      });
      unlinkClientFromAgencyMap(clientId);
    } catch (e) {
      setSaveError(e?.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const runCsvImport = async (file) => {
    if (!supabase || !file) return;
    setCsvImporting(true);
    setCsvImportResult(null);
    setSaveError(null);
    try {
      const text = await file.text();
      const records = parseDealerCsv(text);
      let ok = 0;
      const errors = [];
      const existingIds = new Set(rows.map((r) => r.client_id).filter(Boolean));

      for (let i = 0; i < records.length; i += 1) {
        const rec = records[i];
        const clientId = trimVal(rec.client_id);
        const rowNum = i + 2;
        if (!clientId) {
          errors.push(`Row ${rowNum}: missing client_id`);
          continue;
        }
        try {
          const isCreate = !existingIds.has(clientId);
          await persistDealer(clientId, rec, { isCreate });
          existingIds.add(clientId);
          ok += 1;
        } catch (e) {
          errors.push(`Row ${rowNum} (${clientId}): ${e?.message || String(e)}`);
        }
      }
      setCsvImportResult({ ok, failed: errors.length, errors });
      if (ok > 0) registerClientIds([...existingIds]);
    } catch (e) {
      setSaveError(e?.message || 'CSV import failed');
    } finally {
      setCsvImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const hasDraftChange = (row) => {
    const id = row.client_id;
    if (!id || !drafts[id]) return false;
    const saved = buildSavePayload(rowToDraft(row));
    const draft = buildSavePayload(drafts[id]);
    return JSON.stringify(saved) !== JSON.stringify(draft);
  };

  const openEdit = (clientId) => {
    setEditingIds((prev) => new Set(prev).add(clientId));
  };

  const runGa4SyncFor = async (clientId) => {
    if (!clientId || ga4SyncLockRef.current) return;
    ga4SyncLockRef.current = true;
    setGa4SyncingClientId(clientId);
    setGa4SyncUi((prev) => ({
      ...prev,
      [clientId]: { status: 'syncing', logs: [], logsOpen: true, summary: null },
    }));
    try {
      const data = await postGa4SyncStream((ev) => {
        if (ev.event === 'progress' && ev.payload?.kind === 'log' && ev.payload?.message != null) {
          const line = String(ev.payload.message);
          setGa4SyncUi((prev) => ({
            ...prev,
            [clientId]: {
              ...(prev[clientId] || {}),
              status: 'syncing',
              logsOpen: prev[clientId]?.logsOpen ?? true,
              logs: [...(prev[clientId]?.logs || []), line],
            },
          }));
        }
      }, clientId);
      const summary = data && typeof data === 'object' ? data : null;
      const ok = dealerGa4OutcomeOk(summary);
      setGa4SyncUi((prev) => ({
        ...prev,
        [clientId]: {
          ...prev[clientId],
          status: ok ? 'success' : 'error',
          summary,
          logs: prev[clientId]?.logs || [],
          logsOpen: prev[clientId]?.logsOpen ?? true,
        },
      }));
    } catch (e) {
      const msg = e?.message || String(e);
      setGa4SyncUi((prev) => ({
        ...prev,
        [clientId]: {
          ...prev[clientId],
          status: 'error',
          logs: [...(prev[clientId]?.logs || []), `ERROR: ${msg}`],
          logsOpen: true,
        },
      }));
    } finally {
      ga4SyncLockRef.current = false;
      setGa4SyncingClientId(null);
    }
  };

  const cancelEdit = (clientId) => {
    const row = rows.find((r) => r.client_id === clientId);
    if (row) {
      setDrafts((prev) => ({ ...prev, [clientId]: rowToDraft(row) }));
    }
    setEditingIds((prev) => {
      const n = new Set(prev);
      n.delete(clientId);
      return n;
    });
  };

  /** Two dots (top-right): Drive (template + output), then GA4. Green = OK, red = missing. */
  const statusDotsFor = (row) => {
    const id = row.client_id;
    const editing = Boolean(id && editingIds.has(id));
    const d = drafts[id];
    const t = trimVal(editing ? d?.template_drive_id : row.template_drive_id);
    const o = trimVal(editing ? d?.output_file_drive_id : row.output_file_drive_id);
    const g = trimVal(editing ? d?.ga4_property_id : row.ga4_property_id);
    const driveOk = Boolean(t && o);
    const ga4Ok = Boolean(g);
    const dot = (ok, label) => (
      <span
        className={`h-3 w-3 shrink-0 rounded-full ring-2 ring-white ${
          ok ? 'bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]' : 'bg-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]'
        }`}
        title={label + (ok ? ' — OK' : ' — missing')}
      />
    );
    return (
      <div
        className="absolute right-4 top-4 flex gap-1.5"
        role="img"
        aria-label={`Drive template and output: ${driveOk ? 'complete' : 'incomplete'}. GA4 property: ${ga4Ok ? 'complete' : 'incomplete'}.`}
      >
        {dot(driveOk, 'Template + output Drive IDs')}
        {dot(ga4Ok, 'GA4 property ID')}
      </div>
    );
  };

  const renderGa4SyncRow = (clientId, hasGa4Property) => {
    const pack = ga4SyncUi[clientId] || { status: 'idle', logs: [], logsOpen: false };
    const st = pack.status;
    const logs = pack.logs || [];
    const logsOpen = Boolean(pack.logsOpen);
    const syncBusy = ga4SyncingClientId !== null;
    const dotColor =
      st === 'success' ? '#16a34a' : st === 'error' ? '#dc2626' : st === 'syncing' ? '#ca8a04' : '#94a3b8';
    const dotGlow =
      st === 'syncing'
        ? '0 0 0 2px rgba(202, 138, 4, 0.35)'
        : st === 'success'
          ? '0 0 0 2px rgba(22, 163, 74, 0.35)'
          : st === 'error'
            ? '0 0 0 2px rgba(220, 38, 38, 0.35)'
            : 'none';
    const label = st === 'syncing' ? 'Syncing…' : st === 'success' ? 'OK' : st === 'error' ? 'Failed' : 'Idle';
    const serviceDisabled = detectGa4ServiceDisabled(logs);

    return (
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runGa4SyncFor(clientId)}
            disabled={syncBusy || !hasGa4Property}
            title={
              !hasGa4Property
                ? 'Enter and save a GA4 property ID first (sync reads from Supabase).'
                : syncBusy && ga4SyncingClientId !== clientId
                  ? 'Another dealer sync is running.'
                  : undefined
            }
            className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-4 py-2 text-xs font-semibold text-primary shadow-sm transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
          >
            {ga4SyncingClientId === clientId ? 'Syncing…' : 'Sync GA4'}
          </button>
          <div className="flex items-center gap-1.5 text-xs font-medium text-on-surface">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
              style={{ backgroundColor: dotColor, boxShadow: dotGlow }}
              title={`GA4 → Supabase sync: ${label}`}
            />
            <span className="text-on-surface-variant">{label}</span>
          </div>
        </div>
        {st === 'success' && dealerGa4OutcomeOk(pack.summary) ? (
          <p className="text-[11px] font-medium text-emerald-800/95">GA4 data refreshed for this dealer.</p>
        ) : null}
        {serviceDisabled ? (
          <div className="rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-[11px] text-amber-950">
            <p className="font-semibold">Google Analytics Data API is disabled for this service account project.</p>
            <p className="mt-1">
              Enable <code className="rounded bg-amber-100/80 px-1">analyticsdata.googleapis.com</code>
              {serviceDisabled.projectId ? (
                <>
                  {' '}for project <strong>{serviceDisabled.projectId}</strong>
                </>
              ) : null}
              , then retry sync in 1-2 minutes.
            </p>
            {serviceDisabled.activationUrl ? (
              <a
                href={serviceDisabled.activationUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-semibold text-primary underline decoration-primary/60 underline-offset-2"
              >
                Open API activation page
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-[rgba(194,198,209,0.2)] bg-surface-container-high/40">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-semibold text-primary hover:bg-surface-container-high/60"
            onClick={() =>
              setGa4SyncUi((p) => ({
                ...p,
                [clientId]: {
                  ...(p[clientId] || { status: 'idle', logs: [] }),
                  logsOpen: !Boolean(p[clientId]?.logsOpen),
                },
              }))
            }
            aria-expanded={logsOpen}
          >
            <span>
              Sync logs
              {logs.length ? ` (${logs.length})` : ''}
            </span>
            <SyncChevron open={logsOpen} />
          </button>
          {logsOpen ? (
            <div className="border-t border-[rgba(194,198,209,0.15)] bg-[rgba(18,22,30,0.04)] px-2 py-2">
              {st === 'syncing' && logs.length === 0 ? (
                <p className="text-center text-[11px] text-on-surface-variant">Starting…</p>
              ) : logs.length === 0 ? (
                <p className="text-center text-[11px] text-on-surface-variant">No logs yet.</p>
              ) : (
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-on-surface">
                  {logs.join('\n')}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  if (!isSupabaseAuthConfigured || !supabase) {
    return (
      <div className="mx-auto max-w-3xl animate-fade-in-down">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-primary md:text-4xl">Dealer configuration</h1>
          <p className="mt-2 text-sm text-on-surface-variant md:text-base">
            Set Drive IDs and GA4 property ID for each dealer account. Supabase env vars are missing in the frontend build.
          </p>
        </header>
        <div className="rounded-2xl border border-amber-200/90 bg-amber-50/95 px-4 py-3 text-sm text-amber-950">
          Add <code className="rounded bg-amber-100/80 px-1">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-amber-100/80 px-1">VITE_SUPABASE_ANON_KEY</code> to your Vite env and rebuild.
        </div>
      </div>
    );
  }

  const dealerModal =
    dealerModalMode &&
    createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(18,22,30,0.5)] p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dealer-modal-title"
        onClick={closeDealerModal}
      >
        <div
          className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-ambient"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="dealer-modal-title" className="font-display text-xl font-bold text-primary">
            {dealerModalMode === 'create' ? 'Add dealer' : 'Edit dealer'}
          </h2>
          <div className="mt-4 space-y-4">
            {dealerModalMode === 'create' ? (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                  client_id *
                </label>
                <input
                  type="text"
                  value={dealerModalClientId}
                  onChange={(e) => setDealerModalClientId(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-primary/25"
                  placeholder="e.g. zoomers_rv"
                />
              </div>
            ) : (
              <p className="font-mono text-xs text-on-surface-variant">
                client_id: <span className="text-on-surface">{dealerModalClientId}</span>
              </p>
            )}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                descriptive_name *
              </label>
              <input
                type="text"
                value={dealerModalForm.descriptive_name}
                onChange={(e) => setDealerModalForm((f) => ({ ...f, descriptive_name: e.target.value }))}
                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                customer_id *
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={dealerModalForm.customer_id}
                onChange={(e) =>
                  setDealerModalForm((f) => ({ ...f, customer_id: e.target.value.replace(/\D/g, '') }))
                }
                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                template_drive_id
              </label>
              <input
                type="text"
                value={dealerModalForm.template_drive_id}
                onChange={(e) => setDealerModalForm((f) => ({ ...f, template_drive_id: e.target.value }))}
                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                output_file_drive_id
              </label>
              <input
                type="text"
                value={dealerModalForm.output_file_drive_id}
                onChange={(e) => setDealerModalForm((f) => ({ ...f, output_file_drive_id: e.target.value }))}
                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                ga4_property_id
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={dealerModalForm.ga4_property_id}
                onChange={(e) =>
                  setDealerModalForm((f) => ({ ...f, ga4_property_id: e.target.value.replace(/\D/g, '') }))
                }
                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                login_customer_id
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={dealerModalForm.login_customer_id}
                onChange={(e) =>
                  setDealerModalForm((f) => ({ ...f, login_customer_id: e.target.value.replace(/\D/g, '') }))
                }
                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closeDealerModal}
              disabled={Boolean(savingId)}
              className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary hover:bg-surface-container-high disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveDealerModal()}
              disabled={Boolean(savingId)}
              className="rounded-xl px-6 py-2.5 text-sm font-semibold text-on-primary shadow-ambient hover:brightness-105 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }}
            >
              {savingId ? 'Saving…' : dealerModalMode === 'create' ? 'Create dealer' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="w-full animate-fade-in-down">
      <header className="mb-6 w-full sm:mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary md:text-4xl">Dealer configuration</h1>
        <div className="mt-4 w-full rounded-xl border border-[rgba(12,68,124,0.2)] bg-[color:rgba(12,68,124,0.06)] px-4 py-3 text-sm leading-relaxed text-on-surface md:px-5 md:py-4">
          <p className="font-semibold text-primary">Google Drive — service account (Viewer)</p>
          <p className="mt-2 text-on-surface-variant">
            After entering all IDs below, grant <strong className="text-on-surface">Viewer</strong> access on your{' '}
            <strong className="text-on-surface">template</strong> and <strong className="text-on-surface">output</strong> Drive
            items to this email so generated data can be read and written as required:
          </p>
          <p className="mt-3 break-all font-mono text-xs font-semibold text-primary sm:text-sm">{GA_SERVICE_ACCOUNT_EMAIL}</p>
        </div>
        <p className="mt-3 w-full text-sm text-on-surface-variant md:text-base">
          Two dots (top-right): first = template + output Drive IDs, second = GA4 (green = OK, red = missing). Save closes the
          card. Use <strong className="text-on-surface">Sync GA4</strong> on each dealer to refresh{' '}
          <code className="rounded bg-surface-container-high px-1 text-xs">ga4_metrics</code> for that dealer only (save GA4 ID
          first). Only one sync runs at a time. Dealers are listed {DEALERS_PER_PAGE} per page.
        </p>
        {loadError ? (
          <p className="mt-3 w-full rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-xs text-amber-950">
            {loadError}
          </p>
        ) : null}
        {saveError ? (
          <p className="mt-3 w-full rounded-lg border border-red-200/90 bg-red-50/95 px-3 py-2 text-xs text-red-950">
            {saveError}
          </p>
        ) : null}
        <div className="mt-5 flex w-full flex-wrap gap-2 border-t border-[rgba(194,198,209,0.25)] pt-5">
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-on-primary shadow-ambient transition-[filter] hover:brightness-105"
            style={{ background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }}
          >
            Add dealer
          </button>
          <button
            type="button"
            onClick={() => setCsvPanelOpen((v) => !v)}
            className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high"
          >
            {csvPanelOpen ? 'Hide CSV import' : 'Import CSV'}
          </button>
          <a
            href={DEALER_SAMPLE_CSV_URL}
            download="dealer_import_sample.csv"
            className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high"
          >
            Download sample
          </a>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {csvPanelOpen ? (
        <section className="mb-6 rounded-2xl border border-[rgba(194,198,209,0.35)] bg-surface-container-lowest p-5 shadow-ambient md:p-6">
          <h2 className="font-display text-lg font-bold text-primary">Bulk import (CSV)</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Use the same columns as the sample file (Excel can save as CSV). Existing <code className="rounded bg-surface-container-high px-1 text-xs">client_id</code> rows are updated; new IDs are inserted and linked to the current agency.
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-[rgba(194,198,209,0.25)]">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead className="bg-surface-container-high/80">
                <tr>
                  {DEALER_CSV_COLUMNS.map((col) => (
                    <th key={col.key} className="px-3 py-2 font-semibold text-primary">
                      {col.label}
                      {col.required ? <span className="text-red-600"> *</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[rgba(194,198,209,0.2)] text-on-surface-variant">
                  {DEALER_CSV_COLUMNS.map((col) => (
                    <td key={col.key} className="px-3 py-2">
                      {col.hint}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              disabled={csvImporting}
              className="text-sm text-on-surface file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-on-primary"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void runCsvImport(f);
              }}
            />
            {csvImporting ? <span className="text-sm text-on-surface-variant">Importing…</span> : null}
          </div>
          {csvImportResult ? (
            <div
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                csvImportResult.failed
                  ? 'border border-amber-200/90 bg-amber-50/95 text-amber-950'
                  : 'border border-emerald-200/90 bg-emerald-50/95 text-emerald-950'
              }`}
            >
              <p>
                Imported <strong>{csvImportResult.ok}</strong> row{csvImportResult.ok === 1 ? '' : 's'}
                {csvImportResult.failed ? (
                  <>
                    ; <strong>{csvImportResult.failed}</strong> failed
                  </>
                ) : null}
                .
              </p>
              {csvImportResult.errors?.length ? (
                <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs">
                  {csvImportResult.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="rounded-2xl bg-surface-container-lowest p-6 shadow-ambient md:p-8">
        {loading && rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Loading dealers…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            No dealers yet. Use <strong className="text-on-surface">Add dealer</strong> or <strong className="text-on-surface">Import CSV</strong> above.
          </p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            No dealers linked to the current agency (<strong>{activeAgency?.name}</strong>). Switch agency in the sidebar or use
            “Link all API clients here” after loading clients from Report Generator.
          </p>
        ) : (
          <>
            <div className="mb-6">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant" htmlFor="dealer-search">
                Search dealers
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-surface-variant" aria-hidden>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  id="dealer-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Name, client_id, customer_id, or ID fragment…"
                  className="w-full rounded-xl border-0 bg-surface-container-high py-3 pl-11 pr-4 text-sm text-on-surface outline-none ring-0 transition-[box-shadow] placeholder:text-on-surface-variant/70 focus:ring-2 focus:ring-primary/25"
                  autoComplete="off"
                />
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">
                {searchQuery.trim()
                  ? `Showing ${filtered.length} of ${sorted.length} dealer${sorted.length === 1 ? '' : 's'}`
                  : `${filtered.length} dealer${filtered.length === 1 ? '' : 's'} total`}
                {filtered.length > DEALERS_PER_PAGE ? (
                  <>
                    {' '}
                    · page {dealerPage} of {dealerPageCount}
                  </>
                ) : null}
              </p>
            </div>

            <ul className="space-y-6">
              {filtered.length === 0 ? (
                <li className="rounded-xl border border-[rgba(194,198,209,0.25)] bg-surface-container-low px-4 py-6 text-center text-sm text-on-surface-variant">
                  No dealers match your search.
                </li>
              ) : (
                paginatedDealers.map((row) => {
                  const id = row.client_id;
                  if (!id) return null;
                  const d = drafts[id] || emptyDealerDraft();
                  const dirty = hasDraftChange(row);
                  const isEditing = editingIds.has(id);
                  const tOk = Boolean(trimVal(isEditing ? d.template_drive_id : row.template_drive_id));
                  const oOk = Boolean(trimVal(isEditing ? d.output_file_drive_id : row.output_file_drive_id));
                  const gOk = Boolean(trimVal(isEditing ? d.ga4_property_id : row.ga4_property_id));

                  return (
                    <li
                      key={id}
                      className="relative rounded-xl border border-[rgba(194,198,209,0.25)] bg-surface-container-low p-4 pt-5 md:p-5 md:pt-6"
                    >
                      {statusDotsFor(row)}

                      <div className="pr-8">
                        <p className="font-display text-lg font-bold text-primary">{row.descriptive_name || id}</p>
                        <p className="mt-0.5 font-mono text-xs text-on-surface-variant">
                          client_id: <span className="text-on-surface">{id}</span>
                          {row.customer_id ? (
                            <>
                              {' '}
                              · customer_id: <span className="text-on-surface">{row.customer_id}</span>
                            </>
                          ) : null}
                        </p>
                      </div>

                      {!isEditing ? (
                        <div className="mt-4 space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                tOk ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
                              }`}
                            >
                              Template
                            </span>
                            <span
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                oOk ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
                              }`}
                            >
                              Output
                            </span>
                            <span
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                gOk ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
                              }`}
                            >
                              GA4
                            </span>
                          </div>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            {renderGa4SyncRow(id, gOk)}
                            <div className="flex shrink-0 flex-wrap justify-end gap-2 sm:pt-0">
                              <button
                                type="button"
                                onClick={() => openEdit(id)}
                                className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high"
                              >
                                Configure
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(row)}
                                className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high"
                              >
                                Edit dealer
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteDealer(id)}
                                disabled={deletingId === id}
                                className="rounded-xl border border-red-200/80 bg-red-50/90 px-5 py-2.5 text-sm font-semibold text-red-900 transition-colors hover:bg-red-100 disabled:opacity-50"
                              >
                                {deletingId === id ? 'Deleting…' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                                descriptive_name
                              </label>
                              <input
                                type="text"
                                value={d.descriptive_name}
                                onChange={(e) => setField(id, 'descriptive_name', e.target.value)}
                                autoComplete="off"
                                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 text-sm text-on-surface outline-none ring-0 transition-[box-shadow] focus:ring-2 focus:ring-primary/25"
                                placeholder="Dealer display name"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                                customer_id
                              </label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={d.customer_id}
                                onChange={(e) => setField(id, 'customer_id', e.target.value.replace(/\D/g, ''))}
                                autoComplete="off"
                                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 transition-[box-shadow] focus:ring-2 focus:ring-primary/25"
                                placeholder="Google Ads customer ID"
                              />
                            </div>
                          </div>
                          <div className="mt-4 grid gap-4 md:grid-cols-3">
                            <div>
                              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                                template_drive_id
                              </label>
                              <input
                                type="text"
                                value={d.template_drive_id}
                                onChange={(e) => setField(id, 'template_drive_id', e.target.value)}
                                autoComplete="off"
                                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 transition-[box-shadow] focus:ring-2 focus:ring-primary/25"
                                placeholder="Google Drive file or folder ID"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                                output_file_drive_id
                              </label>
                              <input
                                type="text"
                                value={d.output_file_drive_id}
                                onChange={(e) => setField(id, 'output_file_drive_id', e.target.value)}
                                autoComplete="off"
                                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 transition-[box-shadow] focus:ring-2 focus:ring-primary/25"
                                placeholder="Google Drive folder ID for output"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                                ga4_property_id
                              </label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={d.ga4_property_id}
                                onChange={(e) => setField(id, 'ga4_property_id', e.target.value.replace(/\D/g, ''))}
                                autoComplete="off"
                                className="w-full rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 transition-[box-shadow] focus:ring-2 focus:ring-primary/25"
                                placeholder="GA4 property ID (digits only)"
                              />
                            </div>
                          </div>
                          <div className="mt-4">
                            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                              login_customer_id (optional)
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={d.login_customer_id}
                              onChange={(e) => setField(id, 'login_customer_id', e.target.value.replace(/\D/g, ''))}
                              autoComplete="off"
                              className="w-full max-w-md rounded-xl border-0 bg-surface-container-high px-3 py-2.5 font-mono text-sm text-on-surface outline-none ring-0 transition-[box-shadow] focus:ring-2 focus:ring-primary/25"
                              placeholder="MCC customer ID"
                            />
                          </div>
                          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            {renderGa4SyncRow(id, Boolean(trimVal(row.ga4_property_id)))}
                            <div className="flex shrink-0 flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => void deleteDealer(id)}
                                disabled={deletingId === id || savingId === id}
                                className="rounded-xl border border-red-200/80 bg-red-50/90 px-5 py-2.5 text-sm font-semibold text-red-900 transition-colors hover:bg-red-100 disabled:opacity-50"
                              >
                                {deletingId === id ? 'Deleting…' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelEdit(id)}
                                disabled={savingId === id}
                                className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveRow(id)}
                                disabled={!dirty || savingId === id}
                                className="rounded-xl px-6 py-2.5 text-sm font-semibold text-on-primary shadow-ambient transition-[filter] hover:brightness-105 disabled:pointer-events-none disabled:opacity-50"
                                style={{ background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }}
                              >
                                {savingId === id ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })
              )}
            </ul>

            {filtered.length > DEALERS_PER_PAGE ? (
              <nav
                className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(194,198,209,0.25)] pt-6"
                aria-label="Dealer list pagination"
              >
                <p className="text-sm text-on-surface-variant">
                  Page {dealerPage} of {dealerPageCount}
                  <span className="text-on-surface-variant/80">
                    {' '}
                    ({(dealerPage - 1) * DEALERS_PER_PAGE + 1}–{Math.min(dealerPage * DEALERS_PER_PAGE, filtered.length)} of{' '}
                    {filtered.length})
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDealerPage((p) => Math.max(1, p - 1))}
                    disabled={dealerPage <= 1}
                    className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setDealerPage((p) => Math.min(dealerPageCount, p + 1))}
                    disabled={dealerPage >= dealerPageCount}
                    className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Next
                  </button>
                </div>
              </nav>
            ) : null}
          </>
        )}
      </div>

      {dealerModal}
    </div>
  );
}
