// Hanterare för området kommun – kommunens portal (prototypens views/kommun.js). Registreras via src/api/handlers.ts.
// Frågorna returnerar vy-modeller med bara det kommunen får se. Läsning via ctx.repo (policyn/RLS avgör vilka ärenden,
// personer, rapporter och meddelanden som syns). ctx.system används bara där det står en kommentar vid anropet.
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { attendanceStats, repeatedAbsence } from "@/core/attendance";
import { ackTextFor, duplicateActive } from "@/core/cases";
import { isUnset } from "@/core/config";
import { contactLabel, NO_CONTACT_TEXT_PORTAL, participantContactLabel, reportKindLabel, teamLabel } from "@/core/labels";
import { avropDue, firstMeetingDays, firstMeetingDue } from "@/core/sla";
import { MONTHS, addDays, addMonths, dayOf, diffDays, monday, monthEnd, monthKey } from "@/core/time";
import { by } from "@/core/util";
import { pnrFormatValid } from "@/core/validation";
import type { Case, CaseStatus, Profile, Report } from "@/data/schema";
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, ATTACHMENT_TYPES_TEXT } from "../_shared/attachment-port";
import { upsert } from "../_shared/context";
import { pnrSearchHash, revealPnr } from "../_shared/pnr";
import { caseBackground } from "../arenden/background";
import {
  kommunCase, kommunCaseList, kommunCaseSeen, kommunDuplicate, kommunOrderForm, kommunProfile, kommunProfileSave, kommunReceipt, kommunReports,
  kommunRevealPnr, kommunStart, kommunTaskDone,
  type KomAttTile, type KomCaseDetail, type KomCaseRow, type KomEvent, type KomReportRow, type KomTask, type KomThread,
} from "./api";
import { deliveredOk, komCase, komContext, komMessage, reportRow, senderLabel, viewerFor, visibleCases } from "./load";
import { fD, NOTIFY_FROM, reportTitle } from "./texts";
// "Tala in" (röstinspelning): beställningens bakgrundsinformation och meddelanden.
import "./voice-handlers";

// Kommunen har bara rollen handläggare (beslut 2026-10-07 – kommunens chef är borttagen).
const HANDL: readonly Role[] = ["kommun_handlaggare"];
/** Uppgifterna i profilen som handläggaren fyller i (Mina uppgifter): saknas någon visas kortet "Fyll i dina uppgifter". */
const profileIncomplete = (p: Profile | null): boolean => !p || !(p.customerUnit ?? "").trim() || p.phone.replace(/\D/g, "").length < 7;
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
    firstName: (k.me?.fullName ?? "").split(" ")[0], unit: k.me?.customerUnit ?? null, profileIncomplete: profileIncomplete(k.me), customerName: k.customerName,
    tasks, events: visibleEvents, unreadMessages, unreadReports, unreadTotal: unreadAll.length + unreadMessages.length,
    active: cases.filter((c) => c.status === "active" || c.status === "paused").length,
    waiting: cases.filter((c) => c.status === "received" || c.status === "acknowledged" || c.status === "confirmed").length,
  };
});

