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
//   Bilagor       bilagor till beställningen (case_attachments, 0024): den som laddade upp innan beställningen skickats · i
//                 ärendet samordnare, avtalsansvarig och namngiven huvudcoach (full åtkomst) och beställande handläggare ·
//                 aldrig handledare, ekonom, chef, admin eller deltagare · skrivs bara av systemet (ctx.attachments)
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
//                 inloggade dessutom i kedjan: utgår från ärendets nuvarande yrkesområde och det förra bytets nya, inte äldre än
//                 det förra, registrerat med aktuell tid · ändras och raderas aldrig · aldrig kommunen
//   Handledare    Rollen handledare – borttagen ur appen, Karims beslut 2026-10-09; vilande så att den kan slås på igen utan
//                 migration. Ingen kan få rollen (src/api/roles.ts, DORMANT_ROLES), men reglerna nedan som nämner den ligger kvar
//                 som spegel av RLS (CASE_WORKERS, rapporterna, bilagorna)
//
// Skrivregeln får den nya raden (insert/update) eller den befintliga (remove). Finns raden redan är det en ändring.
// Systemsteg (löpnummer, revisionslogg, utskick, notiser till andra, publicering, pulslänkens token, röstlänkens token,
// ljudfilernas rader via ctx.audio, bilagornas rader via ctx.attachments, självregistreringens profil och medlemskap) körs via
// ctx.system (service role) och passerar inte policyn.
import { isCustomerRole, isSupplierRole, type Actor, type Role } from "@/api/roles";
import { canSeeNotes, canSeePerson, caseAccess, lookupsFor, type AccessSource, type CaseAccess } from "@/core/access";
import type { Policies, RawAccess, RowPolicy } from "./memory";
import { GROUPING_MEMBER_WRITERS, GROUPING_READERS, GROUPING_WRITERS, slotOf } from "@/core/groupings";
import { AREA_CHANGE_READERS, AREA_CHANGERS, effectiveMonthOf } from "@/core/area-changes";
import type { Case, Report, TableName, Tables } from "./schema";
import { diffMinutes } from "@/core/time";

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
  // case_notes_area_change_lock, 0036). Systemsteget som tar bort ett halvt byte döljer anteckningen först när bytet är borta.
  if (raw.all("case_area_changes").some((c) => c.noteId === cur.id)) return false;
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
 * Raden stämmer med ärendet (triggern case_area_changes_check och de främmande nycklarna, 0036 – gäller också systemet där):
 * ärendets avtal, båda yrkesområdena finns i avtalet, det nya är aktivt och skiljer sig från det gamla, anteckningen hör till
 * ärendet och effectiveMonth är månaden efter changedAt.
 */
