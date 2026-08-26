-- Soft-delete (desactivar) un código del catálogo de producción.
-- Conserva el historial de producción desactivando el ítem en lugar de eliminarlo.

create or replace function public.deactivate_production_catalog_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  update public.production_code_catalog
  set is_active = false, updated_at = clock_timestamp()
  where id = p_item_id;
  if not found then raise exception 'Catalog item unavailable'; end if;
end;
$$;

revoke all on function public.deactivate_production_catalog_item(uuid) from public;
grant execute on function public.deactivate_production_catalog_item(uuid) to authenticated;
