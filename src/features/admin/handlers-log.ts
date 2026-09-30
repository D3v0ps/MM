// Hanterare: revisionsloggen (/admin/logg) och chefens månatliga loggkontroll (stickprov, SPEC §10).
// Källa: prototyp/src/views/admin.js (admin.logg, admin.logCheck). Loggen är append-only och innehåller id:n – aldrig namn
// eller personnummer på deltagare. Deltagare visas bara som ärendenummer; användare (personal och kommun) med namn.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery } from "@/api/server";
import { addMonths, fmtWeekKey, monthKey, monthName } from "@/core/time";
import { reportKindLabel } from "@/core/labels";
import { uniq } from "@/core/util";
import type { AuditLogEntry } from "@/data/schema";
import { actionLabel, detailText, entityLabel, ENTITY_LABEL, JOB_NAME, VIEW_ACTIONS, type AuditLookups } from "./audit-text";
import { adminAuditLog, adminLogCheck, type AuditRow, type LogCheckSampleItem } from "./api";
import { cap, isDemoCreated, isParticipantActor, mainContract, userNames } from "./shared";
import { templateLabel } from "./templates";

const NULL_ACTOR = "__null";
const PARTICIPANT = "Deltagare (engångslänk)";

/** Nyast först; vid samma tidpunkt den senast skrivna först. */
const sortLog = (log: AuditLogEntry[]) =>
  log.map((a, i) => [a, i] as const).sort((x, y) => (x[0].occurredAt < y[0].occurredAt ? 1 : x[0].occurredAt > y[0].occurredAt ? -1 : y[1] - x[1])).map((x) => x[0]);

/** Stickprov: högst fem poster från månaden, i första hand visningar och exporter, sedan jämnt fördelat över resten. */
export function pickSample(log: readonly AuditLogEntry[], month: string): AuditLogEntry[] {
  // Samma jämförelse som den gamla prototypen, så att samma poster väljs.
  const inMonth = log.filter((a) => String(a.occurredAt).startsWith(month)).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  const isView = (a: AuditLogEntry) => (VIEW_ACTIONS as readonly string[]).includes(a.action) || String(a.action).startsWith("export.");
  const views = inMonth.filter(isView);
  const rest = inMonth.filter((a) => !views.includes(a));
  const step = Math.max(1, Math.floor(rest.length / 5));
  return [...views, ...rest.filter((_, i) => i % step === 0)].slice(0, 5);
}

const caseIdOf = (a: AuditLogEntry): string | null =>
  ["case", "consent"].includes(a.entity) ? a.entityId : typeof a.details?.caseId === "string" ? (a.details.caseId as string) : null;

