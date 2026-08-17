"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveCatalogItem, saveCatalogRate } from "@/lib/catalog/actions";

type Unit = "fixed" | "foot" | "hour" | "event";
type Item = { id: string; code: string; description: string; unit: Unit; is_active: boolean; sort_order: number };
type Category = { id: string; slug: string; name: string; active: boolean };
type Rate = { id: string; catalog_item_id: string; price_category_id: string; unit_price: number; effective_from: string; active: boolean };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

export function CatalogManager({ canManage, initialItems, categories, rates }: {
  canManage: boolean;
  initialItems: Item[];
  categories: Category[];
  rates: Rate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [rateTarget, setRateTarget] = useState<{ item: Item; category: Category; price: string } | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? initialItems.filter((item) => `${item.code} ${item.description}`.toLocaleLowerCase().includes(normalized)) : initialItems;
  }, [initialItems, query]);
  const latestRates = useMemo(() => {
    const result = new Map<string, Rate>();
    const currentDate = today();
    for (const rate of rates.filter((item) => item.active && item.effective_from <= currentDate)) {
      const key = `${rate.catalog_item_id}:${rate.price_category_id}`;
      if (!result.has(key)) result.set(key, rate);
    }
    return result;
  }, [rates]);
  const activeCategories = categories.filter((category) => category.active);
  const itemsWithoutRates = (items: Item[]) => items.filter((item) => activeCategories.every((category) => !latestRates.has(`${item.id}:${category.id}`)));

  const submitItem = (formData: FormData) => startTransition(async () => {
    const result = await saveCatalogItem({
      id: editing?.id ?? null,
      code: String(formData.get("code") ?? ""),
      description: String(formData.get("description") ?? ""),
      unit: String(formData.get("unit") ?? ""),
      active: formData.get("active") === "on",
      sortOrder: Number(formData.get("sortOrder")),
    });
    setMessage(result.message);
    if (result.success) { setEditing(null); router.refresh(); }
  });
  const submitRate = (formData: FormData) => startTransition(async () => {
    if (!rateTarget) return;
    const result = await saveCatalogRate({
      catalogItemId: rateTarget.item.id,
      priceCategoryId: rateTarget.category.id,
      unitPrice: String(formData.get("unitPrice") ?? ""),
      effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
      active: formData.get("active") === "on",
    });
    setMessage(result.message);
    if (result.success) { setRateTarget(null); router.refresh(); }
  });

  return <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
    <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:underline">← Volver al dashboard</Link>
    <h1 className="mt-6 text-3xl font-bold text-ink">Catálogo y tarifas</h1>
    <p className="mt-2 text-ink-muted">{canManage ? "Administra códigos y tarifas vigentes. Las entregas históricas conservan su snapshot." : "Consulta códigos y tarifas vigentes."}</p>
    {message && <p role="status" className="mt-4 text-sm font-medium text-ink-soft">{message}</p>}
    <label className="mt-6 grid max-w-xl gap-1 text-sm font-medium text-ink-soft">Buscar por código o descripción<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>

    {canManage && <form action={submitItem} className="mt-6 grid max-w-4xl gap-3 rounded-2xl border border-line bg-white p-4 shadow-soft sm:grid-cols-2">
      <h2 className="text-xl font-bold text-ink sm:col-span-2">{editing ? `Editar ${editing.code}` : "Agregar código"}</h2>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Código<input name="code" defaultValue={editing?.code ?? ""} required maxLength={64} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Descripción<input name="description" defaultValue={editing?.description ?? ""} required maxLength={500} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Unidad<select name="unit" defaultValue={editing?.unit ?? "fixed"} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="fixed">Unidad</option><option value="foot">Pie</option><option value="hour">Hora</option><option value="event">Evento</option></select></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Orden<input name="sortOrder" type="number" min="0" max="1000000" defaultValue={editing?.sort_order ?? initialItems.length + 1} required className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
      <label className="flex items-center gap-2 text-sm text-ink-soft"><input name="active" type="checkbox" defaultChecked={editing?.is_active ?? true} />Activo</label>
      <div className="flex gap-2"><Button disabled={pending}>Guardar código</Button>{editing && <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>}</div>
    </form>}

    <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-white"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted"><th className="px-4 py-3 text-left font-semibold">Código</th><th className="px-4 py-3 text-left font-semibold">Descripción</th><th className="px-4 py-3 text-left font-semibold">Unidad</th>{activeCategories.map((category) => <th key={category.id} className="px-4 py-3 text-left font-semibold">{category.name}</th>)}{canManage && <th className="px-4 py-3 font-semibold">Acciones</th>}</tr></thead><tbody>{filtered.map((item) => { const withoutRates = activeCategories.every((category) => !latestRates.has(`${item.id}:${category.id}`)); return <tr key={item.id} className="border-t border-line"><td className="px-4 py-3 font-semibold text-ink">{item.code}{withoutRates && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Sin tarifas activas</span>}</td><td className="px-4 py-3 text-ink-soft">{item.description}</td><td className="px-4 py-3 text-ink-soft">{item.unit}</td>{activeCategories.map((category) => { const rate = latestRates.get(`${item.id}:${category.id}`); return <td key={category.id} className="px-4 py-3 text-ink-soft">{rate ? `$${Number(rate.unit_price).toFixed(3)}` : "Sin tarifa"}{canManage && <button type="button" className="ml-2 text-accent-600 underline" onClick={() => setRateTarget({ item, category, price: rate ? String(rate.unit_price) : "" })}>Editar</button>}</td>; })}{canManage && <td className="px-4 py-3"><button type="button" className="text-accent-600 underline" onClick={() => setEditing(item)}>Editar código</button></td>}</tr>; })}</tbody></table></div>
    {itemsWithoutRates(initialItems).length > 0 && <p className="mt-3 text-sm text-ink-soft">Hay {itemsWithoutRates(initialItems).length} código(s) activo(s) sin tarifas activas: los técnicos no los verán en su catálogo hasta que un administrador cargue una tarifa.</p>}

    {rateTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-brand-950/40 p-4"><form action={submitRate} className="grid w-full max-w-md gap-3 rounded-2xl border border-line bg-white p-6 text-ink shadow-card"><h2 className="text-xl font-bold text-ink">{rateTarget.item.code} · {rateTarget.category.name}</h2><p className="text-sm text-ink-muted">{rateTarget.item.description}</p><label className="grid gap-1 text-sm font-medium text-ink-soft">Precio unitario<input name="unitPrice" type="number" min="0" step="0.001" defaultValue={rateTarget.price} required className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Vigente desde<input name="effectiveFrom" type="date" defaultValue={today()} required className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><label className="flex items-center gap-2 text-sm text-ink-soft"><input name="active" type="checkbox" defaultChecked />Activa</label><div className="flex gap-2"><Button disabled={pending}>Guardar tarifa</Button><Button type="button" variant="secondary" onClick={() => setRateTarget(null)}>Cancelar</Button></div></form></div>}
  </div>;
}
