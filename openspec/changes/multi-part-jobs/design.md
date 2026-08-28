# Design: Multi-Part Jobs

## Technical Approach

Each additional part is a child `jobs` row linked via a nullable `jobs.parent_job_id` (self-FK, `ON DELETE RESTRICT`). The root is "Parte 1" AND the grouping umbrella; there is no separate non-billable parent row — every `jobs` row is exactly one billable part. Children are flat one-level siblings; cycles are structurally impossible once "only roots can be parents" is enforced. A child clones `customer_name`, `address`, `prism_number`, `title`, `category` from its root at creation so it is self-contained (a technician assigned to a part reads everything off their own row; no parent-read inheritance). The server RPC `create_job_part` clones those fields into a `sin_asignar` child in one transaction, mirroring `assign_jobs_atomic`'s `set_config('app.job_assignment_mutation')` token. Lists group children under their root; totals/reports already count each `jobs` row once (no umbrella row), so aggregation needs verification, not rewrite.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Parent model | Nullable self-FK; root = part 1, flat children | Reuses the whole `job_id`-scoped machine (assignment/delivery/reparto/invoice/archive/RLS/storage); no parallel table. |
| Shared fields | Children copy client/address/PRISM/title/category at creation | Resolves technician visibility without parent-read RLS; RLS stays strictly per-job. |
| Hierarchy guards | DB: self-parent CHECK + "only roots can be parents" trigger + FK `ON DELETE RESTRICT` | Flat one-level + no cycles by construction; delete-root-with-children blocked. |
| `job_stages` | Leave dormant (out of scope) | Orphaned billing-only table; never wired to UI. |

## Data Flow

```
Office staff ──▶ create_job_part(root_id)
    │ is_office_staff? root exists? not archived? root is root?
    ▼
  set_config('app.job_assignment_mutation', actor)
    ▼
  INSERT jobs(id, parent_job_id, title, prism_number, address,
              customer_name, category, main_status='sin_asignar')
    ▼
  commit ──▶ deferred enforce_job_assignment_status_on_jobs passes
             (sin_asignar + 0 active assignments)
```

## Migration

New `supabase/migrations/20260828000000_job_parts.sql`:

```sql
alter table public.jobs add column if not exists parent_job_id uuid;
alter table public.jobs add constraint jobs_parent_job_id_fkey
  foreign key (parent_job_id) references public.jobs(id) on delete restrict;
create index if not exists jobs_parent_job_id_idx on public.jobs (parent_job_id);
alter table public.jobs add constraint jobs_no_self_parent_check
  check (parent_job_id is null or parent_job_id <> id);

create or replace function public.validate_job_parent_hierarchy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_job_id is not null then
    if not exists (select 1 from public.jobs p
        where p.id = new.parent_job_id and p.parent_job_id is null) then
      raise exception 'Only a root job can be a parent';
    end if;
    if tg_op = 'UPDATE' and exists (
        select 1 from public.jobs c where c.parent_job_id = new.id) then
      raise exception 'A job with parts cannot become a part';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_job_parent_hierarchy_before_write
  before insert or update of parent_job_id on public.jobs
  for each row execute function public.validate_job_parent_hierarchy();
```

The `job_status` enum keeps legacy labels (`en_progreso`, `enviado_revision`, `listo_pagar`) — Postgres cannot drop enum values; the effective `validate_job_update` machine (`sin_asignar → asignado → en_revision → aprobado → facturado → pagado`) is untouched.

## RPC

```sql
create or replace function public.create_job_part(p_parent_job_id uuid)
returns table(new_job_id uuid)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); parent public.jobs%rowtype; child uuid := gen_random_uuid();
begin
  if not public.is_office_staff(actor) then raise exception 'Only active office staff can add job parts'; end if;
  select * into parent from public.jobs where id = p_parent_job_id for update;
  if parent.id is null then raise exception 'Job unavailable'; end if;
  if parent.archived_at is not null then raise exception 'Archived jobs cannot gain parts'; end if;
  if parent.parent_job_id is not null then raise exception 'Only the root job can gain parts'; end if;
  perform set_config('app.job_assignment_mutation', actor::text, true);
  insert into public.jobs (id, parent_job_id, title, prism_number, address,
      customer_name, category, main_status)
  values (child, parent.id, parent.title, parent.prism_number, parent.address,
      parent.customer_name, parent.category, 'sin_asignar'::public.job_status);
  return query select child;
end;
$$;
revoke all on function public.create_job_part(uuid) from public;
grant execute on function public.create_job_part(uuid) to authenticated;
```

Error paths: non-office → rejected; unknown / archived / child parent → rejected; concurrent delete → FK error mapped to a generic message in the action. The `set_config` token is defensive — the INSERT path performs no assignment transition, and the deferred trigger passes trivially for `sin_asignar`.

## Interfaces / Types

`Job` gains `parent_job_id: string | null` (DB column) and optional derived `partLabel: string | null` (root-with-children → "Parte 1"; children → "Parte 2..N" by `created_at`; standalone root → null). New `groupJobParts(jobs)` in `src/lib/jobs/parts.ts` returns root-first, labeled groups for both office and technician lists. Server action `createJobPart({ jobId }): Promise<Result<{ id: string }>>` calls the RPC then `revalidatePath("/trabajos")`.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/20260828000000_job_parts.sql` | Create | column + FK + indexes + guards + `create_job_part` |
| `src/lib/jobs/parts.ts` | Create | `groupJobParts` + `partLabel` computation |
| `src/lib/jobs/types.ts` | Modify | `Job.parent_job_id`; `partLabel`; `JobPartGroup` |
| `src/lib/jobs/actions.ts` | Modify | `createJobPart` server action |
| `src/lib/jobs/queries.ts` | Modify | group children in `listOfficeJobs`/`listTechnicianJobs`; `getOfficeJob` returns sibling parts |
| `src/components/jobs/part-actions.tsx` | Create | "Agregar otra parte" button + parts list |
| `app/trabajos/[id]/page.tsx` | Modify | part context + button (office, non-archived, root only) |
| `app/trabajos/page.tsx` | Modify | grouped card rendering |
| `src/components/jobs/job-list.tsx` | Modify | grouped cards + "Parte N" chip |

## RLS / Security

Children are ordinary `jobs` rows, so existing per-job `can_access_job`/`can_mutate_job` and the `is_office_staff` policies apply unchanged. Because a child copies client/address/PRISM/title/category, a technician assigned to a part sees all shared fields on their own row — no parent-read inheritance and no RLS change. The RPC is `security definer` + office-staff gate.

## Testing Strategy

No test runner (config: lint + build only).

| Layer | What | Approach |
|---|---|---|
| DB | hierarchy guards, clone, dedup | SQL assertions on a scratch environment |
| Build | types/lint | `npm run lint` && `npm run build` |

Verify: root + two children each `pagado` → `get_weekly_invoiced_total` returns 3 (`count(distinct d.job_id)` already counts each part once); `get_production_report` / `get_financial_allocation_report` join per-delivery, so each part appears once.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Additive nullable column; no data migration (existing rows stay `parent_job_id IS NULL`). Rollback: drop trigger, constraint, index, FK, column, and RPC; UI reverts to flat list. Rows created as parts revert to standalone roots (still valid jobs).

## Open Questions

- [x] Should `parent_job_id` be immutable after insert? **Resolved: yes** — enforced by the hierarchy trigger (`new.parent_job_id is distinct from old.parent_job_id`, task 1.3).
- [x] Clone `location`/`job_type` too? **Resolved: yes** — 7 fields cloned (task 1.4); the delta spec is reconciled to 7 fields at archive.
