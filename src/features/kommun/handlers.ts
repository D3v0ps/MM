// Hanterare för området kommun – kommunens portal (prototypens views/kommun.js). Registreras via src/api/handlers.ts.
// Frågorna returnerar vy-modeller med bara det kommunen får se. Läsning via ctx.repo (policyn/RLS avgör vilka ärenden,
// personer, rapporter och meddelanden som syns). ctx.system används bara där det står en kommentar vid anropet.
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { hidesCommercial } from "@/api/tester-access";
import { attendanceStats, repeatedAbsence } from "@/core/attendance";
import { ackTextFor, duplicateActive, orderValueOre, priceFor } from "@/core/cases";
import { isUnset, kpiDef, progressionRuleText } from "@/core/config";
import { customerSummary } from "@/core/customer-summary";
import { domainEnv } from "@/core/env";
import { contactLabel, reportKindLabel, teamLabel } from "@/core/labels";
import { avropDue, firstMeetingDays, firstMeetingDue } from "@/core/sla";
import { MONTHS, addDays, addMonths, dayOf, diffDays, monday, monthEnd, monthKey } from "@/core/time";
import { by } from "@/core/util";
import { pnrFormatValid } from "@/core/validation";
import { TRACKS } from "@/data/seed/constants";
import type { Case, CaseStatus, Report } from "@/data/schema";
import { orgSettingsFor, upsert, userEmail } from "../_shared/context";
import { pnrSearchHash, revealPnr } from "../_shared/pnr";
import { contractInfo, loadReportDb } from "../rapporter/load";
import { reportModel, type SummaryModel } from "../rapporter/model";
import {
  kommunApproveActionPlan, kommunCase, kommunCaseList, kommunCaseSeen, kommunChef, kommunDuplicate, kommunOrderForm, kommunReceipt, kommunReports,
  kommunRevealPnr, kommunStart, kommunTaskDone, kommunTestPersonas,
  type KomActionPlan, type KomAttTile, type KomCaseDetail, type KomCaseRow, type KomChef, type KomEvent, type KomRate, type KomReportRow, type KomSummary, type KomTask, type KomThread,
} from "./api";
import { deliveredOk, komCase, komContext, komMessage, protectedFlags, reportRow, senderLabel, viewerFor, visibleCases } from "./load";
import { fD, NOTIFY_FROM, reportTitle } from "./texts";
// "Tala in" (röstinspelning): beställningens bakgrund och meddelanden.
import "./voice-handlers";
// Hämta resultat (resultatfilen till kommunens chef, rapporter steg 3).
import "./result-handlers";
// Rapporter från Miljonbemanning (delade sparade rapporter, rapporter steg 4).
import "./shared-report-handlers";

const HANDL: readonly Role[] = ["kommun_handlaggare"];
const BOTH: readonly Role[] = ["kommun_handlaggare", "kommun_chef"];
const CHEF: readonly Role[] = ["kommun_chef"];
/** Hur länge en oläst händelse (avböjd beställning, ny coach, orderbekräftelse) visas på startsidan. Gränssnittsval, inte ett avtalsvärde. */
const EVENT_DAYS = 14;
/** Avböjda beställningar syns i standardfiltret så här länge, så att handläggaren hittar orsaken. Gränssnittsval. */
const DECLINED_VISIBLE_DAYS = 30;
const OPEN_STATUSES: readonly CaseStatus[] = ["received", "acknowledged", "confirmed", "active", "paused"];
const STATUS_ORDER: Record<CaseStatus, number> = { declined: -1, received: 0, acknowledged: 1, confirmed: 2, active: 3, paused: 4, closed: 5 };

// ================================================================ Gemensamt
type CaseName = { caseNumber: string; name: string };

/** Uppgifter från Miljonbemanning till den inloggade (öppna, senaste först). */
async function openTasks(ctx: Ctx, cases: Map<string, Case>): Promise<KomTask[]> {
  const tasks = await ctx.repo.table("tasks").list({ toId: ctx.actor.userId, status: "open" });
  return tasks.sort(by("createdAt", -1)).map((t) => {
    const c = cases.get(t.caseIds[0] ?? "") ?? null;
    return { id: t.id, kind: t.kind, caseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null, text: t.text, createdAt: t.createdAt };
  });
}

/** Rapporter som levererats till den inloggade (prototypens sel.komReports). */
async function myReports(ctx: Ctx): Promise<Report[]> {
  const me = ctx.actor.userId;
  const all = await ctx.repo.table("reports").list();
  return all.filter((r) => deliveredOk(r) && r.deliveredTo.includes(me));
}

