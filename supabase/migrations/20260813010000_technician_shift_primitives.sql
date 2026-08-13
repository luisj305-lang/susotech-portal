-- Technician work-shift primitives. This migration deliberately does not wire
-- shift enforcement into job access yet, so rollout cannot strand technicians.

create extension if not exists btree_gist with schema extensions;

create table if not exists public.technician_shifts (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz not null,
  active_until timestamptz not null,
  fuel_amount numeric(12,2) not null,
  no_fuel_today boolean not null,
  fuel_photo_path text unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technician_shifts_exact_duration_check
    check (active_until = started_at + interval '10 hours'),
  constraint technician_shifts_creator_check
    check (created_by = technician_id),
  constraint technician_shifts_fuel_check check (
    (no_fuel_today and fuel_amount = 0 and fuel_photo_path is null)
    or (not no_fuel_today and fuel_amount > 0)
  ),
  constraint technician_shifts_fuel_photo_path_check check (
    fuel_photo_path is null
    or fuel_photo_path ~ (
      '^' || technician_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
    )
  )
);

alter table public.technician_shifts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_shifts_no_overlap'
      and conrelid = 'public.technician_shifts'::regclass
  ) then
    alter table public.technician_shifts
      add constraint technician_shifts_no_overlap exclude using gist (
        technician_id with =,
        tstzrange(started_at, active_until, '[)') with &&
      );
  end if;
end $$;

create index if not exists technician_shifts_technician_started_idx
  on public.technician_shifts (technician_id, started_at desc);

drop policy if exists "Technicians view own shifts" on public.technician_shifts;
create policy "Technicians view own shifts"
on public.technician_shifts for select to authenticated
using (public.is_technician() and technician_id = auth.uid());

drop policy if exists "Office staff view technician shifts" on public.technician_shifts;
create policy "Office staff view technician shifts"
on public.technician_shifts for select to authenticated
using (public.is_office_staff());

revoke insert, update, delete on public.technician_shifts from authenticated;
grant select on public.technician_shifts to authenticated;

insert into storage.buckets (id, name, public)
values ('technician-shift-fuel', 'technician-shift-fuel', false)
on conflict (id) do update set public = false;

drop policy if exists "Technicians read own shift fuel photos" on storage.objects;
create policy "Technicians read own shift fuel photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'technician-shift-fuel'
  and public.is_technician()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Office staff read shift fuel photos" on storage.objects;
create policy "Office staff read shift fuel photos"
on storage.objects for select to authenticated
using (bucket_id = 'technician-shift-fuel' and public.is_office_staff());

drop policy if exists "Technicians upload own shift fuel photos" on storage.objects;
create policy "Technicians upload own shift fuel photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'technician-shift-fuel'
  and public.is_technician()
  and (storage.foldername(name))[1] = auth.uid()::text
  and name ~ (
    '^' || auth.uid()::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  )
  and lower(coalesce(metadata ->> 'mimetype', '')) in (
    'image/jpeg', 'image/png', 'image/webp'
  )
  and coalesce((metadata ->> 'size')::bigint, 0) between 1 and 10485760
);

create or replace function public.start_technician_shift(
  p_no_fuel_today boolean,
  p_fuel_amount numeric,
  p_fuel_photo_path text default null
)
returns table(
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  fuel_amount numeric,
  no_fuel_today boolean,
  fuel_photo_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  begins_at timestamptz := now();
  ends_at timestamptz := now() + interval '10 hours';
  clean_photo_path text := nullif(btrim(p_fuel_photo_path), '');
  new_shift_id uuid;
begin
  if not public.is_technician(actor) then
    raise exception 'Active technician required';
  end if;
  if p_no_fuel_today is null or p_fuel_amount is null
    or p_fuel_amount < 0
    or p_fuel_amount > 9999999999.99
    or p_fuel_amount <> round(p_fuel_amount, 2)
    or (p_no_fuel_today and (p_fuel_amount <> 0 or clean_photo_path is not null))
    or (not p_no_fuel_today and p_fuel_amount <= 0)
  then
    raise exception 'Invalid fuel information';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('technician-shift:' || actor::text, 0)
  );

  if exists (
    select 1 from public.technician_shifts s
    where s.technician_id = actor
      and s.started_at <= begins_at
      and s.active_until > begins_at
  ) then
    raise exception 'An active shift already exists';
  end if;

  if clean_photo_path is not null then
    if clean_photo_path !~ (
      '^' || actor::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
    ) or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'technician-shift-fuel'
        and o.name = clean_photo_path
        and lower(coalesce(o.metadata ->> 'mimetype', '')) in (
          'image/jpeg', 'image/png', 'image/webp'
        )
        and coalesce((o.metadata ->> 'size')::bigint, 0) between 1 and 10485760
    ) then
      raise exception 'Invalid fuel photo';
    end if;
  end if;

  insert into public.technician_shifts (
    technician_id, started_at, active_until, fuel_amount,
    no_fuel_today, fuel_photo_path, created_by
  ) values (
    actor, begins_at, ends_at, p_fuel_amount,
    p_no_fuel_today, clean_photo_path, actor
  ) returning id into new_shift_id;

  return query
  select s.id, s.started_at, s.active_until, s.fuel_amount,
    s.no_fuel_today, s.fuel_photo_path
  from public.technician_shifts s where s.id = new_shift_id;
end;
$$;

create or replace function public.get_my_active_shift()
returns table(
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  fuel_amount numeric,
  no_fuel_today boolean,
  fuel_photo_path text,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_technician(auth.uid()) then
    raise exception 'Active technician required';
  end if;
  return query
  select s.id, s.started_at, s.active_until, s.fuel_amount,
    s.no_fuel_today, s.fuel_photo_path, now()
  from public.technician_shifts s
  where s.technician_id = auth.uid()
    and s.started_at <= now()
    and s.active_until > now()
  order by s.started_at desc
  limit 1;
end;
$$;

create or replace function public.list_technician_shift_status()
returns table(
  technician_id uuid,
  technician_name text,
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  is_shift_active boolean,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;
  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    latest.id, latest.started_at, latest.active_until,
    coalesce(latest.active_until > now() and latest.started_at <= now(), false),
    now()
  from public.profiles p
  left join lateral (
    select s.id, s.started_at, s.active_until
    from public.technician_shifts s
    where s.technician_id = p.id
    order by s.started_at desc
    limit 1
  ) latest on true
  where p.role = 'tecnico' and p.is_active
  order by coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

revoke all on function public.start_technician_shift(boolean, numeric, text) from public;
revoke all on function public.get_my_active_shift() from public;
revoke all on function public.list_technician_shift_status() from public;
grant execute on function public.start_technician_shift(boolean, numeric, text) to authenticated;
grant execute on function public.get_my_active_shift() to authenticated;
grant execute on function public.list_technician_shift_status() to authenticated;
