// Hanterare som bara finns i prototypen. Importeras av src/demo/main.tsx – aldrig av src/api/handlers.ts,
// så de registreras inte i riktiga appen.
import { handleQuery } from "@/api/server";
import { ROLES } from "@/api/roles";
import { demoRefs, type DemoRefs } from "./api";

handleQuery(demoRefs, { roles: ROLES }, async (ctx): Promise<DemoRefs> => {
  // ctx.system (utan behörighetsfilter): taggarna är metadata om testdatat och scenarierna ska kunna slå upp
  // "Nadias ärende" oavsett vilken roll prototypen visas som. Svaret innehåller bara id:n.
  const tags = await ctx.system.table("demo_tags").list({ entity: "cases" });
  const cases: Record<string, string> = {};
  for (const t of tags) if (t.entityIds[0]) cases[t.tag] = t.entityIds[0];
  const caseIds = [...new Set(Object.values(cases))];
  if (caseIds.length === 0) return { cases, aiDraftCheckIns: {}, reports: [] };

  const [checkIns, reports] = await Promise.all([
    ctx.system.table("check_ins").list({ caseId: { in: caseIds } }),
    ctx.system.table("reports").list({ caseId: { in: caseIds } }),
  ]);
  const aiDraftCheckIns: Record<string, string> = {};
  for (const ci of checkIns) if (ci.ai && !aiDraftCheckIns[ci.caseId]) aiDraftCheckIns[ci.caseId] = ci.id;
  return {
    cases,
    aiDraftCheckIns,
    reports: reports.filter((r) => r.caseId).map((r) => ({ id: r.id, caseId: r.caseId as string, kind: r.kind, month: r.month })),
  };
});
