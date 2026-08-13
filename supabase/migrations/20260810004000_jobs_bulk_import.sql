-- High-volume PDF import identity, audit and transactional confirmation.

alter table public.jobs
  add column if not exists customer_name text,
  add column if not exists request_date date;

create table public.job_imports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  source_file_name text not null check (btrim(source_file_name) <> ''),
  source_file_hash text not null check (source_file_hash ~ '^[a-f0-9]{64}$'),
  order_identifier text,
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now()
);

alter table public.job_imports enable row level security;

create unique index job_imports_hash_idx
on public.job_imports (source_file_hash);

create unique index job_imports_order_identifier_idx
on public.job_imports (lower(btrim(order_identifier)))
where nullif(btrim(order_identifier), '') is not null;

create policy "Office staff can view import audit"
on public.job_imports for select to authenticated
using (public.is_office_staff());

revoke insert, update, delete on public.job_imports from authenticated;
grant select on public.job_imports to authenticated;

create or replace function public.confirm_job_import(
  p_proposed_job_id uuid,
  p_source_file_name text,
  p_source_file_hash text,
  p_order_identifier text,
  p_job_title text,
  p_prism_number text,
  p_job_address text,
  p_job_location text,
  p_customer_name text,
  p_request_date date,
  p_job_type text,
  p_job_description text,
  p_project_pdf_url text,
  p_assignee_type public.assignee_type default null,
  p_assignee_id uuid default null
)
returns table(result_status text, confirmed_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job_id uuid;
  clean_order text := nullif(btrim(p_order_identifier), '');
  clean_hash text := lower(btrim(p_source_file_hash));
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Only active office staff can import jobs';
  end if;
  if p_proposed_job_id is null
    or nullif(btrim(p_source_file_name), '') is null
    or nullif(btrim(p_job_title), '') is null
    or clean_hash is null
    or clean_hash !~ '^[a-f0-9]{64}$'
    or p_project_pdf_url is null
    or split_part(p_project_pdf_url, '/', 1) <> p_proposed_job_id::text
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'project-files' and name = p_project_pdf_url
    )
  then
    raise exception 'Invalid import payload';
  end if;
  if (p_assignee_type is null) <> (p_assignee_id is null) then
    raise exception 'Assignment type and target must be provided together';
  end if;

  select ji.job_id into existing_job_id
  from public.job_imports ji
  where ji.source_file_hash = clean_hash
    or (clean_order is not null and lower(btrim(ji.order_identifier)) = lower(clean_order))
  order by ji.imported_at
  limit 1;

  if existing_job_id is null and clean_order is not null then
    select j.id into existing_job_id
    from public.jobs j
    where lower(btrim(j.prism_number)) = lower(clean_order)
    order by j.created_at
    limit 1;
  end if;

  if existing_job_id is not null then
    return query select 'duplicate'::text, existing_job_id;
    return;
  end if;

  begin
    insert into public.jobs (
      id, title, prism_number, address, location, customer_name, request_date,
      job_type, description, category, main_status, project_pdf_url
    ) values (
      p_proposed_job_id, left(btrim(p_job_title), 200), nullif(btrim(p_prism_number), ''),
      nullif(btrim(p_job_address), ''), nullif(btrim(p_job_location), ''),
      nullif(btrim(p_customer_name), ''), p_request_date, nullif(btrim(p_job_type), ''),
      nullif(btrim(p_job_description), ''), 'categoria_1', 'asignado', p_project_pdf_url
    );

    insert into public.job_imports (
      job_id, source_file_name, source_file_hash, order_identifier, imported_by
    ) values (
      p_proposed_job_id, left(btrim(p_source_file_name), 255), clean_hash, clean_order, auth.uid()
    );

    if p_assignee_type is not null then
      insert into public.job_assignments (
        job_id, assignee_type, technician_id, crew_id, assigned_by
      ) values (
        p_proposed_job_id, p_assignee_type,
        case when p_assignee_type = 'technician' then p_assignee_id end,
        case when p_assignee_type = 'crew' then p_assignee_id end,
        auth.uid()
      );
      insert into public.job_status_history (
        job_id, previous_status, new_status, changed_by, notes
      ) values (
        p_proposed_job_id, 'asignado', 'asignado', auth.uid(), 'Assignment confirmed during PDF import'
      );
    end if;
  exception when unique_violation then
    select ji.job_id into existing_job_id
    from public.job_imports ji
    where ji.source_file_hash = clean_hash
      or (clean_order is not null and lower(btrim(ji.order_identifier)) = lower(clean_order))
    order by ji.imported_at
    limit 1;
    if existing_job_id is null then raise; end if;
    return query select 'duplicate'::text, existing_job_id;
    return;
  end;

  return query select 'imported'::text, p_proposed_job_id;
end;
$$;

revoke all on function public.confirm_job_import(
  uuid, text, text, text, text, text, text, text, text, date, text, text, text,
  public.assignee_type, uuid
) from public;
grant execute on function public.confirm_job_import(
  uuid, text, text, text, text, text, text, text, text, date, text, text, text,
  public.assignee_type, uuid
) to authenticated;
