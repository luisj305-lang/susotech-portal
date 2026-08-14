-- Make the active primary assignment and the pre-operational job state one
-- atomic server-owned invariant.

alter table public.jobs alter column main_status set default 'sin_asignar';

create or replace function public.validate_job_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  status_changed boolean := old.main_status is distinct from new.main_status;
  incident_changed boolean := old.incident is distinct from new.incident;
  delivered_changed boolean :=
    old.delivered_pdf_path is distinct from new.delivered_pdf_path
    or old.delivered_pdf_generated_at is distinct from new.delivered_pdf_generated_at
    or old.delivered_pdf_generated_by is distinct from new.delivered_pdf_generated_by
    or old.delivered_pdf_source_photo_ids is distinct from new.delivered_pdf_source_photo_ids
    or old.delivered_pdf_source_document_ids is distinct from new.delivered_pdf_source_document_ids
    or old.current_delivery_id is distinct from new.current_delivery_id;
  delivered_confirmation boolean := coalesce(
    current_setting('app.delivered_pdf_confirmation', true) = auth.uid()::text,
    false
  );
  delivered_deletion boolean := coalesce(
    current_setting('app.job_pdf_deletion', true) = coalesce(auth.uid()::text, auth.role()),
    false
  );
  assignment_transition boolean := status_changed
    and old.main_status in ('sin_asignar', 'asignado')
    and new.main_status in ('sin_asignar', 'asignado')
    and current_setting('app.job_assignment_mutation', true)
      = coalesce(auth.uid()::text, 'migration');
