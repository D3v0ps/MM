// Tar fram facit för rapportmodellerna (src/features/rapporter/model.test.ts) ur den GAMLA prototypen:
// prototyp/src/00–03 och views/rapporter.js laddas i Node med en fejkad window, och MM.reports.modelFor anropas för
// varje rapport. Modellerna normaliseras till den nya kodens fältnamn (number -> caseNumber).
// Hela modellen sparas för ett urval rapporter, och en kontrollsumma (SHA-256 av JSON med sorterade nycklar) för alla.
//
// Kör: node src/features/rapporter/parity/generate-facit.mjs   (skriver src/features/rapporter/parity/facit.json)
// Beslut 2026-10-01 (rapporter steg 2): appen räknar tydlig/någon progression bara på de obligatoriska områdena. Prototypen
// räknade alla bedömda områden – facit blir ändå detsamma eftersom testdatat inte har några bedömda valfria områden
// (kontrolleras i src/core/parity.test.ts). Får testdatat valfria områden måste facit räknas om enligt beslutet.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const protoSrc = path.resolve(here, "../../../../prototyp/src");

function loadProto() {
  const noop = () => {};
  const g = { console, setTimeout: () => 0, clearTimeout: noop, localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop } };
  g.window = g;
  g.htmPreact = { html: noop, h: noop, render: noop, useState: () => [0, noop], useEffect: noop, useMemo: (f) => f(), useRef: () => ({}), useCallback: (f) => f, useReducer: noop, useLayoutEffect: noop, useErrorBoundary: noop, createContext: noop, useContext: noop };
  vm.createContext(g);
  for (const f of ["00-core.js", "01-seed.js", "02-store.js", "03-domain.js"]) vm.runInContext(fs.readFileSync(path.join(protoSrc, f), "utf8"), g, { filename: f });
  g.MM.ui = { Icon: noop };
  vm.runInContext(fs.readFileSync(path.join(protoSrc, "views/rapporter.js"), "utf8"), g, { filename: "views/rapporter.js" });
  g.MM.initState();
  return g.MM;
}

const MM = loadProto();
const st = MM.store.state;
const d = MM.d;
const R = MM.reports;

/** Den nya kodens fältnamn: number -> caseNumber (rekursivt). */
const norm = (v) => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k === "number" ? "caseNumber" : k, norm(x)]));
  return v;
};
const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v === undefined ? null : v);
};
const hash = (v) => crypto.createHash("sha256").update(canon(v)).digest("hex").slice(0, 16);

const weekEnd = `${d.addDays(d.monday(d.today()), 6)}T23:59`;
const isDelivered = (r) => r.status === "delivered" || r.status === "opened";
const dueThisWeek = (r) => !isDelivered(r) && !r.superseded && !!r.dueAt && r.dueAt >= d.now() && r.dueAt <= weekEnd;

const sc = st.script;
const f = (p) => (st.reports.find(p) || {}).id;
const SAMPLE = {
  nadiaJan: f((r) => r.caseId === sc.nadia && r.kind === "monthly" && r.month === "2027-01"),
  nadiaDec: f((r) => r.caseId === sc.nadia && r.kind === "monthly" && r.month === "2026-12"),
  approvedJan: f((r) => r.kind === "monthly" && r.month === "2027-01" && r.status === "approved"),
  protJan: f((r) => r.kind === "monthly" && r.caseId === sc.skyddad && r.month === "2027-01"),
  protDel: f((r) => r.kind === "monthly" && r.caseId === sc.skyddad && isDelivered(r)),
  csJan: f((r) => r.kind === "customer_summary" && r.month === "2027-01"),
  csDec: f((r) => r.kind === "customer_summary" && r.month === "2026-12"),
  csOct: f((r) => r.kind === "customer_summary" && r.month === "2026-10"),
  weeklyWait: f((r) => r.kind === "weekly_attendance" && r.status === "waiting"),
  weeklyMariaW03: f((r) => r.kind === "weekly_attendance" && r.recipientUserId === "k-maria" && r.week === "2027-W03"),
  weeklyLindaW47: f((r) => r.kind === "weekly_attendance" && r.recipientUserId === "k-linda" && r.week === "2026-W47"),
  finDel: f((r) => r.kind === "final" && isDelivered(r) && !r.finalText && MM.sel.caseById(r.caseId).referrerId === "k-maria"),
  finDraft: f((r) => r.kind === "final" && r.status === "draft"),
  finOverdue: f((r) => r.kind === "final" && !isDelivered(r) && r.dueAt && r.dueAt < d.now()),
  orderNadia: f((r) => r.kind === "order_confirmation" && r.caseId === sc.nadia),
  orderDraft: f((r) => r.kind === "order_confirmation" && !isDelivered(r)),
  orderClosed: f((r) => r.kind === "order_confirmation" && r.caseId === "case-260007"),
};

const reports = {};
for (const r of st.reports) {
  const m = R.modelFor(r);
  const next = R.nextStep(r);
  reports[r.id] = {
    model: hash(norm(m)),
    title: R.reportTitle(r),
    period: R.periodText(r),
    eff: R.effStatus(r),
    statusLabel: R.statusLabel(r),
    next: `${next.key}:${next.label}`,
    overdue: R.isOverdue(r),
    week: dueThisWeek(r),
  };
}
const models = Object.fromEntries(Object.entries(SAMPLE).filter(([, id]) => id).map(([k, id]) => [k, { id, model: norm(JSON.parse(JSON.stringify(R.modelFor(st.reports.find((x) => x.id === id))))) }]));

const facit = { meta: { now: d.now(), count: st.reports.length }, sample: models, reports };
const out = path.join(here, "facit.json");
fs.writeFileSync(out, JSON.stringify(facit) + "\n");
console.log(`Skrev ${out} (${Math.round(fs.statSync(out).size / 1024)} kB)`, SAMPLE);
