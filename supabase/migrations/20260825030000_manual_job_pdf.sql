-- Manual job delivery receipt PDF. A PDF is generated server-side when a
-- technician submits a manual job, stored in project-files, and exposed to
-- office staff for review alongside the pending/approved record.

alter table public.manual_jobs
  add column if not exists pdf_path text;

create or replace function public.set_manual_job_pdf_path(p_manual_job_id uuid, p_pdf_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.manual_jobs mj where mj.id = p_manual_job_id and mj.created_by = auth.uid())
     and not public.is_office_staff(auth.uid())
  then raise exception 'Manual job unavailable'; end if;
  update public.manual_jobs
  set pdf_path = p_pdf_path, updated_at = clock_timestamp()
  where id = p_manual_job_id;
  if not found then raise exception 'Manual job unavailable'; end if;
end;
$$;

drop function if exists public.list_manual_jobs_for_office();
create function public.list_manual_jobs_for_office()
returns table(
  id uuid,
  prism_number text,
  value_cents bigint,
  status text,
  created_by uuid,
  creator_name text,
  reviewed_by uuid,
  reviewer_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz,
  pdf_path text,
  workers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;
  return query
  select mj.id, mj.prism_number, mj.value_cents, mj.status, mj.created_by,
    coalesce(nullif(btrim(c.full_name), ''), c.email),
    mj.reviewed_by,
    coalesce(nullif(btrim(r.full_name), ''), r.email),
    mj.reviewed_at, mj.rejection_reason, mj.created_at, mj.pdf_path,
    coalesce(w.workers, '[]'::jsonb)
  from public.manual_jobs mj
  join public.profiles c on c.id = mj.created_by
  left join public.profiles r on r.id = mj.reviewed_by
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'technicianId', mw.technician_id,
      'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
      'percentageBasisPoints', mw.percentage_basis_points
    ) order by mw.percentage_basis_points desc) as workers
    from public.manual_job_workers mw
    join public.profiles p on p.id = mw.technician_id
    where mw.manual_job_id = mj.id
  ) w on true
  order by case mj.status when 'pending' then 0 when 'approved' then 1 else 2 end, mj.created_at desc;
end;
$$;

drop function if exists public.list_my_manual_jobs();
create function public.list_my_manual_jobs()
returns table(
  id uuid,
  prism_number text,
  value_cents bigint,
  status text,
  created_by uuid,
  creator_name text,
  reviewed_by uuid,
  reviewer_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz,
  pdf_path text,
  workers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select mj.id, mj.prism_number, mj.value_cents, mj.status, mj.created_by,
    coalesce(nullif(btrim(c.full_name), ''), c.email),
    mj.reviewed_by,
    coalesce(nullif(btrim(r.full_name), ''), r.email),
    mj.reviewed_at, mj.rejection_reason, mj.created_at, mj.pdf_path,
    coalesce(w.workers, '[]'::jsonb)
  from public.manual_jobs mj
  join public.profiles c on c.id = mj.created_by
  left join public.profiles r on r.id = mj.reviewed_by
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'technicianId', mw.technician_id,
      'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
      'percentageBasisPoints', mw.percentage_basis_points
    ) order by mw.percentage_basis_points desc) as workers
    from public.manual_job_workers mw
    join public.profiles p on p.id = mw.technician_id
    where mw.manual_job_id = mj.id
  ) w on true
  where mj.created_by = auth.uid()
  order by case mj.status when 'pending' then 0 when 'approved' then 1 else 2 end, mj.created_at desc;
end;
$$;

revoke all on function public.set_manual_job_pdf_path(uuid, text) from public;
grant execute on function public.set_manual_job_pdf_path(uuid, text) to authenticated;
