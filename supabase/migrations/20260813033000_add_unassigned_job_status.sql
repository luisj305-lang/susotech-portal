-- Add the pre-operational state separately so later migrations can safely use it.
alter type public.job_status add value if not exists 'sin_asignar' before 'asignado';
