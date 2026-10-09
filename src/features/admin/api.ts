// Kontrakt för området admin (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
// Skärmar (prototyp/src/views/admin.js): /admin/avtal (?avtal=&flik=), /admin/anvandare, /admin/integrationer,
// /admin/mallar (?flik=logg) och /admin/logg.
//
// Frågor:
//   admin.contract       -> ContractView     avtalsväljaren (fler än ett avtal), avtalsfakta och konfigurationen utan belopp (admin)
//   admin.orgRules       -> OrgRulesView     interna regler för påminnelser och eskalering, hur de slår igenom och historiken (admin)
//   admin.users          -> UsersView        personal (bara admin), kommunanvändare, behörighetsmatrisens notisrader (admin, avtalsansvarig)
//   admin.integrations   -> IntegrationsView underbiträden, integrationer och bakgrundsjobb (admin)
//   admin.templates      -> TemplatesView    mallar med versioner och utskicksloggen (admin, samordnare)
//   admin.auditLog       -> AuditLogView     revisionsloggen i klarspråk och månadens loggkontroll (admin, chef)
//   admin.auditDetail    -> AuditDetail      hela detaljtexten för en loggrad (långa listor), hämtas när den visas
// Kommandon (prototypens admin.setOrgRule, admin.inviteCustomer, admin.setCustomerActive, admin.saveTemplate, admin.runJob, admin.logCheck):
//   admin.setOrgRule, admin.inviteCustomer, admin.setCustomerActive, admin.saveTemplate, admin.runJob, admin.logCheck
//   Beslut 2026-10-08 (skarp drift): admin.inviteStaff (Lägg till kollega), admin.setStaffRoles, admin.setStaffActive,
//   admin.setContractManager (avtalsansvarig väljs på avtalssidan)
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { NAV, LOG, CARD, CASES, PORTAL, MGMT, INBOX } from "@/api/invalidation";
import { SUPPLIER_ROLES, type SupplierRole } from "@/api/roles";
import type { ContractConfig, DataRole, EscalationRole, OrgSettings, PriceUnit } from "@/core/config";
import type { OutboundStatus } from "@/data/schema";
import { IdSchema, LongText, MonthKeySchema, ShortText } from "../_shared/schemas";
import type { RuleSnapshot } from "./audit-text";
import type { TemplateChannel } from "./templates";

export type { RuleSnapshot };

// ================================================================ Avtal och konfiguration (/admin/avtal)
export type ContractSummary = {
  id: string;
  customerName: string;
  name: string;
  contractNumber: string;
  status: "active" | "draft";
  startsOn: string;
  /** Avtalet har alla avsnitt som behövs för att hantera ärenden (Botkyrka). */
  operational: boolean;
};

export type ContractFacts = ContractSummary & {
  customerOrgNr: string;
  supplierName: string;
  supplierOrgNr: string;
  dnr: string | null;
  endsOn: string | null;
  dataRole: DataRole;
  casePrefix: string;
  emailDomains: string[];
  managerName: string;
  /** Avtalsansvarig (profiles.id) – väljs bland kollegorna med rollen avtalsansvarig i avtalet (beslut 2026-10-08). */
  managerId: string | null;
  /** Kollegorna som kan vara avtalsansvariga (aktiva, med rollen avtalsansvarig i avtalet). */
  managerOptions: { id: string; name: string }[];
  /** Uppsägning och omfattning i klarspråk (avtalstext som ännu inte finns i konfigurationen – se handlers). */
  termination: string | null;
  scope: string | null;
};

export type PriceRow = {
  id: string;
  areaName: string;
  fortnoxArticleNo: string | null;
  unit: PriceUnit;
  priceOre: number;
  vatRate: number;
  validFrom: string;
  validTo: string | null;
};

