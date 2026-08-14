import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260813036000_normalize_price_categories.sql", "utf8");
const wallace = readFileSync("supabase/migrations/20260813037000_import_wallace_rates.sql", "utf8");
const editor = readFileSync("src/components/jobs/pdf-code-editor.tsx", "utf8");
const users = readFileSync("src/lib/users/actions.ts", "utf8");
const usersPage = readFileSync("app/usuarios/page.tsx", "utf8");
const route = readFileSync("app/api/trabajos/[id]/pdf-entregado/route.ts", "utf8");
const catalogActions = readFileSync("src/lib/catalog/actions.ts", "utf8");
const catalogPage = readFileSync("app/catalogo/page.tsx", "utf8");
const catalogManager = readFileSync("src/components/catalog-manager.tsx", "utf8");

for (const category of ["inhouse", "subcontractor", "wallace"]) {
  assert.match(migration, new RegExp(`'${category}'`));
}
assert.match(migration, /create table public\.price_categories/);
assert.match(migration, /create table public\.production_code_rates/);
assert.doesNotMatch(migration, /unique\s*\(\s*code\s*\)/i);
assert.match(migration, /Technician price category is not configured/);
assert.match(migration, /Production code has no configured rate for technician category/);
assert.match(migration, /new\.amount_snapshot := round\(new\.quantity \* selected_rate, 2\)/);
assert.match(migration, /Delivered production snapshots are immutable/);
assert.match(migration, /create or replace function public\.list_profiles_for_office/);
assert.match(migration, /create or replace function public\.manage_production_catalog_item/);
assert.match(migration, /create or replace function public\.set_production_catalog_rate/);
assert.doesNotMatch(migration, /Office staff can view profiles/);
assert.match(migration, /\('001', 'Trip charge', 'inhouse', 33\.590/);
assert.match(migration, /\('001', 'Trip charge', 'subcontractor', 40\.000/);
assert.match(migration, /\('MC01A', 'Description not provided', 'subcontractor', 46\.200/);
assert.match(migration, /\('MC09', 'Service Method or Procedure \(SMOP\) Work', 'subcontractor', 50\.000/);
assert.doesNotMatch(migration, /\('MC01-A',/i, "MC01A must not be normalized to MC01-A");

assert.match(wallace, /edb67a41c7f514ea4175108a96b9919fd2ff9adb16c7c23eae204d43b9b55c90/);
assert.equal((wallace.match(/"sourceRow":/g) ?? []).length, 59);
assert.ok(!wallace.includes("ONE \\\"AS18\\\" PER POLE"));
assert.match(wallace, /pc\.slug = 'wallace'/);
assert.match(wallace, /production_catalog_source_rows/);
assert.match(wallace, /Wallace pricing source identity mismatch/);
assert.doesNotMatch(wallace, /on conflict \(slug\) do update/i);

assert.match(editor, /type="search"/);
assert.match(editor, /item\.code} — {item\.description} —/);
assert.match(editor, /Sin tarifa configurada/);
assert.match(editor, /Categoría aplicable:/);
assert.match(editor, /hasUnratedPlacement/);
assert.match(editor, /pb-\[28rem\]/);
assert.match(users, /await \(await createClient\(\)\)\.rpc\("set_technician_price_category"/);
assert.match(usersPage, /requireSupervisor/);
assert.match(usersPage, /canManage=\{currentProfile\.role === "admin"\}/);
assert.match(route, /price_category_id/);
assert.match(route, /production_code_rates/);
assert.match(catalogActions, /await requireAdmin\(\)/);
assert.match(catalogActions, /await \(await createClient\(\)\)\.rpc/);
assert.match(catalogPage, /requireSupervisor/);
assert.match(catalogManager, /item\.active && item\.effective_from <= currentDate/);
assert.match(catalogManager, /activeCategories/);

console.log("PASS pricing catalog static checks");
