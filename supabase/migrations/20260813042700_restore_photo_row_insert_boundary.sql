-- Office users may read evidence and Admin may perform audited deletion, but
-- only operational field workers may register new job-photo evidence rows.

drop policy if exists "Technicians can add photos to assigned jobs"
  on public.job_photos;
create policy "Technicians can add photos to assigned jobs"
on public.job_photos for insert to authenticated
with check (
  public.is_operational_worker(auth.uid())
  and uploaded_by = auth.uid()
  and public.can_mutate_job(job_id)
  and public.job_id_from_storage_path(storage_path) = job_id
  and exists (
    select 1 from public.jobs j
    where j.id = job_id and j.main_status = 'en_progreso'
  )
);
