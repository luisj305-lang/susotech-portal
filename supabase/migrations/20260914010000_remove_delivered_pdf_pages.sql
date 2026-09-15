-- Office staff can remove pages from the delivered PDF (both original-document
-- pages and evidence-photo pages) without touching money: current_delivery_id,
-- production lines and the financial split stay keyed to the original submitted
-- delivery. Only the displayed PDF pointer and its evidence snapshot change.
-- This operation edits the already-rendered delivered PDF (pages are removed,
-- annotations stay burnt-in), so it never re-maps production codes.

create or replace function public.remove_delivered_pdf_pages(
  p_job_id uuid,
  p_expected_path text,
  p_storage_path text,
  p_source_photo_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
begin
  if not public.is_office_staff(actor) then
    raise exception 'Office access required';
  end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null then
    raise exception 'Job unavailable';
  end if;
  if selected_job.main_status not in ('asignado', 'en_revision') or selected_job.archived_at is not null then
    raise exception 'Job is not editable';
  end if;
  if selected_job.delivered_pdf_path is distinct from p_expected_path then
    raise exception 'Delivered PDF changed';
  end if;
  if p_storage_path !~ ('^' || p_job_id::text || '/delivered/[0-9a-f-]{36}[.]pdf$') then
    raise exception 'Delivered PDF path is invalid';
  end if;

  perform set_config('app.delivered_pdf_confirmation', actor::text, true);
  update public.jobs
  set delivered_pdf_path = p_storage_path,
      delivered_pdf_generated_at = clock_timestamp(),
      delivered_pdf_generated_by = actor,
      delivered_pdf_source_photo_ids = coalesce(p_source_photo_ids, '{}'::uuid[]),
      updated_at = clock_timestamp()
  where id = p_job_id;
end;
$$;

revoke all on function public.remove_delivered_pdf_pages(uuid, text, text, uuid[]) from public;
grant execute on function public.remove_delivered_pdf_pages(uuid, text, text, uuid[]) to authenticated;
