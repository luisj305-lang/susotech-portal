-- Admins can add evidence to editable, non-archived jobs without requiring an assignment.
-- Technicians keep the existing assignment and operational-capability boundary.

drop policy if exists "Technicians can add photos to assigned jobs" on public.job_photos;
drop policy if exists "Authorized users can add job evidence" on public.job_photos;
create policy "Authorized users can add job evidence"
on public.job_photos for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.job_id_from_storage_path(storage_path) = job_id
  and exists (
    select 1 from public.jobs j
    where j.id = job_id
      and j.main_status in ('en_progreso', 'enviado_revision')
      and j.archived_at is null
  )
  and (
    public.is_admin(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(job_id)
    )
  )
);

drop policy if exists "Operational workers upload assigned evidence" on storage.objects;
drop policy if exists "Authorized users upload editable job evidence" on storage.objects;
create policy "Authorized users upload editable job evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-evidence'
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('en_progreso', 'enviado_revision')
      and j.archived_at is null
  )
  and (
    public.is_admin(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(public.job_id_from_storage_path(name))
    )
  )
);

drop policy if exists "Operational workers update assigned evidence" on storage.objects;
drop policy if exists "Authorized users update editable job evidence" on storage.objects;
create policy "Authorized users update editable job evidence"
on storage.objects for update to authenticated
using (
  bucket_id = 'job-evidence'
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('en_progreso', 'enviado_revision')
      and j.archived_at is null
  )
  and (
    public.is_admin(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(public.job_id_from_storage_path(name))
    )
  )
)
with check (
  bucket_id = 'job-evidence'
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('en_progreso', 'enviado_revision')
      and j.archived_at is null
  )
  and (
    public.is_admin(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(public.job_id_from_storage_path(name))
    )
  )
);
