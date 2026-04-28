# Deployment guide — Wheeler PowerPoint Automations

This repo has a **FastAPI** backend and a **Vite + React** frontend (Supabase Auth). Use this checklist when moving from local development to production.

---

## 1. Architecture (what runs where)

| Piece | Role | Typical host |
|-------|------|----------------|
| **Frontend** (`Frontend/pptx-automate`) | SPA: login, report UI, dealer config | Vercel or Netlify |
| **Backend** (`Backend/main.py`) | `/clients`, `/generate-stream`, `/ga4-sync-stream`, etc. | DigitalOcean Droplet / App Platform / any VPS |
| **Supabase** | Auth + Postgres (dealers, logs, GA4 tables) | Supabase Cloud (already in use) |
| **Google** | Drive, GA4, Google Ads APIs | Credentials on the **backend** server only |

The browser **never** gets your Supabase `service_role` key or Google service-account secrets. Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` belong in the frontend build.

---

## 2. Frontend environment variables

Create production env vars in **Vercel** or **Netlify** (same names as local `.env.development`).

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Public URL of your FastAPI API, **no trailing slash**, e.g. `https://api.yourdomain.com` |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase **anon** public key (Settings → API) |
| `VITE_SUPABASE_CLIENT_TABLE` | Optional | Must match backend `SUPABASE_CLIENT_TABLE` if not default `google_ads_accounts` |
| `VITE_SESSION_IDLE_MS` | Optional | Milliseconds of inactivity before auto logout (default `1800000` = 30 min). Set `0` to disable |
| `VITE_AUTH_USE_SESSION_STORAGE` | Optional | `true` = store session in **sessionStorage** (new window / often “new day” = login again). Default `false` = **localStorage** |
| `VITE_AUTH_PERSIST_SESSION` | Optional | `false` = Supabase **does not** persist session (full page reload = login again). Stricter than sessionStorage |

**Production URL:** After deploy, `VITE_API_URL` must be the **HTTPS** origin that browsers will call. Update FastAPI **CORS** to allow your Vercel/Netlify origin (see §4).

---

## 3. Deploy frontend — **Vercel**

1. Push the repo to GitHub/GitLab/Bitbucket (or use Vercel CLI).
2. **New Project** → import repo.
3. **Root directory:** `Frontend/pptx-automate` (if the monorepo root is not the Vite app).
4. **Framework preset:** Vite.
5. **Build command:** `npm run build` (default).
6. **Output directory:** `dist`.
7. **Environment variables:** add all `VITE_*` vars from §2.
8. **SPA routing:** Vercel usually serves `index.html` for unknown paths on static sites. If deep links to `/dashboard/...` 404, add a `vercel.json` in the **frontend root**:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

9. **Supabase Auth redirect URLs:** In Supabase → Authentication → URL configuration, add your production site URL (e.g. `https://your-app.vercel.app`) and `https://your-app.vercel.app/login` if you use password reset links.
10. Redeploy after any env change.

---

## 4. Deploy frontend — **Netlify**

1. **New site from Git** → same repo.
2. **Base directory:** `Frontend/pptx-automate`.
3. **Build command:** `npm run build`.
4. **Publish directory:** `dist`.
5. Add the same `VITE_*` environment variables (Site settings → Environment variables).
6. **SPA fallback:** add `public/_redirects` in the Vite project (if not present):

```
/*    /index.html   200
```

Or `netlify.toml`:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

7. Add production URL to Supabase Auth allow list (same as Vercel §3.9).

---

## 5. Backend environment variables (DigitalOcean or any host)

On the server, use a **private** `.env` (never commit). Typical keys from `Backend/main.py` / scripts:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase **service_role** or a server key with rights your API needs (keep secret) |
| `SUPABASE_CLIENT_TABLE` | Dealer/client table name (default `google_ads_accounts`) |
| `GOOGLE_ADS_YAML` | Path to `google-ads.yaml` if not next to `main.py` |
| Google / GA4 | Paths or env for credentials used by `drive_utils`, `sync_ads_to_db_GA4`, etc. |

**CORS (important):** In `Backend/main.py`, `allow_origins=["*"]` is convenient for dev. For production, set allowed origins to your real frontend URL(s), e.g.:

```python
allow_origins=[
    "https://your-app.vercel.app",
    "https://your-app.netlify.app",
]
```

Redeploy backend after tightening CORS.

---

## 6. Deploy backend — **DigitalOcean Droplet** (Ubuntu-style)

High-level steps:

