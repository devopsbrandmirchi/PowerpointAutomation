/**
 * Auth session policy for idle timeout and optional storage mode.
 * Configure via Vite env (see docs/DEPLOYMENT.md and .env.example).
 */

/** Idle timeout in ms before auto sign-out. 0 = disabled. Default 30 minutes. */
export function getSessionIdleMs() {
  const raw = import.meta.env.VITE_SESSION_IDLE_MS;
  if (raw === '' || raw === undefined || raw === null) return 30 * 60 * 1000;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return 30 * 60 * 1000;
  return n;
}

/** When true, auth tokens live in sessionStorage (new browser window = must log in again). */
export function useSessionStorageForAuth() {
  const v = import.meta.env.VITE_AUTH_USE_SESSION_STORAGE;
  return v === 'true' || v === '1';
}

/**
 * When false, Supabase does not persist the session (refresh = login again).
 * Overrides session storage mode when set to false/0.
 */
export function persistAuthSession() {
  const v = import.meta.env.VITE_AUTH_PERSIST_SESSION;
  if (v === 'false' || v === '0') return false;
  return true;
}
