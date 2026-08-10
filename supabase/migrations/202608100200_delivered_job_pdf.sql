-- Delivered job PDF metadata, atomic confirmation, and evidence-write boundaries.

alter table public.jobs
  add column if not exists delivered_pdf_path text,
  add column if not exists delivered_pdf_generated_at timestamptz,
  add column if not exists delivered_pdf_generated_by uuid references public.profiles(id) on delete set null,
  add column if not exists delivered_pdf_source_photo_ids uuid[] not null default '{}'::uuid[];

alter table public.job_photos
  add column if not exists comment text;

alter table public.jobs drop constraint if exists jobs_delivered_pdf_path_check;
alter table public.jobs add constraint jobs_delivered_pdf_path_check check (
  delivered_pdf_path is null
  or delivered_pdf_path ~ ('^' || id::text || '/delivered/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$')
);

alter table public.job_photos drop constraint if exists job_photos_comment_length_check;
alter table public.job_photos add constraint job_photos_comment_length_check check (
  comment is null or char_length(comment) <= 2000
);

drop policy if exists "Technicians can add photos to assigned jobs" on public.job_photos;
create policy "Technicians can add photos to assigned jobs"
on public.job_photos for insert
to authenticated
with check (
  public.is_technician()
  and uploaded_by = auth.uid()
  and public.can_access_job(job_id)
  and public.job_id_from_storage_path(storage_path) = job_id
  and exists (
    select 1 from public.jobs
    where id = job_id and main_status = 'en_progreso'
  )
);

drop policy if exists "Technicians can upload assigned evidence objects" on storage.objects;
create policy "Technicians can upload assigned evidence objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'job-evidence'
  and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs
    where id = public.job_id_from_storage_path(name)
      and main_status = 'en_progreso'
  )
);

drop policy if exists "Technicians can retry assigned evidence uploads" on storage.objects;
create policy "Technicians can retry assigned evidence uploads"
on storage.objects for update
to authenticated
using (
  bucket_id = 'job-evidence'
  and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs
    where id = public.job_id_from_storage_path(name)
      and main_status = 'en_progreso'
  )
)
with check (
  bucket_id = 'job-evidence'
  and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs
    where id = public.job_id_from_storage_path(name)
      and main_status = 'en_progreso'
  )
);

-- Delivered metadata can only move through confirm_delivered_job_pdf(). The
-- transaction-local setting lets the existing trigger distinguish that narrow
-- RPC from a generic jobs update without granting direct privileged writes.
create or replace function public.validate_job_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  status_changed boolean := old.main_status is distinct from new.main_status;
  incident_changed boolean := old.incident is distinct from new.incident;
  delivered_changed boolean :=
    old.delivered_pdf_path is distinct from new.delivered_pdf_path
    or old.delivered_pdf_generated_at is distinct from new.delivered_pdf_generated_at
    or old.delivered_pdf_generated_by is distinct from new.delivered_pdf_generated_by
    or old.delivered_pdf_source_photo_ids is distinct from new.delivered_pdf_source_photo_ids;
  delivered_confirmation boolean := coalesce(
    current_setting('app.delivered_pdf_confirmation', true) = auth.uid()::text,
    false
  );
begin
  if status_changed and incident_changed then raise exception 'Status and incident must be changed separately'; end if;
  if delivered_changed and not delivered_confirmation then
    raise exception 'Delivered PDF metadata must be confirmed atomically';
  end if;

  if public.is_office_staff(auth.uid()) then
    if status_changed and not (
      (old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')
      or (old.main_status = 'enviado_revision' and new.main_status in ('aprobado', 'en_progreso'))
      or (old.main_status = 'aprobado' and new.main_status = 'listo_pagar')
      or (old.main_status = 'listo_pagar' and new.main_status = 'pagado')
    ) then raise exception 'Office status transition is not allowed'; end if;
    if old.main_status = 'enviado_revision' and new.main_status = 'en_progreso'
      and nullif(btrim(new.comments), '') is null then
      raise exception 'Returning a job to progress requires a reason';
    end if;
  else
    if not public.is_technician() or not public.can_access_job(old.id) then raise exception 'Job update not authorized'; end if;
    if (to_jsonb(new) - array[
        'main_status','incident','incident_notes','comments','updated_at',
        'delivered_pdf_path','delivered_pdf_generated_at','delivered_pdf_generated_by',
        'delivered_pdf_source_photo_ids'
      ]) is distinct from (to_jsonb(old) - array[
        'main_status','incident','incident_notes','comments','updated_at',
        'delivered_pdf_path','delivered_pdf_generated_at','delivered_pdf_generated_by',
        'delivered_pdf_source_photo_ids'
      ]) then
      raise exception 'Technicians cannot update office-managed fields';
    end if;
    if delivered_changed and not (
      delivered_confirmation
      and old.main_status = 'en_progreso'
      and new.main_status = 'enviado_revision'
    ) then raise exception 'Technician delivered PDF update is not allowed'; end if;
    if status_changed and not ((old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')) then
      raise exception 'Technician status transition is not allowed';
    end if;
  end if;
  if status_changed and new.main_status = 'enviado_revision' then new.submitted_at := now(); end if;
  if status_changed and new.main_status = 'aprobado' then new.approved_at := now(); end if;
  if status_changed and new.main_status = 'pagado' then new.paid_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

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
  elsif public.is_office_staff(actor) then
    if p_submit or selected_job.main_status not in ('en_progreso', 'enviado_revision') then
      raise exception 'Office staff can only regenerate an editable delivered PDF';
    end if;
  else
    raise exception 'Delivered PDF confirmation is not authorized';
  end if;

  if p_storage_path !~ (
    '^' || p_job_id::text || '/delivered/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
  ) then raise exception 'Delivered PDF path is invalid'; end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into current_photo_ids
  from public.job_photos p
  where p.job_id = p_job_id;

  select coalesce(array_agg(value order by value), '{}'::uuid[])
  into supplied_photo_ids
  from unnest(coalesce(p_source_photo_ids, '{}'::uuid[])) as supplied(value);

  if cardinality(current_photo_ids) = 0 then
    raise exception 'At least one confirmed evidence photo is required';
  end if;
  if current_photo_ids is distinct from supplied_photo_ids then
    raise exception 'Evidence changed while the delivered PDF was generated';
  end if;

  select
    nullif(o.metadata ->> 'size', '')::bigint,
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
    or stored_photo_ids is distinct from array_to_string(current_photo_ids, ',') then
    raise exception 'Delivered PDF object is missing or invalid';
  end if;

  perform set_config('app.delivered_pdf_confirmation', actor::text, true);

  return query
  update public.jobs
  set delivered_pdf_path = p_storage_path,
      delivered_pdf_generated_at = now(),
      delivered_pdf_generated_by = actor,
      delivered_pdf_source_photo_ids = current_photo_ids,
      main_status = case when p_submit then 'enviado_revision'::public.job_status else main_status end
  where id = p_job_id
  returning selected_job.delivered_pdf_path, jobs.main_status;
end;
$$;

revoke all on function public.confirm_delivered_job_pdf(uuid, text, uuid[], boolean) from public;
grant execute on function public.confirm_delivered_job_pdf(uuid, text, uuid[], boolean) to authenticated;
