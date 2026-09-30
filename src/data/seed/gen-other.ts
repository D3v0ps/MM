// Steg 4: avtalsavvikelser, puls, inkorgen (mejl till avrop@), meddelanden, fakturering, revisionslogg, utskick,
// notiser i appen och uppgifter. Port av prototyp/src/01-seed.js rad 770–950 – samma ordning på slumpanropen.
import { addDays, addMinutes, fmtDateTime } from "@/core/time";
import { AREAS, BACKGROUND, NOW, TODAY } from "./constants";
import type { Gen, PCase, PersonOverride, PNotification } from "./context";
import type { OrderExtract, OrderField, OutboundChannel, PulseOccasion, PulsePriority, PulseScore, TeamRole } from "../schema";

export function genContractDeviations(g: Gen) {
  g.S.contractDeviations.push(
    { id: "cd-1", contractId: "c-bot", source: "intern", type: "process", level: "mindre", escalationStep: 0, description: "Veckorapporten för vecka 47 till en handläggare publicerades 16.40 i stället för senast 16.00.", raisedAt: "2026-11-23T16:45",
      actionPlan: "Påminnelse till coacher fredag 14.00 och måndag 08.00. Saknad registrering eskaleras till samordnaren 10.00.", actionPlanDue: "2026-11-30", customerApprovedAt: "2026-11-30T11:00", warningIssued: false, penaltyOre: 0, status: "closed", lessons: "Automatisk eskalering infördes." },
    { id: "cd-2", contractId: "c-bot", source: "beställare", type: "kvalitet", level: "större", escalationStep: 1, description: "Månadsrapport för december saknade konkret observation för två progressionsområden.", raisedAt: "2027-01-08T09:20",
      actionPlan: "Systemet stoppar godkännande om observation saknas från nivå 1. Genomgång med alla coacher på APT 2027-01-14.", actionPlanDue: "2027-02-05", customerApprovedAt: "2027-01-15T14:10", warningIssued: false, penaltyOre: 0, status: "action_plan", lessons: "" },
    { id: "cd-3", contractId: "c-bot", source: "deltagare", type: "klagomål", level: "mindre", escalationStep: 0, description: "Deltagare upplevde att praktikplatsen inte var förberedd första dagen.", raisedAt: "2027-01-14T13:05",
      actionPlan: "Checklista \"fyra rätt\" gås igenom med arbetsgivaren före varje praktikstart.", actionPlanDue: "2027-02-12", customerApprovedAt: null, warningIssued: false, penaltyOre: 0, status: "open", lessons: "" },
  );
}

export function genPulse(g: Gen) {
  const { r, S, cases } = g;
  for (const c of cases) {
    if (!c.startDate || c.startDate > TODAY || c.tags.includes("skyddad")) continue;
    const occ: [PulseOccasion, string][] = [];
    if (addDays(c.startDate, 8) <= TODAY) occ.push(["week2", addDays(c.startDate, 8)]);
    if (c.status === "closed") occ.push(["exit", addDays(c.endDate as string, 1)]);
    for (const [occasion, sent] of occ) {
      const inv = { id: g.nid("pi"), caseId: c.id, channel: g.personOf(c).preferredContact === "email" ? "email" as const : "sms" as const, language: "sv", occasion, sentAt: `${sent}T10:00`, expiresAt: `${addDays(sent, 7)}T10:00`, usedAt: null as string | null };
      S.pulseInvites.push(inv);
      if (r.chance(0.63)) {
        inv.usedAt = `${addDays(sent, r.int(0, 3))}T${r.pick(["12:10", "18:40", "20:05"])}`;
        if (inv.usedAt > NOW) { inv.usedAt = null; continue; }
        const q1 = r.weighted<PulseScore>([[5, 42], [4, 39], [3, 12], [2, 5], [1, 2]]);
        const q3 = r.weighted<PulseScore>([[5, 48], [4, 38], [3, 14]]);
        // Fältordningen styr slumpen: språk, fråga 2, fråga 4.
        const id = g.nid("pr");
        const language = r.weighted([["sv", 70], ["so", 12], ["ar", 12], ["en", 6]]);
        const q2 = r.weighted<PulseScore>([[5, 30], [4, 40], [3, 20], [2, 7], [1, 3]]);
        const q4 = r.pick<PulsePriority>(["jobb", "praktik", "utbildning", "svenska", "annat"]);
        S.pulseResponses.push({
          id, inviteId: inv.id, caseId: c.id, coachId: c.leadCoachId, occasion, language,
          answers: { q1, q2, q3, q4, q5: "nej" }, text: "", contactRequested: false, submittedAt: inv.usedAt,
        });
      }
    }
  }
  // Kontaktönskemål och lågt betyg på fråga 3 (senaste veckorna)
  const recentResp = S.pulseResponses.filter((x) => x.submittedAt >= "2027-01-18").slice(0, 5);
  recentResp.slice(0, 3).forEach((x, i) => { x.answers.q5 = "ja"; x.contactRequested = true; x.text = ["Jag vill prata om min praktik.", "", "Kan någon ringa mig om schemat?"][i]; });
  const low = recentResp[3] || S.pulseResponses[S.pulseResponses.length - 1];
  if (low) { low.answers.q3 = 2; low.text = "Jag får inte svar när jag ringer."; }
  // Deltagarens egen länk i demot (Nadia, förhandsvisas som periodisk pulsmätning)
  S.pulseInvites.push({ id: "pi-demo", caseId: g.script.nadia.id, channel: "sms", language: "sv", occasion: "periodic", sentAt: "2027-02-01T08:00", expiresAt: "2027-02-08T08:00", usedAt: null, demo: true });
}

