// Läs- och skrivregler per tabell i minnesläget – spegel av Row Level Security i Postgres (SPEC §4, §7.10, §10,
// CLAUDE.md punkt 1, 2, 8). Neka som standard: varje tabell har en regel, och det som inte uttryckligen tillåts nekas.
// Behörighet = avtal (memberships) + roll, via caseAccess (src/core/access.ts). Tilldelningen (case_team) styr notiser,
// påminnelser och Mina ärenden – inte åtkomsten (beslut 2026-10-09).
//
// Sammanfattning:
//   MB-roller      coach, handledare (vilande), samordnare, avtalsansvarig, chef: alla ärenden i sina avtal (beslut 2026-10-09 –
//                  coach och handledare såg tidigare bara egna respektive tilldelade; chef och admin i läsläge – chefen får ändå
//                  spara, dela inom Miljonbemanning och arkivera egna rapporter i rapportbyggaren) · ekonom: det som behövs
//                  för fakturering, inga anteckningar, rapporter eller namn · admin: allt inklusive konfiguration och logg
//                  (skyddade personer bara som ärende)
//   Kommunen       bara rollen handläggare (beslut 2026-10-07 – kommunens chef är borttagen): sina beställningar (eller
//                  enhetens/alla enligt avtalet) · bara levererade rapporter till dem · bara meddelanden i sina ärenden · aldrig
//                  coachanteckningar, flaggor, KPI:er eller prislistan (#11)
//   Skyddade       VILANDE sedan 2026-10-07 (Karims beslut): skyddet är borttaget ur appen och protected_identity är alltid
//                  false. Reglerna nedan (protectedCase, caseAccess "restricted") ligger kvar som spegel av RLS, så att skyddet
//                  kan slås på igen utan migration: bara namngiven huvudcoach, avtalsansvarig och beställande handläggare ser
//                  personen och detaljerna
//   Övrigt         pulssvar: aldrig coachen (aggregat via ctx.system) · notiser: bara mottagaren · revisionslogg: admin och chef
//                  · utskick: admin och samordnare · interna regler (org_settings): MB läser, admin skriver
//   Röst           inspelningslänkar och deltagarens röstmeddelanden: den som arbetar i ärendet (aldrig ekonom), aldrig skyddade
//                  ärenden · kommunen läser granskade röstmeddelanden bara om avtalet säger det · ljudfilernas rader skrivs
//                  bara av systemet (ctx.audio) och läses av den som spelade in och av den som arbetar i ärendet
//   Anteckningar   fria anteckningar (case_notes): som coachanteckningar (full eller team, aldrig ekonom eller kommunen),
//                  "full"-anteckningar bara med full åtkomst · skrivs av den som arbetar i ärendet i eget namn · ändras av
//                  författaren · döljs av författaren eller samordnare/avtalsansvarig · raderas aldrig
//   Synpunkter     bara den inloggade testaren i testmiljön (Actor.testerId = mm.auth_is_tester()), oavsett vilken testperson
//                  hen agerar som · ny synpunkt och nytt svar bara i eget namn · i en synpunkt ändras bara status · minnesläget
//                  och prototypen har inga testare (prototypens feedback ligger i claude.ai, src/demo/feedback-store.ts)
//   Sparade       rapportbyggarens sparade rapporter (saved_reports, 0021): samordnare, avtalsansvarig och chef i avtalet läser
//   rapporter     egna och delade inom Miljonbemanning (mb – också arkiverade, hanterarna visar dem inte) · skrivs i eget namn ·
//                 bara ägaren ändrar titel och definition · avtalsansvarig ändrar delningen och arkiverar andras delade rapporter
//                 (aldrig till privat) · raderas aldrig · delas aldrig med kommunen (beslut 2026-10-07, 0026)
//   Bilagor       bilagor till beställningen (case_attachments kind order, 0024): den som laddade upp innan beställningen
//                 skickats · i ärendet samordnare, avtalsansvarig och coach med full åtkomst och beställande handläggare ·
//                 aldrig handledare, ekonom, chef, admin eller deltagare · skrivs bara av systemet (ctx.attachments)
//   Deltagar-     filer på deltagarkortet (case_attachments kind participant, 0037, Karims beslut 2026-10-29 – CV, personligt
//   filer         brev, betyg och intyg): samordnare, avtalsansvarig och coach med full åtkomst till ärendet · aldrig kommunen
//                 (inte heller handläggaren som beställde), ekonom, chef, admin, handledare eller deltagare · alltid i ett
//                 ärende · skrivs bara av systemet (ctx.attachments)
//   Grupp-        gruppaktiviteter (group_activities, 0030): Miljonbemanning i avtalet utom ekonomen läser ("alla ser alla",
//   aktiviteter   beslut 2026-10-09) · de som arbetar i ärendena skapar (i eget namn) och ändrar · en inställd ändras inte ·
//                 avtal, skapare och skapad-tid ändras aldrig · raderas aldrig · aldrig kommunen. Deltagarnas tillfällen ligger
//                 i activities med samma regler som förut (tas bort av den som arbetar i ärendet – hanteraren nekar vid närvaro)
//   Gruppmål      group_activities.goal och group_goal_results (0033, Karims beslut 2 – internt): läses av Miljonbemanning i
//                 avtalet utom ekonomen med full- eller teamåtkomst till ärendet · skrivs av den som arbetar i ärendet i eget namn,
//                 bara för en inbjuden deltagare i en aktivitet med mål som inte är inställd, för målets nuvarande version
//                 (goal_version räknas upp när målet ändras) och deltagarens nuvarande tillfälle · bara valet ändras (eller förs
//                 över till det nuvarande målet och tillfället) · raderas aldrig · aldrig kommunen
//   Återkommande  group_activity_series (0035, Karims beslut 2026-10-22): som gruppaktiviteterna – Miljonbemanning i avtalet utom
//   aktiviteter   ekonomen läser, de som arbetar i ärendena skapar (i eget namn) och ändrar namn, plats, ansvarig, gruppmål och
//                 meddelandet · typ, målgrupp, dagar, tid, längd och första dag ändras aldrig · en avslutad ändras inte · raderas
//                 aldrig. Tillfällena (group_activities med seriesId) skapas bara av servern (ctx.system); seriesId ändras aldrig.
//                 Målgruppen (nivå eller yrkesområde) hör till aktivitetens avtal. activities.inviteSource: användare skapar bara
//                 manual och ändrar aldrig källan – audience skrivs av servern (den automatiska synkningen)
//   Närvaro       attendance.source (0030): användare skriver bara manuell närvaro – automatisk (auto) bara jobbet (ctx.system)
//   Grupper       nivåer, grupper och taggar (groupings, grouping_members, 0031 – internt, Karims beslut 3 2026-10-09):
//                 grupperingarna läses av MB i avtalet utom ekonomen och skrivs av samordnare, avtalsansvarig, coach och admin
//                 (arkiveras, raderas aldrig) · medlemskapen läses som anteckningar (aldrig ekonom eller kommunen) och skrivs av
//                 samordnare, avtalsansvarig och coach (inte admin – läsläge i ärendena) med full åtkomst till ärendet – ny rad
//                 aktiv och i eget namn, ändring bara att ta bort. Fria grupper finns inte längre (0035): ingen ny aktiv grupp
//                 eller aktivt medlemskap i en grupp – för alla (triggrarna gäller också service role)
//   Yrkes-        byten av yrkesområde (case_area_changes, 0036, Karims beslut 2026-10-22): läses av Miljonbemanning i avtalet,
//   område        också ekonomen (fakturan räknas på yrkesområdet per månad – raden har ingen fritext) · skapas av coach,
//                 samordnare och avtalsansvarig med full åtkomst, i eget namn · stämmer med ärendet, avtalets yrkesområden,
//                 anteckningen med motiveringen och tiden (månaden efter) · numreras i tur och ordning per ärende (seq) · för
//                 inloggade dessutom i kedjan: utgår från ärendets nuvarande yrkesområde, yrkesspår och alternativ och det förra
//                 bytets nya, inte äldre än det förra, registrerat med aktuell tid, motiveringen en ny egen anteckning · en ny
//                 rad ändrar ärendet i samma steg (afterInsert – bytet och ärendet skrivs alltid tillsammans) · ändras och
//                 raderas aldrig · aldrig kommunen. Ärendets yrkesområde ändras aldrig direkt när ärendet är bekräftat (bara
//                 med ett byte), och kommunen ändrar aldrig yrkesområdena när beställningen väl tagits emot
//   Start-        ändringar av startdatum (case_start_changes, 0038, Karims beslut 2026-10-29): läses av Miljonbemanning i avtalet
//   datum         utom ekonomen (raden har bara datum och id:n) · skapas av coach, samordnare och avtalsansvarig med full
//                 åtkomst, i eget namn, med en ny egen anteckning som motivering och aktuell tid · en ny rad ändrar ärendets
//                 startdatum i samma steg (afterInsert) och bara när ärendet har det gamla startdatumet, pågår eller är pausat,
//                 det nya ligger mellan första mötet och planerat slut, ingen av månaderna emellan är fakturerad eller godkänd,
//                 inget tillfälle före det nya datumet har manuell närvaro, ingen mötesrapport före det är godkänd och ingen
//                 månad som blir utan månadsrapport har en lämnad eller godkänd rapport eller en godkänd bedömning · ändras och
//                 raderas aldrig · aldrig kommunen. Startdatumet i en startad insats (pågår, pausad, avslutad) ändras aldrig
//                 direkt i ärendet (bara via en ändring); bara coach, samordnare och avtalsansvarig sätter det när insatsen
//                 startar, och ett nytt ärende skapas aldrig med startdatum
//   Bonus         bonusanspråk (bonus_claims, 0039, beslut 2026-11-04 – bonussteg 1–5): raden har aldrig ett belopp (amountOre
//                 alltid null) · läses av Miljonbemanning med åtkomst full, team eller billing (ekonomen utan innehållet – project,
//                 vyn bonus_claims_public) och av kommunen (åtkomst customer) bara när anspråket är skickat eller beslutat –
//                 aldrig förslag eller återtagna · skapas av den som arbetar i
//                 ärendet som förslag i eget namn (förslagen från regeln skrivs av servern, ctx.system) · ändras av den som arbetar
//                 i ärendet: förslag → skickat (med det frysta redovisningsunderlaget) eller återtaget, skickat → återtaget ·
//                 beslutat eller återtaget ändras aldrig · raderas aldrig. Kommunens beslut (bonus_claim_decisions) är append-only:
//                 handläggaren som beställde, i portalen i eget namn, eller samordnare/avtalsansvarig som registrerar ett mejl (med
//                 motivering); läses inte av ekonomen; en ny rad ändrar anspråket i samma steg (afterInsert, för alla roller) och bara
//                 när det är skickat och obeslutat – ett avslag av steg 3 återtar steg 4 och 5 som bygger på det. En bonusrad på
//                 en faktura står bara på en bonusfaktura och gäller ett godkänt anspråk (invoice_lines)
//   Första       deltagaren kom inte till första mötet (first_meeting_no_shows, 0040, Karims beslut 2026-11-09 – internt):
//   mötet        läses av Miljonbemanning med åtkomst full eller team – aldrig kommunen eller ekonomen · skapas av den som
//                 arbetar i ärendet, i avtalet, i eget namn och med aktuell tid · för alla roller (också systemet, guard): ärendet
//                 är bekräftat och inte startat, raden hör till ärendets avtal, mötet är ärendets första möte och har varit,
//                 orsaken krävs vid giltig frånvaro (högst 300 tecken) · ett möte en gång (UNIQUE_KEYS) · ändras aldrig och
//                 raderas bara av systemet (gallring) · ärendets startdatum sätts inte så länge ärendets nuvarande första möte
//                 är registrerat (cases.guard och caseStartChangeApplies, för alla roller – triggern cases_start_date_no_show_guard)
//   Intags-      intagsansvarig (contracts.intakeCoachId, 0041, Karims beslut 2026-11-09): avtalets coach som tar emot nya
//   ansvarig     beställningar · personen har rollen coach i avtalet när kolumnen sätts eller byts (guard – för alla, också
//                 systemet) · bara admin ändrar avtalet · kommunen läser aldrig kolumnen (project, vyn contracts_public) · en
//                 beställning som väntar på svar tas emot (bekräftad, pågående eller pausad) bara av samordnaren,
//                 avtalsansvarig eller avtalets intagsansvarige, och avböjs bara av samordnaren eller avtalsansvarig
//                 (caseAcceptGuard i caseWrite – triggern cases_accept_guard)
//   Handledare   Rollen handledare – borttagen ur appen, Karims beslut 2026-10-09; vilande så att den kan slås på igen utan
//                 migration. Ingen kan få rollen (src/api/roles.ts, DORMANT_ROLES), men reglerna nedan som nämner den ligger kvar
//                 som spegel av RLS (CASE_WORKERS, rapporterna, bilagorna)
//
// Skrivregeln får den nya raden (insert/update) eller den befintliga (remove). Finns raden redan är det en ändring.
// Systemsteg (löpnummer, revisionslogg, utskick, notiser till andra, publicering, pulslänkens token, röstlänkens token,
// ljudfilernas rader via ctx.audio, bilagornas rader via ctx.attachments, självregistreringens profil och medlemskap) körs via
// ctx.system (service role) och passerar inte policyn.
import { isCustomerRole, isSupplierRole, SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { canSeeNotes, canSeePerson, caseAccess, lookupsFor, type AccessSource, type CaseAccess } from "@/core/access";
import type { Cascade, Policies, RawAccess, RowPolicy } from "./memory";
import { PolicyError } from "./repo";
import { GROUPING_MEMBER_WRITERS, GROUPING_READERS, GROUPING_WRITERS, slotOf } from "@/core/groupings";
import { AREA_CHANGE_READERS, AREA_CHANGE_STATUSES, AREA_CHANGERS, effectiveMonthOf } from "@/core/area-changes";
import { PARTICIPANT_FILE_ROLES } from "@/core/attachments";
import {
  phaseSinceAfter, START_CHANGE_READERS, START_CHANGE_STATUSES, START_CHANGERS, startChangeLock, startChangeMinDays, startChangeMonths, startChangeReportLock,
} from "@/core/start-date";
import type { Case, Report, TableName, Tables } from "./schema";
import { dayOf, diffMinutes } from "@/core/time";
import { FOLLOWS_STEP3, stepKind } from "@/core/bonus";
import { BONUS_ACTIVE_STATUSES, BONUS_CLAIM_STATUSES, BONUS_SOURCES, FIRST_MEETING_NO_SHOW_KINDS } from "./schema";

type Raw = RawAccess<Tables>;

// ---------------------------------------------------------------- Rollgrupper
/**
 * Arbetar i ärendet (registrerar närvaro, avstämningar, händelser …) med full- eller teamåtkomst. Chef och admin är i läsläge.
 * Rollen handledare – borttagen ur appen, Karims beslut 2026-10-09; vilande så att den kan slås på igen utan migration.
 */
const CASE_WORKERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Ändrar ärendet (status, coach, datum) med full åtkomst. */
const CASE_EDITORS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach"];
/** Tar emot beställningar (skapar ärenden och personer). */
const ORDER_CREATORS: readonly Role[] = ["samordnare", "avtalsansvarig", "kommun_handlaggare"];
/**
 * Deltagarens kontaktuppgifter (Ändra kontaktväg på deltagarkortet, coachmötet 2026-10-09) – det enda systemadministratören
 * får ändra hos en person (triggern persons_admin_contact_only och mm.person_write, 0032). Adressen töms när kontaktvägen
 * inte är brev.
 */
export const PERSON_CONTACT_FIELDS = ["preferredContact", "phone", "email", "address"] as const;
/** Ser avtalets helhet: beställarrapporter, avropsinkorg, avtalsavvikelser. */
const OVERSIGHT: readonly Role[] = ["samordnare", "avtalsansvarig", "chef", "admin"];
/** Fakturering. */
const BILLING_READERS: readonly Role[] = ["ekonom", "chef", "avtalsansvarig", "admin"];
/** Läser gruppaktiviteterna (0030): Miljonbemanning utom ekonomen. Skriver: CASE_WORKERS. */
const GROUP_ACTIVITY_READERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];

