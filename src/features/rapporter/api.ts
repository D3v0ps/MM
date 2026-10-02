// Kontrakt för området rapporter (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { ReportKind, ReportStatus, SavedReportVisibility } from "@/data/schema";
import type { ProgressionRuleText } from "@/core/config";
import type { SlaView } from "@/ui/badge";
import { IdSchema, MonthKeySchema } from "../_shared/schemas";
import type { Dataset, Dimension, MeasureKey } from "./builder/definition";
import type { BuilderAudience, BuilderView } from "./builder/run";
import { TEMPLATE_KEYS } from "./builder/templates";
import type { FinalModel, MonthlyModel, OrderModel, SummaryModel, WeeklyModel, WeeklySection } from "./model";
import type { DeniedReason } from "./report-helpers";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende och felkoder som prototypens MM.defineAction. Nyckeln är "rapporter.<prototypens namn>".
// Rollregler som i prototypens statuskort (rapporter.js, StatusCard): månads- och slutrapport godkänns av huvudcoachen,
// orderbekräftelse och veckorapport av samordnare/avtalsansvarig, beställarrapporten av avtalsansvarig.
// Leverans och rättelse: huvudcoachen (egna ärenden), samordnare och avtalsansvarig; beställarrapporten bara de två senare.

/** Godkänn en rapport (prototypens report.approve). Bara utkast eller granskad rapport som inte är ersatt. */
export const reportApprove = command("rapporter.reportApprove", z.object({
  reportId: IdSchema,
})).returns<Result<object, "not_found" | "forbidden" | "wrong_status">>();

/**
 * Leverera i portalen (prototypens report.deliver): mottagaren får ett mejl utan personuppgifter ("… finns i portalen –
 * logga in för att läsa"). Föregående version markeras som ersatt. Veckorapporten kan levereras när all närvaro är
 * registrerad (incomplete annars), slutrapporten när coachen skrivit rekommenderad fortsättning (final_text).
 */
export const reportDeliver = command("rapporter.reportDeliver", z.object({
  reportId: IdSchema,
})).returns<Result<object, "not_found" | "forbidden" | "not_approved" | "incomplete" | "final_text" | "wrong_status">>();

/** Rätta en rapport (prototypens report.correct): ny version som utkast. Den gamla sparas och syns tills rättelsen levererats. */
export const reportCorrect = command("rapporter.reportCorrect", z.object({
  reportId: IdSchema,
})).returns<Result<{ reportId: string; version: number }, "not_found" | "forbidden" | "wrong_status">>();

/**
 * Kvittens när kommunen öppnar en rapport (prototypens report.open, tyst). Bara mottagaren kvitterar – andra
 * kommunanvändare som läser rapporten loggas men kvitterar inte. Visningen loggas alltid.
 */
export const reportOpen = command("rapporter.reportOpen", z.object({
  reportId: IdSchema,
})).returns<Result<{ acknowledged: boolean }, "not_found">>();

// ================================================================ Rapporter: frågor och egna kommandon
// Frågorna returnerar vy-modeller: bara det skärmen visar och rollen får se. Rapportens innehåll (modellen) byggs av
// hanteraren (model.ts) – bara av godkända uppgifter (CLAUDE.md punkt 6). Levererade rapporter visas frysta.
//
// Kommunportalen (området kommun) använder:
//   reportDocument ("rapporter.dokument", briefens rapport.dokument) – rapportdokumentet med behörighetskontroll: kommunen
//     får bara levererade rapporter till sig och bara det frysta innehållet. Ett utkast till rättelse visas som den senast
//     levererade versionen. Frågan loggar inte själv – visningen loggas en gång per sidvisning med reportOpen (kommunen,
//     kvitterar också när mottagaren öppnar) eller session.auditView (MB). PortalReport gör det åt er.
//   ReportDocument ({ doc }) i components/report-document.tsx – "papperet" med MB:s profil.
//   PortalReport ({ reportId, from? }) i components/portal-report.tsx – hela rapportsidan i portalen (prototypens
//     PortalReport): tillbakaknapp, kvittens, rättelse, dokumentet, frågor och perspektivbyte.
//   report-helpers.ts – reportTitle, periodText, statusLabel, effStatus, statusLook, isDelivered, DENIED …
export type { ReportKind, ReportStatus } from "@/data/schema";
export type { AttStats, AttRow, FinalModel, MonthlyModel, OrderModel, SummaryModel, WeeklyModel, WeeklySection, WeeklyRow, ReportModel } from "./model";

