-- Weekly worker operations, structured archive reasons and audited evidence
-- removal. All timestamps remain UTC; weekly boundaries are calculated from
-- America/New_York civil dates with an exclusive end for DST safety.

create table if not exists public.job_photo_deletion_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  photo_id uuid not null,
  storage_path text not null,
  uploaded_by uuid,
  uploaded_at timestamptz not null,
  deleted_by uuid not null,
  deleted_at timestamptz not null default clock_timestamp()
);

create index if not exists job_photo_deletion_events_job_time_idx
  on public.job_photo_deletion_events (job_id, deleted_at desc, id);
alter table public.job_photo_deletion_events enable row level security;
drop policy if exists "Admins view photo deletion audit" on public.job_photo_deletion_events;
create policy "Admins view photo deletion audit"
on public.job_photo_deletion_events for select to authenticated
using (public.is_admin());
revoke insert, update, delete on public.job_photo_deletion_events from authenticated;
grant select on public.job_photo_deletion_events to authenticated;

drop policy if exists "Office staff can view photos" on public.job_photos;
create policy "Office staff view active photos and admin audit"
on public.job_photos for select to authenticated
using (public.is_office_staff() and (deleted_at is null or public.is_admin()));

create or replace function public.delete_job_photo_audited(p_photo_id uuid)
returns table(queue_id bigint, job_id uuid, bucket_id text, object_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  photo public.job_photos%rowtype;
  cleanup_id bigint;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  select * into photo from public.job_photos where id = p_photo_id for update;
  if photo.id is null then raise exception 'Photo unavailable'; end if;

  if photo.deleted_at is null then
    insert into public.job_deletion_cleanup_queue(job_id, bucket_id, object_name, requested_by)
    values(photo.job_id, 'job-evidence', photo.storage_path, actor)
    on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key
    do update set job_id = excluded.job_id, requested_by = excluded.requested_by,
      last_error = null
    returning id into cleanup_id;

    update public.job_photos
    set deleted_at = clock_timestamp(), deleted_by = actor
    where id = photo.id;

    insert into public.job_photo_deletion_events(
      job_id, photo_id, storage_path, uploaded_by, uploaded_at,
      deleted_by, deleted_at
    ) values (
      photo.job_id, photo.id, photo.storage_path, photo.uploaded_by,
      photo.created_at, actor, clock_timestamp()
    );
  else
    select q.id into cleanup_id
    from public.job_deletion_cleanup_queue q
    where q.bucket_id = 'job-evidence' and q.object_name = photo.storage_path;
  end if;

  return query select cleanup_id, photo.job_id, 'job-evidence'::text, photo.storage_path;
end;
$$;

create or replace function public.set_job_archived_v2(
  p_job_id uuid,
  p_archived boolean,
  p_reason_code text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  clean_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  event_time timestamptz := clock_timestamp();
  reason_label text;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  if p_archived is null then raise exception 'Archive state required'; end if;
  if p_archived and p_reason_code not in (
    'duplicate_job', 'cancelled_by_client_or_office', 'incorrect_address_or_data',
    'no_access_or_blocked_conditions', 'out_of_scope'
  ) then raise exception 'Archive reason required'; end if;
  if clean_notes is not null and char_length(clean_notes) > 2000 then
    raise exception 'Archive notes are too long';
  end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null then raise exception 'Job unavailable'; end if;
  if p_archived = (selected_job.archived_at is not null) then return; end if;

  reason_label := case p_reason_code
    when 'duplicate_job' then 'Trabajo duplicado'
    when 'cancelled_by_client_or_office' then 'Cancelado por el cliente o la oficina'
    when 'incorrect_address_or_data' then 'Dirección o datos incorrectos'
    when 'no_access_or_blocked_conditions' then 'Sin acceso o condiciones que impiden realizarlo'
    when 'out_of_scope' then 'Fuera de alcance o no corresponde a Susotech'
  end;

  perform set_config('app.job_archive_mutation', actor::text, true);
  update public.jobs
  set archived_at = case when p_archived then event_time else null end,
      archived_by = case when p_archived then actor else null end,
      archive_reason = case when p_archived then reason_label else null end,
      archive_reason_code = case when p_archived then p_reason_code else null end,
      archive_notes = case when p_archived then clean_notes else null end,
      updated_at = event_time
  where id = p_job_id;

  insert into public.job_archive_events(
    job_id, event_type, reason_code, notes, actor_id, occurred_at, is_legacy
  ) values (
    p_job_id, case when p_archived then 'archived' else 'restored' end,
    case when p_archived then p_reason_code else null end,
    case when p_archived then clean_notes else null end,
    actor, event_time, false
  );
end;
$$;

create or replace function public.list_job_archive_events_for_office(p_job_id uuid)
returns table(
  id uuid, event_type text, reason_code text, notes text, actor_id uuid,
  actor_name text, occurred_at timestamptz, is_legacy boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  if not exists (select 1 from public.jobs j where j.id = p_job_id) then
    raise exception 'Job unavailable';
  end if;
  return query
  select e.id, e.event_type, e.reason_code, e.notes, e.actor_id,
    coalesce(nullif(btrim(p.full_name), ''), p.email), e.occurred_at, e.is_legacy
  from public.job_archive_events e
  left join public.profiles p on p.id = e.actor_id
  where e.job_id = p_job_id
  order by e.occurred_at desc, e.id desc;
end;
$$;

create or replace function public.get_worker_operations_dashboard(
  p_reference_at timestamptz default clock_timestamp()
)
returns table(
  technician_id uuid,
  technician_name text,
  crew_names text[],
  is_shift_active boolean,
  shift_started_at timestamptz,
  shift_active_until timestamptz,
  weekly_production numeric,
  weekly_delivered_jobs bigint,
  weekly_fuel_amount numeric,
  production_breakdown jsonb,
  server_now timestamptz,
  week_start_at timestamptz,
  week_end_exclusive_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  as_of timestamptz := coalesce(p_reference_at, clock_timestamp());
  local_date date;
  start_date date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  local_date := (as_of at time zone 'America/New_York')::date;
  start_date := local_date - ((extract(dow from local_date)::integer + 2) % 7);
  starts_at := start_date::timestamp at time zone 'America/New_York';
  ends_at := (start_date + 7)::timestamp at time zone 'America/New_York';

  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    coalesce(crews.names, '{}'::text[]),
    coalesce(latest.started_at <= as_of and latest.active_until > as_of, false),
    latest.started_at, latest.active_until,
    coalesce(production.total_quantity, 0)::numeric,
    coalesce(delivered.delivered_jobs, 0)::bigint,
    coalesce(fuel.total_amount, 0)::numeric,
    coalesce(breakdown.items, '[]'::jsonb),
    as_of, starts_at, ends_at
  from public.profiles p
  left join lateral (
    select array_agg(distinct c.name order by c.name) as names
    from public.crews c
    left join public.crew_members cm on cm.crew_id = c.id
    where c.is_active and (c.lead_technician_id = p.id or cm.technician_id = p.id)
  ) crews on true
  left join lateral (
    select s.started_at, s.active_until
    from public.technician_shifts s
    where s.technician_id = p.id
    order by s.started_at desc limit 1
  ) latest on true
  left join lateral (
    select sum(l.quantity) as total_quantity
    from public.job_delivery_production_lines l
    join public.job_deliveries d on d.id = l.delivery_id
    where l.credited_technician_id = p.id
      and d.submitted and d.superseded_at is null
      and l.credited_at >= starts_at and l.credited_at < ends_at
  ) production on true
  left join lateral (
    select count(distinct d.job_id) as delivered_jobs
    from public.job_deliveries d
    where d.delivered_by = p.id
      and d.submitted and d.superseded_at is null
      and d.confirmed_at >= starts_at and d.confirmed_at < ends_at
  ) delivered on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', grouped.code, 'unit', grouped.unit_snapshot,
      'quantity', grouped.quantity
    ) order by grouped.code, grouped.unit_snapshot) as items
    from (
      select l.code, l.unit_snapshot, sum(l.quantity) as quantity
      from public.job_delivery_production_lines l
      join public.job_deliveries d on d.id = l.delivery_id
      where l.credited_technician_id = p.id
        and d.submitted and d.superseded_at is null
        and l.credited_at >= starts_at and l.credited_at < ends_at
      group by l.code, l.unit_snapshot
    ) grouped
  ) breakdown on true
  left join lateral (
    select sum(s.fuel_amount) as total_amount
    from public.technician_shifts s
    where s.technician_id = p.id
      and s.started_at >= starts_at and s.started_at < ends_at
  ) fuel on true
  where p.role = 'tecnico' and p.is_active
  order by coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

-- Keep the existing technician and office production reports, but source them
-- from the definitive current delivery ledger rather than editor-time inputs.
create or replace function public.get_my_weekly_production(p_reference_date date default null)
returns table(
  week_start date, week_end date, production_date date, code text,
  description text, unit text, quantity numeric, amount numeric,
  billing_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select coalesce(p_reference_date, (clock_timestamp() at time zone 'America/New_York')::date) as ref
  ), week as (
    select (ref - ((extract(dow from ref)::integer + 2) % 7))::date as starts
    from bounds
  ), instants as (
    select starts,
      starts::timestamp at time zone 'America/New_York' as starts_at,
      (starts + 7)::timestamp at time zone 'America/New_York' as ends_at
    from week
  )
  select w.starts, w.starts + 6,
    (l.credited_at at time zone 'America/New_York')::date,
    l.code, coalesce(c.description, legacy_catalog.description, l.code),
    l.unit_snapshot, l.quantity, l.amount_snapshot,
    case when j.main_status in ('aprobado','listo_pagar','pagado')
      then 'confirmed' else 'pending' end
  from instants w
  join public.job_delivery_production_lines l
    on l.credited_at >= w.starts_at and l.credited_at < w.ends_at
  join public.job_deliveries d
    on d.id = l.delivery_id and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = l.job_id
  left join public.job_pdf_annotations a on a.id = l.source_annotation_id
  left join public.production_code_catalog c on c.id = a.catalog_id
  left join public.job_production_codes legacy on legacy.id = l.legacy_production_code_id
  left join public.production_code_catalog legacy_catalog on legacy_catalog.id = legacy.catalog_id
  where l.credited_technician_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'tecnico' and p.is_active
    )
  order by 3, l.code;
