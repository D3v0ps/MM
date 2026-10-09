// Vy-modellerna för skärmarna i området inkorg (startsidan, avropsinkorgen, förfaller) – port av prototypens
// views/inkorg.js. Bara för hanterare. Läsning via ctx.repo; ctx.system bara där det står en kommentar om varför.
import type { Ctx, PnrCrypto } from "@/api/server";
import { buyerRefLengthText, isUnset, phaseLabel } from "@/core/config";
import { coaches as coachesOf, duplicateActive, previewNextCaseNumber } from "@/core/cases";
import { PRIOR_ASSESSMENT_LABEL } from "@/core/labels";
import { TRACKS } from "@/data/seed/constants";
import { caseBackground, orderPeriodText } from "@/features/arenden/background";
import { looksLikeCancellation } from "./parse";
import { cdStatusKey } from "@/features/ledning/api";
import { teamCandidates } from "@/features/_shared/team";
import { pct } from "@/core/format";
import { kpiValue } from "@/core/kpi";
import { hasContactDetails } from "@/core/contact";
import { areaName, contactLabel, participantContactLabel, personName, teamLabel } from "@/core/labels";
import { avropDue, firstMeetingDue, slaStatus } from "@/core/sla";
import { addDays, addMonths, addWorkingDays, dayOf, diffMinutes, fmtDate, fmtDateTimeLong, fmtWeek, fmtWeekday, monday, monthKey, monthName, timeOf, weekday, WEEKDAYS } from "@/core/time";
import { by, uniq } from "@/core/util";
import type { Case, CaseStatusHistory, ContractArea, InboundEmail, OrderField, OutboundMessage, Person, Report } from "@/data/schema";
import type {
  AckView, AlertView, CaseFieldsView, ConfirmationView, DeadlinesView, DecisionForm, DeclinedView, DuplicateView, FieldGroup, FieldNote, FormField, InboxItemDetail,
  InboxList, KpiCardView, MiniDeadline, OriginalView, ParsedView, PendingSupplement, PnrView, StartView,
} from "./api";
import {
  ackMinutes, alertItems, answerDays, canOpen, casePeriodValue, deadlineItems, deadlineRow, hasPnrText, hrefFor, inboxEnv, inboxToHandle, loadInbox, loadOps, maskedPnr,
  maskPnrText, meetingDays, plainPnr, sla, sortPending, toRow, visibleCaseIds, type InboxData, type InboxEnv, type Item,
} from "./model";
import {
  dlDesc, FIELD_GROUPS, FIELD_LABEL, flagDaysText, groupDeadlines, kindLabel, lc, listJoin, LOW, meetingDaysText, METHOD, OPTIONAL_FIELDS, ORDER_FIELDS, refErrorMB,
  whenText, workingDaysText, type DeadlineRow, type OrderFieldKey,
} from "./texts";

/** Avtalsavvikelsens läge i Min vecka (samma regel som ledningens CD_STATUS_LABEL, gemener i en bisats). */
const CD_SUB_TEXT = { closed: "klar", no_plan: "öppen – åtgärdsplan saknas", waiting: "åtgärdsplan väntar på kommunens godkännande", in_progress: "åtgärdsplan godkänd av kommunen" } as const;

const OPEN = ["acknowledged", "received"];
const DECIDED = ["confirmed", "active", "paused", "closed"];
const isOpen = (c: Pick<Case, "status"> | null | undefined) => !!c && OPEN.includes(c.status);
/** Mejlet väntar på hantering (samma statusar som fliken Att hantera). */
const isPending = (s: InboundEmail["status"]) => s === "received" || s === "acknowledged";
const refConfig = (e: InboxEnv) => ({ refPattern: e.cfg.billing.buyerReference.pattern, refLen: buyerRefLengthText(e.cfg) });
const refError = (s: string | null | undefined, e: InboxEnv) => refErrorMB(s, e.cfg.billing.buyerReference.pattern, buyerRefLengthText(e.cfg));

/** Ärendets värde för ett fält i beställningen (prototypens fältnamn → ärendets). */
function caseValue(c: Case, k: string): unknown {
  if (k === "primaryArea") return c.primaryAreaCode;
  if (k === "secondaryArea") return c.secondaryAreaCode;
  return (c as unknown as Record<string, unknown>)[k];
}

function fmtField(k: string, v: unknown, areas: readonly ContractArea[]): string | null {
  if (v == null || v === "") return null;
  if (k === "desiredStart" || k === "plannedEnd") return fmtDate(String(v));
  if (k === "plannedWeeks") return `${v} veckor`;
  if (k === "orderPeriod") return v === "annan" ? "Annan tidsperiod" : `${v} månader`;
  if (k === "priorAssessment") return v === "ja" ? PRIOR_ASSESSMENT_LABEL.yes : v === "nej" ? PRIOR_ASSESSMENT_LABEL.no : v === "vet_inte" ? PRIOR_ASSESSMENT_LABEL.unknown : String(v);
  if (k === "primaryArea" || k === "secondaryArea") return areaName(areas, String(v));
  if (k === "preferredContact") return contactLabel(String(v));
  return String(v);
}

/** Maskerat personnummer för ärendets person (dolt när rollen inte får se personen). */
const pnrView = (c: Case, person: Person | null): PnrView => (person ? { caseId: c.id, masked: maskedPnr(person), hidden: false } : { caseId: c.id, masked: null, hidden: true });

// ---------------------------------------------------------------- Utskick (utan personuppgifter)
/**
 * Utskicken för ärendet och mejlet. ctx.system: utskicksloggen läses av samordnaren i appen, men avtalsansvarig ska se samma
 * kvittenser i inkorgen (ordererkännande, orderbekräftelse, kallelse, avslag, svar). Utskick innehåller aldrig personuppgifter
 * (CLAUDE.md punkt 9) och bara utskick för poster som användaren redan ser läses.
 */
async function outboundFor(ctx: Ctx, caseId: string | null, to: string | null): Promise<OutboundMessage[]> {
  const t = ctx.system.table("outbound_messages");
  const rows = [...(caseId ? await t.list({ caseId }) : []), ...(to ? await t.list({ to, caseId: { isNull: true } }) : [])];
  return rows.sort(by<OutboundMessage>("createdAt"));
}

