import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseAuthConfigured } from '../lib/supabaseClient';
import { postGa4SyncStream } from '../lib/api';
import { useAgency } from '../context/AgencyContext';

/**
 * Dealer “Sync GA4” → FastAPI `POST /ga4-sync-stream` → `Backend/sync_ads_to_db_GA4.py` → Supabase `ga4_metrics`.
 * DEALER_TABLE must match Backend `SUPABASE_CLIENT_TABLE` (default `google_ads_accounts`).
 */
const DEALER_TABLE = import.meta.env.VITE_SUPABASE_CLIENT_TABLE?.trim() || 'google_ads_accounts';

const GA_SERVICE_ACCOUNT_EMAIL = 'ga4-automation@leisuretime-184200.iam.gserviceaccount.com';

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
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export default function ConfigDealer() {
  const { clientBelongsToActiveAgency, registerClientIds, activeAgency } = useAgency();
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  /** client_ids currently showing the full form (edit mode) */
  const [editingIds, setEditingIds] = useState(() => new Set());

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
        next[id] = {
          template_drive_id: r.template_drive_id ?? '',
          output_file_drive_id: r.output_file_drive_id ?? '',
          ga4_property_id: r.ga4_property_id != null && r.ga4_property_id !== undefined ? String(r.ga4_property_id) : '',
        };
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

  const setField = (clientId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [clientId]: {
        ...prev[clientId],
        [field]: value,
      },
    }));
  };

  const saveRow = async (clientId) => {
    if (!supabase || !clientId) return;
    const d = drafts[clientId];
    if (!d) return;
    setSavingId(clientId);
    setSaveError(null);
    try {
      const payload = {
        template_drive_id: d.template_drive_id?.trim() || null,
        output_file_drive_id: d.output_file_drive_id?.trim() || null,
        ga4_property_id: d.ga4_property_id?.trim() || null,
      };
      const { error } = await supabase.from(DEALER_TABLE).update(payload).eq('client_id', clientId);
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) =>
          r.client_id === clientId
            ? {
                ...r,
                template_drive_id: payload.template_drive_id,
                output_file_drive_id: payload.output_file_drive_id,
                ga4_property_id: payload.ga4_property_id,
              }
            : r,
        ),
      );
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

  const hasDraftChange = (row) => {
    const id = row.client_id;
    if (!id || !drafts[id]) return false;
    const d = drafts[id];
    const t = (d.template_drive_id ?? '').trim() || null;
    const o = (d.output_file_drive_id ?? '').trim() || null;
    const g = (d.ga4_property_id ?? '').trim() || null;
    const curT = row.template_drive_id ?? null;
    const curO = row.output_file_drive_id ?? null;
    const curG =
      row.ga4_property_id != null && row.ga4_property_id !== ''
        ? String(row.ga4_property_id).trim() || null
        : null;
    return t !== curT || o !== curO || g !== curG;
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
      setDrafts((prev) => ({
        ...prev,
        [clientId]: {
          template_drive_id: row.template_drive_id ?? '',
          output_file_drive_id: row.output_file_drive_id ?? '',
          ga4_property_id:
            row.ga4_property_id != null && row.ga4_property_id !== undefined ? String(row.ga4_property_id) : '',
        },
      }));
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

  return (
    <div className="mx-auto max-w-5xl animate-fade-in-down">
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold tracking-tight text-primary md:text-4xl">Dealer configuration</h1>
          <div className="mt-4 rounded-xl border border-[rgba(12,68,124,0.2)] bg-[color:rgba(12,68,124,0.06)] px-4 py-3 text-sm leading-relaxed text-on-surface md:px-5 md:py-4">
            <p className="font-semibold text-primary">Google Drive — service account (Viewer)</p>
            <p className="mt-2 text-on-surface-variant">
              After entering all IDs below, grant <strong className="text-on-surface">Viewer</strong> access on your{' '}
              <strong className="text-on-surface">template</strong> and <strong className="text-on-surface">output</strong> Drive
              items to this email so generated data can be read and written as required:
            </p>
            <p className="mt-3 break-all font-mono text-xs font-semibold text-primary sm:text-sm">{GA_SERVICE_ACCOUNT_EMAIL}</p>
          </div>
          <p className="mt-3 max-w-xl text-sm text-on-surface-variant md:text-base">
            Two dots (top-right): first = template + output Drive IDs, second = GA4 (green = OK, red = missing). Save closes the
            card. Use <strong className="text-on-surface">Sync GA4</strong> on each dealer to refresh{' '}
            <code className="rounded bg-surface-container-high px-1 text-xs">ga4_metrics</code> for that dealer only (save GA4
            ID first). Only one sync runs at a time.
          </p>
          {loadError ? (
            <p className="mt-3 max-w-xl rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-xs text-amber-950">
              {loadError}
            </p>
          ) : null}
          {saveError ? (
            <p className="mt-3 max-w-xl rounded-lg border border-red-200/90 bg-red-50/95 px-3 py-2 text-xs text-red-950">
              {saveError}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      <div className="rounded-2xl bg-surface-container-lowest p-6 shadow-ambient md:p-8">
        {loading && rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Loading dealers…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            No rows in <code className="rounded bg-surface-container-high px-1">{DEALER_TABLE}</code>. Add accounts in Supabase
            first, then set Drive and GA4 IDs here.
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
              {searchQuery.trim() ? (
                <p className="mt-2 text-xs text-on-surface-variant">
                  Showing {filtered.length} of {sorted.length} dealer{sorted.length === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>

            <ul className="space-y-6">
              {filtered.length === 0 ? (
                <li className="rounded-xl border border-[rgba(194,198,209,0.25)] bg-surface-container-low px-4 py-6 text-center text-sm text-on-surface-variant">
                  No dealers match your search.
                </li>
              ) : (
                filtered.map((row) => {
                  const id = row.client_id;
                  if (!id) return null;
                  const d = drafts[id] || { template_drive_id: '', output_file_drive_id: '', ga4_property_id: '' };
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
                            <div className="flex shrink-0 justify-end sm:pt-0">
                              <button
                                type="button"
                                onClick={() => openEdit(id)}
                                className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high"
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
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
                          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            {renderGa4SyncRow(id, Boolean(trimVal(row.ga4_property_id)))}
                            <div className="flex shrink-0 flex-wrap justify-end gap-2">
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
          </>
        )}
      </div>
    </div>
  );
}
