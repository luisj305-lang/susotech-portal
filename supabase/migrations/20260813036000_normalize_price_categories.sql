-- Normalize technician price categories and catalog rates without replacing the
-- existing UUID catalog or rewriting immutable delivery history.

create table public.price_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9_]*$'),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.price_categories(slug, name)
values
  ('inhouse', 'Inhouse'),
  ('subcontractor', 'Subcontractor'),
  ('wallace', 'Wallace')
on conflict (slug) do update set
  name = excluded.name,
  active = true,
  updated_at = now();

alter table public.production_code_catalog
  add column if not exists sort_order integer not null default 0;

with ordered as (
  select id, row_number() over (order by code, description, id)::integer as position
  from public.production_code_catalog
)
update public.production_code_catalog c
set sort_order = ordered.position
from ordered
where ordered.id = c.id and c.sort_order = 0;

create table public.production_code_rates (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.production_code_catalog(id) on delete restrict,
  price_category_id uuid not null references public.price_categories(id) on delete restrict,
  unit_price numeric(12,3) not null check (
    unit_price::text not in ('NaN', 'Infinity', '-Infinity') and unit_price >= 0
  ),
  effective_from date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_item_id, price_category_id, effective_from)
);

create index production_code_rates_lookup_idx
  on public.production_code_rates (
    catalog_item_id, price_category_id, effective_from desc
  ) where active;

insert into public.production_code_rates(
  catalog_item_id, price_category_id, unit_price, effective_from
)
select c.id, pc.id,
  case pc.slug when 'inhouse' then c.in_house_rate else c.contractor_rate end,
  date '2026-08-11'
from public.production_code_catalog c
join public.price_categories pc on pc.slug in ('inhouse', 'subcontractor')
on conflict (catalog_item_id, price_category_id, effective_from) do update set
  unit_price = excluded.unit_price,
  active = true,
  updated_at = now();

-- Additional received rates. MC01A is intentionally distinct from MC01-A.
-- Its service description was not supplied, so the catalog states that fact
-- instead of inventing one; it can be replaced by a future explicit item.
insert into public.production_code_catalog(
  code, description, unit, in_house_rate, contractor_rate, sort_order
)
values
  ('001', 'Trip charge', 'event', 33.590, 40.000, 10000),
  ('MC01A', 'Description not provided', 'fixed', 0.000, 46.200, 10010)
on conflict (code, description) do update set
  unit = excluded.unit,
  updated_at = now();

with received(code, description, category_slug, unit_price) as (values
  ('001', 'Trip charge', 'inhouse', 33.590::numeric),
  ('001', 'Trip charge', 'subcontractor', 40.000::numeric),
  ('MC01A', 'Description not provided', 'subcontractor', 46.200::numeric),
  ('MC09', 'Service Method or Procedure (SMOP) Work', 'subcontractor', 50.000::numeric)
)
insert into public.production_code_rates(
  catalog_item_id, price_category_id, unit_price, effective_from
)
select c.id, pc.id, received.unit_price, date '2026-08-13'
from received
join public.production_code_catalog c
  on c.code = received.code and c.description = received.description
join public.price_categories pc on pc.slug = received.category_slug
on conflict (catalog_item_id, price_category_id, effective_from) do update set
  unit_price = excluded.unit_price,
  active = true,
  updated_at = now();

alter table public.profiles
  add column if not exists price_category_id uuid references public.price_categories(id) on delete restrict;

update public.profiles p
set price_category_id = pc.id,
    updated_at = now()
from public.price_categories pc
where p.role = 'tecnico'
  and p.price_category_id is null
  and pc.slug = case p.technician_type
    when 'contractor' then 'subcontractor'
    when 'in_house' then 'inhouse'
  end;

alter table public.job_pdf_annotations
  add column if not exists description_snapshot text;

alter table public.job_production_codes
  add column if not exists description_snapshot text,
  add column if not exists price_category_id uuid references public.price_categories(id),
  add column if not exists price_category_name_snapshot text;

alter table public.job_delivery_production_lines
  add column if not exists catalog_item_id uuid references public.production_code_catalog(id),
  add column if not exists code_snapshot text,
  add column if not exists description_snapshot text,
  add column if not exists price_category_id uuid references public.price_categories(id),
  add column if not exists price_category_name_snapshot text;

