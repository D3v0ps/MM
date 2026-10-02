// Läs- och skrivregler per tabell i minnesläget – spegel av Row Level Security i Postgres (SPEC §4, §7.10, §10,
// CLAUDE.md punkt 1, 2, 8). Neka som standard: varje tabell har en regel, och det som inte uttryckligen tillåts nekas.
// Behörighet = avtal (memberships) + roll + tilldelning, via caseAccess (src/core/access.ts).
//
// Sammanfattning:
//   MB-roller      coach: egna ärenden (huvudcoach) och team · handledare: tilldelade · samordnare, avtalsansvarig, chef:
//                  alla i sina avtal (chef och admin i läsläge – chefen får ändå spara, dela inom Miljonbemanning och
//                  arkivera egna rapporter i rapportbyggaren) · ekonom: det som behövs för fakturering, inga anteckningar,
//                  rapporter eller namn · admin: allt inklusive konfiguration och logg (skyddade personer bara som ärende)
//   Kommunen       handläggaren: sina beställningar (eller enhetens/alla enligt avtalet) · chefen: enhetens ärenden men inte
//                  skyddade personer · bara levererade rapporter till dem · bara meddelanden i sina ärenden · aldrig
//                  coachanteckningar, flaggor eller KPI:er
//   Skyddade       bara namngiven huvudcoach, avtalsansvarig och beställande handläggare ser personen och detaljerna
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
//   rapporter     egna och delade (mb, customer – också arkiverade, hanterarna visar dem inte) · kommunens chef bara delade med
//                 kommunen (customer), inte arkiverade, och bara när avtalet har seesIndividualReports · skrivs i eget namn ·
//                 bara ägaren ändrar titel och definition · avtalsansvarig delar med kommunen, ändrar delningen och arkiverar
//                 andras delade rapporter (aldrig till privat) · en rapport delad med kommunen ändras bara av avtalsansvarig ·
//                 raderas aldrig
//
// Skrivregeln får den nya raden (insert/update) eller den befintliga (remove). Finns raden redan är det en ändring.
// Systemsteg (löpnummer, revisionslogg, utskick, notiser till andra, publicering, pulslänkens token, röstlänkens token,
// ljudfilernas rader via ctx.audio) körs via ctx.system (service role) och passerar inte policyn.
import { isCustomerRole, isSupplierRole, type Actor, type Role } from "@/api/roles";
import { canSeeNotes, canSeePerson, caseAccess, lookupsFor, type AccessSource, type CaseAccess } from "@/core/access";
import type { Policies, RawAccess, RowPolicy } from "./memory";
import type { Case, Report, TableName, Tables } from "./schema";

type Raw = RawAccess<Tables>;

// ---------------------------------------------------------------- Rollgrupper
/** Arbetar i ärendet (registrerar närvaro, avstämningar, händelser …) med full- eller teamåtkomst. Chef och admin är i läsläge. */
const CASE_WORKERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Ändrar ärendet (status, coach, datum) med full åtkomst. */
const CASE_EDITORS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach"];
/** Tar emot beställningar (skapar ärenden och personer). */
const ORDER_CREATORS: readonly Role[] = ["samordnare", "avtalsansvarig", "kommun_handlaggare"];
/** Ser avtalets helhet: beställarrapporter, avropsinkorg, avtalsavvikelser. */
const OVERSIGHT: readonly Role[] = ["samordnare", "avtalsansvarig", "chef", "admin"];
/** Fakturering. */
const BILLING_READERS: readonly Role[] = ["ekonom", "chef", "avtalsansvarig", "admin"];

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
/** Ärendets person har skyddade personuppgifter (uppslag utan filter). Ett ärende eller en person som saknas räknas som skyddat. */
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
    if (a.role === "handledare") return false; // månads- och slutrapporter innehåller coachens bedömningar
    if (!r.caseId) return has(OVERSIGHT, a);
    return canSeeNotes(accessTo(raw, a, r.caseId), a.role);
  }
  if (isKom(a)) {
    if (!r.deliveredAt) return false; // bara levererade rapporter
    const toMe = r.deliveredTo.includes(a.userId) || self(a, r.recipientUserId);
    if (!r.caseId) return toMe;
    if (accessTo(raw, a, r.caseId) !== "customer") return false;
    if (toMe) return true;
    // Kommunens chef ser enhetens individrapporter om avtalet säger det
    return a.role === "kommun_chef" && !!raw.get("contracts", r.contractId)?.config.customerVisibility?.seesIndividualReports;
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
/** Den inloggade är testare i testmiljön (mm.auth_is_tester()). Bara servern sätter testerId – aldrig i produktion eller minnet. */
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
  // Dölja: removedAt och removedBy sätts tillsammans, i eget namn.
  if ((changed.includes("removedAt") || changed.includes("removedBy")) && (x.removedAt == null || !self(a, x.removedBy))) return false;
  if (self(a, cur.authorId)) return workOn(x.caseId, a, raw) && noteAudienceOk(x, a, raw);
  return has(NOTE_REMOVERS, a) && accessTo(raw, a, x.caseId) === "full" && changed.every((k) => k === "removedAt" || k === "removedBy");
}

