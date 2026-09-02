import assert from "node:assert/strict";
import { computeOptimizedRouteLatLngCore } from "../src/lib/maps/google-maps-core.ts";

const origin = { latitude: 40.7128, longitude: -74.006 };
const destination = { latitude: 40.7128, longitude: -74.006 };
const intermediates = [
  { latitude: 40.7306, longitude: -73.9352 },
  { latitude: 40.758, longitude: -73.9855 },
];

let request;
const resolved = await computeOptimizedRouteLatLngCore(origin, destination, intermediates, "test-key", async (url, init) => {
  request = { url, init };
  return new Response(JSON.stringify({
    routes: [
      {
        optimizedIntermediateWaypointIndex: [1, 0],
        distanceMeters: 12345,
        duration: "900s",
      },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
});

assert.deepEqual(resolved, {
  optimizedIntermediateWaypointIndex: [1, 0],
  distanceMeters: 12345,
  duration: "900s",
});

assert.equal(request.url, "https://routes.googleapis.com/directions/v2:computeRoutes");
assert.equal(request.init.headers["X-Goog-Api-Key"], "test-key");
assert.equal(
  request.init.headers["X-Goog-FieldMask"],
  "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration",
);

const body = JSON.parse(request.init.body);
assert.deepEqual(body.origin, { location: { latLng: { latitude: 40.7128, longitude: -74.006 } } });
assert.deepEqual(body.destination, { location: { latLng: { latitude: 40.7128, longitude: -74.006 } } });
assert.deepEqual(
  body.intermediates,
  intermediates.map((waypoint) => ({ location: { latLng: waypoint } })),
);
assert.equal(body.travelMode, "DRIVE");
assert.equal(body.optimizeWaypointOrder, true);

// Invalid origin latitude -> null without fetching.
assert.equal(
  await computeOptimizedRouteLatLngCore({ latitude: 999, longitude: 0 }, destination, intermediates, "test-key", async () => { throw new Error("should not fetch"); }),
  null,
);

// Empty intermediates -> null without fetching.
assert.equal(
  await computeOptimizedRouteLatLngCore(origin, destination, [], "test-key", async () => { throw new Error("should not fetch"); }),
  null,
);

// Missing api key -> null without fetching.
assert.equal(
  await computeOptimizedRouteLatLngCore(origin, destination, intermediates, "", async () => { throw new Error("should not fetch"); }),
  null,
);

// Server error -> null.
assert.equal(
  await computeOptimizedRouteLatLngCore(origin, destination, intermediates, "test-key", async () => new Response("{}", { status: 500 })),
  null,
);

// Invalid index length -> null.
assert.equal(
  await computeOptimizedRouteLatLngCore(origin, destination, intermediates, "test-key", async () => new Response(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: [0, 1, 2], distanceMeters: 123, duration: "60s" }] }), { status: 200 })),
  null,
);

// Out-of-range index -> null.
assert.equal(
  await computeOptimizedRouteLatLngCore(origin, destination, intermediates, "test-key", async () => new Response(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: [0, 5], distanceMeters: 123, duration: "60s" }] }), { status: 200 })),
  null,
);

console.log("[technician-route-core] PASS");
