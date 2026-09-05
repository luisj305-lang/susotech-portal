// Offline fixtures for the administrator dashboard contract checks.
//
// These fixtures drive the REAL `src/lib` query/format modules against
// in-memory fake clients. They never touch the Supabase SDK, the network, or
// the environment. The fake query builder mirrors only the PostgREST subset
// that the dashboard query modules actually use (select/order/eq/is/in/not),
// so the real filtering, ordering, joining, and PDF-state logic is exercised
// against deterministic synthetic data.

export type FakeRow = Record<string, unknown>;

export type FakeResult = {
  data: FakeRow[] | null;
  error: { message: string } | null;
};

type RpcHandler = () => FakeResult;

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

export class FakeQuery {
  private rows: FakeRow[];
  private error: string | null;
  private ops: Array<(row: FakeRow) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];

  constructor(rows: FakeRow[], error: string | null = null) {
    this.rows = rows;
    this.error = error;
  }

  select(): this {
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  eq(column: string, value: unknown): this {
    this.ops.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown): this {
    this.ops.push((row) =>
      value === null ? row[column] === null : row[column] === value,
    );
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is") {
      this.ops.push((row) =>
        value === null
          ? row[column] !== null && row[column] !== undefined
          : row[column] !== value,
      );
    }
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.ops.push((row) => values.includes(row[column]));
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: FakeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<FakeResult> {
    if (this.error !== null) {
      return Promise.resolve({ data: null, error: { message: this.error } });
    }
    let result = this.rows.filter((row) => this.ops.every((op) => op(row)));
    for (const { column, ascending } of [...this.orders].reverse()) {
      result = result.sort(
        (a, b) => compareValues(a[column], b[column]) * (ascending ? 1 : -1),
      );
    }
    return Promise.resolve({ data: result, error: null });
  }
}

export type FakeSupabase = {
  from: (table: string) => FakeQuery;
  rpc: (name: string, params?: Record<string, unknown>) => Promise<FakeResult>;
};

export function makeFakeSupabase(config: {
  tables?: Record<string, FakeRow[]>;
  rpcs?: Record<string, RpcHandler>;
  errors?: Record<string, string>;
}): FakeSupabase {
  const tables = config.tables ?? {};
  const rpcs = config.rpcs ?? {};
  const errors = config.errors ?? {};
  return {
    from(table: string): FakeQuery {
      return new FakeQuery(tables[table] ?? [], errors[table] ?? null);
    },
    rpc(name: string): Promise<FakeResult> {
      const handler = rpcs[name];
      if (!handler) {
        return Promise.resolve({
          data: null,
          error: { message: `No handler for RPC ${name}` },
        });
      }
      return Promise.resolve(handler());
    },
  };
}

// ---------------------------------------------------------------------------
// Shared directories
// ---------------------------------------------------------------------------

export const activeTechnicians = Array.from({ length: 9 }, (_, i) => ({
  id: `tech-${i + 1}`,
  label: `Técnico ${i + 1}`,
}));

export const crews = [{ id: "crew-1", name: "Equipo A" }];

// ---------------------------------------------------------------------------
// S5 — Pending preview (listOfficeJobs + getDeliveredPdfStatus)
// ---------------------------------------------------------------------------

function updatedIso(minute: number): string {
  return new Date(
    Date.UTC(2026, 8, 4, 12, 0, 0) - minute * 60000,
  ).toISOString();
}

export type PdfState = "pending" | "current" | "stale";