// ================================================================ kommun.start (handläggarens startsida)
handleQuery(kommunStart, { roles: HANDL }, async (ctx) => {
  const me = ctx.actor.userId;
  const now = ctx.now();
  const k = await komContext(ctx);
  const cases = await visibleCases(ctx);
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const viewer = await viewerFor(ctx, cases);
  const caseOf = (id: string | null): CaseName | null => {
    const c = id ? byCase.get(id) : undefined;
    return c ? { caseNumber: c.caseNumber, name: viewer.name(c) } : null;
  };
  const ids = cases.map((c) => c.id);
  const mine = cases.filter((c) => c.referrerId === me);
  const mineIds = mine.map((c) => c.id);
  const [tasks, history, seen, messages, reports] = await Promise.all([
    openTasks(ctx, byCase),
    mineIds.length ? ctx.repo.table("case_status_history").list({ caseId: { in: mineIds } }) : [],
    ctx.repo.table("case_seen").list({ userId: me }),
    ids.length ? ctx.repo.table("messages").list({ caseId: { in: ids } }) : [],
    myReports(ctx),
  ]);

  // Händelser i handläggarens egna beställningar som inte är lästa (prototypens sel.komEvents).
  const since = `${addDays(dayOf(now), -EVENT_DAYS)}T00:00`;
  const seenAt = new Map(seen.map((s) => [s.caseId, s.seenAt]));
  const mineSet = new Set(mineIds);
  const events: KomEvent[] = [];
  for (const c of mine) {
    if (c.status === "declined" && c.declinedAt) {
      events.push({ key: `declined:${c.id}`, kind: "declined", at: c.declinedAt, caseId: c.id, reportId: null, title: `Beställning ${c.caseNumber} kunde inte tas emot`, sub: "Miljonbemanning har avböjt beställningen. Öppna den för att läsa orsaken." });
    }
  }
  for (const h of history) {
    if (!h.fromCoach || !h.toCoach || h.fromCoach === h.toCoach) continue;
    const c = byCase.get(h.caseId);
    if (!c) continue;
    events.push({ key: `coach:${h.id}`, kind: "coach", at: h.changedAt, caseId: c.id, reportId: null, title: `Ny ansvarig coach för ${c.caseNumber}`, sub: `${k.name(h.toCoach)} har tagit över efter ${k.name(h.fromCoach)}.` });
  }
  for (const r of reports) {
    if (r.kind !== "order_confirmation" || r.openedAt || !r.caseId || !r.deliveredAt) continue;
    const c = byCase.get(r.caseId);
    if (!c || !mineSet.has(c.id)) continue;
    events.push({
      key: `oc:${r.id}`, kind: "confirmed", at: r.deliveredAt, caseId: c.id, reportId: r.id, title: `Orderbekräftelse för ${c.caseNumber}`,
      sub: `Start ${fD(c.plannedStart || c.startDate || c.desiredStart)} med ${k.name(c.leadCoachId)} som ansvarig coach.`,
    });
  }
  const visibleEvents = events.filter((e) => e.at >= since && (e.kind === "confirmed" || (seenAt.get(e.caseId) ?? "") < e.at)).sort(by("at", -1));

  // Olästa meddelanden och rapporter.
  const unreadMessages = messages
    .filter((m) => m.senderId !== me && !m.readBy.includes(me))
    .sort(by("createdAt", -1))
    .map((m) => ({ id: m.id, caseId: m.caseId, caseNumber: byCase.get(m.caseId)?.caseNumber ?? "", meeting: m.kind === "meeting_request", senderLabel: senderLabel(k, m.senderId), createdAt: m.createdAt }));
  const unreadAll = reports.filter((r) => !r.openedAt).sort(by((r: Report) => r.deliveredAt ?? "", -1));
  const unreadReports = await Promise.all(unreadAll.filter((r) => r.kind !== "order_confirmation").map((r) => reportRow(ctx, r, k, caseOf)));

  return {
    firstName: (k.me?.fullName ?? "").split(" ")[0], unit: k.me?.customerUnit ?? null, customerName: k.customerName,
    tasks, events: visibleEvents, unreadMessages, unreadReports, unreadTotal: unreadAll.length + unreadMessages.length,
    active: cases.filter((c) => c.status === "active" || c.status === "paused").length,
    waiting: cases.filter((c) => c.status === "received" || c.status === "acknowledged" || c.status === "confirmed").length,
  };
});

