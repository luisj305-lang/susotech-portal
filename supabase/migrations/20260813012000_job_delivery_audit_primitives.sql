-- Normalized annotation, immutable delivery, production-credit and archive
-- event primitives. Existing JSON drafts and jobs PDF pointers remain intact.

create table if not exists public.job_pdf_annotations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  draft_version integer not null check (draft_version >= 0),
  source_document_id uuid not null,
  catalog_id uuid not null references public.production_code_catalog(id),
  code_snapshot text not null check (char_length(btrim(code_snapshot)) between 1 and 64),
  quantity numeric(14,2) not null check (quantity > 0),
  source_page integer not null check (source_page between 1 and 500),
  box_x numeric(10,9) not null check (box_x between 0 and 1),
  box_y numeric(10,9) not null check (box_y between 0 and 1),
  box_width numeric(10,9) not null check (box_width > 0 and box_width <= 1),
  box_height numeric(10,9) not null check (box_height > 0 and box_height <= 1),
  arrow_tip_x numeric(10,9) not null check (arrow_tip_x between 0 and 1),
  arrow_tip_y numeric(10,9) not null check (arrow_tip_y between 0 and 1),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_pdf_annotations_box_bounds_check
    check (box_x + box_width <= 1 and box_y + box_height <= 1),
  constraint job_pdf_annotations_source_document_fk
    foreign key (job_id, source_document_id)
    references public.job_documents(job_id, id),
  unique (job_id, draft_version, id)
);

create index if not exists job_pdf_annotations_job_version_idx
  on public.job_pdf_annotations (
    job_id, draft_version, source_document_id, source_page, id
  );
alter table public.job_pdf_annotations enable row level security;
drop policy if exists "Authorized users view PDF annotations" on public.job_pdf_annotations;
create policy "Authorized users view PDF annotations"
on public.job_pdf_annotations for select to authenticated
using (public.can_access_job(job_id));
revoke insert, update, delete on public.job_pdf_annotations from authenticated;
grant select on public.job_pdf_annotations to authenticated;

create table if not exists public.job_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  storage_path text not null unique,
  delivery_kind text not null check (delivery_kind in ('submission', 'regeneration', 'legacy')),
  draft_version integer check (draft_version is null or draft_version >= 0),
  source_document_ids uuid[] not null default '{}'::uuid[],
  source_photo_ids uuid[] not null default '{}'::uuid[],
  source_annotation_ids uuid[] not null default '{}'::uuid[],
  annotation_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(annotation_snapshot) = 'array'),
  snapshot_hash text,
  delivered_by uuid,
  replaces_delivery_id uuid references public.job_deliveries(id) on delete set null,
  submitted boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint job_deliveries_storage_path_check check (
    storage_path ~ ('^' || job_id::text || '/delivered/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$')
  ),
  constraint job_deliveries_snapshot_hash_check
    check (snapshot_hash is null or snapshot_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists job_deliveries_job_created_idx
  on public.job_deliveries (job_id, created_at desc, id);
create unique index if not exists job_deliveries_current_submission_idx
  on public.job_deliveries (job_id)
  where submitted and superseded_at is null;
alter table public.job_deliveries enable row level security;
drop policy if exists "Authorized users view job deliveries" on public.job_deliveries;
create policy "Authorized users view job deliveries"
on public.job_deliveries for select to authenticated
using (public.can_access_job(job_id));
revoke insert, update, delete on public.job_deliveries from authenticated;
grant select on public.job_deliveries to authenticated;

-- Preserve every currently referenced delivered PDF as a legacy immutable
-- version. Only source metadata that already exists is copied.
insert into public.job_deliveries (
  job_id, storage_path, delivery_kind, draft_version,
  source_document_ids, source_photo_ids, source_annotation_ids,
  annotation_snapshot, delivered_by, submitted, created_at, confirmed_at
)
select j.id, j.delivered_pdf_path, 'legacy', v.draft_version,
  coalesce((
    select array_agg(d.id order by d.position, d.created_at, d.id)
    from public.job_documents d
    where d.job_id = j.id
      and d.status = 'active'
      and d.deleted_at is null
  ), '{}'::uuid[]),
  coalesce(j.delivered_pdf_source_photo_ids, '{}'::uuid[]),
  '{}'::uuid[], '[]'::jsonb, j.delivered_pdf_generated_by,
  j.main_status in (
    'enviado_revision', 'aprobado', 'listo_pagar', 'pagado'
  ),
  coalesce(j.delivered_pdf_generated_at, v.confirmed_at, j.updated_at),
  coalesce(j.delivered_pdf_generated_at, v.confirmed_at, j.updated_at)
from public.jobs j
left join public.job_pdf_delivery_versions v on v.job_id = j.id
where j.delivered_pdf_path is not null
on conflict (storage_path) do nothing;

create table if not exists public.job_delivery_production_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.job_deliveries(id) on delete cascade,
  job_id uuid not null,
  source_annotation_id uuid not null,
  credited_technician_id uuid not null,
  code text not null check (char_length(btrim(code)) between 1 and 64),
  quantity numeric(14,2) not null check (quantity > 0),
  technician_type_snapshot text check (
    technician_type_snapshot is null
    or technician_type_snapshot in ('in_house', 'contractor')
  ),
  unit_snapshot text check (
    unit_snapshot is null or unit_snapshot in ('fixed', 'foot', 'hour', 'event')
  ),
  unit_rate_snapshot numeric(12,3) check (
    unit_rate_snapshot is null or unit_rate_snapshot >= 0
  ),
  amount_snapshot numeric(14,2) check (
    amount_snapshot is null or amount_snapshot >= 0
  ),
  credited_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (delivery_id, source_annotation_id)
);