// ================================================================ kommun.bestallning (formulärets förval och avtalets regler)
// Inga priser och ingen beställarreferens (synpunkt #4, #10 och #11, beslut 2026-10-07). Yrkesområdena är avtalets aktiva
// avtalsområden (beslut 2026-10-09) – läses via behörigheten (kommunen får läsa avtalets contract_areas).
handleQuery(kommunOrderForm, { roles: HANDL }, async (ctx) => {
  const now = ctx.now();
  const today = dayOf(now);
  const k = await komContext(ctx);
  const contract = k.active;
  if (!contract) throw new Error("Det finns inget aktivt avtal att beställa i");
  const cfg = k.cfg(contract.id);
  const days = firstMeetingDays(cfg);
  const areas = (await ctx.repo.table("contract_areas").list({ contractId: contract.id, active: true })).sort(by("code"));
  const other = areas.find((a) => a.name.trim().toLowerCase() === "övrigt") ?? null;
  return {
    customerName: k.customerName, today, defaultStart: addDays(monday(today), 14),
    me: { name: k.me?.fullName ?? "", unit: k.me?.customerUnit ?? "", phone: k.me?.phone ?? "", email: k.me?.email ?? "" },
    periods: { months: [...cfg.orderPeriods.months], allowOther: cfg.orderPeriods.allowOther },
    attachments: { maxBytes: ATTACHMENT_MAX_BYTES, maxFiles: ATTACHMENT_MAX_FILES, accept: ATTACHMENT_ACCEPT, typesText: ATTACHMENT_TYPES_TEXT },
    firstMeetingWithin: days === 7 ? "en vecka" : days ? `${days} dagar` : "kort tid",
    answerDue: avropDue({ referredAt: now }, cfg),
    areas: areas.map((a) => ({ value: a.code, label: a.name })),
    otherAreaName: other?.name ?? null,
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
  const email = k.me?.email ?? "";
  // ctx.system: mejlet som just skickades till handläggaren själv (ordererkännandet). Bara utskick till hennes egen adress
  // läses. Utskicksloggen är annars bara för Miljonbemanning.
  const sent = email ? await ctx.system.table("outbound_messages").list({ to: email }, { orderBy: "createdAt" }) : [];
  const mail = sent.filter((n) => n.caseId === c.id && n.template === "ordererkannande").pop();
  const area = c.primaryAreaCode ? await ctx.repo.table("contract_areas").first({ contractId: c.contractId, code: c.primaryAreaCode }) : null;
  return {
    caseId: c.id, caseNumber: c.caseNumber, referredAt: c.referredAt, avropDue: avropDue(c, cfg),
    firstMeetingDue: firstMeetingDue(c, cfg),
    ackText: ackTextFor(c, cfg),
    mail: mail ? { from: NOTIFY_FROM, to: mail.to, at: mail.createdAt, body: mail.body } : null,
    contactLabel: person ? contactLabel(person.preferredContact) : null,
    areaName: area?.name ?? null,
  };
});

// ================================================================ kommun.deltagareLista
handleQuery(kommunCaseList, { roles: HANDL }, async (ctx) => {
  const me = ctx.actor.userId;
  const today = dayOf(ctx.now());
  const k = await komContext(ctx);
  const all = await visibleCases(ctx);
  const viewer = await viewerFor(ctx, all);
  // Bara ärenden med kommunens åtkomst (vilande spärr för skyddade personuppgifter: annat visas inte – fail-closed).
  const cases = all.filter((c) => viewer.access(c) === "customer");
  const messages = cases.length ? await ctx.repo.table("messages").list({ caseId: { in: cases.map((c) => c.id) } }) : [];
  const unread = new Map<string, number>();
  for (const m of messages) if (m.senderId !== me && !m.readBy.includes(me)) unread.set(m.caseId, (unread.get(m.caseId) ?? 0) + 1);
  const rows: KomCaseRow[] = cases.map((c) => ({
    ...komCase(c, viewer, k),
    unread: unread.get(c.id) ?? 0,
    recentlyDeclined: c.status === "declined" && !!c.declinedAt && diffDays(c.declinedAt.slice(0, 10), today) <= DECLINED_VISIBLE_DAYS,
  }));
  rows.sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.referredAt < b.referredAt ? 1 : -1));
  const cfg = k.active ? k.cfg(k.active.id) : null;
  return {
    customerName: k.customerName, phaseCount: cfg?.phases.length ?? 0,
    scopeUnset: !!cfg && isUnset(cfg.customerVisibility.scope), rows,
  };
});

