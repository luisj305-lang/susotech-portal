import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getJobMapUrl } from '../src/lib/jobs/maps.ts';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const billing = read('supabase/migrations/202608110200_production_billing.sql');
const archival = read('supabase/migrations/202608110100_job_archival.sql');
const queries = read('src/lib/jobs/queries.ts');
const actions = read('src/lib/jobs/actions.ts');
const editor = read('src/components/jobs/pdf-code-editor.tsx');
const dashboard = read('src/components/dashboard-client.tsx');
const operations = read('src/components/worker-operations-table.tsx');
const archiveUi = read('src/components/jobs/office-job-actions.tsx');
const archiveHistory = read('src/components/jobs/archive-history.tsx');
const jobPage = read('app/trabajos/[id]/page.tsx');
const operationsSql = read('supabase/migrations/20260813031000_worker_operations_archive_and_evidence.sql');

assert.equal(getJobMapUrl({ address: '6238 Sleepy Hollow Dr', location: 'Miami, FL' }), 'https://www.google.com/maps/search/?api=1&query=6238%20Sleepy%20Hollow%20Dr%2C%20Miami%2C%20FL');
assert.equal(getJobMapUrl({ address: 'A', location: null, projectMapUrl: ' https://maps.example/job ' }), 'https://maps.example/job');
assert.equal(getJobMapUrl({ address: null, location: null }), null);
assert.match(queries, /\.is\("archived_at", null\)/);
assert.match(archival, /public\.is_admin\(\)/);
assert.match(archival, /j\.archived_at is null/);
assert.match(actions, /rpc\("set_job_archived_v2"/);
assert.match(actions, /rpc\("add_job_production"/);
assert.match(billing, /technician_type in \('in_house', 'contractor'\)/);
assert.match(billing, /America\/New_York/);
assert.match(billing, /revoke insert, update, delete on public\.job_production_codes/);
assert.match(editor, /Cantidad/u);
assert.match(editor, /arrowTipX/u);
assert.match(dashboard, /WorkerOperationsTable/u);
assert.match(operations, /Operación semanal/u);
assert.match(operations, /"Producción"/u);
assert.match(operationsSql, /America\/New_York/u);
assert.match(operationsSql, /week_end_exclusive_at/u);
assert.match(operationsSql, /follow-up contract migration removes access/u);
assert.match(archiveUi, /Trabajo duplicado/u);
assert.match(archiveUi, /Cancelado por el cliente o la oficina/u);
assert.match(operationsSql, /list_job_archive_events_for_office/u);
assert.match(queries, /rpc\("list_job_archive_events_for_office"/u);
assert.match(archiveHistory, /Historial de archivado/u);
assert.match(jobPage, /<ArchiveHistory events=\{archiveEvents\}/u);

const rows = [...billing.matchAll(/\('([A-Z0-9-]+)','[^\n]+','(fixed|foot|hour|event)',([0-9.]+),([0-9.]+)\)/g)];
assert.ok(rows.length >= 59, `expected at least 59 catalog activities, got ${rows.length}`);
for (const [, code, , inHouse, contractor] of rows) {
  assert.ok(Number(contractor) >= Number(inHouse), `${code}: contractor must be >= in-house`);
}
assert.ok(rows.some((row) => row[1] === 'AS18'));
assert.ok(!rows.some((row) => row[1] === 'US40-A' || row[1] === 'PS01'), 'incomplete codes must not be activated without descriptions and paired rates');

console.log(`PASS maps/archive/production static (${rows.length} catalog activities)`);