export type ContractView = {
  /** Avtalen att välja mellan. Väljaren visas bara när det finns fler än ett (fler kommunavtal kan läggas till). */
  contracts: ContractSummary[];
  contract: ContractFacts;
  /**
   * contracts.config (validerad med zod) – visas i korten och som JSON. Utan viten (penalties) för alla utom ekonomen
   * (beslut 5, 2026-10-07: belopp syns bara för rollen ekonom).
   */
  config: ContractConfig;
  /** Avtalet har viten, men beloppen lämnas inte ut (alla utom ekonomen). */
  penaltiesHidden: boolean;
  /** Årtalet i exemplet på ärendenummer ("27" i BOT-27-0001). */
  yearShort: string;
  /** Pågående ärenden som flaggas som fastnat i en fas just nu (bara avtal där ärenden hanteras). */
  stuckCount: number | null;
  /** Händelser markerade som möjligt bonusunderlag. */
  bonusCandidates: number;
  /** Prislistan per avtalsområde (price_items). Bara för ekonomen – saknas för alla andra (beslut 5). */
  priceItems?: PriceRow[];
};
export const adminContract = query("admin.contract", z.object({ contractId: IdSchema.optional() })).returns<ContractView>();

// ---- Interna regler (org_settings)
export type RecipientOption = { role: EscalationRole; label: string; names: string };
export type RuleHistoryItem = { id: string; at: string; actorName: string; byTester: boolean; text: string };
export type OrgRulesView = {
  saved: RuleSnapshot;
  reminderSchedule: string;
  recipients: RecipientOption[];
  /** Veckor i rad utan progression per pågående ärende – för att räkna hur ändrade regler slår igenom. Bara antal, inga ärenden. */
  streaks: number[];
  history: RuleHistoryItem[];
  /** org_settings.notifications (visas som JSON). */
  notifications: OrgSettings["notifications"];
};
export const adminOrgRules = query("admin.orgRules", z.object({})).returns<OrgRulesView>();

const EscRoleSchema = z.enum(["chef", "avtalsansvarig", "samordnare"]);
const ChannelSchema = z.enum(["app", "email"]);
/** Välj avtalsansvarig bland kollegorna med rollen avtalsansvarig i avtalet (beslut 2026-10-08, valfritt steg 3). */
export const adminSetContractManager = command("admin.setContractManager", z.object({ contractId: IdSchema, userId: IdSchema }), {
  invalidates: ["admin.contract", "admin.users", INBOX, CASES, ...LOG],
}).returns<Result<object, "not_found" | "not_manager" | "unchanged">>();

export const adminSetOrgRule = command("admin.setOrgRule", z.object({
  remindCoachAfterWeeks: z.number().int().min(0).max(52),
  escalateAfterConsecutiveWeeks: z.number().int().min(0).max(52),
  escalateTo: z.array(EscRoleSchema).max(3),
  channels: z.array(ChannelSchema).max(2),
  assignmentChannels: z.array(ChannelSchema).max(2),
}), { invalidates: ["admin.orgRules", "admin.contract", "notiser.", "coach.minVecka", "inkorg.start", MGMT, NAV, ...LOG] }).returns<Result<object, "weeks" | "recipients" | "channels">>();

// ================================================================ Användare och roller (/admin/anvandare)
export type MbUserRow = {
  id: string;
  name: string;
  email: string;
  title: string;
  /** Rollerna i huvudavtalet (en person kan ha flera, beslut 2026-10-08), i rollernas ordning. */
  roles: SupplierRole[];
  /** Rollerna som text: "Systemadmin, Avtalsansvarig". */
  roleLabel: string;
  isAdmin: boolean;
  teamRoleLabel: string | null;
  active: boolean;
  /** Den inloggade själv – kan inte spärras eller bli av med sin adminroll här. */
  self: boolean;
};
/** Kommunens användare – alla är handläggare (beslut 2026-10-07). Enheten är fritext (tom tills personen fyllt i den). */
export type CustomerUserRow = {
  id: string;
  name: string;
  email: string;
  unit: string;
  lastLoginAt: string | null;
  invitedAt: string | null;
  /** Personen skapade kontot själv (självregistrering med en adress på kommunens domän). */
  selfRegistered: boolean;
  active: boolean;
};
export type UnitOption = { unit: string; buyerReference: string | null };
export type UsersView = {
  isAdmin: boolean;
  contractId: string;
  customerName: string;
  /** Tillåtna e-postdomäner för inbjudan. */
  domains: string[];
  /** Domänerna där man kan skapa ett konto själv (avtalets selfRegistration och beställarens domäner). */
  selfRegistrationDomains: string[];
  /** Personalen – bara för systemadmin. */
  mb: MbUserRow[] | null;
  /** Tillåtna domäner för kollegornas adresser (Lägg till kollega): organisationens egna, annars MM_STAFF_EMAIL_DOMAINS. */
  staffDomains: string[];
  customers: CustomerUserRow[];
  /** Enheter som redan finns (förslag i inbjudan – enheten är fritext). */
  units: UnitOption[];
  kpis: { mbActive: number; customerActive: number; unitCount: number; loggedIn30: number; invited: number };
  /** Mottagare av eskaleringar enligt de interna reglerna (behörighetsmatrisens notisrader). */
  escalateTo: EscalationRole[];
};
export const adminUsers = query("admin.users", z.object({})).returns<UsersView>();