// ---------------------------------------------------------------- Rapportlistan
export type ReportListRow = {
  id: string;
  kind: ReportKind;
  title: string;
  /** "BOT-26-0143 · Nadia Warsame", "Till Maria Ekdahl · 25 jan–31 jan" … (namnet enligt behörigheten). */
  sub: string;
  status: ReportStatus;
  /** Status där levererad och öppnad = "opened". */
  eff: ReportStatus;
  statusLabel: string;
  next: { key: string; label: string };
  overdue: boolean;
  /** Förfaller denna vecka. */
  week: boolean;
  delivered: boolean;
  dueAt: string | null;
  deliveredAt: string | null;
  /** SLA-klockan: mot leveransen för levererade, annars mot klockan. */
  sla: SlaView | null;
  /** "Förfaller 5 feb kl. 23.59" / "Levererad 1 feb kl. 09.12" (null när klockan redan säger det). */
  dueText: string | null;
  /** Förklaringen när förfallotiden inte är fastställd (null = fastställd). */
  provisional: string | null;
  version: number;
  periodStart: string | null;
  periodEnd: string | null;
  /** Söktext (rubrik och underrad, gemener). */
  search: string;
};
export type ReportList = {
  rows: ReportListRow[];
  /** Coachens lista ("Dina ärenden"). */
  coach: boolean;
  customerName: string;
  contractNumber: string;
  /** Perioder i filtret: innevarande månad bakåt till avtalets start. */
  months: string[];
  /** Söndag kl. 23.59 denna vecka. */
  weekEnd: string;
  emailAttachmentAllowed: boolean;
};
/** Rapportlistan (prototypens rapporter.lista): alla rapporter till kommunen, coachen bara sina ärenden och veckorapporter där hon har deltagare. */
export const reportList = query("rapporter.lista", z.object({})).returns<ReportList>();

// ---------------------------------------------------------------- Rapportdokumentet
export type DocBase = {
  id: string;
  status: ReportStatus;
  version: number;
  approvedAt: string | null;
  deliveredAt: string | null;
  superseded: boolean;
  contract: { customerName: string; contractNumber: string; dnr: string };
  /** Mottagaren med enhet ("Maria Ekdahl, Arbetsmarknadsenheten Alby"). */
  recipient: string;
};
/** En sektion i veckorapporten som läsaren ser. Skyddade (restricted) har bara ärendenumret. */
export type WeeklyDocSection = (WeeklySection & { restricted: false; name: string }) | { restricted: true; caseId: string; caseNumber: string };
export type ReportDocView =
  | (DocBase & { kind: "monthly"; participant: string; m: MonthlyModel })
  | (DocBase & { kind: "final"; participant: string; m: FinalModel })
  | (DocBase & { kind: "order_confirmation"; participant: string; m: OrderModel })
  | (DocBase & {
      kind: "weekly_attendance";
      m: Omit<WeeklyModel, "sections">;
      sections: WeeklyDocSection[];
      /** Alla deltagare i rapporten (för "Du ser 3 av 12 deltagare"). */
      total: number;
      customer: boolean;
      /** Klockslaget då veckorapporten senast publiceras ("16:00"). */
      pubTime: string;
      /** Veckodagen då veckorapporten senast publiceras, veckan efter ("måndag") – sla[veckorapport_publicering].weekday. */
      pubDay: string;
    })
  | (DocBase & {
      kind: "customer_summary";
      m: SummaryModel;
      approver: string;
      resultNote: string;
      /**
       * Avtalets regler för tydlig och någon progression i klarspråk (progressionRuleText), t.ex. "Minst ett område på nivå 2
       * eller högre", och vilka områden som inte räknas (excluded). Ligger i vy-modellen – inte i SummaryModel – så att den
       * frysta modellen och paritetsfacit inte ändras.
       */
      progressionRule: ProgressionRuleText;
    });