// ================================================================ kommun.bestallning (formulärets förval och avtalets regler)
handleQuery(kommunOrderForm, { roles: HANDL }, async (ctx) => {
  const me = ctx.actor.userId;
  const now = ctx.now();
  const today = dayOf(now);
  const k = await komContext(ctx);
  const contract = k.active;
  if (!contract) throw new Error("Det finns inget aktivt avtal att beställa i");
  const cfg = k.cfg(contract.id);
  // Begränsade testare (testmiljön): prisartiklarna läses inte och lämnas inte ut.
  const hide = hidesCommercial(ctx.actor);
  const [cases, refs, prices] = await Promise.all([
    visibleCases(ctx),
    ctx.repo.table("buyer_references").list({ customerId: contract.customerId }),
    hide ? Promise.resolve(null) : ctx.repo.table("price_items").list({ contractId: contract.id }),
  ]);
  // Senast använda beställarreferens, annars handläggarens sparade (prototypens sel.komLastBuyerRef).
  const last = cases.filter((c) => c.referrerId === me && c.buyerReference).sort(by("referredAt", -1))[0];
  const saved = k.me?.buyerReferenceId ? refs.find((b) => b.id === k.me?.buyerReferenceId) : undefined;
  const days = firstMeetingDays(cfg);
  const areas = k.areas.filter((a) => a.contractId === contract.id && a.active).sort(by("code"));
  return {
    customerName: k.customerName, today, defaultStart: addDays(monday(today), 14),
    me: { name: k.me?.fullName ?? "", unit: k.me?.customerUnit ?? "", phone: k.me?.phone ?? "", email: k.me?.email ?? "" },
    lastBuyerRef: last?.buyerReference ?? saved?.reference ?? "",
    buyerReference: { required: cfg.billing.buyerReference.required, pattern: cfg.billing.buyerReference.pattern },
    blockedRefs: refs.filter((b) => !b.active).map((b) => b.reference),
    weeks: { min: cfg.orderWeeks?.min || 4, max: cfg.orderWeeks?.max || 10 },
    firstMeetingWithin: days === 7 ? "en vecka" : days ? `${days} dagar` : "kort tid",
    areas: areas.map((a) => ({ code: a.code, name: a.name })),
    // Förslagen på yrkesspår är exempel ur testdatat (prototypens seedConstants.TRACKS).
    tracks: Object.fromEntries(areas.map((a) => [a.code, [...(TRACKS[a.code] ?? [])]])),
    ...(prices ? { prices: prices.map((p) => ({ areaCode: p.areaCode, validFrom: p.validFrom, validTo: p.validTo, priceOre: p.priceOre })) } : {}),
    answerDue: avropDue({ referredAt: now }, cfg),
  };
});

// ================================================================ kommun.dubblett
handleQuery(kommunDuplicate, { roles: HANDL }, async (ctx, p) => {
  if (!pnrFormatValid(p.pnr)) return [];
  const hash = pnrSearchHash(ctx.crypto, p.pnr);
  if (!hash) return [];
  // ctx.system: dubblettkontrollen ska se alla pågående insatser i avtalen, även sådana handläggaren inte får se (samma
  // kontroll som arenden.caseCreate). Bara sökhashen jämförs. För andras insatser lämnas bara ut att en insats finns.
  const persons = await ctx.system.table("persons").list({ personnummerHash: hash });
  if (!persons.length) return [];
  const cases = (await ctx.system.table("cases").list({ personId: { in: persons.map((x) => x.id) }, status: { in: OPEN_STATUSES } })).filter((c) =>
    ctx.actor.contractIds.includes(c.contractId),
  );
  const dups = duplicateActive({ persons, cases }, hash);
  if (!dups.length) return [];
  const viewer = await viewerFor(ctx, dups);
  return dups.map((c) => (viewer.access(c) !== "none" ? { caseId: c.id, caseNumber: c.caseNumber, status: c.status } : { caseId: null, caseNumber: null, status: null }));
});