/** Bjud in kommunens handläggare (den enda rollen hos kommunen). Enheten är fritext. */
export const adminInviteCustomer = command("admin.inviteCustomer", z.object({
  contractId: IdSchema.optional(),
  name: ShortText,
  email: ShortText,
  unit: ShortText,
}), { invalidates: ["admin.users", CASES, PORTAL, INBOX, ...LOG] }).returns<Result<{ userId: string }, "name" | "email" | "domain" | "exists" | "unit">>();

export const adminSetCustomerActive = command("admin.setCustomerActive", z.object({ userId: IdSchema, active: z.boolean() }), { invalidates: ["admin.users", CARD, PORTAL, INBOX] }).returns<Result<object, "not_found">>();

// ---- Kollegorna (beslut 2026-10-08, skarp drift): administratören lägger till kollegor, ändrar roller och spärrar i appen.
const StaffRoles = z.array(z.enum(SUPPLIER_ROLES)).min(1).max(SUPPLIER_ROLES.length);
/**
 * Lägg till kollega: namn, e-postadress på personalens domän, en eller flera roller i huvudavtalet, titel valfri. Kollegan
 * får ett mejl utan personuppgifter (bara adressen till appen) och loggar in med e-post och kod.
 */
export const adminInviteStaff = command("admin.inviteStaff", z.object({
  contractId: IdSchema.optional(),
  name: ShortText,
  email: ShortText,
  roles: StaffRoles,
  title: ShortText.optional(),
}), { invalidates: ["admin.users", "admin.orgRules", "admin.contract", CASES, INBOX, MGMT, ...LOG] }).returns<Result<{ userId: string }, "name" | "email" | "domain" | "exists" | "roles">>();

/** Ändra en kollegas roller i huvudavtalet (minst en). Den egna adminrollen kan inte tas bort. */
export const adminSetStaffRoles = command("admin.setStaffRoles", z.object({ userId: IdSchema, roles: StaffRoles }), {
  invalidates: ["admin.users", "admin.orgRules", "admin.contract", CASES, INBOX, MGMT, ...LOG],
}).returns<Result<{ changed: boolean }, "not_found" | "roles" | "self">>();

/** Spärra (kan inte logga in) eller aktivera en kollega. Aldrig sig själv. */
export const adminSetStaffActive = command("admin.setStaffActive", z.object({ userId: IdSchema, active: z.boolean() }), {
  invalidates: ["admin.users", "admin.orgRules", "admin.contract", CASES, INBOX, MGMT, ...LOG],
}).returns<Result<object, "not_found" | "self">>();