// ---------------------------------------------------------------- Inkorgens lista
export async function buildList(ctx: Ctx): Promise<InboxList> {
  const e = await inboxEnv(ctx);
  const d = await loadInbox(ctx, e);
  const pending = inboxToHandle(d.items);
  const handled = d.items.filter((x) => !x.pending).sort(by<Item>((x) => x.handledAt || x.receivedAt, -1));
  const all = d.items.slice().sort(by<Item>("receivedAt", -1));
  return { rows: all.map((x) => toRow(x, e.now)), pending: pending.map((x) => x.id), handled: handled.map((x) => x.id), ackMinutes: ackMinutes(e.cfg), answerText: workingDaysText(answerDays(e.cfg)) };
}

// ---------------------------------------------------------------- Kort i detaljvyn
function originalView(m: InboundEmail, mayReveal: boolean): OriginalView {
  return {
    emailId: m.id, fromName: m.fromName, fromAddress: m.fromAddress, receivedLong: fmtDateTimeLong(m.receivedAt), subject: m.subject, body: maskPnrText(m.bodyText),
    hasPnr: hasPnrText(m.bodyText), mayReveal, attachments: m.attachments.map((a) => a.name),
  };
}

async function parsedView(ctx: Ctx, d: InboxData, m: InboundEmail, c: Case | null, areas: ContractArea[]): Promise<ParsedView> {
  const ex = m.extracted as Record<string, unknown>;
  const conf = m.confidence as Record<string, number | undefined>;
  const corr = m.corrections;
  const applied = c ? d.emails.filter((x) => x.caseId === c.id && x.classification === "supplement" && x.status === "applied") : [];
  // Införd: kompletteringen förde in fältet. emailApplySupplement för bara in de fält som skrevs till ärendet i mejlets tolkning –
  // ett telefonnummer i svaret (eller ett yrkesområde som inte kunde föras in) visas därför inte som infört.
  const fromSup = (k: OrderField) =>
    applied.find((x) => {
      const v = (x.extracted as Record<string, unknown>)[k];
      return v != null && v !== "" && ex[k] === v;
    });
  const stateOf = (k: OrderField): FormField["state"] => {
    const v = ex[k];
    const empty = v == null || v === "";
    if (m.missingFields.includes(k) && empty) return "missing";
    if (corr[k] || fromSup(k)) return "ok";
    if (!empty && conf[k] != null && (conf[k] as number) < LOW) return "low";
    return "ok";
  };
  const note = (k: OrderField): FieldNote | null => {
    const s = stateOf(k);
    if (s === "missing") return { kind: "missing" };
    const cr = corr[k];
    if (cr) return { kind: cr.changed ? "corrected" : "checked", title: `${personName(d.profiles, cr.by)} ${whenText(cr.at, d.e.now)}` };
    const sup = fromSup(k);
    if (sup) return { kind: "supplement", title: `Införd ${whenText(sup.handledAt, d.e.now)}` };
    if (s === "low") return { kind: "low", pct: pct(conf[k] as number, 0) };
    return conf[k] != null && ex[k] !== "" && ex[k] != null ? { kind: "pct", pct: pct(conf[k] as number, 0) } : null;
  };
  const person = c ? d.personById.get(c.personId) ?? null : null;
  // Fälten som inte frågas efter (Miljonbemanning sätter dem, eller bara vid annan tidsperiod) visas bara när mejlet har ett
  // värde eller när de saknas. En grupp utan fält visas inte.
  const shown = (k: OrderField) => !OPTIONAL_FIELDS.includes(k) || (ex[k] != null && ex[k] !== "") || stateOf(k) === "missing";
  const groups: FieldGroup[] = FIELD_GROUPS.map(([title, keys]) => ({
    title,
    fields: keys.filter(shown).map((k): FormField => {
      const base = { key: k, label: FIELD_LABEL[k], state: stateOf(k), note: note(k) };
      const v = ex[k];
      if (k === "pnr" && v != null && v !== "") return c ? { ...base, value: null, pnr: pnrView(c, person) } : { ...base, value: "••••••••-••••" };
      return { ...base, value: k === "pnr" ? null : fmtField(k, v, areas) };
    }),
  })).filter((g) => g.fields.length > 0);
  const all = groups.flatMap((g) => g.fields);
  // Samma körning för tolkningen (AI-körningar läses med ärendets behörighet).
  const run = m.aiRunId ? await ctx.repo.table("ai_runs").get(m.aiRunId) : null;
  return {
    method: m.parseMethod, help: METHOD[m.parseMethod]?.help ?? "", nMissing: all.filter((f) => f.state === "missing").length, nLow: all.filter((f) => f.state === "low").length,
    aiRun: run ? `Tolkat av ${run.provider} på ${Math.max(1, Math.round((run.latencyMs || 0) / 1000))} s.` : null, groups,
  };
}

/**
 * Beställning utan mejl (portal eller telefon) – samma steg som portalens formulär, utan konfidens. Yrkesområdet kommer från
 * kommunen (beslut 2026-10-09); bostadsorten visas bara när den finns (äldre beställningar). Alternativt område, yrkesspår
 * och beställarreferens sätts av Miljonbemanning vid accept (synpunkt #8) och visas bara när de finns.
 */