export function buildPendingJobsConfig(count: number): {
  config: { tables: Record<string, FakeRow[]> };
  states: PdfState[];
} {
  const jobs: FakeRow[] = [];
  const photos: FakeRow[] = [];
  const documents: FakeRow[] = [];
  const drafts: FakeRow[] = [];
  const deliveryVersions: FakeRow[] = [];
  const assignments: FakeRow[] = [];

  // Distractors that must NOT surface in the en_revision preview.
  jobs.push({
    id: "archived-pending",
    main_status: "en_revision",
    archived_at: "2026-09-01T00:00:00.000Z",
    updated_at: updatedIso(500),
    prism_number: "P-ARCHIVED",
    title: "Archivado",
    address: "Calle Archivo 1",
    location: null,
    submitted_at: "2026-09-01T00:00:00.000Z",
    delivered_pdf_path: null,
  });
  jobs.push({
    id: "asignado-other",
    main_status: "asignado",
    archived_at: null,
    updated_at: updatedIso(400),
    prism_number: "P-ASIGNADO",
    title: "Asignado",
    address: "Calle Asignado 1",
    location: null,
    submitted_at: "2026-09-02T00:00:00.000Z",
    delivered_pdf_path: null,
  });

  const states: PdfState[] = ["pending", "current", "stale"];

  for (let i = 0; i < count; i++) {
    const id = `pending-${i}`;
    const state = states[i % states.length];
    const photoIds = Array.from(
      { length: i % 4 },
      (_, p) => `photo-${i}-${p}`,
    );
    const docId = `doc-${i}`;

    const job: FakeRow = {
      id,
      main_status: "en_revision",
      archived_at: null,
      updated_at: updatedIso(i),
      prism_number: `P-${1000 + i}`,
      title: `Trabajo ${i}`,
      address: `Calle ${i}`,
      location: null,
      submitted_at: updatedIso(i + 1),
    };

    if (state === "pending") {
      job.delivered_pdf_path = null;
    } else {
      job.delivered_pdf_path = `delivered/${id}.pdf`;
      job.delivered_pdf_source_photo_ids = photoIds;
      job.delivered_pdf_source_document_ids = [docId];
      if (state === "current") {
        drafts.push({ job_id: id, version: 3 });
        deliveryVersions.push({ job_id: id, draft_version: 3 });
      } else {
        drafts.push({ job_id: id, version: 2 });
        deliveryVersions.push({ job_id: id, draft_version: 1 });
      }
    }

    for (const pid of photoIds) {
      photos.push({ id: pid, job_id: id, deleted_at: null });
    }
    if (state !== "pending") {
      documents.push({
        id: docId,
        job_id: id,
        position: 0,
        status: "active",
        deleted_at: null,
      });
    }

    if (i === 1) {
      assignments.push({
        job_id: id,
        assignee_type: "technician",
        technician_id: "tech-2",
        crew_id: null,
        active: true,
        is_primary: true,
      });
    } else if (i === 2) {
      assignments.push({
        job_id: id,
        assignee_type: "crew",
        technician_id: null,
        crew_id: "crew-1",
        active: true,
        is_primary: true,
      });
    }

    jobs.push(job);
  }

  return {
    config: {
      tables: {
        jobs,
        job_photos: photos,
        job_documents: documents,
        job_pdf_drafts: drafts,
        job_pdf_delivery_versions: deliveryVersions,
        job_assignments: assignments,
        crews,
      },
    },
    states,
  };
}

// ---------------------------------------------------------------------------
// S6/S7 — Worker operations (getWorkerOperationsDashboard + invoiced total)
// ---------------------------------------------------------------------------