begin
  if status_changed and incident_changed then raise exception 'Status and incident must be changed separately'; end if;
  if delivered_changed and not (delivered_confirmation or delivered_deletion) then
    raise exception 'Delivered PDF metadata must be changed atomically';
  end if;
  if delivered_deletion then
    if status_changed or incident_changed then raise exception 'PDF deletion cannot change job workflow'; end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  if assignment_transition then
    null;
  elsif public.is_office_staff(auth.uid()) then
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
        'delivered_pdf_source_photo_ids','delivered_pdf_source_document_ids','current_delivery_id'
      ]) is distinct from (to_jsonb(old) - array[
        'main_status','incident','incident_notes','comments','updated_at',
        'delivered_pdf_path','delivered_pdf_generated_at','delivered_pdf_generated_by',
        'delivered_pdf_source_photo_ids','delivered_pdf_source_document_ids','current_delivery_id'
      ]) then raise exception 'Technicians cannot update office-managed fields'; end if;
    if delivered_changed and not (
      delivered_confirmation and old.main_status = 'en_progreso'
      and new.main_status = 'enviado_revision'
    ) then raise exception 'Technician delivered PDF update is not allowed'; end if;
    if status_changed and not ((old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')) then
      raise exception 'Technician status transition is not allowed';
    end if;
  end if;
  if status_changed and new.main_status = 'enviado_revision' then new.submitted_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'aprobado' then new.approved_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'pagado' then new.paid_at := clock_timestamp(); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.handle_job_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.main_status is distinct from new.main_status
    or old.incident is distinct from new.incident then
    if auth.uid() is null then raise exception 'A status or incident change requires an authenticated actor'; end if;
    insert into public.job_status_history (
      job_id, previous_status, new_status, previous_incident, new_incident,
      changed_by, notes
    ) values (
      new.id, old.main_status, new.main_status, old.incident, new.incident,
      auth.uid(),
      case
        when current_setting('app.job_assignment_mutation', true) = auth.uid()::text
          and old.main_status = 'sin_asignar' and new.main_status = 'asignado'
          then 'Assignment updated'
        when current_setting('app.job_assignment_mutation', true) = auth.uid()::text
          and old.main_status = 'asignado' and new.main_status = 'sin_asignar'
          then 'Assignment removed'
        when old.incident is distinct from new.incident then new.incident_notes
        else new.comments
      end
    );
  end if;
  return new;
end;
$$;

create or replace function public.assert_job_assignment_status(check_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_job public.jobs%rowtype;
  active_assignment_count integer;
  active_primary_count integer;
begin
  -- The service role remains an explicit maintenance/test escape hatch. All
  -- authenticated application writes are still constrained below.
  if auth.uid() is null then return; end if;
  select * into selected_job from public.jobs where id = check_job_id;
  if selected_job.id is null or selected_job.archived_at is not null then return; end if;

  select count(*), count(*) filter (where is_primary)
  into active_assignment_count, active_primary_count
  from public.job_assignments
  where job_id = check_job_id and active;

  if selected_job.main_status = 'sin_asignar' and active_assignment_count <> 0 then
    raise exception 'Unassigned jobs cannot have an active assignment';
  end if;
  if selected_job.main_status <> 'sin_asignar' and active_primary_count <> 1 then
    raise exception 'Operational jobs require exactly one active primary assignment';
  end if;
end;
$$;

create or replace function public.check_job_assignment_status_from_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_job_assignment_status(new.id);
  return new;
end;
$$;

create or replace function public.check_job_assignment_status_from_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_job_assignment_status(coalesce(new.job_id, old.job_id));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_job_assignment_status_on_jobs on public.jobs;
create constraint trigger enforce_job_assignment_status_on_jobs
after insert or update of main_status, archived_at on public.jobs
deferrable initially deferred
for each row execute function public.check_job_assignment_status_from_job();

drop trigger if exists enforce_job_assignment_status_on_assignments on public.job_assignments;
create constraint trigger enforce_job_assignment_status_on_assignments
after insert or update or delete on public.job_assignments
deferrable initially deferred
for each row execute function public.check_job_assignment_status_from_assignment();

create or replace function public.assign_jobs_atomic(
  job_ids uuid[],
  new_assignee_type public.assignee_type default null,
  new_assignee_id uuid default null
)
returns setof public.job_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  assignment_row public.job_assignments%rowtype;
begin
  if not public.is_office_staff(actor) then raise exception 'Only active office staff can assign jobs'; end if;
  if coalesce(array_length(job_ids, 1), 0) = 0 or array_length(job_ids, 1) > 100
    or (select count(distinct value) from unnest(job_ids) as supplied(value)) <> array_length(job_ids, 1) then
    raise exception 'One to 100 unique jobs are required';
  end if;
  if (new_assignee_type is null) <> (new_assignee_id is null) then
    raise exception 'Assignment type and target must be provided together';
  end if;

  perform set_config('app.job_assignment_mutation', actor::text, true);

  for selected_job in
    select * from public.jobs where id = any(job_ids) order by id for update
  loop
    if selected_job.archived_at is not null then raise exception 'Archived jobs cannot be assigned'; end if;
    if new_assignee_type is null and selected_job.main_status <> 'asignado' then
      raise exception 'Only not-started assigned jobs can be unassigned';
    end if;

    update public.job_assignments
    set active = false, is_primary = false
    where job_id = selected_job.id
      and active
      and (new_assignee_type is null or is_primary);

    if new_assignee_type is null then
      update public.jobs set main_status = 'sin_asignar' where id = selected_job.id;
    else
      insert into public.job_assignments (
        job_id, assignee_type, technician_id, crew_id, assigned_by
      ) values (
        selected_job.id, new_assignee_type,
        case when new_assignee_type = 'technician' then new_assignee_id end,
        case when new_assignee_type = 'crew' then new_assignee_id end,
        actor
      ) returning * into assignment_row;
      if selected_job.main_status = 'sin_asignar' then
        update public.jobs set main_status = 'asignado' where id = selected_job.id;
      end if;
      return next assignment_row;
    end if;

    if new_assignee_type is not null and selected_job.main_status <> 'sin_asignar' then
      insert into public.job_status_history (
        job_id, previous_status, new_status, previous_incident, new_incident, changed_by, notes
      ) values (
        selected_job.id, selected_job.main_status, selected_job.main_status,
        selected_job.incident, selected_job.incident, actor, 'Assignment updated'
      );
    end if;
  end loop;

  if (select count(*) from public.jobs where id = any(job_ids)) <> array_length(job_ids, 1) then
    raise exception 'One or more jobs are unavailable';
  end if;
  return;
end;
$$;

drop function if exists public.confirm_job_import_item(uuid);
create function public.confirm_job_import_item(
  p_item_id uuid,
  p_assignee_type public.assignee_type default null,
  p_assignee_id uuid default null
)
returns table(result_status text, confirmed_job_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  item public.job_import_items%rowtype;
  result_state text := 'imported';
  result_job uuid;
  clean_order text;
begin
  if not public.is_office_staff(actor) then raise exception 'Only active office staff can import jobs'; end if;
  if (p_assignee_type is null) <> (p_assignee_id is null) then raise exception 'Assignment type and target must be provided together'; end if;
  select i.* into item from public.job_import_items i join public.job_import_batches b on b.id=i.batch_id
    where i.item_id=p_item_id and b.created_by=actor for update of i;
  if item.item_id is null then raise exception 'Item unavailable'; end if;
  if item.confirmed_job_id is not null then return query select item.item_status,item.confirmed_job_id; return; end if;
  if not exists(select 1 from storage.objects where bucket_id='project-files' and name=item.storage_path
    and lower(coalesce(metadata->>'mimetype',''))=item.source_mime_type and (metadata->>'size')::bigint=item.source_file_size) then
    raise exception 'Storage object invalid';
  end if;
  clean_order := nullif(btrim(item.fields->>'orderIdentifier'),'');
  if clean_order is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-order:'||lower(clean_order),0)); end if;
  select ji.job_id into result_job from public.job_imports ji where (ji.source_file_hash=item.source_file_hash and ji.source_file_size in (0,item.source_file_size))
    or (clean_order is not null and lower(btrim(ji.order_identifier))=lower(clean_order)) order by ji.imported_at limit 1;
  if result_job is null and clean_order is not null then select j.id into result_job from public.jobs j where lower(btrim(j.prism_number))=lower(clean_order) order by j.created_at limit 1; end if;
  if result_job is not null then result_state := 'duplicate'; else
    begin
      perform set_config('app.job_assignment_mutation', actor::text, true);
      insert into public.jobs(id,title,prism_number,address,location,customer_name,request_date,job_type,description,category,main_status,project_pdf_url)
      values(item.proposed_job_id,left(btrim(item.fields->>'title'),200),nullif(btrim(item.fields->>'prismNumber'),''),nullif(btrim(item.fields->>'address'),''),
        nullif(btrim(item.fields->>'location'),''),nullif(btrim(item.fields->>'customerName'),''),nullif(item.fields->>'requestDate','')::date,
        nullif(btrim(item.fields->>'jobType'),''),nullif(btrim(item.fields->>'description'),''),'categoria_1',
        (case when p_assignee_type is null then 'sin_asignar' else 'asignado' end)::public.job_status,item.storage_path);
      insert into public.job_imports(job_id,source_file_name,source_file_hash,source_file_size,order_identifier,imported_by)
      values(item.proposed_job_id,item.source_file_name,item.source_file_hash,item.source_file_size,clean_order,actor);
      if p_assignee_type is not null then
        insert into public.job_assignments(job_id,assignee_type,technician_id,crew_id,assigned_by)
        values(item.proposed_job_id,p_assignee_type,
          case when p_assignee_type='technician' then p_assignee_id end,
          case when p_assignee_type='crew' then p_assignee_id end,actor);
        insert into public.job_status_history(job_id,previous_status,new_status,changed_by,notes)
        values(item.proposed_job_id,'sin_asignar','asignado',actor,'Assignment confirmed during PDF import');
      end if;
      result_job := item.proposed_job_id;
    exception when unique_violation then
      select ji.job_id into result_job from public.job_imports ji where (ji.source_file_hash=item.source_file_hash and ji.source_file_size in (0,item.source_file_size))
        or (clean_order is not null and lower(btrim(ji.order_identifier))=lower(clean_order)) order by ji.imported_at limit 1;
      if result_job is null then raise; end if; result_state := 'duplicate';
    end;
  end if;
  update public.job_import_items set item_status=result_state,confirmed_job_id=result_job,updated_at=now() where item_id=p_item_id;
  return query select result_state,result_job;
end $$;

revoke all on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) from public;
grant execute on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) to authenticated;
revoke all on function public.confirm_job_import_item(uuid, public.assignee_type, uuid) from public;
grant execute on function public.confirm_job_import_item(uuid, public.assignee_type, uuid) to authenticated;

-- Trusted server maintenance can remove abandoned import batches; cascading
-- deletion cleans their unconfirmed items without exposing DML to users.
grant select, delete on public.job_import_batches to service_role;

revoke all on function public.assert_job_assignment_status(uuid) from public;
revoke all on function public.check_job_assignment_status_from_job() from public;
revoke all on function public.check_job_assignment_status_from_assignment() from public;
