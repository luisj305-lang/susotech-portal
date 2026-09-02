import assert from "node:assert/strict";
import { geocodeAddressCensusCore } from "../src/lib/maps/census-geocoder-core.ts";

let request;
const resolved = await geocodeAddressCensusCore("4600 Silver Hill Rd, Washington, DC 20233", async (url, init) => {
  request = { url, init };
  return new Response(JSON.stringify({
    result: {
      addressMatches: [
        {
          coordinates: { x: -76.928365658124, y: 38.845053106269 },
          matchedAddress: "4600 SILVER HILL RD, WASHINGTON, DC, 20233",
        },
      ],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
});

assert.deepEqual(resolved, {
  ok: true,
  latitude: 38.845053106269,
  longitude: -76.928365658124,
  matchedAddress: "4600 SILVER HILL RD, WASHINGTON, DC, 20233",
});
const url = new URL(request.url);
assert.equal(url.origin, "https://geocoding.geo.census.gov");
assert.equal(url.pathname, "/geocoder/locations/onelineaddress");
assert.equal(url.searchParams.get("benchmark"), "Public_AR_Current");
assert.equal(url.searchParams.get("format"), "json");
assert.match(url.searchParams.get("address"), /4600 Silver Hill Rd/u);
assert.equal(request.init.headers["User-Agent"], "susotech-portal/1.0");

// No matches -> not_found
assert.deepEqual(
  await geocodeAddressCensusCore("addr", async () => new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 })),
  { ok: false, reason: "not_found" },
);

// Non-finite coordinates -> not_found
assert.deepEqual(
  await geocodeAddressCensusCore("addr", async () => new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: "bad", y: "bad" } }] } }), { status: 200 })),
  { ok: false, reason: "not_found" },
);

// Out-of-range coordinates -> not_found
assert.deepEqual(
  await geocodeAddressCensusCore("addr", async () => new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: 0, y: 999 } }] } }), { status: 200 })),
  { ok: false, reason: "not_found" },
);

// Server error -> request_failed
assert.deepEqual(
  await geocodeAddressCensusCore("addr", async () => new Response("{}", { status: 500 })),
  { ok: false, reason: "request_failed" },
);

// Abort -> timeout
assert.deepEqual(
  await geocodeAddressCensusCore("addr", async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }),
  { ok: false, reason: "timeout" },
);

// Empty address -> request_failed without fetching
assert.deepEqual(
  await geocodeAddressCensusCore("", async () => { throw new Error("should not fetch"); }),
  { ok: false, reason: "request_failed" },
);

console.log("[job-census-geocoding-core] PASS");