create index if not exists job_delivery_production_technician_time_idx
  on public.job_delivery_production_lines (credited_technician_id, credited_at);
create or replace function public.validate_delivery_production_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.job_deliveries d
    where d.id = new.delivery_id and d.job_id = new.job_id
  ) or not exists (
    select 1
    from public.job_pdf_annotations a
    where a.id = new.source_annotation_id and a.job_id = new.job_id
  ) then
    raise exception 'Delivery production lineage is invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_delivery_production_line_before_write
on public.job_delivery_production_lines;
create trigger validate_delivery_production_line_before_write
before insert or update on public.job_delivery_production_lines
for each row execute function public.validate_delivery_production_line();

alter table public.job_delivery_production_lines enable row level security;
drop policy if exists "Authorized users view delivery production" on public.job_delivery_production_lines;
create policy "Authorized users view delivery production"
on public.job_delivery_production_lines for select to authenticated
using (public.can_access_job(job_id));
revoke insert, update, delete on public.job_delivery_production_lines from authenticated;
grant select on public.job_delivery_production_lines to authenticated;
revoke all on function public.validate_delivery_production_line() from public;

alter table public.jobs
  add column if not exists archive_reason_code text,
  add column if not exists archive_notes text;

alter table public.jobs drop constraint if exists jobs_archive_reason_code_check;
alter table public.jobs add constraint jobs_archive_reason_code_check check (
  archive_reason_code is null or archive_reason_code in (
    'duplicate_job',
    'cancelled_by_client_or_office',
    'incorrect_address_or_data',
    'no_access_or_blocked_conditions',
    'out_of_scope'
  )
);
alter table public.jobs drop constraint if exists jobs_archive_notes_length_check;
alter table public.jobs add constraint jobs_archive_notes_length_check
  check (archive_notes is null or char_length(archive_notes) <= 2000);

-- The legacy authorization trigger rejects migration-session updates because
-- auth.uid() is intentionally null. Disabling this row trigger takes an
-- ACCESS EXCLUSIVE lock, so concurrent job writes wait until the transactional
-- backfill has completed and the trigger is enabled again.
alter table public.jobs disable trigger validate_job_before_update;
update public.jobs
set archive_notes = left(archive_reason, 2000)
where archive_notes is null and archive_reason is not null;
alter table public.jobs enable trigger validate_job_before_update;

create table if not exists public.job_archive_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  event_type text not null check (event_type in ('archived', 'restored')),
  reason_code text check (reason_code is null or reason_code in (
    'duplicate_job',
    'cancelled_by_client_or_office',
    'incorrect_address_or_data',
    'no_access_or_blocked_conditions',
    'out_of_scope'
  )),
  notes text check (notes is null or char_length(notes) <= 2000),
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  is_legacy boolean not null default false,
  constraint job_archive_events_reason_check check (
    event_type = 'restored' or reason_code is not null or is_legacy
  )
);

create index if not exists job_archive_events_job_time_idx
  on public.job_archive_events (job_id, occurred_at desc, id);
alter table public.job_archive_events enable row level security;
drop policy if exists "Authorized users view archive events" on public.job_archive_events;
create policy "Authorized users view archive events"
on public.job_archive_events for select to authenticated
using (public.can_access_job(job_id));
revoke insert, update, delete on public.job_archive_events from authenticated;
grant select on public.job_archive_events to authenticated;

insert into public.job_archive_events (
  job_id, event_type, reason_code, notes, actor_id, occurred_at, is_legacy
)
select j.id, 'archived', null, left(j.archive_reason, 2000),
  j.archived_by, j.archived_at, true
from public.jobs j
where j.archived_at is not null
  and not exists (
    select 1 from public.job_archive_events e
    where e.job_id = j.id and e.event_type = 'archived'
      and e.occurred_at = j.archived_at and e.is_legacy
  );

alter table public.job_photos
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

alter table public.job_photos drop constraint if exists job_photos_soft_delete_pair_check;
alter table public.job_photos add constraint job_photos_soft_delete_pair_check check (
  (deleted_at is null and deleted_by is null)
  or (deleted_at is not null and deleted_by is not null)
);
create index if not exists job_photos_active_job_created_idx
  on public.job_photos (job_id, created_at, id)
  where deleted_at is null;

-- No current row is marked deleted, so existing readers remain compatible
-- until the audited deletion RPC and active-only UI are added in a later phase.