const isMB = (a: Actor) => isSupplierRole(a.role);
const isKom = (a: Actor) => isCustomerRole(a.role);
const has = (roles: readonly Role[], a: Actor) => roles.includes(a.role);
const self = (a: Actor, userId: string | null | undefined) => !!userId && userId === a.userId;
/** Medlem i avtalet (admin: alla avtal). */
const member = (a: Actor, contractId: string | null | undefined) => a.role === "admin" || (!!contractId && a.contractIds.includes(contractId));
const exists = <N extends TableName>(raw: Raw, name: N, id: string) => raw.get(name, id) !== undefined;

// ---------------------------------------------------------------- Uppslag (index byggs om vid ändring och nollställs efter varje synkron körning)
type MemoEntry = { rows: readonly unknown[]; len: number; value: unknown };
const memos = new Map<string, MemoEntry>();
let clearScheduled = false;
/** Index över en tabell. Gäller inom samma synkrona körning (en list-fråga) och så länge tabellen har samma längd. */
function memo<T>(key: string, rows: readonly unknown[], build: () => T): T {
  const m = memos.get(key);
  if (m && m.rows === rows && m.len === rows.length) return m.value as T;
  const value = build();
  memos.set(key, { rows, len: rows.length, value });
  if (!clearScheduled) {
    clearScheduled = true;
    queueMicrotask(() => { memos.clear(); clearScheduled = false; });
  }
  return value;
}
function groupIds<T>(rows: readonly T[], key: (r: T) => string, val: (r: T) => string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = key(r);
    const l = m.get(k);
    if (l) l.push(val(r));
    else m.set(k, [val(r)]);
  }
  return m;
}
const teamIndex = (raw: Raw) => { const rows = raw.all("case_team"); return memo("team", rows, () => groupIds(rows, (t) => t.caseId, (t) => t.userId)); };
const casesByPerson = (raw: Raw) => { const rows = raw.all("cases"); return memo("casesByPerson", rows, () => groupIds(rows, (c) => c.personId, (c) => c.id)); };
const casesByEmployer = (raw: Raw) => { const rows = raw.all("placements"); return memo("casesByEmployer", rows, () => groupIds(rows, (p) => p.employerId, (p) => p.caseId)); };

/** Uppslagskälla för caseAccess direkt mot ofiltrerad data. */
const sourceOf = (raw: Raw): AccessSource => ({
  person: (id) => raw.get("persons", id),
  teamUserIds: (caseId) => teamIndex(raw).get(caseId) ?? [],
  profile: (id) => raw.get("profiles", id),
  contract: (id) => raw.get("contracts", id),
});
/** Åtkomst till ett ärende (raden själv – även en ny rad som inte sparats än). */
const accessOfCase = (raw: Raw, a: Actor, c: Case): CaseAccess => caseAccess(c, a, lookupsFor(c, sourceOf(raw)));
/** Åtkomst till ärendet med ett visst id. */
const accessTo = (raw: Raw, a: Actor, caseId: string | null | undefined): CaseAccess => {
  if (!caseId) return "none";
  const c = raw.get("cases", caseId);
  return c ? accessOfCase(raw, a, c) : "none";
};

// ---------------------------------------------------------------- Återkommande regler
/** Anteckningar och bedömningar: full eller team, aldrig ekonom eller kommunen. */
const notesRead = (caseId: string, a: Actor, raw: Raw) => canSeeNotes(accessTo(raw, a, caseId), a.role);
/** Arbetar i ärendet: CASE_WORKERS med full- eller teamåtkomst. */
const workOn = (caseId: string, a: Actor, raw: Raw) => {
  if (!has(CASE_WORKERS, a)) return false;
  const acc = accessTo(raw, a, caseId);
  return acc === "full" || acc === "team";
};
/** Får ändra ärendet (och dess statushistorik och team). */
function caseWrite(c: Case, a: Actor, raw: Raw): boolean {
  const cur = raw.get("cases", c.id);
  if (cur && (!caseAreaGuard(cur, c, a) || !caseStartGuard(cur, c, a) || !caseAcceptGuard(cur, c, a, raw))) return false;
  // Ett nytt ärende har inget startdatum – det sätts när insatsen startar (triggern cases_start_date_guard, 0038).
  if (!cur && c.startDate != null) return false;
  const acc = accessOfCase(raw, a, c);
  if (a.role === "samordnare" || a.role === "avtalsansvarig") return acc === "full";
  if (a.role === "coach") return acc === "full" && exists(raw, "cases", c.id); // coachen skapar inga ärenden
  if (a.role === "ekonom") return acc === "billing" && exists(raw, "cases", c.id); // beställarreferens
  if (a.role === "kommun_handlaggare") return acc === "customer" && self(a, c.referrerId); // beställning och beställarens kontaktuppgifter
  return false;
}
const caseWriteById = (caseId: string, a: Actor, raw: Raw) => { const c = raw.get("cases", caseId); return !!c && caseWrite(c, a, raw); };
/** Organisationer i aktörens avtal (leverantör och kund). */
const orgsOf = (a: Actor, raw: Raw) => {
  const out = new Set<string>();
  for (const id of a.contractIds) { const c = raw.get("contracts", id); if (c) { out.add(c.supplierId); out.add(c.customerId); } }
  return out;
};
const customersOf = (a: Actor, raw: Raw) => {
  const out = new Set<string>();
  for (const id of a.contractIds) { const c = raw.get("contracts", id); if (c) out.add(c.customerId); }
  return out;
};
/**
 * Ärendets person har skyddade personuppgifter (uppslag utan filter). Ett ärende eller en person som saknas räknas som skyddat.
 * VILANDE sedan 2026-10-07: protected_identity är alltid false (spegel av mm.case_is_protected i 0015).
 */
const protectedCase = (raw: Raw, caseId: string | null | undefined): boolean => {
  const c = caseId ? raw.get("cases", caseId) : undefined;
  const p = c ? raw.get("persons", c.personId) : undefined;
  return !p || p.protectedIdentity;
};
const adminOnly = <N extends TableName>(): RowPolicy<Tables, Tables[N]> => ({ read: (_r, a) => a.role === "admin", write: (_r, a) => a.role === "admin" });
const never = () => false;

// ---------------------------------------------------------------- Rapporter
function reportRead(r: Report, a: Actor, raw: Raw): boolean {
  if (!member(a, r.contractId)) return false;
  if (isMB(a)) {
    if (a.role === "ekonom") return false; // inga rapporter
    if (r.kind === "weekly_attendance") return true; // coach och handledare ser bara sina deltagares avsnitt (vy-modellen)
    if (r.kind === "customer_summary" || r.kind === "statistics") return has(OVERSIGHT, a);
    // Rollen handledare – borttagen ur appen, Karims beslut 2026-10-09; vilande så att den kan slås på igen utan migration.
    if (a.role === "handledare") return false; // månads- och slutrapporter innehåller coachens bedömningar
    if (!r.caseId) return has(OVERSIGHT, a);
    return canSeeNotes(accessTo(raw, a, r.caseId), a.role);
  }
  if (isKom(a)) {
    if (!r.deliveredAt) return false; // bara levererade rapporter
    // Beställarrapporten och statistiken lämnas av Miljonbemanning utanför Miljonmatch (beslut 2026-10-07) – kommunen läser
    // dem aldrig, inte heller den tidigare chefen som har kvar sitt id i deliveredTo (0026, reports_select).
    if (r.kind === "customer_summary" || r.kind === "statistics") return false;
    const toMe = r.deliveredTo.includes(a.userId) || self(a, r.recipientUserId);
    if (!r.caseId) return toMe;
    return accessTo(raw, a, r.caseId) === "customer" && toMe;
  }
  return false;
}
/** Fält som skiljer den nya raden från den befintliga (id räknas inte). */
function changedFields<T extends object>(cur: T, next: T): string[] {
  const keys = new Set([...Object.keys(cur), ...Object.keys(next)]);
  keys.delete("id");
  const c = cur as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  return [...keys].filter((k) => JSON.stringify(c[k] ?? null) !== JSON.stringify(n[k] ?? null));
}
/** Kommunens kvittens: bara openedAt/openedBy, en gång och i eget namn (samma som triggern reports_protect_columns, 0014). */
function customerReceiptOnly(cur: Report, next: Report, a: Actor): boolean {
  const changed = changedFields(cur, next);
  if (changed.some((k) => k !== "openedAt" && k !== "openedBy")) return false;
  return !changed.length || (!cur.openedAt && !!next.openedAt && next.openedBy === a.userId);
}
/** Läskvitto: bara readBy/readAt, bara sig själv i readBy och readAt en gång (triggern messages_protect_columns, 0014). */
function readReceiptOnly(cur: Tables["messages"], next: Tables["messages"], a: Actor): boolean {
  const changed = changedFields(cur, next);
  if (changed.some((k) => k !== "readBy" && k !== "readAt")) return false;
  if (changed.includes("readBy") && (!cur.readBy.every((id) => next.readBy.includes(id)) || next.readBy.some((id) => !cur.readBy.includes(id) && id !== a.userId))) return false;
  if (changed.includes("readAt") && (cur.readAt != null || next.readAt == null)) return false;
  return true;
}

function reportWrite(r: Report, a: Actor, raw: Raw): boolean {
  if (isKom(a)) {
    // Kommunen kvitterar bara (openedAt) – inga andra kolumner i en levererad rapport.
    const cur = raw.get("reports", r.id);
    return !!cur && reportRead(r, a, raw) && customerReceiptOnly(cur, r, a);
  }
  if (!isMB(a) || !member(a, r.contractId)) return false;
  if (r.kind === "weekly_attendance") return has(CASE_WORKERS, a);
  if (r.kind === "customer_summary" || r.kind === "statistics") return a.role === "samordnare" || a.role === "avtalsansvarig";
  if (r.caseId) return has(CASE_EDITORS, a) && accessTo(raw, a, r.caseId) === "full";
  return false;
}

// ---------------------------------------------------------------- Röstinspelning
type VoiceNote = Tables["participant_voice_notes"];
/**
 * Deltagarens röstmeddelanden: den som arbetar i ärendet (full/team, aldrig ekonom). Kommunen (åtkomst "customer") bara
 * granskade meddelanden och bara om avtalet säger det (customerVisibility.seesParticipantVoiceNotes).
 */
function voiceNoteRead(x: VoiceNote, a: Actor, raw: Raw): boolean {
  if (isMB(a)) return notesRead(x.caseId, a, raw);
  if (!isKom(a) || x.status !== "reviewed" || accessTo(raw, a, x.caseId) !== "customer") return false;
  const c = raw.get("cases", x.caseId);
  return !!c && raw.get("contracts", c.contractId)?.config.customerVisibility?.seesParticipantVoiceNotes === true;
}
/**
 * Coachens granskning ändrar bara status, reviewedBy och reviewedAt – aldrig deltagarens text, språk eller samtycke – och
 * granskaren är den som ändrar (samma som triggern participant_voice_notes_protect_columns, 0015).
 */
function reviewOnly(cur: VoiceNote, next: VoiceNote, a: Actor): boolean {
  const changed = changedFields(cur, next);
  if (changed.some((k) => k !== "status" && k !== "reviewedBy" && k !== "reviewedAt")) return false;
  return !changed.includes("reviewedBy") || next.reviewedBy === null || next.reviewedBy === a.userId;
}

// ---------------------------------------------------------------- Meddelanden
function messageRead(m: Tables["messages"], a: Actor, raw: Raw): boolean {
  const acc = accessTo(raw, a, m.caseId);
  if (isMB(a)) return a.role !== "ekonom" && (acc === "full" || acc === "team");
  if (isKom(a)) return acc === "customer";
  return false;
}

// ---------------------------------------------------------------- Synpunkter i testmiljön (0017)
/**
 * Den inloggade är testare i testmiljön (mm.auth_is_tester()). Bara servern sätter testerId – aldrig i produktion. I minnesläget
 * bara när en testare simuleras för e2e (POST /api/dev-session med testerId, src/server/runtime.ts).
 */
