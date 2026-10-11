// Hanterare: underbiträden, integrationer och bakgrundsjobb (/admin/integrationer).
// Källa: prototyp/src/views/admin.js (admin.integrationer, jobRows, admin.runJob). De flesta jobben är simulerade i
// prototypen; manuella körningar sparas i tabellen jobs (payload.manual = true) och loggas i revisionsloggen.
// Brevlådan avrop@ (beslut 4c, 2026-10-08): kortet byggs av integrationsraden "graph", som jobbet inbox_import skriver
// (src/server/jobs/inbox.ts) – kopplad (senast läst, antal, senaste fel) eller inte kopplad med stegen för att koppla.
// "Kör nu" för avrop@ lägger ett riktigt jobb som jobbkörningen tar (supabase-läget).
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import { handleCommand, handleQuery } from "@/api/server";
import { unregistered } from "@/core/attendance";
import { coaches } from "@/core/cases";
import { autoAttendanceOf, isUnset, slaRule } from "@/core/config";
import { domainEnv } from "@/core/env";
import { pct, plural } from "@/core/format";
import { resultRate } from "@/core/kpi";
import { progressionWatch } from "@/core/progression";
import { addDays, dayOf, fmtDateTime, fmtTime, fmtWeekKey, isoWeek, monday } from "@/core/time";
import { SIMULATED_PROVIDER } from "@/features/_shared/ai-sim";
import { runAutoAttendance } from "@/features/_shared/auto-attendance";
import { JOB_NAME, type JobKey } from "./audit-text";
import type { Integration, Job } from "@/data/schema";
import { hidesCommercial } from "@/api/tester-access";
import { messagingOf, type ChannelState, type MessagingStatus } from "@/features/_shared/messaging-port";
import { adminIntegrations, adminRunJob, type IntegrationView, type JobRow, type JobStatusView, type SubprocessorView } from "./api";
import { mainContract, orgRow, userNames } from "./shared";

/** Botkyrkas besked om underbiträden och inspelning (SPEC §3.1). */
const APPROVED_ON = "2026-09-29";

/** Underbiträdena (SPEC §3.1). Lämnas inte ut till begränsade testare (src/api/tester-access.ts). */
const SUBPROCESSORS: SubprocessorView[] = [
  { id: "supabase", name: "Supabase", what: "Databas, inloggning och fillagring", where: "Stockholm (eu-north-1)", status: "approved", us: true },
  { id: "vercel", name: "Vercel", what: "Applikation och serverfunktioner", where: "Funktioner i Stockholm (arn1)", status: "approved", us: true },
  // Beslut 2026-09-30 (docs/PLAN-ROST.md): Gemini Flash via Google Cloud Vertex AI, EU multi-region. Godkänd av Botkyrka
  // 2026-09-29 (bekräftat av Karim 2026-10-02) – simulerad tills kontot i Google Cloud finns.
  { id: "ai", name: "Google Cloud (Vertex AI)", what: "Transkribering och textutkast (Gemini Flash)", where: "EU multi-region (location eu)", status: "approved_test", us: true },
  // Beslut 2026-10-09: 46elks (svenskt bolag, data i EU) för SMS och utringning till deltagare. Biträdesavtal krävs innan riktiga
  // deltagare får SMS, och Botkyrka ska godkänna underbiträdet (docs/DRIFT.md avsnitt 13).
  { id: "sms", name: "46elks (SMS och utringning)", what: "Kallelser och inbjudningar till deltagare – bara tid, plats och telefonnummer", where: "EU (svenskt bolag)", status: "chosen", us: false },
  // SPEC §11 och docs/DRIFT.md avsnitt 4: Resend skickar notiser och inloggningskoder från notis@miljonmatch.se. Ska in i
  // PUB-avtalets förteckning över underbiträden och godkännas av Botkyrka.
  { id: "epost", name: "Resend (e-post)", what: "Notiser och inloggningskoder från notis@miljonmatch.se", where: "EU (Irland, eu-west-1)", status: "chosen", us: true },
  // Beslut 4c (2026-10-08): brevlådan avrop@ läses via Graph med applikationsbehörighet begränsad till den brevlådan (docs/DRIFT.md avsnitt 12).
  { id: "microsoft", name: "Microsoft", what: "Inloggning (Entra ID) och avrop@-brevlådan (Graph, bara brevlådan avrop@ – mejlen ligger kvar i Microsoft 365)", where: "Befintligt Microsoft 365 (EU)", status: "approved", us: true },
];

