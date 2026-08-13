-- Close currently reachable supervisor mutation paths without enabling any new
-- UI. Admin Storage cleanup remains available for existing queued workflows.

drop policy if exists "Office staff can manage photos" on public.job_photos;
drop policy if exists "Office staff can view photos" on public.job_photos;
drop policy if exists "Office staff can add photos" on public.job_photos;
drop policy if exists "Technicians can view photos of assigned jobs" on public.job_photos;

create policy "Office staff can view photos"
on public.job_photos for select to authenticated
using (public.is_office_staff());

create policy "Technicians can view active photos of assigned jobs"
on public.job_photos for select to authenticated
using (
  deleted_at is null
  and public.is_technician()
  and public.can_access_job(job_id)
);

-- Direct UPDATE/DELETE stays unavailable to every authenticated role. A later
-- admin-only audited RPC will own the soft-delete transition.
revoke update, delete on public.job_photos from authenticated;

drop policy if exists "Office staff can manage job evidence objects" on storage.objects;
drop policy if exists "Office staff can read job evidence objects" on storage.objects;
drop policy if exists "Office staff can upload job evidence objects" on storage.objects;
drop policy if exists "Admins can update job evidence objects" on storage.objects;
drop policy if exists "Admins can delete job evidence objects" on storage.objects;

create or replace function public.is_queued_job_cleanup_object(
  check_bucket_id text,
  check_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_deletion_cleanup_queue q
    where q.bucket_id = check_bucket_id
      and q.object_name = check_object_name
  );
$$;

create policy "Office staff can read job evidence objects"
on storage.objects for select to authenticated
using (bucket_id = 'job-evidence' and public.is_office_staff());

create policy "Admins can delete job evidence objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'job-evidence'
  and public.is_admin()
  and public.is_queued_job_cleanup_object(bucket_id, name)
);

-- Additional and delivered document paths are admin-only. Office staff keep
-- the existing root-PDF import workflow, but referenced source objects become
-- immutable after confirmation.
drop policy if exists "Office staff can upload project files" on storage.objects;
drop policy if exists "Office staff can update project files" on storage.objects;
drop policy if exists "Office staff can delete unreferenced project files"
  on storage.objects;
drop policy if exists "Admins can delete project files" on storage.objects;

create policy "Office staff can upload project files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and (
    public.is_admin()
    or name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+[.]pdf$'
  )
);

create policy "Office staff can update project files"
on storage.objects for update to authenticated
using (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and not public.is_referenced_project_file(name)
  and (
    public.is_admin()
    or name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+[.]pdf$'
  )
)
with check (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and not public.is_referenced_project_file(name)
  and (
    public.is_admin()
    or name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+[.]pdf$'
  )
);

create policy "Admins can delete project files"
on storage.objects for delete to authenticated
using (bucket_id = 'project-files' and public.is_admin());

create policy "Supervisors can delete unreferenced original uploads"
on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and not public.is_admin()
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+[.]pdf$'
  and not public.is_referenced_project_file(name)
);

create or replace function public.guard_job_archive_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    old.archived_at is distinct from new.archived_at
    or old.archived_by is distinct from new.archived_by
    or old.archive_reason is distinct from new.archive_reason
    or old.archive_reason_code is distinct from new.archive_reason_code
    or old.archive_notes is distinct from new.archive_notes
  ) and not coalesce(
    current_setting('app.job_archive_mutation', true) = auth.uid()::text,
    false
  ) then
    raise exception 'Archive fields must be changed through the audited archive operation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_job_archive_fields_before_update on public.jobs;
create trigger guard_job_archive_fields_before_update
before update on public.jobs
for each row execute function public.guard_job_archive_fields();

