import assert from "node:assert/strict";
import {
  isFieldWorker,
  isOperationalFieldWorker,
  isReadOnlyHelper,
  isWorkerSpecialty,
  WORKER_SPECIALTIES,
  WORKER_SPECIALTY_LABELS,
} from "../src/lib/auth/capabilities.ts";

assert.deepEqual(WORKER_SPECIALTIES, [
  "tecnico",
  "splicer",
  "liner",
  "ayudante",
]);
assert.equal(WORKER_SPECIALTY_LABELS.ayudante, "Ayudante");

for (const specialty of WORKER_SPECIALTIES) {
  assert.equal(isWorkerSpecialty(specialty), true);
}
assert.equal(isWorkerSpecialty("helper"), false);
assert.equal(isWorkerSpecialty(null), false);

assert.equal(isFieldWorker({ role: "tecnico" }), true);
assert.equal(isFieldWorker({ role: "supervisor" }), false);
assert.equal(
  isOperationalFieldWorker({ role: "tecnico", worker_specialty: "splicer" }),
  true,
);
assert.equal(
  isOperationalFieldWorker({ role: "tecnico", worker_specialty: "ayudante" }),
  false,
);
assert.equal(
  isOperationalFieldWorker({ role: "tecnico", worker_specialty: null }),
  false,
);
assert.equal(
  isReadOnlyHelper({ role: "tecnico", worker_specialty: "ayudante" }),
  true,
);
assert.equal(
  isReadOnlyHelper({ role: "admin", worker_specialty: "ayudante" }),
  false,
);

console.log("PASS auth capability helper checks");
