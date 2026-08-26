import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, supervisorMigration, connect, callback, actions, google, page, dashboard, card, sidebar] = await Promise.all([
  read("supabase/migrations/20260823010000_google_calendar_reminders.sql"),
  read("supabase/migrations/20260823011000_supervisor_calendar_reminders_readonly.sql"),
  read("app/api/google-calendar/connect/route.ts"),
  read("app/api/google-calendar/callback/route.ts"),
  read("src/lib/calendar/actions.ts"),
  read("src/lib/calendar/google.ts"),
  read("app/calendario/page.tsx"),
  read("app/dashboard/page.tsx"),
  read("src/components/calendar/reminders-card.tsx"),
  read("src/components/dashboard/sidebar.tsx"),
]);

assert.match(migration, /enable row level security/g);
assert.match(migration, /role = 'admin' and p\.is_active/g);
assert.match(migration, /unique \(created_by, idempotency_key\)/);
assert.match(supervisorMigration, /on public\.calendar_reminders\s+for select\s+to authenticated/s);
assert.match(supervisorMigration, /p\.role = 'supervisor'/);
assert.match(supervisorMigration, /p\.is_active/);
assert.doesNotMatch(supervisorMigration, /google_calendar_connections/);
assert.doesNotMatch(supervisorMigration, /for (?:insert|update|delete|all)/i);
assert.match(connect, /await requireAdmin\(\)/);
assert.match(connect, /access_type: "offline"/);
assert.match(connect, /calendar\.events/);
assert.match(callback, /await requireAdmin\(\)/);
assert.match(callback, /google_calendar_oauth_state/);
assert.match(callback, /encryptToken\(token\.refresh_token\)/);
assert.doesNotMatch(callback, /refresh_token:\s*token\.refresh_token/);
assert.match(actions, /await requireAdmin\(\)/g);
assert.match(actions, /idempotency_key/);
assert.match(google, /aes-256-gcm/);
assert.match(google, /response\.status === 409/);
assert.match(page, /La integración aún no está configurada/);
assert.match(page, /await requireSupervisor\(\)/);
assert.match(page, /isAdmin && configuration\?\.configured \? await getCalendarConnection/);
assert.match(page, /readOnly=\{!isAdmin\}/);
assert.match(page, /isAdmin && \(data \?\? \[\]\)\.length/);
assert.match(page, />Calendario<\/h1>/);
assert.doesNotMatch(page, /pagos/i);
assert.match(dashboard, /profile\.role === "admin" \|\| profile\.role === "supervisor"/);
assert.match(dashboard, /profile\.role === "admin" && googleCalendarConfiguration\(\)\.configured/);
assert.match(card, /!compact && !readOnly/);
assert.match(card, /Solo lectura/);
assert.doesNotMatch(card, /Recordatorios de pagos/);
assert.match(sidebar, /href: "\/calendario", label: "Calendario"/);

console.log("Google Calendar static verification passed.");