/** Rapportsidan i kommunportalen (prototypens PortalReport). */
export type PortalReportInfo = {
  /** Rapporten som efterfrågades (kan vara ett utkast till rättelse). */
  requestedId: string;
  /** Rubriken för den version som visas ("Månadsrapport januari 2027"). */
  title: string;
  caseId: string | null;
  caseNumber: string | null;
  /** Deltagarens namn, null vid skyddade personuppgifter. */
  participant: string | null;
  /** Levererad: "fredag 8 januari 2027 klockan 14.25". */
  deliveredText: string;
  version: number;
  isRecipient: boolean;
  openedAt: string | null;
  recipientName: string;
  /** Miljonbemanning rättar rapporten (en ny version är ett utkast). */
  correcting: boolean;
  superseded: boolean;
  /** Den rättade versionen om den är levererad. */
  newerId: string | null;
  /** Kan skriva till coachen i ärendet. */
  canMessage: boolean;
  /** Huvudcoachen (bara för prototypens perspektivbyte). */
  leadCoachId: string | null;
};
export type ReportDocResult =
  | { ok: true; doc: ReportDocView; portal: PortalReportInfo | null; needsSnapshot: boolean }
  | { ok: false; reason: DeniedReason; title: string; caseId: string | null; caseNumber: string | null };
/**
 * Rapportdokumentet (prototypens modelFor + ReportDocument) för läsarens roll. Kommunen: bara levererade rapporter till
 * sig, bara det frysta innehållet, portal = uppgifterna till rapportsidan. needsSnapshot = levererad men inte fryst än
 * (skärmen kör snapshot, som prototypen gör efter leveransen).
 */
export const reportDocument = query("rapporter.dokument", z.object({ reportId: IdSchema })).returns<ReportDocResult>();

// ---------------------------------------------------------------- Rapportsidan (Miljonbemanning)
export type ReportVersion = { id: string; version: number; current: boolean; text: string; status: ReportStatus; statusLabel: string; openedAt: string | null };
export type ReportView = {
  ok: true;
  id: string;
  kind: ReportKind;
  title: string;
  eyebrow: string;
  lead: string;
  /** Brödsmulor via listan (listans roller) eller via ärendet. */
  listCrumb: boolean;
  caseId: string | null;
  caseNumber: string | null;
  status: ReportStatus;
  eff: ReportStatus;
  statusLabel: string;
  overdue: boolean;
  version: number;
  delivered: boolean;
  deliveredAt: string | null;
  superseded: boolean;
  lifecycleIndex: number;
  next: { key: string; label: string };
  due: { dueAt: string; sla: SlaView; long: string } | null;
  /** Förklaringen när förfallotiden inte är fastställd. */
  provisional: string | null;
  approved: string | null;
  qualityReviewed: string | null;
  recipient: string;
  recipientId: string | null;
  deliveredText: string;
  openedText: string;
  correction: string | null;
  /** Månadsrapport som väntar på månadsbedömningen. */
  blocked: { monthText: string; missing: boolean; canOpen: boolean; caseId: string; month: string } | null;
  /** Godkänd slutrapport utan rekommenderad fortsättning. */
  missingRecommendation: boolean;
  pendingCorrection: { id: string; version: number } | null;
  actions: { approve: boolean; quality: boolean; deliver: boolean; correct: boolean };
  idleText: string | null;
  /** Underlaget har ändrats efter leveransen. canCorrect = rollen kan rätta. */
  drift: { canCorrect: boolean } | null;
  /** Veckorapport som väntar på närvaroregistrering. */
  /** Veckodagarna (regDay, pubDay: "måndag") och klockslagen kommer från avtalets sla-regler. */
  waiting: { regDay: string; regTime: string; pubDay: string; pubTime: string; byCoach: { coach: string; items: string[] }[]; canRegister: boolean } | null;
  /** Coachens text till slutrapporten. null = visas inte. */
  finalText: { canEdit: boolean; obstacles: string; recommendation: string } | null;
  /** Beställarrapportens sammanfattning. null = visas inte. */
  summary: { suggestion: string; text: string; canApprove: boolean; manager: string } | null;
  /** Kommunen ser inte svarstider (customerVisibility.seesSlaStats). */
  slaHidden: boolean;
  delivery: { channel: string; recipientName: string | null; attachmentAllowed: boolean; notice: string };
  versions: ReportVersion[];
  /** Levererad men inte fryst än – skärmen kör snapshot. */
  needsSnapshot: boolean;
};
export type ReportViewDenied = { ok: false; reason: DeniedReason; title: string; listCrumb: boolean; caseId: string | null; caseNumber: string | null };
/** Rapportsidan för Miljonbemanning (prototypens rapport.visa, MbReport): status och nästa steg, kort och versioner. Dokumentet: reportDocument. */
export const reportView = query("rapporter.visa", z.object({ reportId: IdSchema })).returns<ReportView | ReportViewDenied>();