// ---------------------------------------------------------------- Sparade rapporter i rapportbyggaren (0021)
type SavedReportRow = Tables["saved_reports"];
/** Bygger och sparar rapporter (rapporter steg 4, beslut 10) – inte admin, coach, handledare eller ekonom. */
export const REPORT_BUILDERS: readonly Role[] = ["samordnare", "avtalsansvarig", "chef"];
/** Avtalet låter kommunens chef se enhetens individrapporter (mm.individual_report_contract_ids()). */
const customerReportsAllowed = (raw: Raw, contractId: string) => raw.get("contracts", contractId)?.config.customerVisibility?.seesIndividualReports === true;
/** Fält som aldrig ändras efter att rapporten skapats (triggern saved_reports_protect_columns, 0021). */
const SAVED_FIXED = ["contractId", "ownerId", "createdAt"];
/** Det enda som den som inte är ägaren får ändra (tillägg 2026-10-02): delningen och arkiveringen. */
const SAVED_SHARING = ["visibility", "sharedAt", "sharedBy", "archivedAt", "archivedBy"];
const TEMPLATE_KEY = /^[a-z0-9-]{1,60}$/;

function savedReportRead(x: SavedReportRow, a: Actor, raw: Raw): boolean {
  if (has(REPORT_BUILDERS, a)) return member(a, x.contractId) && (self(a, x.ownerId) || x.visibility !== "private");
  if (a.role === "kommun_chef") return member(a, x.contractId) && customerReportsAllowed(raw, x.contractId) && x.visibility === "customer" && x.archivedAt == null;
  return false;
}
/** Tabellens kontroller (check i 0021): titelns längd, mallnyckeln, definitionen, delningen och paren. */
function savedReportShape(x: SavedReportRow): boolean {
  const pair = (at: unknown, by: unknown) => (at == null) === (by == null);
  const def = x.definition as unknown;
  // Titelns längd som char_length i Postgres (kodpunkter, inte UTF-16-enheter).
  const titleChars = [...x.title].length;
  return titleChars >= 3 && titleChars <= 80 && (x.templateKey == null || TEMPLATE_KEY.test(x.templateKey))
    && !!def && typeof def === "object" && !Array.isArray(def) && String((def as { v?: unknown }).v) === "1"
    && ["private", "mb", "customer"].includes(x.visibility) && (x.visibility === "private" || x.sharedAt != null)
    && pair(x.updatedAt, x.updatedBy) && pair(x.sharedAt, x.sharedBy) && pair(x.archivedAt, x.archivedBy);
}
/**
 * Ny rad: byggroll, medlem, i eget namn; 'customer' bara för avtalsansvarig när avtalet tillåter det; varken ändrad eller
 * arkiverad; privat = inte delad, annars delad i eget namn. Ändring: den befintliga raden är inte arkiverad och ägs av en själv
 * (eller är inte privat och man är avtalsansvarig); en rad delad med kommunen ändras bara av avtalsansvarig; den nya raden
 * ägs av en själv eller är inte privat (avtalsansvarig); något ändras; avtal, ägare och skapad-tid ändras aldrig; ändrad- och
 * arkiveringstid i eget namn; ändras delningen sätts shared_* i eget namn (värdena får vara desamma – minutprecisionen);
 * shared_* ändras bara med delningen; den som inte är ägaren ändrar bara delningen och arkiveringen. Samma regler som
 * policyerna och triggern i 0021. Regeln stoppar också MemoryRepo.remove() (inget ändras – ingen hård radering).
 */
