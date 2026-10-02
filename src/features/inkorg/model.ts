// Byggstenar för områdets vy-modeller: inkorgens poster (prototypens buildItems och sel.inboxToHandle), flaggor och
// förfallotider. Bara för hanterare – importeras av ./handlers.ts och src/features/session/nav-handlers.ts, aldrig av skärmar.
import { ApiError, type Ctx, type PnrCrypto } from "@/api/server";
import type { Role } from "@/api/roles";
import { hidesCommercial } from "@/api/tester-access";
import { loadDb } from "@/api/load";
import { alerts as computeAlerts, type AlertItem } from "@/core/alerts";
import { isOperational, requireOperational, slaWithin, type OperationalConfig, type OrgSettings } from "@/core/config";
import { deadlines as computeDeadlines, type DeadlineItem } from "@/core/deadlines";
import { domainEnv, type DomainEnv } from "@/core/env";
import { personName } from "@/core/labels";
import { linkHref, type ViewId, type ViewLink } from "@/core/links";
import { scopeToContract } from "@/core/scope";
import { avropDue, slaStatus } from "@/core/sla";
import { addWorkingDays, dayOf, diffMinutes, fmtDateTimeLong, monday } from "@/core/time";
import type { Case, Contract, Db, InboundEmail, InboundEmailStatus, Person, Profile, TableName } from "@/data/schema";
import { orgSettingsFor } from "../_shared/context";
import { revealPnr } from "../_shared/pnr";
import type { InboxRow, SlaInfo } from "./api";
import { CHAIN, DL_KIND, FIELD_LABEL, whenText, type ChainKey, type DeadlineKindKey, type DeadlineRow, type InboxMethod } from "./texts";

// ---------------------------------------------------------------- Avtalet och klockan
/**
 * hideCommercial = begränsad testare i testmiljön (src/api/tester-access.ts): inga priser, belopp, viten i kronor,
 * fakturering eller interna mål i inkorgens, startsidans och förfallolistans vy-modeller.
 */
export type InboxEnv = { contract: Contract; cfg: OperationalConfig; org: OrgSettings; env: DomainEnv; now: string; today: string; hideCommercial: boolean };

/** Användarens första aktiva avtal med driftkonfiguration (Botkyrka i piloten). */
export async function inboxEnv(ctx: Ctx): Promise<InboxEnv> {
  const contracts = await ctx.repo.table("contracts").list({ status: "active" });
  const contract = ctx.actor.contractIds.map((id) => contracts.find((c) => c.id === id)).find((c): c is Contract => !!c && isOperational(c.config));
  if (!contract) throw new ApiError(404, "no_contract", "Det finns inget aktivt avtal.");
  const org = await orgSettingsFor(ctx, contract);
  const now = ctx.now();
  return { contract, cfg: requireOperational(contract.config), org, env: domainEnv(contract, org, now), now, today: dayOf(now), hideCommercial: hidesCommercial(ctx.actor) };
}

/** Svar på avrop inom så här många arbetsdagar (avtalskonfigurationen; prototypens standard 1). */
export const answerDays = (cfg: OperationalConfig): number => slaWithin(cfg, "avrop_svar")?.workingDays ?? 1;
/** Ordererkännande inom så här många minuter (prototypens standard 5). */
export const ackMinutes = (cfg: OperationalConfig): number => slaWithin(cfg, "ordererkannande")?.minutes ?? 5;
/** Första mötet inom så här många dagar (prototypens standard 7). */
export const meetingDays = (cfg: OperationalConfig): number => slaWithin(cfg, "forsta_mote")?.days ?? 7;

export const sla = (dueAt: string, metAt: string | null | undefined, now: string): SlaInfo => {
  const s = slaStatus(dueAt, metAt ?? null, { now });
  return { dueAt, metAt: metAt ?? null, sla: { label: s.label, tone: s.tone } };
};

// ---------------------------------------------------------------- Vyer som rollen kan öppna (prototypens canOpen)
// Rollerna per vy är den gamla prototypens (MM.registerView) och rutt-tabellen i docs/ARKITEKTUR.md.
const CASE_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];
const VIEW_ROLES: Record<ViewId, readonly Role[]> = {
  "sam.start": ["samordnare", "avtalsansvarig"],
  "sam.inkorg": ["samordnare", "avtalsansvarig"],
  "sam.deadlines": ["samordnare", "avtalsansvarig", "chef"],
  "arenden.lista": CASE_ROLES,
  "arende.kort": CASE_ROLES,
  "hand.start": ["handledare"],
  "coach.minvecka": ["coach"],
  "coach.narvaro": ["coach", "handledare"],
  "coach.avstamning": ["coach"],
  "coach.manad": ["coach"],
  "coach.kartlaggning": ["coach"],
  "coach.handelse": ["coach"],
  "rapporter.lista": ["samordnare", "avtalsansvarig", "coach", "chef"],
  "rapport.visa": ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "kommun_handlaggare", "kommun_chef"],
  "chef.oversikt": ["chef"],
  "chef.avvikelser": ["chef", "avtalsansvarig", "samordnare"],
  "eko.start": ["ekonom", "chef"],
  "eko.arende": ["ekonom", "chef"],
  "eko.faktura": ["ekonom", "chef"],
  "eko.korning": ["ekonom", "chef"],
  notiser: ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "ekonom", "admin"],
};
export const canOpen = (view: ViewId, role: Role): boolean => VIEW_ROLES[view].includes(role);
/** Sökvägen om rollen kan öppna vyn, annars null. */
export const hrefFor = (link: ViewLink | null | undefined, role: Role): string | null => (link && canOpen(link.view, role) ? linkHref(link) : null);