// ---------------------------------------------------------------- Egna kommandon (prototypens rap.*)
/**
 * Frys en levererad rapports innehåll (prototypens rap.snapshot, tyst). Körs direkt efter leveransen och första gången
 * en levererad rapport utan ögonblicksbild visas. Rapporter som redan är frysta hoppas över.
 */
export const reportSnapshot = command("rapporter.snapshot", z.object({
  reportIds: z.array(IdSchema).min(1).max(50),
})).returns<Result<{ reportIds: string[] }>>();

/**
 * Ladda ner rapporten som PDF (tyst). Servern kontrollerar behörigheten med samma regler som för att visa rapporten
 * (reportAccess och policyn/RLS) och loggar report.downloaded (rapportens id, typ, version och period – inga namn).
 * Svaret är filnamnet (utan personuppgifter). Själva PDF:en byggs sedan i webbläsaren av samma dokument som visas
 * (reportDocument – för levererade rapporter den frysta ögonblicksbilden): components/pdf-button.tsx gör det åt er.
 * reportId = id:t på dokumentet som visas (kommunen ser den senast levererade versionen).
 */
export const reportDownload = command("rapporter.download", z.object({
  reportId: IdSchema,
})).returns<Result<{ filename: string }, DeniedReason>>();

/** Samordnarens valfria kvalitetsgranskning (prototypens rap.qualityReview). */
export const reportQualityReview = command("rapporter.qualityReview", z.object({
  reportId: IdSchema,
})).returns<Result<object, "not_found">>();

/**
 * Slutrapportens kvarstående hinder och rekommenderade fortsättning – huvudcoachens text (prototypens rap.saveFinal).
 * Rapporten blir granskad. En ändrad text i en godkänd rapport måste godkännas igen.
 */
export const reportSaveFinal = command("rapporter.saveFinal", z.object({
  reportId: IdSchema,
  obstacles: z.string().max(400),
  recommendation: z.string().max(600),
})).returns<Result<object, "not_found" | "forbidden" | "delivered" | "recommendation">>();

/**
 * Beställarrapportens sammanfattning – avtalsansvarigs text (prototypens rap.saveSummary). aiUsed = förslaget användes.
 * Texten får aldrig nämna Miljonbemannings interna mål (internal_target). Innehållet loggas inte – bara att det sparats.
 */
export const reportSaveSummary = command("rapporter.saveSummary", z.object({
  reportId: IdSchema,
  summary: z.string().max(900),
  aiUsed: z.boolean(),
})).returns<Result<object, "not_found" | "delivered" | "summary" | "internal_target">>();

/** Orsak till rättelsen på den nya versionen (prototypens rap.correctionNote). Nollställer kvalitetsgranskningen. */
export const reportCorrectionNote = command("rapporter.correctionNote", z.object({
  reportId: IdSchema,
  reason: z.string().max(300),
})).returns<Result<object, "not_found" | "reason">>();

// ================================================================ Rapportbyggaren (rapporter steg 4, SPEC §7.11 k)
// Miljonbemanning (samordnare, avtalsansvarig och chef) bygger rapporter av de levererade rapporternas frysta fakta – samma
// urval och register som kommunens resultatfil (steg 3). Skyddade ärenden kommer aldrig med (inte heller för avtalsansvarig).
// En sparad rapport kan delas inom Miljonbemanning eller med kommunens chef (bara avtalsansvarig). Listor med en rad per
// deltagare visar bara antal och kolumnnamn – raderna finns bara i filen. Varje fil och varje visning av en sparad rapport
// loggas på servern (bara id:n – aldrig namn, ärendenummer, titlar eller urvalets värden).
export type { BuilderAudience, BuilderChart, BuilderColumn, BuilderRow, BuilderView } from "./builder/run";
export {
  canonicalJson, charCount, DATASET_HELP, DATASET_LABEL, DATASETS, datasetDimensions, definitionError, definitionIssue, DIMENSION_LABEL, firstChars, MAX_COLUMNS, MAX_MEASURES, MEASURE_LABEL, MEASURES_BY_DATASET,
  MULTI_COLUMN_MEASURES, OUTPUT_LABEL, periodDefText, SPLIT_LABEL, SPLITS, TITLE_HELP, titleError,
  type Dataset, type DefinitionStep, type Dimension, type Filters, type MeasureKey, type Output, type PeriodDef, type ReportDefinition, type Split,
} from "./builder/definition";
export { STANDARD_COLUMNS, TEMPLATE_KEYS, TEMPLATES, type Template, type TemplateKey } from "./builder/templates";

