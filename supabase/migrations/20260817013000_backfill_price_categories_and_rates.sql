-- Repair contractor price-category and catalog-rate gaps. Idempotent:
-- fills only NULL profile categories and only (item, category) pairs that
-- have no active rate yet. wallace has no legacy source and stays managed
-- through set_production_catalog_rate.

update public.profiles p
set price_category_id = pc.id,
    updated_at = clock_timestamp()
from public.price_categories pc
where p.role = 'tecnico'
  and p.price_category_id is null
  and pc.slug = case p.technician_type
    when 'contractor' then 'subcontractor'
    when 'in_house' then 'inhouse'
  end;

insert into public.production_code_rates (
  catalog_item_id, price_category_id, unit_price, effective_from, active
)
select c.id, pc.id,
  case pc.slug when 'inhouse' then c.in_house_rate else c.contractor_rate end,
  date '2026-08-17', true
from public.production_code_catalog c
join public.price_categories pc on pc.slug in ('inhouse', 'subcontractor')
where c.is_active
  and not exists (
    select 1
    from public.production_code_rates r
    where r.catalog_item_id = c.id
      and r.price_category_id = pc.id
      and r.active
  )
on conflict (catalog_item_id, price_category_id, effective_from) do update set
  unit_price = excluded.unit_price,
  active = true,
  updated_at = clock_timestamp();
