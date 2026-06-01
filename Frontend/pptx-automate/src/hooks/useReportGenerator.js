import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchClients } from '../lib/api';
import {
  collectGeneratedFiles,
  deriveOverallPercent,
  initialReportRange,
  logAutomationOutcome,
  persistDriveReport,
  resolvePrevDates,
} from '../lib/dashboardGenerate';
import { runCliPptBuild } from '../lib/buildCliReport';

/**
 * All report-generation API/state logic for the Dashboard (keeps Dashbaord.jsx UI-only).
 */
export function useReportGenerator({ scopeKey, clientBelongsToActiveAgency, registerClientIds }) {
  const [exportMode, setExportMode] = useState('ppt');
  const [clients, setClients] = useState([]);
  const [clientsLoadError, setClientsLoadError] = useState(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsRetryToken, setClientsRetryToken] = useState(0);
  const [selectedClient, setSelectedClient] = useState('');
  const [generationPhase, setGenerationPhase] = useState('idle');
  const [generationResult, setGenerationResult] = useState(null);
  const [generationError, setGenerationError] = useState(null);
  const [streamLogLines, setStreamLogLines] = useState([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reportStartDate, setReportStartDate] = useState(() => initialReportRange().start);
  const [reportEndDate, setReportEndDate] = useState(() => initialReportRange().end);
  const [reportDatePreset, setReportDatePreset] = useState('custom');
  const [prevManualStart, setPrevManualStart] = useState('');
  const [prevManualEnd, setPrevManualEnd] = useState('');
  const [prevDatePreset, setPrevDatePreset] = useState('custom');
  const [prevDateAuto, setPrevDateAuto] = useState(true);
  const driveSaveDoneRef = useRef(false);

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

  const { prevStartDate, prevEndDate } = useMemo(
    () =>
      resolvePrevDates({
        prevDateAuto,
        reportStartDate,
        reportEndDate,
        prevManualStart,
        prevManualEnd,
      }),
    [prevDateAuto, reportStartDate, reportEndDate, prevManualStart, prevManualEnd],
  );

  const generationParams = useMemo(
    () => ({
      clientId: selectedClient,
      customerIdHint: selectedMeta?.customer_id,
      startDate: reportStartDate,
      endDate: reportEndDate,
      prevDateAuto,
      prevStartDate,
      prevEndDate,
    }),
    [
      selectedClient,
      selectedMeta?.customer_id,
      reportStartDate,
      reportEndDate,
      prevDateAuto,
      prevStartDate,
      prevEndDate,
    ],
  );

  const cliBuildPlan = useMemo(
    () =>
      selectedClient && reportStartDate && reportEndDate
        ? {
            selectedMeta,
            startDate: reportStartDate,
            endDate: reportEndDate,
            prevDateAuto,
            prevManualStart,
            prevManualEnd,
          }
        : null,
    [
      selectedClient,
      selectedMeta,
      reportStartDate,
      reportEndDate,
      prevDateAuto,
      prevManualStart,
      prevManualEnd,
    ],
  );

  const clientName = selectedMeta?.name || selectedClient || 'Client';

  const generatedFiles = useMemo(
    () => collectGeneratedFiles(selectedClient, exportMode, generationResult),
    [selectedClient, exportMode, generationResult],
  );

  const streamOverallPercent = useMemo(() => deriveOverallPercent(streamLogLines), [streamLogLines]);

  const clientsSorted = useMemo(() => {
    const list = Array.isArray(clients) ? clients.filter((c) => clientBelongsToActiveAgency(c.id)) : [];
    list.sort((a, b) => {
      if (Boolean(a.has_config) !== Boolean(b.has_config)) return a.has_config ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
    return list;
  }, [clients, clientBelongsToActiveAgency]);

  const resetPrevRangeToAuto = useCallback(() => {
    setPrevManualStart('');
    setPrevManualEnd('');
    setPrevDatePreset('custom');
    setPrevDateAuto(true);
  }, []);

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
    void persistDriveReport({
      clientKey: selectedClient,
      clientName,
      exportMode,
      generationResult,
      reportStartDate,
      reportEndDate,
      scopeKey,
    });
  }, [
    generationPhase,
    generationResult,
    selectedClient,
    clientName,
    exportMode,
    reportStartDate,
    reportEndDate,
    scopeKey,
  ]);

  const beginGenerationRun = useCallback(() => {
    setGenerationPhase('running');
    setGenerationResult(null);
    setGenerationError(null);
    setStreamLogLines([]);
    setElapsedMs(0);
  }, []);

  const startGeneration = useCallback(async () => {
    if (!selectedClient || !selectedMeta?.has_config) return;
    if (generationPhase === 'running') return;

    beginGenerationRun();

    try {
      const { result, durationMs, logMessage, hasError } = await runCliPptBuild(
        generationParams,
        setStreamLogLines,
      );
      setGenerationResult(result);
      setGenerationPhase('complete');
      void logAutomationOutcome({
        clientKey: selectedClient,
        clientName,
        message: logMessage,
        hasError,
        durationMs,
      });
    } catch (e) {
      setGenerationError(e?.message || 'Request failed');
      setGenerationPhase('error');
      void logAutomationOutcome({
        clientKey: selectedClient,
        clientName,
        message: e?.message || 'Request failed',
        hasError: true,
        durationMs: 0,
        status: 'error',
      });
    }
  }, [
    selectedClient,
    selectedMeta,
    generationPhase,
    beginGenerationRun,
    generationParams,
    clientName,
  ]);

  const closeGenerationModal = useCallback(() => {
    setGenerationPhase('idle');
    setGenerationResult(null);
    setGenerationError(null);
    setStreamLogLines([]);
    setElapsedMs(0);
  }, []);

  const isGenerating = generationPhase === 'running';
  const canGenerate = Boolean(selectedClient && selectedMeta?.has_config && !isGenerating);

  const retryLoadClients = useCallback(() => {
    setClientsRetryToken((t) => t + 1);
  }, []);

  return {
    exportMode,
    setExportMode,
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
  };
}
