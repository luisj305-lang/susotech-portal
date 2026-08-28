import type { Job, JobPartGroup } from "./types";

function byCreatedAt(a: Job, b: Job): number {
  return a.created_at.localeCompare(b.created_at);
}

/**
 * Labels a job within its part family. A root with children is "Parte 1";
 * a child is "Parte 2..N" ordered by `created_at`; a standalone root has no
 * label.
 */
export function partLabel(job: Job, children: Job[]): string | null {
  if (job.parent_job_id) {
    const index = children.findIndex((child) => child.id === job.id);
    return index >= 0 ? `Parte ${index + 2}` : null;
  }
  return children.length > 0 ? "Parte 1" : null;
}

function withLabel<T extends Job>(job: T, children: T[]): T {
  return { ...job, partLabel: partLabel(job, children) };
}

/**
 * Groups a flat job list into root-first families. Children are ordered by
 * `created_at` (the earliest child is "Parte 2"). Children whose root is not
 * present in the list (for example, filtered out by the active/archived view)
 * are preserved as standalone groups so they are never lost.
 */
export function groupJobParts<T extends Job>(jobs: T[]): JobPartGroup<T>[] {
  const roots: T[] = [];
  const rootIds = new Set<string>();
  const childrenByParent = new Map<string, T[]>();
  for (const job of jobs) {
    if (job.parent_job_id) {
      const list = childrenByParent.get(job.parent_job_id) ?? [];
      list.push(job);
      childrenByParent.set(job.parent_job_id, list);
    } else {
      roots.push(job);
      rootIds.add(job.id);
    }
  }

  const groups: JobPartGroup<T>[] = roots.map((root) => {
    const children = (childrenByParent.get(root.id) ?? []).sort(byCreatedAt);
    return {
      root: withLabel(root, children),
      children: children.map((child) => withLabel(child, children)),
    };
  });

  for (const job of jobs) {
    if (job.parent_job_id && !rootIds.has(job.parent_job_id)) {
      groups.push({ root: withLabel(job, []), children: [] });
    }
  }

  return groups;
}
