-- Field-worker specialties and explicit read/write capability boundaries.

alter table public.profiles
  add column if not exists worker_specialty text;

update public.profiles
set worker_specialty = case when role = 'tecnico' then 'tecnico' else null end,
    updated_at = clock_timestamp()
where (role = 'tecnico' and worker_specialty is null)
   or (role <> 'tecnico' and worker_specialty is not null);

alter table public.profiles drop constraint if exists profiles_worker_specialty_check;
alter table public.profiles add constraint profiles_worker_specialty_check check (
  (role = 'tecnico' and worker_specialty in ('tecnico', 'splicer', 'liner', 'ayudante'))
  or (role <> 'tecnico' and worker_specialty is null)
);

create or replace function public.normalize_profile_worker_specialty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'tecnico' then
    new.worker_specialty := coalesce(new.worker_specialty, 'tecnico');
  else
    new.worker_specialty := null;
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_profile_worker_specialty_before_write on public.profiles;
create trigger normalize_profile_worker_specialty_before_write
before insert or update of role, worker_specialty on public.profiles
for each row execute function public.normalize_profile_worker_specialty();

create or replace function public.guard_operational_worker_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'tecnico' and old.is_active
    and old.worker_specialty in ('tecnico', 'splicer', 'liner')
    and not (
      new.role = 'tecnico' and new.is_active
      and new.worker_specialty in ('tecnico', 'splicer', 'liner')
    )
    and exists (
      select 1 from public.job_assignments ja
      where ja.technician_id = old.id and ja.assignee_type = 'technician'
        and ja.active and ja.is_primary
    )
  then
    raise exception 'Reassign active primary jobs before changing worker eligibility';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_operational_worker_eligibility_before_update on public.profiles;
create trigger guard_operational_worker_eligibility_before_update
before update of role, is_active, worker_specialty on public.profiles
for each row execute function public.guard_operational_worker_eligibility();

create or replace function public.is_field_worker(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.is_active and p.role = 'tecnico'
      and p.worker_specialty in ('tecnico', 'splicer', 'liner', 'ayudante')
  );
$$;

create or replace function public.is_operational_worker(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.is_active and p.role = 'tecnico'
      and p.worker_specialty in ('tecnico', 'splicer', 'liner')
  );
$$;

create or replace function public.is_read_only_helper(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.is_active and p.role = 'tecnico'
      and p.worker_specialty = 'ayudante'
  );
$$;

create or replace function public.can_view_job(
  check_job_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if check_user_id <> auth.uid()
    and not public.is_office_staff(auth.uid())
    and auth.role() <> 'service_role'
  then return false; end if;
  if public.is_office_staff(check_user_id) then return true; end if;
  if not public.is_operational_worker(check_user_id) then return false; end if;
  perform public.require_active_technician_shift(check_user_id);
  return exists (
    select 1
    from public.jobs j
    join public.job_assignments ja on ja.job_id = j.id
    where j.id = check_job_id and j.archived_at is null and ja.active
      and (
        (ja.assignee_type = 'technician' and ja.technician_id = check_user_id)
        or (
          ja.assignee_type = 'crew'
          and exists (
            select 1 from public.crews c
            where c.id = ja.crew_id and c.is_active
              and (
                c.lead_technician_id = check_user_id
                or exists (
                  select 1 from public.crew_members cm
                  where cm.crew_id = c.id and cm.technician_id = check_user_id
                )
              )
          )
        )
      )
  );
end;
$$;

create or replace function public.can_mutate_job(
  check_job_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if check_user_id <> auth.uid()
    and not public.is_office_staff(auth.uid())
    and auth.role() <> 'service_role'
  then return false; end if;
  if public.is_office_staff(check_user_id) then return true; end if;
  if not public.is_operational_worker(check_user_id) then return false; end if;
  return public.can_view_job(check_job_id, check_user_id);
end;
$$;

create or replace function public.can_access_job(
  check_job_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.can_view_job(check_job_id, check_user_id);
$$;

drop policy if exists "Technicians can update assigned job operations" on public.jobs;
create policy "Technicians can update assigned job operations"
on public.jobs for update to authenticated
using (public.can_mutate_job(id))
with check (public.can_mutate_job(id));

drop policy if exists "Technicians can add production codes to assigned jobs" on public.job_production_codes;
create policy "Technicians can add production codes to assigned jobs"
on public.job_production_codes for insert to authenticated
with check (
  added_by = auth.uid() and public.can_mutate_job(job_id)
  and exists (select 1 from public.jobs j where j.id = job_id and j.main_status = 'en_progreso')
);

drop policy if exists "Technicians can add photos to assigned jobs" on public.job_photos;
create policy "Technicians can add photos to assigned jobs"
on public.job_photos for insert to authenticated
with check (
  uploaded_by = auth.uid() and public.can_mutate_job(job_id)
  and public.job_id_from_storage_path(storage_path) = job_id
  and exists (select 1 from public.jobs j where j.id = job_id and j.main_status = 'en_progreso')
);

drop policy if exists "Technicians can upload assigned evidence objects" on storage.objects;
create policy "Technicians can upload assigned evidence objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-evidence'
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name) and j.main_status = 'en_progreso'
  )
);

