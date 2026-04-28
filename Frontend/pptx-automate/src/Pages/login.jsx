import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';

const inputBase =
  'block w-full pl-11 pr-3 py-2.5 rounded-t-lg bg-surface-container-high text-left text-on-surface placeholder:text-on-surface-variant/70 sm:text-sm transition-[border-color,box-shadow] outline-none border-0 border-b-2 border-b-[rgba(194,198,209,0.15)] focus:border-b-primary focus:border-b-2 focus:ring-0';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, loading: authLoading, isConfigured, signIn } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const from = location.state?.from?.pathname || '/dashboard/report-generator';

  useEffect(() => {
    if (authLoading || !isConfigured) return;
    if (session) {
      navigate(from, { replace: true });
    }
  }, [authLoading, isConfigured, session, navigate, from]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    if (!email || !password) return;

    setSubmitting(true);
    const { error: signErr } = await signIn(email, password);
    setSubmitting(false);

    if (signErr) {
      setError(signErr.message || 'Sign-in failed');
      return;
    }
    navigate(from, { replace: true });
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    const email = window.prompt('Enter the email address for your Wheeler account:');
    if (!email?.trim()) return;
    if (!isConfigured || !supabase) return;
    const redirectTo = `${window.location.origin}/login`;
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (resetErr) {
      window.alert(resetErr.message);
      return;
    }
    window.alert('If that email is registered, Supabase will send a reset link shortly.');
  };

  if (authLoading && isConfigured) {
    return (
      <div className="flex h-dvh max-h-dvh items-center justify-center overflow-hidden bg-surface text-on-surface-variant">
        <p className="text-sm font-medium">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh max-h-dvh flex-col items-center justify-center overflow-hidden bg-surface px-4 py-3 sm:px-6">
      <div className="flex w-full max-w-[400px] flex-col overflow-hidden rounded-2xl bg-surface-container-lowest text-center shadow-ambient">
        <div className="shrink-0 border-b border-[rgba(194,198,209,0.15)] px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div
            className="mx-auto mb-3 inline-flex rounded-xl p-3 shadow-ambient"
            style={{
              background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)',
            }}
          >
            <svg className="h-8 w-8 text-on-primary" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
              <rect x="5" y="4" width="2" height="16" rx="1" />
              <rect x="3.5" y="8" width="5" height="4" rx="1" />
              <rect x="11" y="4" width="2" height="16" rx="1" />
              <rect x="9.5" y="12" width="5" height="4" rx="1" />
              <rect x="17" y="4" width="2" height="16" rx="1" />
              <rect x="15.5" y="6" width="5" height="4" rx="1" />
            </svg>
          </div>
          <h1 className="font-display text-[24px] font-bold tracking-tight text-primary sm:text-[26px]">Wheeler Agency</h1>
          <p className="mt-1 text-[13px] text-on-surface-variant">Internal Automation Suite</p>
        </div>

        <div className="shrink-0 px-5 pt-3 sm:px-6">
          <h2 className="font-display text-[20px] font-bold text-primary sm:text-[22px]">Secure Login</h2>
          <p className="mx-auto mt-1 max-w-[20rem] text-[11px] leading-snug text-on-surface-variant sm:text-xs">
            Sign in with your Supabase email and password.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-5 pb-4 pt-3 sm:px-6 sm:pb-5">
          {!isConfigured ? (
            <p className="mb-3 rounded-lg border border-amber-200/90 bg-amber-50/95 px-2 py-1.5 text-[11px] leading-snug text-amber-950 sm:text-xs">
              <span className="font-semibold text-primary">Configuration:</span> set{' '}
              <code className="rounded bg-amber-100/80 px-0.5">VITE_SUPABASE_URL</code> and{' '}
              <code className="rounded bg-amber-100/80 px-0.5">VITE_SUPABASE_ANON_KEY</code>, then restart Vite.
            </p>
          ) : location.state?.reason === 'unconfigured' ? (
            <p className="mb-3 rounded-lg border border-amber-200/90 bg-amber-50/95 px-2 py-1.5 text-[11px] text-amber-950 sm:text-xs">
              Add the Supabase anon key in env and reload.
            </p>
          ) : location.state?.reason === 'idle_timeout' ? (
            <p className="mb-3 rounded-lg border border-sky-200/90 bg-sky-50/95 px-2 py-1.5 text-[11px] text-sky-950 sm:text-xs">
              <span className="font-semibold text-primary">Session timed out</span> due to inactivity. Sign in again to continue.
            </p>
          ) : location.state?.reason === 'manual_logout' ? (
            <p className="mb-3 rounded-lg border border-[rgba(194,198,209,0.35)] bg-surface-container-high/90 px-2 py-1.5 text-[11px] text-on-surface sm:text-xs">
              You have been signed out.
            </p>
          ) : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-red-200/90 bg-red-50/95 px-2 py-1.5 text-center text-[11px] text-red-950 sm:text-xs">
              {error}
            </p>
          ) : null}

          <form className="space-y-3 text-center" onSubmit={handleSubmit}>
            <div>
              {/* <label className="mb-1 block text-[12px] font-semibold text-on-surface" htmlFor="login-email">
                Email address
              </label> */}
              <div className="relative text-left">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <svg
                    className="h-4 w-4 text-on-surface-variant/60"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  className={inputBase}
                  placeholder="name@wheeler.agency"
                  autoComplete="email"
                  required
                  disabled={submitting || !isConfigured}
                />
              </div>
            </div>

            <div>
              {/* <label className="mb-1 block text-[12px] font-semibold text-on-surface" htmlFor="login-password">
                Password
              </label> */}
              <div className="relative text-left">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <svg
                    className="h-4 w-4 text-on-surface-variant/60"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  className={inputBase}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  disabled={submitting || !isConfigured}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-0.5 text-[12px]">
              <span className="inline-flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-0 bg-surface-container-high accent-primary"
                />
                <label htmlFor="remember-me" className="ml-2 cursor-pointer text-on-surface-variant">
                  Remember me
                </label>
              </span>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={!isConfigured}
                className="font-semibold text-primary transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting || !isConfigured}
              className="flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-[14px] font-semibold text-on-primary transition-[filter,transform] hover:brightness-105 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/40 disabled:pointer-events-none disabled:opacity-60"
              style={{
                background: 'linear-gradient(135deg, #002E59 0%, #0C447C 100%)',
              }}
            >
              {submitting ? 'Signing in…' : 'Login'}
              {!submitting ? (
                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              ) : null}
            </button>
          </form>

          <div className="mt-3 border-t border-[rgba(194,198,209,0.12)] pt-3">
            <p className="text-[10px] leading-snug text-on-surface-variant sm:text-[11px]">
              Authorized access only.{' '}
              <a href="#" className="font-medium text-primary hover:underline">
                Internal Security Protocol.
              </a>
            </p>
            <div className="mt-2 flex items-center justify-center text-[9px] font-semibold uppercase tracking-widest text-secondary sm:text-[10px]">
              <svg className="mr-1 h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Encrypted Connection
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