const stagingTester = (a: Actor): a is Actor & { testerId: string } => typeof a.testerId === "string" && a.testerId !== "";
/** I en synpunkt ändras bara status, statusChangedAt och statusChangedBy – i eget namn (triggern feedback_protect_columns, 0017). */
function feedbackStatusOnly(cur: Tables["feedback"], next: Tables["feedback"], a: Actor & { testerId: string }): boolean {
  const changed = changedFields(cur, next);
  if (changed.some((k) => k !== "status" && k !== "statusChangedAt" && k !== "statusChangedBy")) return false;
  return !changed.includes("statusChangedBy") || next.statusChangedBy === null || next.statusChangedBy === a.testerId;
}

// ---------------------------------------------------------------- Fria anteckningar i deltagarkortet (0019)
type CaseNoteRow = Tables["case_notes"];
/** Fält som aldrig ändras efter att anteckningen skapats (triggern case_notes_protect_columns, 0019). */
const NOTE_FIXED = ["caseId", "contractId", "authorId", "createdAt"];
/** Döljer andras anteckningar i avtalet (beslut 2026-10-01) – inom sin åtkomst, bara removedAt och removedBy. */
const NOTE_REMOVERS: readonly Role[] = ["samordnare", "avtalsansvarig"];
/** Läsare: notesRead (full eller team, aldrig ekonom eller kommunen) – och anteckningar för "full" bara med full åtkomst. */
const noteAudienceOk = (x: Pick<CaseNoteRow, "caseId" | "audience">, a: Actor, raw: Raw) => x.audience === "team" || accessTo(raw, a, x.caseId) === "full";
/**
 * Ny anteckning: den som arbetar i ärendet (workOn), i eget namn, i ärendets avtal, varken ändrad eller borttagen – och med
 * teamåtkomst bara audience "team". Ändring: författaren (texten och övriga fält, eller dölja sin egen) eller samordnare och
 * avtalsansvarig med full åtkomst (bara dölja). En borttagen anteckning ändras och återställs aldrig, fasta fält ändras aldrig
 * och något måste ändras – det stoppar MemoryRepo.remove(), som anropar regeln med den befintliga raden (ingen hård
 * radering; Postgres har varken delete-policy eller delete-rättighet). Samma regler som policyerna och triggern i 0019.
 */
function caseNoteWrite(x: CaseNoteRow, a: Actor, raw: Raw): boolean {
  const cur = raw.get("case_notes", x.id);
  if (!cur) {
    return workOn(x.caseId, a, raw) && self(a, x.authorId) && noteAudienceOk(x, a, raw)
      && raw.get("cases", x.caseId)?.contractId === x.contractId && x.updatedAt == null && x.removedAt == null && x.removedBy == null;
  }
  const changed = changedFields(cur, x);
  if (cur.removedAt != null || !changed.length || changed.some((k) => NOTE_FIXED.includes(k))) return false;
  // Motiveringen till ett byte av yrkesområde (case_area_changes.noteId) är låst: den ändras och tas aldrig bort (triggern
  // case_notes_area_change_lock, 0036). Bara servern (service role) kan ändra den.
  if (raw.all("case_area_changes").some((c) => c.noteId === cur.id)) return false;
  // Motiveringen till ett ändrat startdatum (case_start_changes.noteId) är låst på samma sätt (triggern
  // case_notes_start_change_lock, 0038).
  if (raw.all("case_start_changes").some((c) => c.noteId === cur.id)) return false;
  // Dölja: removedAt och removedBy sätts tillsammans, i eget namn.
  if ((changed.includes("removedAt") || changed.includes("removedBy")) && (x.removedAt == null || !self(a, x.removedBy))) return false;
  if (self(a, cur.authorId)) return workOn(x.caseId, a, raw) && noteAudienceOk(x, a, raw);
  return has(NOTE_REMOVERS, a) && accessTo(raw, a, x.caseId) === "full" && changed.every((k) => k === "removedAt" || k === "removedBy");
}

// ---------------------------------------------------------------- Sparade rapporter i rapportbyggaren (0021)
type SavedReportRow = Tables["saved_reports"];
/** Bygger och sparar rapporter (rapporter steg 4, beslut 10) – inte admin, coach, handledare eller ekonom. */
export const REPORT_BUILDERS: readonly Role[] = ["samordnare", "avtalsansvarig", "chef"];
/** Fält som aldrig ändras efter att rapporten skapats (triggern saved_reports_protect_columns, 0021). */
const SAVED_FIXED = ["contractId", "ownerId", "createdAt"];
/** Det enda som den som inte är ägaren får ändra (tillägg 2026-10-02): delningen och arkiveringen. */
const SAVED_SHARING = ["visibility", "sharedAt", "sharedBy", "archivedAt", "archivedBy"];
const TEMPLATE_KEY = /^[a-z0-9-]{1,60}$/;

function savedReportRead(x: SavedReportRow, a: Actor): boolean {
  return has(REPORT_BUILDERS, a) && member(a, x.contractId) && (self(a, x.ownerId) || x.visibility !== "private");
}
/** Tabellens kontroller (check i 0021): titelns längd, mallnyckeln, definitionen, delningen och paren. */
function savedReportShape(x: SavedReportRow): boolean {
  const pair = (at: unknown, by: unknown) => (at == null) === (by == null);
  const def = x.definition as unknown;
  // Titelns längd som char_length i Postgres (kodpunkter, inte UTF-16-enheter).
  const titleChars = [...x.title].length;
  return titleChars >= 3 && titleChars <= 80 && (x.templateKey == null || TEMPLATE_KEY.test(x.templateKey))
    && !!def && typeof def === "object" && !Array.isArray(def) && String((def as { v?: unknown }).v) === "1"
    && ["private", "mb"].includes(x.visibility) && (x.visibility === "private" || x.sharedAt != null)
    && pair(x.updatedAt, x.updatedBy) && pair(x.sharedAt, x.sharedBy) && pair(x.archivedAt, x.archivedBy);
}
/**
 * Ny rad: byggroll, medlem, i eget namn; varken ändrad eller arkiverad; privat = inte delad, annars delad i eget namn.
 * Ändring: den befintliga raden är inte arkiverad och ägs av en själv (eller är inte privat och man är avtalsansvarig); den
 * nya raden ägs av en själv eller är inte privat (avtalsansvarig); något ändras; avtal, ägare och skapad-tid ändras aldrig; ändrad- och
 * arkiveringstid i eget namn; ändras delningen sätts shared_* i eget namn (värdena får vara desamma – minutprecisionen);
 * shared_* ändras bara med delningen; den som inte är ägaren ändrar bara delningen och arkiveringen. Samma regler som
 * policyerna och triggern i 0021. Regeln stoppar också MemoryRepo.remove() (inget ändras – ingen hård radering).
 */
function savedReportWrite(x: SavedReportRow, a: Actor, raw: Raw): boolean {
  if (!has(REPORT_BUILDERS, a) || !member(a, x.contractId) || !savedReportShape(x)) return false;
  const cur = raw.get("saved_reports", x.id);
  if (!cur) {
    if (!self(a, x.ownerId)) return false;
    if (x.updatedAt != null || x.updatedBy != null || x.archivedAt != null || x.archivedBy != null) return false;
    return x.visibility === "private" ? x.sharedAt == null && x.sharedBy == null : x.sharedAt != null && self(a, x.sharedBy);
  }
  // Den befintliga raden (using).
  if (cur.archivedAt != null || !member(a, cur.contractId)) return false;
  if (!self(a, cur.ownerId) && !(a.role === "avtalsansvarig" && cur.visibility !== "private")) return false;
  // Den nya raden (with check).
  if (!self(a, x.ownerId) && !(a.role === "avtalsansvarig" && x.visibility !== "private")) return false;
  // Kolumnskyddet (triggern).
  const changed = changedFields(cur, x);
  if (!changed.length || changed.some((k) => SAVED_FIXED.includes(k))) return false;
  if ((changed.includes("updatedAt") || changed.includes("updatedBy")) && (x.updatedAt == null || !self(a, x.updatedBy))) return false;
  if ((changed.includes("archivedAt") || changed.includes("archivedBy")) && (x.archivedAt == null || !self(a, x.archivedBy))) return false;
  if (changed.includes("visibility")) {
    if (x.sharedAt == null || !self(a, x.sharedBy)) return false;
  } else if (changed.includes("sharedAt") || changed.includes("sharedBy")) return false;
  return self(a, cur.ownerId) || changed.every((k) => SAVED_SHARING.includes(k));
}

// ---------------------------------------------------------------- Gruppaktiviteter (0030)
type GroupActivityRow = Tables["group_activities"];
/** Fält som aldrig ändras efter att aktiviteten skapats (triggern group_activities_protect_columns, 0030). */
const GROUP_FIXED = ["contractId", "createdBy", "createdAt", "seriesId"];
const GROUP_KINDS: readonly string[] = ["yrkesmoment", "arbetsgivarbesök", "annat"];
/** Tabellens kontroller (check i 0030 och 0033): namnets längd (btrim, kodpunkter), typen, längden, platsen, paren och gruppmålet. */
function groupActivityShape(x: GroupActivityRow): boolean {
  const pair = (at: unknown, by: unknown) => (at == null) === (by == null);
  const nameChars = [...x.name.replace(/^ +| +$/g, "")].length;
  return nameChars >= 1 && nameChars <= 120 && GROUP_KINDS.includes(x.kind) && Number.isInteger(x.durationMin) && x.durationMin >= 1 && x.durationMin <= 720
    && [...x.location].length <= 200 && pair(x.updatedAt, x.updatedBy) && pair(x.cancelledAt, x.cancelledBy) && goalShape(x.goal)
    && Number.isInteger(x.goalVersion) && x.goalVersion >= 0 && audienceShape(x.audience, x.audienceLevelId, x.audienceAreaCode, true);
}
/** Målgruppens form (check group_activities_audience_shape och group_activity_series_audience_shape, 0035). */
function audienceShape(audience: string, levelId: string | null, areaCode: string | null, manualAllowed: boolean): boolean {
  if (audience === "manual") return manualAllowed && levelId == null && areaCode == null;
  if (audience === "level") return levelId != null && areaCode == null;
  if (audience === "area") return areaCode != null && levelId == null;
  return false;
}
/**
 * Målgruppen hör till avtalet (triggern group_activities_audience, 0035 – gäller också systemet där): nivån är en nivå i avtalet,
 * yrkesområdet ett avtalsområde i avtalet.
 */
function audienceConsistent(x: { contractId: string; audience: string; audienceLevelId: string | null; audienceAreaCode: string | null }, raw: Raw): boolean {
  if (x.audience === "level") {
    const g = x.audienceLevelId ? raw.get("groupings", x.audienceLevelId) : undefined;
    return !!g && g.kind === "level" && g.contractId === x.contractId;
  }
  if (x.audience === "area") return raw.all("contract_areas").some((ar) => ar.contractId === x.contractId && ar.code === x.audienceAreaCode);
  return true;
}
/** Tillfället hör till seriens avtal (triggern group_activities_series, 0035). */
function seriesConsistent(x: GroupActivityRow, raw: Raw): boolean {
  if (x.seriesId == null) return true;
  return raw.get("group_activity_series", x.seriesId)?.contractId === x.contractId;
}

// ---------------------------------------------------------------- Återkommande aktiviteter (0035)
type SeriesRow = Tables["group_activity_series"];
/**
 * Fält som aldrig ändras (triggern group_activity_series_protect_columns): avtal, skapare, typ, målgrupp, dagar, tid, längd och
 * första dag – en ny tid är en ny serie.
 */
const SERIES_FIXED = ["contractId", "createdBy", "createdAt", "kind", "audience", "audienceLevelId", "audienceAreaCode", "weekdays", "startTime", "durationMin", "startsOn"];
/** Tabellens kontroller (check i 0035): namn, typ, målgrupp, veckodagar, tid, längd, plats, gruppmål, sista dagen och paren. */
function seriesShape(x: SeriesRow): boolean {
  const pair = (at: unknown, by: unknown) => (at == null) === (by == null);
  const nameChars = [...x.name.replace(/^ +| +$/g, "")].length;
  const days = x.weekdays;
  const daysOk = Array.isArray(days) && days.length >= 1 && days.length <= 5 && days.every((d, i) => Number.isInteger(d) && d >= 1 && d <= 5 && (i === 0 || d > days[i - 1]));
  return nameChars >= 1 && nameChars <= 120 && GROUP_KINDS.includes(x.kind) && audienceShape(x.audience, x.audienceLevelId, x.audienceAreaCode, false) && daysOk
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.startTime) && Number.isInteger(x.durationMin) && x.durationMin >= 1 && x.durationMin <= 720 && [...x.location].length <= 200
    && goalShape(x.goal) && (x.endsOn == null || x.endsOn >= x.startsOn) && pair(x.updatedAt, x.updatedBy) && pair(x.endedAt, x.endedBy);
}
/**
 * Ny rad: de som arbetar i ärendena, medlem i avtalet, i eget namn, varken ändrad eller avslutad. Ändring: den befintliga raden är
 * inte avslutad; något ändras; de fasta fälten aldrig; ändrad och avslutad i eget namn; sista dagen bara när serien avslutas.
 * Regeln stoppar också MemoryRepo.remove() (inget ändras – ingen radering). Samma regler som policyerna och triggern i 0035.
 */
function seriesWrite(x: SeriesRow, a: Actor, raw: Raw): boolean {
  if (!has(CASE_WORKERS, a) || !member(a, x.contractId) || !seriesShape(x) || !audienceConsistent(x, raw)) return false;
  const cur = raw.get("group_activity_series", x.id);
  if (!cur) return self(a, x.createdBy) && x.updatedAt == null && x.updatedBy == null && x.endedAt == null && x.endedBy == null;
  if (cur.endedAt != null || !member(a, cur.contractId)) return false;
  const changed = changedFields(cur, x);
  if (!changed.length || changed.some((k) => SERIES_FIXED.includes(k))) return false;
  if ((changed.includes("updatedAt") || changed.includes("updatedBy")) && (x.updatedAt == null || !self(a, x.updatedBy))) return false;
  if ((changed.includes("endedAt") || changed.includes("endedBy")) && (x.endedAt == null || !self(a, x.endedBy))) return false;
  if (changed.includes("endsOn") && !changed.includes("endedAt")) return false;
  return true;
}
/** Gruppmålet (check group_activities_goal_length, 0033): null eller 1–300 tecken (btrim, kodpunkter). */
function goalShape(goal: string | null | undefined): boolean {
  if (goal == null) return true;
  const chars = [...goal.replace(/^ +| +$/g, "")].length;
  return chars >= 1 && chars <= 300;
}
/**
 * Ny rad: de som arbetar i ärendena, medlem i avtalet, i eget namn, varken ändrad eller inställd. Ändring: den befintliga
 * raden är inte inställd; något ändras; avtal, skapare och skapad-tid ändras aldrig; ändrad och inställd i eget namn. Regeln
 * stoppar också MemoryRepo.remove() (inget ändras – ingen radering). Samma regler som policyerna och triggern i 0030.
 */
