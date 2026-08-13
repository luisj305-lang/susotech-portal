# Diseño: Módulo de Trabajos

## Technical Approach

Usar Server Components por defecto para paneles de oficina y Client Components solo en los límites de interacción del técnico. Las transiciones de estado y operaciones sensibles se ejecutan exclusivamente en server actions con validación de rol. El estado principal y la incidencia se modelan como columnas separadas en `jobs` para preservar el progreso normal. Las fotos y PDF se almacenan en buckets privados de Supabase Storage con RLS.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| Estado principal e incidencia separados | Un solo enum combinado | Permite bloquear un trabajo (`incident`) sin perder su estado real (`main_status`). |
| `job_assignments` con `assignee_type` | Tablas separadas para técnico y crew | Reduce duplicación y permite evolucionar a múltiples asignaciones. |
| Crew con `lead_technician_id` | Sin líder explícito | El roadmap y el negocio requieren un responsable principal por crew. |
| Historial explícito `job_status_history` | Solo auditoría por triggers | Facilita consultas de timeline y debugging sin depender de logs. |
| Vista técnico mobile-first | Desktop-first responsive | El campo es el caso de uso crítico; botones grandes y carga rápida primero. |
| Storage privado para evidencias | Tablas con bytes | Archivos pesados no van en Postgres; Storage con RLS es más escalable. |
| Server actions metadata-only para writes | API routes o uploads multipart | Protegen autorización y confirmación sin transportar bytes PDF ni depender del límite de 1 MB. |
| Gestión de crews mediante mutaciones pequeñas | Formulario que reemplaza toda la membresía o un segundo dominio de equipos | Reutiliza `crews`/`crew_members`; cada alta, edición, activación o cambio de miembro tiene una única frontera transaccional y un resultado claro. |
| Directorio técnico mínimo mediante RPC | Relajar RLS de `profiles` o consultar con `service_role` | La RLS aplicada permite SELECT global solo a admin. Un RPC `security definer` conserva admin+supervisor y expone únicamente UUID y etiqueta calculada de técnicos activos. |

## Data Model

```sql
-- Enums
create type public.job_status as enum (
  'asignado',
  'en_progreso',
  'enviado_revision',
  'aprobado',
  'listo_pagar',
  'pagado'
);

create type public.incident_type as enum (
  'need_splicing',
  'no_access',
  'need_cr',
  'permit_pending',
  'returned',
  'incomplete'
);

create type public.assignee_type as enum ('technician', 'crew');

create type public.job_category as enum ('categoria_1', 'categoria_2', 'categoria_3');

-- Trabajos
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  prism_number text,
  njuns_number text,
  title text not null,
  address text,
  location text,
  job_type text,
  description text,
  special_instructions text,
  required_material text,
  category public.job_category not null default 'categoria_1',
  main_status public.job_status not null default 'asignado',
  incident public.incident_type,
  incident_notes text,
  comments text,
  estimated_total numeric,
  project_map_url text,
  project_pdf_url text,
  assignment_date timestamptz,
  deadline_date timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Crews
create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lead_technician_id uuid not null references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Miembros de crew
create table public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  technician_id uuid not null references public.profiles(id),
  primary key (crew_id, technician_id)
);

-- Asignaciones
create table public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  assignee_type public.assignee_type not null,
  technician_id uuid references public.profiles(id),
  crew_id uuid references public.crews(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  is_primary boolean not null default true,
  active boolean not null default true,
  constraint valid_assignee check (
    (assignee_type = 'technician' and technician_id is not null and crew_id is null) or
    (assignee_type = 'crew' and crew_id is not null and technician_id is null)
  )
);

-- Historial de estados
create table public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  previous_status public.job_status,
  new_status public.job_status,
  previous_incident public.incident_type,
  new_incident public.incident_type,
  changed_by uuid not null references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

-- Códigos de producción
create table public.job_production_codes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  code text not null,
  quantity numeric not null default 1,
  notes text,
  added_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Fotos / evidencias
create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  storage_path text not null,
  photo_type text not null check (photo_type in ('before', 'after', 'evidence')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
```

## State Machine

Estados principales permitidos:

```
asignado → en_progreso → enviado_revision → aprobado → listo_pagar → pagado
```

Transiciones válidas:

| From | To | Who |
|---|---|---|
| asignado | en_progreso | técnico asignado |
| en_progreso | enviado_revision | técnico asignado |
| enviado_revision | aprobado | admin/supervisor |
| enviado_revision | en_progreso | admin/supervisor (devolver) |
| aprobado | listo_pagar | admin/supervisor |
| listo_pagar | pagado | admin/supervisor |
| any | same + incident | técnico (solo incident) |
| any | same - incident | técnico/admin/supervisor (resolver) |