function caseAreaChangeConsistent(x: CaseAreaChangeRow, raw: Raw): boolean {
  if (raw.get("cases", x.caseId)?.contractId !== x.contractId || x.fromArea === x.toArea) return false;
  const areas = raw.all("contract_areas").filter((a) => a.contractId === x.contractId);
  if (!areas.some((a) => a.code === x.fromArea) || !areas.some((a) => a.code === x.toArea && a.active)) return false;
  if (!(raw.get("case_notes", x.noteId)?.caseId === x.caseId && /^\d{4}-(0[1-9]|1[0-2])$/.test(x.effectiveMonth) && x.effectiveMonth === effectiveMonthOf(x.changedAt))) return false;
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
/**
 * Kedjan och tiden för inloggade (triggern case_area_changes_check, 0036 – inte service role): bytet utgår från ärendets
 * nuvarande yrkesområde och från det förra bytets nya, är inte äldre än det förra bytet och registreras med aktuell tid (högst
 * 10 minuter från klockan – minnets klocka, RawAccess.now; ett minne utan klocka prövar inte tiden).
 */
function caseAreaChangeChained(x: CaseAreaChangeRow, raw: Raw): boolean {
  if (raw.get("cases", x.caseId)?.primaryAreaCode !== x.fromArea) return false;
  const prior = priorAreaChange(x, raw);
  if (prior.toArea != null && prior.toArea !== x.fromArea) return false;
  if (prior.changedAt != null && x.changedAt < prior.changedAt) return false;
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

// ---------------------------------------------------------------- Tabellerna
const RULES: { [N in TableName]: RowPolicy<Tables, Tables[N]> } = {
  // ---- Avtal, organisationer, användare
  holidays: { read: () => true, write: (_r, a) => a.role === "admin" },
  organizations: {
    read: (o, a, raw) => a.role === "admin" || ((isMB(a) || isKom(a)) && orgsOf(a, raw).has(o.id)),
    write: (_o, a) => a.role === "admin",
  },
  contracts: { read: (c, a) => (isMB(a) || isKom(a)) && member(a, c.id), write: (_c, a) => a.role === "admin" },
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
  cases: { read: (c, a, raw) => accessOfCase(raw, a, c) !== "none", write: caseWrite },
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
  // Bonusanspråk (fas 3, avstängt): raden har beloppet (amountOre) – kommunen läser och ändrar den inte (beslut 5 2026-10-07:
  // inga belopp för kommunen, 0026). Kommunens beslut om ett anspråk byggs i fas 3 med en vy utan belopp.
  bonus_claims: {
    read: (x, a, raw) => ["full", "team", "billing"].includes(accessTo(raw, a, x.caseId)),
    write: (x, a, raw) => {
      if (workOn(x.caseId, a, raw)) return true;
      if (!exists(raw, "bonus_claims", x.id)) return false;
      return a.role === "ekonom" && accessTo(raw, a, x.caseId) === "billing";
    },
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
      return a.role === "ekonom" && member(a, d?.contractId) && editable(x.invoiceDraftId) && (!before || editable(before.invoiceDraftId));
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

  // ---- Bilagor till beställningen (0024). Raderna skrivs bara av systemet (ctx.attachments) efter hanterarens kontroll.
  case_attachments: {
    read: (x, a, raw) => {
      if (x.deletedAt != null) return false;
      // Den egna uppladdningen innan beställningen skickats.
      if (!x.caseId) return a.role !== "deltagare" && self(a, x.uploadedBy);
      const acc = accessTo(raw, a, x.caseId);
      // Samordnare, avtalsansvarig och namngiven huvudcoach (full åtkomst) – aldrig handledare, ekonom, chef eller admin.
      if (a.role === "samordnare" || a.role === "avtalsansvarig" || a.role === "coach") return acc === "full";
      // Kommunens handläggare som beställde.
      if (a.role === "kommun_handlaggare") return acc === "customer" && self(a, raw.get("cases", x.caseId)?.referrerId);
      return false;
    },
    write: never,
  },

  // ---- Grupper, nivåer och taggar (0031). Internt: aldrig kommunen eller ekonomen. Inget raderas.
  groupings: { read: (x, a) => has(GROUPING_READERS, a) && member(a, x.contractId), write: groupingWrite },
  grouping_members: { read: (x, a, raw) => notesRead(x.caseId, a, raw), write: groupingMemberWrite },

  // ---- Byt yrkesområde (0036). Bara koder och id:n – ekonomen läser för faktureringen, kommunen aldrig. Ändras aldrig.
  case_area_changes: { read: (x, a) => has(AREA_CHANGE_READERS, a) && member(a, x.contractId), write: caseAreaChangeWrite },
};

export const POLICIES: Policies<Tables> = RULES;

/** För tester och hanterare som vill fråga utan att läsa: får aktören läsa raden? */
export const canReadRow = <N extends TableName>(name: N, row: Tables[N], actor: Actor, raw: Raw): boolean => RULES[name].read(row, actor, raw);
export const canWriteRow = <N extends TableName>(name: N, row: Tables[N], actor: Actor, raw: Raw): boolean => (RULES[name].write ?? never)(row, actor, raw);