export function genInbox(g: Gen) {
  const { r, S, cases, script } = g;
  const lastNo = () => { S.caseCounters["c-bot:2027"]++; return `BOT-27-${String(S.caseCounters["c-bot:2027"]).padStart(4, "0")}`; };
  type Extra = { buyerReference?: string | null; desiredStart?: string; secondaryArea?: string; background?: string };
  const mkInboxCase = (tag: string, refAt: string, referrerId: string, area: string, track: string, weeks: number, source: PCase["source"], personOver: PersonOverride, extra: Extra = {}): PCase => {
    const number = lastNo();
    const p = g.makePerson(personOver);
    const c: PCase = {
      id: `case-${number.slice(4).replace("-", "")}`, number, contractId: "c-bot", personId: p.id, status: "acknowledged", source, referredAt: refAt, referrerId,
      buyerReference: extra.buyerReference !== undefined ? extra.buyerReference : g.brFor(referrerId), purchaseOrderNumber: null, primaryArea: area, secondaryArea: extra.secondaryArea || null,
      vocationalTrack: track, desiredStart: extra.desiredStart || addDays(refAt.slice(0, 10), 7), plannedWeeks: weeks, plannedEnd: null, acknowledgedAt: addMinutes(refAt, 2),
      confirmedAt: null, firstMeetingAt: null, startDate: null, endDate: null, endReason: null, resultClass: null, resultVerifiedAt: null, phase: 1, leadCoachId: null, team: [],
      backgroundInfo: extra.background || BACKGROUND[area], aiConsent: "not_asked", meetingDay: null, meetingTime: null, location: "Alby", pausedWeeks: [], tags: [tag], orderValueWeeks: weeks, declineReason: null,
      closedAt: null,
    };
    cases.push(c);
    script[tag] = c;
    S.caseStatusHistory.push({ id: g.nid("csh"), caseId: c.id, fromStatus: null, toStatus: "acknowledged", changedBy: "system", changedAt: c.acknowledgedAt, reason: "Ordererkännande skickat automatiskt" });
    return c;
  };
  const cLinda = mkInboxCase("inkorg-brattom", "2027-01-29T10:05", "k-linda", "G", "Lagerarbetare – plock och pack", 8, "email", { firstName: "Tesfaye", lastName: "Haile", language: "tigrinja", city: "Fittja", preferredContact: "sms" }, { desiredStart: "2027-02-08" });
  const cAhmed = mkInboxCase("inkorg-fritext", "2027-01-29T15:20", "k-ahmed", "D", "Restaurangbiträde", 6, "email", { firstName: "Rasha", lastName: "Khalaf", language: "arabiska", city: "Tumba", preferredContact: "phone" }, { buyerReference: null, desiredStart: "2027-02-08" });
  const cMaria = mkInboxCase("inkorg-mall", "2027-02-01T08:41", "k-maria", "J", "Butikssäljare", 10, "email", { firstName: "Diego", lastName: "Morales", language: "spanska", city: "Alby", preferredContact: "email" }, { desiredStart: "2027-02-15", secondaryArea: "H" });
  const templateExtract = (c: PCase, conf = 0.99) => {
    const p = g.personOf(c);
    const k = g.customerUser(c.referrerId);
    const ex: OrderExtract = {
      referrerName: k.name, referrerUnit: k.unit, referrerPhone: k.phone, referrerEmail: k.email, buyerReference: c.buyerReference || "",
      desiredStart: c.desiredStart, plannedEnd: addDays(c.desiredStart, c.plannedWeeks * 7 - 3), plannedWeeks: c.plannedWeeks, firstName: p.firstName, lastName: p.lastName,
      pnr: p.pnr, phone: p.phone, email: p.email, city: p.city, preferredContact: p.preferredContact, protectedIdentity: false, accessibilityNeeds: p.accessibilityNeeds || "",
      primaryArea: c.primaryArea, secondaryArea: c.secondaryArea || "", vocationalTrack: c.vocationalTrack, background: c.backgroundInfo,
    };
    const confidence: Partial<Record<OrderField, number>> = {};
    for (const kk of Object.keys(ex) as OrderField[]) confidence[kk] = conf;
    return { ex, confidence };
  };
  const t1 = templateExtract(cMaria);
  S.inboundEmails.push({ id: "em-101", graphMessageId: "AAMk-demo-101", receivedAt: cMaria.referredAt, fromAddress: "maria.ekdahl@botkyrka.se", fromName: "Maria Ekdahl",
    subject: "Avrop – yrkesinriktad insats, handel", bodyText: "Hej!\n\nHär kommer ett avrop enligt bifogad mall.\n\nMed vänlig hälsning\nMaria Ekdahl\nHandläggare, Arbetsmarknadsenheten Alby\nBotkyrka kommun",
    attachments: [{ name: "Avropsmall_01_ifylld.docx", kind: "docx" }], parseMethod: "template", classification: "order", extracted: t1.ex, confidence: t1.confidence, missingFields: [],
    status: "acknowledged", caseId: cMaria.id, ackSentAt: addMinutes(cMaria.referredAt, 2), handledBy: null, handledAt: null });
  const t2 = templateExtract(cLinda);
  S.inboundEmails.push({ id: "em-106", graphMessageId: "AAMk-demo-106", receivedAt: cLinda.referredAt, fromAddress: "linda.karlsson@botkyrka.se", fromName: "Linda Karlsson",
    subject: "Beställning lager/logistik", bodyText: "Hej,\nBifogar avrop för en deltagare som vill arbeta inom lager.\n\n/Linda Karlsson\nArbetsmarknadsenheten Hallunda–Fittja",
    attachments: [{ name: "Avropsmall_01.docx", kind: "docx" }], parseMethod: "template", classification: "order", extracted: t2.ex, confidence: t2.confidence, missingFields: [],
    status: "acknowledged", caseId: cLinda.id, ackSentAt: addMinutes(cLinda.referredAt, 2), handledBy: null, handledAt: null });
  const t3 = templateExtract(cAhmed, 0.9);
  // Fritext: AI får bara föra över det som står i mejlet – resten lämnas tomt ("Framgår inte")
  const ex3 = t3.ex as Record<string, unknown>;
  for (const k0 of ["city", "vocationalTrack", "preferredContact", "secondaryArea", "email", "accessibilityNeeds"] as OrderField[]) { ex3[k0] = ""; t3.confidence[k0] = 0; }
  t3.ex.background = "Har jobbat i kök i Syrien. Vill börja så snart som möjligt."; t3.confidence.background = 0.86;
  t3.ex.preferredContact = "phone"; t3.confidence.preferredContact = 0.81; t3.ex.desiredStart = "2027-02-08"; t3.confidence.desiredStart = 0.7;
  t3.ex.buyerReference = ""; t3.confidence.buyerReference = 0; t3.ex.primaryArea = "D"; t3.confidence.primaryArea = 0.72; t3.ex.secondaryArea = ""; t3.ex.plannedWeeks = 6; t3.confidence.plannedWeeks = 0.64;
  const pAhmed = g.personOf(cAhmed);
  t3.ex.pnr = pAhmed.pnr; t3.confidence.pnr = 0.97; t3.ex.email = ""; t3.confidence.email = 0; t3.ex.accessibilityNeeds = ""; t3.ex.plannedEnd = ""; t3.confidence.plannedEnd = 0;
  S.inboundEmails.push({ id: "em-102", graphMessageId: "AAMk-demo-102", receivedAt: cAhmed.referredAt, fromAddress: "ahmed.yusuf@botkyrka.se", fromName: "Ahmed Yusuf",
    subject: "Ny deltagare till er – kök", bodyText: `Hej!\n\nJag skulle vilja anvisa ${pAhmed.firstName} ${pAhmed.lastName} (${pAhmed.pnr}) till en insats inom kök och restaurang, ungefär sex veckor. Hon har jobbat i kök i Syrien och vill gärna börja så snart som möjligt, helst v. 6. Hon nås på ${pAhmed.phone}, bäst att ringa.\n\nMvh Ahmed Yusuf\nHandläggare, Arbetsmarknadsenheten Tumba\n${g.customerUser("k-ahmed").phone}`,
    attachments: [], parseMethod: "ai", classification: "order", extracted: t3.ex, confidence: t3.confidence, missingFields: ["buyerReference", "plannedEnd"],
    status: "acknowledged", caseId: cAhmed.id, ackSentAt: addMinutes(cAhmed.referredAt, 3), handledBy: null, handledAt: null, aiRunId: "ai-run-mail-102" });
  S.aiRuns.push({ id: "ai-run-mail-102", caseId: cAhmed.id, kind: "parse_email", provider: "Berget AI (test)", model: "öppen språkmodell", status: "succeeded", createdAt: addMinutes(cAhmed.referredAt, 1), costOre: 3, latencyMs: 6200 });
  S.inboundEmails.push({ id: "em-103", graphMessageId: "AAMk-demo-103", receivedAt: "2027-02-01T08:02", fromAddress: "ahmed.yusuf@botkyrka.se", fromName: "Ahmed Yusuf",
    subject: `SV: Vi har tagit emot er beställning – ${cAhmed.number}`, bodyText: "Hej,\nBeställarreferens: 55102938\nPlanerat slutdatum: 19 mars.\n\n/Ahmed",
    attachments: [], parseMethod: "ai", classification: "supplement", extracted: { buyerReference: "55102938", plannedEnd: "2027-03-19" }, confidence: { buyerReference: 0.98, plannedEnd: 0.9 }, missingFields: [],
    status: "linked", caseId: cAhmed.id, linkedBy: "ärendenummer i ämnesraden", ackSentAt: null, handledBy: null, handledAt: null });
  S.inboundEmails.push({ id: "em-104", graphMessageId: "AAMk-demo-104", receivedAt: "2027-02-01T07:55", fromAddress: "omar.farah@botkyrka.se", fromName: "Omar Farah",
    subject: "Avrop – skyddade personuppgifter", bodyText: `Hej,\nJag behöver anvisa en person med skyddade personuppgifter. Ring mig på ${g.customerUser("k-omar").phone} så tar vi uppgifterna enligt rutinen.\n\n/Omar Farah`,
    attachments: [], parseMethod: "manual", classification: "order_protected", extracted: {}, confidence: {}, missingFields: [], status: "protected", caseId: null,
    ackSentAt: "2027-02-01T07:57", ackKind: "generic", handledBy: null, handledAt: null });
  S.inboundEmails.push({ id: "em-105", graphMessageId: "AAMk-demo-105", receivedAt: "2027-02-01T08:20", fromAddress: "maria.ekdahl@botkyrka.se", fromName: "Maria Ekdahl",
    subject: `Fråga om schema ${script.nadia.number}`, bodyText: `Hej! Gäller ${script.nadia.number}. Vilka dagar är praktiken den här veckan? Jag vill boka ett uppföljningsmöte.\n/Maria`,
    attachments: [], parseMethod: "ai", classification: "other", extracted: {}, confidence: {}, missingFields: [], status: "other", caseId: script.nadia.id, linkedBy: "ärendenummer i texten", ackSentAt: null, handledBy: null, handledAt: null });
  // Hanterade mejl de senaste två veckorna (historik)
  for (const c of cases.filter((x) => x.source === "email" && x.referredAt >= "2027-01-18" && x.confirmedAt && !x.tags.some((t) => t.startsWith("inkorg")))) {
    const t = templateExtract(c);
    const k = g.customerUser(c.referrerId);
    const id = g.nid("em");
    const parseMethod = r.chance(0.8) ? "template" as const : "ai" as const;
    S.inboundEmails.push({ id, graphMessageId: `AAMk-${c.id}`, receivedAt: c.referredAt, fromAddress: k.email, fromName: k.name, subject: "Avrop enligt mall",
      bodyText: "Hej!\nSe bifogat avrop.\n/" + k.name, attachments: [{ name: "Avropsmall_01.docx", kind: "docx" }], parseMethod, classification: "order",
      extracted: t.ex, confidence: t.confidence, missingFields: [], status: "accepted", caseId: c.id, ackSentAt: c.acknowledgedAt, handledBy: "u-sara", handledAt: c.confirmedAt });
  }
  return { cLinda, cAhmed, cMaria };
}

