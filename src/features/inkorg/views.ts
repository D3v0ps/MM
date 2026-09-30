// Vy-modellerna för skärmarna i området inkorg (startsidan, avropsinkorgen, förfaller) – port av prototypens
// views/inkorg.js. Bara för hanterare. Läsning via ctx.repo; ctx.system bara där det står en kommentar om varför.
import type { Role } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { buyerRefLengthText, isUnset, phaseLabel } from "@/core/config";
import { coaches as coachesOf, duplicateActive, previewNextCaseNumber, priceFor } from "@/core/cases";
import { kr, pct } from "@/core/format";
import { kpiValue } from "@/core/kpi";
import { areaName, contactLabel, personName, teamLabel } from "@/core/labels";
import { avropDue, firstMeetingDue, slaStatus } from "@/core/sla";
import { addDays, addMonths, addWorkingDays, diffMinutes, fmtDate, fmtDateTimeLong, fmtWeek, fmtWeekday, monday, monthKey, monthName, timeOf, weekday, WEEKDAYS } from "@/core/time";
import { by, uniq } from "@/core/util";
import type { Case, CaseStatusHistory, ContractArea, InboundEmail, OrderField, OutboundMessage, Person, Report } from "@/data/schema";
import type {
  AckView, AlertView, CaseFieldsView, ConfirmationView, DeadlinesView, DecisionForm, DeclinedView, DuplicateView, FieldGroup, FieldNote, FormField, InboxItemDetail,
  InboxList, KpiCardView, MiniDeadline, OriginalView, ParsedView, PendingSupplement, PhoneForm, PnrView, StartView,
} from "./api";
import {
  ackMinutes, alertItems, answerDays, canOpen, caseProtected, deadlineItems, deadlineRow, hasPnrText, hrefFor, inboxEnv, inboxToHandle, loadInbox, loadOps, maskedPnr,
  maskPnrText, meetingDays, plainPnr, sla, sortPending, toRow, visibleCaseIds, type InboxData, type InboxEnv, type Item,
} from "./model";
import {
  dlDesc, FIELD_GROUPS, FIELD_LABEL, flagDaysText, groupDeadlines, kindLabel, lc, listJoin, LOW, meetingDaysText, METHOD, ORDER_FIELDS, refErrorMB,
  whenText, workingDaysText, type DeadlineRow, type OrderFieldKey,
} from "./texts";

const OPEN = ["acknowledged", "received"];
const DECIDED = ["confirmed", "active", "paused", "closed"];
const isOpen = (c: Pick<Case, "status"> | null | undefined) => !!c && OPEN.includes(c.status);
/** Skyddade avrop hanteras av avtalsansvarig enligt den säkra rutinen – inte av samordnaren. */
export const handlesProtected = (role: Role): boolean => role === "avtalsansvarig";
const PHONE_RE = /\b0\d{1,3}-\d{2,3}[ \d]{3,8}\d\b/;
const phoneIn = (text: string | null | undefined): string | null => {
  const m = String(text || "").match(PHONE_RE);
  return m ? m[0].trim() : null;
};
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
  if (k === "primaryArea" || k === "secondaryArea") return areaName(areas, String(v));
  if (k === "preferredContact") return contactLabel(String(v));
  if (k === "protectedIdentity") return v ? "Ja" : "Nej";
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
  const fromSup = (k: OrderField) => applied.find((x) => (x.extracted as Record<string, unknown>)[k] != null && (x.extracted as Record<string, unknown>)[k] !== "");
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
  const groups: FieldGroup[] = FIELD_GROUPS.map(([title, keys]) => ({
    title,
    fields: keys.map((k): FormField => {
      const base = { key: k, label: FIELD_LABEL[k], state: stateOf(k), note: note(k) };
      const v = ex[k];
      if (k === "pnr" && v != null && v !== "") return c ? { ...base, value: null, pnr: pnrView(c, person) } : { ...base, value: "••••••••-••••" };
      return { ...base, value: k === "pnr" ? null : fmtField(k, v, areas) };
    }),
  }));
  const all = groups.flatMap((g) => g.fields);
  // Samma körning för tolkningen (AI-körningar läses med ärendets behörighet).
  const run = m.aiRunId ? await ctx.repo.table("ai_runs").get(m.aiRunId) : null;
  return {
    method: m.parseMethod, help: METHOD[m.parseMethod]?.help ?? "", nMissing: all.filter((f) => f.state === "missing").length, nLow: all.filter((f) => f.state === "low").length,
    aiRun: run ? `Tolkat av ${run.provider} på ${Math.max(1, Math.round((run.latencyMs || 0) / 1000))} s.` : null, groups,
  };
}

