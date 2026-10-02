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
import { addDays, dayOf, fmtDateTime, fmtTime, fmtWeekKey, isoWeek, monday } from "@/core/time";
import { JOB_NAME, type JobKey } from "./audit-text";
import { hidesCommercial } from "@/api/tester-access";
import { adminIntegrations, adminRunJob, type IntegrationView, type JobRow, type JobStatusView, type SubprocessorView } from "./api";
import { mainContract, orgRow, userNames } from "./shared";

/** Botkyrkas besked om underbiträden och inspelning (SPEC §3.1). */
const APPROVED_ON = "2026-09-29";

/** Underbiträdena (SPEC §3.1). Lämnas inte ut till begränsade testare (src/api/tester-access.ts). */
const SUBPROCESSORS: SubprocessorView[] = [
  { id: "supabase", name: "Supabase", what: "Databas, inloggning och fillagring", where: "Stockholm (eu-north-1)", status: "approved", us: true },
  { id: "vercel", name: "Vercel", what: "Applikation och serverfunktioner", where: "Funktioner i Stockholm (arn1)", status: "approved", us: true },
  // Beslut 2026-09-30 (docs/PLAN-ROST.md): Gemini Flash via Google Cloud Vertex AI, EU multi-region. Simulerad tills kontot finns.
  { id: "ai", name: "Google Cloud (Vertex AI)", what: "Transkribering och textutkast (Gemini Flash)", where: "EU multi-region (location eu)", status: "approved_test", us: true },
  { id: "sms", name: "SMS-leverantör", what: "Påminnelser och pulslänkar", where: "Väljs – helst svensk", status: "not_chosen", us: false },
  // SPEC §11 och docs/DRIFT.md avsnitt 4: Resend skickar notiser och inloggningskoder från notis@miljonmatch.se. Ska in i
  // PUB-avtalets förteckning över underbiträden och godkännas av Botkyrka.
  { id: "epost", name: "Resend (e-post)", what: "Notiser och inloggningskoder från notis@miljonmatch.se", where: "EU (Irland, eu-west-1)", status: "chosen", us: true },
  { id: "microsoft", name: "Microsoft", what: "Inloggning (Entra ID) och avrop@-brevlådan (Graph)", where: "Befintligt Microsoft 365", status: "approved", us: true },
];

/** Regionlåsningen (SPEC §3.1, CLAUDE.md "Stack"). Lämnas inte ut till begränsade testare. */
function regionLock(thirdCountryForbidden: boolean): string[] {
  return [
    "Supabase-projekten (produktion och staging) ligger i eu-north-1, Stockholm.",
    'Vercel-funktioner körs i arn1, Stockholm. vercel.json innehåller "regions": ["arn1"] – standardregionen iad1 (USA) används inte.',
    "Persondata behandlas bara i serverfunktionerna i arn1 – inte i Supabase Edge Functions, som körs närmast anroparen.",
    "Inga Vercel-specifika lagringstjänster (Blob, Edge Config) för persondata. Appen kan flyttas till annan drift.",
    thirdCountryForbidden ? "Behandling utanför EU/EES är förbjuden utan kommunens skriftliga förhandsgodkännande (avtalskonfigurationen)." : "Behandling utanför EU/EES enligt avtalet.",
  ];
}

/**
 * Korten under "Integrationer" (prototypens INT-lista). Byggs på servern så att leverantörerna och regionerna inte ligger i
 * webbläsarens kod. vendor = false (begränsade testare): utan raderna som pekar ut underbiträdena – vald leverantör, region,
 * DNS och godkännande. Samma uppgifter står i underbiträdeslistan, som de inte ser.
 */