// ---------------------------------------------------------------- Personnummer
const PNR_RE = /\b((?:19|20)\d{6}|\d{6})([-+])(\d{4})\b/g;
/** Personnummer i fri text maskeras: "19750818-8340" → "••••••••-8340". */
export const maskPnrText = (text: string): string => String(text || "").replace(PNR_RE, (_m, a: string, sep: string, b: string) => `${"•".repeat(a.length)}${sep}${b}`);
export const hasPnrText = (text: string): boolean => /\b((?:19|20)\d{6}|\d{6})[-+]\d{4}\b/.test(String(text || ""));
/** Maskerat personnummer för visning (de fyra sista siffrorna). */
export const maskedPnr = (p: Pick<Person, "personnummerLast4"> | null | undefined): string | null => (p?.personnummerLast4 ? `••••••••-${p.personnummerLast4}` : null);
/**
 * Personnumret i klartext – bara för "Visa" (loggas) och kontrollen att utskick saknar personnummer.
 * Dekrypteras via ctx.crypto: minnesläget testdatats ersättning, servern AES-256-GCM (CLAUDE.md punkt 2).
 */
export function plainPnr(crypto: PnrCrypto, p: Pick<Person, "personnummerEnc"> | null | undefined): string {
  return revealPnr(crypto, p);
}

// ---------------------------------------------------------------- Inkorgens poster
const PENDING: readonly InboundEmailStatus[] = ["acknowledged", "protected", "other", "linked", "received"];
const OPEN_CASE = (c: Pick<Case, "status">) => c.status === "acknowledged" || c.status === "received";

export type Item = {
  id: string;
  kind: "email" | "case";
  email: InboundEmail | null;
  case: Case | null;
  /** Personen om rollen får se den (null vid skyddade personuppgifter för samordnaren). */
  person: Person | null;
  receivedAt: string;
  from: string;
  subject: string;
  method: InboxMethod;
  cls: InboundEmail["classification"];
  status: string;
  pending: boolean;
  handledAt: string | null;
  sla: { dueAt: string; metAt: string | null } | null;
  isProtected: boolean;
};

export type InboxData = {
  e: InboxEnv;
  items: Item[];
  emails: InboundEmail[];
  cases: Case[];
  caseById: Map<string, Case>;
  personById: Map<string, Person>;
  profiles: Profile[];
};

/** Skyddade personuppgifter: personen är skyddad, eller rollen får se ärendet men inte personen (samordnare, chef). */
export const caseProtected = (c: Case | null, person: Person | null | undefined): boolean => !!c && (!person || person.protectedIdentity);

/**
 * Läs inkorgen: mejl till avrop@ och beställningar utan mejl (portal och telefon). Beställningar utan mejl visas när de
 * väntar på svar, eller om de kom in denna vecka (prototypen: de som skapats i demon) – äldre finns under Ärenden.
 */
