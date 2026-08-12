alter table public.profiles
  add column if not exists technician_type text not null default 'in_house'
  check (technician_type in ('in_house', 'contractor'));

create table if not exists public.production_code_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null check (btrim(code) <> ''),
  description text not null check (btrim(description) <> ''),
  unit text not null check (unit in ('fixed', 'foot', 'hour', 'event')),
  in_house_rate numeric(12,3) not null check (in_house_rate >= 0),
  contractor_rate numeric(12,3) not null check (contractor_rate >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, description)
);

alter table public.production_code_catalog enable row level security;
create policy "Office staff can view production catalog"
on public.production_code_catalog for select to authenticated
using (public.is_office_staff());
create policy "Admins can manage production catalog"
on public.production_code_catalog for all to authenticated
using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.production_code_catalog to authenticated;

alter table public.job_production_codes
  add column if not exists catalog_id uuid references public.production_code_catalog(id),
  add column if not exists credited_technician_id uuid references public.profiles(id),
  add column if not exists technician_type_snapshot text check (technician_type_snapshot in ('in_house', 'contractor')),
  add column if not exists unit_snapshot text check (unit_snapshot in ('fixed', 'foot', 'hour', 'event')),
  add column if not exists unit_rate_snapshot numeric(12,3) check (unit_rate_snapshot >= 0),
  add column if not exists amount_snapshot numeric(14,2) check (amount_snapshot >= 0),
  add column if not exists production_date date;

create index if not exists job_production_technician_date_idx
  on public.job_production_codes (credited_technician_id, production_date);
create index if not exists job_production_date_code_idx
  on public.job_production_codes (production_date, code);

revoke insert, update, delete on public.job_production_codes from authenticated;
grant select on public.job_production_codes to authenticated;

