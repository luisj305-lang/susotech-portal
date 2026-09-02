-- Technician GPS route: enrich a pending job's free Census coordinates without
-- going through the technician write trigger. `validate_job_update` blocks a
-- technician from writing `latitude`/`longitude`/`coordinates_geocoded_at`, so
-- the route action persists them through this SECURITY DEFINER RPC instead.
--
-- Authorization mirrors the existing trusted-mutation RPCs: the function runs
-- as its owner with a locked search_path, authorizes the caller against the
-- assignment via `can_access_job`, sets the `app.coordinate_enrichment`
-- session token before the UPDATE (see the matching carve-out added to
-- `validate_job_update` in migration 20260828030000), and is exposed only to
-- authenticated users.

create or replace function public.enrich_job_coordinates_technician(
  p_job_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null or selected_job.archived_at is not null then
    raise exception 'Job unavailable';
  end if;
  if selected_job.main_status <> 'asignado' then
    raise exception 'Job is not assigned';
  end if;
  if not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;

  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180
  then
    raise exception 'Invalid coordinates';
  end if;

  perform set_config('app.coordinate_enrichment', actor::text, true);
  update public.jobs
  set latitude = p_latitude,
      longitude = p_longitude,
      coordinates_geocoded_at = clock_timestamp()
  where id = p_job_id;
end;
$$;

revoke all on function public.enrich_job_coordinates_technician(uuid, double precision, double precision) from public;
grant execute on function public.enrich_job_coordinates_technician(uuid, double precision, double precision) to authenticated;