/** Delningen i klarspråk (listorna, sidan och delningsdialogen). */
export const VISIBILITY_LABEL: Record<SavedReportVisibility, string> = { private: "Bara jag", mb: "Alla på Miljonbemanning i avtalet", customer: "Delad med kommunens chef" };

export type BuilderCatalog = {
  /** Avtalen att välja (bara de i drift). Valet visas bara när det finns fler än ett. */
  contracts: { id: string; label: string }[];
  contractId: string | null;
  templates: { key: string; name: string; sentence: string; definition: Record<string, unknown> }[];
  datasets: {
    key: Dataset;
    label: string;
    help: string;
    dimensions: { key: Dimension; label: string; joined: boolean; choices: { value: string; label: string }[] | null }[];
    measures: { key: MeasureKey; label: string; help: string; columns: { key: string; label: string; unit: "antal" | "andel" }[]; chartable: boolean }[];
    /** Kolumnerna i datamängdens egen tabell (bara listor): "resultat.namn", beskrivning ur registret, avsnitt och klass. */
    columns: { qualified: string; key: string; description: string; section: string; cls: string }[];
  }[];
  /** Månaderna som kan väljas (från avtalets start till innevarande månad), senaste först. */
  months: { value: string; label: string }[];
  maxMonths: number;
  /** "färre än N" i kommunens läge (cfg.pulse.minNForAggregate). */
  minN: number;
  /** Avtalsansvarig och avtalet har seesIndividualReports. */
  canShareWithCustomer: boolean;
  /** Avtalet låter kommunens chef se individrapporter (växeln "Visa som kommunens chef ser den" och delningen). */
  customerSharingAllowed: boolean;
  role: string;
};
export const builderCatalog = query("rapporter.byggKatalog", z.object({ contractId: IdSchema.optional() })).returns<BuilderCatalog>();

const DefinitionInput = z.record(z.string(), z.unknown());
const exactlyOne = (p: { savedReportId?: string; definition?: unknown; contractId?: string }) => (p.savedReportId ? !p.definition : !!p.definition && !!p.contractId);

export type BuilderError = "not_found" | "definition" | "period" | "empty" | "column_missing" | "too_many_groups";
/**
 * Förhandsvisningen – ett tyst kommando (inte en fråga): den kan behöva frysa rapporter som saknar fakta, och den körs bara när
 * användaren klickar "Visa förhandsvisning" (och en gång när en sparad rapport öppnas). Med savedReportId loggas
 * saved_report.viewed; ett osparat utkast loggas inte. audience "kommun" = "Visa som kommunens chef ser den".
 */
export const builderPreview = command("rapporter.byggForhandsvisning", z.object({
  contractId: IdSchema.optional(),
  savedReportId: IdSchema.optional(),
  definition: DefinitionInput.optional(),
  templateKey: z.enum(TEMPLATE_KEYS).optional(),
  audience: z.enum(["mb", "kommun"]),
}).refine(exactlyOne)).returns<Result<BuilderView, BuilderError>>();

export type BuilderFileResult =
  | { filename: string; mime: string; encoding: "text" | "base64"; content: string; rows: number; cases: number | null }
  | { filename: string; pdf: BuilderView & { title: string; contractNumber: string; customerName: string; fetchedAt: string } };
/** Hämta filen (Excel, CSV eller PDF – PDF bara för sammanställningar). Loggas export.saved_report innan svaret. */
export const builderExport = command("rapporter.byggExport", z.object({
  contractId: IdSchema.optional(),
  savedReportId: IdSchema.optional(),
  definition: DefinitionInput.optional(),
  templateKey: z.enum(TEMPLATE_KEYS).optional(),
  format: z.enum(["xlsx", "csv", "pdf"]),
}).refine(exactlyOne)).returns<Result<BuilderFileResult, "forbidden" | BuilderError | "too_large">>();

export type SavedReportRow = {
  id: string;
  title: string;
  outputLabel: string;
  datasetLabel: string;
  periodText: string;
  visibility: SavedReportVisibility;
  /** "Skapad av {namn}" – null för mina egna. */
  createdBy: string | null;
  /** "Ändrad 3 februari 2027" eller "Delad 25 januari 2027" (eller "Skapad …"). */
  dateText: string;
};
export type SavedReportLists = { contractId: string | null; mine: SavedReportRow[]; sharedMb: SavedReportRow[]; sharedCustomer: SavedReportRow[] };
export const savedReportList = query("rapporter.sparadeLista", z.object({ contractId: IdSchema.optional() })).returns<SavedReportLists>();