// ================================================================ kommun.kvitto (efter skickad beställning)
handleQuery(kommunReceipt, { roles: HANDL }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c || c.referrerId !== ctx.actor.userId) return null;
  const k = await komContext(ctx);
  const cfg = k.cfg(c.contractId);
  const person = await ctx.repo.table("persons").get(c.personId);
  const prot = !!person?.protectedIdentity;
  const email = k.me?.email ?? "";
  // ctx.system: mejlet som just skickades till handläggaren själv (ordererkännandet eller den generiska bekräftelsen).
  // Bara utskick till hennes egen adress läses. Utskicksloggen är annars bara för Miljonbemanning.
  const sent = email ? await ctx.system.table("outbound_messages").list({ to: email }, { orderBy: "createdAt" }) : [];
  const mail = sent.filter((n) => (n.caseId === c.id && n.template === "ordererkannande") || (prot && n.template === "generisk_mottagningsbekraftelse" && n.createdAt >= c.referredAt)).pop();
  return {
    caseId: c.id, caseNumber: c.caseNumber, protectedIdentity: prot, referredAt: c.referredAt, avropDue: avropDue(c, cfg),
    firstMeetingDue: firstMeetingDue(c, cfg),
    ackText: prot ? null : ackTextFor(c, cfg),
    mail: mail ? { from: NOTIFY_FROM, to: mail.to, at: mail.createdAt, body: mail.body } : null,
    contactLabel: prot || !person ? null : contactLabel(person.preferredContact),
  };
});

// ================================================================ kommun.deltagareLista
handleQuery(kommunCaseList, { roles: BOTH }, async (ctx) => {
  const me = ctx.actor.userId;
  const today = dayOf(ctx.now());
  const k = await komContext(ctx);
  const cases = await visibleCases(ctx);
  const [viewer, prot, messages] = await Promise.all([
    viewerFor(ctx, cases),
    protectedFlags(ctx, cases),
    !k.chef && cases.length ? ctx.repo.table("messages").list({ caseId: { in: cases.map((c) => c.id) } }) : [],
  ]);
  const unread = new Map<string, number>();
  for (const m of messages) if (m.senderId !== me && !m.readBy.includes(me)) unread.set(m.caseId, (unread.get(m.caseId) ?? 0) + 1);
  const rows: KomCaseRow[] = cases.map((c) => ({
    ...komCase(c, viewer, k, prot.has(c.personId)),
    unread: unread.get(c.id) ?? 0,
    recentlyDeclined: c.status === "declined" && !!c.declinedAt && diffDays(c.declinedAt.slice(0, 10), today) <= DECLINED_VISIBLE_DAYS,
  }));
  rows.sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.referredAt < b.referredAt ? 1 : -1));
  const cfg = k.active ? k.cfg(k.active.id) : null;
  return {
    chef: k.chef, customerName: k.customerName, unit: k.me?.customerUnit ?? null, phaseCount: cfg?.phases.length ?? 0,
    scopeUnset: !!cfg && isUnset(cfg.customerVisibility.scope), rows,
  };
});

