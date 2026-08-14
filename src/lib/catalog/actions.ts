"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Result = { success: boolean; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const units = ["fixed", "foot", "hour", "event"] as const;

export async function saveCatalogItem(input: {
  id?: string | null;
  code: string;
  description: string;
  unit: string;
  active: boolean;
  sortOrder: number;
}): Promise<Result> {
  await requireAdmin();
  if ((input.id && !uuidPattern.test(input.id)) || !input.code.trim() || input.code.trim().length > 64
    || !input.description.trim() || input.description.trim().length > 500
    || !units.includes(input.unit as typeof units[number])
    || !Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 1_000_000) {
    return { success: false, message: "Los datos del código no son válidos." };
  }
  const { error } = await (await createClient()).rpc("manage_production_catalog_item", {
    p_item_id: input.id ?? null,
    p_code: input.code,
    p_description: input.description,
    p_unit: input.unit,
    p_active: input.active,
    p_sort_order: input.sortOrder,
  });
  if (error) return { success: false, message: "No se pudo guardar el código del catálogo." };
  revalidatePath("/catalogo");
  return { success: true, message: "Código del catálogo guardado." };
}

export async function saveCatalogRate(input: {
  catalogItemId: string;
  priceCategoryId: string;
  unitPrice: string;
  effectiveFrom: string;
  active: boolean;
}): Promise<Result> {
  await requireAdmin();
  if (!uuidPattern.test(input.catalogItemId) || !uuidPattern.test(input.priceCategoryId)
    || !/^\d+(?:\.\d{1,3})?$/.test(input.unitPrice)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    return { success: false, message: "Los datos de la tarifa no son válidos." };
  }
  const { error } = await (await createClient()).rpc("set_production_catalog_rate", {
    p_catalog_item_id: input.catalogItemId,
    p_price_category_id: input.priceCategoryId,
    p_unit_price: input.unitPrice,
    p_effective_from: input.effectiveFrom,
    p_active: input.active,
  });
  if (error) return { success: false, message: "No se pudo guardar la tarifa." };
  revalidatePath("/catalogo");
  return { success: true, message: "Tarifa guardada sin modificar entregas anteriores." };
}
