-- Multi work types (R05/R08): add a `text[]` catalog array alongside the
-- legacy scalar `job_type`. The ten catalog values are the complete set;
-- legacy free-text `job_type` values are preserved as-is (no data migration).
-- Display prefers `work_types` when non-empty and falls back to `job_type`.

alter table public.jobs
  add column if not exists work_types text[] not null default '{}'::text[];

-- Additively redefine `create_job_part` so a new part also copies the parent's
-- `work_types` alongside the existing shared-field clone. Every guard and
-- invariant is byte-identical to the applied migration
-- `20260828000000_job_parts.sql`; only the child insert gains `work_types`.
create or replace function public.create_job_part(p_parent_job_id uuid)
returns table(new_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  parent public.jobs%rowtype;
  child uuid := gen_random_uuid();
begin
  if not public.is_office_staff(actor) then
    raise exception 'Only active office staff can add job parts';
  end if;

  select * into parent from public.jobs where id = p_parent_job_id for update;
  if parent.id is null then raise exception 'Job unavailable'; end if;
  if parent.archived_at is not null then raise exception 'Archived jobs cannot gain parts'; end if;
  if parent.parent_job_id is not null then raise exception 'Only the root job can gain parts'; end if;

  perform set_config('app.job_assignment_mutation', actor::text, true);

  insert into public.jobs (
    id, parent_job_id, title, prism_number, address, customer_name,
    category, location, job_type, work_types, main_status
  ) values (
    child, parent.id, parent.title, parent.prism_number, parent.address,
    parent.customer_name, parent.category, parent.location, parent.job_type,
    parent.work_types, 'sin_asignar'::public.job_status
  );

  return query select child;
end;
$$;

revoke all on function public.create_job_part(uuid) from public;
grant execute on function public.create_job_part(uuid) to authenticated;
