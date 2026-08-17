-- Stage 1 (continued): additive invoicing columns plus the one-way data
-- backfill onto the new status labels. The DO block logs pre/post state
-- counts for verification. Re-runnable: the guarded UPDATEs are no-ops once
-- no row keeps a legacy label.

alter table public.jobs
  add column if not exists invoice_number text,
  add column if not exists invoice_path text,
  add column if not exists invoiced_at timestamptz;

-- History and validation triggers are suspended during the backfill exactly
-- like the unassigned-jobs backfill (20260813050000); each changed job still
-- receives exactly one auditable history event attributed to the first active
-- office profile when one exists.
alter table public.jobs disable trigger validate_job_before_update;
alter table public.jobs disable trigger on_job_updated;
alter table public.jobs disable trigger guard_active_shift_job_update_before_update;

do $$
declare
  v_actor uuid;
  v_changed public.jobs%rowtype;
  v_new_status public.job_status;
begin
  select id into v_actor
  from public.profiles
  where role in ('admin', 'supervisor') and is_active
  order by id
  limit 1;

  raise notice 'job-invoicing backfill pre counts: %', (
    select jsonb_object_agg(main_status::text, total)
    from (select main_status, count(*)::bigint as total from public.jobs group by main_status) counts
  );

  for v_changed in
    select job.*
    from public.jobs job
    where job.main_status in ('en_progreso', 'enviado_revision', 'listo_pagar')
    order by job.id
    for update
  loop
    v_new_status := case v_changed.main_status
      when 'en_progreso' then 'asignado'::public.job_status
      when 'enviado_revision' then 'en_revision'::public.job_status
      when 'listo_pagar' then 'facturado'::public.job_status
    end;

    update public.jobs
    set main_status = v_new_status,
        updated_at = clock_timestamp()
    where id = v_changed.id;

    if v_actor is not null then
      insert into public.job_status_history (
        job_id, previous_status, new_status, previous_incident, new_incident,
        changed_by, notes
      ) values (
        v_changed.id, v_changed.main_status, v_new_status,
        v_changed.incident, v_changed.incident, v_actor,
        'Backfill: job status pipeline migration'
      );
    end if;
  end loop;

  raise notice 'job-invoicing backfill post counts: %', (
    select jsonb_object_agg(main_status::text, total)
    from (select main_status, count(*)::bigint as total from public.jobs group by main_status) counts
  );
end;
$$;

-- Flush the deferred coherence checks before altering the jobs trigger set.
-- PostgreSQL rejects ALTER TABLE while deferred trigger events are pending.
set constraints enforce_job_assignment_status_on_jobs immediate;

alter table public.jobs enable trigger validate_job_before_update;
alter table public.jobs enable trigger on_job_updated;
alter table public.jobs enable trigger guard_active_shift_job_update_before_update;
