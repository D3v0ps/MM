// Ärenden: ärendenummer, pris och ordervärde, ordererkännande, fas och "fastnat", dubbletter.
// Port av prototypens selektorer i prototyp/src/03-domain.js.
import type { Case, CaseCounter, CaseStatus, Db, InboundEmail, InboundEmailStatus, Person, PriceItem, Profile } from "@/data/schema";
import { stuckRule, type ContractConfig, type OperationalConfig } from "./config";
import { checkInsOf, placementsOf } from "./db-index";
import { plural } from "./format";
import type { DomainEnv } from "./env";
import { avropDue } from "./sla";
import { WEEKDAYS, dayOf, diffDays, fmtDateTimeFull, weekday, type LocalDate } from "./time";
import { by } from "./util";

// ---------------------------------------------------------------- Ärendenummer
/** Ärendenummer {prefix}-{ÅÅ}-{NNNN}, t.ex. "BOT-27-0049". Löpnumret fylls ut till fyra siffror. */
export function formatCaseNumber(prefix: string, year: number | string, seq: number): string {
  return `${prefix}-${String(year).slice(-2)}-${String(seq).padStart(4, "0")}`;
}
/** Id för löpnumret per avtal och år (case_counters.id). */
export const caseCounterId = (contractId: string, year: number | string): string => `${contractId}:${year}`;

/**
 * Nästa ärendenummer. Löpnumret räknas per avtal och år och återanvänds aldrig.
 * `counter` är raden i case_counters för avtalet och året (eller dess lastValue), null om ingen finns ännu.
 * Hanteraren sparar `lastValue` tillbaka i case_counters.
 */
export function nextCaseNumber(
  counter: Pick<CaseCounter, "lastValue"> | number | null | undefined,
  cfg: Pick<ContractConfig, "casePrefix">,
  year: number | string,
): { caseNumber: string; lastValue: number } {
  const last = typeof counter === "number" ? counter : counter?.lastValue ?? 0;
  const lastValue = last + 1;
  return { caseNumber: formatCaseNumber(cfg.casePrefix, year, lastValue), lastValue };
}

/** Förhandsvisning av nästa ärendenummer i innevarande år (ändrar inget). */
export function previewNextCaseNumber(db: Pick<Db, "case_counters">, env: Pick<DomainEnv, "contractId" | "now"> & { cfg: Pick<ContractConfig, "casePrefix"> }): string {
  const year = env.now.slice(0, 4);
  const counter = db.case_counters.find((c) => c.id === caseCounterId(env.contractId, year)) ?? null;
  return nextCaseNumber(counter, env.cfg, year).caseNumber;
}