function groupActivityWrite(x: GroupActivityRow, a: Actor, raw: Raw): boolean {
  if (!has(CASE_WORKERS, a) || !member(a, x.contractId) || !groupActivityShape(x) || !audienceConsistent(x, raw) || !seriesConsistent(x, raw)) return false;
  const cur = raw.get("group_activities", x.id);
  // Ny rad: i eget namn, varken ändrad eller inställd, och utan serie – tillfällena skapas bara av servern (0035).
  if (!cur) return self(a, x.createdBy) && x.updatedAt == null && x.updatedBy == null && x.cancelledAt == null && x.cancelledBy == null && x.seriesId == null;
  if (cur.cancelledAt != null || !member(a, cur.contractId)) return false;
  // Gruppmålets version följer målet (triggern group_activities_goal_version, 0033): ett ändrat mål räknar upp den med ett.
  if (x.goalVersion !== ((x.goal ?? null) !== (cur.goal ?? null) ? cur.goalVersion + 1 : cur.goalVersion)) return false;
  const changed = changedFields(cur, x);
  if (!changed.length || changed.some((k) => GROUP_FIXED.includes(k))) return false;
  if ((changed.includes("updatedAt") || changed.includes("updatedBy")) && (x.updatedAt == null || !self(a, x.updatedBy))) return false;
  if ((changed.includes("cancelledAt") || changed.includes("cancelledBy")) && (x.cancelledAt == null || !self(a, x.cancelledBy))) return false;
  return true;
}
// ---------------------------------------------------------------- Gruppmål (0033)
type GroupGoalRow = Tables["group_goal_results"];
/** Fält som aldrig ändras (triggern group_goal_results_check, 0033). */
const GOAL_FIXED = ["contractId", "groupActivityId", "caseId"];
/**
 * Raden hör till aktiviteten och deltagaren (triggern group_goal_results_check, 0033): aktivitetens och ärendets avtal, en
 * aktivitet med gruppmål som inte är inställd, målets nuvarande version och deltagarens tillfälle i aktiviteten (inbjuden).
 */
function groupGoalConsistent(x: GroupGoalRow, raw: Raw): boolean {
  const g = raw.get("group_activities", x.groupActivityId);
  if (!g || g.contractId !== x.contractId || raw.get("cases", x.caseId)?.contractId !== x.contractId) return false;
  if (g.cancelledAt != null || g.goal == null || x.goalVersion !== g.goalVersion) return false;
  const act = raw.get("activities", x.activityId);
  return !!act && act.groupActivityId === x.groupActivityId && act.caseId === x.caseId;
}
/**
 * Ny rad: den som arbetar i ärendet, medlem i avtalet, i eget namn. Ändring: valet (achieved) ändras, eller förs ett val för ett
 * tidigare mål eller en tidigare inbjudan över till det nuvarande (goalVersion, activityId) – något av dem måste ändras; aktivitet,
 * ärende och avtal aldrig. Regeln stoppar också MemoryRepo.remove() (inget ändras – ingen radering). Samma regler som
 * policyerna och triggern i 0033.
 */
function groupGoalWrite(x: GroupGoalRow, a: Actor, raw: Raw): boolean {
  if (!workOn(x.caseId, a, raw) || !member(a, x.contractId) || !self(a, x.setBy) || !groupGoalConsistent(x, raw)) return false;
  const cur = raw.get("group_goal_results", x.id);
  if (!cur) return true;
  if (!workOn(cur.caseId, a, raw) || !member(a, cur.contractId)) return false;
  const changed = changedFields(cur, x);
  return ["achieved", "goalVersion", "activityId"].some((k) => changed.includes(k)) && !changed.some((k) => GOAL_FIXED.includes(k));
}

// ---------------------------------------------------------------- Grupper, nivåer och taggar (0031)
type GroupingRow = Tables["groupings"];
type GroupingMemberRow = Tables["grouping_members"];
// Rollerna GROUPING_READERS, GROUPING_WRITERS och GROUPING_MEMBER_WRITERS finns i src/core/groupings.ts (samma i hanterarna och rutterna).
/** Fält som aldrig ändras efter att grupperingen skapats (triggern groupings_protect_columns, 0031). */
const GROUPING_FIXED = ["contractId", "kind", "category", "createdAt", "createdBy"];
/**
 * Ny rad: skrivroll, medlem i avtalet, i eget namn, varken ändrad eller arkiverad. Ändring: något ändras, fasta fält ändras
 * aldrig, updated_* i eget namn, archived_* i eget namn (eller båda tömda – återställ). Regeln stoppar också
 * MemoryRepo.remove() (inget ändras – ingen hård radering). Samma regler som policyerna och triggern i 0031.
 */
/** Tabellens kontroller (check i 0031): längderna i tecken som char_length (kodpunkter), kategori bara för taggar, paren. */
function groupingShape(x: GroupingRow): boolean {
  const chars = (t: string) => [...t].length;
  const pair = (at: unknown, by: unknown) => (at == null) === (by == null);
  const nameLen = chars(x.name.trim());
  return (x.kind === "tag") === (x.category != null) && (x.category == null || (chars(x.category.trim()) >= 1 && chars(x.category.trim()) <= 60))
    && nameLen >= 1 && nameLen <= 80 && chars(x.description) <= 300 && pair(x.updatedAt, x.updatedBy) && pair(x.archivedAt, x.archivedBy);
}
function groupingWrite(x: GroupingRow, a: Actor, raw: Raw): boolean {
  if (!has(GROUPING_WRITERS, a) || !member(a, x.contractId) || !groupingShape(x)) return false;
  const cur = raw.get("groupings", x.id);
  // Fria grupper finns inte längre (0035, triggern groupings_no_free_groups): ingen ny aktiv grupp och ingen återställd.
  if (x.kind === "group" && x.archivedAt == null && (!cur || cur.archivedAt != null)) return false;
  if (!cur) return self(a, x.createdBy) && x.updatedAt == null && x.archivedAt == null;
  if (!member(a, cur.contractId)) return false;
  const changed = changedFields(cur, x);
  if (!changed.length || changed.some((k) => GROUPING_FIXED.includes(k))) return false;
  if ((changed.includes("updatedAt") || changed.includes("updatedBy")) && (x.updatedAt == null || !self(a, x.updatedBy))) return false;
  if ((changed.includes("archivedAt") || changed.includes("archivedBy")) && x.archivedAt != null && !self(a, x.archivedBy)) return false;
  return true;
}
/**
 * Medlemskapet stämmer med grupperingen och ärendet (triggern grouping_members_check, 0031 – gäller också systemet där):
 * samma avtal, grupperingens typ och plats, och en arkiverad gruppering får inga nya aktiva medlemmar.
 */
function memberConsistent(x: GroupingMemberRow, raw: Raw, isNew: boolean): boolean {
  const g = raw.get("groupings", x.groupingId);
  if (!g || g.contractId !== x.contractId || raw.get("cases", x.caseId)?.contractId !== x.contractId) return false;
  if (x.kind !== g.kind || x.slot !== slotOf(g)) return false;
  return !isNew || g.archivedAt == null || x.removedAt != null;
}
/**
 * Ny rad: skrivroll med full åtkomst till ärendet, i eget namn, aktiv och i grupperingens avtal. Ändring: bara att ta bort
 * (removedAt och removedBy i eget namn) ett aktivt medlemskap. Samma regler som policyerna och triggern i 0031. En unik
 * plats per ärende (en nivå, en tagg per kategori) sköts av UNIQUE_KEYS i schema.ts.
 */
function groupingMemberWrite(x: GroupingMemberRow, a: Actor, raw: Raw): boolean {
  if (!has(GROUPING_MEMBER_WRITERS, a) || accessTo(raw, a, x.caseId) !== "full") return false;
  const cur = raw.get("grouping_members", x.id);
  // Fria grupper finns inte längre (0035, triggern grouping_members_no_free_groups): inget nytt aktivt medlemskap i en grupp.
  if (x.kind === "group" && x.removedAt == null && (!cur || cur.removedAt != null)) return false;
  if (!memberConsistent(x, raw, !cur)) return false;
  if (!cur) return self(a, x.addedBy) && x.removedAt == null && x.removedBy == null;
  if (cur.removedAt != null || accessTo(raw, a, cur.caseId) !== "full") return false;
  const changed = changedFields(cur, x);
  return changed.length > 0 && changed.every((k) => k === "removedAt" || k === "removedBy") && x.removedAt != null && self(a, x.removedBy);
}

// ---------------------------------------------------------------- Byt yrkesområde (0036)
type CaseAreaChangeRow = Tables["case_area_changes"];
/**
 * Raden stämmer med ärendet (triggern case_area_changes_check, de främmande nycklarna och de unika nycklarna, 0036 – gäller
 * också systemet där): ärendets avtal, båda yrkesområdena finns i avtalet, det nya är aktivt och skiljer sig från det gamla,
 * anteckningen hör till ärendet och är motivering till bara det här bytet, yrkesspåret är högst 200 tecken och effectiveMonth
 * är månaden efter changedAt.
 */
function caseAreaChangeConsistent(x: CaseAreaChangeRow, raw: Raw): boolean {
  if (raw.get("cases", x.caseId)?.contractId !== x.contractId || x.fromArea === x.toArea) return false;
  const areas = raw.all("contract_areas").filter((a) => a.contractId === x.contractId);
  if (!areas.some((a) => a.code === x.fromArea) || !areas.some((a) => a.code === x.toArea && a.active)) return false;
  if (!(raw.get("case_notes", x.noteId)?.caseId === x.caseId && /^\d{4}-(0[1-9]|1[0-2])$/.test(x.effectiveMonth) && x.effectiveMonth === effectiveMonthOf(x.changedAt))) return false;
  if (raw.all("case_area_changes").some((y) => y.noteId === x.noteId && y.id !== x.id) || x.toTrack.length > 200) return false;
  // seq: ärendets nästa nummer (1, 2, 3 …).
  return x.seq === priorAreaChange(x, raw).seq + 1;
}
/** Ärendets senaste byte före raden (högsta seq), eller seq 0 när det inte finns något. */
function priorAreaChange(x: CaseAreaChangeRow, raw: Raw): { seq: number; toArea: string | null; changedAt: string | null } {
  const own = raw.all("case_area_changes").filter((y) => y.caseId === x.caseId && y.id !== x.id);
  const last = own.reduce<CaseAreaChangeRow | null>((m, y) => (!m || y.seq > m.seq ? y : m), null);
  return last ? { seq: last.seq, toArea: last.toArea, changedAt: last.changedAt } : { seq: 0, toArea: null, changedAt: null };
}
/** Högsta skillnaden i minuter mellan bytets tid och databasens klocka (triggern: 600 sekunder). */
const AREA_CHANGE_CLOCK_MINUTES = 10;
/** Ärendet har fortfarande bytets gamla yrkesområde, yrkesspår och alternativ och kan byta (mm.apply_case_area_change, 0036). */
function caseAreaChangeApplies(x: CaseAreaChangeRow, raw: Raw): boolean {
  const c = raw.get("cases", x.caseId);
  return !!c && c.contractId === x.contractId && c.primaryAreaCode === x.fromArea && c.vocationalTrack === x.fromTrack
    && (c.secondaryAreaCode ?? null) === (x.fromSecondaryArea ?? null) && AREA_CHANGE_STATUSES.includes(c.status);
}
/**
 * Kedjan, tiden och motiveringen för inloggade (triggrarna case_area_changes_check och case_area_changes_apply, 0036 – inte
 * service role): bytet utgår från ärendets nuvarande yrkesområde, yrkesspår och alternativ (ärendet bekräftat, pågående eller
 * pausat) och från det förra bytets nya yrkesområde, är inte äldre än det förra bytet och registreras med aktuell tid (högst
 * 10 minuter från klockan – minnets klocka, RawAccess.now; ett minne utan klocka prövar inte tiden). Motiveringen är en ny
 * anteckning av den som byter: typ other, inte borttagen, skriven högst 10 minuter från bytet – ingen kan göra någon annans
 * anteckning till en låst motivering.
 */
function caseAreaChangeChained(x: CaseAreaChangeRow, raw: Raw): boolean {
  if (!caseAreaChangeApplies(x, raw)) return false;
  const prior = priorAreaChange(x, raw);
  if (prior.toArea != null && prior.toArea !== x.fromArea) return false;
  if (prior.changedAt != null && x.changedAt < prior.changedAt) return false;
  const note = raw.get("case_notes", x.noteId);
  if (!note || note.authorId !== x.changedBy || note.kind !== "other" || note.removedAt != null || Math.abs(diffMinutes(note.createdAt, x.changedAt)) > AREA_CHANGE_CLOCK_MINUTES) return false;
  const now = raw.now?.();
  return !now || Math.abs(diffMinutes(now, x.changedAt)) <= AREA_CHANGE_CLOCK_MINUTES;
}
/**
 * Ny rad: AREA_CHANGERS med full åtkomst till ärendet, medlem i avtalet, i eget namn, i överensstämmelse med ärendet och i
 * kedjan. En befintlig rad ändras aldrig (ingen update-policy) – regeln stoppar också MemoryRepo.remove() (ingen delete-policy).
 */