/** Jobbtypen i tabellen jobs för en rad i adminvyn: avrop@ är ett riktigt jobb (inbox_import), övriga simulerade. */
const JOB_KIND: Record<JobKey, string> = { inbox: "inbox_import", auto_attendance: "auto_attendance", weekly: "weekly", att_remind: "att_remind", progress: "progress", audio: "audio", transcripts: "transcripts", kpi: "kpi", retention: "retention" };

/** Läget för brevlådan ur integrationsraden "graph" (skrivs av jobbet inbox_import – inga hemligheter). */
type InboxConfig = {
  configured?: boolean; mailbox?: string; doneFolder?: string; lastRunAt?: string; lastImportAt?: string; lastError?: string | null;
  lastSummary?: { seen?: number; imported?: number; cases?: number; toRegister?: number; supplements?: number; other?: number; moveErrors?: number };
};
type InboxView = { state: "connected" | "not_connected" | "simulated"; cfg: InboxConfig; readAt: string | null };
function inboxView(row: Integration | null, simulatedAt: string): InboxView {
  const cfg = (row?.config ?? {}) as InboxConfig;
  // Testdatat har ingen körning: visas som simulerad läsning (prototypen och minnesläget).
  if (cfg.configured === undefined) return { state: "simulated", cfg, readAt: simulatedAt };
  return { state: cfg.configured ? "connected" : "not_connected", cfg, readAt: cfg.configured ? cfg.lastRunAt ?? null : null };
}

/** Stegen för att koppla brevlådan (utan namn på miljövariabler – de står i docs/DRIFT.md avsnitt 12). */
const CONNECT_STEPS: [string, string][] = [
  ["Status", "Inte kopplad – så här kopplar du"],
  ["Steg 1", "Registrera en app i Microsoft Entra (Appregistreringar) i Miljonbemannings Microsoft 365."],
  ["Steg 2", "Ge appen applikationsbehörigheten Mail.ReadWrite i Microsoft Graph och godkänn den som administratör."],
  ["Steg 3", "Begränsa appen till brevlådan avrop@ med en åtkomstpolicy i Exchange Online (ApplicationAccessPolicy)."],
  ["Steg 4", "Skapa en klienthemlighet och lägg katalog-id, klient-id, hemligheten och brevlådans adress i Vercel – bara där."],
  ["Steg 5", "Driftsätt igen. Inom två minuter står det Kopplad här, och olästa mejl i Inkorgen läses in och flyttas till mappen Inläst."],
  ["Anvisning", "Steg för steg, med Exchange-kommandot och felsökning, i docs/DRIFT.md avsnitt 12."],
];

/** Kortet avrop@-brevlådan. */
function inboxCard(v: InboxView, latestMail: string | null, vendor: boolean): IntegrationView {
  const base = { id: "graph", name: "avrop@-brevlådan", sub: "Microsoft Graph", icon: "inbox" as const, phase: null };
  if (v.state === "not_connected") return { ...base, status: "off", items: CONNECT_STEPS };
  const s = v.cfg.lastSummary;
  const run = s
    ? `${plural(s.imported ?? 0, "mejl inläst", "mejl inlästa")}${s.cases ? `, ${plural(s.cases, "ärende skapat", "ärenden skapade")}` : ""}${s.toRegister ? `, ${s.toRegister} att registrera för hand` : ""}${s.moveErrors ? `, ${s.moveErrors} kunde inte flyttas` : ""}`
    : "–";
  const items: [string, string][] = v.state === "simulated"
    ? [["Läses", "Varannan minut"], ["Senast läst", `I dag kl. ${fmtTime(v.readAt)}`], ["Senaste mejl", latestMail ? fmtDateTime(latestMail) : "–"], ["Svar skickas", "Från avrop@ i samma tråd, så att kommunen ser hela konversationen"]]
    : [
        ...(vendor && v.cfg.mailbox ? [["Brevlåda", v.cfg.mailbox] as [string, string]] : []),
        ["Läses", `Varannan minut – olästa mejl i Inkorgen flyttas till mappen ${v.cfg.doneFolder || "Inläst"} och ligger kvar där som reserv`],
        ["Senast läst", v.readAt ? fmtDateTime(v.readAt) : "–"],
        ["Senaste inläsning", v.cfg.lastImportAt ? `${fmtDateTime(v.cfg.lastImportAt)} · ${run}` : "Inga mejl inlästa ännu"],
        ...(v.cfg.lastError ? [["Senaste fel", v.cfg.lastError] as [string, string]] : []),
        ["Svar skickas", "Ordererkännandet går till handläggarens adress – bara ärendenumret, aldrig personuppgifter"],
      ];
  return { ...base, status: v.state === "simulated" ? "test" : "active", items };
}

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
/** "Kopplad" eller "Inte kopplad" och – för den som får se underbiträdena – vilka variabler som saknas (bara namnen). */
function phoneItems(st: ChannelState, vendor: boolean): [string, string][] {
  if (st.connected) return [["Status", "Kopplad"]];
  return [["Status", "Inte kopplad"], ...(vendor && st.missing.length ? [["Saknas i Vercel", st.missing.join(", ")] as [string, string]] : [])];
}

