import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../Layout/layout';
import SessionGuard from '../middleware/SessionGuard';
import { AgencyProvider, useAgency } from '../context/AgencyContext';
import { DateRangePicker } from '../Components/DatePicker';
import { formatElapsed } from '../lib/dashboardGenerate';
import { describeCliBuildPlan, parseGa4TotalsFromLogs, runCliPptBuild } from '../lib/buildCliReport';
import { useReportGenerator } from '../hooks/useReportGenerator';

export { buildCliPptRequest, describeCliBuildPlan, parseGa4TotalsFromLogs, runCliPptBuild } from '../lib/buildCliReport';

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
  generationResult,
  generatedFiles,
  errorMessage,
  streamLogLines,
  elapsedMs,
  overallPercent,
  onClose,
  onNewReport,
}) {
  const logEndRef = useRef(null);
  const open = phase === 'running' || phase === 'complete' || phase === 'error';

  const lastHint = useMemo(
    () => (streamLogLines.length > 0 ? streamLogLines[streamLogLines.length - 1].text : 'Starting…'),
    [streamLogLines],
  );

  const ga4TotalsLine = useMemo(
    () => streamLogLines.find((l) => typeof l.text === 'string' && l.text.includes('GA4 totals:')),
    [streamLogLines],
  );

  useEffect(() => {
    if (phase !== 'running') return;
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [streamLogLines, phase]);

  if (!open) return null;

  const openFile = (url) => {
    window.open(url || 'https://drive.google.com', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-[rgba(18,22,30,0.72)] backdrop-blur-md"
        onClick={phase === 'complete' || phase === 'error' ? onClose : undefined}
        aria-hidden={phase !== 'complete' && phase !== 'error'}
      />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl bg-surface-container-lowest shadow-ambient">
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: '#003366' }}>
          <h2 className="flex-1 text-center text-sm font-semibold text-on-primary">PowerPoint generation</h2>
        </div>

        {phase === 'complete' ? (
          <div className="px-6 pb-6 pt-6">
            <div className="flex flex-col items-center text-center">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-xl shadow-sm"
                style={{ background: 'linear-gradient(180deg, #2d7a3e 0%, #3e6a00 100%)' }}
              >
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="font-display mt-4 text-xl font-bold text-[#1a2e1f]">PowerPoint ready</h3>
              <p className="mt-1 text-sm text-on-surface-variant">
                Same pipeline as <code className="rounded bg-surface-container-high px-1">combined.py</code> +{' '}
                <code className="rounded bg-surface-container-high px-1">pptx_fill.py</code>
              </p>
            </div>

            {ga4TotalsLine ? (
              <p className="mt-4 rounded-lg bg-surface-container-high px-3 py-2 text-center text-xs font-mono text-on-surface">
                {ga4TotalsLine.text}
              </p>
            ) : null}

            {generationResult?.ppt_error ? (
              <div className="mt-4 rounded-lg border border-amber-200/80 bg-amber-50/95 px-3 py-2 text-left text-xs text-amber-950">
                <p className="font-medium">PowerPoint: {generationResult.ppt_error}</p>
              </div>
            ) : null}

            <div className="mt-8 space-y-3">
              {generatedFiles.map((f) => (
                <GeneratedFileRow
                  key={`${f.kind}-${f.name}`}
                  chartType="bar"
                  title={f.name}
                  subtitle={
                    f.driveUrl
                      ? 'PowerPoint deck — open in Google Drive'
                      : 'PowerPoint deck — open Drive to locate the file'
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
                onClick={() => openFile(generatedFiles[0]?.driveUrl)}
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
              <p className="font-semibold">Generation failed</p>
              <p className="mt-2 text-red-900/90">{errorMessage || 'Unknown error'}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-xl py-3 text-sm font-semibold text-on-primary"
              style={{ background: '#003366' }}
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <h3 className="font-display text-lg font-bold text-primary">Generating PowerPoint for {clientName}…</h3>
              <span className="rounded-md bg-surface-container-high px-2 py-1 font-mono text-xs font-semibold text-primary">
                Elapsed {formatElapsed(elapsedMs)}
              </span>
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
                Backend log (combined.py → pptx_fill.py)
              </p>
              <div className="space-y-1 font-mono text-[11px] leading-snug text-on-surface">
                {streamLogLines.length === 0 ? (
                  <p className="text-on-surface-variant/80">Connecting to API…</p>
                ) : (
                  streamLogLines.map((line) => (
                    <p
                      key={line.id}
                      className={`whitespace-pre-wrap break-words border-b border-[rgba(194,198,209,0.08)] pb-1 last:border-0 ${
                        line.text.includes('GA4 totals:') ? 'font-semibold text-primary' : ''
                      } ${line.text.includes('ERROR') ? 'text-red-800' : ''} ${line.text.includes('WARNING') ? 'text-amber-800' : ''}`}
                    >
                      {line.text}
                    </p>
                  ))
                )}
                <span ref={logEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Report generator — PPT only, same backend path as combined.py + pptx_fill.py */
export function ReportGeneratorView() {
  const { scopeKey, registerClientIds, clientBelongsToActiveAgency, activeAgency, assignAllKnownClientsToCurrentAgency } =
    useAgency();

  const {
    clients,
    clientsLoadError,
    clientsLoading,
    selectedClient,
    setSelectedClient,
    generationPhase,
    generationResult,
    generationError,
    streamLogLines,
    elapsedMs,
    reportStartDate,
    setReportStartDate,
    reportEndDate,
    setReportEndDate,
    reportDatePreset,
    setReportDatePreset,
    prevManualStart,
    setPrevManualStart,
    prevManualEnd,
    setPrevManualEnd,
    prevDatePreset,
    setPrevDatePreset,
    prevDateAuto,
    setPrevDateAuto,
    prevStartDate,
    prevEndDate,
    selectedMeta,
    clientName,
    generatedFiles,
    streamOverallPercent,
    clientsSorted,
    cliBuildPlan,
    resetPrevRangeToAuto,
    startGeneration,
    closeGenerationModal,
    isGenerating,
    canGenerate,
    retryLoadClients,
  } = useReportGenerator({ scopeKey, clientBelongsToActiveAgency, registerClientIds });

  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const clientDropdownRef = useRef(null);

  const clientsDropdownFiltered = useMemo(() => {
    const q = clientSearchQuery.trim().toLowerCase();
    if (!q) return clientsSorted;
    return clientsSorted.filter(
      (c) =>
        String(c.name || '').toLowerCase().includes(q) || String(c.id || '').toLowerCase().includes(q),
    );
  }, [clientsSorted, clientSearchQuery]);

  const clientEnableDisableCounts = useMemo(() => {
    const enabled = clientsSorted.filter((c) => Boolean(c.has_config)).length;
    return { enabled, disabled: clientsSorted.length - enabled, total: clientsSorted.length };
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

  useEffect(() => {
    if (isGenerating) setClientDropdownOpen(false);
  }, [isGenerating]);

  useEffect(() => {
    if (!clientDropdownOpen) setClientSearchQuery('');
  }, [clientDropdownOpen]);

  const cliPlan = useMemo(() => {
    if (!cliBuildPlan) return null;
    return describeCliBuildPlan(cliBuildPlan);
  }, [cliBuildPlan]);

  return (
    <div className="mx-auto max-w-6xl animate-fade-in-down">
      <ReportGenerationModal
        phase={generationPhase}
        clientName={clientName}
        generationResult={generationResult}
        generatedFiles={generatedFiles}
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
          Generate PowerPoint reports using the same <code className="rounded bg-surface-container-high px-1">build_full_data()</code> pipeline as the backend CLI.
        </p>
        {clientsLoadError ? (
          <div className="mt-4 flex max-w-2xl flex-col gap-2 rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0">
              Could not load clients ({clientsLoadError}). Check{' '}
              <code className="rounded bg-amber-100/80 px-1 text-xs">VITE_API_URL</code> and FastAPI.
            </p>
            <button
              type="button"
              onClick={retryLoadClients}
              disabled={clientsLoading}
              className="shrink-0 rounded-lg border border-amber-300 bg-amber-100/80 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-200 disabled:opacity-50"
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
                    disabled={isGenerating || clientsLoading || clients.length === 0}
                    aria-expanded={clientDropdownOpen}
                    aria-haspopup="listbox"
                    onClick={() => !isGenerating && clients.length > 0 && setClientDropdownOpen((o) => !o)}
                    className="relative flex w-full items-center rounded-xl border-0 bg-surface-container-high py-3.5 pl-11 pr-10 text-left text-sm font-medium text-on-surface outline-none ring-0 hover:bg-surface-container-high/90 focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
                  >
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-surface-variant">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </span>
                    <span className="block min-w-0 flex-1 truncate pl-0.5">
                      {clientsLoading ? (
                        'Loading clients…'
                      ) : clients.length === 0 ? (
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
                    <span className={`pointer-events-none absolute inset-y-0 right-3 flex items-center transition-transform ${clientDropdownOpen ? 'rotate-180' : ''}`}>
                      <svg className="h-4 w-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </button>

                  {clientDropdownOpen && clients.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[rgba(194,198,209,0.35)] bg-surface-container-lowest shadow-ambient">
                      <div className="border-b border-[rgba(194,198,209,0.2)] p-2">
                        <input
                          id="client-dropdown-search"
                          type="search"
                          value={clientSearchQuery}
                          onChange={(e) => setClientSearchQuery(e.target.value)}
                          placeholder="Search dealers…"
                          className="w-full rounded-lg border-0 bg-surface-container-high px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                          autoComplete="off"
                        />
                      </div>
                      <ul className="max-h-52 overflow-y-auto py-1" role="listbox">
                        {clientsDropdownFiltered.length === 0 ? (
                          <li className="px-3 py-4 text-center text-sm text-on-surface-variant">No dealers match your search.</li>
                        ) : (
                          clientsDropdownFiltered.map((c) => (
                            <li key={c.id}>
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
                                  c.has_config ? 'text-emerald-900 hover:bg-emerald-50/95' : 'text-red-900 hover:bg-red-50/95',
                                  c.id === selectedClient ? (c.has_config ? 'bg-emerald-100/70' : 'bg-red-100/70') : '',
                                ].join(' ')}
                              >
                                <span className="font-medium">{c.name}</span>
                                <span className={`text-[11px] font-semibold uppercase ${c.has_config ? 'text-emerald-700' : 'text-red-700'}`}>
                                  {c.has_config ? 'Ready' : 'Needs Drive config'}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 text-[11px]">
                  <span className="font-semibold text-emerald-700">
                    ● Enabled: <span className="tabular-nums font-bold text-on-surface">{clientEnableDisableCounts.enabled}</span>
                  </span>
                  <span className="font-semibold text-red-600">
                    ● Disabled: <span className="tabular-nums font-bold text-on-surface">{clientEnableDisableCounts.disabled}</span>
                  </span>
                </div>

                {clients.length > 0 && clientsSorted.length === 0 && !clientsLoadError ? (
                  <div className="mt-3 rounded-lg border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-xs text-sky-950">
                    <p className="font-semibold text-primary">No clients linked to “{activeAgency.name}”</p>
                    <button
                      type="button"
                      onClick={() => assignAllKnownClientsToCurrentAgency()}
                      className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary"
                    >
                      Link all API clients to {activeAgency.name}
                    </button>
                  </div>
                ) : null}

                {selectedMeta && !selectedMeta.has_config ? (
                  <p className="mt-2 text-xs text-amber-900/90">
                    Configure Drive IDs on{' '}
                    <Link to="/dashboard/config-dealer" className="font-semibold text-primary underline-offset-2 hover:underline">
                      Dealer configuration
                    </Link>
                    .
                  </p>
                ) : null}
              </div>

              <div className="min-w-0 flex-1 space-y-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                    Current period
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
                      Previous period{' '}
                      {prevDateAuto ? (
                        <span className="normal-case text-on-surface-variant/70">(auto — same as combined.py)</span>
                      ) : null}
                    </p>
                    {!prevDateAuto ? (
                      <button type="button" onClick={resetPrevRangeToAuto} disabled={isGenerating} className="text-[11px] font-semibold text-primary">
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

          {cliPlan ? (
            <div className="rounded-xl border border-[rgba(194,198,209,0.25)] bg-surface-container-high/40 px-4 py-3 text-xs text-on-surface-variant">
              <p className="font-semibold text-on-surface">CLI build plan (combined.py → pptx_fill.py)</p>
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-on-surface">
                <li>API: {cliPlan.apiBase}/generate-stream</li>
                <li>Dealer: {cliPlan.dealerName}</li>
                <li>client_id: {cliPlan.requestBody.client_id}</li>
                <li>DB customer_id: {cliPlan.customerIdHint} (resolved on server — not sent in POST)</li>
                <li>Current: {cliPlan.currentRange}</li>
                <li>Previous: {cliPlan.previousRange}</li>
                <li>Month label: {cliPlan.monthLabel}</li>
              </ul>
              <p className="mt-2 text-[10px] text-on-surface-variant/90">
                Pipeline: {cliPlan.pipeline.join(' → ')}
              </p>
            </div>
          ) : null}

          <div className="rounded-xl border border-[rgba(194,198,209,0.25)] bg-surface-container-high/40 px-4 py-3 text-xs text-on-surface-variant">
            <p className="font-semibold text-on-surface">Export format</p>
            <p className="mt-1">
              PowerPoint only — <code className="rounded bg-surface-container-high px-1">runCliPptBuild()</code> calls the same backend path as{' '}
              <code className="rounded bg-surface-container-high px-1">python combined.py</code> +{' '}
              <code className="rounded bg-surface-container-high px-1">python pptx_fill.py</code>.
            </p>
            <p className="mt-1 text-on-surface-variant/80">Auction Insights is temporarily disabled.</p>
          </div>
        </div>

        <div className="mt-10 flex justify-end border-t border-[rgba(194,198,209,0.15)] pt-8">
          <button
            type="button"
            onClick={startGeneration}
            disabled={!canGenerate}
            className="rounded-xl px-8 py-3 text-sm font-semibold text-on-primary shadow-ambient transition-[filter,transform] hover:brightness-105 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)' }}
          >
            {isGenerating ? 'Building report…' : 'Build PowerPoint (CLI)'}
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