function caseAreaChangeWrite(x: CaseAreaChangeRow, a: Actor, raw: Raw): boolean {
  if (raw.get("case_area_changes", x.id)) return false;
  return has(AREA_CHANGERS, a) && accessTo(raw, a, x.caseId) === "full" && member(a, x.contractId) && self(a, x.changedBy) && caseAreaChangeConsistent(x, raw)
    && caseAreaChangeChained(x, raw);
}
/**
 * Ärendet ändras i samma steg som bytet skrivs (triggern case_area_changes_apply, 0036 – bara inloggade): yrkesområdet blir det
 * nya, yrkesspåret det valda och ett alternativt yrkesområde som blir det nya tas bort. Bytet och ärendet skrivs alltid
 * tillsammans – ett halvt byte kan inte bli kvar.
 */
function caseAreaChangeApply(x: CaseAreaChangeRow, _a: Actor, raw: Raw): readonly Cascade<Tables>[] {
  const c = raw.get("cases", x.caseId);
  if (!c || !caseAreaChangeApplies(x, raw)) throw new PolicyError("case_area_changes");
  return [{ table: "cases", id: c.id, patch: { primaryAreaCode: x.toArea, vocationalTrack: x.toTrack, ...(c.secondaryAreaCode === x.toArea ? { secondaryAreaCode: null } : {}) } }];
}
/** Ärenden där yrkesområdet bara byts med Byt yrkesområde (triggern cases_area_guard, 0036). */
const AREA_LOCKED_STATUSES: readonly Case["status"][] = ["confirmed", "active", "paused", "closed"];
/** Väntande eller avböjda beställningar – ett bekräftat ärende går aldrig tillbaka hit (triggern cases_area_guard, 0036). */
const ORDER_PENDING_STATUSES: readonly Case["status"][] = ["received", "acknowledged", "declined"];
/**
 * Ärendets yrkesområde (triggern cases_area_guard, 0036): i ett bekräftat, pågående, pausat eller avslutat ärende ändras
 * primaryAreaCode aldrig direkt – bara via ett byte (caseAreaChangeApply). Kommunen ändrar aldrig yrkesområdena när
 * beställningen väl tagits emot. Statusen som spärren utgår från går inte runt: kommunen ändrar aldrig ärendets status, och ett
 * bekräftat, pågående, pausat eller avslutat ärende blir aldrig en väntande eller avböjd beställning igen (annars kunde
 * yrkesområdet ändras i tre steg: statusen tillbaka, yrkesområdet, statusen fram igen).
 */
function caseAreaGuard(cur: Case, next: Case, a: Actor): boolean {
  if (next.status !== cur.status) {
    if (isKom(a)) return false;
    if (AREA_LOCKED_STATUSES.includes(cur.status) && ORDER_PENDING_STATUSES.includes(next.status)) return false;
  }
  if (next.primaryAreaCode !== cur.primaryAreaCode && AREA_LOCKED_STATUSES.includes(cur.status)) return false;
  if (isKom(a) && cur.status !== "received" && (next.primaryAreaCode !== cur.primaryAreaCode || (next.secondaryAreaCode ?? null) !== (cur.secondaryAreaCode ?? null))) return false;
  return true;
}

// ---------------------------------------------------------------- Intagsansvarig tar emot nya beställningar (0041)
/** En beställning som väntar på svar. */
const ORDER_OPEN_STATUSES: readonly Case["status"][] = ["received", "acknowledged"];
/** Mottagen: bekräftad – eller pågående eller pausad, så att spärren inte går runt genom att hoppa över bekräftelsen. */
const ORDER_TAKEN_STATUSES: readonly Case["status"][] = ["confirmed", "active", "paused"];
/** Aktören agerar som coach och är avtalets intagsansvarige (mm.is_intake_coach, 0041). */
const isIntakeCoach = (raw: Raw, a: Actor, contractId: string): boolean => a.role === "coach" && raw.get("contracts", contractId)?.intakeCoachId === a.userId;
/**
 * Ta emot en beställning (triggern cases_accept_guard, 0041 – Karims beslut 2026-11-09): en beställning som väntar på svar tas
 * emot bara av samordnaren, avtalsansvarig eller avtalets intagsansvarige, och avböjs bara av samordnaren eller avtalsansvarig.
 * Övriga ändringar av ärendet (också coachens avslut av en beställning som aldrig togs emot) prövas som förut.
 */
function caseAcceptGuard(cur: Case, next: Case, a: Actor, raw: Raw): boolean {
  if (!ORDER_OPEN_STATUSES.includes(cur.status) || next.status === cur.status) return true;
  const manager = a.role === "samordnare" || a.role === "avtalsansvarig";
  if (ORDER_TAKEN_STATUSES.includes(next.status)) return manager || isIntakeCoach(raw, a, next.contractId);
  if (next.status === "declined") return manager;
  return true;
}
/**
 * Avtalets intagsansvarige (triggern contracts_intake_coach_check, 0041 – gäller alla, också systemet): när kolumnen sätts eller
 * byts ska personen ha ett medlemskap med rollen coach i avtalet. Prövas inte när den lämnas orörd eller töms.
 */
function contractIntakeGuard(next: Tables["contracts"] | null, cur: Tables["contracts"] | undefined, raw: Raw): boolean {
  if (!next || next.intakeCoachId == null || (cur && (cur.intakeCoachId ?? null) === next.intakeCoachId)) return true;
  return raw.all("memberships").some((m) => m.userId === next.intakeCoachId && m.contractId === next.id && m.role === "coach");
}

// ---------------------------------------------------------------- Ändra startdatum (0038)
type CaseStartChangeRow = Tables["case_start_changes"];
/**
 * Raden stämmer med ärendet (triggern case_start_changes_check, de främmande nycklarna, kontrollen och de unika nycklarna, 0038 –
 * gäller också systemet där): ärendets avtal, två olika datum, anteckningen hör till ärendet och är motivering till bara den
 * här ändringen, och seq är ärendets nästa nummer.
 */
function caseStartChangeConsistent(x: CaseStartChangeRow, raw: Raw): boolean {
  if (raw.get("cases", x.caseId)?.contractId !== x.contractId || x.fromDate === x.toDate) return false;
  if (raw.get("case_notes", x.noteId)?.caseId !== x.caseId) return false;
  const own = raw.all("case_start_changes").filter((y) => y.caseId === x.caseId && y.id !== x.id);
  if (raw.all("case_start_changes").some((y) => y.noteId === x.noteId && y.id !== x.id)) return false;
  return x.seq === own.reduce((m, y) => Math.max(m, y.seq), 0) + 1;
}
/** Ett tillfälle i ärendet före dagen har närvaro som en människa registrerat (source manual). */
function manualAttendanceBefore(raw: Raw, caseId: string, day: string): boolean {
  const before = new Set(raw.all("activities").filter((a) => a.caseId === caseId && dayOf(a.startsAt) < day).map((a) => a.id));
  return before.size > 0 && raw.all("attendance").some((t) => t.source === "manual" && before.has(t.activityId));
}
/** En godkänd mötesrapport i ärendet hölls före dagen (checkInsBeforeStart). */
const approvedCheckInBefore = (raw: Raw, caseId: string, day: string): boolean =>
  raw.all("check_ins").some((x) => x.caseId === caseId && x.status === "approved" && dayOf(x.heldAt) < day);

/**
 * Ärendet kan få det nya startdatumet (mm.apply_case_start_change, 0038): ärendet har fortfarande det gamla, pågår eller är
 * pausat, det nya ligger tidigast första mötets dag och senast slutdatumet (eller planerat slut), ingen av månaderna emellan är
 * fakturerad eller godkänd (startChangeLock – mm.start_change_locked_month), inget tillfälle före det nya datumet har manuell
 * närvaro, ingen mötesrapport före det är godkänd och ingen månad som blir utan månadsrapport har en lämnad eller godkänd
 * rapport eller en godkänd bedömning (startChangeReportLock – mm.start_change_report_month).
 */
function caseStartChangeApplies(x: CaseStartChangeRow, raw: Raw): boolean {
  const c = raw.get("cases", x.caseId);
  if (!c || c.contractId !== x.contractId || c.startDate !== x.fromDate || !START_CHANGE_STATUSES.includes(c.status)) return false;
  if (c.firstMeetingAt && x.toDate < dayOf(c.firstMeetingAt)) return false;
  // Inte när ärendets nuvarande första möte är registrerat som ett möte som deltagaren inte kom till (triggern
  // cases_start_date_no_show_guard, 0040 – ändringen sätter ärendets startdatum).
  if (missedCurrentMeeting(raw, c)) return false;
  const end = c.endDate ?? c.plannedEnd;
  if (end && x.toDate > end) return false;
  const billing = { drafts: raw.all("invoice_drafts"), lines: raw.all("invoice_lines"), runs: raw.all("billing_runs") };
  if (startChangeLock(c, startChangeMonths(x.fromDate, x.toDate, c.pausedWeeks), billing)) return false;
  if (manualAttendanceBefore(raw, c.id, x.toDate) || approvedCheckInBefore(raw, c.id, x.toDate)) return false;
  const reports = { reports: raw.all("reports"), assessments: raw.all("monthly_assessments"), minEnrolledDays: startChangeMinDays(raw.get("contracts", c.contractId)?.config) };
  return !startChangeReportLock(c, x.fromDate, x.toDate, reports);
}
/** Högsta skillnaden i minuter mellan ändringens tid och klockan, och mellan ändringen och anteckningen (triggern: 600 sekunder). */
const START_CHANGE_CLOCK_MINUTES = 10;
/**
 * För inloggade (triggrarna case_start_changes_check och case_start_changes_apply, 0038 – inte service role): ärendet kan få det
 * nya startdatumet, ändringen registreras med aktuell tid (högst 10 minuter från klockan – minnets klocka, RawAccess.now; ett minne
 * utan klocka prövar inte tiden) och motiveringen är en ny anteckning av den som ändrar: typ other, inte borttagen, skriven högst
 * 10 minuter från ändringen.
 */
function caseStartChangeChained(x: CaseStartChangeRow, raw: Raw): boolean {
  if (!caseStartChangeApplies(x, raw)) return false;
  const note = raw.get("case_notes", x.noteId);
  if (!note || note.authorId !== x.changedBy || note.kind !== "other" || note.removedAt != null || Math.abs(diffMinutes(note.createdAt, x.changedAt)) > START_CHANGE_CLOCK_MINUTES) return false;
  const now = raw.now?.();
  return !now || Math.abs(diffMinutes(now, x.changedAt)) <= START_CHANGE_CLOCK_MINUTES;
}
/**
 * Ny rad: START_CHANGERS med full åtkomst till ärendet, medlem i avtalet, i eget namn, i överensstämmelse med ärendet och för
 * inloggade enligt caseStartChangeChained. En befintlig rad ändras aldrig (ingen update-policy) – regeln stoppar också
 * MemoryRepo.remove() (ingen delete-policy).
 */
function caseStartChangeWrite(x: CaseStartChangeRow, a: Actor, raw: Raw): boolean {
  if (raw.get("case_start_changes", x.id)) return false;
  return has(START_CHANGERS, a) && accessTo(raw, a, x.caseId) === "full" && member(a, x.contractId) && self(a, x.changedBy) && caseStartChangeConsistent(x, raw)
    && caseStartChangeChained(x, raw);
}
/**
 * Ärendet ändras i samma steg som ändringen skrivs (triggern case_start_changes_apply, 0038 – bara inloggade): det nya
 * startdatumet, och nuvarande fas sedan följer med när den var startdatumet eller hamnar före det nya (phaseSinceAfter).
 */
function caseStartChangeApply(x: CaseStartChangeRow, _a: Actor, raw: Raw): readonly Cascade<Tables>[] {
  const c = raw.get("cases", x.caseId);
  if (!c || !caseStartChangeApplies(x, raw)) throw new PolicyError("case_start_changes");
  return [{ table: "cases", id: c.id, patch: { startDate: x.toDate, phaseSince: phaseSinceAfter(c.phaseSince, x.fromDate, x.toDate) } }];
}
/** Insatsen har startat: startdatumet ändras då bara med Ändra startdatum (cases_start_date_guard, 0038). */
const STARTED: readonly Case["status"][] = ["active", "paused", "closed"];
/**
 * Ärendets startdatum (triggern cases_start_date_guard, 0038): startdatumet i en startad insats (pågår, pausad eller avslutad)
 * ändras aldrig direkt – bara via en ändring (caseStartChangeApply). Före start (t.ex. ett bekräftat ärende med ett startdatum
 * från beställningen) sätts det när insatsen startar, och bara av coach, samordnare och avtalsansvarig – aldrig av ekonomen eller
 * kommunen. Spärren går inte runt via statusen: en startad insats blir aldrig ostartad igen. Ett nytt ärende har inget startdatum
 * (caseWrite).
 */
function caseStartGuard(cur: Case, next: Case, a: Actor): boolean {
  if (STARTED.includes(cur.status) && !STARTED.includes(next.status)) return false;
  if ((next.startDate ?? null) === (cur.startDate ?? null)) return true;
  if (cur.startDate != null && STARTED.includes(cur.status)) return false;
  return has(START_CHANGERS, a);
}

