# Backend deployment on DigitalOcean (Docker)

This project includes:

- `Backend/Dockerfile`
- `docker-compose.backend.yml`

Use these steps on your droplet.

## 1) Prepare server folder

```bash
mkdir -p /root/PowerpointAutomations
cd /root/PowerpointAutomations
git clone <your-repo-url> .
```

If the repo already exists:

```bash
cd /root/PowerpointAutomations
git pull origin main
```

## 2) Install Docker + Compose plugin (Ubuntu)

```bash
apt update
apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

## 3) Create backend env file

```bash
cd /root/PowerpointAutomations
cp Backend/.env.example Backend/.env
nano Backend/.env
```

Set real values for:

- `SUPABASE_URL`
- `SUPABASE_KEY`

## 4) Add Google credential files

```bash
mkdir -p /root/PowerpointAutomations/Backend/secrets
```

Place these files in that folder:

- `/root/PowerpointAutomations/Backend/secrets/ga4-credentials.json`
- `/root/PowerpointAutomations/Backend/secrets/google-ads.yaml`

## 5) Build and start backend container

```bash
cd /root/PowerpointAutomations
docker compose -f docker-compose.backend.yml up -d --build
```

## 6) Verify

```bash
docker compose -f docker-compose.backend.yml ps
docker compose -f docker-compose.backend.yml logs -f backend
curl http://127.0.0.1:8000/
```

Expected response:

```json
{"status":"Wheeler Automation API is running"}
```

## 7) Update deployment (after new code)

```bash
cd /root/PowerpointAutomations
git pull origin main
docker compose -f docker-compose.backend.yml up -d --build
```
