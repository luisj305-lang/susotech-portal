"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

  return <main className="min-h-screen p-4 sm:p-8">
    <Link href="/dashboard">← Volver al dashboard</Link>
    <h1 className="mt-5 text-3xl font-bold">Catálogo y tarifas</h1>
    <p className="mt-2">{canManage ? "Administra códigos y tarifas vigentes. Las entregas históricas conservan su snapshot." : "Consulta códigos y tarifas vigentes."}</p>
    {message && <p role="status" className="mt-4 font-semibold">{message}</p>}
    <label className="mt-6 grid max-w-xl gap-1 font-semibold">Buscar por código o descripción<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-12 border border-current bg-transparent p-3" /></label>

    {canManage && <form action={submitItem} className="mt-6 grid max-w-4xl gap-3 border border-current p-4 sm:grid-cols-2">
      <h2 className="text-xl font-bold sm:col-span-2">{editing ? `Editar ${editing.code}` : "Agregar código"}</h2>
      <label className="grid gap-1">Código<input name="code" defaultValue={editing?.code ?? ""} required maxLength={64} className="min-h-11 border border-current bg-transparent p-2" /></label>
      <label className="grid gap-1">Descripción<input name="description" defaultValue={editing?.description ?? ""} required maxLength={500} className="min-h-11 border border-current bg-transparent p-2" /></label>
      <label className="grid gap-1">Unidad<select name="unit" defaultValue={editing?.unit ?? "fixed"} className="min-h-11 border border-current bg-white p-2"><option value="fixed">Unidad</option><option value="foot">Pie</option><option value="hour">Hora</option><option value="event">Evento</option></select></label>
      <label className="grid gap-1">Orden<input name="sortOrder" type="number" min="0" max="1000000" defaultValue={editing?.sort_order ?? initialItems.length + 1} required className="min-h-11 border border-current bg-transparent p-2" /></label>
      <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked={editing?.is_active ?? true} />Activo</label>
      <div className="flex gap-2"><button disabled={pending} className="min-h-11 border border-current px-4 font-bold">Guardar código</button>{editing && <button type="button" onClick={() => setEditing(null)} className="min-h-11 border border-current px-4">Cancelar</button>}</div>
    </form>}

    <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[900px] border-collapse"><thead><tr><th className="p-2 text-left">Código</th><th className="p-2 text-left">Descripción</th><th className="p-2 text-left">Unidad</th>{activeCategories.map((category) => <th key={category.id} className="p-2 text-left">{category.name}</th>)}{canManage && <th className="p-2">Acciones</th>}</tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className="border-t border-current"><td className="p-2 font-bold">{item.code}</td><td className="p-2">{item.description}</td><td className="p-2">{item.unit}</td>{activeCategories.map((category) => { const rate = latestRates.get(`${item.id}:${category.id}`); return <td key={category.id} className="p-2">{rate ? `$${Number(rate.unit_price).toFixed(3)}` : "Sin tarifa"}{canManage && <button type="button" className="ml-2 underline" onClick={() => setRateTarget({ item, category, price: rate ? String(rate.unit_price) : "" })}>Editar</button>}</td>; })}{canManage && <td className="p-2"><button type="button" className="underline" onClick={() => setEditing(item)}>Editar código</button></td>}</tr>)}</tbody></table></div>

    {rateTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"><form action={submitRate} className="grid w-full max-w-md gap-3 border border-black bg-white p-5 text-black"><h2 className="text-xl font-bold">{rateTarget.item.code} · {rateTarget.category.name}</h2><p>{rateTarget.item.description}</p><label className="grid gap-1">Precio unitario<input name="unitPrice" type="number" min="0" step="0.001" defaultValue={rateTarget.price} required className="min-h-11 border border-black bg-white p-2" /></label><label className="grid gap-1">Vigente desde<input name="effectiveFrom" type="date" defaultValue={today()} required className="min-h-11 border border-black bg-white p-2" /></label><label className="flex gap-2"><input name="active" type="checkbox" defaultChecked />Activa</label><div className="flex gap-2"><button disabled={pending} className="min-h-11 bg-black px-4 font-bold text-white">Guardar tarifa</button><button type="button" onClick={() => setRateTarget(null)} className="min-h-11 border border-black px-4">Cancelar</button></div></form></div>}
  </main>;
}