Las incidencias no cambian `main_status`, solo `incident`.

## Bulk PDF Import

La oficina puede importar lotes de hasta 100 trabajos desde una única selección. El navegador calcula SHA-256 y extrae texto con PDFium WebAssembly cargado bajo demanda; el documento real usa una estructura que PDF.js rechaza y PDFium interpreta de forma coherente con Chrome. Los bytes MUST NOT enviarse mediante Server Actions porque Next.js 16 limita sus cuerpos a 1 MB y serializa esas llamadas. Una Server Action metadata-only prepara/reutiliza un item persistente y genera la URL firmada; el navegador carga directamente al bucket privado; otra Server Action metadata-only verifica el objeto y confirma idempotentemente el trabajo.

Cada PDF genera una fila editable con estos valores:

- `title`: nombre del archivo PDF sin extensión (usado para búsqueda por nombre de PDF).
- `prism_number` o identificador real: solamente si una etiqueta explícita lo contiene.
- `address`, `location`, `request_date`, `job_type`, `description` y `customer_name`: solamente cuando el documento contiene la etiqueta o valor.
- responsable detectado: sugerencia de UI, nunca asignación automática.
- `project_pdf_url`: ruta en el bucket `project-files`.
- `category`: `categoria_1` (editable posteriormente).
- `main_status`: `asignado`.

Flujo:

```
/trabajos/importar
  → seleccionar/arrastrar múltiples PDFs
  → analizar con concurrencia 2 y editar la previsualización
  → aplicar técnico/crew por fila o a seleccionados
  → Server Action prepara batch/item y URL firmada (solo metadatos)
  → navegador carga bytes a Storage con concurrencia 3
  → Server Action confirma el objeto y RPC crea/reutiliza jobs + auditoría
  → agrupar trabajos nuevos por responsable y llamar assign_jobs_atomic en bloques ≤100
  → mostrar importado, duplicado o error por fila
  → reintentar solo errores
```

La asignación en bloque actualiza `job_assignments` para cada trabajo seleccionado y registra el cambio en `job_status_history`. La asignación individual también está disponible desde `/trabajos/[id]`.

La búsqueda en el listado de oficina se hace por `title`, que coincide con el nombre del archivo PDF importado.

Una migración correctiva nueva añade `source_file_size` a `job_imports` y crea `job_import_batches`/`job_import_items` para reanudar por lote, hash y tamaño sin modificar migraciones aplicadas. `job_imports` mantiene una relación uno a uno con `jobs`, nombre fuente, SHA-256, tamaño, identificador de orden, actor y fecha. Un índice único hash+tamaño y el identificador normalizado convierten carreras concurrentes en `duplicado`. Las RPC usan `auth.uid()` e `is_office_staff()`; el navegador nunca recibe `service_role`.

## Data Flow