export function buildWorkersConfig(): {
  config: { rpcs: Record<string, RpcHandler> };
  expected: {
    count: number;
    allocatedCents: number[];
    invoicedCents: number;
    deliveredJobs: number;
  };
} {
  const operations: FakeRow[] = [];
  const financial: FakeRow[] = [];

  // Distinct allocated cents per worker; `null` means no financial row (→ 0).
  const allocated: Array<number | null> = [
    123450, 200000, 500, null, 999999, 1, null, 12345, null,
  ];

  for (let i = 0; i < 9; i++) {
    const active = i % 2 === 0;
    operations.push({
      technician_id: `tech-${i + 1}`,
      technician_name: `Técnico ${i + 1}`,
      crew_names: [],
      is_shift_active: active,
      shift_started_at: active
        ? `2026-09-04T${String(8 + (i % 3)).padStart(2, "0")}:00:00-04:00`
        : null,
      shift_active_until: active
        ? `2026-09-04T${String(16 + (i % 3)).padStart(2, "0")}:00:00-04:00`
        : null,
      weekly_production: 10 * (i + 1),
      weekly_production_amount: 1000 * (i + 1) + i,
      weekly_production_company_amount: 500 * (i + 1) + i,
      weekly_delivered_jobs: i + 1,
      weekly_fuel_amount: 50 * (i + 1),
      fuel_daily: [
        { date: "2026-09-04", amount: 50 * (i + 1), no_fuel: false },
      ],
      production_breakdown: [
        { code: `C${i + 1}`, unit: "foot", quantity: i + 1 },
      ],
      server_now: "2026-09-04T12:00:00.000Z",
      week_start_at: "2026-09-04T04:00:00.000Z",
      week_end_exclusive_at: "2026-09-11T04:00:00.000Z",
    });
  }

  for (let i = 0; i < 9; i++) {
    const cents = allocated[i];
    if (cents === null) continue;
    financial.push({
      participant_id: `tech-${i + 1}`,
      // tech-3 exercises the Number() coercion on the real join path.
      allocated_cents: i === 2 ? String(cents) : cents,
    });
  }

  const invoicedCents = 1234500;
  const deliveredJobs = 41;

  return {
    config: {
      rpcs: {
        get_worker_operations_dashboard: () => ({
          data: operations,
          error: null,
        }),
        get_worker_weekly_financial_dashboard: () => ({
          data: financial,
          error: null,
        }),
        get_weekly_invoiced_total: () => ({
          data: [{ invoiced_cents: invoicedCents, delivered_jobs: deliveredJobs }],
          error: null,
        }),
      },
    },
    expected: {
      count: 9,
      allocatedCents: allocated.map((cents) => cents ?? 0),
      invoicedCents,
      deliveredJobs,
    },
  };
}

// ---------------------------------------------------------------------------
// S8 — Unavailable content (empty results and request failures)
// ---------------------------------------------------------------------------

export function buildWorkersErrorConfig(): {
  config: { rpcs: Record<string, RpcHandler> };
} {
  return {
    config: {
      rpcs: {
        get_worker_operations_dashboard: () => ({
          data: null,
          error: { message: "boom" },
        }),
        get_worker_weekly_financial_dashboard: () => ({
          data: [],
          error: null,
        }),
      },
    },
  };
}

export function buildInvoicedErrorConfig(): {
  config: { rpcs: Record<string, RpcHandler> };
} {
  return {
    config: {
      rpcs: {
        get_weekly_invoiced_total: () => ({
          data: null,
          error: { message: "boom" },
        }),
      },
    },
  };
}

export function buildJobsErrorConfig(): {
  config: { tables: Record<string, FakeRow[]>; errors: Record<string, string> };
} {
  return {
    config: {
      tables: {
        jobs: [],
        job_photos: [],
        job_documents: [],
        job_pdf_drafts: [],
        job_pdf_delivery_versions: [],
        job_assignments: [],
        crews,
      },
      errors: { jobs: "boom" },
    },
  };
}

export function buildEmptyWorkersConfig(): {
  config: { rpcs: Record<string, RpcHandler> };
} {
  return {
    config: {
      rpcs: {
        get_worker_operations_dashboard: () => ({ data: [], error: null }),
        get_worker_weekly_financial_dashboard: () => ({ data: [], error: null }),
      },
    },
  };
}

export function buildEmptyInvoicedConfig(): {
  config: { rpcs: Record<string, RpcHandler> };
} {
  return {
    config: {
      rpcs: {
        get_weekly_invoiced_total: () => ({ data: [], error: null }),
      },
    },
  };
}