// ================================================================ kommun.deltagare (deltagarens sida)
handleQuery(kommunCase, { roles: BOTH }, async (ctx, p) => {
  const me = ctx.actor.userId;
  const now = ctx.now();
  const today = dayOf(now);
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) {
    // ctx.system: bara om ärendet finns i användarens avtal – så att skärmen kan säga "Du har inte tillgång" i stället för
    // "hittades inte" (som prototypen). Inga uppgifter om ärendet lämnas ut.
    const exists = await ctx.system.table("cases").get(p.caseId);
    return exists && ctx.actor.contractIds.includes(exists.contractId) ? { kind: "denied" as const } : { kind: "not_found" as const };
  }
  const k = await komContext(ctx);
  const cfg = k.cfg(c.contractId);
  const viewer = await viewerFor(ctx, [c]);
  const access = viewer.access(c);
  const restricted = access === "restricted";
  const person = restricted ? null : await ctx.repo.table("persons").get(c.personId);
  const kc = komCase(c, viewer, k, !!person?.protectedIdentity);
  const db = await loadDb(ctx.repo, ["activities", "attendance", "messages", "case_status_history", "case_team", "outcome_events", "price_items", "reports", "case_seen"], {
    activities: { caseId: c.id }, attendance: { caseId: c.id }, messages: { caseId: c.id }, case_status_history: { caseId: c.id }, case_team: { caseId: c.id },
    outcome_events: { caseId: c.id }, price_items: { contractId: c.contractId }, reports: { caseId: c.id }, case_seen: { userId: me, caseId: c.id },
  });
  const byCase = new Map([[c.id, c]]);
  const env = { now, cfg };

  // Meddelanden (kommunens chef läser inga meddelanden om deltagare med skyddade personuppgifter – policyn ger inga rader).
  const msgs = db.messages.slice().sort(by("createdAt")).map((m) => komMessage(k, m));
  // Rapporter: levererade till läsaren (kommunens chef: enhetens individrapporter om avtalet säger det – policyn).
  const reps = db.reports.filter((r) => deliveredOk(r) && (k.chef ? cfg.customerVisibility.seesIndividualReports : r.deliveredTo.includes(me)));
  const caseOf = (id: string | null): CaseName | null => (id === c.id ? { caseNumber: c.caseNumber, name: viewer.name(c) } : null);
  const reportRows: KomReportRow[] = await Promise.all(reps.map((r) => reportRow(ctx, r, k, caseOf)));
  reportRows.sort((a, b) => (!a.openedAt && !k.chef ? 0 : 1) - (!b.openedAt && !k.chef ? 0 : 1) || ((a.deliveredAt ?? "") < (b.deliveredAt ?? "") ? 1 : -1));

  // Byte av huvudcoach och händelser som handläggaren inte har sett.
  const coachChanges = db.case_status_history
    .filter((h) => h.fromCoach && h.toCoach && h.fromCoach !== h.toCoach)
    .sort(by("changedAt"))
    .map((h) => ({ at: h.changedAt, fromName: k.name(h.fromCoach), toName: k.name(h.toCoach) }));
  let unseenEvents = 0;
  if (!k.chef && c.referrerId === me) {
    const since = `${addDays(today, -EVENT_DAYS)}T00:00`;
    const seen = db.case_seen[0]?.seenAt ?? "";
    const ats = [...(c.status === "declined" && c.declinedAt ? [c.declinedAt] : []), ...coachChanges.map((x) => x.at)];
    unseenEvents = ats.filter((at) => at >= since && seen < at).length;
  }

  // Orderbekräftelsen
  const hideMoney = hidesCommercial(ctx.actor);
  const weeks = c.orderValueWeeks || c.plannedWeeks;
  const priceOre = c.primaryAreaCode ? priceFor(db.price_items, c.primaryAreaCode, c.startDate || c.plannedStart || today, c.contractId) : 0;
  const oc = reps.find((r) => r.kind === "order_confirmation");

  // Närvaro de två senaste månaderna (när insatsen har startat).
  let attendance: KomCaseDetail["attendance"] = null;
  if (c.startDate && c.startDate <= today) {
    if (restricted) attendance = { restricted: true };
    else {
      const mk = monthKey(today);
      const prevMk = addMonths(mk, -1);
      const tile = (label: string, from: string, to: string): KomAttTile => {
        const s = attendanceStats(db, c.id, from, to, env);
        return { label, planned: s.planned, present: s.present, late: s.late, absentValid: s.absentValid, absentInvalid: s.absentInvalid, unregistered: s.unregistered, rate: s.rate };
      };
      const ra = c.status === "active" ? repeatedAbsence(db, c.id, env) : null;
      attendance = {
        restricted: false,
        month: tile(`${MONTHS[Number(mk.slice(5)) - 1]} hittills`, `${mk}-01`, today),
        prev: tile(MONTHS[Number(prevMk.slice(5)) - 1], `${prevMk}-01`, monthEnd(prevMk)),
        repeated: ra ? { count: ra.length, withinDays: cfg.attendance.repeatedAbsenceRule.withinDays } : null,
      };
    }
  }

  // Deltagaren: maskerat personnummer (hela numret bara via kommun.visaPersonnummer, som loggas).
  let participant: KomCaseDetail["participant"] = null;
  if (!restricted && person) {
    const pnr = revealPnr(ctx.crypto, person);
    const masked = pnr ? `${pnr.slice(0, pnr.length - 4).replace(/\d/g, "•")}${person.personnummerLast4}` : person.personnummerLast4 ? `••••••••-${person.personnummerLast4}` : null;
    participant = {
      pnrMasked: masked, canReveal: access === "customer" && !!masked, contactLabel: person.protectedIdentity ? null : contactLabel(person.preferredContact),
      city: person.city, accessibilityNeeds: person.accessibilityNeeds,
    };
  }

  return {
    kind: "ok",
    chef: k.chef, today, customerName: k.customerName, phaseCount: cfg.phases.length, case: kc,
    unreadReports: k.chef ? 0 : reportRows.filter((r) => !r.openedAt).length,
    unseenEvents,
    tasks: k.chef ? [] : (await openTasks(ctx, byCase)).filter((t) => t.caseId === c.id),
    messages: restricted ? null : msgs,
    canWrite: ctx.actor.role === "kommun_handlaggare" && c.referrerId === me,
    coachChanges,
    order: {
      coachName: c.leadCoachId ? k.name(c.leadCoachId) : null, weeks,
      // Begränsade testare (testmiljön): pris och värde lämnas inte ut.
      ...(hideMoney ? {} : { priceOre, valueOre: orderValueOre(c, db.price_items, { now }) }),
      buyerReference: c.buyerReference,
      team: db.case_team.filter((t) => t.role !== "lead_coach").map((t) => ({ name: k.name(t.userId), roleLabel: teamLabel(t.role) })),
      ocReportId: oc?.id ?? null, ackText: c.acknowledgedAt ? ackTextFor(c, cfg) : null,
    },
    attendance, participant,
    bonus: !hideMoney && db.outcome_events.some((e) => e.possibleBonus),
    seesCoachNotes: cfg.customerVisibility.seesCoachNotes,
    reports: reportRows,
  } satisfies KomCaseDetail;
});