```
Oficina (admin/supervisor)
  → /equipos → crews/crew_members + list_active_technicians_for_office()
             → listar/crear/editar/desactivar crews y administrar miembros
  → /trabajos/nuevo → server action createJob → jobs + job_assignments
  → /trabajos/importar → prepareBulkProjectUpload(metadata) → navegador → project-files
                        → confirmBulkProjectUpload(metadata) → job_import_items + jobs/job_imports
                        → assignJobsInBulk(ids agrupados ≤100)
  → /trabajos → lista con filtros
  → /trabajos/[id] → asignar/reasignar, aprobar, pagar

Técnico
  → /trabajos → tarjetas de trabajos asignados (individual o crew)
  → /trabajos/[id] → ver detalle, iniciar, reportar incidente, subir foto, añadir código, enviar a revisión
```

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/20260810001000_jobs_module.sql` | Create | Tablas, enums, triggers, RLS. |
| `src/lib/jobs/types.ts` | Create | Tipos `Job`, `Crew`, `JobAssignment`, enums. |
| `src/lib/jobs/actions.ts` | Create | Server actions para CRUD, transiciones, códigos, fotos. |
| `src/lib/jobs/state.ts` | Create | Máquina de estados y validación de transiciones. |
| `src/lib/storage/actions.ts` | Create | Server actions para subida/bajada de archivos a Storage. |
| `supabase/migrations/20260810005000_jobs_bulk_import_resume.sql` | Create | Batch/items reanudables, tamaño auditado e idempotencia correctiva. |
| `supabase/migrations/20260810003000_jobs_crew_directory.sql` | Create | RPC de directorio mínimo para admin/supervisor sin relajar RLS de perfiles. |
| `app/trabajos/page.tsx` | Create | Listado adaptativo por rol. |
| `app/trabajos/[id]/page.tsx` | Create | Detalle del trabajo. |
| `app/trabajos/nuevo/page.tsx` | Create | Formulario de creación (admin/supervisor). |
| `app/trabajos/importar/page.tsx` | Create | Importación masiva de PDFs y asignación en bloque. |
| `app/trabajos/page.tsx` | Modify | Acceso visible a Equipos para oficina. |
| `app/equipos/page.tsx` | Create | Server Component protegido que carga crews y técnicos elegibles. |
| `app/equipos/loading.tsx` | Create | Estado de carga administrativo. |
| `app/equipos/error.tsx` | Create | Error recuperable sin afirmar que hubo una mutación. |
| `src/components/jobs/job-list.tsx` | Create | Lista de tarjetas para técnico. |
| `src/components/jobs/job-form.tsx` | Create | Formulario de creación/edición para oficina. |
| `src/components/jobs/bulk-import.tsx` | Create | Drag-and-drop/selector múltiple de PDFs, preview y confirmación. |
| `src/components/jobs/bulk-assign.tsx` | Create | Selección de trabajos importados y asignación a técnico/crew. |
| `src/components/jobs/technician-actions.tsx` | Create | Botones grandes de estado, incidente, envío. |
| `src/components/jobs/timeline.tsx` | Create | Historial de estados. |
| `src/components/jobs/crew-manager.tsx` | Create | Límite cliente para formularios, confirmación y feedback por operación. |
| `src/components/dashboard-client.tsx` | Modify | Acceso visible a Equipos para admin/supervisor. |
| `src/lib/jobs/queries.ts` | Modify | Combina crews/miembros autorizados con el RPC de directorio; los selectores siguen leyendo solo crews activos. |
| `src/lib/jobs/actions.ts` | Modify | Acciones validadas de creación, edición, estado y membresía. |
| `src/lib/jobs/types.ts` | Modify | DTO serializable de crew con responsable y miembros. |
| `src/lib/auth/session.ts` | Modify | Añadir `requireSupervisor()` helper. |

## Interfaces / Contracts

```typescript
// src/lib/jobs/types.ts
export type JobStatus =
  | "asignado"
  | "en_progreso"
  | "enviado_revision"
  | "aprobado"
  | "listo_pagar"
  | "pagado";

export type IncidentType =
  | "need_splicing"
  | "no_access"
  | "need_cr"
  | "permit_pending"
  | "returned"
  | "incomplete";

export type AssigneeType = "technician" | "crew";

export type JobCategory = "categoria_1" | "categoria_2" | "categoria_3";

export interface Job {
  id: string;
  prism_number: string | null;
  njuns_number: string | null;
  title: string;
  address: string | null;
  location: string | null;
  job_type: string | null;
  description: string | null;
  special_instructions: string | null;
  required_material: string | null;
  category: JobCategory;
  main_status: JobStatus;
  incident: IncidentType | null;
  incident_notes: string | null;
  comments: string | null;
  estimated_total: number | null;
  project_map_url: string | null;
  project_pdf_url: string | null;
  assignment_date: string | null;
  deadline_date: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}
