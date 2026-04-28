-- Run once in Supabase → SQL Editor.
-- Stores automation log rows and generated report runs for the Wheeler UI (FastAPI reads/writes with service key).

create table if not exists public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  status text not null,
  job_type text not null,
  client_key text,
  client_name text,
  message text,
  duration_ms integer,
  triggered_by text not null default 'user'
);

create index if not exists automation_logs_occurred_at_idx on public.automation_logs (occurred_at desc);

create table if not exists public.generated_reports (
  id uuid primary key default gen_random_uuid(),
  folder_date date not null,
  report_range_start date not null,
  report_range_end date not null,
  created_at timestamptz not null default now(),
  client_key text not null,
  client_name text,
  export_mode text not null,
  files jsonb not null default '[]'::jsonb
);

create index if not exists generated_reports_created_at_idx on public.generated_reports (created_at desc);

alter table public.automation_logs enable row level security;
alter table public.generated_reports enable row level security;
