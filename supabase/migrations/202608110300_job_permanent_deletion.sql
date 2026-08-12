-- Permanent deletion is restricted to archived jobs and leaves recoverable
-- cleanup work whenever private Storage objects cannot be removed immediately.

alter table public.job_import_items
  drop constraint if exists job_import_items_confirmed_job_id_fkey;

alter table public.job_import_items
  add constraint job_import_items_confirmed_job_id_fkey
  foreign key (confirmed_job_id) references public.jobs(id) on delete cascade;

create table if not exists public.job_deletion_cleanup_queue (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  bucket_id text not null check (bucket_id in ('project-files', 'job-evidence')),
  object_name text not null check (object_name <> ''),
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  unique (bucket_id, object_name)
);

alter table public.job_deletion_cleanup_queue enable row level security;
revoke all on public.job_deletion_cleanup_queue from authenticated;

drop policy if exists "Admins can delete jobs" on public.jobs;
revoke delete on public.jobs from authenticated;

create or replace function public.delete_archived_job(p_job_id uuid)
returns table(queue_id bigint, bucket_id text, object_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
begin
  if not public.is_admin(actor) then
    raise exception 'Admin access required';
  end if;

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;

  if selected_job.id is not null then
    if selected_job.archived_at is null then
      raise exception 'Only archived jobs can be permanently deleted';
    end if;

    insert into public.job_deletion_cleanup_queue (
      job_id, bucket_id, object_name, requested_by
    )
    select p_job_id, o.bucket_id, o.name, actor
    from storage.objects o
    where o.bucket_id in ('project-files', 'job-evidence')
      and o.name like p_job_id::text || '/%'
    on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key do update
      set job_id = excluded.job_id,
          requested_by = excluded.requested_by,
          last_error = null;

    delete from public.jobs where id = p_job_id;
  elsif not exists (
    select 1 from public.job_deletion_cleanup_queue q where q.job_id = p_job_id
  ) then
    raise exception 'Job unavailable';
  end if;

  return query
  select q.id, q.bucket_id, q.object_name
  from public.job_deletion_cleanup_queue q
  where q.job_id = p_job_id
  order by q.id;
end;
$$;

create or replace function public.list_job_deletion_cleanup(p_limit integer default 500)
returns table(queue_id bigint, job_id uuid, bucket_id text, object_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Cleanup limit is invalid';
  end if;

  return query
  select q.id, q.job_id, q.bucket_id, q.object_name
  from public.job_deletion_cleanup_queue q
  order by q.requested_at, q.id
  limit p_limit;
end;
$$;

create or replace function public.finish_job_deletion_cleanup(
  p_completed_ids bigint[],
  p_failed_ids bigint[],
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  delete from public.job_deletion_cleanup_queue
  where id = any(coalesce(p_completed_ids, '{}'::bigint[]));

  update public.job_deletion_cleanup_queue
  set last_attempt_at = now(),
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'Storage cleanup failed'), 1000)
  where id = any(coalesce(p_failed_ids, '{}'::bigint[]));
end;
$$;

revoke all on function public.delete_archived_job(uuid) from public;
revoke all on function public.list_job_deletion_cleanup(integer) from public;
revoke all on function public.finish_job_deletion_cleanup(bigint[], bigint[], text) from public;
grant execute on function public.delete_archived_job(uuid) to authenticated;
grant execute on function public.list_job_deletion_cleanup(integer) to authenticated;
grant execute on function public.finish_job_deletion_cleanup(bigint[], bigint[], text) to authenticated;
