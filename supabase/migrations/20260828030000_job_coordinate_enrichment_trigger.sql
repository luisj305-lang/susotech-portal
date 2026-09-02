-- Technician GPS route: add a coordinate-enrichment carve-out to the job
-- update trigger so the SECURITY DEFINER RPC `enrich_job_coordinates_technician`
-- (migration 20260828020000) can write `latitude`/`longitude`/
-- `coordinates_geocoded_at` for an assigned job without tripping the technician
-- field whitelist. The carve-out is gated by the `app.coordinate_enrichment`
-- session token, which only that RPC sets after authorizing `can_access_job`.
--
-- This replaces the currently applied `validate_job_update` with an identical
-- signature plus the new branch; applied migrations are never modified.

create or replace function public.validate_job_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  status_changed boolean := old.main_status is distinct from new.main_status;
  incident_changed boolean := old.incident is distinct from new.incident;
  delivered_changed boolean :=
    old.delivered_pdf_path is distinct from new.delivered_pdf_path
    or old.delivered_pdf_generated_at is distinct from new.delivered_pdf_generated_at
    or old.delivered_pdf_generated_by is distinct from new.delivered_pdf_generated_by
    or old.delivered_pdf_source_photo_ids is distinct from new.delivered_pdf_source_photo_ids
    or old.delivered_pdf_source_document_ids is distinct from new.delivered_pdf_source_document_ids
    or old.current_delivery_id is distinct from new.current_delivery_id;
  delivered_confirmation boolean := coalesce(
    current_setting('app.delivered_pdf_confirmation', true) = auth.uid()::text, false
  );
  delivered_deletion boolean := coalesce(
    current_setting('app.job_pdf_deletion', true) = coalesce(auth.uid()::text, auth.role()), false
  );
  assignment_transition boolean := status_changed
    and old.main_status in ('sin_asignar', 'asignado')
    and new.main_status in ('sin_asignar', 'asignado')
    and current_setting('app.job_assignment_mutation', true) = coalesce(auth.uid()::text, 'migration');
  coordinate_enrichment boolean :=
    current_setting('app.coordinate_enrichment', true) = coalesce(auth.uid()::text, 'migration');
begin
  if coordinate_enrichment then
    if (to_jsonb(new) - array['latitude','longitude','coordinates_geocoded_at','updated_at'])
       is distinct from (to_jsonb(old) - array['latitude','longitude','coordinates_geocoded_at','updated_at']) then
      raise exception 'Coordinate enrichment cannot change other job fields';
    end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;

  if status_changed and incident_changed then raise exception 'Status and incident must be changed separately'; end if;
  if delivered_changed and not (delivered_confirmation or delivered_deletion) then
    raise exception 'Delivered PDF metadata must be changed atomically';
  end if;
  if delivered_deletion then
    if status_changed or incident_changed then raise exception 'PDF deletion cannot change job workflow'; end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  if assignment_transition then
    null;
  elsif public.is_office_staff(auth.uid()) then
    if status_changed and not (
      (old.main_status = 'asignado' and new.main_status = 'en_revision')
      or (old.main_status = 'en_revision' and new.main_status in ('aprobado', 'asignado'))
      or (old.main_status = 'aprobado' and new.main_status = 'facturado')
      or (old.main_status = 'facturado' and new.main_status = 'pagado')
    ) then raise exception 'Office status transition is not allowed'; end if;
    if old.main_status = 'en_revision' and new.main_status = 'asignado'
      and nullif(btrim(new.comments), '') is null
    then raise exception 'Returning a job for correction requires a reason'; end if;
    if old.main_status = 'aprobado' and new.main_status = 'facturado'
      and nullif(btrim(new.invoice_number), '') is null
    then raise exception 'Invoicing a job requires an invoice number'; end if;
  else
    if not public.can_mutate_job(old.id) then raise exception 'Job update not authorized'; end if;
    if (to_jsonb(new) - array[
        'main_status','incident','incident_notes','comments','updated_at',
        'delivered_pdf_path','delivered_pdf_generated_at','delivered_pdf_generated_by',
        'delivered_pdf_source_photo_ids','delivered_pdf_source_document_ids','current_delivery_id'
      ]) is distinct from (to_jsonb(old) - array[
        'main_status','incident','incident_notes','comments','updated_at',
        'delivered_pdf_path','delivered_pdf_generated_at','delivered_pdf_generated_by',
        'delivered_pdf_source_photo_ids','delivered_pdf_source_document_ids','current_delivery_id'
      ]) then raise exception 'Technicians cannot update office-managed fields'; end if;
    if delivered_changed and not (
      delivered_confirmation and old.main_status in ('asignado', 'en_revision')
      and new.main_status = 'en_revision'
    ) then raise exception 'Technician delivered PDF update is not allowed'; end if;
    if status_changed and not (
      delivered_confirmation and old.main_status = 'asignado' and new.main_status = 'en_revision'
    ) then raise exception 'Technician status transition is not allowed'; end if;
  end if;

  if new.main_status = 'pagado' and (
    new.invoice_number is distinct from old.invoice_number
    or new.invoice_path is distinct from old.invoice_path
  ) then raise exception 'Invoice details are immutable after payment'; end if;

  if status_changed and new.main_status = 'en_revision' then new.submitted_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'aprobado' then new.approved_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'facturado' then new.invoiced_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'pagado' then new.paid_at := clock_timestamp(); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
