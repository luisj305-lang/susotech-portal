-- Allocation-based read access and office mutation capabilities must never
-- grant evidence upload rights. Evidence creation remains field-work only.

drop policy if exists "Technicians can upload assigned evidence objects"
  on storage.objects;
create policy "Technicians can upload assigned evidence objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-evidence'
  and public.is_operational_worker(auth.uid())
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status = 'en_progreso'
  )
);

drop policy if exists "Technicians can retry assigned evidence uploads"
  on storage.objects;
create policy "Technicians can retry assigned evidence uploads"
on storage.objects for update to authenticated
using (
  bucket_id = 'job-evidence'
  and public.is_operational_worker(auth.uid())
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status = 'en_progreso'
  )
)
with check (
  bucket_id = 'job-evidence'
  and public.is_operational_worker(auth.uid())
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status = 'en_progreso'
  )
);