handleQuery(adminAuditLog, { roles: ["admin", "chef"] }, async (ctx) => {
  const main = await mainContract(ctx);
  const [log, cases, contracts, reports, checks] = await Promise.all([
    ctx.repo.table("audit_log").list(),
    ctx.repo.table("cases").list(),
    ctx.repo.table("contracts").list(),
    ctx.repo.table("reports").list(),
    ctx.repo.table("log_checks").list(),
  ]);
  const orgs = await ctx.repo.table("organizations").list();
  const name = await userNames(ctx);
  // ctx.system: finns id:t som användare? Bara namnet på användare visas (prototypens MM.personById).
  const profileIds = new Set((await ctx.system.table("profiles").list()).map((p) => p.id));
  const caseNo = new Map(cases.map((c) => [c.id, c.caseNumber]));
  const kpis = main.config.kpis ?? [];
  const lookups: AuditLookups = {
    userName: (id) => (profileIds.has(id) ? name(id) : null),
    caseNumber: (id) => caseNo.get(id) ?? null,
    kpiLabel: (key) => kpis.find((k) => k.key === key)?.label ?? null,
    templateLabel,
  };
  const actorName = (id: string | null) => (isParticipantActor(id) ? PARTICIPANT : name(id));

  const entityText = (a: AuditLogEntry): string => {
    const id = String(a.entityId ?? "");
    if (a.entity === "template") return templateLabel(id);
    if (a.entity === "job") return JOB_NAME[id] ?? id;
    if (a.entity === "contract") {
      const k = contracts.find((c) => c.id === id);
      return k ? (orgs.find((o) => o.id === k.customerId)?.name ?? id) : id;
    }
    if (a.entity === "org_config" && id === "notifications") return "Påminnelser och eskalering";
    if (["profile", "customer_user"].includes(a.entity) && profileIds.has(id)) return name(id);
    const m = id.match(/(\d{4}-\d{2})$/);
    if (["billing_run", "audit_log"].includes(a.entity) && m) return cap(monthName(m[1]));
    if (a.entity === "report") {
      const r = reports.find((x) => x.id === id);
      if (r) return `${reportKindLabel(r.kind)}${r.month ? ` ${monthName(r.month)}` : r.week ? ` ${fmtWeekKey(r.week)}` : ""}${r.version > 1 ? `, version ${r.version}` : ""}`;
      const k = id.match(/^([a-z_]+)-(\d{4}-\d{2})$/);
      if (k) return `${reportKindLabel(k[1])} ${monthName(k[2])}`;
      const w = id.match(/^weekly-W(\d{2})$/);
      if (w) return `Veckorapporter vecka ${Number(w[1])}`;
    }
    return id;
  };

  const rows: AuditRow[] = sortLog(log).map((a) => {
    const cid = caseIdOf(a);
    const number = cid ? (caseNo.get(cid) ?? "") : "";
    return {
      id: a.id, at: a.occurredAt, actorKey: isParticipantActor(a.actorId) ? NULL_ACTOR : String(a.actorId), actorName: actorName(a.actorId),
      action: a.action, actionLabel: actionLabel(a.action), entity: ENTITY_LABEL[a.entity] ?? a.entity, entityLabel: entityLabel(a.entity), entityId: a.entityId,
      caseId: number ? cid : null, caseNumber: number, entityText: entityText(a), detailText: detailText(a, lookups), byTester: isDemoCreated(a.id),
    };
  });
  const actors = uniq(rows.map((r) => r.actorKey)).map((k) => ({ value: k, label: k === NULL_ACTOR ? PARTICIPANT : name(k) })).sort((a, b) => a.label.localeCompare(b.label, "sv"));
  const actions = uniq(rows.map((r) => r.action)).map((x) => ({ value: x, label: actionLabel(x) })).sort((a, b) => a.label.localeCompare(b.label, "sv"));

  // Månatlig loggkontroll för förra månaden
  const month = addMonths(monthKey(ctx.now()), -1);
  const done = checks.filter((x) => x.month === month).slice(-1)[0] ?? null;
  const sample: LogCheckSampleItem[] = pickSample(log, month).map((a) => ({
    id: a.id, actionLabel: actionLabel(a.action), at: a.occurredAt, actorName: actorName(a.actorId), entityLabel: entityLabel(a.entity),
    caseNumber: (() => { const cid = caseIdOf(a); return cid ? (caseNo.get(cid) ?? "") : ""; })(),
  }));
  return {
    isChef: ctx.actor.role === "chef",
    contractId: main.id,
    rows,
    actors,
    actions,
    views: rows.filter((a) => (VIEW_ACTIONS as readonly string[]).includes(a.action)).length,
    exports: rows.filter((a) => a.action.startsWith("export.")).length,
    byTester: rows.filter((a) => a.byTester).length,
    logCheck: {
      month,
      canSign: ctx.actor.role === "chef",
      done: done
        ? { signedByName: name(done.signedBy), signedAt: done.signedAt, items: done.items.length, deviations: done.items.filter((x) => x.verdict === "avvikelse").length, note: done.note }
        : null,
      sample,
    },
  };
});

/** Månatlig loggkontroll (stickprov) av chef/controller, SPEC §10. */
handleCommand(adminLogCheck, { roles: ["chef"] }, async (ctx, p) => {
  const items = p.items.filter((x): x is { logId: string; verdict: "ok" | "avvikelse" } => !!x.logId && (x.verdict === "ok" || x.verdict === "avvikelse"));
  if (!items.length) return fail("empty", "Bedöm minst en post.");
  const note = String(p.note ?? "").trim();
  if (items.some((x) => x.verdict === "avvikelse") && !note) return fail("note", "Beskriv avvikelsen och vad som ska göras.");
  const id = ctx.newId("lc");
  await ctx.repo.table("log_checks").insert({ id, month: p.month, items, note, signedBy: ctx.actor.userId, signedAt: ctx.now() });
  await ctx.audit({
    action: "audit.log_check", entity: "audit_log", entityId: p.month, contractId: ctx.actor.contractIds[0] ?? null,
    details: { checked: items.length, deviations: items.filter((x) => x.verdict === "avvikelse").length },
  });
  return ok({ id });
});
