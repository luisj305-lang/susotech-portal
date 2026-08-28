-- Multi-part jobs: a nullable self-FK lets a job gain additional billable
-- parts. The root is "Parte 1" and the grouping umbrella; every `jobs` row is
-- exactly one billable part. Children are flat one-level siblings; only roots
-- can be parents, and `parent_job_id` is immutable once inserted.

alter table public.jobs add column if not exists parent_job_id uuid;

alter table public.jobs
  drop constraint if exists jobs_parent_job_id_fkey;
alter table public.jobs
  add constraint jobs_parent_job_id_fkey
  foreign key (parent_job_id) references public.jobs(id) on delete restrict;

create index if not exists jobs_parent_job_id_idx on public.jobs (parent_job_id);

alter table public.jobs
  drop constraint if exists jobs_no_self_parent_check;
alter table public.jobs
  add constraint jobs_no_self_parent_check
  check (parent_job_id is null or parent_job_id <> id);

-- Hierarchy guard, enforced on every write that carries `parent_job_id`:
--  * a child's parent must be a root (its own parent_job_id is null);
--  * once set, `parent_job_id` cannot change (no re-parent, no root -> part,
--    no part -> root). This immutability also rejects a root-with-children
--    becoming a part, because that would require mutating its `parent_job_id`.
create or replace function public.validate_job_parent_hierarchy()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.parent_job_id is distinct from old.parent_job_id then
      raise exception 'parent_job_id is immutable';
    end if;
    return new;
  end if;

  if new.parent_job_id is not null and not exists (
    select 1 from public.jobs p
    where p.id = new.parent_job_id and p.parent_job_id is null
  ) then
    raise exception 'Only a root job can be a parent';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_job_parent_hierarchy_before_write on public.jobs;
create trigger validate_job_parent_hierarchy_before_write
  before insert or update of parent_job_id on public.jobs
  for each row execute function public.validate_job_parent_hierarchy();

-- Office-only RPC that clones a root's shared fields into a new unassigned
-- child in one transaction, mirroring assign_jobs_atomic's set_config token so
-- the deferred assignment/status invariant passes trivially for 'sin_asignar'.
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
    category, location, job_type, main_status
  ) values (
    child, parent.id, parent.title, parent.prism_number, parent.address,
    parent.customer_name, parent.category, parent.location, parent.job_type,
    'sin_asignar'::public.job_status
  );

  return query select child;
end;
$$;

revoke all on function public.create_job_part(uuid) from public;
grant execute on function public.create_job_part(uuid) to authenticated;
