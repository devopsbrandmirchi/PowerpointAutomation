import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteDriveReport, fetchDriveReports, patchDriveReportFiles } from '../lib/api';
import { useAgency } from '../context/AgencyContext';
import { DRIVE_REPORT_EVENT, readDriveReportPing } from '../lib/driveReportPing';

function normalizeEntry(e) {
  const start = e.reportRangeStart || e.folderDate || e.createdAt?.slice(0, 10) || '';
  const end = e.reportRangeEnd || e.folderDate || e.createdAt?.slice(0, 10) || '';
  return { ...e, reportRangeStart: start, reportRangeEnd: end };
}

function isoToDM(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatReportRangeLabel(startIso, endIso) {
  return `${isoToDM(startIso)} to ${isoToDM(endIso)}`;
}

function buildDriveTree(entries) {
  const tree = new Map();
  for (const raw of entries) {
    const e = normalizeEntry(raw);
    const ck = e.clientKey || 'unknown';
    const rk = `${e.reportRangeStart}|${e.reportRangeEnd}`;
    if (!tree.has(ck)) {
      tree.set(ck, { clientKey: ck, clientName: e.clientName || ck, ranges: new Map() });
    }
    const clientNode = tree.get(ck);
    clientNode.clientName = e.clientName || clientNode.clientName;
    if (!clientNode.ranges.has(rk)) {
      clientNode.ranges.set(rk, {
        start: e.reportRangeStart,
        end: e.reportRangeEnd,
        runs: [],
      });
    }
    clientNode.ranges.get(rk).runs.push(e);
  }
  return tree;
}

function treeToClientsArray(tree, clientSort, rangeSort) {
  const clients = [...tree.values()].map((c) => ({
    ...c,
    rangeList: [...c.ranges.values()],
  }));

  clients.sort((a, b) =>
    clientSort === 'name-desc' ? b.clientName.localeCompare(a.clientName) : a.clientName.localeCompare(b.clientName),
  );

  for (const c of clients) {
    c.rangeList.sort((a, b) => {
      const cmp = b.end.localeCompare(a.end);
      return rangeSort === 'range-oldest' ? -cmp : cmp;
    });
  }

  return clients;
}

function ClientFolderIcon() {
  return (
    <svg className="h-5 w-5 text-primary-container" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
    </svg>
  );
}

function CalendarFolderIcon() {
  return (
    <svg className="h-4 w-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function Chevron({ open }) {
  return (
    <svg
      className={`h-5 w-5 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-90' : ''}`}
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

function FileRow({ name, kind, onOpen, onRequestDelete }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-on-surface">{name}</p>
        <p className="text-xs text-on-surface-variant">{kind === 'pptx' ? 'PowerPoint' : 'Excel'} · Google Drive</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-sky-200/90"
        >
          Open
        </button>
        {onRequestDelete ? (
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-lg border border-red-200/90 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100/90"
            title="Remove from list"
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FileCard({ name, kind, onOpen, onRequestDelete }) {
  return (
    <div className="flex flex-col rounded-xl border border-[rgba(194,198,209,0.25)] bg-surface-container-lowest p-4 shadow-ambient">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[color:rgba(12,68,124,0.08)] text-primary-container">
        {kind === 'pptx' ? (
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
          </svg>
        ) : (
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM8 12h8v2H8v-2zm0 4h8v2H8v-2z" />
          </svg>
        )}
      </div>
      <p className="break-words text-sm font-semibold text-on-surface">{name}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{kind === 'pptx' ? 'PowerPoint' : 'Excel'}</p>
      <div className={`mt-4 grid gap-2 ${onRequestDelete ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          onClick={onOpen}
          className="rounded-lg bg-sky-100 py-2 text-xs font-semibold text-primary hover:bg-sky-200/90"
        >
          Open
        </button>
        {onRequestDelete ? (
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-lg border border-red-200/90 bg-red-50 py-2 text-xs font-semibold text-red-900 hover:bg-red-100/90"
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DriveDeleteModal({ modal, onDismiss, onConfirm }) {
  if (!modal) return null;
  const { phase, kind, file, error } = modal;
  const detail =
    kind === 'run'
      ? 'This removes the whole saved report (this “folder” / generation) from the database. Files in Google Drive are not deleted.'
      : 'This removes only this file from the saved report. The file in Google Drive is not deleted.';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4 py-8 sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-del-title"
    >
      <div
        className="absolute inset-0 bg-[rgba(18,22,30,0.72)] backdrop-blur-md"
        onClick={phase === 'confirm' || phase === 'success' || phase === 'error' ? onDismiss : undefined}
        aria-hidden
      />
      <div className="relative my-auto w-full max-w-md max-h-[min(92vh,560px)] overflow-y-auto overflow-x-hidden rounded-xl bg-surface-container-lowest shadow-ambient">
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: '#003366' }}>
          <h2 id="drive-del-title" className="flex-1 text-center text-sm font-semibold text-on-primary">
            {phase === 'success' ? 'Deleted' : kind === 'run' ? 'Delete report?' : 'Remove file?'}
          </h2>
        </div>
        <div className="px-5 py-5">
          {phase === 'confirm' ? (
            <>
              <p className="text-sm leading-relaxed text-on-surface">{detail}</p>
              {kind === 'file' && file?.name ? (
                <p className="mt-3 break-all rounded-lg bg-surface-container-high px-3 py-2 font-mono text-xs text-on-surface">{file.name}</p>
              ) : null}
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-surface-container-high"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-ambient transition-[filter] hover:brightness-110"
                >
                  {kind === 'run' ? 'Delete report' : 'Remove file'}
                </button>
              </div>
            </>
          ) : null}
          {phase === 'loading' ? (
            <p className="text-center text-sm font-medium text-on-surface-variant">Deleting…</p>
          ) : null}
          {phase === 'success' ? (
            <div className="text-center">
              <div
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl shadow-sm"
                style={{ background: 'linear-gradient(180deg, #2d7a3e 0%, #3e6a00 100%)' }}
                aria-hidden
              >
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="mt-4 text-sm font-semibold text-emerald-900">It’s deleted.</p>
              <p className="mt-1 text-xs text-on-surface-variant">The list has been updated.</p>
              <button
                type="button"
                onClick={onDismiss}
                className="mt-6 w-full rounded-xl py-3 text-sm font-semibold text-on-primary shadow-ambient transition-[filter] hover:brightness-105"
                style={{ background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }}
              >
                OK
              </button>
            </div>
          ) : null}
          {phase === 'error' ? (
            <div>
              <p className="rounded-lg border border-red-200/90 bg-red-50/95 px-3 py-2 text-sm text-red-950">{error || 'Something went wrong.'}</p>
              <button
                type="button"
                onClick={onDismiss}
                className="mt-6 w-full rounded-xl border border-[rgba(194,198,209,0.45)] py-3 text-sm font-semibold text-primary transition-colors hover:bg-surface-container-high"
              >
                Close
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Disclosure({ title, subtitle, icon, defaultOpen, children, depth, trailing }) {
  const [open, setOpen] = useState(defaultOpen === true);
  const HeadingTag = depth === 0 ? 'h2' : 'h3';
  return (
    <div className={depth === 0 ? 'overflow-hidden rounded-2xl bg-surface-container-lowest shadow-ambient' : 'rounded-xl border border-[rgba(194,198,209,0.2)] bg-surface-container-low'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-high/60 md:px-5 md:py-4"
        aria-expanded={open}
      >
        <Chevron open={open} />
        {icon}
        <div className="min-w-0 flex-1">
          <HeadingTag className={`font-display font-bold text-primary ${depth === 0 ? 'text-lg' : 'text-base'}`}>
            {title}
          </HeadingTag>
          {subtitle ? <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-on-surface-variant">{subtitle}</p> : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </button>
      {open ? <div className={depth === 0 ? 'border-t border-[rgba(194,198,209,0.15)] px-4 pb-4 pt-2 md:px-5' : 'border-t border-[rgba(194,198,209,0.12)] px-3 pb-3 pt-2 md:px-4'}>{children}</div> : null}
    </div>
  );
}

export default function Drive() {
  const { scopeKey, clientBelongsToActiveAgency, registerClientIds } = useAgency();
  const [entries, setEntries] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clientSort, setClientSort] = useState('name-asc');
  const [rangeSort, setRangeSort] = useState('range-newest');
  const [viewMode, setViewMode] = useState('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [drivePing, setDrivePing] = useState(() => readDriveReportPing(scopeKey));
  /** @type {null | { phase: 'confirm'|'loading'|'success'|'error', kind: 'run'|'file', run: Record<string, unknown>, file?: Record<string, unknown>, error?: string }} */
  const [deleteModal, setDeleteModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchDriveReports();
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load reports');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const keys = [...new Set(entries.map((e) => e.clientKey).filter(Boolean))].map(String);
    if (keys.length) registerClientIds(keys);
  }, [entries, registerClientIds]);

  useEffect(() => {
    setDrivePing(readDriveReportPing(scopeKey));
  }, [scopeKey]);

  useEffect(() => {
    const onPing = (e) => {
      if (e.detail === null) setDrivePing(null);
      else if (e.detail) setDrivePing(e.detail);
      else setDrivePing(readDriveReportPing(scopeKey));
    };
    window.addEventListener(DRIVE_REPORT_EVENT, onPing);
    return () => window.removeEventListener(DRIVE_REPORT_EVENT, onPing);
  }, [scopeKey]);

  useEffect(() => {
    if (!deleteModal) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [deleteModal]);

  const clients = useMemo(() => {
    const scoped = (Array.isArray(entries) ? entries : []).filter((e) => clientBelongsToActiveAgency(e.clientKey));
    const tree = buildDriveTree(scoped);
    return treeToClientsArray(tree, clientSort, rangeSort);
  }, [entries, clientSort, rangeSort, clientBelongsToActiveAgency]);

  const clientsFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((client) => {
      if (client.clientName.toLowerCase().includes(q) || client.clientKey.toLowerCase().includes(q)) return true;
      return client.rangeList.some((range) => {
        const label = `${formatReportRangeLabel(range.start, range.end)} ${range.start} ${range.end}`.toLowerCase();
        if (label.includes(q)) return true;
        return range.runs.some((run) =>
          (run.files ?? []).some((f) => String(f?.name || '').toLowerCase().includes(q)),
        );
      });
    });
  }, [clients, searchQuery]);

  const openDrive = () => window.open('https://drive.google.com', '_blank', 'noopener,noreferrer');
  const openFileUrl = (url) =>
    window.open(url || 'https://drive.google.com', '_blank', 'noopener,noreferrer');

  const dismissDeleteModal = () => setDeleteModal(null);

  const confirmDelete = async () => {
    let snap = null;
    setDeleteModal((m) => {
      if (!m || m.phase !== 'confirm') return m;
      snap = { kind: m.kind, run: m.run, file: m.file };
      return { ...m, phase: 'loading' };
    });
    if (!snap) return;
    const reportId = snap.run?.id;
    if (!reportId) {
      setDeleteModal((m) =>
        m ? { ...m, phase: 'error', error: 'This entry has no id; refresh the page and try again.' } : m,
      );
      return;
    }
    try {
      if (snap.kind === 'run') {
        await deleteDriveReport(String(reportId));
      } else {
        const files = Array.isArray(snap.run.files) ? snap.run.files : [];
        const remaining = files.filter((f) => f?.name !== snap.file?.name);
        await patchDriveReportFiles(String(reportId), remaining);
      }
      setDeleteModal({ phase: 'success', kind: snap.kind, run: snap.run, file: snap.file });
      await load();
    } catch (e) {
      setDeleteModal({
        phase: 'error',
        kind: snap.kind,
        run: snap.run,
        file: snap.file,
        error: e?.message || 'Delete failed',
      });
    }
  };

  const toggleBtn =
    'rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:text-sm';
  const toggleActive = 'bg-primary text-on-primary';
  const toggleIdle = 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-high/80';

  return (
    <div className="mx-auto max-w-5xl animate-fade-in-down">
      <DriveDeleteModal modal={deleteModal} onDismiss={dismissDeleteModal} onConfirm={confirmDelete} />

      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-primary md:text-4xl">Drive</h1>
          <p className="mt-2 max-w-xl text-sm text-on-surface-variant md:text-base">
            Reports from the database (saved when a report finishes in Report Generator). Open folders to see files.
          </p>
          {loadError ? (
            <p className="mt-3 max-w-xl rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-xs text-amber-950">
              {loadError} Ensure FastAPI is running, Supabase has the <code className="rounded bg-amber-100/80 px-1">generated_reports</code> table (
              <code className="rounded bg-amber-100/80 px-1">Backend/supabase_ui_tables.sql</code>), then refresh.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 rounded-xl border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-5 py-2.5 text-sm font-semibold text-primary shadow-ambient transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={openDrive}
            className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold text-on-primary shadow-ambient transition-[filter] hover:brightness-105"
            style={{ background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }}
          >
            Open Google Drive
          </button>
        </div>
      </header>

      <div className="mb-6 flex flex-col gap-3 rounded-2xl bg-surface-container-low p-4 shadow-ambient sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-xs sm:flex-1">
          <label className="sr-only" htmlFor="drive-search">
            Search drive
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-surface-variant" aria-hidden>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              id="drive-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clients, dates, files…"
              className="w-full rounded-lg border-0 bg-surface-container-high py-2 pl-9 pr-3 text-sm text-on-surface outline-none ring-0 placeholder:text-on-surface-variant/70 focus:ring-2 focus:ring-primary/25"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <label className="flex items-center gap-2 text-xs font-semibold text-on-surface sm:text-sm">
            <span className="text-on-surface-variant">Client sort</span>
            <select
              value={clientSort}
              onChange={(e) => setClientSort(e.target.value)}
              className="rounded-lg border-0 bg-surface-container-high px-3 py-2 text-sm font-medium text-on-surface outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="name-asc">A → Z</option>
              <option value="name-desc">Z → A</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-on-surface sm:text-sm">
            <span className="text-on-surface-variant">Report period</span>
            <select
              value={rangeSort}
              onChange={(e) => setRangeSort(e.target.value)}
              className="rounded-lg border-0 bg-surface-container-high px-3 py-2 text-sm font-medium text-on-surface outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="range-newest">Newest end date first</option>
              <option value="range-oldest">Oldest end date first</option>
            </select>
          </label>
        </div>
        <div className="flex rounded-xl bg-surface-container-high p-1">
          <button
            type="button"
            className={`${toggleBtn} ${viewMode === 'list' ? toggleActive : toggleIdle}`}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`${toggleBtn} ${viewMode === 'cards' ? toggleActive : toggleIdle}`}
            onClick={() => setViewMode('cards')}
          >
            Cards
          </button>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-lowest p-12 text-center shadow-ambient">
          <p className="text-on-surface-variant">Loading reports…</p>
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-lowest p-12 text-center shadow-ambient">
          <p className="text-on-surface-variant">No reports in the database yet. Generate a report from Report Generator.</p>
        </div>
      ) : clientsFiltered.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-lowest p-12 text-center shadow-ambient">
          <p className="text-on-surface-variant">No folders match your search.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clientsFiltered.map((client) => {
            const fileCount = client.rangeList.reduce(
              (n, r) => n + r.runs.reduce((m, run) => m + (run.files?.length ?? 0), 0),
              0,
            );
            const clientPing = Boolean(drivePing && drivePing.clientKey === client.clientKey);
            const newBadge = (
              <span className="flex items-center gap-1.5" title="Recently updated from Report Generator">
                <span className="hidden text-[10px] font-bold uppercase tracking-wide text-amber-700 sm:inline">New</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 shadow-sm ring-2 ring-amber-100" aria-hidden />
              </span>
            );
            return (
              <Disclosure
                key={client.clientKey}
                depth={0}
                defaultOpen={false}
                trailing={clientPing ? newBadge : null}
                icon={
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:rgba(12,68,124,0.08)]">
                    <ClientFolderIcon />
                  </span>
                }
                title={client.clientName}
                subtitle={`${client.rangeList.length} report period${client.rangeList.length === 1 ? '' : 's'} · ${fileCount} file${fileCount === 1 ? '' : 's'}`}
              >
                <div className="ml-1 space-y-3 border-l-2 border-[rgba(12,68,124,0.15)] pl-4 md:ml-2 md:pl-5">
                  {client.rangeList.map((range) => {
                    const rangePing =
                      drivePing &&
                      drivePing.clientKey === client.clientKey &&
                      drivePing.reportRangeStart === range.start &&
                      drivePing.reportRangeEnd === range.end;
                    return (
                    <Disclosure
                      key={`${range.start}-${range.end}`}
                      depth={1}
                      defaultOpen={false}
                      trailing={rangePing ? newBadge : null}
                      icon={<CalendarFolderIcon />}
                      title={`Report date · ${formatReportRangeLabel(range.start, range.end)}`}
                      subtitle={`${range.start} → ${range.end}`}
                    >
                      <div className="space-y-4">
                        {range.runs.map((run) => (
                          <div key={run.id}>
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                                Generated{' '}
                                {run.createdAt
                                  ? new Date(run.createdAt).toLocaleString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </p>
                              <button
                                type="button"
                                onClick={() => setDeleteModal({ phase: 'confirm', kind: 'run', run })}
                                className="shrink-0 rounded-lg border border-red-200/90 bg-red-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-900 transition-colors hover:bg-red-100/90"
                              >
                                Delete report
                              </button>
                            </div>
                            {viewMode === 'list' ? (
                              <div className="space-y-2">
                                {(run.files ?? []).map((f) => (
                                  <FileRow
                                    key={`${run.id}-${f.name}`}
                                    name={f.name}
                                    kind={f.kind}
                                    onOpen={() => openFileUrl(f.driveUrl)}
                                    onRequestDelete={() => setDeleteModal({ phase: 'confirm', kind: 'file', run, file: f })}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {(run.files ?? []).map((f) => (
                                  <FileCard
                                    key={`${run.id}-${f.name}`}
                                    name={f.name}
                                    kind={f.kind}
                                    onOpen={() => openFileUrl(f.driveUrl)}
                                    onRequestDelete={() => setDeleteModal({ phase: 'confirm', kind: 'file', run, file: f })}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </Disclosure>
                    );
                  })}
                </div>
              </Disclosure>
            );
          })}
        </div>
      )}
    </div>
  );
}