// ================================================================ kommun.rapporter
handleQuery(kommunReports, { roles: BOTH }, async (ctx) => {
  const me = ctx.actor.userId;
  const k = await komContext(ctx);
  const cases = await visibleCases(ctx);
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const viewer = await viewerFor(ctx, cases);
  const caseOf = (id: string | null): CaseName | null => {
    const c = id ? byCase.get(id) : undefined;
    return c ? { caseNumber: c.caseNumber, name: viewer.name(c) } : null;
  };
  const reps = await myReports(ctx);
  const rows = await Promise.all(reps.map((r) => reportRow(ctx, r, k, caseOf)));
  rows.sort((a, b) => (a.openedAt ? 1 : 0) - (b.openedAt ? 1 : 0) || ((a.deliveredAt ?? "") < (b.deliveredAt ?? "") ? 1 : -1));

  // ctx.system: rapporter till läsaren som inte är levererade än (veckorapport som väntar på närvaron, beställarrapport
  // som är ett utkast). Bara rubrik och senaste leveranstid lämnas ut – aldrig innehållet.
  const draft = k.chef
    ? (await ctx.system.table("reports").list({ kind: "customer_summary", recipientUserId: me })).filter((r) => !deliveredOk(r))
    : await ctx.system.table("reports").list({ kind: "weekly_attendance", status: "waiting", recipientUserId: me });
  const coming = draft.filter((r) => ctx.actor.contractIds.includes(r.contractId)).map((r) => ({ id: r.id, title: rowTitle(r), dueAt: r.dueAt }));

  let unreadMessages = 0;
  const threads: KomThread[] = [];
  if (!k.chef && cases.length) {
    const messages = await ctx.repo.table("messages").list({ caseId: { in: cases.map((c) => c.id) } });
    const byThread = new Map<string, typeof messages>();
    for (const m of messages.sort(by("createdAt"))) byThread.set(m.caseId, [...(byThread.get(m.caseId) ?? []), m]);
    for (const [caseId, ms] of byThread) {
      const c = byCase.get(caseId);
      if (!c) continue;
      const last = ms[ms.length - 1];
      const unread = ms.filter((m) => m.senderId !== me && !m.readBy.includes(me)).length;
      unreadMessages += unread;
      threads.push({ caseId, caseNumber: c.caseNumber, name: viewer.name(c), lastSender: senderLabel(k, last.senderId), lastAt: last.createdAt, lastBody: last.body, meeting: last.kind === "meeting_request", unread, count: ms.length });
    }
    threads.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || (a.lastAt < b.lastAt ? 1 : -1));
  }
  return { chef: k.chef, customerName: k.customerName, unit: k.me?.customerUnit ?? null, reports: rows, coming, unreadMessages, threads };
});

/** Rubriken för en rapport som är på väg (veckorapport eller beställarrapport). */
const rowTitle = (r: Report): string => reportTitle(r, reportKindLabel);