function caseFieldsView(d: InboxData, c: Case, areas: ContractArea[], title = "Beställningen"): CaseFieldsView {
  // Portalen, telefon eller registrerad av Miljonbemanning från mejl/annan väg (beslut 4a).
  const method: CaseFieldsView["method"] = c.source === "phone" ? "phone" : c.source === "portal" ? "portal" : "registered";
  const p = d.personById.get(c.personId) ?? null;
  const k = c.referrerId ? d.profiles.find((u) => u.id === c.referrerId) ?? null : null;
  const row = (label: string, value: string | null, missing = false, pnr?: PnrView): FormField => ({
    key: label, label, value, pnr, state: missing ? "missing" : "ok", note: missing ? { kind: "missing" } : null,
  });
  const other = c.orderPeriodMonths == null && !!c.orderPeriodReason;
  const groups: FieldGroup[] = [
    {
      title: "1. Beställning och kontakt",
      fields: [
        row("Handläggare", k?.fullName || c.referrerName || null), row("Enhet", c.referrerUnit || k?.customerUnit || null),
        row("Önskat startdatum", c.desiredStart ? fmtDate(c.desiredStart) : null),
        row("Omfattning", orderPeriodText(c), orderPeriodText(c) === "Inte angiven"),
        ...(other ? [row("Slutdatum", c.plannedEnd ? fmtDate(c.plannedEnd) : null, !c.plannedEnd), row("Motivering till annan tidsperiod", c.orderPeriodReason)] : []),
      ],
    },
    {
      title: "2. Deltagare",
      fields: [
        row("Namn", p ? `${p.firstName} ${p.lastName}` : null), row("Personnummer", null, false, pnrView(c, p)),
        ...(p ? [row("Telefon", p.phone || null), row("E-post", p.email || null)] : []),
        ...(c.primaryAreaCode ? [row("Yrkesområde", areaName(areas, c.primaryAreaCode))] : []),
        ...(p
          ? [...(p.city ? [row("Bostadsort", p.city)] : []), row("Föredragen kontaktväg", p.preferredContact ? participantContactLabel(p) : null)]
          : []),
      ],
    },
    {
      title: "3. Bakgrundsinformation om deltagaren",
      fields: [
        row("Kartläggning genomförd", c.priorAssessment ? PRIOR_ASSESSMENT_LABEL[c.priorAssessment] : null),
        row("Bakgrundsinformation", c.backgroundInfo || null),
      ],
    },
    ...(c.secondaryAreaCode || c.vocationalTrack || c.buyerReference
      ? [{
          title: "Uppgifter som Miljonbemanning sätter vid accept",
          fields: [
            ...(c.secondaryAreaCode ? [row("Avtalsområde (alternativt)", areaName(areas, c.secondaryAreaCode))] : []),
            ...(c.vocationalTrack ? [row("Yrkesspår", c.vocationalTrack)] : []),
            ...(c.buyerReference ? [row("Beställarreferens", c.buyerReference)] : []),
          ],
        }]
      : []),
  ];
  return { title, method, groups };
}

function ackView(it: Item, d: InboxData, out: OutboundMessage[], crypto: PnrCrypto): AckView {
  let n: OutboundMessage | null = null;
  if (it.case && it.cls === "order") n = out.find((x) => x.caseId === it.case?.id && x.template === "ordererkannande") ?? null;
  if (!n) {
    return {
      kind: "none",
      text: it.cls === "other" ? "Inget automatiskt svar. Mejl som klassas som Övrigt lämnas till en människa." : it.kind === "case" ? "Ordererkännandet visades direkt på skärmen för handläggaren." : "Inget automatiskt svar hittades.",
    };
  }
  const mins = Math.max(0, diffMinutes(it.receivedAt, n.createdAt));
  const limit = ackMinutes(d.e.cfg);
  const p = it.person;
  const leak = !!p && [p.firstName, p.lastName, plainPnr(crypto, p)].some((x) => x && n.body.includes(x));
  // Registrerad av Miljonbemanning (beslut 4a): ordererkännandet gick när beställningen registrerades – minuterna från mottagandet gäller inte.
  const registered = !!it.email?.registeredBy;
  return { kind: "sent", generic: n.template === "generisk_mottagningsbekraftelse", ok: registered || mins <= limit, mins, limit, when: whenText(n.createdAt, d.e.now), to: n.to, body: n.body, leak, ...(registered ? { registered: true } : {}) };
}

/**
 * Dubblettkontroll: andra pågående insatser för samma person i avtalet. ctx.system: kontrollen ska se alla pågående
 * ärenden, även sådana användaren inte får se (som när beställningen skapas) – bara sökhashen jämförs och bara
 * ärendenummer och status lämnas ut.
 */
async function duplicateView(ctx: Ctx, d: InboxData, c: Case): Promise<DuplicateView> {
  const p = d.personById.get(c.personId);
  if (!p?.personnummerHash) return { dups: [] };
  const persons = await ctx.system.table("persons").list({ personnummerHash: p.personnummerHash });
  const cases = await ctx.system.table("cases").list({ personId: { in: persons.map((x) => x.id) }, contractId: c.contractId });
  return { dups: duplicateActive({ persons, cases }, p.personnummerHash).filter((x) => x.id !== c.id).map((x) => ({ caseId: x.id, caseNumber: x.caseNumber, status: x.status })) };
}

/** Vem som ändrade status (namnet på Miljonbemannings personal). ctx.system: statushistoriken för skyddade ärenden syns inte för samordnaren, men namnet på den som beslutade gör det i prototypen. */
async function changedBy(ctx: Ctx, d: InboxData, caseId: string, toStatus: Case["status"]): Promise<string | null> {
  const h = (await ctx.system.table("case_status_history").list({ caseId, toStatus })).sort(by<CaseStatusHistory>("changedAt")).slice(-1)[0];
  return h ? personName(d.profiles, h.changedBy) : null;
}

async function declinedView(ctx: Ctx, d: InboxData, c: Case, out: OutboundMessage[]): Promise<DeclinedView> {
  const mail = out.filter((n) => n.caseId === c.id && n.template === "avbojt").slice(-1)[0];
  return { when: whenText(c.declinedAt, d.e.now), by: await changedBy(ctx, d, c.id, "declined"), reason: c.declineReason || "–", mail: mail?.body ?? null };
}

const pendingSups = (d: InboxData, c: Case | null): PendingSupplement[] =>
  c ? d.emails.filter((x) => x.caseId === c.id && x.classification === "supplement" && x.status === "linked").map((s) => ({ id: s.id, fromName: s.fromName, when: whenText(s.receivedAt, d.e.now) })) : [];

