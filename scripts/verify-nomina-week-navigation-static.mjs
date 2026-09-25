import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const queries = read("src/lib/payroll/queries.ts");
const types = read("src/lib/payroll/types.ts");
const page = read("app/nomina/page.tsx");
const table = read("src/components/payroll/office-payroll-table.tsx");

assert.match(queries, /referenceAtForNewYorkWeek/u,
  "queries imports the New York week reference helper");
assert.match(queries, /getOfficeHourlyPayroll\(\s*weekOffset\s*=\s*0\s*,?\s*\)/u,
  "getOfficeHourlyPayroll accepts a defaulted weekOffset of zero");
assert.match(queries, /referenceAtForNewYorkWeek\(weekOffset\)[\s\S]*?currentNewYorkPayrollPeriod\(referenceAt\)/u,
  "the payroll period is computed from the requested week offset");
assert.match(queries, /isCurrentPeriod:\s*weekOffset\s*===\s*0/u,
  "the snapshot flags only the current period");
assert.match(types, /isCurrentPeriod:\s*boolean/u,
  "OfficeHourlyPayroll declares the isCurrentPeriod flag");
assert.match(page, /await searchParams/u,
  "the nomina page reads its search params");
assert.match(page, /Array\.isArray\(values\.week\)[\s\S]*?weekOffset/u,
  "the nomina page parses the week param into a numeric offset");
assert.match(page, /getOfficeHourlyPayroll\(weekOffset\)/u,
  "the nomina page passes the offset into the payroll query");
assert.match(table, /href=\{`\/nomina\?week=\$\{weekOffset - 1\}`\}/u,
  "the table renders a previous-week navigation link");
assert.match(table, /data\.isCurrentPeriod/u,
  "the table gates actions on the current-period flag");

console.log("[nomina-week-navigation-static] PASS week-offset-query=isCurrentPeriod-flag=week-param=read-only-gating");