/** Beställning utan mejl (portal eller telefon) – samma tre steg som mallen, utan konfidens. */
function caseFieldsView(d: InboxData, c: Case, areas: ContractArea[], title = "Beställningen"): CaseFieldsView {
  const p = d.personById.get(c.personId) ?? null;
  const k = c.referrerId ? d.profiles.find((u) => u.id === c.referrerId) ?? null : null;
  const prot = caseProtected(c, p);
  const full = !!p && !prot;
  const row = (label: string, value: string | null, missing = false, pnr?: PnrView): FormField => ({
    key: label, label, value, pnr, state: missing ? "missing" : "ok", note: missing ? { kind: "missing" } : null,
  });
  const groups: FieldGroup[] = [
    {
      title: "1. Beställning och kontakt",
      fields: [
        row("Handläggare", k?.fullName || c.referrerName || null), row("Enhet", k?.customerUnit || c.referrerUnit || null),
        row("Beställarreferens", c.buyerReference || null, !c.buyerReference), row("Önskat startdatum", c.desiredStart ? fmtDate(c.desiredStart) : null),
        row("Planerat slutdatum", c.plannedEnd ? fmtDate(c.plannedEnd) : null), row("Planerad omfattning", c.plannedWeeks ? `${c.plannedWeeks} veckor` : null),
      ],
    },
    {
      title: "2. Deltagare",
      fields: [
        row("Namn", p ? `${p.firstName} ${p.lastName}` : "Skyddade personuppgifter"), row("Personnummer", null, false, pnrView(c, p)),
        ...(full && p
          ? [row("Telefon", p.phone || null), row("E-post", p.email || null), row("Bostadsort", p.city || null),
            row("Föredragen kontaktväg", p.preferredContact ? contactLabel(p.preferredContact) : null), row("Behov av anpassning", p.accessibilityNeeds || null)]
          : []),
        row("Skyddade personuppgifter", prot ? "Ja – bara namn och personnummer sparas" : "Nej"),
      ],
    },
    {
      title: "3. Avtalsområde och yrkesspår",
      fields: [
        row("Avtalsområde (primärt)", c.primaryAreaCode ? areaName(areas, c.primaryAreaCode) : null, !c.primaryAreaCode),
        row("Avtalsområde (alternativt)", c.secondaryAreaCode ? areaName(areas, c.secondaryAreaCode) : null),
        row("Önskat yrkesspår", c.vocationalTrack || null), ...(full ? [row("Bakgrund", c.backgroundInfo || null)] : []),
      ],
    },
  ];
  return { title, method: c.source === "phone" ? "phone" : "portal", groups };
}

