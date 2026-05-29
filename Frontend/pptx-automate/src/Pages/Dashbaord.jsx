import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../Layout/layout';
import SessionGuard from '../middleware/SessionGuard';
import { AgencyProvider, useAgency } from '../context/AgencyContext';
import { buildGeneratedFiles } from '../lib/wheelerDrive';
import { DateRangePicker } from '../Components/DatePicker';
import {
  fetchClients,
  postAutomationLog,
  postDriveReport,
  postGenerateAuctionInsightsStream,
  postGenerateStream,
} from '../lib/api';
import { writeDriveReportPing } from '../lib/driveReportPing';

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function deriveOverallPercent(lines) {
  let p = 3;
  for (const line of lines) {
    if (line.downloadPercent != null) p = Math.max(p, 8 + line.downloadPercent * 0.27);
    const t = line.text;
    if (typeof t !== 'string') continue;
    if (t.includes('Downloaded to:')) p = Math.max(p, 36);
    if (t.includes('Data fetched:')) p = Math.max(p, 48);
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

function initialReportRange() {
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

/** Shift a YYYY-MM-DD by N calendar months (clamps to last day of target month). */
function shiftYmdByMonths(value, months) {
  const parts = ymdToParts(value);
  if (!parts) return value;
  const targetMonth = parts.m - 1 + months;
  const target = new Date(parts.y, targetMonth, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(parts.d, lastDay));
  return partsToYmd(target);
}

/** Default previous range = same length as current shifted back 1 month. */
function defaultPrevRange(start, end) {
  return { start: shiftYmdByMonths(start, -1), end: shiftYmdByMonths(end, -1) };
}

/** PPT generate body — omit prev dates in auto mode so backend uses same logic as combined.py. */
function buildPptGenerateBody(clientId, startDate, endDate, prevDateAuto, prevStart, prevEnd) {
  const body = {
    client_id: clientId,
    start_date: startDate,
    end_date: endDate,
    generate_ppt: true,
  };
  if (!prevDateAuto && prevStart && prevEnd) {
    body.prev_start_date = prevStart;
    body.prev_end_date = prevEnd;
  }
  return body;
}

function collectGeneratedFiles(clientKey, exportMode, result) {
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

function GeneratedFileRow({ title, subtitle, chartType, onOpen }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-emerald-300/80 bg-emerald-50/90 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-800"
          aria-hidden
        >
          {chartType === 'bar' ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
          )}
        </span>
        <div className="min-w-0">
          <p className="break-all font-semibold text-emerald-950">{title}</p>
          <p className="mt-0.5 text-sm text-emerald-800/85">{subtitle}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 rounded-lg bg-sky-100 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-sky-200/90"
      >
        Open
      </button>
    </div>
  );
}

function ReportGenerationModal({
  phase,
  clientName,
  clientKey,
  exportMode,
  generationResult,
  errorMessage,
  streamLogLines,
  elapsedMs,
  overallPercent,
  onClose,
  onNewReport,
}) {
  const logEndRef = useRef(null);
  const open = phase === 'running' || phase === 'complete' || phase === 'error';

  const generatedFiles = useMemo(
    () => collectGeneratedFiles(clientKey, exportMode, generationResult),
    [clientKey, exportMode, generationResult],
  );

  const lastHint = useMemo(
    () =>
      streamLogLines.length > 0 ? streamLogLines[streamLogLines.length - 1].text : 'Starting pipeline…',
    [streamLogLines],
  );

  useEffect(() => {
    if (phase !== 'running') return;
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [streamLogLines, phase]);

  if (!open) return null;

  const successHeadline =
    exportMode === 'both'
      ? 'Both files ready'
      : exportMode === 'auction'
        ? 'Auction Insights ready'
        : 'PowerPoint ready';

  const handleViewDrive = () => {
    window.open('https://drive.google.com', '_blank', 'noopener,noreferrer');
  };

  const openFile = (url) => {
    window.open(url || 'https://drive.google.com', '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-gen-title"
    >
      <div
        className="absolute inset-0 bg-[rgba(18,22,30,0.72)] backdrop-blur-md"
        onClick={phase === 'complete' || phase === 'error' ? onClose : undefined}
        aria-hidden={phase !== 'complete' && phase !== 'error'}
      />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl bg-surface-container-lowest shadow-ambient">
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ background: '#003366' }}
        >
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-sky-300/90" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
          </div>
          <h2 id="report-gen-title" className="flex-1 text-center text-sm font-semibold text-on-primary">
            Wheeler — Report Generator
          </h2>
          <span className="w-10" aria-hidden />
        </div>

        {phase === 'complete' ? (
          <div className="px-6 pb-6 pt-6">
            <div className="flex flex-col items-center text-center">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-xl shadow-sm"
                style={{
                  background: 'linear-gradient(180deg, #2d7a3e 0%, #3e6a00 100%)',
                }}
                aria-hidden
              >
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="font-display mt-4 text-xl font-bold text-[#1a2e1f]">{successHeadline}</h3>
              <p className="mt-1 text-sm text-on-surface-variant">Finished on the Wheeler API (Supabase + GA4 + Drive).</p>
            </div>

            {(generationResult?.ppt_error || generationResult?.excel_error) && (
              <div className="mt-4 rounded-lg border border-amber-200/80 bg-amber-50/95 px-3 py-2 text-left text-xs text-amber-950">
                {generationResult?.ppt_error ? <p className="font-medium">PowerPoint: {generationResult.ppt_error}</p> : null}
                {generationResult?.excel_error ? <p className="mt-1 font-medium">Auction Insights: {generationResult.excel_error}</p> : null}
              </div>
            )}

            <div className="mt-8 space-y-3">
              {generatedFiles.map((f) => (
                <GeneratedFileRow
                  key={`${f.kind}-${f.name}`}
                  chartType={f.kind === 'pptx' ? 'bar' : 'line'}
                  title={f.name}
                  subtitle={
                    f.driveUrl
                      ? `${f.label || (f.kind === 'pptx' ? 'PowerPoint' : 'Excel')} — open in Google Drive`
                      : `${f.label || (f.kind === 'pptx' ? 'PowerPoint' : 'Excel')} — open Drive to locate the file`
                  }
                  onOpen={() => openFile(f.driveUrl)}
                />
              ))}
            </div>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={onNewReport}
                className="rounded-xl border border-[rgba(194,198,209,0.6)] bg-surface-container-lowest py-3 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                New report
              </button>
              <button
                type="button"
                onClick={handleViewDrive}
                className="rounded-xl py-3 text-sm font-semibold text-on-primary shadow-ambient transition-[filter] hover:brightness-105"
                style={{ background: '#003366' }}
              >
                View in Drive
              </button>
            </div>
          </div>
        ) : phase === 'error' ? (
          <div className="px-6 pb-6 pt-6">
            <div className="rounded-lg border border-red-200 bg-red-50/95 px-4 py-3 text-sm text-red-950">
              <p className="font-semibold">Could not reach the API</p>
              <p className="mt-2 text-red-900/90">{errorMessage || 'Unknown error'}</p>
              <p className="mt-3 text-xs text-red-900/75">
                Confirm the FastAPI server is running and <code className="rounded bg-red-100/80 px-1">VITE_API_URL</code> points to it.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-xl py-3 text-sm font-semibold text-on-primary shadow-ambient transition-[filter] hover:brightness-105"
              style={{ background: '#003366' }}
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <h3 className="font-display text-lg font-bold text-primary">
                Generating{' '}
                {exportMode === 'both'
                  ? 'PowerPoint + Auction Insights'
                  : exportMode === 'auction'
                    ? 'Auction Insights'
                    : 'PowerPoint'}{' '}
                for {clientName}…
              </h3>
              <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-on-surface-variant">
                <span className="rounded-md bg-surface-container-high px-2 py-1 font-semibold text-primary">
                  Elapsed {formatElapsed(elapsedMs)}
                </span>
              </div>
            </div>

            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${overallPercent}%`,
                  background: 'linear-gradient(90deg, #002E59 0%, #0C447C 100%)',
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-on-surface-variant/90 line-clamp-2" title={lastHint}>
              {lastHint}
            </p>

            <div className="mt-4 max-h-[min(46vh,340px)] overflow-y-auto rounded-lg border border-[rgba(194,198,209,0.2)] bg-[rgba(18,22,30,0.04)] px-3 py-2.5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Server log
              </p>
              <div className="space-y-1 font-mono text-[11px] leading-snug text-on-surface">
                {streamLogLines.length === 0 ? (
                  <p className="text-on-surface-variant/80">Connecting to API…</p>
                ) : (
                  streamLogLines.map((line) => (
                    <p key={line.id} className="whitespace-pre-wrap break-words border-b border-[rgba(194,198,209,0.08)] pb-1 last:border-0">
                      {line.text}
                    </p>
                  ))
                )}
                <span ref={logEndRef} />
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
              Live output from the Wheeler backend (Google Drive download %, Supabase / GA4 fetch, template fill, upload).
              You can leave this open until it finishes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportGeneratorView() {
  const { scopeKey, registerClientIds, clientBelongsToActiveAgency, activeAgency, assignAllKnownClientsToCurrentAgency } =
    useAgency();
  const [exportMode, setExportMode] = useState('both');
  const [clients, setClients] = useState([]);
  const [clientsLoadError, setClientsLoadError] = useState(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsRetryToken, setClientsRetryToken] = useState(0);
  const [selectedClient, setSelectedClient] = useState('');
  const [generationPhase, setGenerationPhase] = useState('idle');
  const [generationResult, setGenerationResult] = useState(null);
  const [generationError, setGenerationError] = useState(null);
  const [streamLogLines, setStreamLogLines] = useState([]);
  const [auctionLoading, setAuctionLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reportStartDate, setReportStartDate] = useState(() => initialReportRange().start);
  const [reportEndDate, setReportEndDate] = useState(() => initialReportRange().end);
  const [reportDatePreset, setReportDatePreset] = useState('custom');
  const [prevManualStart, setPrevManualStart] = useState('');
  const [prevManualEnd, setPrevManualEnd] = useState('');
  const [prevDatePreset, setPrevDatePreset] = useState('custom');
  const [prevDateAuto, setPrevDateAuto] = useState(true);
  const driveSaveDoneRef = useRef(false);
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const clientDropdownRef = useRef(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setClientsLoading(true);
    (async () => {
      try {
        const list = await fetchClients({ retries: 3, timeoutMs: 15000, signal: ctrl.signal });
        if (cancelled) return;
        setClients(Array.isArray(list) ? list : []);
        setClientsLoadError(null);
        if (Array.isArray(list) && list.length > 0) {
          setSelectedClient((prev) => {
            if (prev && list.some((c) => c.id === prev)) return prev;
            const preferred = list.find((c) => c.has_config) || list[0];
            return preferred?.id ?? '';
          });
        }
      } catch (e) {
        if (!cancelled && !ctrl.signal.aborted) {
          setClientsLoadError(e?.message || 'Failed to load clients');
          setClients([]);
        }
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [clientsRetryToken]);

  useEffect(() => {
    if (!clients.length) return;
    registerClientIds(clients.map((c) => c.id));
  }, [clients, registerClientIds]);

  useEffect(() => {
    const scoped = clients.filter((c) => clientBelongsToActiveAgency(c.id));
    if (scoped.length === 0) {
      if (selectedClient) setSelectedClient('');
      return;
    }
    if (!selectedClient || !scoped.some((c) => c.id === selectedClient)) {
      const preferred = scoped.find((c) => c.has_config) || scoped[0];
      setSelectedClient(preferred.id);
    }
  }, [clients, selectedClient, clientBelongsToActiveAgency]);

  const selectedMeta = useMemo(
    () => clients.find((c) => c.id === selectedClient),
    [clients, selectedClient],
  );

  const autoPrevRange = useMemo(
    () => defaultPrevRange(reportStartDate, reportEndDate),
    [reportStartDate, reportEndDate],
  );
  const prevStartDate = prevDateAuto ? autoPrevRange.start : prevManualStart;
  const prevEndDate = prevDateAuto ? autoPrevRange.end : prevManualEnd;

  const resetPrevRangeToAuto = useCallback(() => {
    setPrevManualStart('');
    setPrevManualEnd('');
    setPrevDatePreset('custom');
    setPrevDateAuto(true);
  }, []);

  const clientsSorted = useMemo(() => {
    const list = Array.isArray(clients) ? clients.filter((c) => clientBelongsToActiveAgency(c.id)) : [];
    list.sort((a, b) => {
      if (Boolean(a.has_config) !== Boolean(b.has_config)) return a.has_config ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
    return list;
  }, [clients, clientBelongsToActiveAgency]);

  const clientsDropdownFiltered = useMemo(() => {
    const q = clientSearchQuery.trim().toLowerCase();
    if (!q) return clientsSorted;
    return clientsSorted.filter(
      (c) =>
        String(c.name || '')
          .toLowerCase()
          .includes(q) || String(c.id || '').toLowerCase().includes(q),
    );
  }, [clientsSorted, clientSearchQuery]);

  const clientEnableDisableCounts = useMemo(() => {
    const list = clientsSorted;
    const enabled = list.filter((c) => Boolean(c.has_config)).length;
    const disabled = list.length - enabled;
    return { enabled, disabled, total: list.length };
  }, [clientsSorted]);

  useEffect(() => {
    if (!clientDropdownOpen) return undefined;
    const onDoc = (e) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target)) {
        setClientDropdownOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setClientDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [clientDropdownOpen]);


  const clientName = selectedMeta?.name || selectedClient || 'Client';

  const streamOverallPercent = useMemo(() => deriveOverallPercent(streamLogLines), [streamLogLines]);

  useEffect(() => {
    if (generationPhase !== 'running') return undefined;
    const start = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), 200);
    return () => window.clearInterval(id);
  }, [generationPhase]);

  useEffect(() => {
    if (generationPhase === 'idle') {
      driveSaveDoneRef.current = false;
    }
  }, [generationPhase]);

  useEffect(() => {
    if (generationPhase !== 'complete' || !generationResult || driveSaveDoneRef.current) return;
    driveSaveDoneRef.current = true;
    const folderDate = new Date().toISOString().slice(0, 10);
    const files = collectGeneratedFiles(selectedClient, exportMode, generationResult);
    void postDriveReport({
      folder_date: folderDate,
      report_range_start: reportStartDate,
      report_range_end: reportEndDate,
      client_key: selectedClient,
      client_name: clientName,
      export_mode: exportMode,
      files,
    })
      .then(() => {
        writeDriveReportPing(
          {
            clientKey: selectedClient,
            clientName: clientName,
            reportRangeStart: reportStartDate,
            reportRangeEnd: reportEndDate,
          },
          scopeKey,
        );
      })
      .catch(() => {});
  }, [generationPhase, generationResult, selectedClient, clientName, exportMode, reportStartDate, reportEndDate, scopeKey]);

  const startAuctionInsights = async () => {
    if (!selectedClient || !selectedMeta?.has_config || auctionLoading || isGenerating) return;
    const customerId = selectedMeta?.customer_id || selectedClient;
    const parsed = new Date(`${reportEndDate}T00:00:00`);
    const monthLabel = Number.isNaN(parsed.getTime())
      ? reportEndDate
      : parsed.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    setAuctionLoading(true);
    setGenerationPhase('running');
    setGenerationResult(null);
    setGenerationError(null);
    setStreamLogLines([]);
    setElapsedMs(0);
    const t0 = performance.now();

    const body = {
      customer_id: String(customerId),
      month_label: monthLabel,
      start_date: reportStartDate,
      end_date: reportEndDate,
    };

    try {
      const result = await postGenerateAuctionInsightsStream(body, (ev) => {
        if (ev.event !== 'progress' || !ev.payload) return;
        const p = ev.payload;
        setStreamLogLines((prev) => {
          if (p.kind === 'log' && p.message) {
            return [...prev, { id: `a-${Date.now()}-${prev.length}`, text: p.message }];
          }
          return prev;
        });
      });
      const ms = Math.round(performance.now() - t0);
      setGenerationResult(result);
      setGenerationPhase('complete');
      const hasErr = Boolean(result?.excel_error);
      const msg = result?.excel_error
        ? `Auction error: ${result.excel_error}`
        : result?.excel?.message || 'Auction Insights finished.';
      void postAutomationLog({
        status: hasErr ? 'warning' : 'success',
        client_key: selectedClient,
        client_name: clientName,
        message: msg,
        duration_ms: ms,
      }).catch(() => {});
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      setGenerationError(e?.message || 'Request failed');
      setGenerationPhase('error');
      void postAutomationLog({
        status: 'error',
        client_key: selectedClient,
        client_name: clientName,
        message: e?.message || 'Auction Insights request failed',
        duration_ms: ms,
      }).catch(() => {});
    } finally {
      setAuctionLoading(false);
    }
  };

  const startBothGeneration = async () => {
    if (!selectedClient || !selectedMeta?.has_config || isGenerating || auctionLoading) return;

    setGenerationPhase('running');
    setGenerationResult(null);
    setGenerationError(null);
    setStreamLogLines([]);
    setElapsedMs(0);
    setAuctionLoading(true);
    const t0 = performance.now();

    const customerId = selectedMeta?.customer_id || selectedClient;
    const parsed = new Date(`${reportEndDate}T00:00:00`);
    const monthLabel = Number.isNaN(parsed.getTime())
      ? reportEndDate
      : parsed.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const combined = {};
    let pptFailed = false;

    try {
      const pptBody = buildPptGenerateBody(
        selectedClient,
        reportStartDate,
        reportEndDate,
        prevDateAuto,
        prevStartDate,
        prevEndDate,
      );
      const pptResult = await postGenerateStream(pptBody, (ev) => {
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
      });
      Object.assign(combined, pptResult);
    } catch (e) {
      pptFailed = true;
      combined.ppt_error = e?.message || 'PPT request failed';
      setStreamLogLines((prev) => [
        ...prev,
        { id: `pe-${Date.now()}`, text: `ERROR (PowerPoint): ${combined.ppt_error}` },
      ]);
    }

    setStreamLogLines((prev) => [
      ...prev,
      { id: `sep-${Date.now()}`, text: '— Starting Auction Insights step —' },
    ]);

    try {
      const auctionBody = {
        customer_id: String(customerId),
        month_label: monthLabel,
        start_date: reportStartDate,
        end_date: reportEndDate,
      };
      const auctionResult = await postGenerateAuctionInsightsStream(auctionBody, (ev) => {
        if (ev.event !== 'progress' || !ev.payload) return;
        const p = ev.payload;
        if (p.kind === 'log' && p.message) {
          setStreamLogLines((prev) => [
            ...prev,
            { id: `a-${Date.now()}-${prev.length}`, text: p.message },
          ]);
        }
      });
      if (auctionResult?.excel) combined.excel = auctionResult.excel;
      if (auctionResult?.excel_error) combined.excel_error = auctionResult.excel_error;
    } catch (e) {
      combined.excel_error = e?.message || 'Auction Insights request failed';
      setStreamLogLines((prev) => [
        ...prev,
        { id: `ae-${Date.now()}`, text: `ERROR (Auction Insights): ${combined.excel_error}` },
      ]);
    }

    const ms = Math.round(performance.now() - t0);
    setGenerationResult(combined);

    if (pptFailed && combined.excel_error) {
      setGenerationError(`PPT: ${combined.ppt_error}; Auction: ${combined.excel_error}`);
      setGenerationPhase('error');
    } else {
      setGenerationPhase('complete');
    }

    const parts = [];
    parts.push(
      combined.ppt_error
        ? `PPT error: ${combined.ppt_error}`
        : combined.ppt
          ? 'PPT uploaded.'
          : 'PPT not returned.',
    );
    parts.push(
      combined.excel_error
        ? `Auction error: ${combined.excel_error}`
        : combined.excel?.message || 'Auction Insights finished.',
    );
    const hasErr = Boolean(combined.ppt_error || combined.excel_error);
    void postAutomationLog({
      status: hasErr ? 'warning' : 'success',
      client_key: selectedClient,
      client_name: clientName,
      message: parts.join(' '),
      duration_ms: ms,
    }).catch(() => {});

    setAuctionLoading(false);
  };

  const startGeneration = async () => {
    if (!selectedClient) return;
    if (!selectedMeta?.has_config) return;

    setGenerationPhase('running');
    setGenerationResult(null);
    setGenerationError(null);
    setStreamLogLines([]);
    setElapsedMs(0);
    const t0 = performance.now();

    const body = buildPptGenerateBody(
      selectedClient,
      reportStartDate,
      reportEndDate,
      prevDateAuto,
      prevStartDate,
      prevEndDate,
    );

    try {
      const result = await postGenerateStream(body, (ev) => {
        if (ev.event !== 'progress' || !ev.payload) return;
        const p = ev.payload;
        setStreamLogLines((prev) => {
          if (p.kind === 'download') {
            const msg = p.message ?? `Downloading... ${p.percent ?? 0}%`;
            const last = prev[prev.length - 1];
            if (last?.isDownload) {
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  text: msg,
                  downloadPercent: p.percent ?? last.downloadPercent,
                },
              ];
            }
            return [
              ...prev,
              {
                id: `dl-${Date.now()}`,
                text: msg,
                downloadPercent: p.percent,
                isDownload: true,
              },
            ];
          }
          if (p.kind === 'log' && p.message) {
            return [...prev, { id: `l-${Date.now()}-${prev.length}`, text: p.message }];
          }
          return prev;
        });
      });
      const ms = Math.round(performance.now() - t0);
      setGenerationResult(result);
      setGenerationPhase('complete');

      const parts = [];
      if (body.generate_ppt) {
        parts.push(result.ppt_error ? `PPT error: ${result.ppt_error}` : result.ppt ? 'PPT uploaded.' : 'PPT not returned.');
      }
      const hasErr = Boolean(result.ppt_error);
      void postAutomationLog({
        status: hasErr ? 'warning' : 'success',
        client_key: selectedClient,
        client_name: clientName,
        message: parts.join(' '),
        duration_ms: ms,
      }).catch(() => {});
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      setGenerationError(e?.message || 'Request failed');
      setGenerationPhase('error');
      void postAutomationLog({
        status: 'error',
        client_key: selectedClient,
        client_name: clientName,
        message: e?.message || 'Request failed',
        duration_ms: ms,
      }).catch(() => {});
    }
  };

  const closeGenerationModal = () => {
    setGenerationPhase('idle');
    setGenerationResult(null);
    setGenerationError(null);
    setStreamLogLines([]);
    setElapsedMs(0);
  };

  const isGenerating = generationPhase === 'running';
  const canGenerate = Boolean(selectedClient && selectedMeta?.has_config && !isGenerating && !auctionLoading);

  useEffect(() => {
    if (isGenerating) setClientDropdownOpen(false);
  }, [isGenerating]);

  useEffect(() => {
    if (!clientDropdownOpen) setClientSearchQuery('');
  }, [clientDropdownOpen]);

  return (
    <div className="mx-auto max-w-6xl animate-fade-in-down">
      <ReportGenerationModal
        phase={generationPhase}
        clientName={clientName}
        clientKey={selectedClient}
        exportMode={exportMode}
        generationResult={generationResult}
        errorMessage={generationError}
        streamLogLines={streamLogLines}
        elapsedMs={elapsedMs}
        overallPercent={streamOverallPercent}
        onClose={closeGenerationModal}
        onNewReport={closeGenerationModal}
      />
      
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary md:text-4xl">Report Generator</h1>
        <p className="mt-2 max-w-2xl text-sm text-on-surface-variant md:text-base">
          Configure client scope, date range, and export format to generate marketing performance reports.
        </p>
        {clientsLoadError ? (
          <div className="mt-4 flex max-w-2xl flex-col gap-2 rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0">
              Could not load clients from the API ({clientsLoadError}). Using an empty list; check{' '}
              <code className="rounded bg-amber-100/80 px-1 text-xs">VITE_API_URL</code> and that FastAPI is running.
            </p>
            <button
              type="button"
              onClick={() => setClientsRetryToken((t) => t + 1)}
              disabled={clientsLoading}
              className="shrink-0 rounded-lg border border-amber-300 bg-amber-100/80 px-3 py-1.5 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {clientsLoading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : null}
      </header>

      <div className="mt-8 rounded-2xl bg-surface-container-lowest p-6 shadow-ambient md:p-8">
        <div className="space-y-10">
          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Report generation
            </h2>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
              <div className="min-w-0 flex-1">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant" htmlFor="client-select-trigger">
                  Client
                </label>
                <div ref={clientDropdownRef} className="relative">
                  <button
                    id="client-select-trigger"
                    type="button"
                    disabled={isGenerating || clients.length === 0}
                    aria-expanded={clientDropdownOpen}
                    aria-haspopup="listbox"
                    onClick={() => !isGenerating && clients.length > 0 && setClientDropdownOpen((o) => !o)}
                    className="relative flex w-full items-center rounded-xl border-0 bg-surface-container-high py-3.5 pl-11 pr-10 text-left text-sm font-medium text-on-surface outline-none ring-0 transition-[box-shadow] hover:bg-surface-container-high/90 focus:ring-2 focus:ring-primary/25 disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-surface-variant">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                        />
                      </svg>
                    </span>
                    <span className="block min-w-0 flex-1 truncate pl-0.5">
                      {clients.length === 0 ? (
                        'No clients loaded'
                      ) : (
                        <>
                          <span className={selectedMeta?.has_config ? 'text-emerald-800' : 'text-red-800'}>{clientName}</span>
                          {selectedMeta && !selectedMeta.has_config ? (
                            <span className="text-on-surface-variant"> — needs Drive config</span>
                          ) : null}
                        </>
                      )}
                    </span>
                    <span
                      className={`pointer-events-none absolute inset-y-0 right-3 flex items-center text-on-surface-variant transition-transform ${clientDropdownOpen ? 'rotate-180' : ''}`}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </button>

                  {clientDropdownOpen && clients.length > 0 ? (
                    <div
                      className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[rgba(194,198,209,0.35)] bg-surface-container-lowest shadow-ambient"
                      role="presentation"
                    >
                      <div className="border-b border-[rgba(194,198,209,0.2)] p-2">
                        <label className="sr-only" htmlFor="client-dropdown-search">
                          Search dealers
                        </label>
                        <input
                          id="client-dropdown-search"
                          type="search"
                          value={clientSearchQuery}
                          onChange={(e) => setClientSearchQuery(e.target.value)}
                          placeholder="Search dealers…"
                          className="w-full rounded-lg border-0 bg-surface-container-high px-3 py-2 text-sm text-on-surface outline-none ring-0 placeholder:text-on-surface-variant/70 focus:ring-2 focus:ring-primary/25"
                          autoComplete="off"
                        />
                      </div>
                      <ul className="max-h-52 overflow-y-auto py-1" role="listbox" aria-labelledby="client-select-trigger">
                        {clientsDropdownFiltered.length === 0 ? (
                          <li className="px-3 py-4 text-center text-sm text-on-surface-variant" role="presentation">
                            No dealers match your search.
                          </li>
                        ) : (
                          clientsDropdownFiltered.map((c) => (
                            <li key={c.id} role="presentation">
                              <button
                                type="button"
                                role="option"
                                aria-selected={c.id === selectedClient}
                                onClick={() => {
                                  setSelectedClient(c.id);
                                  setClientDropdownOpen(false);
                                }}
                                className={[
                                  'flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm transition-colors',
                                  c.has_config
                                    ? 'text-emerald-900 hover:bg-emerald-50/95'
                                    : 'text-red-900 hover:bg-red-50/95',
                                  c.id === selectedClient ? (c.has_config ? 'bg-emerald-100/70' : 'bg-red-100/70') : '',
                                ].join(' ')}
                              >
                                <span className="font-medium">{c.name}</span>
                                <span
                                  className={`text-[11px] font-semibold uppercase tracking-wide ${c.has_config ? 'text-emerald-700' : 'text-red-700'}`}
                                >
                                  {c.has_config ? 'Enable client' : 'Needs Drive config'}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  <span
                    className="font-semibold text-emerald-700"
                    title="Clients with template_drive_id and output_file_drive_id in Supabase"
                  >
                    ● Enabled:{' '}
                    <span className="tabular-nums font-bold text-on-surface">{clientEnableDisableCounts.enabled}</span>
                  </span>
                  <span
                    className="font-semibold text-red-600"
                    title="Clients missing one or both Drive IDs — configure on Dealer configuration"
                  >
                    ● Disabled:{' '}
                    <span className="tabular-nums font-bold text-on-surface">{clientEnableDisableCounts.disabled}</span>
                  </span>
                  {clientEnableDisableCounts.total > 0 ? (
                    <span className="text-on-surface-variant">({clientEnableDisableCounts.total} total)</span>
                  ) : null}
                </div>
                {clients.length > 0 && clientsSorted.length === 0 && !clientsLoadError ? (
                  <div className="mt-3 rounded-lg border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-xs text-sky-950">
                    <p className="font-semibold text-primary">No clients linked to “{activeAgency.name}”</p>
                    <p className="mt-1 text-on-surface-variant">
                      API clients are assigned per agency. Link every loaded client to this agency, or switch agency in the
                      sidebar.
                    </p>
                    <button
                      type="button"
                      onClick={() => assignAllKnownClientsToCurrentAgency()}
                      className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:brightness-105"
                    >
                      Link all API clients to {activeAgency.name}
                    </button>
                  </div>
                ) : null}
                {selectedMeta && !selectedMeta.has_config ? (
                  <p className="mt-2 text-xs text-amber-900/90">
                    This account needs Drive IDs in Supabase. Set{' '}
                    <code className="rounded bg-surface-container-high px-1">template_drive_id</code> and{' '}
                    <code className="rounded bg-surface-container-high px-1">output_file_drive_id</code> on the{' '}
                    <Link to="/dashboard/config-dealer" className="font-semibold text-primary underline-offset-2 hover:underline">
                      Dealer configuration
                    </Link>{' '}
                    page before generating.
                  </p>
                ) : null}
              </div>

              <div className="min-w-0 flex-1 space-y-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                    Date selection (current period)
                  </p>
                  <DateRangePicker
                    preset={reportDatePreset}
                    dateFrom={reportStartDate}
                    dateTo={reportEndDate}
                    compareOn={false}
                    compareFrom=""
                    compareTo=""
                    disabled={isGenerating}
                    variant="dashboard"
                    onApply={(payload) => {
                      setReportDatePreset(payload.preset);
                      if (payload.dateFrom && payload.dateTo) {
                        setReportStartDate(payload.dateFrom);
                        setReportEndDate(payload.dateTo);
                      }
                    }}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                      Previous period {prevDateAuto ? <span className="ml-1 normal-case text-on-surface-variant/70">(auto-shifted 1 month back)</span> : null}
                    </p>
                    {!prevDateAuto ? (
                      <button
                        type="button"
                        onClick={resetPrevRangeToAuto}
                        disabled={isGenerating}
                        className="rounded-lg border border-[rgba(194,198,209,0.45)] bg-surface-container-lowest px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
                      >
                        Reset to auto
                      </button>
                    ) : null}
                  </div>
                  <DateRangePicker
                    preset={prevDatePreset}
                    dateFrom={prevStartDate}
                    dateTo={prevEndDate}
                    compareOn={false}
                    compareFrom=""
                    compareTo=""
                    disabled={isGenerating}
                    variant="dashboard"
                    onApply={(payload) => {
                      setPrevDatePreset(payload.preset);
                      if (payload.dateFrom && payload.dateTo) {
                        setPrevManualStart(payload.dateFrom);
                        setPrevManualEnd(payload.dateTo);
                        setPrevDateAuto(false);
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Export format</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setExportMode('ppt')}
                disabled={isGenerating || auctionLoading}
                className={[
                  'rounded-xl px-4 py-4 text-left transition-colors disabled:pointer-events-none disabled:opacity-50',
                  exportMode === 'ppt'
                    ? 'bg-[color:rgba(12,68,124,0.08)] ring-2 ring-primary/20'
                    : 'bg-surface-container-high hover:bg-surface-container-low',
                ].join(' ')}
              >
                <p className="text-sm font-semibold text-on-surface">PPT</p>
                <p className="mt-1 text-xs text-on-surface-variant">Generate PowerPoint report.</p>
              </button>
              <button
                type="button"
                onClick={() => setExportMode('auction')}
                disabled={isGenerating || auctionLoading}
                className={[
                  'rounded-xl px-4 py-4 text-left transition-colors disabled:pointer-events-none disabled:opacity-50',
                  exportMode === 'auction'
                    ? 'bg-[color:rgba(12,68,124,0.08)] ring-2 ring-primary/20'
                    : 'bg-surface-container-high hover:bg-surface-container-low',
                ].join(' ')}
              >
                <p className="text-sm font-semibold text-on-surface">Auction Insights</p>
                <p className="mt-1 text-xs text-on-surface-variant">Generate Auction Insights Excel report.</p>
              </button>
              <button
                type="button"
                onClick={() => setExportMode('both')}
                disabled={isGenerating || auctionLoading}
                className={[
                  'relative rounded-xl px-4 py-4 text-left transition-[filter,colors] disabled:pointer-events-none disabled:opacity-50',
                  exportMode === 'both'
                    ? 'text-on-primary shadow-ambient hover:brightness-105'
                    : 'bg-surface-container-high text-on-surface hover:bg-surface-container-low',
                ].join(' ')}
                style={
                  exportMode === 'both'
                    ? { background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }
                    : undefined
                }
              >
                <span className="absolute right-3 top-3 rounded-md bg-on-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-primary">
                  Recommended
                </span>
                <p className="text-sm font-semibold">Both</p>
                <p
                  className={[
                    'mt-1 text-xs',
                    exportMode === 'both' ? 'text-on-primary/80' : 'text-on-surface-variant',
                  ].join(' ')}
                >
                  Generate PowerPoint + Auction Insights together.
                </p>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-end border-t border-[rgba(194,198,209,0.15)] pt-8">
          <button
            type="button"
            onClick={
              exportMode === 'both'
                ? startBothGeneration
                : exportMode === 'auction'
                  ? startAuctionInsights
                  : startGeneration
            }
            disabled={!canGenerate}
            className="rounded-xl px-8 py-3 text-sm font-semibold text-on-primary shadow-ambient transition-[filter,transform] hover:brightness-105 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }}
          >
            {isGenerating || auctionLoading
              ? 'Generating…'
              : exportMode === 'both'
                ? 'Generate both'
                : exportMode === 'auction'
                  ? 'Generate auction insights'
                  : 'Generate report'}
          </button>
        </div>
      </div>

      
    </div>
  );
}

export function SuitePlaceholder({ title, subtitle }) {
  return (
    <div className="mx-auto max-w-2xl animate-fade-in-down py-12 text-center">
      <h1 className="font-display text-3xl font-bold text-primary">{title}</h1>
      <p className="mt-3 text-on-surface-variant">{subtitle}</p>
      <div className="mt-10 rounded-2xl bg-surface-container-lowest p-10 shadow-ambient">
        <p className="text-sm text-on-surface-variant">This section is ready for your workflows.</p>
      </div>
    </div>
  );
}

export default function Dashbaord() {
  return (
    <AgencyProvider>
      <SessionGuard>
        <Layout />
      </SessionGuard>
    </AgencyProvider>
  );
}