drop policy if exists "Technicians can retry assigned evidence uploads" on storage.objects;
create policy "Technicians can retry assigned evidence uploads"
on storage.objects for update to authenticated
using (
  bucket_id = 'job-evidence'
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name) and j.main_status = 'en_progreso'
  )
)
with check (
  bucket_id = 'job-evidence'
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name) and j.main_status = 'en_progreso'
  )
);

create or replace function public.validate_job_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    current_setting('app.delivered_pdf_confirmation', true) = auth.uid()::text, false
  );
  delivered_deletion boolean := coalesce(
    current_setting('app.job_pdf_deletion', true) = coalesce(auth.uid()::text, auth.role()), false
  );
  assignment_transition boolean := status_changed
    and old.main_status in ('sin_asignar', 'asignado')
    and new.main_status in ('sin_asignar', 'asignado')
    and current_setting('app.job_assignment_mutation', true) = coalesce(auth.uid()::text, 'migration');
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
      and nullif(btrim(new.comments), '') is null
    then raise exception 'Returning a job to progress requires a reason'; end if;
  else
    if not public.can_mutate_job(old.id) then raise exception 'Job update not authorized'; end if;
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
      delivered_confirmation and old.main_status = 'en_progreso' and new.main_status = 'enviado_revision'
    ) then raise exception 'Technician delivered PDF update is not allowed'; end if;
    if status_changed and not (
      (old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')
    ) then raise exception 'Technician status transition is not allowed'; end if;
  end if;
  if status_changed and new.main_status = 'enviado_revision' then new.submitted_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'aprobado' then new.approved_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'pagado' then new.paid_at := clock_timestamp(); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

alter function public.add_job_production(uuid, uuid, numeric, date, text)
  rename to add_job_production_before_capabilities;
revoke all on function public.add_job_production_before_capabilities(uuid, uuid, numeric, date, text) from public;
revoke all on function public.add_job_production_before_capabilities(uuid, uuid, numeric, date, text) from authenticated;
create function public.add_job_production(
  p_job_id uuid, p_catalog_id uuid, p_quantity numeric,
  p_production_date date default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_mutate_job(p_job_id, auth.uid()) then raise exception 'Job unavailable'; end if;
  return public.add_job_production_before_capabilities(
    p_job_id, p_catalog_id, p_quantity, p_production_date, p_notes
  );
end;
$$;

alter function public.initialize_job_pdf_draft_v2(uuid, uuid[], integer)
  rename to initialize_job_pdf_draft_v2_before_capabilities;
revoke all on function public.initialize_job_pdf_draft_v2_before_capabilities(uuid, uuid[], integer) from public;
revoke all on function public.initialize_job_pdf_draft_v2_before_capabilities(uuid, uuid[], integer) from authenticated;
create function public.initialize_job_pdf_draft_v2(
  p_job_id uuid, p_source_document_ids uuid[], p_page_count integer
)
returns table(version integer, source_page_count integer, placements jsonb, source_document_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_mutate_job(p_job_id, auth.uid()) then raise exception 'Job unavailable'; end if;
  return query select * from public.initialize_job_pdf_draft_v2_before_capabilities(
    p_job_id, p_source_document_ids, p_page_count
  );
end;
$$;

alter function public.save_job_pdf_draft_v2(uuid, integer, jsonb)
  rename to save_job_pdf_draft_v2_before_capabilities;
revoke all on function public.save_job_pdf_draft_v2_before_capabilities(uuid, integer, jsonb) from public;
revoke all on function public.save_job_pdf_draft_v2_before_capabilities(uuid, integer, jsonb) from authenticated;
create function public.save_job_pdf_draft_v2(
  p_job_id uuid, p_expected_version integer, p_placements jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_mutate_job(p_job_id, auth.uid()) then raise exception 'Job unavailable'; end if;
  return public.save_job_pdf_draft_v2_before_capabilities(p_job_id, p_expected_version, p_placements);
end;
$$;

alter function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text)
  rename to confirm_delivered_job_pdf_complete_before_capabilities;
revoke all on function public.confirm_delivered_job_pdf_complete_before_capabilities(uuid, text, uuid[], uuid[], boolean, integer, text) from public;
revoke all on function public.confirm_delivered_job_pdf_complete_before_capabilities(uuid, text, uuid[], uuid[], boolean, integer, text) from authenticated;
create function public.confirm_delivered_job_pdf_complete(
  p_job_id uuid, p_storage_path text, p_source_photo_ids uuid[],
  p_source_document_ids uuid[], p_submit boolean,
  p_expected_draft_version integer, p_snapshot_hash text
)
returns table(previous_storage_path text, delivered_status public.job_status, delivery_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_mutate_job(p_job_id, auth.uid()) then raise exception 'Job unavailable'; end if;
  return query select * from public.confirm_delivered_job_pdf_complete_before_capabilities(
    p_job_id, p_storage_path, p_source_photo_ids, p_source_document_ids,
    p_submit, p_expected_draft_version, p_snapshot_hash
  );
end;
$$;

create or replace function public.validate_job_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_office_staff(auth.uid()) then raise exception 'Only active office staff can assign jobs'; end if;
    new.assigned_by := auth.uid();
    new.assigned_at := clock_timestamp();
  elsif new.assigned_by is distinct from old.assigned_by or new.assigned_at is distinct from old.assigned_at then
    raise exception 'Assignment actor and date are immutable';
  end if;
  if tg_op = 'UPDATE' and (new.job_id is distinct from old.job_id
    or new.assignee_type is distinct from old.assignee_type
    or new.technician_id is distinct from old.technician_id
    or new.crew_id is distinct from old.crew_id) then
    raise exception 'Reassignment must preserve the previous assignment row';
  end if;
  if new.active and new.assignee_type = 'technician'
    and not public.is_operational_worker(new.technician_id)
  then raise exception 'Assignee must be an active operational worker'; end if;
  if new.active and new.assignee_type = 'crew' and not exists (
    select 1 from public.crews c where c.id = new.crew_id and c.is_active
  ) then raise exception 'Assignee must be an active crew'; end if;
  return new;
end;
$$;

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
    or (select count(distinct value) from unnest(job_ids) supplied(value)) <> array_length(job_ids, 1)
  then raise exception 'One to 100 unique jobs are required'; end if;
  if (new_assignee_type is null) <> (new_assignee_id is null) then
    raise exception 'Assignment type and target must be provided together';
  end if;
  if new_assignee_type = 'technician' and not public.is_operational_worker(new_assignee_id) then
    raise exception 'Technician unavailable';
  end if;
  if new_assignee_type = 'crew' and not exists (
    select 1 from public.crews c where c.id = new_assignee_id and c.is_active
  ) then raise exception 'Crew unavailable'; end if;
  perform set_config('app.job_assignment_mutation', actor::text, true);
  for selected_job in select * from public.jobs where id = any(job_ids) order by id for update loop
    if selected_job.archived_at is not null then raise exception 'Archived jobs cannot be assigned'; end if;
    if new_assignee_type is null and selected_job.main_status <> 'asignado' then
      raise exception 'Only not-started assigned jobs can be unassigned';
    end if;
    update public.job_assignments set active = false, is_primary = false
    where job_id = selected_job.id and active and (new_assignee_type is null or is_primary);
    if new_assignee_type is null then
      update public.jobs set main_status = 'sin_asignar' where id = selected_job.id;
    else
      insert into public.job_assignments(job_id, assignee_type, technician_id, crew_id, assigned_by)
      values (selected_job.id, new_assignee_type,
        case when new_assignee_type = 'technician' then new_assignee_id end,
        case when new_assignee_type = 'crew' then new_assignee_id end, actor)
      returning * into assignment_row;
      if selected_job.main_status = 'sin_asignar' then
        update public.jobs set main_status = 'asignado' where id = selected_job.id;
      else
        insert into public.job_status_history(
          job_id, previous_status, new_status, previous_incident, new_incident, changed_by, notes
        ) values (
          selected_job.id, selected_job.main_status, selected_job.main_status,
          selected_job.incident, selected_job.incident, actor, 'Assignment updated'
        );
      end if;
      return next assignment_row;
    end if;
  end loop;
  if (select count(*) from public.jobs where id = any(job_ids)) <> array_length(job_ids, 1) then
    raise exception 'One or more jobs are unavailable';
  end if;
  return;
end;
$$;

create or replace function public.set_worker_specialty(
  p_profile_id uuid,
  p_worker_specialty text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  if p_worker_specialty not in ('tecnico', 'splicer', 'liner', 'ayudante') then
    raise exception 'Worker specialty is invalid';
  end if;
  update public.profiles
  set worker_specialty = p_worker_specialty, updated_at = clock_timestamp()
  where id = p_profile_id and role = 'tecnico';
  if not found then raise exception 'Field worker unavailable'; end if;
end;
$$;

create or replace function public.confirm_job_import_item(
  p_item_id uuid,
  p_assignee_type public.assignee_type default null,
  p_assignee_id uuid default null
)
returns table(result_status text, confirmed_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  item public.job_import_items%rowtype;
  result_state text := 'imported';
  result_job uuid;
  clean_order text;
begin
  if not public.is_office_staff(actor) then raise exception 'Only active office staff can import jobs'; end if;
  if (p_assignee_type is null) <> (p_assignee_id is null) then
    raise exception 'Assignment type and target must be provided together';
  end if;
  if p_assignee_type = 'technician' and not public.is_operational_worker(p_assignee_id) then
    raise exception 'Technician unavailable';
  end if;
  if p_assignee_type = 'crew' and not exists (
    select 1 from public.crews c where c.id = p_assignee_id and c.is_active
  ) then raise exception 'Crew unavailable'; end if;
  select i.* into item
  from public.job_import_items i
  join public.job_import_batches b on b.id = i.batch_id
  where i.item_id = p_item_id and b.created_by = actor
  for update of i;
  if item.item_id is null then raise exception 'Item unavailable'; end if;
  if item.confirmed_job_id is not null then
    return query select item.item_status, item.confirmed_job_id;
    return;
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files' and o.name = item.storage_path
      and lower(coalesce(o.metadata->>'mimetype', '')) = item.source_mime_type
      and (o.metadata->>'size')::bigint = item.source_file_size
  ) then raise exception 'Storage object invalid'; end if;
  clean_order := nullif(btrim(item.fields->>'orderIdentifier'), '');
  if clean_order is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('job-order:' || lower(clean_order), 0)
    );
  end if;
  select ji.job_id into result_job
  from public.job_imports ji
  where (ji.source_file_hash = item.source_file_hash and ji.source_file_size in (0, item.source_file_size))
     or (clean_order is not null and lower(btrim(ji.order_identifier)) = lower(clean_order))
  order by ji.imported_at limit 1;
  if result_job is null and clean_order is not null then
    select j.id into result_job from public.jobs j
    where lower(btrim(j.prism_number)) = lower(clean_order)
    order by j.created_at limit 1;
  end if;
  if result_job is not null then
    result_state := 'duplicate';
  else
    begin
      perform set_config('app.job_assignment_mutation', actor::text, true);
      insert into public.jobs(
        id, title, prism_number, address, location, customer_name, request_date,
        job_type, description, category, main_status, project_pdf_url
      ) values (
        item.proposed_job_id, left(btrim(item.fields->>'title'), 200),
        nullif(btrim(item.fields->>'prismNumber'), ''), nullif(btrim(item.fields->>'address'), ''),
        nullif(btrim(item.fields->>'location'), ''), nullif(btrim(item.fields->>'customerName'), ''),
        nullif(item.fields->>'requestDate', '')::date, nullif(btrim(item.fields->>'jobType'), ''),
        nullif(btrim(item.fields->>'description'), ''), 'categoria_1',
        (case when p_assignee_type is null then 'sin_asignar' else 'asignado' end)::public.job_status,
        item.storage_path
      );
      insert into public.job_imports(
        job_id, source_file_name, source_file_hash, source_file_size, order_identifier, imported_by
      ) values (
        item.proposed_job_id, item.source_file_name, item.source_file_hash,
        item.source_file_size, clean_order, actor
      );
      if p_assignee_type is not null then
        insert into public.job_assignments(job_id, assignee_type, technician_id, crew_id, assigned_by)
        values (
          item.proposed_job_id, p_assignee_type,
          case when p_assignee_type = 'technician' then p_assignee_id end,
          case when p_assignee_type = 'crew' then p_assignee_id end, actor
        );
        insert into public.job_status_history(job_id, previous_status, new_status, changed_by, notes)
        values (item.proposed_job_id, 'sin_asignar', 'asignado', actor, 'Assignment confirmed during PDF import');
      end if;
      result_job := item.proposed_job_id;
    exception when unique_violation then
      select ji.job_id into result_job
      from public.job_imports ji
      where (ji.source_file_hash = item.source_file_hash and ji.source_file_size in (0, item.source_file_size))
         or (clean_order is not null and lower(btrim(ji.order_identifier)) = lower(clean_order))
      order by ji.imported_at limit 1;
      if result_job is null then raise; end if;
      result_state := 'duplicate';
    end;
  end if;
  update public.job_import_items
  set item_status = result_state, confirmed_job_id = result_job, updated_at = clock_timestamp()
  where item_id = p_item_id;
  return query select result_state, result_job;
end;
$$;

drop function if exists public.list_profiles_for_office();
create function public.list_profiles_for_office()
returns table(
  id uuid, email text, full_name text, role public.user_role, is_active boolean,
  price_category_id uuid, price_category_name text, worker_specialty text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  return query
  select p.id, p.email, p.full_name, p.role, p.is_active,
    pc.id, pc.name, p.worker_specialty
  from public.profiles p
  left join public.price_categories pc on pc.id = p.price_category_id
  order by p.full_name nulls last, p.email, p.id;
end;
$$;

revoke all on function public.normalize_profile_worker_specialty() from public;
revoke all on function public.guard_operational_worker_eligibility() from public;
revoke all on function public.is_field_worker(uuid) from public;
revoke all on function public.is_operational_worker(uuid) from public;
revoke all on function public.is_read_only_helper(uuid) from public;
revoke all on function public.can_view_job(uuid, uuid) from public;
revoke all on function public.can_mutate_job(uuid, uuid) from public;
revoke all on function public.can_access_job(uuid, uuid) from public;
revoke all on function public.set_worker_specialty(uuid, text) from public;
revoke all on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) from public;
revoke all on function public.confirm_job_import_item(uuid, public.assignee_type, uuid) from public;
revoke all on function public.list_profiles_for_office() from public;
revoke all on function public.add_job_production(uuid, uuid, numeric, date, text) from public;
revoke all on function public.initialize_job_pdf_draft_v2(uuid, uuid[], integer) from public;
revoke all on function public.save_job_pdf_draft_v2(uuid, integer, jsonb) from public;
revoke all on function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text) from public;
grant execute on function public.is_field_worker(uuid) to authenticated;
grant execute on function public.is_operational_worker(uuid) to authenticated;
grant execute on function public.is_read_only_helper(uuid) to authenticated;
grant execute on function public.can_view_job(uuid, uuid) to authenticated;
grant execute on function public.can_mutate_job(uuid, uuid) to authenticated;
grant execute on function public.can_access_job(uuid, uuid) to authenticated;
grant execute on function public.set_worker_specialty(uuid, text) to authenticated;
grant execute on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) to authenticated;
grant execute on function public.confirm_job_import_item(uuid, public.assignee_type, uuid) to authenticated;
grant execute on function public.list_profiles_for_office() to authenticated;
grant execute on function public.add_job_production(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.initialize_job_pdf_draft_v2(uuid, uuid[], integer) to authenticated;
grant execute on function public.save_job_pdf_draft_v2(uuid, integer, jsonb) to authenticated;
grant execute on function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text) to authenticated;