alter table public.job_pdf_annotations
  add constraint job_pdf_annotations_quantity_finite_check check (
    quantity::text not in ('NaN', 'Infinity', '-Infinity')
  );

alter table public.job_production_codes
  add constraint job_production_codes_quantity_finite_check check (
    quantity::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  add constraint job_production_codes_unit_rate_finite_check check (
    unit_rate_snapshot is null or unit_rate_snapshot::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  add constraint job_production_codes_amount_finite_check check (
    amount_snapshot is null or amount_snapshot::text not in ('NaN', 'Infinity', '-Infinity')
  );

alter table public.job_delivery_production_lines
  add constraint job_delivery_production_quantity_finite_check check (
    quantity::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  add constraint job_delivery_production_unit_rate_finite_check check (
    unit_rate_snapshot is null or unit_rate_snapshot::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  add constraint job_delivery_production_amount_finite_check check (
    amount_snapshot is null or amount_snapshot::text not in ('NaN', 'Infinity', '-Infinity')
  );

update public.job_pdf_annotations a
set description_snapshot = c.description
from public.production_code_catalog c
where c.id = a.catalog_id and a.description_snapshot is null;

with production_snapshots as (
  select line.id, coalesce(c.description, line.code) as description_snapshot,
    pc.id as price_category_id, pc.name as price_category_name
  from public.job_production_codes line
  join public.production_code_catalog c on c.id = line.catalog_id
  left join public.price_categories pc on pc.slug = case line.technician_type_snapshot
    when 'contractor' then 'subcontractor'
    when 'in_house' then 'inhouse'
  end
  where line.description_snapshot is null or line.price_category_id is null
)
update public.job_production_codes line
set description_snapshot = production_snapshots.description_snapshot,
    price_category_id = production_snapshots.price_category_id,
    price_category_name_snapshot = production_snapshots.price_category_name
from production_snapshots
where production_snapshots.id = line.id;

with resolved as (
  select l.id,
    coalesce(a.catalog_id, legacy.catalog_id) as catalog_item_id,
    coalesce(nullif(l.code, ''), a.code_snapshot) as code_snapshot,
    coalesce(a.description_snapshot, c.description, legacy_catalog.description, l.code) as description_snapshot,
    pc.id as price_category_id,
    pc.name as price_category_name
  from public.job_delivery_production_lines l
  left join public.job_deliveries d
    on d.id = l.delivery_id and d.job_id = l.job_id
  left join public.job_pdf_annotations a
    on a.id = l.source_annotation_id and a.job_id = l.job_id
  left join public.production_code_catalog c on c.id = a.catalog_id
  left join public.job_production_codes legacy
    on legacy.id = l.legacy_production_code_id and legacy.job_id = l.job_id
  left join public.production_code_catalog legacy_catalog on legacy_catalog.id = legacy.catalog_id
  left join public.price_categories pc on pc.slug = case l.technician_type_snapshot
    when 'contractor' then 'subcontractor'
    when 'in_house' then 'inhouse'
  end
  where l.price_category_id is null
    and d.id is not null
    and (
      (l.source_annotation_id is not null and a.id is not null)
      or (
        l.legacy_production_code_id is not null
        and legacy.id is not null
        and d.delivery_kind = 'legacy'
      )
    )
)
update public.job_delivery_production_lines l
set catalog_item_id = resolved.catalog_item_id,
    code_snapshot = resolved.code_snapshot,
    description_snapshot = resolved.description_snapshot,
    price_category_id = resolved.price_category_id,
    price_category_name_snapshot = resolved.price_category_name
from resolved
where resolved.id = l.id;

create or replace function public.snapshot_job_pdf_annotation_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare selected_catalog public.production_code_catalog%rowtype;
begin
  select * into selected_catalog
  from public.production_code_catalog
  where id = new.catalog_id and is_active;
  if selected_catalog.id is null then raise exception 'Production code unavailable'; end if;
  new.code_snapshot := selected_catalog.code;
  new.description_snapshot := selected_catalog.description;
  return new;
end;
$$;

drop trigger if exists snapshot_job_pdf_annotation_catalog_before_write
on public.job_pdf_annotations;
create trigger snapshot_job_pdf_annotation_catalog_before_write
before insert or update of catalog_id on public.job_pdf_annotations
for each row execute function public.snapshot_job_pdf_annotation_catalog();

create or replace function public.validate_delivery_production_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  annotation public.job_pdf_annotations%rowtype;
  selected_category public.price_categories%rowtype;
  selected_catalog public.production_code_catalog%rowtype;
  selected_rate numeric(12,3);
begin
  if tg_op = 'UPDATE' then
    if new.catalog_item_id is distinct from old.catalog_item_id
      or new.code is distinct from old.code
      or new.code_snapshot is distinct from old.code_snapshot
      or new.description_snapshot is distinct from old.description_snapshot
      or new.price_category_id is distinct from old.price_category_id
      or new.price_category_name_snapshot is distinct from old.price_category_name_snapshot
      or new.technician_type_snapshot is distinct from old.technician_type_snapshot
      or new.unit_snapshot is distinct from old.unit_snapshot
      or new.unit_rate_snapshot is distinct from old.unit_rate_snapshot
      or new.amount_snapshot is distinct from old.amount_snapshot
      or new.quantity is distinct from old.quantity
      or new.credited_technician_id is distinct from old.credited_technician_id
    then raise exception 'Delivered production snapshots are immutable'; end if;
    return new;
  end if;

  if not exists (
    select 1 from public.job_deliveries d
    where d.id = new.delivery_id and d.job_id = new.job_id
  ) then raise exception 'Delivery production lineage is invalid'; end if;

  if new.source_annotation_id is not null then
    select * into annotation
    from public.job_pdf_annotations a
    where a.id = new.source_annotation_id and a.job_id = new.job_id;
    if annotation.id is null then raise exception 'Delivery production annotation lineage is invalid'; end if;

    select * into selected_catalog
    from public.production_code_catalog c
    where c.id = annotation.catalog_id and c.is_active;
    select pc.* into selected_category
    from public.profiles p
    join public.price_categories pc on pc.id = p.price_category_id and pc.active
    where p.id = new.credited_technician_id and p.role = 'tecnico' and p.is_active;
    if selected_category.id is null then
      raise exception 'Technician price category is not configured';
    end if;

    select r.unit_price into selected_rate
    from public.production_code_rates r
    where r.catalog_item_id = selected_catalog.id
      and r.price_category_id = selected_category.id
      and r.active
      and r.effective_from <= (now() at time zone 'America/New_York')::date
    order by r.effective_from desc, r.created_at desc, r.id desc
    limit 1;
    if selected_rate is null then
      raise exception 'Production code has no configured rate for technician category';
    end if;

    new.catalog_item_id := selected_catalog.id;
    new.code := annotation.code_snapshot;
    new.code_snapshot := annotation.code_snapshot;
    new.description_snapshot := coalesce(annotation.description_snapshot, selected_catalog.description);
    new.price_category_id := selected_category.id;
    new.price_category_name_snapshot := selected_category.name;
    new.technician_type_snapshot := case selected_category.slug
      when 'inhouse' then 'in_house'
      when 'subcontractor' then 'contractor'
      else null
    end;
    new.unit_snapshot := selected_catalog.unit;
    new.unit_rate_snapshot := selected_rate;
    new.amount_snapshot := round(new.quantity * selected_rate, 2);
  elsif new.legacy_production_code_id is not null then
    if not exists (
      select 1
      from public.job_production_codes pc
      join public.job_deliveries d on d.id = new.delivery_id
      where pc.id = new.legacy_production_code_id
        and pc.job_id = new.job_id and d.delivery_kind = 'legacy'
    ) then raise exception 'Delivery production legacy lineage is invalid'; end if;
  else
    raise exception 'Delivery production lineage is invalid';
  end if;
  return new;
end;
$$;

drop function if exists public.list_my_production_catalog();
create function public.list_my_production_catalog()
returns table(
  id uuid, code text, description text, unit text, unit_rate numeric,
  price_category_id uuid, price_category_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.code, c.description, c.unit, rate.unit_price,
    pc.id, pc.name
  from public.profiles p
  cross join public.production_code_catalog c
  left join public.price_categories pc
    on pc.id = p.price_category_id and pc.active
  left join lateral (
    select r.unit_price
    from public.production_code_rates r
    where r.catalog_item_id = c.id
      and r.price_category_id = pc.id
      and r.active
      and r.effective_from <= (now() at time zone 'America/New_York')::date
    order by r.effective_from desc, r.created_at desc, r.id desc
    limit 1
  ) rate on true
  where p.id = auth.uid() and p.is_active and p.role = 'tecnico' and c.is_active
  order by c.sort_order, c.code, c.description, c.id;
$$;

create or replace function public.set_technician_price_category(
  p_technician_id uuid,
  p_price_category_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_technician_id and p.role = 'tecnico'
  ) then raise exception 'Technician unavailable'; end if;
  if p_price_category_id is not null and not exists (
    select 1 from public.price_categories pc
    where pc.id = p_price_category_id and pc.active
  ) then raise exception 'Price category unavailable'; end if;

  update public.profiles
  set price_category_id = p_price_category_id, updated_at = clock_timestamp()
  where id = p_technician_id and role = 'tecnico';
end;
$$;

create or replace function public.list_profiles_for_office()
returns table(
  id uuid, email text, full_name text, role public.user_role, is_active boolean,
  price_category_id uuid, price_category_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  return query
  select p.id, p.email, p.full_name, p.role, p.is_active,
    pc.id, pc.name
  from public.profiles p
  left join public.price_categories pc on pc.id = p.price_category_id
  order by p.full_name nulls last, p.email, p.id;
end;
$$;

create or replace function public.manage_production_catalog_item(
  p_item_id uuid,
  p_code text,
  p_description text,
  p_unit text,
  p_active boolean,
  p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result_id uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  if btrim(coalesce(p_code, '')) = '' or char_length(btrim(p_code)) > 64
    or btrim(coalesce(p_description, '')) = '' or char_length(btrim(p_description)) > 500
    or p_unit not in ('fixed', 'foot', 'hour', 'event')
    or p_sort_order not between 0 and 1000000
  then raise exception 'Invalid catalog item'; end if;

  if p_item_id is null then
    insert into public.production_code_catalog(
      code, description, unit, in_house_rate, contractor_rate, is_active, sort_order
    ) values (
      upper(btrim(p_code)), btrim(p_description), p_unit, 0, 0, coalesce(p_active, true), p_sort_order
    ) returning id into result_id;
  else
    update public.production_code_catalog
    set code = upper(btrim(p_code)), description = btrim(p_description),
      unit = p_unit, is_active = coalesce(p_active, true),
      sort_order = p_sort_order, updated_at = clock_timestamp()
    where id = p_item_id returning id into result_id;
    if result_id is null then raise exception 'Catalog item unavailable'; end if;
  end if;
  return result_id;
exception when unique_violation then
  raise exception 'An identical catalog item already exists';
end;
$$;

create or replace function public.set_production_catalog_rate(
  p_catalog_item_id uuid,
  p_price_category_id uuid,
  p_unit_price numeric,
  p_effective_from date,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result_id uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  if p_unit_price is null
    or p_unit_price::text in ('NaN', 'Infinity', '-Infinity')
    or p_unit_price < 0
    or p_unit_price <> round(p_unit_price, 3)
    or p_effective_from is null
    or not exists (select 1 from public.production_code_catalog where id = p_catalog_item_id)
    or not exists (select 1 from public.price_categories where id = p_price_category_id and active)
  then raise exception 'Invalid catalog rate'; end if;

  insert into public.production_code_rates(
    catalog_item_id, price_category_id, unit_price, effective_from, active
  ) values (
    p_catalog_item_id, p_price_category_id, p_unit_price, p_effective_from, coalesce(p_active, true)
  )
  on conflict (catalog_item_id, price_category_id, effective_from) do update set
    unit_price = excluded.unit_price,
    active = excluded.active,
    updated_at = clock_timestamp()
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.add_job_production(
  p_job_id uuid,
  p_catalog_id uuid,
  p_quantity numeric,
  p_production_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_profile public.profiles%rowtype;
  catalog public.production_code_catalog%rowtype;
  selected_category public.price_categories%rowtype;
  selected_rate numeric(12,3);
  selected_job public.jobs%rowtype;
  result_id uuid;
begin
  select * into actor_profile from public.profiles
  where id = actor and is_active and role = 'tecnico';
  if actor_profile.id is null then raise exception 'Active technician required'; end if;
  perform public.require_active_technician_shift(actor);
  if p_quantity is null
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_quantity <= 0
  then raise exception 'Quantity must be a finite positive number'; end if;
  if p_production_date is not null
    and p_production_date <> (now() at time zone 'America/New_York')::date
  then raise exception 'Technicians cannot backdate production'; end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  perform public.require_active_technician_shift(actor);
  if selected_job.id is null or not public.can_access_job(p_job_id, actor)
  then raise exception 'Job unavailable'; end if;
  if selected_job.main_status <> 'en_progreso' or selected_job.archived_at is not null
  then raise exception 'Job is not in progress'; end if;

  select * into catalog from public.production_code_catalog
  where id = p_catalog_id and is_active;
  if catalog.id is null then raise exception 'Production code unavailable'; end if;
  select * into selected_category from public.price_categories
  where id = actor_profile.price_category_id and active;
  if selected_category.id is null then raise exception 'Technician price category is not configured'; end if;
  select r.unit_price into selected_rate
  from public.production_code_rates r
  where r.catalog_item_id = catalog.id
    and r.price_category_id = selected_category.id and r.active
    and r.effective_from <= (now() at time zone 'America/New_York')::date
  order by r.effective_from desc, r.created_at desc, r.id desc limit 1;
  if selected_rate is null then raise exception 'Production code has no configured rate for technician category'; end if;

  perform public.require_active_technician_shift(actor);
  insert into public.job_production_codes(
    job_id, code, quantity, notes, added_by, catalog_id,
    credited_technician_id, technician_type_snapshot, unit_snapshot,
    unit_rate_snapshot, amount_snapshot, production_date,
    description_snapshot, price_category_id, price_category_name_snapshot
  ) values (
    p_job_id, catalog.code, p_quantity, nullif(btrim(p_notes), ''), actor,
    catalog.id, actor,
    case selected_category.slug when 'inhouse' then 'in_house'
      when 'subcontractor' then 'contractor' else null end,
    catalog.unit, selected_rate, round(p_quantity * selected_rate, 2),
    coalesce(p_production_date, (now() at time zone 'America/New_York')::date),
    catalog.description, selected_category.id, selected_category.name
  ) returning id into result_id;
  return result_id;
end;
$$;

alter table public.price_categories enable row level security;
alter table public.production_code_rates enable row level security;
create policy "Office staff can view price categories"
on public.price_categories for select to authenticated
using (public.is_office_staff());
create policy "Admins can manage price categories"
on public.price_categories for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Office staff can view production rates"
on public.production_code_rates for select to authenticated
using (public.is_office_staff());
create policy "Admins can manage production rates"
on public.production_code_rates for all to authenticated
using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.price_categories to authenticated;
grant select, insert, update, delete on public.production_code_rates to authenticated;
revoke all on function public.snapshot_job_pdf_annotation_catalog() from public;
revoke all on function public.validate_delivery_production_line() from public;
revoke all on function public.list_my_production_catalog() from public;
revoke all on function public.set_technician_price_category(uuid, uuid) from public;
revoke all on function public.list_profiles_for_office() from public;
revoke all on function public.manage_production_catalog_item(uuid, text, text, text, boolean, integer) from public;
revoke all on function public.set_production_catalog_rate(uuid, uuid, numeric, date, boolean) from public;
revoke all on function public.add_job_production(uuid, uuid, numeric, date, text) from public;
grant execute on function public.list_my_production_catalog() to authenticated;
grant execute on function public.set_technician_price_category(uuid, uuid) to authenticated;
grant execute on function public.list_profiles_for_office() to authenticated;
grant execute on function public.manage_production_catalog_item(uuid, text, text, text, boolean, integer) to authenticated;
grant execute on function public.set_production_catalog_rate(uuid, uuid, numeric, date, boolean) to authenticated;
grant execute on function public.add_job_production(uuid, uuid, numeric, date, text) to authenticated;