// ================================================================ kommun.deltagare (deltagarens sida)
handleQuery(kommunCase, { roles: HANDL }, async (ctx, p) => {
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
  // Vilande spärr för skyddade personuppgifter (beslut 2026-10-07): bara åtkomsten "customer" visar sidan (fail-closed).
  if (access !== "customer") return { kind: "denied" as const };
  const person = await ctx.repo.table("persons").get(c.personId);
  const kc = komCase(c, viewer, k);
  const db = await loadDb(ctx.repo, ["activities", "attendance", "messages", "case_status_history", "case_team", "reports", "case_seen"], {
    activities: { caseId: c.id }, attendance: { caseId: c.id }, messages: { caseId: c.id }, case_status_history: { caseId: c.id }, case_team: { caseId: c.id },
    reports: { caseId: c.id }, case_seen: { userId: me, caseId: c.id },
  });
  const byCase = new Map([[c.id, c]]);
  const env = { now, cfg };

  const msgs = db.messages.slice().sort(by("createdAt")).map((m) => komMessage(k, m));
  // Rapporter: levererade till läsaren (policyn).
  const reps = db.reports.filter((r) => deliveredOk(r) && r.deliveredTo.includes(me));
  const caseOf = (id: string | null): CaseName | null => (id === c.id ? { caseNumber: c.caseNumber, name: viewer.name(c) } : null);
  const reportRows: KomReportRow[] = await Promise.all(reps.map((r) => reportRow(ctx, r, k, caseOf)));
  reportRows.sort((a, b) => (!a.openedAt ? 0 : 1) - (!b.openedAt ? 0 : 1) || ((a.deliveredAt ?? "") < (b.deliveredAt ?? "") ? 1 : -1));

  // Byte av huvudcoach och händelser som handläggaren inte har sett.
  const coachChanges = db.case_status_history
    .filter((h) => h.fromCoach && h.toCoach && h.fromCoach !== h.toCoach)
    .sort(by("changedAt"))
    .map((h) => ({ at: h.changedAt, fromName: k.name(h.fromCoach), toName: k.name(h.toCoach) }));
  let unseenEvents = 0;
  if (c.referrerId === me) {
    const since = `${addDays(today, -EVENT_DAYS)}T00:00`;
    const seen = db.case_seen[0]?.seenAt ?? "";
    const ats = [...(c.status === "declined" && c.declinedAt ? [c.declinedAt] : []), ...coachChanges.map((x) => x.at)];
    unseenEvents = ats.filter((at) => at >= since && seen < at).length;
  }
  const oc = reps.find((r) => r.kind === "order_confirmation");

  // Närvaro de två senaste månaderna (när insatsen har startat).
  let attendance: KomCaseDetail["attendance"] = null;
  if (c.startDate && c.startDate <= today) {
    const mk = monthKey(today);
    const prevMk = addMonths(mk, -1);
    const tile = (label: string, from: string, to: string): KomAttTile => {
      const s = attendanceStats(db, c.id, from, to, env);
      return { label, planned: s.planned, present: s.present, late: s.late, absentValid: s.absentValid, absentInvalid: s.absentInvalid, unregistered: s.unregistered, rate: s.rate };
    };
    const ra = c.status === "active" ? repeatedAbsence(db, c.id, env) : null;
    attendance = {
      month: tile(`${MONTHS[Number(mk.slice(5)) - 1]} hittills`, `${mk}-01`, today),
      prev: tile(MONTHS[Number(prevMk.slice(5)) - 1], `${prevMk}-01`, monthEnd(prevMk)),
      repeated: ra ? { count: ra.length, withinDays: cfg.attendance.repeatedAbsenceRule.withinDays } : null,
    };
  }

  // Deltagaren: maskerat personnummer (hela numret bara via kommun.visaPersonnummer, som loggas).
  const pnr = person ? revealPnr(ctx.crypto, person) : null;
  const masked = person ? (pnr ? `${pnr.slice(0, pnr.length - 4).replace(/\d/g, "•")}${person.personnummerLast4}` : person.personnummerLast4 ? `••••••••-${person.personnummerLast4}` : null) : null;

  return {
    kind: "ok",
    today, customerName: k.customerName, phaseCount: cfg.phases.length, case: kc,
    unreadReports: reportRows.filter((r) => !r.openedAt).length,
    unseenEvents,
    tasks: (await openTasks(ctx, byCase)).filter((t) => t.caseId === c.id),
    messages: msgs,
    canWrite: c.referrerId === me,
    coachChanges,
    // Orderbekräftelsen – inget ordervärde, inget pris och ingen beställarreferens (synpunkt #10 och #11).
    order: {
      coachName: c.leadCoachId ? k.name(c.leadCoachId) : null,
      team: db.case_team.filter((t) => t.role !== "lead_coach").map((t) => ({ name: k.name(t.userId), roleLabel: teamLabel(t.role) })),
      ocReportId: oc?.id ?? null, ackText: c.acknowledgedAt ? ackTextFor(c, cfg) : null,
    },
    attendance,
    // Utan telefonnummer och e-postadress är kontaktvägen bara förvalet telefon – inget val (beslut 2026-10-09).
    participant: { pnrMasked: masked, canReveal: !!masked, contactLabel: person ? participantContactLabel(person, NO_CONTACT_TEXT_PORTAL) : null, city: person?.city ?? "" },
    // Bakgrundsinformationen och bilagorna från beställningen (bilagorna läses via behörigheten – den som beställde).
    background: await caseBackground(ctx, c),
    seesCoachNotes: cfg.customerVisibility.seesCoachNotes,
    reports: reportRows,
  } satisfies KomCaseDetail;
});

