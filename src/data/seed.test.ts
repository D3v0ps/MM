// Testdata: samma data som den gamla prototypen (prototyp/src/01-seed.js), rad för rad.
// 1. Paritet: kör den gamla prototypens MM.seed() i Node och jämför med createProtoState() fält för fält.
// 2. Antal rader per tabell och stickprov (prototyp/tools/data-samples.json, mappat till nya tabellnamn).
//    OBS: data-samples.json skapades från en äldre version av prototypens seed. Där den skiljer sig från den
//    nuvarande prototypen gäller den nuvarande (se kommentarerna vid respektive värde).
// 3. Determinism, hastighet och att utskick och logg saknar personuppgifter.
import { CONTACT_PHONE } from "@/features/_shared/contact";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { holidaysOf } from "@/core/holidays";
import { createProtoState, createSeed, DEMO_START } from "./seed";
import { decodeTestPnr, encodeTestPnr, fnv1a64, normalizePnr, testPnrHash } from "./seed/pnr";
import type { Tables } from "./schema";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROTO_SRC = path.join(ROOT, "prototyp/src");
const SAMPLES_FILE = path.join(ROOT, "prototyp/tools/data-samples.json");
const hasProto = fs.existsSync(path.join(PROTO_SRC, "01-seed.js"));

type Json = Record<string, unknown>;
const seed = createSeed();
const byId = <N extends keyof Tables>(name: N, id: string) => (seed[name] as Tables[N][]).find((r) => r.id === id);
const tag = (t: string) => {
  const row = seed.demo_tags.find((x) => x.tag === t);
  if (!row) throw new Error(`Taggen ${t} saknas`);
  return row.entityIds;
};
const caseByTag = (t: string) => byId("cases", tag(t)[0])!;

/** Den gamla prototypens seed, körd i en fejkad window (som prototyp/tools/lib.mjs gör i webbläsaren). */
function oldPrototypeSeed(): { S: Json; HOLIDAYS: Record<string, string> } {
  const ctx: Json = { console, Date, Math, JSON, Object, Array, String, Number, Set, Map, RegExp, parseInt, Intl };
  ctx.window = ctx;
  ctx.htmPreact = { html: () => null, h: () => null, render: () => null };
  vm.createContext(ctx);
  for (const f of ["00-core.js", "01-seed.js"]) vm.runInContext(fs.readFileSync(path.join(PROTO_SRC, f), "utf8"), ctx, { filename: f });
  const MM = ctx.MM as { seed(): Json; d: { HOLIDAYS: Record<string, string> } };
  return { S: JSON.parse(JSON.stringify(MM.seed())) as Json, HOLIDAYS: MM.d.HOLIDAYS };
}

