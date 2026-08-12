-- Draft initialization writes state and is only valid while the assigned
-- technician can actively edit the job.

create or replace function public.initialize_job_pdf_draft(p_job_id uuid, p_page_count integer)
returns table(version integer, source_page_count integer, placements jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if not public.is_technician(actor) or not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;
  if not exists (
    select 1 from public.jobs
    where id = p_job_id and main_status = 'en_progreso' and archived_at is null
  ) then
    raise exception 'Job is not editable';
  end if;
  if p_page_count not between 1 and 50 then raise exception 'Invalid page count'; end if;

  insert into public.job_pdf_drafts(job_id, source_page_count, updated_by)
  values(p_job_id, p_page_count, actor)
  on conflict(job_id) do update set source_page_count = excluded.source_page_count
    where job_pdf_drafts.version = 0 and job_pdf_drafts.placements = '[]'::jsonb;

  return query
  select d.version, d.source_page_count, d.placements
  from public.job_pdf_drafts d where d.job_id = p_job_id;
end $$;

revoke all on function public.initialize_job_pdf_draft(uuid, integer) from public;
grant execute on function public.initialize_job_pdf_draft(uuid, integer) to authenticated;
