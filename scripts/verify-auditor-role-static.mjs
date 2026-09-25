import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const capabilities = read("src/lib/auth/capabilities.ts");
const session = read("src/lib/auth/session.ts");
const state = read("src/lib/jobs/state.ts");
const actions = read("src/lib/users/actions.ts");
const manager = read("src/components/users-manager.tsx");
const profile = read("src/lib/dashboard/profile.ts");
const usersPage = read("app/usuarios/page.tsx");

// 1. Role enumeration.
assert.match(capabilities, /export const USER_ROLES = \["admin", "supervisor", "tecnico", "auditor"\] as const;/u);
assert.match(profile, /auditor: "Auditor"/u);
assert.match(manager, /auditor: "Auditor"/u);

// 2. requireOfficeViewer allows admin/supervisor/auditor; redirects otherwise.
assert.match(session, /export async function requireOfficeViewer\(\)/u);
assert.match(session, /profile\.role !== "admin" && profile\.role !== "supervisor" && profile\.role !== "auditor"/u);
assert.match(session, /redirect\("\/acceso-denegado"\)/u);

// 3. requireSupervisor stays admin OR supervisor (auditor is denied by
//    requireRole("supervisor")).
assert.match(session, /profile\.role === "admin" \? profile : requireRole\("supervisor"\)/u);
assert.doesNotMatch(session, /requireRole\("supervisor", "auditor"\)/u);

// 4. Read/write role boundaries: OFFICE_ROLES (write) excludes auditor;
//    OFFICE_VIEWER_ROLES (read) includes it.
assert.match(state, /const OFFICE_ROLES: UserRole\[\] = \["admin", "supervisor"\];/u);
assert.match(state, /export const OFFICE_VIEWER_ROLES: UserRole\[\] = \["admin", "supervisor", "auditor"\];/u);
assert.match(state, /export function isOfficeViewerRole\(role: UserRole\): boolean/u);

// 5. User role validation accepts 'auditor' and still rejects junk via the
//    allowedRoles whitelist.
assert.match(actions, /const allowedRoles: UserRole\[\] = \["admin", "supervisor", "tecnico", "auditor"\];/u);
assert.match(actions, /if \(!allowedRoles\.includes\(role as UserRole\)\)/u);

// 6. UsersManager renders an "Auditor" role option, and its mutation controls
//    remain gated by the canManage flag (admin-only from the page).
assert.match(manager, /Object\.entries\(roleLabels\)\.map/);
assert.match(manager, /\{canManage \? <select/u);
assert.match(usersPage, /canManage=\{currentProfile\.role === "admin"\}/u);

console.log("PASS auditor role static checks");
