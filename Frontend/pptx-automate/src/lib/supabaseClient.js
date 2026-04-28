import { createClient } from '@supabase/supabase-js';
import { persistAuthSession, useSessionStorageForAuth } from './authSessionPolicy';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** True when browser auth can run (use the anon key from Supabase → Settings → API). */
export const isSupabaseAuthConfigured = Boolean(url && anonKey);

const authStorageKey = 'pptx-automate-auth';

function buildAuthOptions() {
  const persist = persistAuthSession();
  const useSession = useSessionStorageForAuth();
  const base = {
    autoRefreshToken: persist,
    detectSessionInUrl: true,
    storageKey: authStorageKey,
  };
  if (!persist) {
    return { ...base, persistSession: false };
  }
  if (typeof window !== 'undefined' && useSession) {
    return { ...base, persistSession: true, storage: window.sessionStorage };
  }
  return { ...base, persistSession: true };
}

export const supabase = isSupabaseAuthConfigured
  ? createClient(url, anonKey, {
      auth: buildAuthOptions(),
    })
  : null;
