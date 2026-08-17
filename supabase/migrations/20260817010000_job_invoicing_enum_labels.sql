-- Stage 1 of the job status pipeline change (additive, idempotent).
-- New labels join the existing enum. Legacy labels stay for now and are
-- dropped only in stage 2, after production verification, because Postgres
-- cannot remove enum values without recreating the type.

alter type public.job_status add value if not exists 'en_revision' after 'asignado';
alter type public.job_status add value if not exists 'facturado' after 'aprobado';