$$;

create or replace function public.get_production_report(p_start_date date, p_end_date date)
returns table(
  production_date date, technician_id uuid, technician_name text,
  code text, description text, unit text, quantity numeric,
  unit_rate numeric, amount numeric, billing_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366
  then raise exception 'Invalid date range'; end if;
  starts_at := p_start_date::timestamp at time zone 'America/New_York';
  ends_at := (p_end_date + 1)::timestamp at time zone 'America/New_York';

  return query
  select (l.credited_at at time zone 'America/New_York')::date,
    l.credited_technician_id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    l.code, coalesce(c.description, legacy_catalog.description, l.code),
    l.unit_snapshot, l.quantity, l.unit_rate_snapshot, l.amount_snapshot,
    case when j.main_status in ('aprobado','listo_pagar','pagado')
      then 'confirmed' else 'pending' end
  from public.job_delivery_production_lines l
  join public.job_deliveries d
    on d.id = l.delivery_id and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = l.job_id
  join public.profiles p on p.id = l.credited_technician_id
  left join public.job_pdf_annotations a on a.id = l.source_annotation_id
  left join public.production_code_catalog c on c.id = a.catalog_id
  left join public.job_production_codes legacy on legacy.id = l.legacy_production_code_id
  left join public.production_code_catalog legacy_catalog on legacy_catalog.id = legacy.catalog_id
  where l.credited_at >= starts_at and l.credited_at < ends_at
  order by 1 desc, 3, l.code;
end;
$$;

-- Keep assignment history RPC-only. The legacy function was SECURITY INVOKER
-- and therefore required a broad INSERT grant on the audit table.
create or replace function public.assign_jobs_atomic(
  job_ids uuid[],
  new_assignee_type public.assignee_type,
  new_assignee_id uuid
)
returns setof public.job_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_office_staff(actor) then
    raise exception 'Only active office staff can assign jobs';
  end if;
  if coalesce(array_length(job_ids, 1), 0) = 0
    or array_length(job_ids, 1) > 100
    or (select count(distinct id) from unnest(job_ids) id) <> array_length(job_ids, 1)
  then raise exception 'One to 100 unique jobs are required'; end if;

  perform 1 from public.jobs where id = any(job_ids) for update;
  if (select count(*) from public.jobs where id = any(job_ids)) <> array_length(job_ids, 1) then
    raise exception 'One or more jobs are unavailable';
  end if;
  if new_assignee_type = 'technician' and not exists (
    select 1 from public.profiles p
    where p.id = new_assignee_id and p.role = 'tecnico' and p.is_active
  ) then raise exception 'Technician unavailable'; end if;
  if new_assignee_type = 'crew' and not exists (
    select 1 from public.crews c where c.id = new_assignee_id and c.is_active
  ) then raise exception 'Crew unavailable'; end if;

  update public.job_assignments
  set active = false, is_primary = false
  where job_id = any(job_ids) and active and is_primary;

  insert into public.job_status_history (
    job_id, previous_status, new_status, previous_incident, new_incident,
    changed_by, notes
  )
  select j.id, j.main_status, j.main_status, j.incident, j.incident,
    actor, 'Assignment updated'
  from public.jobs j where j.id = any(job_ids);

  return query
  insert into public.job_assignments (
    job_id, assignee_type, technician_id, crew_id, assigned_by
  )
  select j.id, new_assignee_type,
    case when new_assignee_type = 'technician' then new_assignee_id end,
    case when new_assignee_type = 'crew' then new_assignee_id end,
    actor
  from public.jobs j where j.id = any(job_ids)
  returning *;
end;
$$;

revoke all on function public.delete_job_photo_audited(uuid) from public;
revoke all on function public.set_job_archived_v2(uuid, boolean, text, text) from public;
revoke all on function public.get_worker_operations_dashboard(timestamptz) from public;
revoke all on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) from public;
revoke all on function public.get_my_weekly_production(date) from public;
revoke all on function public.get_production_report(date, date) from public;
revoke all on function public.list_job_archive_events_for_office(uuid) from public;
-- Keep the legacy archive RPC only during the expansion deployment. The
-- follow-up contract migration removes access after the v2 portal is live.
grant execute on function public.delete_job_photo_audited(uuid) to authenticated;
grant execute on function public.set_job_archived_v2(uuid, boolean, text, text) to authenticated;
grant execute on function public.get_worker_operations_dashboard(timestamptz) to authenticated;
grant execute on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) to authenticated;
grant execute on function public.get_my_weekly_production(date) to authenticated;
grant execute on function public.get_production_report(date, date) to authenticated;
grant execute on function public.list_job_archive_events_for_office(uuid) to authenticated;

