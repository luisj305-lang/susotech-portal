-- Idempotently correct only active, never-assigned, never-started imports.
-- Archived legacy rows are intentionally preserved for audit review.
alter table public.jobs disable trigger on_job_updated;

do $$
declare
  changed_job public.jobs%rowtype;
  actor uuid;
begin
  perform set_config('app.job_assignment_mutation', 'migration', true);

  for changed_job in
    select j.*
    from public.jobs j
    where j.id in (
      '90139550-0fde-4dd1-9e01-452f283691f1'::uuid,
      'cfb7dab7-07b6-48d0-9edc-f837bcbc7730'::uuid,
      '6d3b84ce-b373-4216-bb56-bb0076fe093b'::uuid,
      '033890a0-2b40-4ebf-b38e-a1cef875d2d3'::uuid,
      'a1b6708d-7e06-4fdd-9b75-6d40d846af70'::uuid
    )
      and j.main_status = 'asignado'
      and j.archived_at is null
      and j.submitted_at is null
      and j.approved_at is null
      and j.paid_at is null
      and j.current_delivery_id is null
      and not exists (select 1 from public.job_assignments a where a.job_id = j.id)
      and not exists (
        select 1 from public.job_status_history h
        where h.job_id = j.id and h.new_status <> 'asignado'
      )
    order by j.id
    for update
  loop
    select ji.imported_by into actor from public.job_imports ji where ji.job_id = changed_job.id;
    if actor is null then continue; end if;

    update public.jobs set main_status = 'sin_asignar' where id = changed_job.id;
    if not exists (
      select 1 from public.job_status_history h
      where h.job_id = changed_job.id
        and h.notes = 'Backfill: imported job had no assignment'
    ) then
      insert into public.job_status_history(
        job_id, previous_status, new_status, previous_incident, new_incident, changed_by, notes
      ) values (
        changed_job.id, 'asignado', 'sin_asignar', changed_job.incident,
        changed_job.incident, actor, 'Backfill: imported job had no assignment'
      );
    end if;
  end loop;
end $$;

-- Flush the deferred coherence checks before altering the jobs trigger set.
-- PostgreSQL rejects ALTER TABLE while deferred trigger events are pending.
set constraints enforce_job_assignment_status_on_jobs immediate;

alter table public.jobs enable trigger on_job_updated;