describe.skipIf(!hasProto)("paritet med den gamla prototypen", () => {
  const old = hasProto ? oldPrototypeSeed() : { S: {} as Json, HOLIDAYS: {} };
  const neu = JSON.parse(JSON.stringify(createProtoState())) as Json;
  // Nya fältnamn tillbaka till prototypens innan jämförelsen
  for (const e of neu.outcomeEvents as Json[]) { e.verificationFile = e.verificationPath; delete e.verificationPath; }
  // Växelnumret: prototypen har platshållaren 08-000 00 00, appen MB:s riktiga nummer (src/features/_shared/contact.ts).
  for (const n of old.S.notifications as Json[]) if (typeof n.body === "string") n.body = (n.body as string).replace(" Frågor? Ring 08-000 00 00.", CONTACT_PHONE ? ` Frågor? Ring ${CONTACT_PHONE}.` : "");
  // Närvaroförslaget i AI-utkastet (2026-10-09) finns bara i appens testdata – bort ur förslagen och transkriptet före jämförelsen.
  for (const ci of neu.checkIns as Json[]) {
    const ai = ci.ai as Json | null;
    if (!ai) continue;
    delete ai.attendanceComment;
    if (ai.suggestions) delete (ai.suggestions as Json).attendanceComment;
    const oldCi = (old.S.checkIns as Json[]).find((x) => x.id === ci.id);
    const oldTranscript = JSON.stringify(((oldCi?.ai as Json | null)?.transcript as Json[] | undefined) ?? []);
    if (Array.isArray(ai.transcript)) ai.transcript = (ai.transcript as Json[]).filter((row) => oldTranscript.includes(JSON.stringify(row)));
  }
  // Inkorgens ärenden saknar closedAt i prototypen (undefined) – här null
  for (const c of neu.cases as Json[]) if (c.closedAt === null && !("closedAt" in ((old.S.cases as Json[]).find((x) => x.id === c.id) ?? {}))) delete c.closedAt;

  const tables = ["users", "customerUsers", "buyerReferences", "persons", "cases", "caseStatusHistory", "inboundEmails", "intakeAssessments", "activities", "attendance",
    "checkIns", "monthlyAssessments", "monthlyPlans", "outcomeEvents", "deviations", "contractDeviations", "employers", "placements", "reports", "pulseInvites",
    "pulseResponses", "messages", "billingRuns", "consents", "aiRuns", "auditLog", "notifications", "tasks", "userNotifications"];
  it.each(tables)("%s är identisk rad för rad", (t) => {
    expect(neu[t]).toEqual(old.S[t]);
  });
  it("löpnummer, fakturastatus, lästa notiser, script och oregistrerade tillfällen är identiska", () => {
    expect(neu.caseCounters).toEqual(old.S.caseCounters);
    expect(neu.invoiceStatus).toEqual(old.S.invoiceStatus);
    expect(neu.notifRead).toEqual(old.S.notifRead);
    expect(neu.script).toEqual(old.S.script);
    expect(neu.w4MissingActivityIds).toEqual((old.S.meta as Json).w4MissingActivityIds);
    expect(neu.seq).toBe(old.S.seq);
  });
  it("helgdagarna 2026–2027 är desamma som prototypens lista", () => {
    const computed = { ...holidaysOf(2026), ...holidaysOf(2027) };
    expect(computed).toEqual(old.HOLIDAYS);
    expect(Object.fromEntries(seed.holidays.map((h) => [h.date, h.name]))).toEqual(old.HOLIDAYS);
  });
});

