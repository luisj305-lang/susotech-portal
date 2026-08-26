import assert from "node:assert/strict";
import { computeOptimizedRoundTripCore, geocodeAddressCore } from "../src/lib/maps/google-maps-core.ts";
import { normalizeRouteJobIds, orderRouteRows } from "../src/lib/jobs/route-planning-core.ts";
import { splitPostalCode } from "../src/lib/jobs/pdf-parser.ts";

assert.deepEqual(splitPostalCode("Orlando, FL 32826"), { location: "Orlando, FL", postalCode: "32826" });
assert.deepEqual(splitPostalCode("Miami, FL 33101-1234"), { location: "Miami, FL", postalCode: "33101-1234" });

let geocodeRequest;
const geocoded = await geocodeAddressCore("1600 Amphitheatre Pkwy, Mountain View, CA 94043", "server-key", async (url, init) => {
  geocodeRequest = { url, init };
  return new Response(JSON.stringify({ results: [{ placeId: "place-1" }] }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.deepEqual(geocoded, { ok: true, placeId: "place-1" });
assert.match(geocodeRequest.url, /^https:\/\/geocode\.googleapis\.com\/v4\/geocode\/address\//u);
assert.match(geocodeRequest.url, /regionCode=us/u);
assert.equal(geocodeRequest.init.headers["X-Goog-FieldMask"], "results.placeId");
assert.equal(geocodeRequest.init.headers["X-Goog-Api-Key"], "server-key");

for (const [results, reason] of [[[], "not_found"], [[{ placeId: "a" }, { placeId: "b" }], "ambiguous"]]) {
  const value = await geocodeAddressCore("address", "key", async () => new Response(JSON.stringify({ results }), { status: 200 }));
  assert.deepEqual(value, { ok: false, reason });
}
assert.deepEqual(await geocodeAddressCore("address", "key", async () => new Response("{}", { status: 500 })), { ok: false, reason: "request_failed" });

let routeRequest;
const route = await computeOptimizedRoundTripCore("origin-place", ["job-a", "job-b"], "server-key", async (url, init) => {
  routeRequest = { url, init };
  return new Response(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: [1, 0], distanceMeters: 3218, duration: "900s" }] }), { status: 200 });
});
assert.equal(routeRequest.url, "https://routes.googleapis.com/directions/v2:computeRoutes");
assert.equal(routeRequest.init.headers["X-Goog-FieldMask"], "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration");
const body = JSON.parse(routeRequest.init.body);
assert.deepEqual(body.origin, body.destination);
assert.equal(body.optimizeWaypointOrder, true);
assert.equal(body.travelMode, "DRIVE");
assert.deepEqual(route.optimizedIntermediateWaypointIndex, [1, 0]);
assert.deepEqual(orderRouteRows(["A", "B"], route.optimizedIntermediateWaypointIndex), ["B", "A"]);

const uuids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
assert.deepEqual(normalizeRouteJobIds(uuids), uuids);
assert.equal(normalizeRouteJobIds([...uuids, uuids[0]]), null);
assert.equal(normalizeRouteJobIds(Array.from({ length: 26 }, (_, index) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`)), null);
assert.equal(orderRouteRows(["A", "B"], [0, 0]), null);
console.log("[job-geocoding-core] PASS");