1. **Create a Droplet** (Ubuntu LTS), add SSH keys, note public IP.
2. **Firewall:** allow `22` (SSH), `80`/`443` (HTTP/HTTPS). Do **not** expose Postgres; Supabase is cloud-hosted.
3. **Install:** `git`, `python3.11+` (or your version), `python3-venv`, `nginx`, `certbot` (for Let’s Encrypt).
4. **Clone repo** to `/opt/wheeler` (example), create venv, `pip install -r Backend/requirements.txt`.
5. **Place secrets:** `.env` in `Backend/`, `ga4-credentials.json`, `google-ads.yaml`, OAuth files as required — restrict permissions (`chmod 600`).
6. **Run API with systemd** (example unit `wheeler-api.service`):

```ini
[Unit]
Description=Wheeler FastAPI
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/wheeler/Backend
EnvironmentFile=/opt/wheeler/Backend/.env
ExecStart=/opt/wheeler/Backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

7. **Nginx reverse proxy** — terminate TLS and proxy to `127.0.0.1:8000`:

```nginx
server {
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

8. **`certbot --nginx`** for HTTPS.
9. Set **`VITE_API_URL`** on the frontend to `https://api.yourdomain.com` (matching nginx `server_name`).

**Streaming:** For `/generate-stream` and `/ga4-sync-stream`, nginx should **not** buffer SSE (`proxy_buffering off;` for those `location` blocks) if you see stuck progress bars.

---

## 7. Deploy backend — **DigitalOcean App Platform**

1. Connect repo; set **source directory** to `Backend` (or run command from repo root with `cd Backend`).
2. **Run command:** e.g. `uvicorn main:app --host 0.0.0.0 --port 8080` (use the port App Platform injects, often `$PORT`).
3. Add **all** env vars from §5 in the UI (encrypted).
4. Attach a **custom domain** and enable HTTPS (managed certificate).
5. Point frontend `VITE_API_URL` to the App’s public HTTPS URL.

---

## 8. Auth behavior (this project)

- **Login first:** `/` and unknown routes redirect to `/login`. `/dashboard/*` is wrapped in `RequireAuth` → no session → `/login`.
- **Idle timeout:** `SessionGuard` (inside the dashboard shell) signs the user out after `VITE_SESSION_IDLE_MS` without pointer/keyboard/scroll activity.
- **Logout:** Header “Log out” calls Supabase `signOut` and navigates to `/login`.
- **Stricter “always log in” for a new browser tab:** set `VITE_AUTH_USE_SESSION_STORAGE=true`.
- **Stricter “every full reload”:** set `VITE_AUTH_PERSIST_SESSION=false` (no persisted session).

See `Frontend/pptx-automate/src/middleware/README.md` and `src/lib/authSessionPolicy.js`.

---

## 9. Pre-flight checklist before going live

- [ ] Frontend `VITE_API_URL` uses **HTTPS** production API URL.
- [ ] Backend CORS allows **only** your frontend origin(s).
- [ ] Supabase Auth **site URL** + **redirect URLs** include production frontend.
- [ ] Backend `.env` and credential JSON/YAML are **not** in git.
- [ ] Smoke test: login → Report Generator → one API call → Drive page.
- [ ] Optional: rate limit / auth on sensitive backend routes if you add API keys later.

---

## 10. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| CORS error in browser | Backend `allow_origins` missing your Vercel/Netlify URL |
| `401` / instant logout | Wrong anon key or expired JWT; check Supabase dashboard |
| API `Network Error` | Wrong `VITE_API_URL`, mixed HTTP/HTTPS, or droplet firewall |
| SSE / stream hangs | nginx buffering; disable proxy buffering for stream routes |
| Dealer page works, reports 404 API | `VITE_API_URL` still pointing to `localhost` in production build |

---

## 11. Related files in this repo

- `Frontend/pptx-automate/.env.example` — template for Vite env (copy to `.env.production.local` / hosting UI).
- `Frontend/pptx-automate/src/middleware/SessionGuard.jsx` — idle timeout.
- `Frontend/pptx-automate/src/Components/RequireAuth.jsx` — route protection.
- `Frontend/pptx-automate/src/lib/supabaseClient.js` — Supabase client + persistence options.
- `Backend/main.py` — CORS, API routes.

---

## 12. Multi-agency (frontend only, today)

The app includes an **agency / master / subaccount** hierarchy in the sidebar (`AgencyContext`, `src/context/AgencyContext.jsx`). Client rows from the API are mapped to an **agency id** in `localStorage` (`wheeler_client_agency_v1`) so Report Generator, Drive, Dealer config, and Automation Logs can **filter by the selected agency**. The FastAPI backend is unchanged; production multi-tenant would add real `agency_id` columns and server-side filters later.