// ================================================================ kommun.rapporter
handleQuery(kommunReports, { roles: HANDL }, async (ctx) => {
  const me = ctx.actor.userId;
  const k = await komContext(ctx);
  const all = await visibleCases(ctx);
  const viewer = await viewerFor(ctx, all);
  const cases = all.filter((c) => viewer.access(c) === "customer");
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const caseOf = (id: string | null): CaseName | null => {
    const c = id ? byCase.get(id) : undefined;
    return c ? { caseNumber: c.caseNumber, name: viewer.name(c) } : null;
  };
  const reps = await myReports(ctx);
  const rows = await Promise.all(reps.map((r) => reportRow(ctx, r, k, caseOf)));
  rows.sort((a, b) => (a.openedAt ? 1 : 0) - (b.openedAt ? 1 : 0) || ((a.deliveredAt ?? "") < (b.deliveredAt ?? "") ? 1 : -1));

  // ctx.system: veckorapporter till läsaren som inte är levererade än (väntar på närvaron). Bara rubrik och senaste
  // leveranstid lämnas ut – aldrig innehållet.
  const draft = await ctx.system.table("reports").list({ kind: "weekly_attendance", status: "waiting", recipientUserId: me });
  const coming = draft.filter((r) => ctx.actor.contractIds.includes(r.contractId)).map((r) => ({ id: r.id, title: rowTitle(r), dueAt: r.dueAt }));

  let unreadMessages = 0;
  const threads: KomThread[] = [];
  if (cases.length) {
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
  return { customerName: k.customerName, unit: k.me?.customerUnit ?? null, reports: rows, coming, unreadMessages, threads };
});

/** Rubriken för en rapport som är på väg (veckorapport). */
const rowTitle = (r: Report): string => reportTitle(r, reportKindLabel);

// ================================================================ Kommandon
/** kom.caseSeen (tyst): händelser i ärendet före den här tiden räknas som lästa på startsidan. */
handleCommand(kommunCaseSeen, { roles: HANDL, silent: true }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", "Ärendet finns inte.");
  const me = ctx.actor.userId;
  await upsert(ctx.repo.table("case_seen"), { id: `${me}:${c.id}`, userId: me, caseId: c.id, seenAt: ctx.now() });
  return ok();
});

/** kom.taskDone: handläggaren markerar en uppgift från Miljonbemanning som klar. */
handleCommand(kommunTaskDone, { roles: HANDL }, async (ctx, p) => {
  const t = await ctx.repo.table("tasks").get(p.taskId);
  if (!t) return fail("not_found", "Uppgiften finns inte.");
  if (t.toId !== ctx.actor.userId) return fail("forbidden", "Uppgiften är till någon annan.");
  await ctx.repo.table("tasks").update(t.id, { status: "done", doneAt: ctx.now(), doneBy: ctx.actor.userId });
  await ctx.audit({ action: "task.done", entity: "task", entityId: t.id, details: { by: "customer" } });
  return ok();
});

/** Visa hela personnumret (tyst). Kommunens åtkomst till ärendet krävs. Visningen loggas – numret skrivs aldrig i loggen. */
handleCommand(kommunRevealPnr, { roles: HANDL, silent: true }, async (ctx, p) => {
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

// ================================================================ Mina uppgifter
handleQuery(kommunProfile, { roles: HANDL }, async (ctx) => {
  const k = await komContext(ctx);
  const me = k.me;
  return { name: me?.fullName ?? "", email: me?.email ?? "", phone: me?.phone ?? "", unit: me?.customerUnit ?? "", customerName: k.customerName, incomplete: profileIncomplete(me) };
});

/** kom.profilSpara: handläggarens egna uppgifter (egen profil via behörigheten). Loggen får bara fältnamnen. */
handleCommand(kommunProfileSave, { roles: HANDL }, async (ctx, p) => {
  const me = await ctx.repo.table("profiles").get(ctx.actor.userId);
  if (!me) throw new Error("Profilen saknas");
  const fullName = p.fullName.trim().replace(/\s+/g, " ");
  const phone = p.phone.trim();
  const unit = p.unit.trim().replace(/\s+/g, " ");
  if (fullName.length < 2) return fail("name", "Skriv ditt namn.");
  if (phone.replace(/\D/g, "").length < 7) return fail("phone", "Skriv ett telefonnummer där vi når dig.");
  if (!unit) return fail("unit", "Skriv vilken enhet du arbetar på.");
  const patch: Partial<Profile> = {};
  if (fullName !== me.fullName) patch.fullName = fullName;
  if (phone !== me.phone) patch.phone = phone;
  if (unit !== (me.customerUnit ?? "")) patch.customerUnit = unit;
  const changed = Object.keys(patch);
  if (!changed.length) return ok({ changed });
  await ctx.repo.table("profiles").update(me.id, patch);
  await ctx.audit({ action: "profile.updated", entity: "profile", entityId: me.id, contractId: ctx.actor.contractIds[0] ?? null, details: { fields: changed } });
  return ok({ changed });
});
