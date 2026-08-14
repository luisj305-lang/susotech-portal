import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(new URL("../.env.local", import.meta.url));

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing required Supabase server environment variables");

const fixture = JSON.parse(readFileSync(
  new URL("../docs/pricing/wallace/wallace-pricing-catalog.json", import.meta.url),
  "utf8",
));
const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

async function ok(label, request) {
  const { data, error } = await request;
  assert.ifError(error && new Error(`${label}: ${error.message}`));
  return data;
}

function priceKey(catalogItemId, categoryId) {
  return `${catalogItemId}:${categoryId}`;
}

const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
let adminUserId;

try {
const created = await ok("create runtime admin", service.auth.admin.createUser({
  email: `wallace-pricing-${runId}@example.com`, password, email_confirm: true,
}));
adminUserId = created.user?.id;
check(Boolean(adminUserId), "runtime admin has an id");
await ok("configure runtime admin", service.from("profiles").update({
  role: "admin", is_active: true, full_name: "Wallace pricing verifier",
}).eq("id", adminUserId));
const admin = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
await ok("sign in runtime admin", admin.auth.signInWithPassword({
  email: `wallace-pricing-${runId}@example.com`, password,
}));

const source = await ok("read Wallace source", admin.from("production_catalog_sources")
  .select("id,slug,source_sha256,source_page_count,source_heading")
  .eq("slug", "wallace-wr-line-pole-solutions-2026-08-13")
  .single());
check(source.source_sha256 === fixture.sourceSha256, "persisted Wallace source hash matches fixture");
check(source.source_page_count === fixture.sourcePageCount, "persisted Wallace page count matches fixture");
check(source.source_heading === fixture.sourceHeading, "persisted Wallace heading matches fixture");

const categories = await ok("read price categories", admin.from("price_categories")
  .select("id,slug,active").in("slug", ["inhouse", "subcontractor", "wallace"]));
const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
for (const slug of ["inhouse", "subcontractor", "wallace"]) {
  check(categoryBySlug.get(slug)?.active === true, `${slug} category is active`);
}

const sourceRows = await ok("read Wallace source rows", admin.from("production_catalog_source_rows")
  .select("source_row,catalog_item_id").eq("source_id", source.id)
  .order("source_row", { ascending: true }));
check(sourceRows.length === fixture.expectedCatalogRowCount, "persisted Wallace source has exactly 59 rows");
check(sourceRows.every((row, index) => row.source_row === index + 1), "persisted source rows are contiguous and ordered");

const itemIds = sourceRows.map((row) => row.catalog_item_id);
const items = await ok("read Wallace catalog mappings", admin.from("production_code_catalog")
  .select("id,code,description").in("id", itemIds));
const itemById = new Map(items.map((item) => [item.id, item]));
const persistedRows = sourceRows.map((row) => {
  const item = itemById.get(row.catalog_item_id);
  return {
    sourceRow: row.source_row,
    code: item?.code,
    description: item?.description,
  };
});
assert.deepEqual(
  persistedRows,
  fixture.rows.map(({ sourceRow, code, description }) => ({ sourceRow, code, description })),
  "persisted Wallace source mappings must exactly match the fixture",
);
checks += 1;

const rates = await ok("read imported Wallace rates", admin.from("production_code_rates")
  .select("catalog_item_id,price_category_id,unit_price,effective_from,active")
  .eq("price_category_id", categoryBySlug.get("wallace").id)
  .eq("effective_from", "2026-08-13"));
check(rates.length === fixture.expectedCatalogRowCount, "Wallace source date has exactly 59 rates and no extras");
check(rates.every((rate) => rate.active), "all imported Wallace rates are active");
assert.deepEqual(
  [...rates.map((rate) => rate.catalog_item_id)].sort(),
  [...itemIds].sort(),
  "the complete Wallace rate item set must equal the 59 source mappings",
);
checks += 1;
const rateByItem = new Map(rates.map((rate) => [rate.catalog_item_id, rate]));
assert.deepEqual(
  sourceRows.map((row) => Number(rateByItem.get(row.catalog_item_id)?.unit_price).toFixed(2)),
  fixture.rows.map((row) => Number(row.unitPrice).toFixed(2)),
  "persisted Wallace prices must match the fixture in source order",
);
checks += 1;

const representativeItems = await ok("read representative catalog items", admin.from("production_code_catalog")
  .select("id,code,description")
  .in("code", ["AC01", "MC09", "001"]));
const expectedRepresentativeDescriptions = new Map([
  ["AC01", "Coax-Composite New Aerial (minimum job length 1000')"],
  ["MC09", "Service Method or Procedure (SMOP) Work"],
  ["001", "Trip charge"],
]);
const exactRepresentativeItems = representativeItems.filter((item) =>
  item.description === expectedRepresentativeDescriptions.get(item.code));
check(exactRepresentativeItems.length === 3, "representative catalog items resolve by exact code and description");
const representativeIds = exactRepresentativeItems.map((item) => item.id);
const representativeRates = await ok("read representative category rates", admin.from("production_code_rates")
  .select("catalog_item_id,price_category_id,unit_price,effective_from,active")
  .in("catalog_item_id", representativeIds)
  .in("price_category_id", categories.map((category) => category.id))
  .eq("active", true)
  .lte("effective_from", "2026-08-13")
  .order("effective_from", { ascending: false }));
const latest = new Map();
for (const rate of representativeRates) {
  const key = priceKey(rate.catalog_item_id, rate.price_category_id);
  if (!latest.has(key)) latest.set(key, Number(rate.unit_price));
}
const itemByCode = new Map(exactRepresentativeItems.map((item) => [item.code, item]));
const applicableRate = (code, slug) => latest.get(priceKey(itemByCode.get(code).id, categoryBySlug.get(slug).id));
check(applicableRate("AC01", "inhouse") === 0.65, "Wallace import preserves AC01 Inhouse rate");
check(applicableRate("AC01", "subcontractor") === 0.7, "Wallace import preserves AC01 Subcontractor rate");
check(applicableRate("AC01", "wallace") === 0.94, "AC01 Wallace rate links only to Wallace category");
check(applicableRate("MC09", "subcontractor") === 50, "Wallace import preserves received MC09 Subcontractor rate");
check(applicableRate("MC09", "wallace") === 25, "MC09 Wallace rate remains category-specific");
check(applicableRate("001", "inhouse") === 33.59, "001 Inhouse rate remains isolated");
check(applicableRate("001", "subcontractor") === 40, "001 Subcontractor rate remains isolated");
check(applicableRate("001", "wallace") === undefined, "001 has no invented Wallace rate");

console.log(`[wallace-pricing-runtime] PASS checks=${checks} rows=${sourceRows.length} rates=${rates.length}`);
} finally {
  if (adminUserId) {
    const { error } = await service.auth.admin.deleteUser(adminUserId);
    assert.ifError(error && new Error(`cleanup runtime admin: ${error.message}`));
  }
}
