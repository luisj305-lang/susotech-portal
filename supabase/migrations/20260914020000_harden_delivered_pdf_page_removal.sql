-- Preserve the generation-input snapshots: removing a rendered page does not
-- delete a source photo/document or change the submitted financial delivery.
-- Keep the existing RPC signature for compatibility; reject changed snapshots.
create or replace function public.remove_delivered_pdf_pages(
  p_job_id uuid, p_expected_path text, p_storage_path text, p_source_photo_ids uuid[]
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
begin
  if actor is null or not public.is_office_staff(actor) then
    raise exception 'Office access required';
  end if;
  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null then raise exception 'Job unavailable'; end if;
  if selected_job.main_status not in ('asignado', 'en_revision') or selected_job.archived_at is not null then
    raise exception 'Job is not editable';
  end if;
  if p_expected_path is null or selected_job.delivered_pdf_path is distinct from p_expected_path then
    raise exception 'Delivered PDF changed';
  end if;
  if p_storage_path is null or p_storage_path = p_expected_path
    or p_storage_path !~ ('^' || p_job_id::text || '/delivered/[0-9a-f-]{36}[.]pdf$')
    or p_expected_path !~ ('^' || p_job_id::text || '/delivered/[0-9a-f-]{36}[.]pdf$') then
    raise exception 'Delivered PDF path is invalid';
  end if;
  if p_source_photo_ids is distinct from selected_job.delivered_pdf_source_photo_ids then
    raise exception 'Delivered PDF source snapshot changed';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files' and o.name = p_storage_path
      and lower(o.metadata->>'mimetype') = 'application/pdf'
      and (o.metadata->>'size')::bigint between 1 and 104857600
      and o.user_metadata->>'generator' = 'susotech-portal'
      and o.user_metadata->>'job_id' = p_job_id::text
      and o.user_metadata->>'operation' = 'page-removal'
      and o.user_metadata->>'expected_path' = p_expected_path
      and o.user_metadata->>'actor_id' = actor::text
  ) then raise exception 'Delivered PDF object is missing or invalid'; end if;

  perform set_config('app.delivered_pdf_confirmation', actor::text, true);
  update public.jobs
  set delivered_pdf_path = p_storage_path,
      delivered_pdf_generated_at = clock_timestamp(),
      delivered_pdf_generated_by = actor,
      updated_at = clock_timestamp()
  where id = p_job_id;
end;
$$;

revoke all on function public.remove_delivered_pdf_pages(uuid, text, text, uuid[]) from public;
grant execute on function public.remove_delivered_pdf_pages(uuid, text, text, uuid[]) to authenticated;

-- The UPDATE row lock serializes generation with page removal. Generation that
-- started before a removal cannot replace the trimmed PDF, even via a legacy
-- confirmation RPC. Null pointers (explicit PDF deletion) remain unchanged.
create or replace function public.guard_trimmed_delivered_pdf_replacement()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  replacement_metadata jsonb;
begin
  if old.delivered_pdf_path is not distinct from new.delivered_pdf_path
    or new.delivered_pdf_path is null then return new; end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files' and o.name = old.delivered_pdf_path
      and o.user_metadata->>'operation' = 'page-removal'
  ) then
    select o.user_metadata into replacement_metadata from storage.objects o
    where o.bucket_id = 'project-files' and o.name = new.delivered_pdf_path;
    if replacement_metadata->>'expected_path' is distinct from old.delivered_pdf_path
      or (replacement_metadata->>'operation' is distinct from 'page-removal'
        and replacement_metadata->>'replacement_confirmed' is distinct from 'true') then
      raise exception 'Delivered PDF changed; explicit replacement confirmation required';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_trimmed_delivered_pdf_replacement() from public;
create trigger guard_trimmed_delivered_pdf_replacement
before update of delivered_pdf_path on public.jobs
for each row execute function public.guard_trimmed_delivered_pdf_replacement();