// ---------------------------------------------------------------- Bonus (0039)
type BonusClaimRow = Tables["bonus_claims"];
type BonusDecisionRow = Tables["bonus_claim_decisions"];
/** Kommunen läser bara skickade och beslutade anspråk (bonus_claims_select, 0039) – aldrig förslag eller återtagna. */
const BONUS_CUSTOMER_STATUSES: readonly BonusClaimRow["status"][] = ["submitted", "approved", "rejected"];
/** Fälten som coachen ändrar i ett förslag (triggern bonus_claims_guard). */
const BONUS_EDITABLE = ["basis", "reachedOn", "verificationKind", "verificationOn", "checklist"];
/** Högsta skillnaden i minuter mellan radens tid och klockan (triggrarna: 600 sekunder). Ett minne utan klocka prövar inte tiden. */
const BONUS_CLOCK_MINUTES = 10;
const atNow = (raw: Raw, at: string | null | undefined): boolean => {
  const now = raw.now?.();
  return !now || (!!at && Math.abs(diffMinutes(now, at)) <= BONUS_CLOCK_MINUTES);
};
const isObj = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v);
const chars = (s: string | null | undefined) => [...(s ?? "")].length;
/** Tabellens kontroller (check i 0039 – gäller alla): steget, läget, inga belopp och inga dokument, formen och texternas längd. */
function bonusClaimShape(x: BonusClaimRow): boolean {
  const statusOk = (BONUS_CLAIM_STATUSES as readonly string[]).includes(x.status) && (x.source == null || (BONUS_SOURCES as readonly string[]).includes(x.source));
  // Steget krävs (bonus_claims_step_shape: en ny eller ändrad rad har alltid ett bonussteg, och slaget följer steget).
  const stepOk = x.step != null && Number.isInteger(x.step) && x.step >= 1 && x.step <= 5 && x.kind === stepKind(x.step) && FOLLOWS_STEP3.includes(x.step) === (x.followsClaimId != null);
  const sent = ["submitted", "approved", "rejected"].includes(x.status);
  const decided = ["approved", "rejected"].includes(x.status);
  const shape = (!sent || (x.snapshot != null && x.submittedAt != null)) && (x.status !== "suggested" || (x.snapshot == null && x.submittedAt == null))
    && decided === (x.customerDecision != null && x.decidedAt != null)
    && (!decided || x.customerDecision === x.status) && (x.status === "withdrawn") === (x.withdrawnAt != null && x.withdrawnBy != null);
  const text = chars(x.basis) <= 500 && (x.verificationKind == null || chars(x.verificationKind) <= 200) && (x.decisionNote == null || chars(x.decisionNote) <= 1000)
    && isObj(x.checklist) && (x.snapshot == null || isObj(x.snapshot));
  return statusOk && stepOk && shape && text && x.amountOre == null && x.evidencePaths.length === 0;
}
/**
 * Raden stämmer med ärendet (triggern bonus_claims_check, 0039 – gäller också systemet där): ärendets avtal, händelsen i ärendet
 * och steg 3-anspråket i samma ärende.
 */
function bonusClaimConsistent(x: BonusClaimRow, raw: Raw): boolean {
  if (raw.get("cases", x.caseId)?.contractId !== x.contractId) return false;
  if (x.outcomeEventId != null && raw.get("outcome_events", x.outcomeEventId)?.caseId !== x.caseId) return false;
  if (x.followsClaimId != null) {
    const f = raw.get("bonus_claims", x.followsClaimId);
    if (!f || f.caseId !== x.caseId || f.step !== 3) return false;
  }
  return true;
}
/** Redovisningsunderlaget hör till anspråket (triggern bonus_claims_guard): version 1, anspråkets id och bonussteg. */
const snapshotFits = (x: BonusClaimRow): boolean => {
  const s = x.snapshot as { v?: unknown; claimId?: unknown; step?: unknown } | null;
  return !!s && s.v === 1 && s.claimId === x.id && s.step === x.step;
};
/**
 * Övergångarna för inloggade (triggern bonus_claims_guard, 0039): ett beslutat eller återtaget anspråk ändras aldrig och en
 * ändring som inte ändrar något nekas; i ett förslag ändras bara kommentaren, resultatdatum, verifieringen och checklistan;
 * förslag → skickat med redovisningsunderlaget, i eget namn och med aktuell tid; förslag eller skickat → återtaget i eget namn
 * med aktuell tid. Kommunens beslut registreras bara via bonus_claim_decisions (bonusDecisionApply).
 */
function bonusClaimTransition(cur: BonusClaimRow, x: BonusClaimRow, a: Actor, raw: Raw): boolean {
  if (cur.status === "approved" || cur.status === "rejected" || cur.status === "withdrawn") return false;
  const changed = changedFields(cur, x);
  if (!changed.length) return false;
  let allowed: string[];
  if (cur.status === "suggested" && x.status === "suggested") allowed = BONUS_EDITABLE;
  else if (cur.status === "suggested" && x.status === "submitted") {
    if (x.snapshot == null || x.submittedAt == null || !self(a, x.submittedBy) || !atNow(raw, x.submittedAt) || !snapshotFits(x)) return false;
    allowed = [...BONUS_EDITABLE, "status", "snapshot", "submittedAt", "submittedBy"];
  } else if (x.status === "withdrawn") {
    if (x.withdrawnAt == null || !self(a, x.withdrawnBy) || !atNow(raw, x.withdrawnAt)) return false;
    allowed = ["status", "withdrawnAt", "withdrawnBy"];
  } else return false;
  return changed.every((k) => allowed.includes(k));
}
/**
 * Ny rad: den som arbetar i ärendet, medlem i avtalet, som förslag från coachen i eget namn (source manual) utan underlag, beslut
 * eller återtagande (bonus_claims_insert). För inloggade dessutom (triggern bonus_claims_check): aktuell tid och – för steg 4 och 5
 * – ett steg 3-anspråk som räknas. Ändring: den som arbetar i ärendet, övergångarna i bonusClaimTransition. Ingen raderar (regeln
 * stoppar också MemoryRepo.remove(): raden är oförändrad). Högst ett anspråk som räknas per steg: UNIQUE_KEYS.
 */
function bonusClaimWrite(x: BonusClaimRow, a: Actor, raw: Raw): boolean {
  if (!bonusClaimShape(x) || !bonusClaimConsistent(x, raw)) return false;
  const cur = raw.get("bonus_claims", x.id);
  if (!cur) {
    if (!workOn(x.caseId, a, raw) || !member(a, x.contractId) || !self(a, x.createdBy)) return false;
    if (x.status !== "suggested" || x.source !== "manual" || x.snapshot != null || x.submittedAt != null || x.submittedBy != null || x.withdrawnAt != null || x.withdrawnBy != null) return false;
    if (x.customerDecision != null || x.decidedBy != null || x.decidedAt != null || x.decisionNote != null || x.invoiceDraftId != null) return false;
    const f = x.followsClaimId ? raw.get("bonus_claims", x.followsClaimId) : undefined;
    if (f && !BONUS_ACTIVE_STATUSES.includes(f.status)) return false;
    return atNow(raw, x.createdAt);
  }
  return workOn(cur.caseId, a, raw) && workOn(x.caseId, a, raw) && bonusClaimTransition(cur, x, a, raw);
}
/** Beslutet stämmer med anspråket (triggern bonus_claim_decisions_check – för alla): samma ärende och avtal; form och längd (check). */
function bonusDecisionConsistent(x: BonusDecisionRow, raw: Raw): boolean {
  const k = raw.get("bonus_claims", x.claimId);
  if (!k || k.caseId !== x.caseId || k.contractId !== x.contractId) return false;
  if (!["approved", "rejected"].includes(x.decision) || (x.note != null && chars(x.note) > 1000)) return false;
  if (x.via === "portal") return x.decidedBy != null && x.decidedBy === x.recordedBy;
  return x.via === "mejl" && x.decidedBy == null && x.note != null && /\S/.test(x.note);
}
/** Beslutet står redan på anspråket (testdata som läses in beslutade – mm.apply_bonus_decision ändrar då ingenting för systemet). */
const decisionAlreadyOn = (x: BonusDecisionRow, k: BonusClaimRow): boolean =>
  k.status === x.decision && k.customerDecision === x.decision && k.decidedAt === x.decidedAt;
/**
 * Anspråket kan få beslutet (mm.apply_bonus_decision, 0039): det är skickat och inte beslutat, och ett godkännande av steg 4 eller 5
 * kräver att steg 3-anspråket är godkänt.
 */
function bonusDecisionApplies(x: BonusDecisionRow, raw: Raw): boolean {
  const k = raw.get("bonus_claims", x.claimId);
  if (!k || k.caseId !== x.caseId || k.contractId !== x.contractId || k.status !== "submitted" || k.customerDecision != null) return false;
  if (x.decision === "rejected" || k.followsClaimId == null) return true;
  return raw.get("bonus_claims", k.followsClaimId)?.status === "approved";
}
/**
 * Ny rad (bonus_claim_decisions_insert, 0039): kommunens handläggare i portalen i eget namn med åtkomsten "customer" till ärendet,
 * eller samordnare och avtalsansvarig i avtalet (full åtkomst) som registrerar ett beslut som kom med mejl – i eget namn och med
 * motivering. För inloggade dessutom aktuell tid och att anspråket kan få beslutet (triggrarna). En befintlig rad ändras aldrig
 * (ingen update-policy) – regeln stoppar också MemoryRepo.remove(). Kommunen ser bara skickade anspråk, så bara de går att besluta.
 */
function bonusDecisionWrite(x: BonusDecisionRow, a: Actor, raw: Raw): boolean {
  if (raw.get("bonus_claim_decisions", x.id) || !bonusDecisionConsistent(x, raw)) return false;
  const k = raw.get("bonus_claims", x.claimId);
  // Uppslaget i triggern görs med den inloggades rättigheter: anspråket ska gå att läsa.
  if (!k || !RULES.bonus_claims.read(k, a, raw)) return false;
  const acc = accessTo(raw, a, x.caseId);
  // Bara handläggaren som beställde insatsen (mm.case_referrer_id) – också när kommunens synlighet är vidare än egna ärenden.
  const portal = x.via === "portal" && a.role === "kommun_handlaggare" && acc === "customer" && raw.get("cases", x.caseId)?.referrerId === a.userId
    && self(a, x.decidedBy) && self(a, x.recordedBy);
  const mejl = x.via === "mejl" && (a.role === "samordnare" || a.role === "avtalsansvarig") && member(a, x.contractId) && acc === "full" && x.decidedBy == null && self(a, x.recordedBy);
  return (portal || mejl) && atNow(raw, x.decidedAt) && bonusDecisionApplies(x, raw);
}
/**
 * Anspråket ändras i samma steg som beslutet skrivs (triggern bonus_claim_decisions_apply, 0039 – för alla roller): status och
 * beslut, vem (handläggaren, eller den som registrerade ett mejl), när och motiveringen. Avslås bonussteg 3 återtas de steg 4 och
 * 5 som bygger på det och inte är beslutade (av systemet, med beslutets tid). Står beslutet redan på anspråket ändras inget – bara
 * för systemet (bypass, som service role och seed: p_existing_ok i mm.apply_bonus_decision); en inloggad nekas som för vilket
 * beslutat anspråk som helst. Annars stoppas beslutet – ett anspråk blir aldrig kvar som skickat bredvid ett beslut.
 */
function bonusDecisionApply(x: BonusDecisionRow, _a: Actor, raw: Raw, bypass: boolean): readonly Cascade<Tables>[] {
  const k = raw.get("bonus_claims", x.claimId);
  if (bypass && k && k.caseId === x.caseId && k.contractId === x.contractId && decisionAlreadyOn(x, k)) return [];
  if (!k || !bonusDecisionApplies(x, raw)) throw new PolicyError("bonus_claim_decisions");
  const out: Cascade<Tables>[] = [
    { table: "bonus_claims", id: x.claimId, patch: { status: x.decision, customerDecision: x.decision, decidedBy: x.decidedBy ?? x.recordedBy, decidedAt: x.decidedAt, decisionNote: x.note } },
  ];
  if (x.decision === "rejected" && k.step === 3) {
    for (const y of raw.all("bonus_claims")) {
      if (y.followsClaimId === k.id && (y.status === "suggested" || y.status === "submitted")) {
        out.push({ table: "bonus_claims", id: y.id, patch: { status: "withdrawn", withdrawnAt: x.decidedAt, withdrawnBy: SYSTEM_ACTOR.userId } });
      }
    }
  }
  return out;
}
/** Kommunens beslut på anspråket (bonus_claims_status_shape och beslutets fält). */
const BONUS_DECISION_FIELDS = ["customerDecision", "decidedBy", "decidedAt", "decisionNote"] as const;
/**
 * För alla roller, också systemet (bypass, som service role): tabellens kontroller och triggern bonus_claims_check (form och
 * samma ärende), och triggern bonus_claims_guard – ett beslutat eller återtaget anspråk ändras aldrig, och kommunens beslut
 * (godkänt eller avslaget och beslutets fält) skrivs bara med beslutet: anspråket är skickat och beslutet med samma anspråk,
 * beslut och tid finns i bonus_claim_decisions. Beslutets egen ändring (bonusDecisionApply) går inte genom repot och prövas inte
 * här, som funktionen med flaggan i Postgres. En rad som ett beslut, en fakturarad eller ett steg 4- eller 5-anspråk pekar på tas
 * inte bort (främmande nycklar).
 */
function bonusClaimGuard(x: BonusClaimRow | null, cur: BonusClaimRow | undefined, raw: Raw): boolean {
  if (!x) {
    const id = cur?.id;
    return !raw.all("bonus_claim_decisions").some((d) => d.claimId === id) && !raw.all("invoice_lines").some((l) => l.bonusClaimId === id)
      && !raw.all("bonus_claims").some((y) => y.followsClaimId === id);
  }
  if (!bonusClaimShape(x) || !bonusClaimConsistent(x, raw)) return false;
  if (!cur) return true;
  if (cur.status === "approved" || cur.status === "rejected" || cur.status === "withdrawn") return false;
  const deciding = x.status === "approved" || x.status === "rejected" || BONUS_DECISION_FIELDS.some((f) => (x[f] ?? null) !== (cur[f] ?? null));
  if (!deciding) return true;
  return cur.status === "submitted" && (x.status === "approved" || x.status === "rejected")
    && raw.all("bonus_claim_decisions").some((d) => d.claimId === x.id && d.decision === x.status && d.decidedAt === x.decidedAt);
}
/**
 * För alla roller, också systemet (bypass): append-only (triggern bonus_claim_decisions_append_only och rättigheterna – service
 * role läser och skapar bara) – en rad ändras och tas aldrig bort; en ny rad stämmer med anspråket och har rätt form
 * (bonus_claim_decisions_check och via_shape).
 */
function bonusDecisionGuard(x: BonusDecisionRow | null, cur: BonusDecisionRow | undefined, raw: Raw): boolean {
  return !!x && !cur && bonusDecisionConsistent(x, raw);
}
/**
 * Ekonomen (åtkomsten billing) läser anspråken utan innehållet (vyn bonus_claims_public, 0039): bonussteget, läget och beslutet –
 * aldrig redovisningsunderlaget, coachens kommentar, checklistan, verifieringens typ eller kommunens motivering.
 */