function replyDraft(d: InboxData, c: Case, activities: { startsAt: string }[], meName: string): string {
  const mon = monday(d.e.today);
  const end = addDays(mon, 7);
  const days = uniq(activities.filter((a) => a.startsAt >= mon && a.startsAt < end).sort(by("startsAt")).map((a) => WEEKDAYS[weekday(a.startsAt)]));
  const k = c.referrerId ? d.profiles.find((u) => u.id === c.referrerId) : null;
  const sched = days.length ? `Den här veckan (${fmtWeek(d.e.today)}) är deltagaren schemalagd ${listJoin(days)}.` : "Veckans schema är inte klart ännu.";
  return `${k ? `Hej ${k.fullName.split(" ")[0]}!` : "Hej!"}\n\nTack för ditt mejl om ${c.caseNumber}. ${sched} ${c.leadCoachId ? `${personName(d.profiles, c.leadCoachId)} återkommer i dag med förslag på tid för uppföljningsmötet.` : ""}\n\nVänliga hälsningar\n${meName}\nMiljonbemanning`;
}

// ---------------------------------------------------------------- Detaljvyn
export async function buildItem(ctx: Ctx, id: string): Promise<InboxItemDetail | null> {
  const e = await inboxEnv(ctx);
  const d = await loadInbox(ctx, e);
  const it = d.items.find((x) => x.id === id);
  if (!it) return null;
  const c = it.case;
  const m = it.email;
  const areas = await ctx.repo.table("contract_areas").list({ contractId: e.contract.id });
  const out = await outboundFor(ctx, c?.id ?? null, null);
  const decision = isOpen(c) && it.cls === "order";
  // Prototypen: "Visa" bara med full åtkomst till ärendet (eller när mejlet inte hör till något ärende).
  const mayReveal = !c || !!it.person;

  let steps: string[] | null = null;
  let current = 0;
  if (it.cls === "order") {
    if (c && c.status === "declined") {
      steps = ["Mottaget", "Ordererkännande", "Avböjt"];
      current = 3;
    } else {
      steps = ["Mottaget", "Ordererkännande", "Beslut", "Orderbekräftelse"];
      current = !c ? 1 : isOpen(c) ? 2 : 4;
    }
  }
  const s = it.sla;
  const headSla = s
    ? { ...sla(s.dueAt, s.metAt, e.now), text: s.metAt ? `Besvarat ${whenText(s.metAt, e.now)}` : slaStatus(s.dueAt, null, { now: e.now }).tone === "ok" ? "Svar på avropet" : `Svar senast ${whenText(s.dueAt, e.now)}` }
    : null;

  // Rätta uppgifter: bara när avropet väntar på beslut.
  let correct: InboxItemDetail["correct"] = null;
  if (decision && c) {
    const ex = it.cls === "order" && m ? (m.extracted as Record<string, unknown>) : {};
    const conf = it.cls === "order" && m ? (m.confidence as Record<string, number | undefined>) : {};
    const str = (v: unknown) => (v == null ? "" : String(v));
    const init: Record<OrderFieldKey, string> = {
      desiredStart: c.desiredStart || "", orderPeriod: casePeriodValue(c) || str(ex.orderPeriod), plannedEnd: c.plannedEnd || str(ex.plannedEnd),
      orderPeriodReason: c.orderPeriodReason || str(ex.orderPeriodReason), buyerReference: c.buyerReference || "",
    };
    const currentVals: Record<OrderFieldKey, string> = {
      ...init, orderPeriod: casePeriodValue(c), plannedEnd: c.plannedEnd || "", orderPeriodReason: c.orderPeriodReason || "",
    };
    const lowNotes: Partial<Record<OrderFieldKey, string>> = {};
    for (const k of ORDER_FIELDS) {
      const v = ex[k];
      if (conf[k] != null && (conf[k] as number) < LOW && v !== "" && v != null) lowNotes[k] = ` AI var osäker (${pct(conf[k] as number, 0)}) – kontrollera mot originalet.`;
    }
    correct = {
      caseId: c.id, emailId: it.cls === "order" && m ? m.id : null, init, current: currentVals, lowNotes,
      periods: { months: [...e.cfg.orderPeriods.months], allowOther: e.cfg.orderPeriods.allowOther }, ...refConfig(e),
    };
  }

  const base = {
    id: it.id, kind: it.kind, cls: it.cls, status: it.status, method: it.method, subject: it.subject, from: it.from, fromAddress: m?.fromAddress ?? null,
    receivedWhen: whenText(it.receivedAt, e.now),
    case: c ? { id: c.id, number: c.caseNumber, referrerId: c.referrerId, leadCoachId: c.leadCoachId, status: c.status } : null,
    headSla,
    handledText: m?.handledBy
      ? `Hanterat av ${personName(d.profiles, m.handledBy)} ${whenText(m.handledAt, e.now)}`
      : m?.registeredBy ? `Registrerad av ${personName(d.profiles, m.registeredBy)} ${whenText(m.registeredAt, e.now)}` : null,
    steps, current, decision, managerName: personName(d.profiles, e.contract.contractManagerId), correct,
  };

  // Komplettering
  if (it.cls === "supplement" && m) {
    if (!c) return { ...base, body: { kind: "supplement", linked: false } };
    const orig = d.emails.find((x) => x.caseId === c.id && x.classification === "order") ?? null;
    const applied = m.status === "applied";
    const ex = m.extracted as Record<string, unknown>;
    const canAccept = isOpen(c);
    const person = it.person;
    const due = avropDue(c, e.cfg);
    return {
      ...base,
      body: {
        kind: "supplement", linked: true, caseNumber: c.caseNumber, applied,
        appliedText: applied ? `Införda ${whenText(m.handledAt, e.now)} av ${personName(d.profiles, m.handledBy)}. ${canAccept ? "Nu kan avropet accepteras." : ""}` : null,
        canAccept, origEmailId: orig?.id ?? null,
        rows: Object.keys(ex).map((k) => {
          const conf = (m.confidence as Record<string, number | undefined>)[k] ?? 0;
          return { key: k, label: FIELD_LABEL[k as OrderField] || k, now: fmtField(k, caseValue(c, k), areas), next: fmtField(k, ex[k], areas), low: conf < LOW, pct: pct(conf, 0) };
        }),
        refErr: ex.buyerReference ? refError(String(ex.buyerReference), e) : null,
        original: originalView(m, mayReveal),
        caseCard: {
          caseId: c.id, caseNumber: c.caseNumber, status: c.status, displayName: person ? `${person.firstName} ${person.lastName}` : "–",
          areaName: areaName(areas, c.primaryAreaCode), buyerReference: c.buyerReference, sla: due ? sla(due, c.confirmedAt || c.declinedAt, e.now) : null,
        },
      },
    };
  }

  // Övrigt
  if (it.cls === "other" && m) {
    let caseCard = null;
    let custMsgs: { id: string; sender: string; when: string; unread: boolean; body: string }[] = [];
    let lastReply: { when: string; body: string } | null = null;
    let replyMail: string | null = null;
    let draft = "";
    if (c) {
      const person = it.person;
      const msgs = (await ctx.repo.table("messages").list({ caseId: c.id })).sort(by("createdAt"));
      const isCustomer = (id: string) => {
        const p = d.profiles.find((u) => u.id === id);
        return !!p && p.organizationId !== e.contract.supplierId;
      };
      const replies = msgs.filter((x) => x.createdAt >= m.receivedAt && !isCustomer(x.senderId));
      custMsgs = msgs.filter((x) => isCustomer(x.senderId)).slice(-2).map((x) => ({ id: x.id, sender: personName(d.profiles, x.senderId), when: whenText(x.createdAt, e.now), unread: x.readBy.length === 0, body: x.body }));
      const last = replies[replies.length - 1];
      if (last) {
        lastReply = { when: whenText(last.createdAt, e.now), body: last.body };
        replyMail = out.filter((n) => n.caseId === c.id && n.template === "nytt_meddelande" && n.createdAt >= last.createdAt)[0]?.body ?? null;
      }
      const acts = await ctx.repo.table("activities").list({ caseId: c.id });
      draft = replyDraft(d, c, acts, personName(d.profiles, ctx.actor.userId));
      caseCard = {
        caseId: c.id, caseNumber: c.caseNumber, displayName: person ? `${person.firstName} ${person.lastName}` : "–",
        coachName: personName(d.profiles, c.leadCoachId), status: c.status, phase: phaseLabel(e.cfg, c.phase),
      };
    }
    return {
      ...base,
      body: {
        kind: "other", caseNumber: c?.caseNumber ?? null, cancellation: looksLikeCancellation(m.subject, m.bodyText), original: originalView(m, mayReveal), caseCard, custMsgs, draft, lastReply, replyMail,
        handled: m.status === "handled", handledText: m.status === "handled" ? `Hanterad av ${personName(d.profiles, m.handledBy)} ${whenText(m.handledAt, e.now)}` : null,
      },
    };
  }

  // Beställning (mejl, portal eller telefon)
  const pendingDecision = isOpen(c);
  const missingKeys = m ? m.missingFields.filter((k) => { const v = (m.extracted as Record<string, unknown>)[k]; return v == null || v === ""; }) : [];
  const ack = ackView(it, d, out, ctx.crypto);
  let missing = null;
  if (pendingDecision && missingKeys.length) {
    // Beställarreferensen är valfri (beslut 2026-10-07) – ingen uppgift i mejlet stoppar ett beslut. Omfattningen väljs i
    // acceptdialogen om den saknas.
    missing = {
      title: `Saknas: ${missingKeys.map((k) => FIELD_LABEL[k].toLowerCase()).join(", ")}`, critical: false,
      text: ack.kind === "sent" && /saknar|kunde inte/.test(ack.body) ? `Ordererkännandet bad kommunen svara med uppgifterna (${ack.when}).` : "",
    };
  }
  // Registrerad av Miljonbemanning (beslut 4a): ärendets uppgifter visas i stället för en tolkning, originalmejlet bara när det finns.
  const registered = !!m?.registeredBy;
  // Ett inläst avrop utan ärende: tolkningen räckte inte (eller personen har redan en insats) – registreras för hand.
  const register = m && !c && it.cls === "order" && isPending(m.status)
    ? { emailId: m.id, reason: m.parseMethod === "manual" ? "Mejlet kunde inte tolkas automatiskt – uppgifterna skrivs in av en människa." : "Uppgifterna i mejlet räckte inte för att skapa ärendet automatiskt. Kontrollera dem mot originalet och registrera beställningen." }
    : null;
  return {
    ...base,
    body: {
      kind: "order", register, decided: !!c && DECIDED.includes(c.status), declined: c && c.status === "declined" ? await declinedView(ctx, d, c, out) : null,
      pendingSups: pendingSups(d, c), missing, refProblem: c && pendingDecision && c.buyerReference ? refError(c.buyerReference, e) : null,
      original: m && (m.bodyText || !registered) ? originalView(m, mayReveal) : null,
      parsed: m && !registered ? await parsedView(ctx, d, m, c, areas) : null,
      caseFields: c && (!m || registered) ? caseFieldsView(d, c, areas) : null,
      ack, dup: c ? await duplicateView(ctx, d, c) : null,
    },
  };
}