/**
 * SMS och utringning (46elks, beslut 2026-10-09): läget ur ctx.messaging – miljövariablerna på servern, inget kopplat i minnesläget.
 * vendor = false (begränsade testare): utan leverantörens namn och variablerna (de pekar ut underbiträdet).
 */
function phoneCards(m: MessagingStatus, vendor: boolean): IntegrationView[] {
  const v = (label: string, text: string): [string, string][] => (vendor ? [[label, text]] : []);
  return [
    { id: "sms", name: vendor ? "SMS (46elks)" : "SMS", sub: "Kallelser och inbjudningar till deltagare", icon: "message", status: m.sms.connected ? "active" : "off", phase: null,
      items: [
        ...phoneItems(m.sms, vendor),
        ["Innehåll", "Bara tid, plats och telefonnummer – aldrig namn, personnummer eller vad insatsen gäller"],
        ...v("Avsändare", "Avsändarnamnet i MM_SMS_FROM (standard Miljonbem)"),
        ...v("Godkännande", "Biträdesavtal med 46elks krävs innan riktiga deltagare får SMS. Botkyrka ska godkänna underbiträdet"),
        ...v("Anvisning", "docs/DRIFT.md avsnitt 13"),
      ] },
    { id: "call", name: vendor ? "Utringning (46elks)" : "Utringning", sub: "Kort inspelat meddelande till deltagare", icon: "phone", status: m.call.connected ? "active" : "off", phase: null,
      items: [
        ...phoneItems(m.call, vendor),
        ["Meddelande", "En inspelning utan personuppgifter som säger att tid och plats står i SMS:et eller mejlet"],
        ["När", "Dessutom, när kallelsen eller inbjudan gått med SMS eller e-post och deltagaren har ett telefonnummer"],
        ...v("Anvisning", "docs/DRIFT.md avsnitt 13 och public/ljud/README.md (inspelningen)"),
      ] },
  ];
}

