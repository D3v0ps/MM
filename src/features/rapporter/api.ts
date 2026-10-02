// Kontrakt för området rapporter (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { ReportKind, ReportStatus } from "@/data/schema";
import type { SlaView } from "@/ui/badge";
import { IdSchema } from "../_shared/schemas";
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
type DocBase = {
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
  | (DocBase & { kind: "customer_summary"; m: SummaryModel; approver: string; resultNote: string });

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
