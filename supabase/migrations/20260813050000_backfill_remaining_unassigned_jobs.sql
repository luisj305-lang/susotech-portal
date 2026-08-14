-- Correct any remaining imported jobs that are provably untouched and have
-- never had an assignment. Operational or ambiguous history is left intact.
alter table public.jobs disable trigger on_job_updated;

do $$
declare
  changed_job public.jobs%rowtype;
  actor uuid;
begin
  perform set_config('app.job_assignment_mutation', 'migration', true);

  for changed_job in
    select job.*
    from public.jobs job
    where job.main_status = 'asignado'
      and job.archived_at is null
      and job.incident is null
      and job.submitted_at is null
      and job.approved_at is null
      and job.paid_at is null
      and job.current_delivery_id is null
      and not exists (
        select 1 from public.job_assignments assignment
        where assignment.job_id = job.id
      )
      and not exists (
        select 1 from public.job_status_history history
        where history.job_id = job.id
      )
      and not exists (
        select 1 from public.job_deliveries delivery
        where delivery.job_id = job.id
      )
      and not exists (
        select 1 from public.job_production_codes production
        where production.job_id = job.id
      )
      and not exists (
        select 1 from public.job_photos photo
        where photo.job_id = job.id
      )
      and exists (
        select 1 from public.job_imports import
        where import.job_id = job.id
      )
    order by job.id
    for update
  loop
    select import.imported_by into actor
    from public.job_imports import
    where import.job_id = changed_job.id;

    if actor is null then
      continue;
    end if;

    update public.jobs
    set main_status = 'sin_asignar'
    where id = changed_job.id;

    insert into public.job_status_history(
      job_id, previous_status, new_status, previous_incident, new_incident,
      changed_by, notes
    ) values (
      changed_job.id, 'asignado', 'sin_asignar', changed_job.incident,
      changed_job.incident, actor,
      'Backfill: untouched imported job had no assignment'
    );
  end loop;
end $$;

set constraints enforce_job_assignment_status_on_jobs immediate;

alter table public.jobs enable trigger on_job_updated;