export type SavedReportDetail =
  | { found: false }
  | {
      found: true;
      id: string;
      contractId: string;
      title: string;
      templateKey: string | null;
      templateName: string | null;
      /** Den sparade definitionen (kan vara ogiltig – se definitionError). */
      definition: Record<string, unknown>;
      definitionError: string | null;
      datasetLabel: string;
      outputLabel: string;
      periodText: string;
      visibility: SavedReportVisibility;
      createdBy: string;
      createdAt: string;
      updatedAt: string | null;
      sharedAt: string | null;
      archived: boolean;
      isOwner: boolean;
      /** Delad med kommunen, men avtalet tillåter det inte längre: bara "Sluta dela med kommunen" går (sedan ändra och arkivera). */
      sharingEnded: boolean;
      /** Ändra titel och definition (bara ägaren – och en rapport delad med kommunen bara när ägaren är avtalsansvarig). */
      canEdit: boolean;
      /** Ägarens dialog "Ändra delning". */
      canChangeSharing: boolean;
      /** Avtalsansvarig: "Dela med kommunen" (när avtalet tillåter det) / "Sluta dela med kommunen" (alltid). */
      canShareCustomer: boolean;
      canArchive: boolean;
      /** Avtalsansvarig och avtalet tillåter delning med kommunen. */
      canChooseCustomer: boolean;
      customerSharingAllowed: boolean;
      /** "färre än N" i kommunens läge (avtalets cfg.pulse.minNForAggregate). */
      minN: number;
      /** Varför stegen är låsta, eller null. */
      lockedText: string | null;
    };
export const savedReport = query("rapporter.sparad", z.object({ savedReportId: IdSchema })).returns<SavedReportDetail>();

/** Spara en ny rapport eller ändra titel och definition (bara ägaren). Oförändrat = ok utan skrivning och utan loggrad. */
export const savedReportSave = command("rapporter.sparadSpara", z.object({
  contractId: IdSchema,
  savedReportId: IdSchema.optional(),
  title: z.string().max(200),
  definition: DefinitionInput,
  visibility: z.enum(["private", "mb", "customer"]).optional(),
  templateKey: z.enum(TEMPLATE_KEYS).optional(),
})).returns<Result<{ savedReportId: string }, "forbidden" | "title" | "definition" | "customer_shared">>();

/** Ändra delningen. Samma delning som förut = ok utan skrivning och utan loggrad. */
export const savedReportShare = command("rapporter.sparadDela", z.object({
  savedReportId: IdSchema,
  visibility: z.enum(["private", "mb", "customer"]),
})).returns<Result<object, "forbidden" | "not_allowed">>();

/** Arkivera rapporten – den visas inte längre i listorna (och inte för kommunens chef). */
export const savedReportArchive = command("rapporter.sparadArkivera", z.object({ savedReportId: IdSchema })).returns<Result<object, "forbidden">>();

// ---------------------------------------------------------------- Resultatfil för hela avtalet (färdigrapporten)
/** Som kommunens förhandsvisning (kommun.resultatForhandsvisning) men för alla ärenden i avtalet utom skyddade. */
export type ContractResultPreview = {
  allowed: boolean;
  contractId: string | null;
  contracts: { id: string; label: string }[];
  months: { value: string; label: string }[];
  from: string;
  to: string;
  periodLabel: string;
  periodError: string | null;
  maxMonths: number;
  participants: number;
  reports: number;
};
export const contractResultPreview = query("rapporter.resultatfilForhandsvisning", z.object({
  contractId: IdSchema.optional(),
  from: MonthKeySchema.optional(),
  to: MonthKeySchema.optional(),
})).returns<ContractResultPreview>();

/** Resultatfilen för hela avtalet (samma kolumner och filer som kommunens). Loggas export.results_mb – ingen kolumnspärr. */
export const contractResultExport = command("rapporter.resultatfilExport", z.object({
  contractId: IdSchema,
  from: MonthKeySchema,
  to: MonthKeySchema,
  format: z.enum(["xlsx", "csv"]),
  table: z.enum(["resultat", "progression", "handelser", "avslut", "faltbeskrivning"]).optional(),
})).returns<Result<{ filename: string; mime: string; encoding: "text" | "base64"; content: string; rows: number; cases: number }, "forbidden" | "period" | "empty">>();

/** Läget för förhandsvisningen (skärmens växel). */
export type { BuilderAudience as PreviewAudience };
