-- Punto 4: eliminar códigos con tarifa $0.000 (aparecían como códigos sin precio real).
-- Desactivamos las tarifas cero existentes y rechazamos nuevas tarifas con precio <= 0.

update public.production_code_rates
set active = false, updated_at = clock_timestamp()
where unit_price = 0 and active;

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
    or p_unit_price <= 0
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