// ---------------------------------------------------------------- Orderbekräftelsen
const CHANNEL: Record<string, [string, "phone" | "mail"]> = { sms: ["SMS", "phone"], email: ["e-post", "mail"], brev: ["brev", "mail"] };

export async function buildConfirmation(ctx: Ctx, caseId: string): Promise<ConfirmationView | null> {
  const c = await ctx.repo.table("cases").get(caseId);
  if (!c) return null;
  const e = await inboxEnv(ctx);
  const profiles = await ctx.repo.table("profiles").list();
  const name = (id: string | null | undefined) => personName(profiles, id);
  const person = await ctx.repo.table("persons").get(c.personId);
  const rep = await ctx.repo.table("reports").first({ caseId: c.id, kind: "order_confirmation" });
  const by = (await ctx.system.table("case_status_history").list({ caseId: c.id, toStatus: "confirmed" })).sort((a, b) => (a.changedAt < b.changedAt ? -1 : a.changedAt > b.changedAt ? 1 : 0)).slice(-1)[0];
  // ctx.system: notisen om tilldelningen är mottagarens (user_notifications läses bara av mottagaren), men samordnaren ska
  // se att coachen fått den. Bara mottagarens namn och e-posttexten (utan personuppgifter) lämnas ut.
  const notifs = (await ctx.system.table("user_notifications").list({ caseId: c.id, kind: "assignment" })).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const leadNotif = notifs.find((n) => n.recipientId === c.leadCoachId);
  const others = notifs.filter((n) => n.recipientId !== c.leadCoachId).map((n) => name(n.recipientId));
  const out = await outboundFor(ctx, c.id, null);
  const custMail = out.filter((n) => n.template === "orderbekraftelse").slice(-1)[0];
  const kallelse = out.filter((n) => n.template === "kallelse").slice(-1)[0];
  const team = (await ctx.repo.table("case_team").list({ caseId: c.id })).filter((t) => t.role !== "lead_coach");
  const [chLabel, chIcon]: [string, "phone" | "mail"] = kallelse ? CHANNEL[kallelse.channel] ?? [kallelse.channel, "mail"] : ["", "mail"];
  // Telefon är ett val bara när det finns ett nummer: utan telefonnummer och e-postadress är det förvalet (beslut 2026-10-09).
  const noContact = !!person && !hasContactDetails(person);
  const prefersPhone = person?.preferredContact === "phone";
  return {
    caseId: c.id, caseNumber: c.caseNumber, referrerId: c.referrerId, leadCoachId: c.leadCoachId,
    reportId: rep && canOpen("rapport.visa", ctx.actor.role) ? rep.id : null,
    confirmed: `${whenText(c.confirmedAt, e.now)}${by ? ` av ${name(by.changedBy)}` : ""}`,
    coachName: name(c.leadCoachId),
    team: team.length ? team.map((t) => `${name(t.userId)} (${lc(teamLabel(t.role))})`).join(", ") : "Bara huvudcoach",
    firstMeeting: c.firstMeetingAt ? fmtDateTimeLong(c.firstMeetingAt) : "Inte bokat ännu",
    planned: `${orderPeriodText(c)}${c.plannedEnd ? `, till och med ${fmtDate(c.plannedEnd)}` : ""}`,
    buyerReference: c.buyerReference || "–",
    leadNotif: leadNotif ? { title: `${name(c.leadCoachId)} har fått en notis om tilldelningen`, emailBody: leadNotif.emailBody, others: others.length ? ` Även ${listJoin(others)} har fått en notis.` : "" } : null,
    custMail: custMail?.body ?? null,
    kallelse: kallelse
      ? {
          title: noContact
            ? "Kontaktuppgift saknas – kontakta handläggaren. Kallelsen når inte deltagaren:"
            : prefersPhone ? `Deltagaren fick kallelse via ${chLabel} och har valt telefon – coachen ringer också:` : `Deltagaren fick kallelse via ${chLabel}, sin föredragna kontaktväg:`,
          icon: chIcon, body: kallelse.body,
        }
      : null,
  };
}

