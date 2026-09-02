alter table public.jobs
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists coordinates_geocoded_at timestamptz;

alter table public.jobs
  add constraint jobs_latitude_range_check
    check (latitude is null or (latitude between -90 and 90)),
  add constraint jobs_longitude_range_check
    check (longitude is null or (longitude between -180 and 180)),
  add constraint jobs_coordinates_coherence_check
    check (
      (latitude is null and longitude is null and coordinates_geocoded_at is null)
      or (latitude is not null and longitude is not null and coordinates_geocoded_at is not null)
    );

comment on column public.jobs.latitude is 'Geocoded latitude resolved by the free US Census Geocoder.';
comment on column public.jobs.longitude is 'Geocoded longitude resolved by the free US Census Geocoder.';
comment on column public.jobs.coordinates_geocoded_at is 'When the free US Census geocoding last resolved latitude/longitude.';
comment on column public.jobs.google_place_id is 'Persistable Google Place ID. Google coordinate/geocoding responses are not stored; free Census coordinates live in latitude/longitude instead.';
