import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const allowed = new Set([
  "src/lib/jobs/work-list.ts", "src/lib/time/new-york-week.ts", "src/lib/jobs/parts.ts",
  "src/lib/jobs/maps.ts", "src/lib/jobs/work-types.ts", "src/lib/manual-jobs/queries.ts",
  "src/components/jobs/manual-work-card.tsx", "src/components/jobs/job-list.tsx",
  "src/components/dashboard-client.tsx", "src/components/dashboard/pending-review.tsx",
  "src/components/dashboard/admin-dashboard.tsx", "app/dashboard/page.tsx", "app/trabajos/page.tsx",
]);

export function workListLoader(stubs = {}, globals = {}) {
  const cache = new Map();
  function load(relative) {
    assert.ok(allowed.has(relative), `Offline work-list loader blocks ${relative}`);
    if (cache.has(relative)) return cache.get(relative);
    const exports = {};
    cache.set(relative, exports);
    const source = readFileSync(path.join(root, relative), "utf8");
    const javascript = ts.transpileModule(source, {
      fileName: relative,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(javascript, {
      exports, URLSearchParams, ...globals,
      require(name) {
        if (Object.hasOwn(stubs, name)) return stubs[name];
        if (name === "react/jsx-runtime") return require(name);
        if (name === "server-only") return {};
        if (name === "next/link") return { __esModule: true, default: "Link" };
        assert.ok(name.startsWith("@/") || name.startsWith("."), `No network/framework imports: ${name}`);
        const target = name.startsWith("@/") ? `src/${name.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(relative), name));
        const resolved = [target, `${target}.ts`, `${target}.tsx`].find((candidate) => allowed.has(candidate));
        assert.ok(resolved, `Unstubbed application import: ${name}`);
        return load(resolved);
      },
    }, { filename: relative });
    return exports;
  }
  return load;
}

const components = (names) => Object.fromEntries(names.split(" ").map((name) => [name, name]));
export const workListUiStubs = {
  "@/components/ui/button": { buttonClasses: () => "" },
  "@/components/ui/filter-chip": components("FilterChip"),
  "@/components/ui/status-badge": components("StatusBadge"),
  "@/components/ui/empty-state": components("EmptyState"),
  "@/components/ui/icons": components("IconInbox IconCamera"),
  "@/components/ui/card": components("Card CardHeader CardTitle CardContent"),
  "@/components/logout-button": components("LogoutButton"),
  "@/components/worker-operations-table": components("WorkerOperationsTable"),
  "@/components/work-shifts/hourly-shift-panel": components("HourlyShiftPanel"),
  "@/lib/auth/capabilities": { WORKER_SPECIALTY_LABELS: { ayudante: "Ayudante" } },
};

export function workListNodes(node) {
  if (Array.isArray(node)) return node.flatMap(workListNodes);
  if (!node?.props) return [];
  if (typeof node.type === "function") return workListNodes(node.type(node.props));
  return [node, ...workListNodes(node.props.children)];
}

export function workListText(node) {
  if (Array.isArray(node)) return node.map(workListText).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (!node.props) return String(node);
  return workListText(typeof node.type === "function" ? node.type(node.props) : node.props.children);
}
