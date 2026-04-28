import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Route gate: no Supabase session → `/login`. Pair with `middleware/SessionGuard.jsx` for idle timeout after login.
 */
export default function RequireAuth({ children }) {
  const { session, loading, isConfigured } = useAuth();
  const location = useLocation();

  if (!isConfigured) {
    return <Navigate to="/login" replace state={{ from: location, reason: 'unconfigured' }} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-on-surface-variant">
        <p className="text-sm font-medium">Checking session…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