```

El contrato SQL adicional será `list_active_technicians_for_office() returns table (id uuid, label text)`: exige `is_office_staff(auth.uid())`, filtra `role = 'tecnico' and is_active`, calcula una etiqueta de `full_name` con fallback a email y no retorna email ni otros campos por separado. Será `security definer set search_path = ''`, con `revoke all ... from public` y `grant execute ... to authenticated`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `canTransition(status, incident, newStatus, newIncident)` | Script de Node con casos válidos/inválidos. |
| Integration | Crear job, asignar, transicionar, RLS por rol | Scripts con service role y perfiles de prueba. |
| Integration | Crear/editar/desactivar crew; añadir/quitar miembro; rechazar técnico inactivo/no técnico y retiro del responsable | Harness runtime con clientes autenticados admin, supervisor y técnico; cleanup explícito. |
| RPC/RLS | Directorio técnico mínimo por rol y forma de respuesta | RED/runtime: admin y supervisor reciben solo técnicos activos con `id,label`; técnico, inactivo y anónimo son rechazados; ninguna columna adicional aparece. |
| Route/UI | Guard, acceso visible, lista, estado vacío/error y crews activos en selectores | Harness estático/runtime y prueba con teclado de `/equipos`. |
| E2E | Flujo oficina crea → técnico inicia → envía → supervisor aprueba → pagado | Verificación manual en navegador. |

## Threat Matrix

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | Ejecutables con nombre documental | N/A: no clasifica ni ejecuta archivos | Ninguna frontera de ejecución | Ninguna |
| Git repository selection | Rutas relativas/absolutas, `git -C` | N/A: no invoca Git | Ninguna selección de repositorio | Ninguna |
| Commit state | Staged, `commit -a`, índice vacío | N/A: no crea commits | Ninguna semántica de índice | Ninguna |
| Push state | Tracking, primer push, refspec | N/A: no hace push | Ninguna resolución remota | Ninguna |
| PR commands | `--head`, entorno, comandos compuestos | N/A: no crea PR | Ninguna composición de comandos | Ninguna |
| Web route authorization | URL directa, rol técnico, perfil inactivo, anónimo | Applicable | Seguro: `requireSupervisor()` autoriza admin/supervisor activos antes de consultar. Fallo: redirección/denegación sin datos ni mutación. | Navegar directamente por cada identidad y forzar cada Server Action con rol técnico. |

## Migration / Rollout

1. Crear migración SQL y aplicarla en Supabase.
2. Crear buckets de Storage `project-files` y `job-evidence` con RLS.
3. Desplegar código.
4. Verificar flujos por rol.

### Incremento de administración de crews

Requiere la migración correctiva nueva `20260810003000_jobs_crew_directory.sql`; no se modifica ninguna migración aplicada. La política general de `profiles` permanece intacta: el RPC solo entrega `id,label` a oficina activa y no utiliza ni expone `service_role`. Se aplica primero la migración, se ejecutan sus pruebas negativas/positivas y luego se despliega la ruta. Rollback: revocar y eliminar únicamente la función nueva; la UI debe tratar su ausencia/error como fallo de carga sin mutar crews.

`app/equipos/page.tsx` será Server Component y ejecutará `requireSupervisor()` antes de `listCrewsForOffice()`. La consulta leerá IDs autorizados de `crews`/`crew_members`, obtendrá el directorio limitado por RPC y compondrá el DTO sin depender del SELECT global de perfiles. Pasará datos serializables a `CrewManager`; únicamente este componente será cliente para selección, diálogos y estados pending/success/error. Dashboard y `/trabajos` mostrarán el enlace a quienes ya cumplen `canCreateJobs`.

Las acciones `createCrew`, `updateCrew`, `setCrewActive`, `addCrewMember` y `removeCrewMember` ejecutarán `requireSupervisor()`, validarán UUID, nombre acotado y elegibilidad, y devolverán el `Result` usado por jobs. `removeCrewMember` rechazará al responsable actual. Cada acción hará una sola mutación lógica: crear/actualizar crew incluye el trigger de membresía en la misma transacción PostgreSQL; añadir, retirar o desactivar es una sentencia atómica. No habrá reemplazo masivo de membresías ni estado optimista agregado: un fallo revierte esa sentencia, conserva las anteriores y refresca `/equipos` para mostrar el estado real. Desactivar conserva membresía e historial, pero las consultas existentes `.eq("is_active", true)` lo eliminan inmediatamente de los selectores de detalle e importación. Las acciones revalidarán `/equipos`, `/trabajos` y `/trabajos/importar` según corresponda.

Riesgo principal: una función `security definer` demasiado amplia eludiría la RLS endurecida. Se mitiga con columnas de retorno fijas, filtro interno de rol/estado, autorización previa a la consulta, `search_path` vacío y pruebas que inspeccionan tanto filas como claves retornadas.

## Open Questions

- [ ] ¿El mapa del proyecto será una imagen estática, un enlace a Google Maps, o un visor interactivo?
- [ ] ¿Los códigos de producción tienen un catálogo fijo o son libres?
- [x] ¿Se requiere importación masiva de trabajos en esta fase?
  - **Respuesta:** sí, importación masiva desde múltiples PDFs. Cada PDF crea un trabajo draft con título = nombre de archivo, categoría por defecto `categoria_1`, y PDF adjunto en Storage. Luego se asignan a técnico/crew individual o en bloque.
- [x] ¿Las 3 categorías son etiquetas fijas o personalizables?
  - **Respuesta:** etiquetas fijas: `categoria_1`, `categoria_2`, `categoria_3`. Se modelan como enum `public.job_category` y columna `jobs.category`.
