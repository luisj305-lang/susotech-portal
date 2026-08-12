-- Admin-only deletion of referenced job PDFs while preserving jobs and evidence.

create or replace function public.is_referenced_project_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs j
    where j.project_pdf_url = object_name
       or j.delivered_pdf_path = object_name
  );
$$;

revoke all on function public.is_referenced_project_file(text) from public;
grant execute on function public.is_referenced_project_file(text) to authenticated;

drop policy if exists "Office staff can manage project files" on storage.objects;
drop policy if exists "Office staff can read project files" on storage.objects;
drop policy if exists "Office staff can upload project files" on storage.objects;
drop policy if exists "Office staff can update project files" on storage.objects;
drop policy if exists "Office staff can delete unreferenced project files" on storage.objects;

create policy "Office staff can read project files"
on storage.objects for select
to authenticated
using (bucket_id = 'project-files' and public.is_office_staff());

create policy "Office staff can upload project files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'project-files' and public.is_office_staff());

create policy "Office staff can update project files"
on storage.objects for update
to authenticated
using (bucket_id = 'project-files' and public.is_office_staff())
with check (bucket_id = 'project-files' and public.is_office_staff());

-- Supervisors retain cleanup of duplicate/unconfirmed uploads, but only admins
-- may remove a document that is currently referenced by a job.
create policy "Office staff can delete unreferenced project files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and (
    public.is_admin()
    or not public.is_referenced_project_file(name)
  )
);

-- Preserve every existing job-update invariant while allowing the narrow
-- deletion RPC to clear delivered-document metadata without changing status.
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
  delivered_deletion boolean := coalesce(
    current_setting('app.job_pdf_deletion', true) = coalesce(auth.uid()::text, auth.role()),
    false
  );
begin
  if status_changed and incident_changed then raise exception 'Status and incident must be changed separately'; end if;
  if delivered_changed and not (delivered_confirmation or delivered_deletion) then
    raise exception 'Delivered PDF metadata must be changed atomically';
  end if;
  if delivered_deletion then
    if status_changed or incident_changed then raise exception 'PDF deletion cannot change job workflow'; end if;
    new.updated_at := now();
    return new;
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

create or replace function public.clear_job_pdf_reference(
  p_job_id uuid,
  p_document_kind text,
  p_expected_path text
)
returns table(document_kind text, cleared_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  current_path text;
begin
  if not (public.is_admin(actor) or auth.role() = 'service_role') then
    raise exception 'Only an active administrator can delete job PDFs';
  end if;
  if p_document_kind is null or p_document_kind not in ('original', 'delivered') then
    raise exception 'Document kind is invalid';
  end if;
  if p_expected_path is null
    or split_part(p_expected_path, '/', 1) <> p_job_id::text
    or p_expected_path !~* '[.]pdf$'
  then
    raise exception 'Expected PDF path is invalid';
  end if;

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;

  if selected_job.id is null then raise exception 'Job unavailable'; end if;

  current_path := case p_document_kind
    when 'original' then selected_job.project_pdf_url
    else selected_job.delivered_pdf_path
  end;

  -- A retry after an ambiguous response is a successful no-op.
  if current_path is null then
    return query select p_document_kind, null::text;
    return;
  end if;
  if current_path is distinct from p_expected_path then
    raise exception 'The PDF reference changed; retry with the current document';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files' and o.name = current_path
  ) then
    raise exception 'The private Storage object must be deleted first';
  end if;

  perform set_config('app.job_pdf_deletion', coalesce(actor::text, auth.role()), true);

  if p_document_kind = 'original' then
    update public.jobs
    set project_pdf_url = null
    where id = p_job_id and project_pdf_url = current_path;
  else
    update public.jobs
    set delivered_pdf_path = null,
        delivered_pdf_generated_at = null,
        delivered_pdf_generated_by = null,
        delivered_pdf_source_photo_ids = '{}'::uuid[]
    where id = p_job_id and delivered_pdf_path = current_path;
  end if;

  return query select p_document_kind, current_path;
end;
$$;

revoke all on function public.clear_job_pdf_reference(uuid, text, text) from public;
grant execute on function public.clear_job_pdf_reference(uuid, text, text) to authenticated;
grant execute on function public.clear_job_pdf_reference(uuid, text, text) to service_role;
