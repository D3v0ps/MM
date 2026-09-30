// Hanterare: underbiträden, integrationer och bakgrundsjobb (/admin/integrationer).
// Källa: prototyp/src/views/admin.js (admin.integrationer, jobRows, admin.runJob). Integrationerna och jobben är simulerade
// i prototypen; manuella körningar sparas i tabellen jobs (payload.manual = true) och loggas i revisionsloggen.
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import { handleCommand, handleQuery } from "@/api/server";
import { unregistered } from "@/core/attendance";
import { coaches } from "@/core/cases";
import { isUnset, slaRule } from "@/core/config";
import { domainEnv } from "@/core/env";
import { pct, plural } from "@/core/format";
import { resultRate } from "@/core/kpi";
import { progressionWatch } from "@/core/progression";
import { addDays, dayOf, fmtDateTime, fmtWeekKey, isoWeek, monday } from "@/core/time";
import { JOB_NAME, type JobKey } from "./audit-text";
import { adminIntegrations, adminRunJob, type JobRow, type JobStatusView } from "./api";
import { mainContract, orgRow } from "./shared";

/** Botkyrkas besked om underbiträden och inspelning (SPEC §3.1). */
const APPROVED_ON = "2026-09-29";

handleQuery(adminIntegrations, { roles: ["admin"] }, async (ctx) => {
  const main = await mainContract(ctx);
  const { settings } = await orgRow(ctx, main.supplierId);
  const env = domainEnv(main, settings, ctx.now());
  const today = dayOf(env.now);
  // ctx.system: bakgrundsjobbens status räknas över hela avtalet (som ett schemalagt jobb med service role).
  // Bara antal och tidpunkter lämnas ut – inga ärenden, namn eller anteckningar.
  const cases = await ctx.system.table("cases").list({ contractId: main.id });
  const ids = cases.map((c) => c.id);
  const db = await loadDb(ctx.system, ["activities", "attendance", "check_ins", "reports", "inbound_emails", "ai_runs", "profiles", "memberships"], {
    activities: { caseId: { in: ids } }, attendance: { caseId: { in: ids } }, check_ins: { caseId: { in: ids } }, reports: { contractId: main.id }, memberships: { contractId: main.id },
  });
  const all = { ...db, cases };
  const [audioDel, manual] = await Promise.all([ctx.repo.table("audit_log").list({ action: "audio.deleted" }), ctx.repo.table("jobs").list({}, { orderBy: "createdAt" })]);

  const lastWeek = isoWeek(addDays(monday(today), -7)).key;
  const weekly = db.reports.filter((r) => r.kind === "weekly_attendance" && r.week === lastWeek);
  const waiting = weekly.filter((r) => r.status === "waiting");
  const lastMon = addDays(monday(today), -7);
  const coachesMissing = coaches(all).filter((c) => unregistered(all, c.id, lastMon, addDays(lastMon, 6), env).length > 0).length;
  const watch = progressionWatch(all, {}, env);
  const lastAudio = audioDel.map((a) => a.occurredAt).sort().slice(-1)[0] ?? null;
  const pendingTranscripts = db.check_ins.filter((c) => c.ai && !c.ai.rawTranscriptDeletedAt && c.status !== "approved");
  const latestMail = db.inbound_emails.map((e) => e.receivedAt).sort().slice(-1)[0] ?? null;
  const rr = resultRate(all, { window: "rolling_6m" }, env);
  const retentionUnset = isUnset(env.cfg.retention);
  const pub = slaRule(env.cfg, "veckorapport_publicering")?.time?.replace(":", ".") ?? null;
  const runOf = (key: JobKey) => manual.filter((j) => j.kind === key && (j.payload as { manual?: unknown }).manual === true).slice(-1)[0] ?? null;

  const J = (key: JobKey, schedule: string, last: string | null, status: JobStatusView, result: string, extra: { phase?: number; disabled?: boolean } = {}): JobRow => {
    const run = runOf(key);
    return { key, name: JOB_NAME[key], schedule, last: run ? run.createdAt : last, manual: !!run, status, result, phase: extra.phase ?? null, disabled: !!extra.disabled };
  };
  const jobs: JobRow[] = [
    J("inbox", "Var 2–5 minut", `${today}T09:10`, "ok", latestMail ? `Senaste mejl kom ${fmtDateTime(latestMail)}` : "Inga mejl"),
    J("weekly", `Måndag, när närvaron är komplett${pub ? ` – senast ${pub} enligt avtalet` : ""}`, `${today}T07:00`, waiting.length ? "waiting" : "ok",
      `${weekly.length - waiting.length} publicerade, ${waiting.length} väntar på närvaro (${fmtWeekKey(lastWeek)})`),
    J("att_remind", "Fredag 14.00 och måndag 08.00", `${today}T08:00`, "ok", `${plural(coachesMissing, "coach", "coacher")} påmind${coachesMissing === 1 ? "" : "a"} om förra veckan`),
    J("progress", "Måndag 08.00", `${today}T08:00`, "ok", `${watch.length} påminnelser till coacher, ${watch.filter((w) => w.level === "escalated").length} eskaleringar till chef`),
    J("audio", "Direkt efter lyckad transkribering – senast efter 24 timmar vid fel", lastAudio, "ok", `${plural(audioDel.length, "ljudfil", "ljudfiler")} raderade`, { phase: 2 }),
    J("transcripts", "Dagligen 02.00 – när avstämningen godkänts, senast efter 30 dagar", `${today}T02:00`, "ok",
      pendingTranscripts.length ? `${plural(pendingTranscripts.length, "råtranskript", "råtranskript")} väntar på granskning` : "Inga råtranskript kvar", { phase: 2 }),
    J("kpi", "Dagligen 06.00", `${today}T06:00`, "ok", `Resultatgrad ${pct(rr.value)} (rullande 6 månader, ${rr.num} av ${rr.den})`),
    J("retention", "Dagligen 03.00", null, retentionUnset ? "disabled" : "ok", retentionUnset ? "Regeln är inte fastställd (fråga 11) – jobbet raderar ingenting" : "Enligt avtalet", { disabled: retentionUnset }),
  ];
  return {
    approvedOn: APPROVED_ON,
    latestMail,
    inboxReadAt: `${today}T09:10`,
    aiRunCount: db.ai_runs.length,
    thirdCountryForbidden: env.cfg.thirdCountryProcessing === "forbidden_without_written_approval",
    returnDataWithinDays: env.cfg.termination.returnDataWithinDays,
    jobs,
  };
});

handleCommand(adminRunJob, { roles: ["admin"] }, async (ctx, p) => {
  const main = await mainContract(ctx);
  if (p.key === "retention" && isUnset(main.config.retention)) return fail("disabled", "Gallringsregeln är inte fastställd – jobbet kan inte köras.");
  const now = ctx.now();
  await ctx.repo.table("jobs").insert({
    id: ctx.newId("job"), kind: p.key, payload: { manual: true }, status: "done", attempts: 1, runAfter: now, lastError: null, createdAt: now, createdBy: ctx.actor.userId, finishedAt: now,
  });
  await ctx.audit({ action: "job.run_manual", entity: "job", entityId: p.key, contractId: null, details: {} });
  return ok({});
});
