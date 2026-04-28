import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAutomationLogs } from '../lib/api';
import { useAgency } from '../context/AgencyContext';

const JOB_LABELS = {
  report_generation: 'Report generation',
  drive_sync: 'Drive sync',
  data_fetch: 'Data fetch',
  scheduled_run: 'Scheduled run',
  manual_trigger: 'Manual / health',
};

const TRIGGER_LABELS = {
  user: 'User',
  scheduler: 'Scheduler',
  system: 'System',
};

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function StatusBadge({ status }) {
  const map = {
    success: 'bg-emerald-100 text-emerald-900 ring-emerald-600/20',
    error: 'bg-red-100 text-red-900 ring-red-600/20',
    warning: 'bg-amber-100 text-amber-950 ring-amber-600/25',
    running: 'bg-sky-100 text-sky-950 ring-sky-600/20',
  };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${map[status] || map.success}`}
    >
      {label}
    </span>
  );
}

export default function AutomationLogs() {
  const { clientBelongsToActiveAgency, registerClientIds } = useAgency();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAutomationLogs();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load logs');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ids = rows.map((r) => r.clientKey).filter(Boolean);
    if (ids.length) registerClientIds(ids.map(String));
  }, [rows, registerClientIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (row.clientKey && !clientBelongsToActiveAgency(String(row.clientKey))) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        row.message,
        row.clientName,
        row.jobType,
        JOB_LABELS[row.jobType],
        row.triggeredBy,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, statusFilter, clientBelongsToActiveAgency]);

  const toggleBtn =
    'rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:text-sm';
  const toggleActive = 'bg-primary text-on-primary';
  const toggleIdle = 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-high/80';

  return (
    <div className="mx-auto max-w-6xl animate-fade-in-down">
      <header className="mb-6 sm:mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary md:text-4xl">Automation Logs</h1>
        <p className="mt-2 max-w-2xl text-sm text-on-surface-variant md:text-base">
          Runs and errors from the database (written when you use Report Generator). Use Refresh to reload.
        </p>
        {loadError ? (
          <p className="mt-4 max-w-2xl rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-sm text-amber-950">
            {loadError} Ensure FastAPI is running and the <code className="rounded bg-amber-100/80 px-1">automation_logs</code> table exists (
            <code className="rounded bg-amber-100/80 px-1">Backend/supabase_ui_tables.sql</code>).
          </p>
        ) : null}
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search message, client, job…"
          className="w-full max-w-md rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface shadow-ambient placeholder:text-on-surface-variant/70 focus:border-primary-container focus:outline-none focus:ring-2 focus:ring-primary-container/25"
          aria-label="Filter logs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={`${toggleBtn} bg-surface-container-high text-on-surface hover:bg-surface-container-high/80 disabled:opacity-50`}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {['all', 'success', 'warning', 'error'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`${toggleBtn} ${statusFilter === s ? toggleActive : toggleIdle}`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[rgba(194,198,209,0.25)] bg-surface-container-lowest shadow-ambient">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[rgba(194,198,209,0.2)] bg-surface-container-low">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">When</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Job</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Client</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Message</th>
                <th className="hidden px-4 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant lg:table-cell">
                  Duration
                </th>
                <th className="hidden px-4 py-3 text-xs font-semibold uppercase tracking-wider text-on-surface-variant md:table-cell">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[rgba(194,198,209,0.12)] transition-colors hover:bg-surface-container-high/40"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-on-surface-variant">
                    {formatWhen(row.occurredAt)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-on-surface">{JOB_LABELS[row.jobType] || row.jobType}</td>
                  <td className="px-4 py-3 text-on-surface">{row.clientName || '—'}</td>
                  <td className="max-w-md px-4 py-3 text-on-surface-variant">{row.message}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs text-on-surface-variant lg:table-cell">
                    {formatDuration(row.durationMs)}
                  </td>
                  <td className="hidden px-4 py-3 text-on-surface-variant md:table-cell">
                    {TRIGGER_LABELS[row.triggeredBy] || row.triggeredBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-on-surface-variant">No log entries match your filters.</p>
        ) : null}
      </div>

      <p className="mt-4 text-center text-xs text-on-surface-variant">
        {filtered.length} of {rows.length} entries
      </p>
    </div>
  );
}