/** Ärendenummer i fri text (t.ex. ämnesraden i ett mejl): "BOT-27-0049". */
export const CASE_NUMBER_RE = /\b([A-Z]{2,5})-(\d{2})-(\d{4,})\b/;
export function findCaseNumber(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(CASE_NUMBER_RE);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------- Pris och ordervärde
/** Prisraden för ett område som gäller ett visst datum. */
export function priceItem(priceItems: readonly PriceItem[], areaCode: string | null | undefined, date: LocalDate, contractId?: string): PriceItem | null {
  return (
    priceItems.find((p) => p.areaCode === areaCode && (!contractId || p.contractId === contractId) && p.validFrom <= date && (!p.validTo || p.validTo >= date)) ?? null
  );
}
/** Pris per deltagarvecka i öre (0 om inget pris finns). */
export const priceFor = (priceItems: readonly PriceItem[], areaCode: string | null | undefined, date: LocalDate, contractId?: string): number =>
  priceItem(priceItems, areaCode, date, contractId)?.priceOre ?? 0;

// Beställningens värde i kronor (prototypens orderValue) finns inte längre: inget ordervärde någonstans (beslut 2026-10-07,
// synpunkt #10/#11). Beställningen anges i veckor (cases.orderValueWeeks); fakturan räknar veckor × pris per rad.

// ---------------------------------------------------------------- Ordererkännande
/** Texten i ordererkännandet till kommunen. Innehåller bara ärendenumret – inga personuppgifter. */
export function ackTextFor(c: Pick<Case, "caseNumber" | "referredAt">, cfg: Pick<OperationalConfig, "sla">): string {
  const due = avropDue(c, cfg);
  const when = due ? ` Ni får besked om startdatum och ansvarig coach senast ${WEEKDAYS[weekday(due)]} ${fmtDateTimeFull(due)}.` : "";
  return `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${c.caseNumber}.${when} Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`;
}

// ---------------------------------------------------------------- Listor
/** Ärenden som väntar på svar (acceptera eller avböj) oavsett kanal – mejl, portal eller telefon. */
export const awaitingAnswer = (db: Pick<Db, "cases">): Case[] => db.cases.filter((c) => c.status === "acknowledged" || c.status === "received");

const INBOX_STATUSES: readonly InboundEmailStatus[] = ["acknowledged", "protected", "other", "linked", "received"];
/** Mejl i avropsinkorgen som inte är färdighanterade, äldst först. */
export const inboxEmails = (db: Pick<Db, "inbound_emails">): InboundEmail[] =>
  db.inbound_emails.filter((e) => INBOX_STATUSES.includes(e.status)).sort(by<InboundEmail>("receivedAt"));

/** Huvudcoacher (roll coach i avtalet), i användarlistans ordning. */
export function coaches(db: Pick<Db, "profiles" | "memberships">, contractId?: string): Profile[] {
  const ids = new Set(db.memberships.filter((m) => m.role === "coach" && (!contractId || m.contractId === contractId)).map((m) => m.userId));
  return db.profiles.filter((p) => ids.has(p.id));
}

const OPEN_STATUSES: readonly CaseStatus[] = ["received", "acknowledged", "confirmed", "active", "paused"];
/**
 * Pågående ärenden för samma person (dubblettkontroll vid beställning).
 * `personnummerHash` räknas fram av anroparen (HMAC av normalizePnr i produktion) – personnummer når aldrig domänkoden i klartext.
 */
export function duplicateActive(db: Pick<Db, "persons" | "cases">, personnummerHash: string): Case[] {
  if (!personnummerHash) return [];
  const ids = new Set(db.persons.filter((p) => p.personnummerHash && p.personnummerHash === personnummerHash).map((p) => p.id));
  return db.cases.filter((c) => ids.has(c.personId) && OPEN_STATUSES.includes(c.status));
}

// ---------------------------------------------------------------- AI
/**
 * AI får bara köras med registrerat samtycke och aldrig för skyddade personuppgifter (CLAUDE.md punkt 5 och 8).
 * Utan uppgift om personen räknas ärendet som skyddat.
 */
export function aiAllowed(c: Pick<Case, "aiConsentStatus"> | null | undefined, person: Pick<Person, "protectedIdentity"> | null | undefined): boolean {
  return !!c && !!person && !person.protectedIdentity && c.aiConsentStatus === "given";
}

// ---------------------------------------------------------------- Fas och "fastnat"
/** Sedan när ärendet är i nuvarande fas: första godkända avstämningen i fasen, annars phaseSince eller startdatum. */
export function phaseSince(c: Case, db: Pick<Db, "check_ins">): LocalDate | null {
  const cis = checkInsOf(db, c.id).filter((x) => x.status === "approved").sort(by("heldAt"));
  let since: LocalDate | null = c.startDate;
  let cur: number | null = null;
  for (const ci of cis) {
    if (ci.phase !== cur) {
      cur = ci.phase;
      since = dayOf(ci.heldAt);
    }
  }
  if (cur !== c.phase) since = c.phaseSince || since;
  return since || c.startDate;
}

export type Stuck = { days: number; maxDays: number; phase: number };

/** "Fastnat": pågående ärende som varit längre i fasen än avtalets gräns (fas 3 räknas inte om praktik är planerad). */
export function stuck(c: Case, db: Pick<Db, "check_ins" | "placements">, env: Pick<DomainEnv, "now"> & { cfg: Pick<OperationalConfig, "stuckRules"> }): Stuck | null {
  if (c.status !== "active") return null;
  const rule = stuckRule(env.cfg, c.phase);
  if (!rule) return null;
  const since = phaseSince(c, db);
  if (!since) return null;
  const days = diffDays(since, dayOf(env.now));
  if (days <= rule.maxDays) return null;
  if (rule.unlessPlacementPlanned && placementsOf(db, c.id).length) return null;
  return { days, maxDays: rule.maxDays, phase: c.phase };
}

/** Omfattningen i text: "6 månader", "Annan tidsperiod" eller "8 veckor" (äldre beställning). "Inte angiven" annars. */
export function orderPeriodText(c: Pick<Case, "orderPeriodMonths" | "orderPeriodReason" | "plannedWeeks" | "orderValueWeeks">): string {
  if (c.orderPeriodMonths != null) return `${c.orderPeriodMonths} månader`;
  if (c.orderPeriodReason) return "Annan tidsperiod";
  const w = c.orderValueWeeks || c.plannedWeeks;
  return w ? plural(w, "vecka", "veckor") : "Inte angiven";
}
