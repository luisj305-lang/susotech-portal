import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const fixtureUrl = new URL("../docs/pricing/wallace/wallace-pricing-catalog.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
const sourceUrl = new URL(`../${fixture.sourceFile}`, import.meta.url);
const sourceHash = createHash("sha256").update(readFileSync(sourceUrl)).digest("hex");
const migrationUrl = new URL("../supabase/migrations/20260813037000_import_wallace_rates.sql", import.meta.url);
const migration = readFileSync(migrationUrl, "utf8");

function parseMigrationRows(sql) {
  const payload = sql.match(/jsonb_to_recordset\('(\[.*?\])'::jsonb\)/su)?.[1];
  assert.ok(payload, "Wallace migration must contain a JSON row payload");

  // PostgreSQL escapes apostrophes inside a string literal by doubling them.
  return JSON.parse(payload.replaceAll("''", "'"));
}

const expectedCodePrices = `
AC01|0.94
AC01-A|1.02
AC02|0.92
AC02-A|0.99
AC04|0.33
AC05|0.94
AS02|0.27
AS03|0.27
AS03-A|0.29
AS04|0.32
AS04-A|0.34
AS05|0.08
AS06|0.28
AS06-A|0.31
AS07|0.35
AS07-A|0.40
AS08|0.11
AS09|23.50
AS12|44.65
AS12|44.65
AS13|44.65
AS14|23.50
AS18|32.90
AS18|32.90
AS18|32.90
AS18|32.90
AS18|32.90
AS18|32.90
AS18|32.90
AS18|32.90
AS18|32.90
AS19|0.09
AS20|0.13
AS24|45.00
AS26|18.80
AS27|0.19
ER01|100.00
ER02|94.00
ER06|25.85
FS13|94.00
MC01|100.00
MC02|65.80
MC03|21.15
MC03|21.15
MC03-A|9.40
MC04|35.25
MC09|25.00
MC10|37.60
MC12|65.80
MC17|28.20
US23|68.15
UC11|0.33
US05|0.31
US06|0.47
US11|18.80
US12|35.25
US26|23.50
US28|0.33
US28-A|0.12
`.trim().split("\n");

assert.equal(fixture.schemaVersion, 1);
assert.equal(fixture.sourcePageCount, 1);
assert.equal(fixture.sourceSha256, sourceHash, "Wallace fixture must match the source PDF bytes");
assert.equal(fixture.expectedCatalogRowCount, 59);
assert.equal(fixture.rows.length, 59, "Wallace catalog must contain all 59 valid coded rows");
const migrationRows = parseMigrationRows(migration);
assert.equal(migrationRows.length, fixture.expectedCatalogRowCount,
  "Wallace migration row count must match the verified fixture");
assert.deepEqual(
  migrationRows,
  fixture.rows,
  "Wallace migration rows must exactly match the SHA-bound fixture in source order",
);
assert.deepEqual(
  fixture.rows.map((row) => `${row.code}|${row.unitPrice}`),
  expectedCodePrices,
  "Wallace codes and prices must match the visually reviewed source order",
);

for (const [index, row] of fixture.rows.entries()) {
  assert.equal(row.sourceRow, index + 1, "source rows must be sequential and stable");
  assert.match(row.code, /^[A-Z0-9]+(?:-[A-Z])?$/u, `invalid code at source row ${row.sourceRow}`);
  assert.ok(row.description.trim().length > 0, `missing description at source row ${row.sourceRow}`);
  assert.match(row.unitPrice, /^\d+(?:\.\d{1,2})?$/u, `invalid decimal price at source row ${row.sourceRow}`);
  assert.ok(!row.unitPrice.startsWith("-"), `negative price at source row ${row.sourceRow}`);
  assert.doesNotMatch(row.description, /^ONE\s+"AS18"\s+PER\s+POLE$/iu);
}

const countsByCode = fixture.rows.reduce((counts, row) => {
  counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
  return counts;
}, new Map());
assert.equal(countsByCode.get("AS12"), 2);
assert.equal(countsByCode.get("AS18"), 9);
assert.equal(countsByCode.get("MC03"), 2);

const exactTriples = fixture.rows.map((row) => [
  row.code,
  row.description.trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " "),
  row.unitPrice,
].join("|"));
assert.equal(new Set(exactTriples).size, fixture.rows.length, "Wallace catalog contains an exact duplicate row");

assert.deepEqual(
  fixture.nonCatalogRows,
  [{
    positionAfterSourceRow: 22,
    code: null,
    description: "ONE \"AS18\" PER POLE",
    unitPrice: "0.00",
    classification: "instructional constraint, not a catalog item",
  }],
  "the uncoded AS18 instruction must remain documented outside catalog rows",
);

console.log("[wallace-pricing-static] PASS rows=59 repeated=AS12:2,AS18:9,MC03:2 exact_duplicates=0");