-- Preserve the legacy RPC signature used by the current admin UI while making
-- it the only authenticated archive mutation path and recording every event.
create or replace function public.set_job_archived(
  p_job_id uuid,
  p_archived boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  event_time timestamptz := now();
begin
  if not public.is_admin(actor) then
    raise exception 'Admin access required';
  end if;
  if p_archived is null then
    raise exception 'Archive state required';
  end if;
  if p_archived and clean_reason is null then
    raise exception 'Archive reason required';
  end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null then raise exception 'Job unavailable'; end if;
  if p_archived = (selected_job.archived_at is not null) then return; end if;

  perform set_config('app.job_archive_mutation', actor::text, true);
  update public.jobs
  set archived_at = case when p_archived then event_time else null end,
      archived_by = case when p_archived then actor else null end,
      archive_reason = case when p_archived then left(clean_reason, 1000) else null end,
      archive_reason_code = null,
      archive_notes = case when p_archived then left(clean_reason, 2000) else null end,
      updated_at = event_time
  where id = p_job_id;

  insert into public.job_archive_events (
    job_id, event_type, reason_code, notes, actor_id, occurred_at, is_legacy
  ) values (
    p_job_id,
    case when p_archived then 'archived' else 'restored' end,
    null,
    case when p_archived then left(clean_reason, 2000) else null end,
    actor,
    event_time,
    true
  );
end;
$$;

revoke all on function public.set_job_archived(uuid, boolean, text) from public;
grant execute on function public.set_job_archived(uuid, boolean, text) to authenticated;

create or replace function public.guard_job_submission_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.main_status = 'en_progreso'
    and new.main_status = 'enviado_revision'
    and not coalesce(
      current_setting('app.delivered_pdf_confirmation', true) = auth.uid()::text,
      false
    )
  then
    raise exception 'Job submission requires an atomically confirmed delivered PDF';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_job_submission_confirmation_before_update on public.jobs;
create trigger guard_job_submission_confirmation_before_update
before update of main_status on public.jobs
for each row execute function public.guard_job_submission_confirmation();

revoke all on function public.guard_job_archive_fields() from public;
revoke all on function public.guard_job_submission_confirmation() from public;
revoke all on function public.is_queued_job_cleanup_object(text, text) from public;
grant execute on function public.is_queued_job_cleanup_object(text, text)
  to authenticated;

-- Keep technician submission through the existing atomic path, but reserve
-- non-submitting regeneration to administrators.
create or replace function public.confirm_delivered_job_pdf(
  p_job_id uuid,
  p_storage_path text,
  p_source_photo_ids uuid[],
  p_submit boolean default false
)
returns table(previous_storage_path text, delivered_status public.job_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  current_photo_ids uuid[];
  supplied_photo_ids uuid[];
  stored_size bigint;
  stored_mime text;
  stored_generator text;
  stored_job_id text;
  stored_photo_ids text;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;

  if selected_job.id is null or not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;

  if public.is_technician(actor) then
    if not p_submit or selected_job.main_status <> 'en_progreso' then
      raise exception 'Technicians can only deliver jobs in progress';
    end if;
  elsif public.is_admin(actor) then
    if p_submit or selected_job.main_status not in ('en_progreso', 'enviado_revision') then
      raise exception 'Administrators can only regenerate an editable delivered PDF';
    end if;
  else
    raise exception 'Delivered PDF confirmation is not authorized';
  end if;

  if p_storage_path !~ (
    '^' || p_job_id::text
    || '/delivered/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
  ) then raise exception 'Delivered PDF path is invalid'; end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into current_photo_ids
  from public.job_photos p
  where p.job_id = p_job_id and p.deleted_at is null;

  select coalesce(array_agg(value order by value), '{}'::uuid[])
  into supplied_photo_ids
  from unnest(coalesce(p_source_photo_ids, '{}'::uuid[])) as supplied(value);

  if cardinality(current_photo_ids) = 0 then
    raise exception 'At least one confirmed evidence photo is required';
  end if;
  if current_photo_ids is distinct from supplied_photo_ids then
    raise exception 'Evidence changed while the delivered PDF was generated';
  end if;

  select nullif(o.metadata ->> 'size', '')::bigint,
    lower(o.metadata ->> 'mimetype'),
    o.user_metadata ->> 'generator',
    o.user_metadata ->> 'job_id',
    o.user_metadata ->> 'source_photo_ids'
  into stored_size, stored_mime, stored_generator, stored_job_id, stored_photo_ids
  from storage.objects o
  where o.bucket_id = 'project-files' and o.name = p_storage_path;

  if stored_size is null or stored_size <= 0 or stored_size > 104857600
    or stored_mime is distinct from 'application/pdf'
    or stored_generator is distinct from 'susotech-portal'
    or stored_job_id is distinct from p_job_id::text
    or stored_photo_ids is distinct from array_to_string(current_photo_ids, ',')
  then
    raise exception 'Delivered PDF object is missing or invalid';
  end if;

  perform set_config('app.delivered_pdf_confirmation', actor::text, true);

  return query
  update public.jobs
  set delivered_pdf_path = p_storage_path,
    delivered_pdf_generated_at = now(),
    delivered_pdf_generated_by = actor,
    delivered_pdf_source_photo_ids = current_photo_ids,
    main_status = case
      when p_submit then 'enviado_revision'::public.job_status
      else main_status
    end
  where id = p_job_id
  returning selected_job.delivered_pdf_path, jobs.main_status;
end;
$$;

revoke all on function public.confirm_delivered_job_pdf(
  uuid, text, uuid[], boolean
) from public;
grant execute on function public.confirm_delivered_job_pdf(
  uuid, text, uuid[], boolean
) to authenticated;
