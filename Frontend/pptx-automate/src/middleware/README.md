# Auth middleware (frontend)

This folder holds **client-side** guards that complement React Router and Supabase Auth.

| File | Role |
|------|------|
| `SessionGuard.jsx` | After login, monitors user activity; **idle timeout** → `signOut()` and redirect to `/login` with `state.reason === 'idle_timeout'`. |

**Router-level protection** lives in `src/Components/RequireAuth.jsx` (blocks `/dashboard/*` until Supabase returns a session).

**Policy knobs** (`src/lib/authSessionPolicy.js`): `VITE_SESSION_IDLE_MS`, `VITE_AUTH_USE_SESSION_STORAGE`, `VITE_AUTH_PERSIST_SESSION` — see repo `docs/DEPLOYMENT.md`.

There is no Node “middleware” in this Vite SPA; the FastAPI backend remains separate. For production APIs, add HTTPS, CORS, and rate limits on the server (documented in `docs/DEPLOYMENT.md`).