// ================================================================ Underbiträden och integrationer (/admin/integrationer)
export type JobStatusView = "ok" | "waiting" | "disabled" | "failed";
export type JobRow = {
  key: string;
  name: string;
  schedule: string;
  last: string | null;
  /** Senaste körningen gjordes manuellt ("Kör nu"). */
  manual: boolean;
  /** Vem som körde jobbet manuellt: "dig" när det var den inloggade, annars namnet. */
  manualBy: string | null;
  status: JobStatusView;
  result: string;
  phase: number | null;
  disabled: boolean;
};
/** approved = godkänd av Botkyrka, approved_test = vald och godkänd men simulerad, chosen = vald och väntar på kommunens godkännande. */
export type SubprocessorStatus = "approved" | "approved_test" | "chosen" | "not_chosen";
export type SubprocessorView = { id: string; name: string; what: string; where: string; status: SubprocessorStatus; us: boolean };
/** Underbiträdena, Botkyrkas besked, regionlåsningen och "Så ser kommunen det" (SPEC §3.1 och §10). */
export type DataProtectionView = {
  /** Botkyrkas besked om underbiträden (SPEC §3.1). */
  approvedOn: string;
  subprocessors: SubprocessorView[];
  /** Regionlåsningens punkter (leverantörer och regioner). */
  regions: string[];
  thirdCountryForbidden: boolean;
  returnDataWithinDays: number | null;
};
/** active = ansluten, test = simulerad, chosen = vald och väntar på kommunens godkännande, off = ej ansluten, notchosen = ej vald. */
export type IntegrationStatus = "active" | "test" | "chosen" | "off" | "notchosen";
export type IntegrationIcon = "inbox" | "key" | "card" | "message" | "mail" | "sparkles" | "phone";
/** Ett kort under "Integrationer": rubrik, ikon, status och rader (etikett, text). */
export type IntegrationView = { id: string; name: string; sub: string; icon: IntegrationIcon; status: IntegrationStatus; phase: number | null; items: [string, string][] };
export type IntegrationsView = {
  /** Saknas för begränsade testare i testmiljön (src/api/tester-access.ts) – korten Underbiträden, Regionlåsning och Så ser kommunen det visas inte. */
  dataProtection?: DataProtectionView;
  /**
   * Integrationerna. Begränsade testare: utan raderna som pekar ut underbiträdena (vald leverantör, region, DNS och
   * godkännande) – de finns i underbiträdeslistan, som de inte ser.
   */
  integrations: IntegrationView[];
  /** Nyckeltalet "Data lagras i". detail (leverantörer och regioner) saknas för begränsade testare. */
  storage: { place: string; detail?: string };
  latestMail: string | null;
  /**
   * När avrop@ senast lästes (jobbet inbox_import, beslut 4c): null = brevlådan är inte kopplad eller har inte lästs ännu.
   * Testdatat: en simulerad tid.
   */
  inboxReadAt: string | null;
  /** Brevlådan avrop@: kopplad via Microsoft Graph, inte kopplad (stegen visas i kortet) eller simulerad i testdatat. */
  inboxState: "connected" | "not_connected" | "simulated";
  aiRunCount: number;
  jobs: JobRow[];
};
export const adminIntegrations = query("admin.integrations", z.object({})).returns<IntegrationsView>();
// invalidates "all" med motivering: ett bakgrundsjobb kan skapa rapporter, notiser, röstresultat eller gallra – följderna är
// inte kända i förväg, så allt räknas om (bara den här knappen på integrationssidan). "inbox" lägger ett riktigt jobb
// (inbox_import) som körs av jobbkörningen i supabase-läget; i minnesläget markeras det klart direkt (simulerat).
export const adminRunJob = command("admin.runJob", z.object({ key: z.enum(["inbox", "weekly", "att_remind", "progress", "audio", "transcripts", "kpi", "retention"]) }), { invalidates: "all" }).returns<Result<object, "disabled">>();

