import type { PdfDraft, PdfPreview } from "@/lib/jobs/pdf-parser";

export type ImportState = "pending" | "processing" | "imported" | "duplicate" | "error";
export type ImportRow = {
  key: string;
  file: File;
  state: ImportState;
  selected: boolean;
  fields: PdfDraft;
  fileHash?: string;
  pageCount?: number;
  responsibleSuggestion?: string | null;
  assigneeType?: "technician";
  assigneeId?: string;
  message?: string;
  jobId?: string;
  itemId?: string;
  assignmentState?: "pending" | "assigned" | "error";
  localDuplicate?: boolean;
};

export type ImportOutcome = { status: "imported" | "duplicate" | "error"; message: string; jobId?: string };

export function emptyDraft(file: File): PdfDraft {
  return {
    title: file.name.replace(/\.pdf$/iu, "").trim().slice(0, 200),
    orderIdentifier: null,
    prismNumber: null,
    address: null,
    location: null,
    customerName: null,
    requestDate: null,
    jobType: null,
    description: null,
  };
}

export function createImportRows(files: File[]) {
  return files.map((file, index): ImportRow => ({
    key: `${file.name}-${file.size}-${file.lastModified}-${index}-${crypto.randomUUID()}`,
    file,
    state: "processing",
    selected: true,
    fields: emptyDraft(file),
  }));
}

export function selectUploadTargets(rows: ImportRow[], retryOnly: boolean) {
  return rows.filter((row) => retryOnly ? row.state === "error" : row.state === "pending" || row.state === "error");
}

export function applyImportOutcome(rows: ImportRow[], key: string, outcome: ImportOutcome) {
  return rows.map((row): ImportRow => row.key === key ? {
    ...row,
    state: outcome.status,
    message: outcome.message,
    jobId: outcome.jobId,
  } : row);
}

export function applyPdfPreview(rows: ImportRow[], key: string, preview: PdfPreview) {
  const updated = rows.map((row) => row.key === key ? { ...row, ...preview, state: "pending" as const, fields: preview.fields } : row);
  const seen = new Set<string>();
  return updated.map((row): ImportRow => {
    if (!row.fileHash) return row;
    const identity = `${row.fileHash}:${row.file.size}`;
    if (seen.has(identity) && !row.jobId) return { ...row, state: "duplicate", selected: false, localDuplicate: true, message: "Duplicado dentro de este lote." };
    seen.add(identity); return row;
  });
}

export function filterImportRows(rows: ImportRow[], query: string, state: ImportState | "all") {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (state !== "all" && row.state !== state) return false;
    if (!needle) return true;
    return [row.file.name, row.fields.title, row.fields.orderIdentifier, row.fields.address, row.fields.location]
      .some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

export function importProgress(rows: ImportRow[]) {
  const complete = rows.filter((row) => row.state === "imported" || row.state === "duplicate" || row.state === "error").length;
  return { complete, total: rows.length, percent: rows.length ? Math.round((complete / rows.length) * 100) : 0 };
}

export function pageRows(rows: ImportRow[], page: number, pageSize = 50) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pages };
}

export function groupAssignmentChunks(rows: Array<Pick<ImportRow, "key" | "state" | "jobId" | "assigneeType" | "assigneeId" | "assignmentState">>) {
  const grouped = new Map<string, { assigneeType: "technician"; assigneeId: string; jobIds: string[]; rowKeys: string[] }>();
  for (const row of rows) {
    if (row.state !== "imported" || !row.jobId || !row.assigneeType || !row.assigneeId || row.assignmentState === "assigned") continue;
    const key = `${row.assigneeType}:${row.assigneeId}`;
    const group = grouped.get(key) ?? { assigneeType: row.assigneeType, assigneeId: row.assigneeId, jobIds: [], rowKeys: [] };
    group.jobIds.push(row.jobId); group.rowKeys.push(row.key); grouped.set(key, group);
  }
  return [...grouped.values()].flatMap((group) => group.jobIds.map((_, offset) => offset % 100 === 0 ? {
    ...group, jobIds: group.jobIds.slice(offset, offset + 100), rowKeys: group.rowKeys.slice(offset, offset + 100),
  } : null).filter((value): value is typeof group => value !== null));
}
