// Kontrakt för området admin (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
// Skärmar (prototyp/src/views/admin.js): /admin/avtal (?avtal=&flik=), /admin/anvandare, /admin/integrationer,
// /admin/mallar (?flik=logg) och /admin/logg.
//
// Frågor:
//   admin.contract       -> ContractView     avtalsväljaren, avtalsfakta, konfigurationen och prislistan för ett avtal (admin)
//   admin.compare        -> CompareView      Botkyrka och Kammarkollegiet sida vid sida (admin)
//   admin.orgRules       -> OrgRulesView     interna regler för påminnelser och eskalering, hur de slår igenom och historiken (admin)
//   admin.users          -> UsersView        personal (bara admin), kommunanvändare, behörighetsmatrisens notisrader (admin, avtalsansvarig)
//   admin.integrations   -> IntegrationsView underbiträden, integrationer och bakgrundsjobb (admin)
//   admin.templates      -> TemplatesView    mallar med versioner och utskicksloggen (admin, samordnare)
//   admin.auditLog       -> AuditLogView     revisionsloggen i klarspråk och månadens loggkontroll (admin, chef)
// Kommandon (prototypens admin.setOrgRule, admin.inviteCustomer, admin.setCustomerActive, admin.saveTemplate, admin.runJob, admin.logCheck):
//   admin.setOrgRule, admin.inviteCustomer, admin.setCustomerActive, admin.saveTemplate, admin.runJob, admin.logCheck
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { ContractConfig, EscalationRole, OrgSettings, PriceUnit } from "@/core/config";
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
  dataRole: "processor" | "controller";
  casePrefix: string;
  emailDomains: string[];
  managerName: string;
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
  contracts: ContractSummary[];
  contract: ContractFacts;
  /** contracts.config (validerad med zod) – visas i korten och som JSON. */
  config: ContractConfig;
  /** Årtalet i exemplet på ärendenummer ("27" i BOT-27-0001). */
  yearShort: string;
  /** Pågående ärenden som flaggas som fastnat i en fas just nu (bara avtal där ärenden hanteras). */
  stuckCount: number | null;
  /** Händelser markerade som möjligt bonusunderlag. */
  bonusCandidates: number;
  /** Prislistan per avtalsområde (price_items). KK-skissen har priserna i konfigurationen i stället. */
  priceItems: PriceRow[];
};
export const adminContract = query("admin.contract", z.object({ contractId: IdSchema.optional() })).returns<ContractView>();

export type CompareContract = { facts: ContractFacts; config: ContractConfig; priceOres: number[]; priceUnits: PriceUnit[] };
export type CompareView = { yearShort: string; contracts: CompareContract[] };
export const adminCompare = query("admin.compare", z.object({})).returns<CompareView>();

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
export const adminSetOrgRule = command("admin.setOrgRule", z.object({
  remindCoachAfterWeeks: z.number().int().min(0).max(52),
  escalateAfterConsecutiveWeeks: z.number().int().min(0).max(52),
  escalateTo: z.array(EscRoleSchema).max(3),
  channels: z.array(ChannelSchema).max(2),
  assignmentChannels: z.array(ChannelSchema).max(2),
})).returns<Result<object, "weeks" | "recipients" | "channels">>();

// ================================================================ Användare och roller (/admin/anvandare)
export type MbUserRow = {
  id: string;
  name: string;
  email: string;
  title: string;
  roleLabel: string;
  isAdmin: boolean;
  teamRoleLabel: string | null;
  /** Rollen i Kammarkollegiets avtal, null = tilldelas före start. */
  kkRoleLabel: string | null;
  active: boolean;
};
export type CustomerUserRow = {
  id: string;
  name: string;
  email: string;
  role: "handlaggare" | "chef";
  unit: string;
  buyerReference: string | null;
  lastLoginAt: string | null;
  invitedAt: string | null;
  active: boolean;
};
export type UnitOption = { unit: string; buyerReference: string | null };
export type UsersView = {
  isAdmin: boolean;
  contractId: string;
  customerName: string;
  /** Tillåtna e-postdomäner för inbjudan. */
  domains: string[];
  /** Personalen – bara för systemadmin. */
  mb: MbUserRow[] | null;
  customers: CustomerUserRow[];
  units: UnitOption[];
  kpis: { mbActive: number; customerActive: number; unitCount: number; loggedIn30: number; invited: number };
  /** Mottagare av eskaleringar enligt de interna reglerna (behörighetsmatrisens notisrader). */
  escalateTo: EscalationRole[];
};
export const adminUsers = query("admin.users", z.object({})).returns<UsersView>();

export const adminInviteCustomer = command("admin.inviteCustomer", z.object({
  contractId: IdSchema.optional(),
  name: ShortText,
  email: ShortText,
  role: z.string().max(20),
  unit: ShortText,
})).returns<Result<{ userId: string }, "name" | "email" | "domain" | "exists" | "role" | "unit">>();

export const adminSetCustomerActive = command("admin.setCustomerActive", z.object({ userId: IdSchema, active: z.boolean() })).returns<Result<object, "not_found">>();

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
export type IntegrationsView = {
  /** Botkyrkas besked om underbiträden (SPEC §3.1). */
  approvedOn: string;
  latestMail: string | null;
  /** "I dag kl. 09.10" – simulerad läsning av avrop@. */
  inboxReadAt: string;
  aiRunCount: number;
  thirdCountryForbidden: boolean;
  returnDataWithinDays: number | null;
  jobs: JobRow[];
};
export const adminIntegrations = query("admin.integrations", z.object({})).returns<IntegrationsView>();
export const adminRunJob = command("admin.runJob", z.object({ key: z.enum(["inbox", "weekly", "att_remind", "progress", "audio", "transcripts", "kpi", "retention"]) })).returns<Result<object, "disabled">>();

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
})).returns<Result<{ version: number }, "not_found" | "empty" | "personal_data">>();

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
export const adminLogCheck = command("admin.logCheck", z.object({
  month: MonthKeySchema,
  items: z.array(z.object({ logId: IdSchema, verdict: z.string().max(20) })).max(50),
  note: LongText,
})).returns<Result<{ id: string }, "empty" | "note">>();