describe("antal rader per tabell", () => {
  it("är prototypens antal (mappat till nya tabellnamn)", () => {
    const n = (name: keyof Tables) => (seed[name] as unknown[]).length;
    const samples = fs.existsSync(SAMPLES_FILE) ? (JSON.parse(fs.readFileSync(SAMPLES_FILE, "utf8")) as { counts: Record<string, number> }).counts : null;
    // [nytt tabellnamn, prototypens namn, antal i nuvarande prototyp]. Avvikelse: prototypen har två avtal – Miljonmatch har
    // bara kommunavtal, och det andra avtalet (med dess organisation och medlemskap) är borttaget ur testdatat (beslut 2026-10-06).
    const rows: [keyof Tables, string, number][] = [
      ["contracts", "contracts", 1], ["contract_areas", "areas", 12], ["price_items", "priceItems", 12], ["buyer_references", "buyerReferences", 4],
      ["persons", "persons", 230], ["cases", "cases", 231], ["case_status_history", "caseStatusHistory", 594], ["inbound_emails", "inboundEmails", 27],
      ["intake_assessments", "intakeAssessments", 225], ["activities", "activities", 3861], ["attendance", "attendance", 3590],
      ["check_ins", "checkIns", 1145], ["monthly_assessments", "monthlyAssessments", 352], ["monthly_plans", "monthlyPlans", 352],
      ["outcome_events", "outcomeEvents", 228], ["deviations", "deviations", 19], ["contract_deviations", "contractDeviations", 3], ["employers", "employers", 12],
      ["placements", "placements", 158], ["reports", "reports", 794], ["pulse_invites", "pulseInvites", 341], ["pulse_responses", "pulseResponses", 217],
      // Beslut 2026-10-07 (seed/decisions-2026-10-07.ts): em-104 är en vanlig fråga – utskicket av den generiska
      // mottagningsbekräftelsen, dess loggrad och uppgiften till avtalsansvarig finns inte (prototypen: 20, 8 och 2).
      ["messages", "messages", 7], ["billing_runs", "billingRuns", 5], ["consents", "consents", 157], ["ai_runs", "aiRuns", 2], ["audit_log", "auditLog", 19],
      ["outbound_messages", "notifications", 7], ["tasks", "tasks", 1],
    ];
    for (const [table, , count] of rows) expect([table, n(table)]).toEqual([table, count]);
    // data-samples.json är från en äldre seed: avstämningar 1144, händelser 230, avvikelser 18, praktik 159, uppgifter 0.
    // Den nuvarande prototypen (paritetstestet ovan) har 1145, 228, 19, 158 och 2. Övriga antal stämmer med filen – utom
    // revisionsloggen och utskicken (beslut 2026-10-07, se ovan).
    const STALE = new Set(["checkIns", "outcomeEvents", "deviations", "placements", "tasks", "contracts", "auditLog", "notifications"]);
    if (samples) for (const [table, proto] of rows) if (!STALE.has(proto)) expect([proto, n(table)]).toEqual([proto, samples[proto]]);
    // users + customerUsers -> profiles; ett medlemskap per användare och avtal. Kommunens chef (k-eva) är borttagen
    // (beslut 2026-10-07): fyra handläggare hos kommunen.
    expect(n("profiles")).toBe(13 + 4);
    expect(n("memberships")).toBe(17); // ett medlemskap per användare – alla i Botkyrkaavtalet
    expect(n("user_notifications")).toBe(63);
    expect(n("notification_reads")).toBe(seed.user_notifications.filter((x) => x.createdAt < "2027-01-29").length);
    // Rollen handledare bort (beslut 2026-10-09): Petras platser som yrkesspecifik handledare finns inte i testdatat.
    const protoTeam = createProtoState().cases.flatMap((c) => c.team);
    expect(n("case_team")).toBe(protoTeam.filter((t) => t.role !== "vocational_supervisor").length);
    expect(protoTeam.some((t) => t.role === "vocational_supervisor")).toBe(true);
    expect(seed.case_team.some((t) => t.role === "vocational_supervisor")).toBe(false);
    expect(seed.case_team.filter((t) => t.role === "lead_coach").length).toBe(seed.cases.filter((c) => c.leadCoachId).length);
    expect(n("case_counters")).toBe(2);
    expect(n("organizations")).toBe(2); // Miljonbemanning och Botkyrka kommun
    expect(n("holidays")).toBe(32);
  });
});

