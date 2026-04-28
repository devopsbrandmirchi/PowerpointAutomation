import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAgency } from '../context/AgencyContext';
import { clearDriveReportPing, DRIVE_REPORT_EVENT, readDriveReportPing } from '../lib/driveReportPing';

function initialsFromEmail(email) {
  if (!email) return '?';
  const part = email.split('@')[0] || email;
  const letters = part.replace(/[^a-zA-Z]/g, '').slice(0, 2);
  if (letters.length >= 2) return letters.toUpperCase();
  return part.slice(0, 2).toUpperCase() || '?';
}

const Header = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { scopeKey, activeAgency, activeMaster, activeSub } = useAgency();
  const [drivePing, setDrivePing] = useState(() => readDriveReportPing(scopeKey));

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

  const initials = useMemo(() => initialsFromEmail(user?.email), [user?.email]);

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true, state: { reason: 'manual_logout' } });
  };

  const hierarchyLabel = `${activeAgency?.name ?? '—'} › ${activeMaster?.name ?? '—'} › ${activeSub?.name ?? '—'}`;

  return (
    <header className="flex min-h-[64px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[rgba(194,198,209,0.2)] bg-surface-container-low px-6 py-2 md:px-8 md:py-0">
      <div className="min-w-0 flex-1 pr-2">
        <p
          className="mb-1 hidden max-w-full truncate text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant md:block"
          title={hierarchyLabel}
        >
          {hierarchyLabel}
        </p>
        {drivePing ? (
          <div
            role="status"
            className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-xs text-amber-950 shadow-sm"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-2 ring-amber-100" aria-hidden />
            <span className="min-w-0 font-medium">
              New report saved for <span className="whitespace-normal break-words">{drivePing.clientName}</span>
              {drivePing.reportRangeStart && drivePing.reportRangeEnd ? (
                <span className="text-amber-900/85"> ({drivePing.reportRangeStart} → {drivePing.reportRangeEnd})</span>
              ) : null}
            </span>
            <span className="hidden sm:inline text-on-surface-variant">·</span>
            <button
              type="button"
              onClick={() => navigate('/dashboard/drive')}
              className="shrink-0 font-semibold text-primary underline-offset-2 hover:underline"
            >
              Open Drive
            </button>
            <button
              type="button"
              onClick={() => clearDriveReportPing(scopeKey)}
              className="shrink-0 rounded-md border border-amber-300/80 bg-surface-container-lowest px-2 py-0.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-100/80"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {user?.email ? (
          <span className="hidden max-w-[200px] truncate text-xs text-on-surface-variant sm:inline" title={user.email}>
            {user.email}
          </span>
        ) : null}
        <button
          type="button"
          className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          aria-label="Notifications"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </button>
        <button
          type="button"
          className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          aria-label="Settings"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container text-xs font-bold text-on-primary ring-2 ring-white shadow-sm"
            aria-hidden
          >
            {initials}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-[rgba(194,198,209,0.35)] bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-surface-container-high"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