function ackView(it: Item, d: InboxData, out: OutboundMessage[]): AckView {
  const m = it.email;
  let n: OutboundMessage | null = null;
  if (m && m.classification === "order_protected") n = out.find((x) => x.template === "generisk_mottagningsbekraftelse" && x.to === m.fromAddress && x.createdAt >= m.receivedAt) ?? null;
  else if (it.case && it.cls === "order") n = out.find((x) => x.caseId === it.case?.id && x.template === "ordererkannande") ?? null;
  if (!n) {
    return {
      kind: "none",
      text: it.cls === "other" ? "Inget automatiskt svar. Mejl som klassas som Övrigt lämnas till en människa." : it.kind === "case" ? "Ordererkännandet visades direkt på skärmen för handläggaren." : "Inget automatiskt svar hittades.",
    };
  }
  const mins = Math.max(0, diffMinutes(it.receivedAt, n.createdAt));
  const limit = ackMinutes(d.e.cfg);
  const p = it.person;
  const leak = !!p && [p.firstName, p.lastName, plainPnr(p)].some((x) => x && n.body.includes(x));
  return { kind: "sent", generic: n.template === "generisk_mottagningsbekraftelse", ok: mins <= limit, mins, limit, when: whenText(n.createdAt, d.e.now), to: n.to, body: n.body, leak };
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
  const role = ctx.actor.role;
  const c = it.case;
  const m = it.email;
  const areas = await ctx.repo.table("contract_areas").list({ contractId: e.contract.id });
  const out = await outboundFor(ctx, c?.id ?? null, m?.classification === "order_protected" ? m.fromAddress : null);
  const prot = it.isProtected;
  const mine = !prot || handlesProtected(role);
  const decision = isOpen(c) && (it.cls === "order" || it.cls === "order_protected");
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
  if (it.cls === "order_protected") {
    steps = ["Mottaget", "Generisk bekräftelse", "Telefonsamtal", "Beslut", "Orderbekräftelse"];
    current = !c ? 2 : isOpen(c) ? 3 : 5;
    if (c && c.status === "declined") {
      steps = ["Mottaget", "Generisk bekräftelse", "Telefonsamtal", "Avböjt"];
      current = 4;
    }
  }
  const s = it.sla;
  const headSla = s
    ? { ...sla(s.dueAt, s.metAt, e.now), text: s.metAt ? `Besvarat ${whenText(s.metAt, e.now)}` : slaStatus(s.dueAt, null, { now: e.now }).tone === "ok" ? "Svar på avropet" : `Svar senast ${whenText(s.dueAt, e.now)}` }
    : null;

  // Rätta uppgifter: bara när avropet väntar på beslut och personen inte är skyddad.
  let correct: InboxItemDetail["correct"] = null;
  if (decision && mine && c && !caseProtected(c, it.person)) {
    const ex = it.cls === "order" && m ? (m.extracted as Record<string, unknown>) : {};
    const conf = it.cls === "order" && m ? (m.confidence as Record<string, number | undefined>) : {};
    const str = (v: unknown) => (v == null ? "" : String(v));
    const init: Record<OrderFieldKey, string> = {
      buyerReference: c.buyerReference || "", desiredStart: c.desiredStart || "", plannedEnd: c.plannedEnd || str(ex.plannedEnd), plannedWeeks: c.plannedWeeks ? String(c.plannedWeeks) : "",
      primaryArea: c.primaryAreaCode || "", secondaryArea: c.secondaryAreaCode || "", vocationalTrack: c.vocationalTrack || "",
    };
    const currentVals: Record<OrderFieldKey, string> = { ...init, plannedEnd: c.plannedEnd || "" };
    const lowNotes: Partial<Record<OrderFieldKey, string>> = {};
    for (const k of ORDER_FIELDS) {
      const v = ex[k];
      if (conf[k] != null && (conf[k] as number) < LOW && v !== "" && v != null) lowNotes[k] = ` AI var osäker (${pct(conf[k] as number, 0)}) – kontrollera mot originalet.`;
    }
    correct = {
      caseId: c.id, emailId: it.cls === "order" && m ? m.id : null, init, current: currentVals, lowNotes,
      areas: areas.filter((a) => a.active).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })), ...refConfig(e),
    };
  }

  const base = {
    id: it.id, kind: it.kind, cls: it.cls, status: it.status, method: it.method, subject: it.subject, from: it.from, fromAddress: m?.fromAddress ?? null,
    receivedWhen: whenText(it.receivedAt, e.now),
    case: c ? { id: c.id, number: c.caseNumber, referrerId: c.referrerId, leadCoachId: c.leadCoachId, status: c.status } : null,
    headSla, handledText: m?.handledBy ? `Hanterat av ${personName(d.profiles, m.handledBy)} ${whenText(m.handledAt, e.now)}` : null,
    steps, current, isProtected: prot, mine, decision, canPhone: it.cls === "order_protected" && !c && handlesProtected(role),
    managerName: personName(d.profiles, e.contract.contractManagerId), correct,
  };

  // Skyddade personuppgifter
  if (it.cls === "order_protected" && m) {
    const k = d.profiles.find((u) => u.email === m.fromAddress) ?? null;
    const handles = handlesProtected(role);
    const phone = phoneIn(m.bodyText) || k?.phone || "–";
    return {
      ...base,
      body: {
        kind: "protected", decided: !!c && DECIDED.includes(c.status), declined: c && c.status === "declined" ? await declinedView(ctx, d, c, out) : null,
        original: originalView(m, mayReveal),
        timeline: [
          { icon: "mail", filled: true, title: "Generisk mottagningsbekräftelse skickad", sub: m.ackSentAt ? whenText(m.ackSentAt, e.now) : "" },
          { icon: "flag", filled: true, tone: "red", title: `Flagga till avtalsansvarig ${personName(d.profiles, e.contract.contractManagerId)}`, sub: `${whenText(m.receivedAt, e.now)}${role === "avtalsansvarig" ? " · gäller dig" : ""}` },
          {
            icon: "phone", filled: !!c, title: `${handles ? "Ring" : "Avtalsansvarig ringer"} ${k?.fullName || "handläggaren"} på ${phone}`,
            sub: c ? `Klart – registrerat ${whenText(m.registeredAt, e.now)} av ${personName(d.profiles, m.registeredBy)}` : "Uppgifterna tas muntligt enligt den säkra rutinen",
          },
          { icon: "lock", filled: !!c, title: `${handles ? "Registrera" : "Avtalsansvarig registrerar"} minimala uppgifter`, sub: "Namn, personnummer och handläggare. Ingen adress, inga kontaktuppgifter till deltagaren." },
          { icon: "user", filled: !!c && !isOpen(c), title: "Acceptera och tilldela en namngiven coach", sub: "Bara coachen och avtalsansvarig får se namn och personnummer." },
        ],
        ack: ackView(it, d, out), caseFields: c ? caseFieldsView(d, c, areas, "Registrerat efter samtalet") : null,
      },
    };
  }

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
          caseId: c.id, caseNumber: c.caseNumber, status: c.status, displayName: person ? `${person.firstName} ${person.lastName}` : "Skyddade personuppgifter",
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
        caseId: c.id, caseNumber: c.caseNumber, displayName: person ? `${person.firstName} ${person.lastName}` : "Skyddade personuppgifter",
        coachName: personName(d.profiles, c.leadCoachId), status: c.status, phase: phaseLabel(e.cfg, c.phase),
      };
    }
    return {
      ...base,
      body: {
        kind: "other", caseNumber: c?.caseNumber ?? null, original: originalView(m, mayReveal), caseCard, custMsgs, draft, lastReply, replyMail,
        handled: m.status === "handled", handledText: m.status === "handled" ? `Hanterad av ${personName(d.profiles, m.handledBy)} ${whenText(m.handledAt, e.now)}` : null,
      },
    };
  }

  // Beställning (mejl, portal eller telefon)
  const pendingDecision = isOpen(c);
  const missingKeys = m ? m.missingFields.filter((k) => { const v = (m.extracted as Record<string, unknown>)[k]; return v == null || v === ""; }) : [];
  const ack = ackView(it, d, out);
  let missing = null;
  if (pendingDecision && missingKeys.length) {
    const critical = missingKeys.includes("buyerReference");
    missing = {
      title: `Saknas: ${missingKeys.map((k) => FIELD_LABEL[k].toLowerCase()).join(", ")}`, critical,
      text: `${ack.kind === "sent" && ack.body.includes("saknar") ? `Ordererkännandet bad kommunen svara med uppgifterna (${ack.when}). ` : ""}${critical ? "Ärendet kan inte bekräftas utan giltig beställarreferens." : ""}`,
    };
  }
  return {
    ...base,
    body: {
      kind: "order", decided: !!c && DECIDED.includes(c.status), declined: c && c.status === "declined" ? await declinedView(ctx, d, c, out) : null,
      pendingSups: pendingSups(d, c), missing, refProblem: c && pendingDecision && !missingKeys.length ? refError(c.buyerReference || "", e) : null,
      original: m ? originalView(m, mayReveal) : null, parsed: m ? await parsedView(ctx, d, m, c, areas) : null, caseFields: !m && c ? caseFieldsView(d, c, areas) : null,
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
  const prot = caseProtected(c, person);
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
  const weeks = c.orderValueWeeks || c.plannedWeeks;
  const priceItems = await ctx.repo.table("price_items").list({ contractId: c.contractId });
  const price = priceFor(priceItems, c.primaryAreaCode, c.startDate || c.plannedStart || e.today);
  const [chLabel, chIcon]: [string, "phone" | "mail"] = kallelse ? CHANNEL[kallelse.channel] ?? [kallelse.channel, "mail"] : ["", "mail"];
  const prefersPhone = person?.preferredContact === "phone";
  return {
    caseId: c.id, caseNumber: c.caseNumber, referrerId: c.referrerId, leadCoachId: c.leadCoachId,
    reportId: rep && canOpen("rapport.visa", ctx.actor.role) ? rep.id : null,
    confirmed: `${whenText(c.confirmedAt, e.now)}${by ? ` av ${name(by.changedBy)}` : ""}`,
    coachName: name(c.leadCoachId),
    team: team.length ? team.map((t) => `${name(t.userId)} (${lc(teamLabel(t.role))})`).join(", ") : "Bara huvudcoach",
    firstMeeting: c.firstMeetingAt ? fmtDateTimeLong(c.firstMeetingAt) : "Inte bokat ännu",
    planned: weeks ? `${weeks} veckor${c.plannedEnd ? `, till och med ${fmtDate(c.plannedEnd)}` : ""}` : "–",
    value: weeks && price ? `${kr(weeks * price)} (${weeks} veckor × ${kr(price)})` : "–",
    buyerReference: c.buyerReference || "–",
    leadNotif: leadNotif ? { title: `${name(c.leadCoachId)} har fått en notis om tilldelningen`, emailBody: leadNotif.emailBody, others: others.length ? ` Även ${listJoin(others)} har fått en notis.` : "" } : null,
    custMail: custMail?.body ?? null,
    isProtected: prot,
    kallelse: kallelse && !prot
      ? { title: prefersPhone ? `Deltagaren fick kallelse via ${chLabel} och har valt telefon – coachen ringer också:` : `Deltagaren fick kallelse via ${chLabel}, sin föredragna kontaktväg:`, icon: chIcon, body: kallelse.body }
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
  const helperIds = new Set(memberships.filter((x) => x.role === "handledare").map((x) => x.userId));
  const helpers = d.profiles.filter((u) => helperIds.has(u.id) && u.active !== false && u.teamRole && u.teamRole !== "lead_coach");
  const due = firstMeetingDue(c, e.cfg);
  const avrop = avropDue(c, e.cfg);
  const sup = pendingSups(d, c)[0] ?? null;
  const priceItems = await ctx.repo.table("price_items").list({ contractId: e.contract.id, areaCode: c.primaryAreaCode });
  return {
    caseId: c.id, caseNumber: c.caseNumber, from: c.referrerId ? personName(d.profiles, c.referrerId) : c.referrerName ?? "–", areaName: areaName(areas, c.primaryAreaCode),
    displayName: person ? `${person.firstName} ${person.lastName}` : "Skyddade personuppgifter", avropSla: avrop ? sla(avrop, null, e.now) : null,
    isProtected: caseProtected(c, person),
    coaches: coachesOf({ profiles: d.profiles, memberships }, e.contract.id).map((u) => ({ id: u.id, name: u.fullName, active: active(u.id) })),
    helpers: helpers.map((u) => ({ id: u.id, name: u.fullName, teamRole: u.teamRole as "vocational_supervisor" | "employer_matcher" | "guidance_counselor", label: lc(teamLabel(u.teamRole as string)) })),
    firstMeetingDue: due, desiredStart: c.desiredStart, plannedWeeks: c.plannedWeeks, buyerReference: c.buyerReference, referredAt: c.referredAt, today: e.today,
    defaultDate: addWorkingDays(e.today, 2), meetingText: meetingDaysText(meetingDays(e.cfg)), ...refConfig(e),
    prices: priceItems.map((p) => ({ validFrom: p.validFrom, validTo: p.validTo, priceOre: p.priceOre, exampleOnly: p.exampleOnly })),
    pendingSup: sup, declined: d.cases.filter((x) => x.status === "declined").length, total: d.cases.length,
  };
}

// ---------------------------------------------------------------- Registrering efter telefonsamtal
export async function buildPhoneForm(ctx: Ctx, emailId: string): Promise<PhoneForm | null> {
  const m = await ctx.repo.table("inbound_emails").get(emailId);
  if (!m) return null;
  const e = await inboxEnv(ctx);
  const k = await ctx.repo.table("profiles").first({ email: m.fromAddress });
  const br = k?.buyerReferenceId ? await ctx.repo.table("buyer_references").first({ id: k.buyerReferenceId, active: true }) : null;
  const areas = await ctx.repo.table("contract_areas").list({ contractId: e.contract.id, active: true });
  const counters = await ctx.repo.table("case_counters").list({ contractId: e.contract.id });
  return {
    emailId: m.id, referrerId: k?.id ?? null, referrerName: k?.fullName ?? null, unit: k?.customerUnit ?? null, brReference: br?.reference ?? null,
    phone: phoneIn(m.bodyText) || k?.phone || "–", areas: areas.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })),
    nextCaseNumber: previewNextCaseNumber({ case_counters: counters }, { contractId: e.contract.id, now: e.now, cfg: e.cfg }), ...refConfig(e),
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
  const orders = pending.filter((x) => x.sla && ["order", "order_protected", "supplement"].includes(x.cls) && !x.sla.metAt).sort(sortPending);
  const urgent = orders[0] ? toRow(orders[0], now) : null;

  const alerts = alertItems(ops, e, ctx.actor, visible);
  const acked = alertItems(ops, e, ctx.actor, visible, true).filter((a) => a.ack);
  const fmFlags = new Set(alerts.filter((a) => a.kind === "first_meeting").map((a) => a.caseId));
  const fmCases = d.cases.filter((c) => c.status === "confirmed" && !c.firstMeetingAt).sort(by<Case>("referredAt"));
  const fmPersonIds = fmCases.map((c) => c.personId);
  const persons = new Map((fmPersonIds.length ? await ctx.repo.table("persons").list({ id: { in: fmPersonIds } }) : []).map((p) => [p.id, p]));
  const areas = await ctx.repo.table("contract_areas").list({ contractId: e.contract.id });
  const noCoach = d.cases.filter((c) => !c.leadCoachId && ["received", "acknowledged", "confirmed", "active", "paused"].includes(c.status)).sort(by<Case>("referredAt"));
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
    kpis.push({
      key, label: v.label, value: v.value == null ? "–" : pct(v.value), below: v.status === "below_internal",
      sub: `${v.num} av ${v.den} · ${monthName(lastMonth)}${v.targetUnset ? " · mål ej fastställt" : ""}`,
      meter: v.value != null ? { value: v.value, valueText: `${pct(v.value)} av målet`, target: v.target, targetText: v.target != null ? `Internt mål ${pct(v.target, 0)}` : "" } : null,
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
          caseId: c.id, caseNumber: c.caseNumber, due: due ? sla(due, null, now) : null, isProtected: caseProtected(c, persons.get(c.personId)), coachName: name(c.leadCoachId),
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
    protectedItems: role === "avtalsansvarig"
      ? pending.filter((x) => x.cls === "order_protected" || (x.case && x.isProtected)).map((x) => ({ ...toRow(x, now), caseText: x.case ? `registrerat som ${x.case.caseNumber}` : "väntar på telefonsamtal" }))
      : [],
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
    tasks: tasks.map((t) => ({
      id: t.id, text: t.text, sub: `${t.fromId === "system" ? "Skapad automatiskt" : `Från ${name(t.fromId)}`} · ${whenText(t.createdAt, now)}`,
      emailId: t.emailId, caseId: !t.emailId && t.caseIds.length === 1 && t.kind === "protected_order" ? t.caseIds[0] : null,
    })),
    deviations: cds.map((x) => {
      const step = e.cfg.escalationLadder.find((s) => s.step === x.escalationStep);
      const dueAt = cdDue.get(x.id) || x.actionPlanDue;
      return {
        id: x.id, description: x.description,
        sub: `${x.source === "beställare" ? "Från kommunen" : x.source === "deltagare" ? "Från deltagare" : "Intern"} · ${x.level}${step ? ` · steg ${step.step} i eskaleringstrappan` : ""} · ${x.status === "action_plan" ? "åtgärdsplan godkänd av kommunen" : "öppen"}`,
        due: x.actionPlanDue && dueAt ? sla(dueAt, null, now) : null, href: cdHref ? `/avtalsavvikelser/${encodeURIComponent(x.id)}` : null,
      };
    }),
    deviationsHref: cdHref,
    summaryReport: summaryReport
      ? { id: summaryReport.id, title: `Beställarrapport ${summaryReport.month ? monthName(summaryReport.month) : ""} att godkänna`, due: summaryReport.dueAt ? sla(summaryReport.dueAt, null, now) : null, href: hrefFor({ view: "rapport.visa", params: { reportId: summaryReport.id } }, role) }
      : null,
    warnings: { issued: warnings, max, text: `${max} varningar kan leda till uppsägning. Vite ${kr(e.cfg.penalties.deviationOre)} per tillfälle vid avvikelse.` },
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
