import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/usuarios/page.tsx", "utf8");
const manager = readFileSync("src/components/users-manager.tsx", "utf8");
const session = readFileSync("src/lib/auth/session.ts", "utf8");
const actions = readFileSync("src/lib/users/actions.ts", "utf8");

assert.match(page, /requireSupervisor\(\)/);
assert.match(page, /worker_specialty: WorkerSpecialty \| null/);
assert.match(session, /worker_specialty: WorkerSpecialty \| null/);
assert.match(session, /technician_type, worker_specialty, price_category_id/);

assert.match(manager, />Especialidad</);
assert.match(manager, /user\.role === "tecnico"/);
assert.match(manager, /canManage \?/);
assert.match(manager, /WORKER_SPECIALTIES\.map/);
assert.match(manager, /WORKER_SPECIALTY_LABELS\[user\.worker_specialty\]/);
assert.match(manager, /updateWorkerSpecialty/);

assert.match(actions, /export async function updateWorkerSpecialty/);
assert.match(actions, /await requireAdmin\(\)/);
assert.match(actions, /isWorkerSpecialty\(input\.workerSpecialty\)/);
assert.match(actions, /const supabase = await createClient\(\)/);
assert.match(actions, /rpc\("set_worker_specialty"/);
assert.match(actions, /p_profile_id: input\.userId/);
assert.match(actions, /p_worker_specialty: input\.workerSpecialty/);
assert.match(actions, /revalidatePath\("\/usuarios"\)/);

console.log("PASS worker specialty UI and action static checks");