function savedReportWrite(x: SavedReportRow, a: Actor, raw: Raw): boolean {
  if (!has(REPORT_BUILDERS, a) || !member(a, x.contractId) || !savedReportShape(x)) return false;
  const customerOk = x.visibility !== "customer" || (a.role === "avtalsansvarig" && customerReportsAllowed(raw, x.contractId));
  const cur = raw.get("saved_reports", x.id);
  if (!cur) {
    if (!self(a, x.ownerId) || !customerOk) return false;
    if (x.updatedAt != null || x.updatedBy != null || x.archivedAt != null || x.archivedBy != null) return false;
    return x.visibility === "private" ? x.sharedAt == null && x.sharedBy == null : x.sharedAt != null && self(a, x.sharedBy);
  }
  // Den befintliga raden (using).
  if (cur.archivedAt != null || !member(a, cur.contractId)) return false;
  if (!self(a, cur.ownerId) && !(a.role === "avtalsansvarig" && cur.visibility !== "private")) return false;
  if (cur.visibility === "customer" && a.role !== "avtalsansvarig") return false;
  // Den nya raden (with check).
  if (!self(a, x.ownerId) && !(a.role === "avtalsansvarig" && x.visibility !== "private")) return false;
  if (!customerOk) return false;
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
  price_items: { read: (x, a) => (isMB(a) || isKom(a)) && member(a, x.contractId), write: (_x, a) => a.role === "admin" },
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
    write: (x, a, raw) => workOn(x.caseId, a, raw),
  },
  attendance: {
    read: (x, a, raw) => ["full", "team", "billing", "customer"].includes(accessTo(raw, a, x.caseId)),
    write: (x, a, raw) => workOn(x.caseId, a, raw),
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
      if (has(OVERSIGHT, a)) return !d.caseId || accessTo(raw, a, d.caseId) !== "none";
      if (a.role === "kommun_chef") return !d.caseId || accessTo(raw, a, d.caseId) === "customer"; // godkänner åtgärdsplaner
      return false;
    },
    write: (d, a, raw) =>
      (["samordnare", "avtalsansvarig", "chef"].includes(a.role) && member(a, d.contractId))
      || (a.role === "kommun_chef" && member(a, d.contractId) && exists(raw, "contract_deviations", d.id)),
  },
  bonus_claims: {
    read: (x, a, raw) => ["full", "team", "customer", "billing"].includes(accessTo(raw, a, x.caseId)),
    write: (x, a, raw) => {
      if (workOn(x.caseId, a, raw)) return true;
      if (!exists(raw, "bonus_claims", x.id)) return false;
      const acc = accessTo(raw, a, x.caseId);
      return (a.role === "kommun_handlaggare" && acc === "customer" && self(a, raw.get("cases", x.caseId)?.referrerId)) || (a.role === "ekonom" && acc === "billing");
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
  invoice_lines: {
    read: (x, a, raw) => has(BILLING_READERS, a) && member(a, raw.get("invoice_drafts", x.invoiceDraftId)?.contractId),
    write: (x, a, raw) => a.role === "ekonom" && member(a, raw.get("invoice_drafts", x.invoiceDraftId)?.contractId),
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
      // Läskvitto: den som arbetar i ärendet eller beställande handläggare (kommunens chef läser utan kvitto).
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
};

export const POLICIES: Policies<Tables> = RULES;

/** För tester och hanterare som vill fråga utan att läsa: får aktören läsa raden? */
export const canReadRow = <N extends TableName>(name: N, row: Tables[N], actor: Actor, raw: Raw): boolean => RULES[name].read(row, actor, raw);
export const canWriteRow = <N extends TableName>(name: N, row: Tables[N], actor: Actor, raw: Raw): boolean => (RULES[name].write ?? never)(row, actor, raw);