export async function loadInbox(ctx: Ctx, e: InboxEnv): Promise<InboxData> {
  const [emails, cases, profiles] = await Promise.all([
    ctx.repo.table("inbound_emails").list(),
    ctx.repo.table("cases").list({ contractId: e.contract.id }),
    ctx.repo.table("profiles").list(),
  ]);
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const withEmail = new Set(emails.map((m) => m.caseId).filter((x): x is string => !!x));
  const weekStart = monday(e.today);
  const nonEmail = cases.filter((c) => !withEmail.has(c.id) && c.source !== "email" && (OPEN_CASE(c) || dayOf(c.referredAt) >= weekStart));
  const personIds = [...new Set([...emails.map((m) => (m.caseId ? caseById.get(m.caseId)?.personId : null)), ...nonEmail.map((c) => c.personId)].filter((x): x is string => !!x))];
  const persons = personIds.length ? await ctx.repo.table("persons").list({ id: { in: personIds } }) : [];
  const personById = new Map(persons.map((p) => [p.id, p]));
  const personOf = (c: Case | null) => (c ? personById.get(c.personId) ?? null : null);
  const days = answerDays(e.cfg);

  const items: Item[] = emails.map((m) => {
    const c = m.caseId ? caseById.get(m.caseId) ?? null : null;
    const person = personOf(c);
    return {
      id: m.id, kind: "email", email: m, case: c, person, receivedAt: m.receivedAt, from: m.fromName, subject: m.subject, method: m.parseMethod,
      cls: m.classification, status: m.status, pending: PENDING.includes(m.status), handledAt: m.handledAt,
      sla: null, isProtected: m.classification === "order_protected" || caseProtected(c, person),
    };
  });
  for (const c of nonEmail) {
    const open = OPEN_CASE(c);
    const phone = c.source === "phone";
    const person = personOf(c);
    items.push({
      id: `case:${c.id}`, kind: "case", email: null, case: c, person, receivedAt: c.referredAt,
      from: c.referrerId ? personName(profiles, c.referrerId) : c.referrerName ?? "–", subject: phone ? "Beställning per telefon" : "Beställning i portalen",
      method: phone ? "phone" : "portal", cls: "order", status: open ? c.status : c.status === "declined" ? "declined" : "accepted", pending: open,
      handledAt: c.confirmedAt || c.declinedAt || null, sla: null, isProtected: caseProtected(c, person),
    });
  }
  for (const it of items) {
    const c = it.case;
    const met = c ? c.confirmedAt || c.declinedAt || null : null;
    if (it.cls === "other") it.sla = null;
    else if (it.cls === "supplement") {
      const due = c ? avropDue(c, e.cfg) : null;
      it.sla = c && due ? { dueAt: due, metAt: met } : null;
    } else it.sla = { dueAt: addWorkingDays(it.receivedAt, days), metAt: met };
  }
  return { e, items, emails, cases, caseById, personById, profiles };
}

/** Mest brådskande först: förfallotid, sedan mottagningstid (prototypens sortPending). */
export const sortPending = (a: Item, b: Item): number => {
  const ad = a.sla ? a.sla.dueAt : "9999";
  const bd = b.sla ? b.sla.dueAt : "9999";
  return ad < bd ? -1 : ad > bd ? 1 : a.receivedAt < b.receivedAt ? -1 : 1;
};

/** Exakt samma lista som fliken "Att hantera" (prototypens MM.sel.inboxToHandle) – menyn, sammanfattningen och startsidan använder den. */
export const inboxToHandle = (items: readonly Item[]): Item[] => items.filter((x) => x.pending).sort(sortPending);

export function toRow(it: Item, now: string): InboxRow {
  const m = it.email;
  return {
    id: it.id, kind: it.kind, emailId: m?.id ?? null, caseId: it.case?.id ?? null, caseNumber: it.case?.caseNumber ?? null,
    receivedAt: it.receivedAt, receivedWhen: whenText(it.receivedAt, now), from: it.from, subject: it.subject, method: it.method, cls: it.cls, status: it.status,
    pending: it.pending, sla: it.sla ? sla(it.sla.dueAt, it.sla.metAt, now) : null, isProtected: it.isProtected,
    missing: (m?.missingFields ?? []).map((k) => FIELD_LABEL[k].toLowerCase()),
  };
}

// ---------------------------------------------------------------- Driftdata för flaggor, förfallotider och nyckeltal
// Flaggor (alerts), förfallotider (deadlines) och nyckeltal räknas i produktionen av ett schemalagt systemjobb och sparas
// i tabellerna alerts, deadlines och kpi_snapshots, som rollerna sedan läser med RLS (mottagarroll + att ärendet syns).
// Här räknas de direkt: ctx.system läser avtalets underlag (bara avtalets rader, scopeToContract) och resultatet filtreras
// sedan med samma regler som tabellernas – rollen i flaggan och att ärendet syns för användaren via ctx.repo.
// Inga personuppgifter lämnas ut: posterna innehåller ärendenummer, datum, antal och namn på Miljonbemannings personal.
const OPS_TABLES = [
  "cases", "activities", "attendance", "reports", "profiles", "memberships", "contract_deviations", "billing_runs", "deviations", "price_items",
  "buyer_references", "invoice_drafts", "billing_week_approvals", "pulse_responses", "check_ins", "placements", "inbound_emails",
] as const satisfies readonly TableName[];
export type OpsDb = Pick<Db, (typeof OPS_TABLES)[number] | "alert_acks">;

export async function loadOps(ctx: Ctx, e: InboxEnv): Promise<OpsDb> {
  const cid = e.contract.id;
  const db = await loadDb(ctx.system, OPS_TABLES, {
    cases: { contractId: cid }, reports: { contractId: cid }, memberships: { contractId: cid }, contract_deviations: { contractId: cid },
    billing_runs: { contractId: cid }, price_items: { contractId: cid }, invoice_drafts: { contractId: cid }, billing_week_approvals: { contractId: cid },
  });
  const scoped = scopeToContract(db, cid);
  // Kvitteringarna är användarens egen läsning (MB läser alert_acks).
  return { ...scoped, alert_acks: await ctx.repo.table("alert_acks").list() };
}

