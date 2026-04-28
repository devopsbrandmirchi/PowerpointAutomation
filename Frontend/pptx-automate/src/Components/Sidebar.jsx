import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAgency } from '../context/AgencyContext';

function getNavClass({ isActive }, collapsed) {
  return [
    'flex items-center rounded-xl py-2.5 text-sm font-medium transition-colors',
    collapsed ? 'justify-center px-2' : 'gap-3 px-3',
    isActive
      ? 'bg-[color:rgba(12,68,124,0.1)] text-primary-container'
      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
  ].join(' ');
}

const IconChart = () => (
  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const IconLogs = () => (
  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>
);

const IconSettings = () => (
  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const IconDrive = () => (
  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
    />
  </svg>
);

/** Map pin in circle — account / workspace indicator (layout reference: icon left of name). */
const IconAccountPin = () => (
  <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

function ChevronDown({ open }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronSmallRight({ open }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-90' : ''}`}
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

function ChevronToggle({ collapsed, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-auto flex w-full shrink-0 items-center justify-center rounded-lg py-2 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <svg
        className={`h-5 w-5 shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

/**
 * Top account row + dropdown: agency name, master · sub subtitle, then panel for switch / hierarchy / new agency.
 * Layout order matches reference: account first, then menu below.
 */
function AccountWorkspaceDropdown({ collapsed }) {
  const {
    agencies,
    selection,
    selectAgency,
    selectSubAccount,
    createAgency,
    assignAllKnownClientsToCurrentAgency,
    activeAgency,
    activeMaster,
    activeSub,
  } = useAgency();

  const [open, setOpen] = useState(false);
  const [expandedMasters, setExpandedMasters] = useState(() => new Set());
  const wrapRef = useRef(null);

  const masterKey = (agencyId, masterId) => `${agencyId}::${masterId}`;
  const expandedFor = (agencyId, masterId) => expandedMasters.has(masterKey(agencyId, masterId));

  const toggleMaster = (agencyId, masterId) => {
    const k = masterKey(agencyId, masterId);
    setExpandedMasters((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const subtitle = useMemo(() => {
    const m = activeMaster?.name?.trim() || '';
    const s = activeSub?.name?.trim() || '';
    if (m && s) return `${m} · ${s}`;
    return m || s || 'Master · Subaccount';
  }, [activeMaster?.name, activeSub?.name]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleCreateAgency = () => {
    const name = window.prompt('New agency name (e.g. client holding company):');
    if (!name?.trim()) return;
    const res = createAgency(name.trim());
    if (res?.error) window.alert(res.error);
  };

  const panel = open ? (
    <div
      className={[
        'z-50 max-h-[min(70vh,420px)] overflow-y-auto rounded-xl border border-[rgba(194,198,209,0.35)] bg-surface-container-lowest py-2 shadow-ambient',
        collapsed ? 'absolute left-full top-0 ml-2 w-[min(calc(100vw-96px),280px)]' : 'absolute left-0 right-0 top-full mt-1.5',
      ].join(' ')}
      role="region"
      aria-label="Switch workspace"
    >
      <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Agencies</p>
      <ul className="border-b border-[rgba(194,198,209,0.15)] px-1 pb-2">
        {agencies.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => {
                selectAgency(a.id);
                setExpandedMasters(new Set([masterKey(a.id, a.masters[0]?.id)]));
              }}
              className={`flex w-full rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-surface-container-high ${
                a.id === selection.agencyId ? 'bg-[color:rgba(12,68,124,0.08)] text-primary' : 'text-on-surface'
              }`}
            >
              {a.name}
            </button>
          </li>
        ))}
      </ul>

      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={handleCreateAgency}
          className="w-full rounded-lg border border-dashed border-primary/30 py-2 text-center text-xs font-semibold text-primary hover:bg-surface-container-high/60"
        >
          + New agency
        </button>
        <button
          type="button"
          onClick={() => assignAllKnownClientsToCurrentAgency()}
          className="mt-1 w-full py-1.5 text-center text-[10px] font-medium text-on-surface-variant hover:text-primary hover:underline"
        >
          Link all API clients to current agency
        </button>
      </div>

      <p className="mt-3 px-3 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Master & subaccounts</p>
      <div className="mt-1 space-y-1 px-2 pb-2">
        {(activeAgency?.masters ?? []).map((master) => {
          const exp = expandedFor(activeAgency.id, master.id) || master.id === selection.masterId;
          return (
            <div key={master.id} className="rounded-lg border border-[rgba(194,198,209,0.2)] bg-surface-container-low/90">
              <button
                type="button"
                onClick={() => toggleMaster(activeAgency.id, master.id)}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold text-on-surface"
              >
                <ChevronSmallRight open={exp} />
                <span className="min-w-0 truncate">{master.name}</span>
              </button>
              {exp ? (
                <ul className="border-t border-[rgba(194,198,209,0.12)] px-1 py-1">
                  {(master.subaccounts ?? []).map((sub) => {
                    const sel =
                      selection.agencyId === activeAgency.id &&
                      selection.masterId === master.id &&
                      selection.subAccountId === sub.id;
                    return (
                      <li key={sub.id}>
                        <button
                          type="button"
                          onClick={() => {
                            selectSubAccount(activeAgency.id, master.id, sub.id);
                            setOpen(false);
                          }}
                          className={[
                            'mb-0.5 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
                            sel ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high',
                          ].join(' ')}
                        >
                          {sub.name}
                          {String(sub.name).toLowerCase() === 'wheeler' ? (
                            <span className="ml-1 text-[10px] font-normal opacity-90">(suite)</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="border-t border-[rgba(194,198,209,0.12)] px-3 py-2 text-center text-[10px] text-on-surface-variant">
        Wheeler Marketing Suite
      </p>
    </div>
  ) : null;

  if (collapsed) {
    return (
      <div ref={wrapRef} className="relative mb-3 shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full flex-col items-center gap-1 rounded-xl border border-[rgba(194,198,209,0.3)] bg-surface-container-high/70 py-2.5 transition-colors hover:bg-surface-container-high"
          aria-expanded={open}
          aria-haspopup="true"
          title={`${activeAgency?.name ?? 'Agency'} — ${subtitle}`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:rgba(12,68,124,0.1)] ring-1 ring-[rgba(12,68,124,0.15)]">
            <IconAccountPin />
          </span>
          <ChevronDown open={open} />
        </button>
        {panel}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative mb-4 shrink-0 px-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl border border-[rgba(194,198,209,0.35)] bg-surface-container-high/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-container-high"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:rgba(12,68,124,0.1)] ring-1 ring-[rgba(12,68,124,0.12)]">
          <IconAccountPin />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold leading-snug text-primary">{activeAgency?.name ?? 'Agency'}</p>
          <p className="mt-0.5 truncate text-xs text-on-surface-variant" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <ChevronDown open={open} />
      </button>
      {panel}
    </div>
  );
}

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`relative flex h-full max-h-dvh min-h-0 shrink-0 flex-col border-r border-[rgba(194,198,209,0.25)] bg-surface-container-lowest py-5 transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[72px] px-2' : 'w-[260px] px-3'
      }`}
    >
      <AccountWorkspaceDropdown collapsed={collapsed} />

      {!collapsed ? (
        <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Menu</p>
      ) : null}

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-y-contain" aria-label="Main">
        <NavLink to="/dashboard/report-generator" className={(p) => getNavClass(p, collapsed)} title="Report Generator">
          <IconChart />
          {!collapsed ? <span>Report Generator</span> : null}
        </NavLink>
        <NavLink to="/dashboard/config-dealer" className={(p) => getNavClass(p, collapsed)} title="Dealer configuration">
          <IconSettings />
          {!collapsed ? <span>Dealer config</span> : null}
        </NavLink>
        <NavLink to="/dashboard/drive" className={(p) => getNavClass(p, collapsed)} title="Drive">
          <IconDrive />
          {!collapsed ? <span>Drive</span> : null}
        </NavLink>
        <NavLink to="/dashboard/logs" className={(p) => getNavClass(p, collapsed)} title="Automation Logs">
          <IconLogs />
          {!collapsed ? <span>Automation Logs</span> : null}
        </NavLink>
      </nav>

      <ChevronToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
    </aside>
  );
};

export default Sidebar;