// ---------------------------------------------------------------- Dialogerna Acceptera och Avböj
export async function buildDecisionForm(ctx: Ctx, caseId: string): Promise<DecisionForm | null> {
  const e = await inboxEnv(ctx);
  const d = await loadInbox(ctx, e);
  const c = d.caseById.get(caseId);
  if (!c) return null;
  const person = (await ctx.repo.table("persons").get(c.personId)) ?? null;
  const memberships = await ctx.repo.table("memberships").list({ contractId: e.contract.id });
  const areas = await ctx.repo.table("contract_areas").list({ contractId: e.contract.id });
  const active = (uid: string) => d.cases.filter((x) => x.leadCoachId === uid && ["confirmed", "active", "paused"].includes(x.status)).length;
  // Teamet bygger på medlemskapens roller (beslut 2026-10-08) – inte profiles.teamRole, som bara testdatat sätter.
  const cand = await teamCandidates(ctx, e.contract.id);
  const due = firstMeetingDue(c, e.cfg);
  const avrop = avropDue(c, e.cfg);
  const sup = pendingSups(d, c)[0] ?? null;
  const activeAreas = areas.filter((a) => a.active);
  return {
    caseId: c.id, caseNumber: c.caseNumber, from: c.referrerId ? personName(d.profiles, c.referrerId) : c.referrerName ?? "–",
    areaName: c.primaryAreaCode ? areaName(areas, c.primaryAreaCode) : "Avtalsområde inte valt",
    displayName: person ? `${person.firstName} ${person.lastName}` : "–", avropSla: avrop ? sla(avrop, null, e.now) : null,
    coaches: coachesOf({ profiles: d.profiles, memberships }, e.contract.id).map((u) => ({ id: u.id, name: u.fullName, active: active(u.id) })),
    staff: cand.staff,
    firstMeetingDue: due, desiredStart: c.desiredStart, buyerReference: c.buyerReference, referredAt: c.referredAt, today: e.today,
    defaultDate: addWorkingDays(e.today, 2), meetingText: meetingDaysText(meetingDays(e.cfg)), ...refConfig(e),
    areas: activeAreas.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })),
    primaryArea: c.primaryAreaCode, secondaryArea: c.secondaryAreaCode, vocationalTrack: c.vocationalTrack,
    tracks: Object.fromEntries(activeAreas.map((a) => [a.code, [...(TRACKS[a.code] ?? [])]])),
    periods: { months: [...e.cfg.orderPeriods.months], allowOther: e.cfg.orderPeriods.allowOther },
    orderPeriodMonths: c.orderPeriodMonths, orderPeriodReason: c.orderPeriodReason, plannedEnd: c.plannedEnd, plannedWeeks: c.plannedWeeks,
    background: await caseBackground(ctx, c),
    pendingSup: sup, declined: d.cases.filter((x) => x.status === "declined").length, total: d.cases.length,
  };
}

// ---------------------------------------------------------------- Startsidan
const alertPhase = (kind: string, key: string): number | null => (kind === "pulse_contact" || kind === "pulse_low" || key.startsWith("kpi:resultatgrad") ? 2 : null);

