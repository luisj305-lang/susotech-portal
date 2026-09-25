-- Public submissions are admitted only by the server-side, rate-limited API.
-- Office members can review submitted applications, never their upload credentials.
-- Preserve legacy submissions without inventing consent or required new-form fields.
alter table public.job_applications enable row level security;
revoke all on public.job_applications from anon, authenticated;
grant select on public.job_applications to authenticated;
grant all on public.job_applications to service_role;
create policy "Office staff read legacy applications" on public.job_applications for select to authenticated
  using (public.is_office_staff(auth.uid()));

create table public.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  submission_key uuid not null unique,
  submission_token_hash text not null check (submission_token_hash ~ '^[0-9a-f]{64}$'),
  submission_state text not null default 'pending' check (submission_state in ('pending', 'submitted')),
  submission_expires_at timestamptz not null,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  phone text not null check (char_length(btrim(phone)) between 5 and 40),
  email text not null check (char_length(email) between 3 and 254),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  state text not null check (char_length(btrim(state)) between 1 and 100),
  postal_code text not null check (char_length(btrim(postal_code)) between 1 and 20),
  position text not null check (position in ('Ayudante', 'Técnico de fibra óptica', 'Técnico de cableado', 'Conductor', 'Otro')),
  start_date date not null,
  can_travel boolean not null,
  available_weekends boolean not null,
  experience_details text not null default '' check (char_length(experience_details) <= 5000),
  has_license boolean not null,
  license_type text check (char_length(license_type) between 1 and 100),
  certifications text not null default '' check (char_length(certifications) <= 3000),
  additional_comments text not null default '' check (char_length(additional_comments) <= 3000),
  privacy_consent boolean not null check (privacy_consent),
  privacy_version text not null check (char_length(privacy_version) between 1 and 100),
  privacy_accepted_at timestamptz not null,
  resume_path text,
  resume_name text check (char_length(resume_name) between 1 and 255),
  resume_size integer check (resume_size between 1 and 10485760),
  status text not null default 'new' check (status in ('new', 'contacted', 'interview', 'hired', 'rejected')),
  internal_notes text not null default '' check (char_length(internal_notes) <= 10000),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((has_license and license_type is not null) or (not has_license and license_type is null)),
  check ((submission_state = 'submitted') = (submitted_at is not null)),
  check (resume_path is null or resume_path = id::text || '/resume.pdf'),
  check ((resume_path is null and resume_name is null and resume_size is null)
    or (resume_path is not null and resume_name is not null and resume_size is not null))
);

create index recruitment_submitted_status_idx on public.recruitment_applications (status, submitted_at desc)
  where submission_state = 'submitted';
create index recruitment_pending_expiry_idx on public.recruitment_applications (submission_expires_at)
  where submission_state = 'pending';

alter table public.recruitment_applications enable row level security;
revoke all on public.recruitment_applications from anon, authenticated;
grant all on public.recruitment_applications to service_role;
grant select (id, submission_state, full_name, phone, email, city, state, postal_code, position, start_date,
  can_travel, available_weekends, experience_details, has_license, license_type, certifications, additional_comments,
  resume_path, resume_name, resume_size, status, internal_notes, created_at, submitted_at, updated_at)
  on public.recruitment_applications to authenticated;
grant update (status, internal_notes) on public.recruitment_applications to authenticated;

create policy "Office staff read submitted applications" on public.recruitment_applications for select to authenticated
  using (submission_state = 'submitted' and public.is_office_staff(auth.uid()));
create policy "Office staff update submitted application review" on public.recruitment_applications for update to authenticated
  using (submission_state = 'submitted' and public.is_office_staff(auth.uid()))
  with check (submission_state = 'submitted' and public.is_office_staff(auth.uid()));

create function public.recruitment_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.recruitment_touch_updated_at() from public, anon, authenticated;
create trigger recruitment_applications_touch_updated_at before update on public.recruitment_applications
  for each row execute function public.recruitment_touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recruitment-resumes', 'recruitment-resumes', false, 10485760, array['application/pdf']);
create policy "Office staff read submitted resumes" on storage.objects for select to authenticated
  using (bucket_id = 'recruitment-resumes' and public.is_office_staff(auth.uid()) and exists (
    select 1 from public.recruitment_applications a where a.resume_path = name and a.submission_state = 'submitted'
  ));

-- Store only keyed hashes, never IP addresses. Atomic admission across instances.
create table public.recruitment_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 5)
);
alter table public.recruitment_rate_limits enable row level security;
revoke all on public.recruitment_rate_limits from anon, authenticated;
grant all on public.recruitment_rate_limits to service_role;

create function public.consume_recruitment_rate_limit(p_key text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  accepted_key text;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate limit key';
  end if;
  delete from public.recruitment_rate_limits where window_started_at < now() - interval '2 hours';
  insert into public.recruitment_rate_limits as limits (key_hash, window_started_at, request_count)
  values (p_key, now(), 1)
  on conflict (key_hash) do update set
    window_started_at = case when limits.window_started_at <= now() - interval '1 hour' then now() else limits.window_started_at end,
    request_count = case when limits.window_started_at <= now() - interval '1 hour' then 1 else limits.request_count + 1 end
  where limits.window_started_at <= now() - interval '1 hour' or limits.request_count < 5
  returning key_hash into accepted_key;
  return accepted_key is not null;
end;
$$;
revoke all on function public.consume_recruitment_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_recruitment_rate_limit(text) to service_role;
