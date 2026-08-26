alter table public.jobs
  add column if not exists postal_code text,
  add column if not exists google_place_id text,
  add column if not exists geocoding_status text not null default 'pending',
  add column if not exists geocoded_at timestamptz;

alter table public.jobs
  add constraint jobs_postal_code_format_check
    check (postal_code is null or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  add constraint jobs_google_place_id_check
    check (google_place_id is null or (google_place_id = btrim(google_place_id) and char_length(google_place_id) between 1 and 255)),
  add constraint jobs_geocoding_status_check
    check (geocoding_status in ('pending', 'resolved', 'failed')),
  add constraint jobs_geocoding_resolution_check
    check (
      (geocoding_status = 'resolved' and google_place_id is not null and geocoded_at is not null)
      or geocoding_status <> 'resolved'
    );

create index jobs_postal_code_idx on public.jobs(postal_code) where postal_code is not null;
create index jobs_route_candidates_idx on public.jobs(main_status, updated_at desc)
  where archived_at is null and main_status in ('sin_asignar', 'asignado', 'en_progreso');
create index job_stages_pending_job_idx on public.job_stages(job_id) where status = 'pending';

-- The normal jobs trigger rejects unauthenticated writes. This data-only
-- backfill runs as the migration owner, so bypass that trigger for this
-- statement without weakening the runtime authorization contract.
alter table public.jobs disable trigger validate_job_before_update;
alter table public.jobs disable trigger guard_active_shift_job_update_before_update;

update public.jobs
set postal_code = substring(location from '([0-9]{5}(-[0-9]{4})?)[[:space:]]*$')
where postal_code is null
  and location ~ '[0-9]{5}(-[0-9]{4})?[[:space:]]*$';

alter table public.jobs enable trigger validate_job_before_update;
alter table public.jobs enable trigger guard_active_shift_job_update_before_update;

create table public.job_route_settings (
  id boolean primary key default true check (id),
  origin_address text not null check (char_length(btrim(origin_address)) between 1 and 500),
  origin_place_id text not null check (origin_place_id = btrim(origin_place_id) and char_length(origin_place_id) between 1 and 255),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.job_route_settings enable row level security;

create view public.job_route_candidates
with (security_invoker = true)
as
select
  j.id,
  j.prism_number,
  j.title,
  j.address,
  j.location,
  j.postal_code,
  j.google_place_id,
  j.geocoding_status,
  j.deadline_date
from public.jobs j
where j.archived_at is null
  and (
    j.main_status in ('sin_asignar', 'asignado', 'en_progreso')
    or exists (
      select 1 from public.job_stages s
      where s.job_id = j.id and s.status = 'pending'
    )
  );

create policy "Admins can view route settings"
on public.job_route_settings for select to authenticated
using (public.is_admin(auth.uid()));

create policy "Admins can create route settings"
on public.job_route_settings for insert to authenticated
with check (public.is_admin(auth.uid()) and updated_by = auth.uid());

create policy "Admins can update route settings"
on public.job_route_settings for update to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()) and updated_by = auth.uid());

grant select, insert, update on table public.job_route_settings to authenticated;
revoke delete on table public.job_route_settings from authenticated;
grant select on table public.job_route_candidates to authenticated;

comment on column public.jobs.postal_code is 'Dedicated US ZIP code used for human filtering and grouping.';
comment on column public.jobs.google_place_id is 'Persistable Google Place ID. Coordinates and geocoding responses are intentionally not stored.';
comment on table public.job_route_settings is 'Singleton admin-owned origin for round-trip job route planning.';
comment on view public.job_route_candidates is 'Field work or jobs reopened operationally by an independent pending billable stage.';
