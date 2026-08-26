import { CatalogManager } from "@/components/catalog-manager";
import { AppShell } from "@/components/dashboard/app-shell";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function CatalogPage() {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const [items, categories, rates] = await Promise.all([
    supabase.from("production_code_catalog").select("id,code,description,unit,is_active,sort_order").eq("is_active", true).order("sort_order").order("code"),
    supabase.from("price_categories").select("id,slug,name,active").order("name"),
    supabase.from("production_code_rates").select("id,catalog_item_id,price_category_id,unit_price,effective_from,active").order("effective_from", { ascending: false }),
  ]);
  if (items.error || categories.error || rates.error) throw new Error("No se pudo cargar el catálogo de precios.");
  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <CatalogManager
        canManage={profile.role === "admin"}
        initialItems={items.data ?? []}
        categories={categories.data ?? []}
        rates={rates.data ?? []}
      />
    </AppShell>
  );
}
