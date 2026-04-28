import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getSessionIdleMs } from '../lib/authSessionPolicy';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

/**
 * While the user is authenticated inside the dashboard shell, tracks activity and
 * signs out after `VITE_SESSION_IDLE_MS` of inactivity (default 30 minutes).
 */
export default function SessionGuard({ children }) {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const lastActivityRef = useRef(Date.now());
  const idleMs = getSessionIdleMs();

  useEffect(() => {
    if (!session || idleMs <= 0) return undefined;

    const bump = () => {
      lastActivityRef.current = Date.now();
    };

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, bump, { passive: true, capture: true }));

    const tickMs = Math.min(60_000, Math.max(10_000, Math.floor(idleMs / 3)));
    const intervalId = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current < idleMs) return;
      window.clearInterval(intervalId);
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, bump, true));
      void (async () => {
        await signOut();
        navigate('/login', {
          replace: true,
          state: { reason: 'idle_timeout', from: { pathname: window.location.pathname } },
        });
      })();
    }, tickMs);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, bump, true));
      window.clearInterval(intervalId);
    };
  }, [session, idleMs, signOut, navigate]);

  return children;
}
