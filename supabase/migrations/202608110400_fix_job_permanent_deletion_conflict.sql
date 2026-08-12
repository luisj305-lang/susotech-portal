-- Qualify the cleanup queue conflict target. In a RETURNS TABLE function,
-- bucket_id and object_name are also PL/pgSQL output variables, so an
-- unqualified ON CONFLICT target is ambiguous at runtime.

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

revoke all on function public.delete_archived_job(uuid) from public;
grant execute on function public.delete_archived_job(uuid) to authenticated;
