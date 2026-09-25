import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const list = read("../../../app/postulantes/page.tsx");
const detail = read("../../../app/postulantes/[id]/page.tsx");
const download = read("../../../app/postulantes/[id]/cv/route.ts");

test("office pages authorize before accessing recruitment records", () => {
  for (const [source, query] of [[list, "await listRecruitmentApplications"], [detail, "await getRecruitmentApplication"], [download, "await getRecruitmentResumeUrl"]]) {
    assert.ok(source.indexOf("await requireOfficeViewer()") > 0);
    assert.ok(source.indexOf("await requireOfficeViewer()") < source.indexOf(query));
  }
});

test("pagination retains the selected status and filters reset to page one", () => {
  assert.match(list, /params\.set\("status", status\)/);
  assert.match(list, /href=\{pageHref\(1, entry\)\}/);
  assert.match(list, /pageHref\(result\.page - 1, status\)/);
  assert.match(list, /pageHref\(result\.page \+ 1, status\)/);
});

test("private follow-up form submits the version for concurrent edit protection", () => {
  assert.match(detail, /action=\{updateRecruitmentApplication\}/);
  assert.match(detail, /name="updated_at" value=\{application\.updated_at\}/);
  assert.match(detail, /name="internal_notes"[^>]*maxLength=\{10000\}/);
  assert.match(detail, /conflict:/);
});

test("resume URLs are issued on demand and never cached", () => {
  assert.doesNotMatch(detail, /getRecruitmentResumeUrl/);
  assert.match(detail, /href=\{`\/postulantes\/\$\{application\.id\}\/cv`\}/);
  assert.match(download, /"Cache-Control": "private, no-store"/);
  assert.match(download, /"Referrer-Policy": "no-referrer"/);
});

test("list has a real empty state and directs applicants to the public website", () => {
  assert.match(list, /result\.applications\.length/);
  assert.match(list, /No hay solicitudes/);
  assert.match(list, /https:\/\/susotech\.org\/empleo/);
});

test("Postulantes navigation is shared by office roles, outside admin-only entries", () => {
  const sidebar = read("../dashboard/sidebar.tsx");
  const entry = sidebar.indexOf('href: "/postulantes", label: "Postulantes"');
  const restrictedEntries = sidebar.indexOf('...(role === "admin"');
  assert.ok(entry > 0 && entry < restrictedEntries);
  assert.match(sidebar, /pathname\.startsWith\("\/postulantes\/"\)/);
});

test("legacy applications are read-only and contain only original form fields", () => {
  const legacy = read("../../../app/postulantes/anteriores/page.tsx");
  assert.ok(legacy.indexOf("await requireOfficeViewer()") < legacy.indexOf("await listLegacyRecruitmentApplications"));
  assert.match(legacy, /Solo lectura/);
  assert.match(legacy, /application\.experience/);
  assert.match(legacy, /application\.message/);
  assert.match(legacy, /application\.created_at/);
  assert.doesNotMatch(legacy, /<form|updateRecruitmentApplication|application\.(status|consent|city|has_license|internal_notes)/);
  assert.match(list, /href="\/postulantes\/anteriores"/);
  assert.match(legacy, /result\.page - 1/);
  assert.match(legacy, /result\.page \+ 1/);
});
