// The delivered-PDF runtime owns the complete delivery fixture and validates
// allocation backfill, replacement, idempotency, rejection/voiding, reporting,
// immutable production counts, and helper exclusion in one transactionally
// coherent flow. Reuse it here instead of maintaining a second drifting fixture.
await import("./verify-delivered-pdf-runtime.mjs");

console.log("PASS financial allocation backfill runtime (authoritative delivery fixture)");
