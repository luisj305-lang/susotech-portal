import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/catalogo/page.tsx");
const manager = read("src/components/catalog-manager.tsx");
const actions = read("src/lib/catalog/actions.ts");
const migration = read("supabase/migrations/20260820013000_catalog_item_deactivate.sql");

assert.match(page, /from\("production_code_catalog"\)[\s\S]*?\.eq\("is_active", true\)/u,
  "the catalog page must hide soft-deleted items");
assert.match(manager, /deleteCatalogItem\(\{ id: editing\.id \}\)/u);
assert.match(manager, /type="button" variant="danger"[\s\S]*?onClick=\{confirmDeleteItem\}/u);
assert.match(actions, /rpc\("deactivate_production_catalog_item"/u);
assert.match(migration, /set is_active = false/u);

console.log("[catalog-deletion-static] PASS soft_deleted_items_hidden=true");
