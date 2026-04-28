import React, { useState, useRef, useEffect, useCallback } from 'react';

const PRESETS = [
  { label: 'Today', key: 'today' },
  { label: 'Yesterday', key: 'yesterday' },
  { label: 'Last 7 Days', key: 'last7' },
  { label: 'Last 30 Days', key: 'last30' },
  { label: 'This Month', key: 'this_month' },
  { label: 'Last Month', key: 'last_month' },
];

const DASHBOARD_PRESETS = [
  { label: 'Today', key: 'today' },
  { label: 'Yesterday', key: 'yesterday' },
  { label: 'Last 7 days', key: 'last7' },
  { label: 'Last 30 days', key: 'last30' },
  { label: 'This month', key: 'this_month' },
  { label: 'Last month', key: 'last_month' },
];

function isoStr(date) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseISO(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatShort(date) {
  if (!date) return 'Select date range';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolvePreset(key) {
  const today = startOfDay(new Date());
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'last30': return { from: addDays(today, -29), to: today };
    case 'this_month': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case 'last_month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: first, to: last };
    }
    default: return null;
  }
}

export function DateRangePicker({
  preset,
  dateFrom,
  dateTo,
  compareOn,
  compareFrom,
  compareTo,
  onApply,
  disabled,
  verticalLayout = false,
  variant = 'default',
}) {
  const presetList = variant === 'dashboard' ? DASHBOARD_PRESETS : PRESETS;
  const containerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(preset || 'last30');
  const [fromDate, setFromDate] = useState(parseISO(dateFrom));
  const [toDate, setToDate] = useState(parseISO(dateTo));
  const [compareEnabled, setCompareEnabled] = useState(compareOn || false);

  useEffect(() => {
    setSelectedPreset(preset || 'last30');
    setFromDate(parseISO(dateFrom));
    setToDate(parseISO(dateTo));
    setCompareEnabled(compareOn || false);
  }, [preset, dateFrom, dateTo, compareOn]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  }, [disabled]);

  const handlePresetClick = useCallback((key) => {
    const range = resolvePreset(key);
    setSelectedPreset(key);
    if (range) {
      setFromDate(range.from);
      setToDate(range.to);
    }
  }, []);

  const handleApply = useCallback(() => {
    onApply({
      preset: selectedPreset,
      dateFrom: isoStr(fromDate),
      dateTo: isoStr(toDate),
      compareOn: compareEnabled,
      compareFrom: compareFrom || '',
      compareTo: compareTo || '',
    });
    setIsOpen(false);
  }, [compareEnabled, compareFrom, compareTo, fromDate, onApply, selectedPreset, toDate]);

  const displayLabel = fromDate && toDate
    ? `${formatShort(fromDate)} → ${formatShort(toDate)}`
    : 'Select a date range';

  const todayISO = isoStr(new Date());

  return (
    <div ref={containerRef} className={`relative ${verticalLayout ? 'w-full' : 'w-full'} max-w-full`}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-3 rounded-3xl border px-4 py-3 text-left text-sm font-semibold transition ${disabled ? 'cursor-not-allowed bg-surface-container-low opacity-70' : 'bg-surface-container-high shadow-sm hover:border-primary/30 hover:bg-surface-container-low'}`}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900/10 to-sky-500/15 text-sky-700 shadow-sm">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M5 11h14M5 19h14M5 15h14" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-on-surface-variant">Date range</p>
            <p className="mt-1 truncate text-sm text-on-surface">{displayLabel}</p>
          </div>
        </div>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-container-low text-on-surface-variant">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 z-40 mt-3 w-full min-w-[18rem] max-w-[28rem]">
          <div className="overflow-hidden rounded-3xl border border-[rgba(194,198,209,0.28)] bg-surface-container-lowest shadow-ambient">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {presetList.slice(0, 6).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handlePresetClick(item.key)}
                  className={`rounded-2xl px-3 py-2 text-left text-sm font-semibold transition ${selectedPreset === item.key ? 'bg-sky-600/10 text-sky-800 ring-1 ring-sky-300' : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="border-t border-[rgba(194,198,209,0.18)] px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="inline-flex w-full flex-col gap-2 text-sm text-on-surface">
                  <span className="font-semibold text-on-surface-variant">From</span>
                  <input
                    type="date"
                    value={isoStr(fromDate)}
                    onChange={(event) => setFromDate(parseISO(event.target.value))}
                    max={todayISO}
                    className="w-full rounded-2xl border border-[rgba(194,198,209,0.45)] bg-surface-container-high px-3 py-3 text-sm text-on-surface outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                  />
                </label>
                <label className="inline-flex w-full flex-col gap-2 text-sm text-on-surface">
                  <span className="font-semibold text-on-surface-variant">To</span>
                  <input
                    type="date"
                    value={isoStr(toDate)}
                    onChange={(event) => setToDate(parseISO(event.target.value))}
                    min={fromDate ? isoStr(fromDate) : undefined}
                    max={todayISO}
                    className="w-full rounded-2xl border border-[rgba(194,198,209,0.45)] bg-surface-container-high px-3 py-3 text-sm text-on-surface outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                  />
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-[rgba(194,198,209,0.18)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid grid-cols-2 gap-3 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-2xl border border-[rgba(194,198,209,0.55)] bg-surface-container-high px-4 py-3 text-sm font-semibold text-on-surface transition hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={!fromDate || !toDate}
                  className="rounded-2xl bg-gradient-to-r from-slate-900 to-sky-700 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