with source(code, description, unit, in_house_rate, contractor_rate) as (values
  ('AC01','Coax-Composite New Aerial (minimum job length 1000'')','foot',0.650,0.700),
  ('AC01-A','Coax-Composite New Aerial (1''-999'')','foot',0.710,0.755),
  ('AC02','Fiber-Composite New Aerial (minimum job length 1000'')','foot',0.640,0.685),
  ('AC02-A','Fiber-Composite New Aerial (1''-999'')','foot',0.690,0.735),
  ('AC04','Coax-Composite AE Splicing w/ Activation','foot',0.230,0.245),
  ('AC05','Coax-Composite Replacement AE Reflash','foot',0.650,0.700),
  ('AS02','Install 5/8" or 5/16" support system messenger','foot',0.200,0.205),
  ('AS03','Lash Coax to New Strand (minimum job length 1000'')','foot',0.200,0.205),
  ('AS03-A','Lash Coax to New Strand (1''-999'')','foot',0.215,0.220),
  ('AS04','Lash Fiber to New Strand (minimum job length 1000'')','foot',0.240,0.240),
  ('AS04-A','Lash Fiber to New Strand (1''-999'')','foot',0.255,0.260),
  ('AS05','Lash/Overlash Additional Coax Cable','foot',0.060,0.060),
  ('AS06','Overlash Coax Cable (minimum job length 1000'')','foot',0.210,0.210),
  ('AS06-A','Overlash Coax Cable (1''-999'')','foot',0.230,0.230),
  ('AS07','Overlash Fiber Cable (minimum job length 1000'')','foot',0.265,0.270),
  ('AS07-A','Overlash Fiber Cable (1''-999'')','foot',0.300,0.300),
  ('AS08','Each additional fiber cable','foot',0.080,0.085),
  ('AS09','Install/Remove Anchor (3/8" or 7/16")','fixed',17.500,17.680),
  ('AS12','Pole Transfer (Single Frame, Including Bonds Up To 4 Drops Required At Pole)','fixed',33.250,33.590),
  ('AS12','Pole Transfer (Double Frame, Including Bonds Up To 4 Drops Required At Pole)','fixed',33.250,33.590),
  ('AS13','Move or Rework Riser Up To 2 Technicians Per Pole','fixed',33.250,33.590),
  ('AS14','Install New Riser and/or Guard','fixed',17.500,17.680),
  ('AS18','Corrected Pole Damage or Trip Guard Per Attachment (per pole)','fixed',24.500,24.750),
  ('AS18','Install/Remove Down Guy, Sidewalk Guy or Guy Guard (3/8" or 5/16")','fixed',24.500,24.750),
  ('AS18','Install/Replace Drop Loop Guard, Wagon Wheel, or Expansion Arm','fixed',24.500,24.750),
  ('AS18','Install Ground Rod And Vertical','fixed',24.500,24.750),
  ('AS18','Install Vertical Bond & Ground To Power Vertical (Separate Trip)','fixed',24.500,24.750),
  ('AS18','Install Continuity Bond or Re-ground Drops','fixed',24.500,24.750),
  ('AS18','Change pole attachment height or Framing Hardware','fixed',24.500,24.750),
  ('AS18','Rehang Existing Coax or Fiber','fixed',24.500,24.750),
  ('AS18','Rework Drops At Pole During Transfers (5th Drop And Above, Per Pole)','fixed',24.500,24.750),
  ('AS19','Partial Wreck Out','foot',0.070,0.070),
  ('AS20','Wreck Out All Strand and Cable','foot',0.100,0.100),
  ('AS24','Lash or Overlash/Mlash fiber cable splice point','fixed',28.080,40.250),
  ('AS26','Top Pole (incl. Removal Of Topped Section Of Pole)','fixed',14.000,14.140),
  ('AS27','Debond/flash fiber cable (up to 2 sheaths of fiber cable)','foot',0.140,0.140),
  ('ER01','Trip Charge - Emergency Call out - Per event','event',50.000,52.000),
  ('ER02','Trip Charge - 2man crew per hour','hour',70.000,70.720),
  ('ER06','Emergency Ground Hand or General Labour','hour',19.250,19.500),
  ('FS13','Optimize Node/OLT','fixed',70.000,70.720),
  ('MC01','Install Node - Active - Conversion Only','fixed',78.000,87.500),
  ('MC02','Install Single, Dual, Triple, or Quad Amplifier - Active','fixed',49.000,49.500),
  ('MC03','Install OC, Power Inserter, or Line splitting device - Passive','fixed',15.750,15.910),
  ('MC03','Aerial/Buried Stub (install new cable into existing device) Passive','fixed',15.750,15.910),
  ('MC03-A','Change out face plate- Passive','fixed',7.000,7.070),
  ('MC04','Tree Triming','fixed',26.250,26.520),
  ('MC09','Service Method or Procedure (SMOP) Work','fixed',13.000,50.000),
  ('MC10','Set-Up Fee','fixed',28.000,28.290),
  ('MC12','Install WiFi Access Points','fixed',49.000,49.500),
  ('MC17','Replacing Existing Coax Plan','fixed',21.000,21.220),
  ('US23','Wreck Out Ground Mount Power Supply','fixed',50.750,51.270),
  ('UC11','Composite UG Splicing with Activation','foot',0.245,0.250),
  ('US05','Place additional cable in empty duct','foot',0.230,0.230),
  ('US06','Place additional cable in occupied duct','foot',0.350,0.350),
  ('US11','Any Small Tap, Coupler, or Vertical Ped','fixed',12.480,14.000),
  ('US12','Install Vault up to 18"x30" OR Horizontal Ped up to 18"x36"','fixed',26.250,26.520),
  ('US26','Re-power coax plant','fixed',17.500,17.680),
  ('US28','Proof and Place Pull Rope - Occupied Conduit','foot',0.245,0.250),
  ('US28-A','Proof and Place Pull Rope - Empty Conduit','foot',0.090,0.090)
)
insert into public.production_code_catalog(code,description,unit,in_house_rate,contractor_rate)
select * from source
on conflict (code,description) do update set
  unit=excluded.unit,
  in_house_rate=excluded.in_house_rate,
  contractor_rate=excluded.contractor_rate,
  updated_at=now();