// ================================================================ kommun.chef (beställarrapporten)
handleQuery(kommunChef, { roles: CHEF }, async (ctx, p): Promise<KomChef> => {
  const me = ctx.actor.userId;
  const k = await komContext(ctx);
  const contract = k.active;
  if (!contract) throw new Error("Det finns inget aktivt avtal");
  const cfg = k.cfg(contract.id);
  const minN = cfg.pulse.minNForAggregate;

  // ctx.system: vilka månader chefen har beställarrapporter för, även utkast (bara månad och om den är levererad –
  // innehållet i ett utkast lämnas aldrig ut). Levererade rapporter läses via ctx.repo nedan.
  const all = (await ctx.system.table("reports").list({ kind: "customer_summary", contractId: contract.id }))
    .filter((r) => !r.superseded && (r.recipientUserId === me || r.deliveredTo.includes(me)))
    .sort(by((r: Report) => r.month ?? ""));
  const months = all.map((r) => ({ month: r.month ?? "", delivered: deliveredOk(r) }));
  const latest = [...all].reverse().find(deliveredOk) ?? null;
  const month = p.month && all.some((r) => r.month === p.month) ? p.month : (latest?.month ?? all[all.length - 1]?.month ?? null);
  const sel = all.find((r) => r.month === month) ?? null;

  let report: KomChef["report"] = null;
  let summary: KomSummary | null = null;
  if (sel && deliveredOk(sel)) {
    const r = await ctx.repo.table("reports").get(sel.id);
    if (r) {
      report = { id: r.id, approvedByName: k.name(r.approvedBy), approvedAt: r.approvedAt, deliveredAt: r.deliveredAt };
      summary = await frozenSummary(ctx, r);
    }
  }

  const devs = await ctx.repo.table("contract_deviations").list({ contractId: contract.id });
  const ladder = cfg.escalationLadder;
  const pendingPlans: KomActionPlan[] = devs
    .filter((x) => !!x.actionPlan && !x.customerApprovedAt && x.status !== "closed")
    .map((x) => {
      const step = ladder.find((s) => s.step === x.escalationStep);
      return {
        id: x.id, type: x.type, stepText: step ? `Steg ${step.step} · ${step.level} avvikelse` : x.level, raisedAt: x.raisedAt, source: x.source,
        description: x.description, actionPlan: x.actionPlan, actionPlanDue: x.actionPlanDue,
      };
    });
  const approvedPlans = devs
    .filter((x) => !!x.customerApprovedAt)
    .sort(by((x: (typeof devs)[number]) => x.customerApprovedAt ?? "", -1))
    .map((x) => ({ id: x.id, description: x.description, actionPlan: x.actionPlan, approvedAt: x.customerApprovedAt as string, closed: x.status === "closed" }));

  return {
    customerName: k.customerName, months, latestDelivered: latest?.month ?? null, month,
    report, pending: sel && !deliveredOk(sel) ? { dueAt: sel.dueAt } : null, summary,
    contractTarget: kpiDef(cfg, "resultatgrad")?.contractTarget ?? 0,
    minN, pendingPlans, approvedPlans, warnings: devs.filter((x) => x.warningIssued).length,
    managerName: k.name(contract.contractManagerId), statisticsPerYear: cfg.statistics.onRequestMaxPerYear,
    progressionRule: progressionRuleText(cfg),
  };
});

/**
 * Beställarrapportens siffror (prototypens frozenSummary). En levererad rapport räknas inte om i efterhand: siffrorna
 * tas från rapportdokumentets frysta innehåll (rapporternas reportModel). Fält som dokumentet saknar (avslut som inte
 * räknas, "någon progression", andelen som känner sig närmare arbete) räknas ur dagens data som i prototypen.
 * Rapporten har redan lästs via ctx.repo (chefen får se den).
 */
async function frozenSummary(ctx: Ctx, r: Report): Promise<KomSummary | null> {
  const info = await contractInfo(ctx, r.contractId);
  // ctx.system (i loadReportDb): beställarrapporten är ett aggregat över hela avtalet – bara siffrorna lämnas ut.
  const db = await loadReportDb(ctx, r, info);
  const doc = reportModel(db, r, { ...info.env, now: ctx.now() });
  if (!doc || doc.kind !== "customer_summary") return null;
  const m = doc as SummaryModel;
  const org = await orgSettingsFor(ctx, info.contract);
  const env = domainEnv(info.contract, org, ctx.now());
  // Underlaget är redan läst ovan (samma aggregat). Pulsens utskick behövs inte för andelarna som används här.
  const live = customerSummary({ ...db, pulse_invites: [], demo_tags: [] }, m.month, env);
  const rate = (d: SummaryModel["result"]["month"], l: typeof live.result.month): KomRate => ({ value: d.value, num: d.num, den: d.den, prelim: d.prelim, excluded: l.excluded, minN: l.minN });
  return {
    month: m.month, active: m.active, started: m.started, closed: m.closed, byArea: m.byArea, byTrack: m.byTrack,
    result: { rolling: rate(m.result.rolling, live.result.rolling), sinceStart: rate(m.result.sinceStart, live.result.sinceStart), month: rate(m.result.month, live.result.month) },
    attendanceRate: m.attendanceRate,
    attendance: { present: m.attendance.present, late: m.attendance.late, absentValid: m.attendance.absentValid, absentInvalid: m.attendance.absentInvalid },
    pulse: { enough: m.pulse.enough, satisfaction: m.pulse.satisfaction, closer: live.pulse.closer, responses: m.pulse.responses, minN: live.pulse.minN },
    progression: { assessed: m.progression.assessed, clear: m.progression.clear, any: live.progression.any, areaDist: m.progression.areaDist },
    deviations: m.deviations, contractDeviations: m.contractDeviations,
  };
}