function bonusClaimProject(x: BonusClaimRow, a: Actor, raw: Raw): BonusClaimRow {
  return accessTo(raw, a, x.caseId) === "billing" ? { ...x, basis: "", checklist: {}, snapshot: null, verificationKind: null, decisionNote: null } : x;
}
/**
 * Fakturaradens slag (triggern invoice_lines_bonus_check, 0039 – gäller alla): en rad utan anspråk står bara på en periodisk
 * faktura; en bonusrad bara på en bonusfaktura och för ett godkänt anspråk i radens ärende och fakturans avtal.
 */
function invoiceLineKindOk(x: Tables["invoice_lines"], raw: Raw): boolean {
  const d = raw.get("invoice_drafts", x.invoiceDraftId);
  if (x.bonusClaimId == null) return d?.kind === "periodic";
  const k = raw.get("bonus_claims", x.bonusClaimId);
  return d?.kind === "bonus" && !!k && k.caseId === x.caseId && k.contractId === d.contractId && k.status === "approved";
}

// ---------------------------------------------------------------- Deltagaren kom inte till första mötet (0040)
type NoShowRow = Tables["first_meeting_no_shows"];
/** Orsakens längd (kontrollen first_meeting_no_shows_reason_check). */
const NO_SHOW_REASON_MAX = 300;
/**
 * Raden stämmer (triggern first_meeting_no_shows_check och kontrollerna i tabellen, 0040 – för alla roller, också systemet):
 * slaget och orsaken (högst 300 tecken; vid giltig frånvaro krävs den och får inte vara bara blanksteg), ärendet är bekräftat och
 * inte startat (inget startdatum), raden hör till ärendets avtal, mötet är ärendets första möte och mötets tid har varit (minnets
 * klocka, RawAccess.now – ett minne utan klocka prövar inte tiden).
 */
function noShowConsistent(x: NoShowRow, raw: Raw): boolean {
  if (!(FIRST_MEETING_NO_SHOW_KINDS as readonly string[]).includes(x.kind)) return false;
  if (x.reason != null && chars(x.reason) > NO_SHOW_REASON_MAX) return false;
  if (x.kind === "giltig" && (x.reason == null || !/\S/.test(x.reason))) return false;
  const c = raw.get("cases", x.caseId);
  if (!c || c.contractId !== x.contractId || c.status !== "confirmed" || c.startDate != null || !c.firstMeetingAt || c.firstMeetingAt !== x.meetingAt) return false;
  const now = raw.now?.();
  return !now || x.meetingAt <= now;
}
/**
 * Ny rad (first_meeting_no_shows_insert, 0040): den som arbetar i ärendet (workOn – full eller team), medlem i avtalet, i eget namn.
 * För inloggade dessutom (triggern) raden stämmer och registreras med aktuell tid (högst 10 minuter från klockan). En befintlig
 * rad ändras aldrig (ingen update-policy) – regeln stoppar också MemoryRepo.remove(), och guard nedan gäller också systemet.
 */
function noShowWrite(x: NoShowRow, a: Actor, raw: Raw): boolean {
  if (raw.get("first_meeting_no_shows", x.id)) return false;
  return workOn(x.caseId, a, raw) && member(a, x.contractId) && self(a, x.registeredBy) && noShowConsistent(x, raw) && atNow(raw, x.registeredAt);
}
/**
 * För alla roller, också systemet (bypass, som service role): en rad ändras aldrig (triggern first_meeting_no_shows_append_only)
 * och en ny rad stämmer med ärendet (first_meeting_no_shows_check). Systemet får ta bort en rad (gallring – service role har
 * rättigheten delete); inloggade nekas av skrivregeln (noShowWrite: raden finns redan), som i Postgres där de saknar rättigheten.
 */
function noShowGuard(x: NoShowRow | null, cur: NoShowRow | undefined, raw: Raw): boolean {
  if (!x) return true;
  return !cur && noShowConsistent(x, raw);
}
/** Ärendets nuvarande första möte är registrerat som ett möte som deltagaren inte kom till. */
function missedCurrentMeeting(raw: Raw, c: Pick<Case, "id" | "firstMeetingAt">): boolean {
  return !!c.firstMeetingAt && raw.all("first_meeting_no_shows").some((x) => x.caseId === c.id && x.meetingAt === c.firstMeetingAt);
}
/**
 * Ärendets startdatum (triggern cases_start_date_no_show_guard, 0040 – för alla roller, också systemet): ett nytt eller ändrat
 * startdatum sätts inte så länge ärendets första möte (raden efter ändringen) är registrerat som ett möte som deltagaren inte kom
 * till. Efter ett nytt första möte gäller den vanliga regeln. Ändra startdatum (afterInsert på case_start_changes) prövar samma
 * regel i caseStartChangeApplies.
 */
function caseNoShowStartGuard(next: Case | null, cur: Case | undefined, raw: Raw): boolean {
  if (!next || next.startDate == null || (cur && (cur.startDate ?? null) === next.startDate)) return true;
  return !missedCurrentMeeting(raw, next);
}