-- The original job module defined RLS but omitted some corresponding table
-- privileges from its reproducible migration. Restore only the operations the
-- application actually uses; sensitive audit/production/photo deletion paths
-- remain RPC-only.
grant select, insert, update on table public.jobs to authenticated;
revoke delete on table public.jobs from authenticated;
grant select on table public.profiles to authenticated;
revoke insert, update, delete on table public.profiles from authenticated;
grant select, insert, update, delete on table
  public.crews,
  public.crew_members,
  public.job_assignments
to authenticated;
grant select on table public.job_status_history, public.job_production_codes to authenticated;
revoke insert, update, delete on table public.job_status_history, public.job_production_codes from authenticated;
grant select, insert on table public.job_photos to authenticated;
revoke update, delete on table public.job_photos from authenticated;

-- The server-only service client already bypasses RLS by design, but fresh
-- self-hosted/local stacks do not inherit authenticated table grants. Grant
-- only the operational tables used for verification, PDF composition and
-- durable cleanup; the key remains server-side.
grant select, insert, update, delete on table
  public.profiles,
  public.jobs,
  public.crews,
  public.crew_members,
  public.job_assignments,
  public.technician_shifts,
  public.production_code_catalog,
  public.job_documents,
  public.job_pdf_drafts,
  public.job_pdf_delivery_versions,
  public.job_status_history,
  public.job_production_codes,
  public.job_pdf_annotations,
  public.job_deliveries,
  public.job_delivery_production_lines,
  public.job_photos,
  public.job_photo_deletion_events,
  public.job_archive_events,
  public.job_deletion_cleanup_queue
to service_role;
grant usage, select on all sequences in schema public to service_role;