function integrationCards(o: { inbox: InboxView; latestMail: string | null; aiRunCount: number; vendor: boolean; ai: "off" | "test" | "active"; messaging: MessagingStatus }): IntegrationView[] {
  const v = (label: string, text: string): [string, string][] => (o.vendor ? [[label, text]] : []);
  return [
    inboxCard(o.inbox, o.latestMail, o.vendor),
    { id: "entra", name: "Microsoft Entra ID", sub: "Inloggning för Miljonbemanning", icon: "key", status: "active", phase: null, items: [["Inloggning i dag", "E-post och engångskod"], ["Entra ID", "Kan kopplas senare"]] },
    { id: "fortnox", name: "Fortnox", sub: "Fakturor som Peppol BIS Billing 3", icon: "card", status: "off", phase: 2,
      items: [["Reserv i dag", "Export till Excel och PDF, eller Botkyrkas fakturaportal"], ["Öppen fråga", "Ingår Fortnox Integration och e-faktura i Miljonbemannings paket?"], ["Krav", "Omkörning får inte skapa dubbletter. Status synkas tillbaka."]] },
    ...phoneCards(o.messaging, o.vendor),
    // SPEC §11 och docs/DRIFT.md avsnitt 4: Resend skickar notiser och inloggningskoder från notis@miljonmatch.se.
    { id: "email", name: "E-postleverantör", sub: "Notiser och inloggningskoder", icon: "mail", status: "chosen", phase: null,
      items: [
        ...v("Vald", "Resend, EU (Irland, eu-west-1)"),
        ["Avsändare", "notis@miljonmatch.se – bara ärendenummer och länk, aldrig personuppgifter"],
        ...v("DNS", "SPF och studsar på send.miljonmatch.se, DKIM på resend._domainkey"),
        ...v("Godkännande", "Ska in i PUB-avtalets förteckning över underbiträden och godkännas av Botkyrka"),
      ] },
    // AI-stödet speglar körläget (beslut 2026-10-08): av i produktion tills Google Cloud är kopplat (MM_AI_PROVIDER=vertex),
    // simulerat i testmiljön, minnesläget och prototypen. Ingen simulerad text i produktion.
    { id: "ai", name: "AI-leverantör", sub: "Transkribering och textutkast", icon: "sparkles", status: o.ai, phase: 2,
      items: [
        ...(o.ai === "off" ? [["Läge", "Inte kopplad – tal till text, diktering och AI-utkast är avstängda. Den manuella vägen gäller."] as [string, string]] : []),
        ...v("Vald", "Gemini Flash via Google Cloud Vertex AI, EU multi-region"),
        ...(o.ai === "off" ? v("Så kopplas den", "Google Cloud-projekt, tjänstekonto och MM_AI_PROVIDER=vertex i Vercel – docs/DRIFT.md avsnitt 10") : []),
        ...(o.ai === "test" ? v("I test", "Simulerad leverantör tills kontot i Google Cloud finns") : []),
        ["Aldrig", "AI Studio-nyckel eller global endpoint"],
        ["Anrop", `Bara via AI-adaptern – ${plural(o.aiRunCount, "körning", "körningar")} hittills`],
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
  const [audioDel, manual, graphRow, autoRuns] = await Promise.all([
    ctx.repo.table("audit_log").list({ action: "audio.deleted" }), ctx.repo.table("jobs").list({}, { orderBy: "createdAt" }), ctx.repo.table("integrations").get("graph"),
    ctx.repo.table("audit_log").list({ action: "attendance.auto_registered", contractId: main.id }, { orderBy: "occurredAt", desc: true, limit: 1 }),
  ]);

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
  const runOf = (key: JobKey) => manual.filter((j) => j.kind === JOB_KIND[key] && (j.payload as { manual?: unknown }).manual === true).slice(-1)[0] ?? null;

  const J = (key: JobKey, schedule: string, last: string | null, status: JobStatusView, result: string, extra: { phase?: number; disabled?: boolean } = {}): JobRow => {
    const run = runOf(key);
    const manualBy = run ? (run.createdBy === ctx.actor.userId ? "dig" : name(run.createdBy)) : null;
    return { key, name: JOB_NAME[key], schedule, last: run ? run.createdAt : last, manual: !!run, manualBy, status, result, phase: extra.phase ?? null, disabled: !!extra.disabled };
  };
  // Brevlådan avrop@: läget ur integrationsraden (jobbet inbox_import skriver den) – testdatat visas som simulerad läsning.
  const inbox = inboxView(graphRow, `${today}T09:10`);
  const inboxRow = (): JobRow => {
    if (inbox.state === "simulated") return J("inbox", "Varannan minut", inbox.readAt, "ok", latestMail ? `Senaste mejl kom ${fmtDateTime(latestMail)}` : "Inga mejl");
    if (inbox.state === "not_connected") return J("inbox", "Varannan minut", inbox.cfg.lastRunAt ?? null, "disabled", "Brevlådan är inte kopplad – se kortet avrop@-brevlådan", { disabled: true });
    const s = inbox.cfg.lastSummary;
    const result = inbox.cfg.lastError
      ? `Senaste fel: ${inbox.cfg.lastError}`
      : s && s.seen ? `${plural(s.imported ?? 0, "mejl inläst", "mejl inlästa")} vid senaste körningen${s.cases ? `, ${plural(s.cases, "ärende", "ärenden")}` : ""}${s.toRegister ? `, ${s.toRegister} att registrera för hand` : ""}` : "Inga nya mejl vid senaste körningen";
    return J("inbox", "Varannan minut", inbox.readAt, inbox.cfg.lastError ? "failed" : "ok", result);
  };
  // Automatisk närvaro (Karims beslut 1, 2026-10-09): klockslaget ur organisationens inställningar och senaste körningens antal.
  const auto = autoAttendanceOf(settings);
  const lastAuto = autoRuns[0] ?? null;
  const lastAutoCount = Number((lastAuto?.details as { count?: unknown } | undefined)?.count ?? 0);
  const autoRow = (): JobRow => auto.autoPresent
    ? J("auto_attendance", `Dagligen ${auto.autoPresentAt.replace(":", ".")} – passerade tillfällen utan närvaro registreras som Närvarande. Frånvaro registrerar coachen.`, lastAuto?.occurredAt ?? null, "ok",
      lastAuto ? `${plural(lastAutoCount, "tillfälle", "tillfällen")} registrerade automatiskt vid senaste körningen` : "Inte körd än")
    : J("auto_attendance", "Avstängd i organisationens inställningar", lastAuto?.occurredAt ?? null, "disabled", "Närvaron registreras bara för hand", { disabled: true });
  const jobs: JobRow[] = [
    inboxRow(),
    autoRow(),
    J("weekly", `Måndag, när närvaron är komplett${pub ? ` – senast ${pub} enligt avtalet` : ""}`, `${today}T07:00`, waiting.length ? "waiting" : "ok",
      `${weekly.length - waiting.length} publicerade, ${waiting.length} väntar på närvaro (${fmtWeekKey(lastWeek)})`),
    J("att_remind", "Fredag 14.00 och måndag 08.00", `${today}T08:00`, "ok", `${plural(coachesMissing, "coach", "coacher")} påmind${coachesMissing === 1 ? "" : "a"} om förra veckan`),
    J("progress", "Måndag 08.00", `${today}T08:00`, "ok", `${watch.length} påminnelser till coacher, ${watch.filter((w) => w.level === "escalated").length} eskaleringar till chef`),
    J("audio", "Direkt efter lyckad transkribering – senast efter 24 timmar vid fel", lastAudio, "ok", `${plural(audioDel.length, "ljudfil", "ljudfiler")} raderade`, { phase: 2 }),
    J("transcripts", "Dagligen 02.00 – när avstämningen godkänts, senast efter 30 dagar", `${today}T02:00`, "ok",
      pendingTranscripts.length ? `${plural(pendingTranscripts.length, "råtranskript", "råtranskript")} väntar på granskning` : "Inga råtranskript kvar", { phase: 2 }),
    J("kpi", "Dagligen 06.00", `${today}T06:00`, "ok", `Resultatgrad ${pct(rr.value)} (rullande 6 månader, ${rr.num} av ${rr.den})`),
    J("retention", "Dagligen 03.00", null, retentionUnset ? "disabled" : "ok", retentionUnset ? "Gallringsregeln är inte fastställd med kommunen ännu – jobbet raderar ingenting" : "Enligt avtalet", { disabled: retentionUnset }),
  ];
  const hide = hidesCommercial(ctx.actor);
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
    integrations: integrationCards({
      inbox, latestMail, aiRunCount: db.ai_runs.length, vendor: !hide, ai: !ctx.ai ? "off" : ctx.ai.provider === SIMULATED_PROVIDER ? "test" : "active", messaging: messagingOf(ctx),
    }),
    storage: { place: "Stockholm", ...(hide ? {} : { detail: "Supabase eu-north-1 · Vercel arn1" }) },
    latestMail,
    inboxReadAt: inbox.readAt,
    inboxState: inbox.state,
    aiRunCount: db.ai_runs.length,
    jobs,
  };
});

handleCommand(adminRunJob, { roles: ["admin"] }, async (ctx, p) => {
  const main = await mainContract(ctx);
  if (p.key === "retention" && isUnset(main.config.retention)) return fail("disabled", "Gallringsregeln är inte fastställd – jobbet kan inte köras.");
  if (p.key === "inbox") {
    const graph = await ctx.repo.table("integrations").get("graph");
    const cfg = (graph?.config ?? {}) as InboxConfig;
    if (cfg.configured === false) return fail("disabled", "Brevlådan är inte kopplad – se kortet avrop@-brevlådan.");
  }
  if (p.key === "auto_attendance") {
    const { settings } = await orgRow(ctx, main.supplierId);
    if (!autoAttendanceOf(settings).autoPresent) return fail("disabled", "Automatisk närvaro är avstängd i organisationens inställningar.");
  }
  const now = ctx.now();
  // avrop@ (beslut 4c): ett riktigt jobb (inbox_import) som jobbkörningen tar direkt (after()) eller inom en minut (cron).
  // Automatisk närvaro (beslut 2026-10-09): ett riktigt jobb (auto_attendance, payload.manual – utan golv) i supabase-läget.
  // I minnesläget och prototypen finns ingen jobbkörning – avrop@ markeras klart direkt (simulerat) och den automatiska
  // närvaron registreras direkt med samma funktion som jobbet. Övriga jobb är simulerade.
  const real = (p.key === "inbox" || p.key === "auto_attendance") && !!ctx.jobs;
  if (p.key === "auto_attendance" && !real) await runAutoAttendance(ctx, { manual: true });
  const job: Job = {
    id: ctx.newId("job"), kind: JOB_KIND[p.key], payload: { manual: true }, status: real ? "queued" : "done", attempts: real ? 0 : 1, runAfter: now, lastError: null, createdAt: now,
    createdBy: ctx.actor.userId, finishedAt: real ? null : now,
  };
  await ctx.repo.table("jobs").insert(job);
  if (real) ctx.jobs?.schedule();
  await ctx.audit({ action: "job.run_manual", entity: "job", entityId: p.key, contractId: null, details: {} });
  return ok({ queued: real });
});