// ---------------------------------------------------------------- Tabellerna
const RULES: { [N in TableName]: RowPolicy<Tables, Tables[N]> } = {
  // ---- Avtal, organisationer, användare
  holidays: { read: () => true, write: (_r, a) => a.role === "admin" },
  organizations: {
    read: (o, a, raw) => a.role === "admin" || ((isMB(a) || isKom(a)) && orgsOf(a, raw).has(o.id)),
    write: (_o, a) => a.role === "admin",
  },
  // Intagsansvarig (0041): kommunen läser aldrig kolumnen (vyn contracts_public lämnar null) och personen ska ha rollen coach.
  contracts: {
    read: (c, a) => (isMB(a) || isKom(a)) && member(a, c.id),
    write: (_c, a) => a.role === "admin",
    project: (c, a) => (isKom(a) && c.intakeCoachId != null ? { ...c, intakeCoachId: null } : c),
    guard: contractIntakeGuard,
  },
  contract_areas: { read: (x, a) => (isMB(a) || isKom(a)) && member(a, x.contractId), write: (_x, a) => a.role === "admin" },
  // Prislistan: bara Miljonbemanning (synpunkt #11 – inga belopp för kommunen, 0026).
  price_items: { read: (x, a) => isMB(a) && member(a, x.contractId), write: (_x, a) => a.role === "admin" },
  profiles: {
    read: (p, a, raw) => self(a, p.id) || a.role === "admin" || ((isMB(a) || isKom(a)) && orgsOf(a, raw).has(p.organizationId)),
    write: (p, a, raw) =>
      a.role === "admin"
      || (a.role === "avtalsansvarig" && customersOf(a, raw).has(p.organizationId)) // bjuder in kommunanvändare
      || (self(a, p.id) && exists(raw, "profiles", p.id)), // egen profil (t.ex. senaste inloggning)
  },
  memberships: {
    read: (m, a) => self(a, m.userId) || ((isMB(a) || isKom(a)) && member(a, m.contractId)),
    write: (m, a) => a.role === "admin" || (a.role === "avtalsansvarig" && member(a, m.contractId) && isCustomerRole(m.role)),
  },
  // Vald roll (0027): bara den egna raden, id = userId, och bara en roll man har medlemskap för (role_choices_insert/update).
  role_choices: {
    read: (x, a) => self(a, x.userId),
    write: (x, a, raw) => self(a, x.userId) && x.id === x.userId && raw.all("memberships").some((m) => m.userId === x.userId && m.role === x.role),
  },
  buyer_references: {
    read: (b, a, raw) => a.role === "admin" || ((isMB(a) || isKom(a)) && customersOf(a, raw).has(b.customerId)),
    write: (b, a, raw) => a.role === "admin" || ((a.role === "avtalsansvarig" || a.role === "ekonom") && customersOf(a, raw).has(b.customerId)),
  },

  // ---- Person och ärende
  persons: {
    // Personen syns bara via ett ärende där rollen får se personuppgifter (aldrig ekonom eller skyddade för andra än namngivna).
    read: (p, a, raw) => (casesByPerson(raw).get(p.id) ?? []).some((id) => canSeePerson(accessTo(raw, a, id))),
    write: (p, a, raw) => {
      const refs = casesByPerson(raw).get(p.id) ?? [];
      if (!refs.length) return has(ORDER_CREATORS, a); // ny person i en beställning (ärendet sparas efteråt)
      // Systemadministratören (0032, Ändra kontaktväg): bara kontaktuppgifterna, med full åtkomst till ett av personens ärenden.
      if (a.role === "admin") {
        const cur = raw.get("persons", p.id);
        return !!cur && changedFields(cur, p).every((k) => (PERSON_CONTACT_FIELDS as readonly string[]).includes(k)) && refs.some((id) => accessTo(raw, a, id) === "full");
      }
      return refs.some((id) => {
        const acc = accessTo(raw, a, id);
        return (acc === "full" && has(CASE_EDITORS, a)) || (acc === "customer" && a.role === "kommun_handlaggare" && self(a, raw.get("cases", id)?.referrerId));
      });
    },
  },
  cases: { read: (c, a, raw) => accessOfCase(raw, a, c) !== "none", write: caseWrite, guard: caseNoShowStartGuard },
  case_status_history: { read: (h, a, raw) => canSeePerson(accessTo(raw, a, h.caseId)), write: (h, a, raw) => caseWriteById(h.caseId, a, raw) },
  case_counters: { read: (x, a) => isMB(a) && member(a, x.contractId), write: never }, // löpnummer: ctx.system
  case_team: {
    read: (t, a, raw) => canSeePerson(accessTo(raw, a, t.caseId)),
    write: (t, a, raw) => has(CASE_EDITORS, a) && accessTo(raw, a, t.caseId) === "full",
  },

  // ---- Mejlavrop (avrop@)
  inbound_emails: {
    // Mejl om skyddade personuppgifter innehåller inga uppgifter om deltagaren (bara "ring mig") och syns för inkorgens roller.
    read: (e, a, raw) => has(OVERSIGHT, a) && (!e.caseId || e.classification === "order_protected" || !["none", "restricted"].includes(accessTo(raw, a, e.caseId))),
    write: (e, a, raw) => (a.role === "samordnare" || a.role === "avtalsansvarig") && (!e.caseId || accessTo(raw, a, e.caseId) === "full"),
  },

  // ---- Coachning: anteckningar och bedömningar (aldrig ekonom eller kommunen)
  intake_assessments: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  check_ins: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  monthly_assessments: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  monthly_plans: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  deviations: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  consents: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  // Närvaro: även ekonom (debitering) och kommunen (veckorapport, orsakskategori)
  activities: {
    read: (x, a, raw) => ["full", "team", "billing", "customer"].includes(accessTo(raw, a, x.caseId)),
    // Inbjudningens källa (0035, triggern activities_invite_source): en ny rad är manuell, och källan ändras aldrig – audience skrivs
    // bara av servern (den automatiska synkningen, ctx.system). Borttagning (raden som den är) prövas som förut.
    write: (x, a, raw) => {
      if (!workOn(x.caseId, a, raw)) return false;
      const cur = raw.get("activities", x.id);
      return cur ? x.inviteSource === cur.inviteSource : x.inviteSource === "manual";
    },
  },
  attendance: {
    read: (x, a, raw) => ["full", "team", "billing", "customer"].includes(accessTo(raw, a, x.caseId)),
    // Bara manuell närvaro – automatisk (auto) skrivs bara av jobbet auto_attendance via ctx.system (0030).
    write: (x, a, raw) => workOn(x.caseId, a, raw) && x.source === "manual",
  },
  // Gruppaktiviteter (0030): Miljonbemanning i avtalet utom ekonomen – aldrig kommunen.
  group_activities: { read: (x, a) => has(GROUP_ACTIVITY_READERS, a) && member(a, x.contractId), write: groupActivityWrite },
  // Återkommande aktiviteter (0035): som gruppaktiviteterna.
  group_activity_series: { read: (x, a) => has(GROUP_ACTIVITY_READERS, a) && member(a, x.contractId), write: seriesWrite },
  // Gruppmål (0033): som gruppaktiviteterna, och bara med full- eller teamåtkomst till ärendet – aldrig ekonomen eller kommunen.
  group_goal_results: {
    read: (x, a, raw) => has(GROUP_ACTIVITY_READERS, a) && member(a, x.contractId) && ["full", "team"].includes(accessTo(raw, a, x.caseId)),
    write: groupGoalWrite,
  },
  // Händelser och praktik: resultat som kommunen får i rapporterna
  outcome_events: { read: (x, a, raw) => canSeePerson(accessTo(raw, a, x.caseId)), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  placements: { read: (x, a, raw) => canSeePerson(accessTo(raw, a, x.caseId)), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  employers: {
    read: (e, a, raw) => isMB(a) || (isKom(a) && (casesByEmployer(raw).get(e.id) ?? []).some((id) => accessTo(raw, a, id) === "customer")),
    write: (_e, a) => has(CASE_WORKERS, a),
  },
  contract_deviations: {
    read: (d, a, raw) => {
      if (!member(a, d.contractId)) return false;
      return has(OVERSIGHT, a) && (!d.caseId || accessTo(raw, a, d.caseId) !== "none");
    },
    // Kommunens godkännande av en åtgärdsplan registreras av avtalsansvarig (beslut 2026-10-07 – kommunens chef är borttagen).
    write: (d, a) => ["samordnare", "avtalsansvarig", "chef"].includes(a.role) && member(a, d.contractId),
  },
  // Bonusanspråk (0039, beslut 2026-11-04): raden har aldrig ett belopp (amountOre är alltid null – beloppet räknas bara på
  // bonusfakturan), så kommunen kan läsa skickade och beslutade anspråk i sina ärenden. Förslag och återtagna anspråk är interna.
  // Bara den som arbetar i ärendet skapar och ändrar (ekonomens ändring från 0026 är borttagen); kommunens beslut skrivs bara
  // som ett beslut (bonus_claim_decisions).
  bonus_claims: {
    read: (x, a, raw) => {
      const acc = accessTo(raw, a, x.caseId);
      return ["full", "team", "billing"].includes(acc) || (acc === "customer" && BONUS_CUSTOMER_STATUSES.includes(x.status));
    },
    project: bonusClaimProject,
    write: bonusClaimWrite,
    guard: bonusClaimGuard,
  },
  // Kommunens beslut (0039): append-only – läses av den som arbetar i ärendet och av kommunen (inte ekonomen: motiveringen är
  // inget för faktureringen), skapas i portalen eller registreras efter ett mejl; en ny rad ändrar anspråket i samma steg
  // (afterInsert – för alla roller, som triggern bonus_claim_decisions_apply). Ändras och tas aldrig bort, inte heller av
  // systemet (guard).
  bonus_claim_decisions: {
    read: (x, a, raw) => ["full", "team", "customer"].includes(accessTo(raw, a, x.caseId)),
    write: bonusDecisionWrite,
    afterInsert: bonusDecisionApply,
    afterInsertForAll: true,
    guard: bonusDecisionGuard,
  },

  // ---- Rapporter
  reports: { read: reportRead, write: reportWrite },

  // ---- Puls: coachen läser aldrig enskilda svar
  pulse_invites: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: (x, a, raw) => workOn(x.caseId, a, raw) },
  pulse_responses: {
    read: (x, a, raw) => has(OVERSIGHT, a) && accessTo(raw, a, x.caseId) === "full",
    write: (x, a, raw) => {
      if (a.role !== "deltagare" || exists(raw, "pulse_responses", x.id)) return false;
      const inv = raw.get("pulse_invites", x.inviteId);
      return !!inv && !inv.usedAt && inv.caseId === x.caseId; // tokenkontrollen görs av hanteraren
    },
  },

  // ---- KPI:er, flaggor, deadlines (interna – aldrig kommunen eller ekonomen)
  kpi_snapshots: { read: (x, a) => has(["samordnare", "avtalsansvarig", "chef", "admin", "coach"], a) && member(a, x.contractId), write: never },
  alerts: {
    read: (x, a, raw) => isMB(a) && a.role !== "ekonom" && member(a, x.contractId) && (x.recipientRoles.includes(a.role) || a.role === "chef" || a.role === "admin")
      && (!x.caseId || accessTo(raw, a, x.caseId) !== "none"),
    write: (x, a, raw) => exists(raw, "alerts", x.id) && isMB(a) && x.recipientRoles.includes(a.role) && member(a, x.contractId),
  },
  alert_acks: { read: (_x, a) => isMB(a), write: (x, a) => isMB(a) && self(a, x.acknowledgedBy) },
  deadlines: {
    read: (x, a, raw) => isMB(a) && a.role !== "ekonom" && member(a, x.contractId) && (!x.caseId || accessTo(raw, a, x.caseId) !== "none"),
    write: never,
  },

  // ---- Fakturering
  billing_runs: { read: (x, a) => has(BILLING_READERS, a) && member(a, x.contractId), write: (x, a) => a.role === "ekonom" && member(a, x.contractId) },
  invoice_drafts: { read: (x, a) => has(BILLING_READERS, a) && member(a, x.contractId), write: (x, a) => a.role === "ekonom" && member(a, x.contractId) },
  // Fakturaraderna fryses när fakturan skapas (0023, mm.invoice_editable): bara medan fakturan är underlag eller godkänd – eller
  // returnerad, när den görs om med raderna frysta på nytt (eko.reissue) – får ekonomen lägga till, ändra eller ta bort en rad.
  // En skapad faktura (Fortnox, bokförd, skickad, betald, manuell) eller en krediterad ändras aldrig.
  invoice_lines: {
    read: (x, a, raw) => has(BILLING_READERS, a) && member(a, raw.get("invoice_drafts", x.invoiceDraftId)?.contractId),
    write: (x, a, raw) => {
      const d = raw.get("invoice_drafts", x.invoiceDraftId);
      const before = raw.get("invoice_lines", x.id);
      const editable = (id: string | undefined) => {
        const s = id ? raw.get("invoice_drafts", id)?.status : undefined;
        return s === "draft" || s === "approved" || s === "returned";
      };
      return a.role === "ekonom" && member(a, d?.contractId) && editable(x.invoiceDraftId) && (!before || editable(before.invoiceDraftId)) && invoiceLineKindOk(x, raw);
    },
  },
  billing_week_approvals: { read: (x, a) => has(BILLING_READERS, a) && member(a, x.contractId), write: (x, a) => a.role === "ekonom" && member(a, x.contractId) },
  invoice_credits: { read: (x, a) => has(BILLING_READERS, a) && member(a, x.contractId), write: (x, a) => a.role === "ekonom" && member(a, x.contractId) },
  fortnox_runs: { read: (x, a) => has(BILLING_READERS, a) && member(a, x.contractId), write: (x, a) => a.role === "ekonom" && member(a, x.contractId) },

  // ---- Integrationer, jobb, AI
  integrations: adminOnly<"integrations">(),
  jobs: adminOnly<"jobs">(),
  ai_runs: {
    read: (x, a, raw) => (x.caseId ? notesRead(x.caseId, a, raw) : has(OVERSIGHT, a)),
    write: (x, a, raw) => (x.caseId ? workOn(x.caseId, a, raw) : a.role === "samordnare" || a.role === "avtalsansvarig"),
  },
  ai_field_decisions: {
    read: (x, a, raw) => {
      const run = x.aiRunId ? raw.get("ai_runs", x.aiRunId) : undefined;
      if (run) return RULES.ai_runs.read(run, a, raw);
      return self(a, x.decidedBy) || a.role === "chef" || a.role === "admin";
    },
    write: (x, a, raw) => {
      if (!has(CASE_WORKERS, a) || !self(a, x.decidedBy)) return false;
      const run = x.aiRunId ? raw.get("ai_runs", x.aiRunId) : undefined;
      return !run || !run.caseId || workOn(run.caseId, a, raw);
    },
  },

  // ---- Kommunikation och logg
  messages: {
    read: messageRead,
    write: (m, a, raw) => {
      const cur = raw.get("messages", m.id);
      // Läskvitto: den som arbetar i ärendet eller beställande handläggare.
      if (cur) return messageRead(m, a, raw) && (a.role === "kommun_handlaggare" || has(CASE_WORKERS, a)) && readReceiptOnly(cur, m, a);
      if (!self(a, m.senderId)) return false;
      const acc = accessTo(raw, a, m.caseId);
      if (isMB(a)) return has(CASE_WORKERS, a) && (acc === "full" || acc === "team");
      return a.role === "kommun_handlaggare" && acc === "customer";
    },
  },
  audit_log: { read: (x, a) => a.role === "admin" || (a.role === "chef" && (!x.contractId || member(a, x.contractId))), write: never }, // append-only via ctx.audit
  outbound_messages: { read: (_x, a) => a.role === "admin" || a.role === "samordnare", write: never }, // bara via ctx.notify
  user_notifications: { read: (x, a) => self(a, x.recipientId), write: never }, // skapas via ctx.system
  notification_reads: { read: (x, a) => self(a, x.userId), write: (x, a) => self(a, x.userId) },
  tasks: {
    read: (t, a, raw) => {
      if (self(a, t.fromId) || a.role === "admin") return true;
      if (t.toId ? self(a, t.toId) : t.toRole === a.role) return true;
      // Den som arbetar i ärendet ser uppgifter om det (t.ex. att kommunen fått en beslutsuppgift)
      return isMB(a) && a.role !== "ekonom" && t.caseIds.some((id) => notesRead(id, a, raw));
    },
    write: (t, a, raw) => {
      if (exists(raw, "tasks", t.id)) return self(a, t.fromId) || (t.toId ? self(a, t.toId) : t.toRole === a.role); // klarmarkera
      return isMB(a) && self(a, t.fromId);
    },
  },
  org_settings: { read: (_x, a) => isMB(a), write: (_x, a) => a.role === "admin" },
  case_seen: { read: (x, a) => self(a, x.userId), write: (x, a) => self(a, x.userId) },
  template_versions: { read: (_x, a) => a.role === "admin" || a.role === "samordnare", write: (_x, a) => a.role === "admin" },
  log_checks: { read: (_x, a) => a.role === "admin" || a.role === "chef", write: (x, a) => (a.role === "admin" || a.role === "chef") && self(a, x.signedBy) },
  // Bara testdata (scenarier och demoförklaringar) – inga personuppgifter
  demo_tags: { read: () => true, write: never },

  // ---- Röstinspelning (docs/PLAN-ROST.md). Deltagaren (länk utan inloggning) skriver aldrig själv: hanteraren kontrollerar
  //      länkens token och sparar via ctx.system.
  voice_links: {
    read: (x, a, raw) => notesRead(x.caseId, a, raw),
    // Aldrig inspelningslänkar i skyddade ärenden (CLAUDE.md punkt 8: inga SMS eller mejl till deltagaren, ingen AI).
    write: (x, a, raw) => workOn(x.caseId, a, raw) && !protectedCase(raw, x.caseId),
  },
  participant_voice_notes: {
    read: voiceNoteRead,
    // Bara granskning (status) av den som arbetar i ärendet. Nya röstmeddelanden sparas av systemet efter tokenkontrollen.
    write: (x, a, raw) => {
      const cur = raw.get("participant_voice_notes", x.id);
      return !!cur && workOn(x.caseId, a, raw) && !protectedCase(raw, x.caseId) && reviewOnly(cur, x, a);
    },
  },
  audio_uploads: {
    // Den som spelade in (inte deltagarens gemensamma id) och den som arbetar i ärendet – kommunens "Tala in" bara den själv.
    read: (x, a, raw) => (a.role !== "deltagare" && self(a, x.ownerId)) || (!!x.caseId && x.purpose !== "dictation" && notesRead(x.caseId, a, raw)),
    write: never, // bara ctx.audio (systemsteg): läget (uppladdad, transkriberad, raderad) sätts aldrig av användaren
  },

  // ---- Synpunkter i testmiljön (0017): testarna läser alla synpunkter; nya bara i eget namn, ändringar bara av status.
  feedback: {
    read: (_x, a) => stagingTester(a),
    write: (x, a, raw) => {
      if (!stagingTester(a)) return false;
      const cur = raw.get("feedback", x.id);
      return cur ? feedbackStatusOnly(cur, x, a) : x.authorId === a.testerId;
    },
  },
  feedback_replies: {
    read: (_x, a) => stagingTester(a),
    // Svar ändras aldrig. Nytt svar i eget namn på en synpunkt som finns (främmande nyckel i databasen).
    write: (x, a, raw) => stagingTester(a) && !exists(raw, "feedback_replies", x.id) && x.authorId === a.testerId && exists(raw, "feedback", x.feedbackId),
  },

  // ---- Fria anteckningar i deltagarkortet (0019). Kommunen läser dem aldrig – inte heller när avtalet har seesCoachNotes.
  case_notes: { read: (x, a, raw) => notesRead(x.caseId, a, raw) && noteAudienceOk(x, a, raw), write: caseNoteWrite },

  // ---- Rapportbyggarens sparade rapporter (0021). Ingen raderar – de arkiveras.
  saved_reports: { read: savedReportRead, write: savedReportWrite },

  // ---- Bilagor till beställningen (0024) och filer på deltagarkortet (0037). Raderna skrivs bara av systemet (ctx.attachments)
  // efter hanterarens kontroll.
  case_attachments: {
    read: (x, a, raw) => {
      if (x.deletedAt != null) return false;
      // Den egna uppladdningen innan beställningen skickats (bara beställningens bilagor – en deltagarfil har alltid ett ärende).
      if (!x.caseId) return x.kind === "order" && a.role !== "deltagare" && self(a, x.uploadedBy);
      const acc = accessTo(raw, a, x.caseId);
      // Samordnare, avtalsansvarig och coach med full åtkomst: båda slagen – aldrig handledare, ekonom, chef eller admin.
      if (has(PARTICIPANT_FILE_ROLES, a)) return acc === "full";
      // Kommunens handläggare som beställde: bara beställningens bilagor, aldrig deltagarfilerna (Karims beslut 2026-10-29).
      if (a.role === "kommun_handlaggare") return x.kind === "order" && acc === "customer" && self(a, raw.get("cases", x.caseId)?.referrerId);
      return false;
    },
    write: never,
  },

  // ---- Grupper, nivåer och taggar (0031). Internt: aldrig kommunen eller ekonomen. Inget raderas.
  groupings: { read: (x, a) => has(GROUPING_READERS, a) && member(a, x.contractId), write: groupingWrite },
  grouping_members: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: groupingMemberWrite },

  // ---- Byt yrkesområde (0036). Bara koder och id:n – ekonomen läser för faktureringen, kommunen aldrig. Ändras aldrig.
  case_area_changes: { read: (x, a) => has(AREA_CHANGE_READERS, a) && member(a, x.contractId), write: caseAreaChangeWrite, afterInsert: caseAreaChangeApply },

  // ---- Ändra startdatum (0038). Bara datum och id:n – Miljonbemanning utom ekonomen, aldrig kommunen. Ändras aldrig.
  case_start_changes: { read: (x, a) => has(START_CHANGE_READERS, a) && member(a, x.contractId), write: caseStartChangeWrite, afterInsert: caseStartChangeApply },

  // ---- Deltagaren kom inte till första mötet (0040). Internt: Miljonbemanning med full- eller teamåtkomst (mm.case_ids('{full,team}'))
  //      – aldrig kommunen (customer) eller ekonomen (billing). Skapas av den som arbetar i ärendet; ändras aldrig och tas bara bort
  //      av systemet (gallring).
  first_meeting_no_shows: {
    read: (x, a, raw) => {
      const acc = accessTo(raw, a, x.caseId);
      return acc === "full" || acc === "team";
    },
    write: noShowWrite,
    guard: noShowGuard,
  },
};

export const POLICIES: Policies<Tables> = RULES;

/** För tester och hanterare som vill fråga utan att läsa: får aktören läsa raden? */
export const canReadRow = <N extends TableName>(name: N, row: Tables[N], actor: Actor, raw: Raw): boolean => RULES[name].read(row, actor, raw);
export const canWriteRow = <N extends TableName>(name: N, row: Tables[N], actor: Actor, raw: Raw): boolean => (RULES[name].write ?? never)(row, actor, raw);
