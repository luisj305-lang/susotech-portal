import { CatalogManager } from "@/components/catalog-manager";
import { requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function CatalogPage() {
  const profile = await requireSupervisor();
  const supabase = await createClient();
  const [items, categories, rates] = await Promise.all([
    supabase.from("production_code_catalog").select("id,code,description,unit,is_active,sort_order").order("sort_order").order("code"),
    supabase.from("price_categories").select("id,slug,name,active").order("name"),
    supabase.from("production_code_rates").select("id,catalog_item_id,price_category_id,unit_price,effective_from,active").order("effective_from", { ascending: false }),
  ]);
  if (items.error || categories.error || rates.error) throw new Error("No se pudo cargar el catálogo de precios.");
  return <CatalogManager
    canManage={profile.role === "admin"}
    initialItems={items.data ?? []}
    categories={categories.data ?? []}
    rates={rates.data ?? []}
  />;
}