describe("stickprov mot data-samples.json", () => {
  const S = fs.existsSync(SAMPLES_FILE) ? (JSON.parse(fs.readFileSync(SAMPLES_FILE, "utf8")) as Record<string, Json & Json[]>) : null;

  it("scriptade ärenden har samma id och finns som demo_tags", () => {
    expect(S).not.toBeNull();
    for (const [t, caseId] of Object.entries(S!.script_tags as unknown as Record<string, string>)) expect([t, tag(t)]).toEqual([t, [caseId]]);
    expect(tag("prelim2")).toHaveLength(1);
    expect(tag("ai-draft")).toHaveLength(1);
    expect(tag("pi-demo")).toEqual(["pi-demo"]);
    expect(tag("w4MissingActivityIds")).toHaveLength(6);
  });

  it("ärendet nadia: samma ärendenummer, person, startdatum och coach (case_active_nadia)", () => {
    const s = S!.case_active_nadia;
    const c = caseByTag("nadia");
    expect(c.id).toBe(s.id);
    expect(c.caseNumber).toBe("BOT-26-0143");
    expect(c.caseNumber).toBe(s.number);
    expect(c.personId).toBe(s.personId);
    expect(c.startDate).toBe(s.startDate);
    expect(c.leadCoachId).toBe(s.leadCoachId);
    expect({ status: c.status, referredAt: c.referredAt, referrerId: c.referrerId, buyerReference: c.buyerReference, primaryAreaCode: c.primaryAreaCode, plannedEnd: c.plannedEnd,
      confirmedAt: c.confirmedAt, firstMeetingAt: c.firstMeetingAt, phase: c.phase, aiConsentStatus: c.aiConsentStatus, meetingDay: c.meetingDay, meetingTime: c.meetingTime })
      .toEqual({ status: s.status, referredAt: s.referredAt, referrerId: s.referrerId, buyerReference: s.buyerReference, primaryAreaCode: s.primaryArea, plannedEnd: s.plannedEnd,
        confirmedAt: s.confirmedAt, firstMeetingAt: s.firstMeetingAt, phase: s.phase, aiConsentStatus: s.aiConsent, meetingDay: s.meetingDay, meetingTime: s.meetingTime });
    const team = seed.case_team.filter((t) => t.caseId === c.id).map((t) => ({ userId: t.userId, role: t.role }));
    // Petra (yrkesspecifik handledare i prototypen) är inte med i teamet sedan rollen handledare togs bort (beslut 2026-10-09).
    expect(team).toEqual((s.team as unknown as { userId: string; role: string }[]).filter((t) => t.role !== "vocational_supervisor"));
    const p = byId("persons", c.personId)!;
    const sp = S!.person;
    expect({ firstName: p.firstName, lastName: p.lastName, birthYear: p.birthYear, last4: p.personnummerLast4, city: p.city, language: p.language, preferredContact: p.preferredContact })
      .toEqual({ firstName: sp.firstName, lastName: sp.lastName, birthYear: sp.birthYear, last4: sp.pnrLast4, city: sp.city, language: sp.language, preferredContact: sp.preferredContact });
    expect(decodeTestPnr(p.personnummerEnc)).toBe(sp.pnr);
    // data-samples.json har "070-0390 37 72" från en äldre seed – nuvarande prototyp ger tre siffror efter 070-.
    expect(p.phone).toBe("070-390 37 72");
  });

  it("inkorgens ärende (case_inbox), avslutat ärende (case_closed) och mejlen", () => {
    const si = S!.case_inbox;
    const ci = byId("cases", si.id as string)!;
    // Beslut 2026-10-07: Ahmeds beställning saknar omfattningen – inga planerade veckor (prototypen: 6 veckor).
    expect(si.plannedWeeks).toBe(6);
    expect({ caseNumber: ci.caseNumber, status: ci.status, referredAt: ci.referredAt, referrerId: ci.referrerId, buyerReference: ci.buyerReference, acknowledgedAt: ci.acknowledgedAt,
      desiredStart: ci.desiredStart, plannedWeeks: ci.plannedWeeks, leadCoachId: ci.leadCoachId, primaryAreaCode: ci.primaryAreaCode })
      .toEqual({ caseNumber: si.number, status: si.status, referredAt: si.referredAt, referrerId: si.referrerId, buyerReference: si.buyerReference, acknowledgedAt: si.acknowledgedAt,
        desiredStart: si.desiredStart, plannedWeeks: null, leadCoachId: si.leadCoachId, primaryAreaCode: si.primaryArea });
    expect(ci).toMatchObject({ orderPeriodMonths: null, plannedEnd: null, orderValueWeeks: null });
    // data-samples.json har personId p-17260 från en äldre seed; nuvarande prototyp ger p-17259.
    expect(ci.personId).toBe("p-17259");

    const sc = S!.case_closed;
    const cc = byId("cases", sc.id as string)!;
    expect({ caseNumber: cc.caseNumber, personId: cc.personId, status: cc.status, startDate: cc.startDate, endDate: cc.endDate, endReason: cc.endReason, resultClass: cc.resultClass,
      resultVerifiedAt: cc.resultVerifiedAt, closedAt: cc.closedAt, leadCoachId: cc.leadCoachId, phase: cc.phase, buyerReference: cc.buyerReference })
      .toEqual({ caseNumber: sc.number, personId: sc.personId, status: sc.status, startDate: sc.startDate, endDate: sc.endDate, endReason: sc.endReason, resultClass: sc.resultClass,
        resultVerifiedAt: sc.resultVerifiedAt, closedAt: sc.closedAt, leadCoachId: sc.leadCoachId, phase: sc.phase, buyerReference: sc.buyerReference });

    // Beslut 2026-10-07: Ahmeds mejl (AI) saknar omfattningen (inte beställarreferens och slutdatum) – kommunens formulär och
    // ordererkännandet frågar efter omfattningen, och referensen fylls i av Miljonbemanning.
    const MISSING_AFTER: Record<string, string[]> = { inboundEmail_ai: ["orderPeriod"] };
    for (const key of ["inboundEmail_template", "inboundEmail_ai", "inboundEmail_supplement"]) {
      const se = S![key];
      const e = byId("inbound_emails", se.id as string)!;
      expect({ key, receivedAt: e.receivedAt, fromAddress: e.fromAddress, subject: e.subject, parseMethod: e.parseMethod, classification: e.classification, status: e.status,
        caseId: e.caseId, missingFields: e.missingFields, attachments: e.attachments.map((a) => a.name) })
        .toEqual({ key, receivedAt: se.receivedAt, fromAddress: se.fromAddress, subject: se.subject, parseMethod: se.parseMethod, classification: se.classification, status: se.status,
          caseId: se.caseId, missingFields: MISSING_AFTER[key] ?? se.missingFields, attachments: (se.attachments as unknown as { name: string }[]).map((a) => a.name) });
    }
    expect(S!.inboundEmail_ai.missingFields).toEqual(["buyerReference", "plannedEnd"]);
    // Kompletteringen anger omfattningen (6 månader) och beställarreferensen (prototypen: referensen och slutdatumet).
    expect(byId("inbound_emails", "em-103")!.extracted).toEqual({ orderPeriod: "6", buyerReference: (S!.inboundEmail_supplement.extracted as Json).buyerReference });
    expect(byId("inbound_emails", "em-101")!.extracted.referrerPhone).toBe("08-530 000 11");
  });

  it("rapporter och fakturakörningar", () => {
    // Rapport-id:n i data-samples.json är förskjutna med ett (äldre seed); jämför på innehåll.
    // Beställarrapporten har ingen mottagare sedan beslutet 2026-10-07 (en per avtal och månad) – den jämförs utan mottagaren.
    const find = (s: Json) => seed.reports.find((r) => r.kind === s.kind && r.caseId === (s.caseId ?? null) && r.month === (s.month ?? null) && r.week === (s.week ?? null)
      && (s.kind === "customer_summary" ? r.recipientUserId === null : r.recipientUserId === (s.recipientUserId ?? null)))!;
    const m = find(S!.report_monthly);
    expect({ id: m.id, periodStart: m.periodStart, periodEnd: m.periodEnd, dueAt: m.dueAt, status: m.status, approvedBy: m.approvedBy, deliveredTo: m.deliveredTo, provisionalDue: m.provisionalDue })
      .toEqual({ id: "rep-15204", periodStart: "2026-09-01", periodEnd: "2026-09-30", dueAt: "2026-10-07T23:59", status: "delivered", approvedBy: "u-leila", deliveredTo: ["k-maria"], provisionalDue: true });
    const w = find(S!.report_weekly);
    expect({ id: w.id, periodStart: w.periodStart, dueAt: w.dueAt, status: w.status, approvedBy: w.approvedBy, deliveredTo: w.deliveredTo })
      .toEqual({ id: "rep-16620", periodStart: "2026-09-14", dueAt: "2026-09-21T16:00", status: "delivered", approvedBy: "system", deliveredTo: ["k-maria"] });
    const cs = find(S!.report_customer_summary);
    const scs = S!.report_customer_summary;
    // Lämnad utanför portalen: ingen mottagare, inte öppnad i portalen (prototypen: levererad till och öppnad av k-eva).
    expect(scs.recipientUserId).toBe("k-eva");
    expect({ periodStart: cs.periodStart, dueAt: cs.dueAt, approvedAt: cs.approvedAt, deliveredAt: cs.deliveredAt, openedAt: cs.openedAt, deliveredTo: cs.deliveredTo })
      .toEqual({ periodStart: scs.periodStart, dueAt: scs.dueAt, approvedAt: scs.approvedAt, deliveredAt: scs.deliveredAt, openedAt: null, deliveredTo: [] });
    const f = find(S!.report_final);
    expect({ periodStart: f.periodStart, periodEnd: f.periodEnd, dueAt: f.dueAt, status: f.status, approvedBy: f.approvedBy })
      .toEqual({ periodStart: "2026-09-17", periodEnd: "2026-11-20", dueAt: "2026-11-27T23:59", status: "delivered", approvedBy: "u-leila" });
    const oc = find(S!.report_order_confirmation);
    expect({ approvedAt: oc.approvedAt, deliveredAt: oc.deliveredAt, dueAt: oc.dueAt }).toEqual({ approvedAt: "2026-09-14T09:00", deliveredAt: "2026-09-14T09:00", dueAt: "2026-09-15T08:25" });

    const runs = seed.billing_runs.map((b) => ({ id: b.id, month: b.month, status: b.status, createdBy: b.createdBy, createdAt: b.createdAt }));
    expect(runs).toEqual(S!.billingRuns);
    // Beslut 2026-10-07 (synpunkt #13, seed/decisions-2026-10-07.ts): en faktura per avtal och månad med frysta rader. Prototypens
    // status per månad (default) blir månadens faktura; de ärenden som hade en annan status (december: de två returnerade)
    // står på en tilläggsfaktura. Januari är underlag och har ingen rad.
    const inv = seed.invoice_drafts.map((i) => [i.month, i.groupingKey, i.status, i.caseId, i.buyerReference]);
    expect(inv).toEqual([
      ["2026-09", "avtal", "paid", null, "55102938"], ["2026-10", "avtal", "paid", null, "55102938"], ["2026-11", "avtal", "paid", null, "55102938"],
      ["2026-12", "avtal", "sent", null, "55102938"], ["2026-12", "avtal-tillagg-2", "returned", null, "55102983"],
    ]);
    const proto = S!.invoiceStatus_example as Json;
    expect((proto["2026-12"] as Json).default).toBe("sent");
    const returnedCases = Object.entries(proto["2026-12"] as Json).filter(([k, v]) => k !== "default" && v === "returned").map(([k]) => k).sort();
    const suppId = seed.invoice_drafts.find((i) => i.groupingKey === "avtal-tillagg-2")!.id;
    expect(seed.invoice_lines.filter((l) => l.invoiceDraftId === suppId).map((l) => l.caseId).sort()).toEqual(returnedCases);
    // Varje fryst rad har veckor, ett ärendenummer i radtexten och inga namn.
    for (const l of seed.invoice_lines) {
      expect(l.isoWeeks.length, l.id).toBe(l.quantity);
      expect(l.description, l.id).toMatch(/^BOT-\d{2}-\d{4} · v\. /);
    }
  });

  it("Amira har 14 aktiva ärenden (amiraActive)", () => {
    expect(seed.cases.filter((c) => c.leadCoachId === "u-amira" && c.status === "active").length).toBe(S!.amiraActive as unknown as number);
  });
});