// ================================================================ Mallar och utskick (/admin/mallar)
export type TemplateVersionView = { version: number; savedAt: string; savedByName: string };
export type TemplateView = {
  key: string;
  name: string;
  channel: TemplateChannel;
  alsoVia: TemplateChannel[];
  from: string;
  to: string;
  when: string;
  subject: string;
  body: string;
  version: number;
  updatedAt: string;
  updatedByName: string;
  variantOf: string | null;
  /** Fast text som inte kan ändras här (inloggningskoden – mejlet byggs av servern). */
  fixed: boolean;
  /** Sparade versioner, nyast först. */
  history: TemplateVersionView[];
  baseVersion: number;
  baseUpdatedAt: string;
};
export type SendLogItem = {
  id: string;
  at: string;
  channel: string;
  to: string;
  templateLabel: string;
  caseNumber: string | null;
  body: string;
  /** Gjort i prototypen (demodata känns igen på id:t från ctx.newId). */
  byTester: boolean;
  /** Texten kan innehålla namn på en deltagare eller något som liknar ett personnummer. */
  leak: boolean;
  /**
   * Utskickets läge (outbound_messages.status): queued, sent, failed (gick inte iväg), suppressed eller manual. Ett tekniskt
   * läge – inga personuppgifter. Systemadministratörens Min vecka visar utskick som inte gick iväg (beslut 2026-10-06).
   */
  status: OutboundStatus;
  /**
   * Varför utskicket stoppades eller inte gick iväg, i klarspråk (t.ex. "SMS-leverantör inte vald", "Telefonnumret har fel
   * format"). Null när det skickades som vanligt. Aldrig adresser eller nummer (outbound_messages.statusReason).
   */
  reason: string | null;
};
export type TemplatesView = {
  /** Bara systemadmin sparar nya mallversioner (SPEC §9, policyn för template_versions). */
  canEdit: boolean;
  templates: TemplateView[];
  sendLog: SendLogItem[];
};
export const adminTemplates = query("admin.templates", z.object({})).returns<TemplatesView>();
export const adminSaveTemplate = command("admin.saveTemplate", z.object({
  key: z.string().min(1).max(60),
  subject: ShortText,
  body: LongText,
  note: ShortText.optional(),
}), { invalidates: ["admin.templates", "kommun.kvitto", ...LOG] }).returns<Result<{ version: number }, "not_found" | "fixed" | "empty" | "personal_data">>();

// ================================================================ Revisionslogg (/admin/logg)
export type AuditRow = {
  id: string;
  at: string;
  /** Aktörens id, eller "__null" för deltagaren (engångslänk). */
  actorKey: string;
  actorName: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  /** Ärendet raden gäller (länk) och ärendenumret – aldrig namn. */
  caseId: string | null;
  caseNumber: string;
  entityText: string;
  detailText: string;
  /**
   * Tabellen visar långa listor som antal (t.ex. kolumner och rapporter i en export). Hela texten hämtas med
   * admin.auditDetail när den visas – den skickas inte med i loggen (svaret får inte växa med varje export).
   */
  hasFull: boolean;
  byTester: boolean;
};
export type LogCheckSampleItem = { id: string; actionLabel: string; at: string; actorName: string; entityLabel: string; caseNumber: string };
export type LogCheckView = {
  month: string;
  /** Loggkontrollen görs av chef/controller. */
  canSign: boolean;
  done: { signedByName: string; signedAt: string; items: number; deviations: number; note: string } | null;
  sample: LogCheckSampleItem[];
};
export type AuditLogView = {
  isChef: boolean;
  /** Dagens datum (filnamnet på exporten). */
  today: string;
  contractId: string | null;
  rows: AuditRow[];
  actors: { value: string; label: string }[];
  actions: { value: string; label: string }[];
  views: number;
  exports: number;
  byTester: number;
  logCheck: LogCheckView;
};
export const adminAuditLog = query("admin.auditLog", z.object({})).returns<AuditLogView>();
/** Hela detaljtexten för en loggrad (null = raden finns inte eller har inga långa listor). */
export type AuditDetail = { text: string | null };
export const adminAuditDetail = query("admin.auditDetail", z.object({ id: IdSchema })).returns<AuditDetail>();
export const adminLogCheck = command("admin.logCheck", z.object({
  month: MonthKeySchema,
  items: z.array(z.object({ logId: IdSchema, verdict: z.string().max(20) })).max(50),
  note: LongText,
}), { invalidates: [...LOG] }).returns<Result<{ id: string }, "empty" | "note">>();
