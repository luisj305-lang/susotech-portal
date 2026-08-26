create table public.job_stages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'invoiced', 'paid')),
  invoice_number text,
  invoice_path text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  invoiced_at timestamptz,
  invoiced_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, sequence),
  check (description is null or char_length(btrim(description)) <= 2000),
  check (invoice_number is null or char_length(btrim(invoice_number)) between 1 and 200),
  check (invoice_path is null or char_length(invoice_path) <= 1000),
  check (status in ('pending', 'completed') or (invoice_number is not null and invoiced_at is not null)),
  check (status <> 'paid' or paid_at is not null)
);

create index job_stages_job_sequence_idx on public.job_stages(job_id, sequence);

create table public.job_stage_events (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.job_stages(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  action text not null check (action in ('created', 'status_changed', 'invoice_updated', 'details_updated')),
  previous_status text,
  new_status text,
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index job_stage_events_stage_created_idx on public.job_stage_events(stage_id, created_at desc);
create index job_stage_events_job_created_idx on public.job_stage_events(job_id, created_at desc);

create or replace function public.touch_job_stage_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger job_stages_touch_updated_at
before update on public.job_stages
for each row execute function public.touch_job_stage_updated_at();

create or replace function public.validate_job_stage_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.job_id is distinct from new.job_id
     or old.sequence is distinct from new.sequence
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'Immutable job stage identity';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'pending' and new.status = 'completed')
    or (old.status = 'completed' and new.status = 'invoiced')
    or (old.status = 'invoiced' and new.status = 'paid')
  ) then
    raise exception 'Invalid job stage transition';
  end if;

  if old.status = 'paid' and (
    old.invoice_number is distinct from new.invoice_number
    or old.invoice_path is distinct from new.invoice_path
    or old.title is distinct from new.title
    or old.description is distinct from new.description
  ) then
    raise exception 'Paid job stages are immutable';
  end if;
  return new;
end;
$$;

create trigger job_stages_validate_transition
before update on public.job_stages
for each row execute function public.validate_job_stage_transition();

create or replace function public.audit_job_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_action text;
begin
  if tg_op = 'INSERT' then
    event_action := 'created';
  elsif old.status is distinct from new.status then
    event_action := 'status_changed';
  elsif old.invoice_number is distinct from new.invoice_number
     or old.invoice_path is distinct from new.invoice_path then
    event_action := 'invoice_updated';
  else
    event_action := 'details_updated';
  end if;

  insert into public.job_stage_events (
    stage_id,
    job_id,
    action,
    previous_status,
    new_status,
    actor_id,
    metadata
  ) values (
    new.id,
    new.job_id,
    event_action,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    coalesce(auth.uid(), new.created_by),
    jsonb_build_object(
      'sequence', new.sequence,
      'title', new.title,
      'invoice_number', new.invoice_number
    )
  );
  return new;
end;
$$;

create trigger job_stages_audit
after insert or update on public.job_stages
for each row execute function public.audit_job_stage_change();

alter table public.job_stages enable row level security;
alter table public.job_stage_events enable row level security;

create policy "Office staff can view job stages"
on public.job_stages for select to authenticated
using (public.is_office_staff());

create policy "Office staff can create job stages"
on public.job_stages for insert to authenticated
with check (
  public.is_office_staff()
  and created_by = auth.uid()
  and exists (
    select 1 from public.jobs j
    where j.id = job_id and j.archived_at is null
  )
);

create policy "Office staff can update job stages"
on public.job_stages for update to authenticated
using (
  public.is_office_staff()
  and exists (
    select 1 from public.jobs j
    where j.id = job_id and j.archived_at is null
  )
)
with check (
  public.is_office_staff()
  and exists (
    select 1 from public.jobs j
    where j.id = job_id and j.archived_at is null
  )
);

create policy "Office staff can view job stage events"
on public.job_stage_events for select to authenticated
using (public.is_office_staff());

grant select, insert, update on table public.job_stages to authenticated;
grant select on table public.job_stage_events to authenticated;
revoke insert, update, delete on table public.job_stage_events from authenticated;

insert into public.job_stages (
  job_id,
  sequence,
  title,
  status,
  invoice_number,
  invoice_path,
  completed_at,
  invoiced_at,
  paid_at,
  created_at,
  updated_at
)
select
  j.id,
  1,
  'Entrega original',
  case when j.main_status = 'pagado' then 'paid' else 'invoiced' end,
  j.invoice_number,
  j.invoice_path,
  coalesce(j.approved_at, j.invoiced_at, j.updated_at),
  coalesce(j.invoiced_at, j.updated_at),
  case when j.main_status = 'pagado' then coalesce(j.paid_at, j.updated_at) else null end,
  j.created_at,
  j.updated_at
from public.jobs j
where j.main_status in ('facturado', 'pagado')
  and j.invoice_number is not null
on conflict (job_id, sequence) do nothing;

comment on table public.job_stages is
  'Independent billable parts of a job. A completed or paid stage never closes the parent job.';
comment on table public.job_stage_events is
  'Append-only audit trail for each billable job stage.';