describe("mappning till tabellerna", () => {
  it("avtal, organisationer och konfiguration", () => {
    const bot = byId("contracts", "c-bot")!;
    expect(bot.casePrefix).toBe("BOT");
    expect(bot.config.kpis?.find((k) => k.key === "resultatgrad")?.contractTarget).toBe(0.32);
    expect(byId("organizations", bot.customerId)!.emailDomains).toEqual(["botkyrka.se"]);
    expect(byId("organizations", bot.supplierId)!.name).toBe("Miljonbemanning AB");
    expect(bot.status).toBe("active");
    expect(seed.contracts.map((c) => c.id)).toEqual(["c-bot"]);
    expect(seed.memberships.every((m) => m.contractId === "c-bot")).toBe(true);
    expect(seed.org_settings[0].settings.notifications.progressionWatch.escalateTo).toEqual(["chef"]);
  });
  it("användare blir profiler och medlemskap med rätt roll – kommunen bara handläggare (beslut 2026-10-07)", () => {
    expect(byId("profiles", "k-eva")).toBeUndefined();
    expect(seed.memberships.some((m) => m.userId === "k-eva")).toBe(false);
    expect(seed.notification_reads.some((r) => r.userId === "k-eva")).toBe(false);
    expect(seed.memberships.filter((m) => m.userId.startsWith("k-")).map((m) => m.role)).toEqual(["kommun_handlaggare", "kommun_handlaggare", "kommun_handlaggare", "kommun_handlaggare"]);
    expect(byId("profiles", "k-omar")).toMatchObject({ fullName: "Omar Farah", organizationId: "org-botkyrka" });
    expect(seed.memberships.find((m) => m.userId === "k-omar")!.role).toBe("kommun_handlaggare");
    expect(byId("profiles", "u-robin")).toMatchObject({ email: "robin.aberg@miljonbemanning.se", phone: "08-000 00 23" });
    // Rollen handledare bort (beslut 2026-10-09): de tre som var handledare har rollen coach; Petra har ingen teamroll.
    expect(byId("profiles", "u-petra")).toMatchObject({ teamRole: null, title: "Jobbcoach – lager, logistik och transport" });
    expect(seed.memberships.some((m) => m.role === "handledare")).toBe(false);
    expect(["u-petra", "u-david", "u-hanna"].map((id) => seed.memberships.find((m) => m.userId === id)?.role)).toEqual(["coach", "coach", "coach"]);
    expect(byId("profiles", "k-maria")!.lastLoginAt).toBe("2027-01-27T13:40");
  });
  it("inga skyddade personuppgifter i testdatat (beslut 2026-10-07): ärendet 'skyddad' är en vanlig person", () => {
    expect(seed.persons.every((x) => !x.protectedIdentity)).toBe(true);
    expect(seed.cases.some((x) => x.aiConsentStatus === "not_applicable")).toBe(false);
    const c = caseByTag("skyddad");
    const p = byId("persons", c.personId)!;
    expect(p).toMatchObject({ protectedIdentity: false, address: null, city: "Tumba", phone: "070-555 01 47", preferredContact: "phone" });
    expect(c.aiConsentStatus).toBe("not_asked");
    // em-104 är en vanlig fråga (Övrigt) utan generisk bekräftelse och utan uppgift till avtalsansvarig.
    expect(byId("inbound_emails", "em-104")).toMatchObject({ classification: "other", status: "other", subject: "Fråga om startdatum", ackSentAt: null });
    expect(seed.outbound_messages.some((m) => m.template === "generisk_mottagningsbekraftelse")).toBe(false);
    expect(seed.tasks.map((t) => t.id)).toEqual(["task-1"]);
    // Adress lagras bara när kontaktvägen är brev
    expect(seed.persons.filter((x) => x.address !== null).every((x) => x.preferredContact === "letter" && !x.protectedIdentity)).toBe(true);
  });
  it("personnummer lagras bara som test-kryptering, hash och fyra sista siffror", () => {
    for (const p of seed.persons) {
      expect(p.personnummerEnc.startsWith("test:")).toBe(true);
      expect(p.personnummerHash).toBe(testPnrHash(decodeTestPnr(p.personnummerEnc)));
      expect(normalizePnr(decodeTestPnr(p.personnummerEnc)).slice(-4)).toBe(p.personnummerLast4);
      expect(JSON.stringify(p)).not.toMatch(/"pnr"/);
    }
    // Hashen är unik per person och normaliserad (ÅÅÅÅMMDD-NNNN och ÅÅMMDDNNNN ger samma hash)
    expect(new Set(seed.persons.map((p) => p.personnummerHash)).size).toBe(seed.persons.length);
    expect(testPnrHash("19730216-9545")).toBe(testPnrHash("7302169545"));
    expect(encodeTestPnr("")).toBe("");
  });
  it("utskick och revisionslogg innehåller inga namn eller personnummer", () => {
    const pii = seed.persons.flatMap((p) => [`${p.firstName} ${p.lastName}`, decodeTestPnr(p.personnummerEnc)]).filter(Boolean);
    for (const m of seed.outbound_messages) for (const x of pii) expect(m.body.includes(x)).toBe(false);
    for (const l of seed.audit_log) for (const x of pii) expect(JSON.stringify(l.details).includes(x)).toBe(false);
    for (const n of seed.user_notifications) for (const x of pii) expect(`${n.title} ${n.body} ${n.emailBody}`.includes(x)).toBe(false);
  });
  it("AI-utkastet hos mehmet: förslag med belägg men inga bedömningsfält", () => {
    const ci = byId("check_ins", tag("ai-draft")[0])!;
    expect(ci.caseId).toBe(caseByTag("mehmet").id);
    expect(ci).toMatchObject({ status: "draft", overallStatus: null, goalStatus: null, aiRunId: "ai-run-mehmet", inputMethod: "ai_recording" });
    expect(ci.ai?.goalStatus).toEqual({ value: "partly", quote: "Jag hann två leveranser själv, men den tredje åkte jag med Kristina.", t: 312 });
    expect(ci.ai && "overallStatus" in ci.ai).toBe(false);
    expect(seed.check_ins.filter((x) => x.ai !== null)).toHaveLength(1);
  });
  it("januaribedömningar beslutade 1 februari före demoklockan, rapporter och notiser vid tilldelning", () => {
    const janFeb1 = seed.monthly_assessments.filter((m) => m.month === "2027-01" && m.decidedAt?.startsWith("2027-02-01"));
    expect(janFeb1.length).toBeGreaterThan(0);
    for (const m of janFeb1) expect(m.decidedAt! < DEMO_START).toBe(true);
    // Två egenheter som finns i den gamla prototypens testdata och behålls för pariteten:
    // en slutrapport kvitterad 1 februari kl. 16.03 (efter demoklockan) och den sent levererade decemberrapporten
    // (flyttad för KPI:n) som kvitterades före leveransen.
    expect(seed.reports.filter((r) => r.openedAt && r.openedAt > DEMO_START).map((r) => [r.id, r.kind, r.openedAt])).toEqual([["rep-16365", "final", "2027-02-01T16:03"]]);
    expect(seed.reports.filter((r) => r.openedAt && r.deliveredAt && r.openedAt < r.deliveredAt).map((r) => [r.id, r.kind, r.month])).toEqual([["rep-15324", "monthly", "2026-12"]]);
    expect(seed.reports.filter((r) => r.kind === "weekly_attendance" && r.week === "2027-W04" && r.status === "waiting").map((r) => r.recipientUserId)).toEqual(["k-maria", "k-linda"]);
    const ingetmote = caseByTag("ingetmote");
    const n = seed.user_notifications.find((x) => x.caseId === ingetmote.id && x.recipientId === ingetmote.leadCoachId)!;
    expect(n.body).toMatch(new RegExp(`^Du är huvudcoach för ${ingetmote.caseNumber} \\([^)]+\\)\\. Första möte är inte bokat\\.$`));
    expect(n.emailBody).toBe(`Du har fått ett nytt ärende i Miljonmatch: ${ingetmote.caseNumber}. Logga in för att se detaljerna.`);
  });
  it("id:n är unika i varje tabell och alla hänvisningar pekar på rader som finns", () => {
    for (const [name, rows] of Object.entries(seed) as [keyof Tables, { id: string }[]][]) expect([name, new Set(rows.map((r) => r.id)).size]).toEqual([name, rows.length]);
    const ids = (name: keyof Tables) => new Set((seed[name] as { id: string }[]).map((r) => r.id));
    const cases = ids("cases");
    const persons = ids("persons");
    const profiles = ids("profiles");
    for (const c of seed.cases) { expect(persons.has(c.personId)).toBe(true); if (c.referrerId) expect(profiles.has(c.referrerId)).toBe(true); if (c.leadCoachId) expect(profiles.has(c.leadCoachId)).toBe(true); }
    for (const t of ["activities", "attendance", "check_ins", "monthly_assessments", "monthly_plans", "outcome_events", "deviations", "placements", "pulse_invites", "consents", "case_team", "case_status_history", "messages"] as const) {
      for (const r of seed[t] as { caseId: string }[]) expect(cases.has(r.caseId)).toBe(true);
    }
    for (const r of seed.reports) if (r.caseId) expect(cases.has(r.caseId)).toBe(true);
    for (const m of seed.memberships) expect(profiles.has(m.userId)).toBe(true);
  });
});

describe("determinism och hastighet", () => {
  it("två körningar ger identiskt JSON", () => {
    expect(JSON.stringify(createSeed())).toBe(JSON.stringify(createSeed()));
  });
  it("tar under en sekund", () => {
    const t0 = performance.now();
    createSeed();
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it("FNV-1a stämmer med kända testvektorer", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
    expect(testPnrHash("abc")).toBe(""); // inga siffror -> tom hash
  });
});
