-- Admin-owned reminders synchronized from the portal to Google Calendar.

create table public.google_calendar_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  google_email text,
  calendar_id text not null default 'primary',
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  access_token_expires_at timestamptz not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  notes text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  google_event_id text,
  google_calendar_id text,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'error')),
  sync_error text,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (created_by, idempotency_key)
);

create index calendar_reminders_admin_start_idx
  on public.calendar_reminders (created_by, starts_at);

alter table public.google_calendar_connections enable row level security;
alter table public.calendar_reminders enable row level security;

create policy "Admins manage their Google Calendar connection"
on public.google_calendar_connections for all to authenticated
using (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_active)
)
with check (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_active)
);

create policy "Admins manage their calendar reminders"
on public.calendar_reminders for all to authenticated
using (
  created_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_active)
)
with check (
  created_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_active)
);