// ================================================================ kommun.testpersoner (bara prototypens snabbval på inloggningen)
handleQuery(kommunTestPersonas, { roles: ["admin", "avtalsansvarig", "samordnare", "coach", "handledare", "chef", "ekonom", "kommun_handlaggare", "kommun_chef"] }, async (ctx, p) => {
  if (!p.userIds.length) return [];
  const rows = await ctx.repo.table("profiles").list({ id: { in: p.userIds } });
  return rows.map((u) => ({ userId: u.id, email: u.email }));
});

// ================================================================ Kommandon
/** kom.caseSeen (tyst): händelser i ärendet före den här tiden räknas som lästa på startsidan. */
handleCommand(kommunCaseSeen, { roles: BOTH, silent: true }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", "Ärendet finns inte.");
  const me = ctx.actor.userId;
  await upsert(ctx.repo.table("case_seen"), { id: `${me}:${c.id}`, userId: me, caseId: c.id, seenAt: ctx.now() });
  return ok();
});

/** kom.taskDone: handläggaren markerar en uppgift från Miljonbemanning som klar. */
handleCommand(kommunTaskDone, { roles: BOTH }, async (ctx, p) => {
  const t = await ctx.repo.table("tasks").get(p.taskId);
  if (!t) return fail("not_found", "Uppgiften finns inte.");
  if (t.toId !== ctx.actor.userId) return fail("forbidden", "Uppgiften är till någon annan.");
  await ctx.repo.table("tasks").update(t.id, { status: "done", doneAt: ctx.now(), doneBy: ctx.actor.userId });
  await ctx.audit({ action: "task.done", entity: "task", entityId: t.id, details: { by: "customer" } });
  return ok();
});

/** kom.approveActionPlan: kommunens chef godkänner en åtgärdsplan. Avtalsansvarig får ett mejl utan personuppgifter. */
handleCommand(kommunApproveActionPlan, { roles: CHEF }, async (ctx, p) => {
  const cd = await ctx.repo.table("contract_deviations").get(p.id);
  if (!cd) return fail("not_found", "Åtgärdsplanen finns inte.");
  if (cd.customerApprovedAt) return fail("already_approved", "Åtgärdsplanen är redan godkänd.");
  await ctx.repo.table("contract_deviations").update(cd.id, { customerApprovedAt: ctx.now(), customerApprovedBy: ctx.actor.userId, ...(cd.status === "open" ? { status: "action_plan" as const } : {}) });
  await ctx.audit({ action: "contract_deviation.action_plan_approved", entity: "contract_deviation", entityId: cd.id, contractId: cd.contractId, details: { by: "customer" } });
  const contract = await ctx.repo.table("contracts").get(cd.contractId);
  const to = await userEmail(ctx, contract?.contractManagerId);
  if (to) await ctx.notify({ channel: "email", to, template: "atgardsplan_godkand", body: "Beställaren har godkänt en åtgärdsplan i Miljonmatch. Logga in för att se den.", caseId: null });
  return ok();
});

/** Visa hela personnumret (tyst). Kommunens åtkomst till ärendet krävs. Visningen loggas – numret skrivs aldrig i loggen. */
handleCommand(kommunRevealPnr, { roles: BOTH, silent: true }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", "Ärendet finns inte.");
  const viewer = await viewerFor(ctx, [c]);
  if (viewer.access(c) !== "customer") return fail("forbidden", "Personnumret visas inte för din roll.");
  const person = await ctx.repo.table("persons").get(c.personId);
  const pnr = revealPnr(ctx.crypto, person);
  if (!person || !pnr) return fail("missing", "Personnummer saknas.");
  await ctx.audit({ action: "pnr.revealed", entity: "person", entityId: person.id, contractId: c.contractId, details: { caseId: c.id } });
  return ok({ pnr });
});