function integrationCards(o: { inboxReadAt: string; latestMail: string | null; aiRunCount: number; vendor: boolean }): IntegrationView[] {
  const v = (label: string, text: string): [string, string][] => (o.vendor ? [[label, text]] : []);
  return [
    { id: "graph", name: "avrop@-brevlådan", sub: "Microsoft Graph", icon: "inbox", status: "active", phase: null,
      items: [["Läses", "Var 2–5 minut"], ["Senast läst", `I dag kl. ${fmtTime(o.inboxReadAt)}`], ["Senaste mejl", o.latestMail ? fmtDateTime(o.latestMail) : "–"], ["Svar skickas", "Från avrop@ i samma tråd, så att kommunen ser hela konversationen"]] },
    { id: "entra", name: "Microsoft Entra ID", sub: "Inloggning för Miljonbemanning", icon: "key", status: "active", phase: null, items: [["MFA", "Styrs av Microsoft 365"], ["Konton", "Bara inbjudna – ingen självregistrering"]] },
    { id: "fortnox", name: "Fortnox", sub: "Fakturor som Peppol BIS Billing 3", icon: "card", status: "off", phase: 2,
      items: [["Reserv i dag", "Export till Excel och PDF, eller Botkyrkas fakturaportal"], ["Öppen fråga", "Fråga 15: ingår Fortnox Integration och e-faktura i Miljonbemannings paket?"], ["Krav", "Omkörning får inte skapa dubbletter. Status synkas tillbaka."]] },
    { id: "sms", name: "SMS-leverantör", sub: "Påminnelser och pulslänkar", icon: "message", status: "notchosen", phase: null,
      items: [["Öppen fråga", "Fråga 18: val av SMS-leverantör"], ["Önskemål", "Svensk leverantör med API"], ["Innehåll", "Bara tid, plats och telefonnummer – aldrig personuppgifter"]] },
    // SPEC §11 och docs/DRIFT.md avsnitt 4: Resend skickar notiser och inloggningskoder från notis@miljonmatch.se.
    { id: "email", name: "E-postleverantör", sub: "Notiser och inloggningskoder", icon: "mail", status: "chosen", phase: null,
      items: [
        ...v("Vald", "Resend, EU (Irland, eu-west-1)"),
        ["Avsändare", "notis@miljonmatch.se – bara ärendenummer och länk, aldrig personuppgifter"],
        ...v("DNS", "SPF och studsar på send.miljonmatch.se, DKIM på resend._domainkey"),
        ...v("Godkännande", "Ska in i PUB-avtalets förteckning över underbiträden och godkännas av Botkyrka"),
      ] },
    { id: "ai", name: "AI-leverantör", sub: "Transkribering och textutkast", icon: "sparkles", status: "test", phase: 2,
      items: [
        ...v("Vald", "Gemini Flash via Google Cloud Vertex AI, EU multi-region"),
        ...v("I test", "Simulerad leverantör tills kontot i Google Cloud finns"),
        ["Aldrig", "AI Studio-nyckel eller global endpoint"],
        ["Anrop", `Bara via AI-adaptern – ${plural(o.aiRunCount, "körning", "körningar")} i prototypen`],
      ] },
  ];
}

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
  const name = await userNames(ctx);
  const runOf = (key: JobKey) => manual.filter((j) => j.kind === key && (j.payload as { manual?: unknown }).manual === true).slice(-1)[0] ?? null;

  const J = (key: JobKey, schedule: string, last: string | null, status: JobStatusView, result: string, extra: { phase?: number; disabled?: boolean } = {}): JobRow => {
    const run = runOf(key);
    const manualBy = run ? (run.createdBy === ctx.actor.userId ? "dig" : name(run.createdBy)) : null;
    return { key, name: JOB_NAME[key], schedule, last: run ? run.createdAt : last, manual: !!run, manualBy, status, result, phase: extra.phase ?? null, disabled: !!extra.disabled };
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
  const hide = hidesCommercial(ctx.actor);
  const inboxReadAt = `${today}T09:10`;
  const thirdCountryForbidden = env.cfg.thirdCountryProcessing === "forbidden_without_written_approval";
  return {
    // Begränsade testare: underbiträdena, Botkyrkas besked, regionlåsningen och avtalets villkor lämnas inte ut.
    ...(hide
      ? {}
      : {
          dataProtection: {
            approvedOn: APPROVED_ON,
            subprocessors: SUBPROCESSORS,
            regions: regionLock(thirdCountryForbidden),
            thirdCountryForbidden,
            returnDataWithinDays: env.cfg.termination.returnDataWithinDays,
          },
        }),
    integrations: integrationCards({ inboxReadAt, latestMail, aiRunCount: db.ai_runs.length, vendor: !hide }),
    storage: { place: "Stockholm", ...(hide ? {} : { detail: "Supabase eu-north-1 · Vercel arn1" }) },
    latestMail,
    inboxReadAt,
    aiRunCount: db.ai_runs.length,
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