/** Ärenden som användaren ser (samma regel som tabellerna alerts och deadlines: ärendet ska synas). */
export async function visibleCaseIds(ctx: Ctx, e: InboxEnv): Promise<Set<string>> {
  return new Set((await ctx.repo.table("cases").list({ contractId: e.contract.id })).map((c) => c.id));
}

export function alertItems(ops: OpsDb, e: InboxEnv, actor: { role: Role; userId: string }, visible: Set<string>, includeAcked = false): AlertItem[] {
  return computeAlerts(ops, { role: actor.role, personaId: actor.userId, includeAcked, hideCommercial: e.hideCommercial }, e.env).filter((a) => !a.caseId || visible.has(a.caseId));
}

/** Förfallotider som användaren ser. Begränsade testare: utan fakturakörningen (ekonomens interna mål, länk till Ekonomi). */
export function deadlineItems(ops: OpsDb, e: InboxEnv, visible: Set<string>, days = 7): DeadlineItem[] {
  return computeDeadlines(ops, { days }, e.env).filter((x) => (!x.caseId || visible.has(x.caseId)) && !(e.hideCommercial && x.kind === "fakturering"));
}

// ---------------------------------------------------------------- Förfallorader (ansvarig och eskalering)
const OWNER_LABEL: Partial<Record<Role, string>> = { samordnare: "Samordnare", avtalsansvarig: "Avtalsansvarig", ekonom: "Ekonom", chef: "Chef och controller", coach: "Huvudcoach" };

/** Ansvarig och eskaleringsväg (prototypens ownerOf). */
function ownerOf(x: DeadlineItem, ops: OpsDb, e: InboxEnv): { name: string; chain: ChainKey } {
  const roleOf = (userId: string): Role | null => ops.memberships.find((m) => m.userId === userId)?.role ?? null;
  if (x.ownerId) {
    const r = roleOf(x.ownerId);
    return { name: personName(ops.profiles, x.ownerId), chain: r && r in CHAIN ? (r as ChainKey) : "coach" };
  }
  if (x.caseId && (x.kind === "manadsrapport" || x.kind === "slutrapport")) {
    const c = ops.cases.find((y) => y.id === x.caseId);
    if (c?.leadCoachId) return { name: personName(ops.profiles, c.leadCoachId), chain: "coach" };
  }
  if (x.owner) {
    // Rollens person i avtalet: avtalsansvarig från avtalet, annars den första med rollen.
    const pid = x.owner === "avtalsansvarig" ? e.contract.contractManagerId : ops.memberships.find((m) => m.role === x.owner)?.userId ?? null;
    const label = OWNER_LABEL[x.owner] ?? x.owner;
    return { name: `${label}${pid ? ` · ${personName(ops.profiles, pid)}` : ""}`, chain: x.owner in CHAIN ? (x.owner as ChainKey) : "samordnare" };
  }
  return { name: "–", chain: DL_KIND[x.kind as DeadlineKindKey]?.chain ?? "samordnare" };
}

/** Eskaleringssteg: i tid = ägaren; passerad = nästa steg; mer än ett dygn = sista steget. */
function escalationStep(x: DeadlineItem, chain: readonly string[], now: string): number {
  if (x.bucket !== "overdue") return 0;
  const hours = -diffMinutes(now, x.dueAt) / 60;
  return Math.min(chain.length - 1, hours > 24 ? 2 : 1);
}

export function deadlineRow(x: DeadlineItem, ops: OpsDb, e: InboxEnv, role: Role): DeadlineRow {
  const o = ownerOf(x, ops, e);
  const chain = CHAIN[o.chain] ?? CHAIN.samordnare;
  const c = x.caseId ? ops.cases.find((y) => y.id === x.caseId) ?? null : null;
  return {
    id: x.id, kind: x.kind as DeadlineKindKey, label: x.label, dueAt: x.dueAt, dueWhen: whenText(x.dueAt, e.now), dueLong: fmtDateTimeLong(x.dueAt),
    sla: { label: x.sla.label, tone: x.sla.tone }, bucket: x.bucket, caseId: x.caseId ?? null, caseNumber: c?.caseNumber ?? null, provisional: !!x.provisional,
    ownerName: o.name, chain, step: escalationStep(x, chain, e.now), href: hrefFor(x.link, role),
    coachName: x.kind === "manadsrapport" ? (c?.leadCoachId ? personName(ops.profiles, c.leadCoachId) : "Utan coach") : null,
  };
}