function miniDeadline(x: DeadlineRow & { aggregate?: { count: number } }): MiniDeadline {
  const sub = [x.caseId && !x.aggregate ? x.caseNumber : null, dlDesc(x.kind, x.label)].filter(Boolean).join(" · ") || null;
  return { id: x.id, kind: x.kind, label: kindLabel(x.kind), sub, dueAt: x.dueAt, sla: x.sla, href: x.href, provisional: x.provisional, count: x.aggregate?.count ?? null };
}

export async function buildStart(ctx: Ctx): Promise<StartView> {
  const role = ctx.actor.role;
  const e = await inboxEnv(ctx);
  const d = await loadInbox(ctx, e);
  const ops = await loadOps(ctx, e);
  const visible = await visibleCaseIds(ctx, e);
  const now = e.now;
  const name = (id: string | null | undefined) => personName(d.profiles, id);

  const pending = inboxToHandle(d.items);
  const items = pending.map((x) => toRow(x, now));
  const orders = pending.filter((x) => x.sla && ["order", "supplement"].includes(x.cls) && !x.sla.metAt).sort(sortPending);
  const urgent = orders[0] ? toRow(orders[0], now) : null;

  const alerts = alertItems(ops, e, ctx.actor, visible);
  const acked = alertItems(ops, e, ctx.actor, visible, true).filter((a) => a.ack);
  const fmFlags = new Set(alerts.filter((a) => a.kind === "first_meeting").map((a) => a.caseId));
  const fmCases = d.cases.filter((c) => c.status === "confirmed" && !c.firstMeetingAt).sort(by<Case>("referredAt"));
  const areas = await ctx.repo.table("contract_areas").list({ contractId: e.contract.id });
  const noCoach = d.cases.filter((c) => !c.leadCoachId && ["received", "acknowledged", "confirmed", "active", "paused"].includes(c.status)).sort(by<Case>("referredAt"));
  // Insatser att starta (beslut 2026-10-08): bekräftade ärenden vars första möte är i dag eller har passerat.
  const toStart = d.cases.filter((c) => c.status === "confirmed" && !!c.firstMeetingAt && dayOf(c.firstMeetingAt) <= e.today).sort(by<Case>("firstMeetingAt"));
  const flagText = flagDaysText(e.org.alerts.firstMeetingNotBookedAfterDays);

  const dls = deadlineItems(ops, e, visible, 7).map((x) => deadlineRow(x, ops, e, role));
  const reportsHref = hrefFor({ view: "rapporter.lista", params: {} }, role);
  const dlSoon = groupDeadlines(dls.filter((x) => x.bucket !== "week"), reportsHref);
  const dlWeek = groupDeadlines(dls.filter((x) => x.bucket === "week"), reportsHref);
  const cdDue = new Map(deadlineItems(ops, e, visible, 366).filter((x) => x.kind === "atgardsplan").map((x) => [x.id.replace(/^cd:/, ""), x.dueAt]));

  const tasks = (await ctx.repo.table("tasks").list({ toRole: role, status: "open" })).sort(by("createdAt", -1));
  const cds = (await ctx.repo.table("contract_deviations").list({ contractId: e.contract.id })).filter((x) => x.status !== "closed").sort(by("actionPlanDue"));
  const allCds = await ctx.repo.table("contract_deviations").list({ contractId: e.contract.id });
  // ctx.system: de senaste notiserna om tilldelning (till coacher och team) visas för samordnaren som kvittens.
  // Bara mottagarens namn, ärendenumret och tiden lämnas ut – e-posttexten innehåller bara ärendenumret.
  const assignNotifs = (await ctx.system.table("user_notifications").list({ kind: "assignment" }))
    .filter((n) => !n.caseId || visible.has(n.caseId)).sort(by("createdAt", -1)).slice(0, 3);
  const counters = await ctx.repo.table("case_counters").list({ contractId: e.contract.id });
  const summaryReport = role === "avtalsansvarig"
    ? (await ctx.repo.table("reports").list({ contractId: e.contract.id, kind: "customer_summary" })).filter((r) => r.status !== "delivered" && r.status !== "opened").sort(by<Report>((r) => r.dueAt ?? ""))[0] ?? null
    : null;

  const hour = Number(timeOf(now).slice(0, 2));
  const greet = hour < 10 ? "God morgon" : hour < 17 ? "Hej" : "God kväll";
  const me = d.profiles.find((u) => u.id === ctx.actor.userId);
  const wd = fmtWeekday(now);
  const lastMonth = addMonths(monthKey(now), -1);

  const kpis: KpiCardView[] = [];
  for (const key of ["avrop_besvarade_i_tid", "forsta_mote_inom_en_vecka"]) {
    const v = kpiValue(ops, key, {}, e.env);
    if (!v) continue;
    // Begränsade testare: utfallet visas, men inte Miljonbemannings interna mål eller om utfallet når det.
    const hide = e.hideCommercial;
    kpis.push({
      key, label: v.label, value: v.value == null ? "–" : pct(v.value), below: !hide && v.status === "below_internal",
      // Inga avrop i månaden: bara månaden (rutan säger "Inga avrop ännu").
      sub: v.den === 0 ? monthName(lastMonth).replace(/^./, (x) => x.toUpperCase()) : `${v.num} av ${v.den} · ${monthName(lastMonth)}${v.targetUnset && !hide ? " · mål ej fastställt" : ""}`,
      meter: v.value != null
        ? hide
          ? { value: v.value, valueText: pct(v.value), target: null, targetText: "" }
          : { value: v.value, valueText: `${pct(v.value)} av målet`, target: v.target, targetText: v.target != null ? `Internt mål ${pct(v.target, 0)}` : "" }
        : null,
      late: (v.late ?? []).filter((c) => visible.has(c.id)).map((c) => ({ caseId: c.id, caseNumber: c.caseNumber })),
    });
  }

  const alertView = (a: (typeof alerts)[number]): AlertView => ({
    key: a.key, severity: a.severity, title: a.title, text: a.text, when: whenText(a.createdAt, now), phase: alertPhase(a.kind, a.key), href: hrefFor(a.link, role),
  });
  const cdHref = hrefFor({ view: "chef.avvikelser", params: {} }, role);
  const warnings = allCds.filter((x) => x.warningIssued).length;
  const max = e.cfg.warningsBeforeTermination;

  return {
    lead: `${greet}${me ? `, ${me.fullName.split(" ")[0]}` : ""}! ${wd.replace(/^./, (x) => x.toUpperCase())}, ${fmtWeek(now)}. Det mest brådskande står först.`,
    items, urgent,
    firstMeetings: {
      flagged: fmFlags.size,
      rows: fmCases.map((c) => {
        const due = firstMeetingDue(c, e.cfg);
        return {
          caseId: c.id, caseNumber: c.caseNumber, due: due ? sla(due, null, now) : null, coachName: name(c.leadCoachId),
          dueText: due ? fmtWeekday(due) : "–",
          sub: `Coach ${name(c.leadCoachId)} · mottaget ${fmtDate(c.referredAt)}${fmFlags.has(c.id) ? ` · flaggat efter ${flagText}` : ""}`,
        };
      }),
    },
    deadlines: {
      soon: dlSoon.map(miniDeadline), week: dlWeek.slice(0, 3).map(miniDeadline), weekGrouped: dlWeek.length, soonCount: dls.filter((x) => x.bucket !== "week").length,
      overdue: dls.filter((x) => x.bucket === "overdue").length, weekCount: dls.filter((x) => x.bucket === "week").length,
    },
    alerts: alerts.map(alertView),
    acked: acked.map((a) => ({ key: a.key, title: a.title, text: `Kvitterad av ${name(a.ack?.by)} ${whenText(a.ack?.at, now)}. Åtgärd: ${a.ack?.plan ?? ""}` })),
    notifyEmail: e.org.notifications.onAssignment.channels.includes("email"),
    kpis,
    assign: {
      quote: assignNotifs[0]?.emailBody ?? `Du har fått ett nytt ärende i Miljonmatch: ${previewNextCaseNumber({ case_counters: counters }, { contractId: e.contract.id, now, cfg: e.cfg })}. Logga in för att se detaljerna.`,
      latest: assignNotifs.map((n) => ({ id: n.id, name: name(n.recipientId), caseNumber: (n.caseId ? d.caseById.get(n.caseId)?.caseNumber : "") ?? "", when: whenText(n.createdAt, now) })),
    },
    noCoach: noCoach.map((c) => {
      const due = avropDue(c, e.cfg);
      return { caseId: c.id, caseNumber: c.caseNumber, sla: due ? sla(due, null, now) : null, sub: `${areaName(areas, c.primaryAreaCode)} · ${c.referrerId ? name(c.referrerId) : c.referrerName ?? "–"}` };
    }),
    toStart: toStart.map((c) => ({
      caseId: c.id, caseNumber: c.caseNumber, firstMeetingAt: c.firstMeetingAt as string, coachName: name(c.leadCoachId),
      sub: `Första mötet ${fmtDateTimeLong(c.firstMeetingAt as string)} · coach ${name(c.leadCoachId)}`,
    })),
    tasks: tasks.map((t) => ({
      id: t.id, text: t.text, sub: `${t.fromId === "system" ? "Skapad automatiskt" : `Från ${name(t.fromId)}`} · ${whenText(t.createdAt, now)}`,
      emailId: t.emailId, caseId: !t.emailId && t.caseIds.length === 1 ? t.caseIds[0] : null,
    })),
    deviations: cds.map((x) => {
      const step = e.cfg.escalationLadder.find((s) => s.step === x.escalationStep);
      const dueAt = cdDue.get(x.id) || x.actionPlanDue;
      return {
        id: x.id, description: x.description,
        // Läget ur fälten (cdStatusKey): godkänd bara när kommunens godkännande är registrerat – inte så fort en åtgärdsplan finns (beslut 9, 2026-10-08).
        sub: `${x.source === "beställare" ? "Från kommunen" : x.source === "deltagare" ? "Från deltagare" : "Intern"} · ${x.level}${step ? ` · steg ${step.step} i eskaleringstrappan` : ""} · ${CD_SUB_TEXT[cdStatusKey(x)]}`,
        due: x.actionPlanDue && dueAt ? sla(dueAt, null, now) : null, href: cdHref ? `/avtalsavvikelser/${encodeURIComponent(x.id)}` : null,
      };
    }),
    deviationsHref: cdHref,
    summaryReport: summaryReport
      ? { id: summaryReport.id, title: `Beställarrapport ${summaryReport.month ? monthName(summaryReport.month) : ""} att godkänna`, due: summaryReport.dueAt ? sla(summaryReport.dueAt, null, now) : null, href: hrefFor({ view: "rapport.visa", params: { reportId: summaryReport.id } }, role) }
      : null,
    // Inga viten i kronor (belopp syns bara för ekonomen, beslut 5) – antalet varningar finns kvar.
    warnings: { issued: warnings, max, text: `${max} varningar kan leda till uppsägning.` },
    meetingText: meetingDaysText(meetingDays(e.cfg)),
    flagDaysText: flagText,
    today: e.today,
  };
}

// ---------------------------------------------------------------- Förfaller
export async function buildDeadlines(ctx: Ctx): Promise<DeadlinesView> {
  const e = await inboxEnv(ctx);
  const ops = await loadOps(ctx, e);
  const visible = await visibleCaseIds(ctx, e);
  const rows = deadlineItems(ops, e, visible, 7).map((x) => deadlineRow(x, ops, e, ctx.actor.role));
  const unset = e.cfg.sla.filter((s) => isUnset(s.due) || isUnset(s.within));
  return {
    eyebrow: `${fmtWeekday(e.now)} · ${fmtWeek(e.now)}`,
    today: fmtWeekday(e.today),
    rows,
    reportsHref: hrefFor({ view: "rapporter.lista", params: {} }, ctx.actor.role),
    unsetText: unset.length
      ? unset.map((s) => `${(s.label ?? s.key).toLowerCase()} – ${String(s.due || s.within).replace(/^ATT_FASTSTÄLLA\s*\(?/, "").replace(/\)$/, "")}`).join("; ")
      : null,
  };
}
