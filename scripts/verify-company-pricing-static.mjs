import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const fixture = JSON.parse(read("../docs/pricing/company/company-pricing-catalog.json"));
const source = readFileSync(new URL(`../${fixture.sourceFile}`, import.meta.url));
const migration = read("../supabase/migrations/20260820009000_import_company_rates.sql");
const usersPage = read("../app/usuarios/page.tsx");

const payload = migration.match(/jsonb_to_recordset\('(\[.*?\])'::jsonb\)/su)?.[1];
assert.ok(payload, "Company migration must contain a JSON row payload");
const migrationRows = JSON.parse(payload.replaceAll("''", "'"));

assert.equal(fixture.sourceSha256, createHash("sha256").update(source).digest("hex"));
assert.equal(fixture.sourcePageCount, 1);
assert.equal(fixture.sourceHeading, "Aerial Subcontractors");
assert.equal(fixture.expectedCatalogRowCount, 59);
assert.equal(fixture.rows.length, 59);
assert.deepEqual(migrationRows, fixture.rows);
assert.equal(fixture.rows[0].unitPrice, "1.40");
assert.equal(fixture.rows[19].unitPrice, "66.50");
assert.equal(fixture.rows[40].unitPrice, "175.00");
assert.equal(fixture.rows[58].unitPrice, "0.18");
assert.match(migration, /\('company', 'Tarifa de la compañía', true, false\)/u);
assert.match(migration, /technician_assignable boolean not null default true/u);
assert.match(migration, /pc\.technician_assignable/u);
assert.match(migration, /pc\.slug = 'company'/u);
assert.match(migration, /slug <> 'company'/u);
assert.match(migration, /profiles_require_assignable_price_category/u);
assert.match(migration, /validate_assignable_technician_price_category/u);
assert.match(usersPage, /\.eq\("technician_assignable", true\)/u);

console.log("[company-pricing-static] PASS source-bound rows=59 category=company technician-assignable=false");
