import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { referenceAtForNewYorkWeek } from "../src/lib/time/new-york-week.ts";

const dashboardSql = readFileSync(
  new URL("../supabase/migrations/20260820010000_worker_production_money.sql", import.meta.url),
  "utf8",
);

assert.match(dashboardSql, /start_date := local_date - \(\(extract\(dow from local_date\)::integer \+ 2\) % 7\)/u);
assert.match(dashboardSql, /starts_at := start_date::timestamp at time zone 'America\/New_York'/u);
assert.match(dashboardSql, /ends_at := \(start_date \+ 7\)::timestamp at time zone 'America\/New_York'/u);

for (const fuelJoin of ["fuel", "fuel_daily"]) {
  const endMarker = `) ${fuelJoin} on true`;
  const end = dashboardSql.indexOf(endMarker);
  const start = dashboardSql.lastIndexOf("left join lateral (", end);
  const body = dashboardSql.slice(start, end + endMarker.length);

  assert.match(body, /s\.started_at >= starts_at/u, `${fuelJoin} must include Friday midnight`);
  assert.match(body, /s\.started_at < ends_at/u, `${fuelJoin} must exclude the following Friday midnight`);
}

assert.equal(
  referenceAtForNewYorkWeek(1, new Date("2026-10-30T04:30:00.000Z")),
  "2026-11-06T12:00:00.000Z",
  "fall DST must not move a Friday reference back into Thursday",
);

assert.equal(
  referenceAtForNewYorkWeek(-1, new Date("2026-03-13T04:30:00.000Z")),
  "2026-03-06T12:00:00.000Z",
  "spring DST must preserve New York civil-date navigation",
);

assert.equal(
  referenceAtForNewYorkWeek(0, new Date("2026-08-14T04:00:00.000Z")),
  "2026-08-14T12:00:00.000Z",
  "Friday midnight in New York stays inside the Friday-starting week",
);

console.log("PASS New York weekly references remain stable across DST");
