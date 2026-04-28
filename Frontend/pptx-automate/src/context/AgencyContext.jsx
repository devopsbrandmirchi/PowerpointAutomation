import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_AGENCIES = 'wheeler_agencies_v1';
const STORAGE_SELECTION = 'wheeler_agency_selection_v1';
const STORAGE_CLIENT_AGENCY = 'wheeler_client_agency_v1';

function slugify(name) {
  return String(name || 'agency')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'agency';
}

/** Default seed: Wheeler Agency + Xyz.com, each with Master → Subaccounts (Wheeler). */
export function buildDefaultAgencyTree() {
  return [
    {
      id: 'agency_wheeler_main',
      name: 'Wheeler Agency',
      masters: [
        {
          id: 'master_wheel_primary',
          name: 'Master account',
          subaccounts: [
            { id: 'sub_wheeler', name: 'Wheeler' },
            { id: 'sub_wheeler_alt', name: 'Secondary' },
          ],
        },
      ],
    },
    {
      id: 'agency_xyz',
      name: 'Xyz.com',
      masters: [
        {
          id: 'master_xyz_primary',
          name: 'Master account',
          subaccounts: [{ id: 'sub_xyz_wheeler', name: 'Wheeler' }],
        },
      ],
    },
  ];
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function validateAgencies(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const a of list) {
    if (!a?.id || !a?.name || !Array.isArray(a.masters)) return null;
    for (const m of a.masters) {
      if (!m?.id || !m?.name || !Array.isArray(m.subaccounts) || m.subaccounts.length === 0) return null;
      for (const s of m.subaccounts) {
        if (!s?.id || !s?.name) return null;
      }
    }
  }
  return list;
}

const AgencyContext = createContext(null);

export function AgencyProvider({ children }) {
  const [agencies, setAgenciesState] = useState(() => {
    const parsed = validateAgencies(loadJson(STORAGE_AGENCIES, null));
    return parsed || buildDefaultAgencyTree();
  });

  const [selection, setSelectionState] = useState(() => {
    const def = buildDefaultAgencyTree();
    const s = loadJson(STORAGE_SELECTION, null);
    if (s?.agencyId && s?.masterId && s?.subAccountId) return s;
    return {
      agencyId: def[0].id,
      masterId: def[0].masters[0].id,
      subAccountId: def[0].masters[0].subaccounts[0].id,
    };
  });

  const [clientAgencyMap, setClientAgencyMapState] = useState(() => {
    const m = loadJson(STORAGE_CLIENT_AGENCY, null);
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  });

  const lastClientIdsRef = useRef([]);

  useEffect(() => {
    saveJson(STORAGE_AGENCIES, agencies);
  }, [agencies]);

  useEffect(() => {
    saveJson(STORAGE_SELECTION, selection);
  }, [selection]);

  useEffect(() => {
    saveJson(STORAGE_CLIENT_AGENCY, clientAgencyMap);
  }, [clientAgencyMap]);

  const activeAgency = useMemo(
    () => agencies.find((a) => a.id === selection.agencyId) || agencies[0],
    [agencies, selection.agencyId],
  );

  const activeMaster = useMemo(() => {
    const m = activeAgency?.masters?.find((x) => x.id === selection.masterId);
    return m || activeAgency?.masters?.[0];
  }, [activeAgency, selection.masterId]);

  const activeSub = useMemo(() => {
    const s = activeMaster?.subaccounts?.find((x) => x.id === selection.subAccountId);
    return s || activeMaster?.subaccounts?.[0];
  }, [activeMaster, selection.subAccountId]);

  /** Used for sessionStorage keys (drive ping, etc.) */
  const scopeKey = useMemo(
    () => `${selection.agencyId}|${selection.masterId}|${selection.subAccountId}`,
    [selection.agencyId, selection.masterId, selection.subAccountId],
  );

  const defaultAgencyId = agencies[0]?.id ?? 'agency_wheeler_main';

  const setSelection = useCallback((partial) => {
    setSelectionState((prev) => ({ ...prev, ...partial }));
  }, []);

  const selectAgency = useCallback(
    (agencyId) => {
      const ag = agencies.find((a) => a.id === agencyId);
      if (!ag) return;
      const master = ag.masters[0];
      const sub = master.subaccounts[0];
      setSelectionState({ agencyId: ag.id, masterId: master.id, subAccountId: sub.id });
    },
    [agencies],
  );

  const selectSubAccount = useCallback((agencyId, masterId, subAccountId) => {
    setSelectionState({ agencyId, masterId, subAccountId });
  }, []);

  const createAgency = useCallback((name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { error: 'Name is required' };
    const id = `agency_${slugify(trimmed)}_${Date.now().toString(36)}`;
    const masterId = `master_${id}`;
    const subId = `sub_wheeler_${id}`;
    const next = {
      id,
      name: trimmed,
      masters: [
        {
          id: masterId,
          name: 'Master account',
          subaccounts: [{ id: subId, name: 'Wheeler' }],
        },
      ],
    };
    setAgenciesState((prev) => [...prev, next]);
    setSelectionState({ agencyId: id, masterId: masterId, subAccountId: subId });
    return { ok: true, id };
  }, []);

  const registerClientIds = useCallback((ids) => {
    if (!Array.isArray(ids)) return;
    lastClientIdsRef.current = [...new Set([...lastClientIdsRef.current, ...ids.map(String)])];
    setClientAgencyMapState((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const k = String(id);
        if (next[k] == null || next[k] === '') next[k] = defaultAgencyId;
      }
      return next;
    });
  }, [defaultAgencyId]);

  const assignAllKnownClientsToCurrentAgency = useCallback(() => {
    const aid = selection.agencyId;
    setClientAgencyMapState((prev) => {
      const next = { ...prev };
      for (const id of lastClientIdsRef.current) {
        next[id] = aid;
      }
      return next;
    });
  }, [selection.agencyId]);

  const clientBelongsToActiveAgency = useCallback(
    (clientKey) => {
      if (clientKey == null || clientKey === '') return false;
      const mapped = clientAgencyMap[String(clientKey)];
      return mapped === selection.agencyId;
    },
    [clientAgencyMap, selection.agencyId],
  );

  const value = useMemo(
    () => ({
      agencies,
      selection,
      activeAgency,
      activeMaster,
      activeSub,
      scopeKey,
      activeAgencyId: selection.agencyId,
      clientAgencyMap,
      setSelection,
      selectAgency,
      selectSubAccount,
      createAgency,
      registerClientIds,
      assignAllKnownClientsToCurrentAgency,
      clientBelongsToActiveAgency,
    }),
    [
      agencies,
      selection,
      activeAgency,
      activeMaster,
      activeSub,
      scopeKey,
      clientAgencyMap,
      setSelection,
      selectAgency,
      selectSubAccount,
      createAgency,
      registerClientIds,
      assignAllKnownClientsToCurrentAgency,
      clientBelongsToActiveAgency,
    ],
  );

  return <AgencyContext.Provider value={value}>{children}</AgencyContext.Provider>;
}

export function useAgency() {
  const ctx = useContext(AgencyContext);
  if (!ctx) throw new Error('useAgency must be used within AgencyProvider');
  return ctx;
}