export function genRest(g: Gen, inbox: { cLinda: PCase; cAhmed: PCase; cMaria: PCase }) {
  const { S, cases, script } = g;
  const { cLinda, cAhmed, cMaria } = inbox;
  const nadia = script.nadia;
  const yusuf = script.yusuf;
  // ---- Meddelanden
  S.messages.push(
    { id: "msg-1", caseId: nadia.id, senderId: "k-maria", body: "Hej! Hur går praktiken? Behöver hon stöd med resorna till Hallunda?", createdAt: "2027-01-27T09:14", readBy: ["u-amira"], readAt: "2027-01-27T10:02" },
    { id: "msg-2", caseId: nadia.id, senderId: "u-amira", body: "Hej Maria! Det går bra. Hon tar bussen själv sedan i måndags. Jag återkommer efter uppföljningen med handledaren på torsdag.", createdAt: "2027-01-27T10:10", readBy: ["k-maria"], readAt: "2027-01-27T13:40" },
    { id: "msg-3", caseId: nadia.id, senderId: "k-maria", body: "Tack! Kan vi ses på ett uppföljningsmöte vecka 6? Jag kan tisdag eller torsdag förmiddag.", createdAt: "2027-02-01T08:15", readBy: [], readAt: null },
    { id: "msg-4", caseId: yusuf.id, senderId: "u-amira", body: "Hej Maria. Deltagaren har varit borta utan att meddela två gånger inom 14 dagar. Jag föreslår ett uppföljningsmöte för att gå igenom planen. Förslag på tider: onsdag 3/2 kl. 10 eller torsdag 4/2 kl. 14.", createdAt: "2027-01-28T11:30", readBy: ["k-maria"], readAt: "2027-01-28T12:05" },
    { id: "msg-5", caseId: yusuf.id, senderId: "k-maria", body: "Onsdag kl. 10 passar. Jag kommer till Alby.", createdAt: "2027-01-29T08:50", readBy: ["u-amira"], readAt: "2027-01-29T09:30" },
    { id: "msg-6", caseId: script.reffel1.id, senderId: "u-johan", body: "Hej Ahmed. Decemberfakturan returnerades eftersom beställarreferensen 55102983 inte finns hos er. Kan du bekräfta rätt referens?", createdAt: "2027-01-13T10:00", readBy: ["k-ahmed"], readAt: "2027-01-13T11:00" },
    { id: "msg-7", caseId: script.reffel1.id, senderId: "k-ahmed", body: "Förlåt, siffrorna blev omkastade. Rätt referens är 55102938. Den gäller båda mina ärenden från november.", createdAt: "2027-01-14T08:40", readBy: ["u-johan"], readAt: "2027-01-14T09:00" },
  );

  // ---- Fakturastatus för tidigare månader (en faktura per ärende och månad)
  S.billingRuns.push(
    { id: "br-2026-09", month: "2026-09", status: "closed", createdBy: "u-lars", createdAt: "2026-10-02T09:00" },
    { id: "br-2026-10", month: "2026-10", status: "closed", createdBy: "u-lars", createdAt: "2026-11-03T09:00" },
    { id: "br-2026-11", month: "2026-11", status: "closed", createdBy: "u-lars", createdAt: "2026-12-02T09:00" },
    { id: "br-2026-12", month: "2026-12", status: "closed", createdBy: "u-lars", createdAt: "2027-01-05T09:00" },
    { id: "br-2027-01", month: "2027-01", status: "draft", createdBy: "system", createdAt: "2027-02-01T06:00" },
  );
  S.invoiceStatus = { "2026-09": { default: "paid" }, "2026-10": { default: "paid" }, "2026-11": { default: "paid" }, "2026-12": { default: "sent" }, "2027-01": { default: "draft" } };
  S.invoiceStatus["2026-12"][script.reffel1.id] = "returned";
  S.invoiceStatus["2026-12"][script.reffel2.id] = "returned";
  S.invoiceStatus["2026-11"][script.reffel1.id] = "paid"; // november gick igenom manuellt via fakturaportalen

  // ---- Revisionslogg (urval, senaste dygnen) – bara id:n, inga personuppgifter
  const A = (at: string, actor: string, action: string, entity: string, entityId: string, details: Record<string, unknown> = {}) =>
    S.auditLog.push({ id: g.nid("log"), occurredAt: at, actorId: actor, action, entity, entityId, contractId: "c-bot", details });
  A("2027-01-29T10:05", "system", "email.received", "inbound_email", "em-106", { parseMethod: "template" });
  A("2027-01-29T10:07", "system", "case.created", "case", cLinda.id, { number: cLinda.number, source: "email" });
  A("2027-01-29T10:07", "system", "notify.email", "case", cLinda.id, { template: "ordererkannande", to: "handläggare" });
  A("2027-01-29T15:20", "system", "email.received", "inbound_email", "em-102", { parseMethod: "ai" });
  A("2027-01-29T15:21", "system", "ai.run", "ai_run", "ai-run-mail-102", { kind: "parse_email", provider: "Berget AI (test)" });
  A("2027-01-29T15:23", "system", "case.created", "case", cAhmed.id, { number: cAhmed.number, source: "email", missing: ["beställarreferens"] });
  A("2027-01-29T14:02", "system", "ai.run", "ai_run", "ai-run-mehmet", { kind: "transcribe_extract", audioDeleted: true });
  A("2027-01-29T14:01", "system", "audio.deleted", "ai_run", "ai-run-mehmet", { reason: "Transkribering klar" });
  A("2027-01-29T16:10", "u-karin", "report.view", "report", "customer_summary-2026-12", {});
  A("2027-02-01T06:00", "system", "kpi.computed", "contract", "c-bot", { kpi: "resultatgrad", window: "rolling_6m" });
  A("2027-02-01T07:00", "system", "report.published", "report", "weekly-W04", { count: 2, waiting: 1 });
  A("2027-02-01T07:55", "system", "email.received", "inbound_email", "em-104", { classification: "skyddade personuppgifter" });
  A("2027-02-01T07:57", "system", "notify.email", "inbound_email", "em-104", { template: "generisk_mottagningsbekraftelse" });
  A("2027-02-01T08:02", "system", "email.linked", "inbound_email", "em-103", { caseId: cAhmed.id, via: "ärendenummer i ämnesraden" });
  A("2027-02-01T08:15", "k-maria", "message.sent", "case", nadia.id, {});
  A("2027-02-01T08:41", "system", "email.received", "inbound_email", "em-101", { parseMethod: "template" });
  A("2027-02-01T08:43", "system", "case.created", "case", cMaria.id, { number: cMaria.number, source: "email" });
  A("2027-02-01T08:43", "system", "notify.email", "case", cMaria.id, { template: "ordererkannande", to: "handläggare" });
  A("2027-02-01T08:50", "u-sara", "case.view", "case", nadia.id, {});
  A("2027-02-01T09:05", "u-lars", "billing.view", "billing_run", "br-2027-01", {});

  // ---- Utskick (e-post/SMS) – innehåller aldrig personuppgifter
  const N = (at: string, channel: OutboundChannel, to: string, template: string, body: string, caseId: string | null) => {
    const n: PNotification = { id: g.nid("ntf"), at, channel, to, template, body, caseId };
    S.notifications.push(n);
  };
  N("2027-01-29T10:07", "email", "linda.karlsson@botkyrka.se", "ordererkannande", `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${cLinda.number}. Ni får besked om startdatum och ansvarig coach senast måndag 1 februari 2027 klockan 10.05. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`, cLinda.id);
  N("2027-01-29T15:23", "email", "ahmed.yusuf@botkyrka.se", "ordererkannande", `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${cAhmed.number}. Ni får besked om startdatum och ansvarig coach senast måndag 1 februari 2027 klockan 15.20.\n\nVi saknar följande uppgifter. Svara på det här mejlet med:\n• Beställarreferens (8–10 siffror)\n• Planerat slutdatum\n\nAnvänd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`, cAhmed.id);
  N("2027-02-01T07:57", "email", "omar.farah@botkyrka.se", "generisk_mottagningsbekraftelse", "Tack för ditt mejl. Vi har tagit emot det och ringer dig i dag.", null);
  N("2027-02-01T08:43", "email", "maria.ekdahl@botkyrka.se", "ordererkannande", `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${cMaria.number}. Ni får besked om startdatum och ansvarig coach senast tisdag 2 februari 2027 klockan 08.41. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`, cMaria.id);
  N("2027-01-31T18:00", "sms", "070-*** ** 12", "motespaminnelse", "Påminnelse: möte i morgon klockan 10.00 hos Miljonbemanning i Alby. Frågor? Ring 08-000 00 00.", nadia.id);
  N("2027-02-01T08:00", "sms", "070-*** ** 12", "pulslank", "Hej! Hur går det hos oss? Svara på fem korta frågor: portal.miljonbemanning.se/p/••••• Länken gäller i 7 dagar. Det är frivilligt att svara.", nadia.id);
  N("2027-01-29T14:00", "email", "maria.ekdahl@botkyrka.se", "nytt_meddelande", `Du har ett nytt meddelande om ärende ${yusuf.number} – logga in för att läsa.`, yusuf.id);
  N("2027-02-01T07:00", "email", "ahmed.yusuf@botkyrka.se", "ny_rapport", "Veckorapporten för vecka 4 finns i portalen – logga in för att läsa.", null);

  // ---- Notiser i appen (tilldelning) – lagras per mottagare. Påminnelser och eskaleringar räknas fram av regler.
  const TEAM_TEXT: Record<Exclude<TeamRole, "lead_coach">, string> = { vocational_supervisor: "yrkesspecifik handledare", employer_matcher: "arbetsgivarmatchare", guidance_counselor: "SYV/metodstöd" };
  for (const c of cases.filter((x) => x.confirmedAt && x.confirmedAt >= "2027-01-11" && x.confirmedAt < NOW)) {
    for (const t of c.team) {
      const lead = t.role === "lead_coach";
      const areaName = (AREAS.find((a) => a[0] === c.primaryArea) as (typeof AREAS)[number])[1];
      S.userNotifications.push({
        id: g.nid("un"), recipientId: t.userId, kind: "assignment", caseId: c.id, createdAt: c.confirmedAt as string, channels: ["app", "email"],
        title: lead ? "Nytt ärende tilldelat dig" : "Du har lagts till i ett team",
        body: lead ? `Du är huvudcoach för ${c.number} (${areaName}). Första möte ${c.firstMeetingAt ? fmtDateTime(c.firstMeetingAt) : "är inte bokat"}.` : `Du är ${TEAM_TEXT[t.role as Exclude<TeamRole, "lead_coach">]} för ${c.number}.`,
        emailBody: `Du har fått ett nytt ärende i Miljonmatch: ${c.number}. Logga in för att se detaljerna.`,
      });
    }
  }
  for (const n of S.userNotifications) if (n.createdAt < "2027-01-29") { S.notifRead[n.recipientId] = S.notifRead[n.recipientId] || {}; S.notifRead[n.recipientId][n.id] = n.createdAt; }

  // Uppgift till ekonom (ekonomen ser inte meddelanden – avtalsansvarig vidarebefordrar referensen som uppgift)
  S.tasks.push({ id: "task-1", toRole: "ekonom", fromId: "u-johan", createdAt: "2027-01-14T09:05", status: "open", caseIds: [script.reffel1.id, script.reffel2.id],
    text: `Kommunen har bekräftat rätt beställarreferens 55102938 för ${script.reffel1.number} och ${script.reffel2.number}. Decemberfakturorna ska krediteras och göras om, och januari faktureras med rätt referens.` });
  S.tasks.push({ id: "task-2", toRole: "avtalsansvarig", fromId: "system", createdAt: "2027-02-01T07:55", status: "open", text: "Avrop med skyddade personuppgifter från Omar Farah. Ring handläggaren enligt den säkra rutinen.", emailId: "em-104" });

  S.script = Object.fromEntries(Object.entries(script).map(([k, c]) => [k, c.id]));
  S.cases = cases;
}