create or replace function public.list_my_production_catalog()
returns table(id uuid, code text, description text, unit text, unit_rate numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.code, c.description, c.unit,
    case p.technician_type when 'contractor' then c.contractor_rate else c.in_house_rate end
  from public.profiles p cross join public.production_code_catalog c
  where p.id=auth.uid() and p.is_active and p.role='tecnico' and c.is_active
  order by c.code,c.description;
$$;

create or replace function public.add_job_production(
  p_job_id uuid, p_catalog_id uuid, p_quantity numeric,
  p_production_date date default null, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); actor_profile public.profiles%rowtype;
  catalog public.production_code_catalog%rowtype; result_id uuid;
begin
  select * into actor_profile from public.profiles where id=actor and is_active and role='tecnico';
  if actor_profile.id is null then raise exception 'Active technician required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_production_date is not null and p_production_date <> (now() at time zone 'America/New_York')::date then raise exception 'Technicians cannot backdate production'; end if;
  if not public.can_access_job(p_job_id,actor) then raise exception 'Job unavailable'; end if;
  if not exists(select 1 from public.jobs where id=p_job_id and main_status='en_progreso' and archived_at is null) then raise exception 'Job is not in progress'; end if;
  select * into catalog from public.production_code_catalog where id=p_catalog_id and is_active;
  if catalog.id is null then raise exception 'Production code unavailable'; end if;
  insert into public.job_production_codes(
    job_id,code,quantity,notes,added_by,catalog_id,credited_technician_id,
    technician_type_snapshot,unit_snapshot,unit_rate_snapshot,amount_snapshot,production_date
  ) values (
    p_job_id,catalog.code,p_quantity,nullif(btrim(p_notes),''),actor,catalog.id,actor,
    actor_profile.technician_type,catalog.unit,
    case actor_profile.technician_type when 'contractor' then catalog.contractor_rate else catalog.in_house_rate end,
    round(p_quantity * (case actor_profile.technician_type when 'contractor' then catalog.contractor_rate else catalog.in_house_rate end),2),
    coalesce(p_production_date,(now() at time zone 'America/New_York')::date)
  ) returning id into result_id;
  return result_id;
end $$;

create or replace function public.get_my_weekly_production(p_reference_date date default null)
returns table(week_start date,week_end date,production_date date,code text,description text,unit text,quantity numeric,amount numeric,billing_state text)
language sql stable security definer set search_path = '' as $$
  with bounds as (
    select coalesce(p_reference_date,(now() at time zone 'America/New_York')::date) as ref
  ), week as (
    select (ref - ((extract(dow from ref)::int + 2) % 7))::date as starts from bounds
  )
  select w.starts,w.starts+6,pc.production_date,pc.code,c.description,pc.unit_snapshot,
    pc.quantity,pc.amount_snapshot,
    case when j.main_status in ('aprobado','listo_pagar','pagado') then 'confirmed' else 'pending' end
  from week w
  join public.job_production_codes pc on pc.production_date between w.starts and w.starts+6
  join public.jobs j on j.id=pc.job_id
  left join public.production_code_catalog c on c.id=pc.catalog_id
  where pc.credited_technician_id=auth.uid()
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='tecnico' and p.is_active)
  order by pc.production_date,pc.code;
$$;

create or replace function public.get_production_report(p_start_date date,p_end_date date)
returns table(production_date date,technician_id uuid,technician_name text,code text,description text,unit text,quantity numeric,unit_rate numeric,amount numeric,billing_state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date-p_start_date > 366 then raise exception 'Invalid date range'; end if;
  return query select pc.production_date,pc.credited_technician_id,coalesce(p.full_name,p.email),pc.code,c.description,pc.unit_snapshot,
    pc.quantity,pc.unit_rate_snapshot,pc.amount_snapshot,
    case when j.main_status in ('aprobado','listo_pagar','pagado') then 'confirmed' else 'pending' end
  from public.job_production_codes pc join public.jobs j on j.id=pc.job_id
  join public.profiles p on p.id=pc.credited_technician_id
  left join public.production_code_catalog c on c.id=pc.catalog_id
  where pc.production_date between p_start_date and p_end_date
  order by pc.production_date desc,p.full_name,pc.code;
end $$;

revoke all on function public.list_my_production_catalog() from public;
revoke all on function public.add_job_production(uuid,uuid,numeric,date,text) from public;
revoke all on function public.get_my_weekly_production(date) from public;
revoke all on function public.get_production_report(date,date) from public;
grant execute on function public.list_my_production_catalog() to authenticated;
grant execute on function public.add_job_production(uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.get_my_weekly_production(date) to authenticated;
grant execute on function public.get_production_report(date,date) to authenticated;
