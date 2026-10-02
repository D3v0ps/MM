// Frysning av en levererad rapport (prototypens rap.snapshot). Bara för hanterare – importeras aldrig av skärmar.
//
// Rapporten fryses när den levereras (report.deliver, rapporter steg 3) och annars första gången någon öppnar den
// (kommandot rapporter.snapshot) eller när veckorapporten publiceras automatiskt (src/features/_shared/weekly.ts):
//   await freezeReport(ctx, reportId);
// Ögonblicksbilden har modellen (det som visas) och för månads- och slutrapporter fakta för kommunens resultatfil
// (snapshot.facts, facts.ts) – byggda i samma pass och med samma datakälla.
// ctx.system: frysningen är ett systemsteg – underlaget läses och ögonblicksbilden skrivs oavsett vem som levererade.
import type { Ctx } from "@/api/server";
import { END_REASON_LABEL } from "@/core/labels";
import type { Report, ReportSnapshot } from "@/data/schema";
import { parseFacts, reconcileFinalFacts, reconcileMonthlyFacts, type ReportFacts } from "./facts";
import { contractInfo, loadCasesReportDb, loadReportDb, type ContractInfo } from "./load";
import { frozenFacts, frozenModelAndFacts, hasDocument, hasFacts, hasSnapshot, type FinalModel, type MonthlyModel, type ReportDb } from "./model";
import { isDelivered } from "./report-helpers";

const J = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Ögonblicksbildens fakta, om de finns och gäller rapporten och dess typ. */
export function snapshotFacts(r: Pick<Report, "id" | "kind" | "snapshot">): ReportFacts | null {
  if (!r.snapshot || r.snapshot.reportId !== r.id) return null;
  const f = parseFacts(r.snapshot.facts);
  return f && f.kind === r.kind ? f : null;
}

/** Sökvägarna som Table.pickJson läser för att få fakta utan resten av ögonblicksbilden (rapportbyggaren, steg 4). */
export const FACTS_JSON = { facts: ["snapshot", "facts"], snapshotReportId: ["snapshot", "reportId"] } as const satisfies Record<string, readonly ["snapshot", string]>;

/**
 * Fakta ur en rad som lästs med pickJson(…, FACTS_JSON): samma kontroller som snapshotFacts – ögonblicksbilden gäller
 * rapporten (reportId), fakta är giltiga (parseFacts) och av rapportens typ. Annars null (rapporten fryses då i ett systemsteg).
 */
export function factsFromPick(r: Pick<Report, "id" | "kind"> & { facts: unknown; snapshotReportId: unknown }): ReportFacts | null {
  if (r.snapshotReportId !== r.id) return null;
  const f = parseFacts(r.facts);
  return f && f.kind === r.kind ? f : null;
}

type Frozen = { frozen: boolean; facts: ReportFacts | null };

/**
 * Frys en rapport med underlaget db: utan ögonblicksbild sparas modellen och fakta. Med ögonblicksbild men utan (giltiga)
 * fakta räknas fakta fram med asOf = leveransen, och ärendefälten och siffrorna (närvaro, avstämningar, bedömningen,
 * händelser, avvikelser) tas ur den frysta modellen (reconcile*Facts i facts.ts) – det kommunen fick. Modellen lämnas orörd. Fält som inte går att föra tillbaka loggas som report.facts_drift (bara fältnamn, aldrig värden).
 */
async function freezeWith(ctx: Ctx, r: Report, db: ReportDb, info: ContractInfo): Promise<Frozen> {
  if (!isDelivered(r) || !hasDocument(r.kind)) return { frozen: false, facts: null };
  const env = { ...info.env, now: ctx.now() };
  if (!hasSnapshot(r)) {
    const { model, facts } = frozenModelAndFacts(db, r, env);
    if (!model) return { frozen: false, facts: null };
    const snapshot: ReportSnapshot = { reportId: r.id, takenAt: ctx.now(), deliveredAt: r.deliveredAt, model: J(model), ...(facts ? { facts: J(facts) } : {}) };
    await ctx.system.table("reports").update(r.id, { snapshot });
    return { frozen: true, facts };
  }
  const existing = snapshotFacts(r);
  if (existing || !hasFacts(r.kind)) return { frozen: false, facts: existing };
  const computed = frozenFacts(db, r, env);
  if (!computed) return { frozen: false, facts: null };
  const model = r.snapshot!.model as MonthlyModel | FinalModel;
  let facts: ReportFacts = computed;
  let unresolved: string[] = [];
  if (computed.kind === "monthly" && model && (model as MonthlyModel).kind === "monthly") {
    const events = db.outcome_events.filter((e) => e.caseId === r.caseId);
    const rec = reconcileMonthlyFacts(computed, model as MonthlyModel, { cfg: info.cfg, areas: db.contract_areas, events });
    facts = rec.facts;
    unresolved = rec.unresolved;
  } else if (computed.kind === "final" && model && (model as FinalModel).kind === "final") {
    const rec = reconcileFinalFacts(computed, model as FinalModel, END_REASON_LABEL);
    facts = rec.facts;
    unresolved = rec.unresolved;
  }
  await ctx.system.table("reports").update(r.id, { snapshot: { ...r.snapshot!, facts: J(facts) } });
  if (unresolved.length) {
    await ctx.audit({ action: "report.facts_drift", entity: "report", entityId: r.id, contractId: r.contractId, details: { fields: unresolved } });
  }
  return { frozen: false, facts };
}

/** Spara innehållet som gällde vid leveransen. Returnerar true om rapporten frystes nu (false: inte levererad, redan fryst). */
export async function freezeReport(ctx: Ctx, reportOrId: Report | string): Promise<boolean> {
  const r = typeof reportOrId === "string" ? await ctx.system.table("reports").get(reportOrId) : reportOrId;
  if (!r || !isDelivered(r) || !hasDocument(r.kind) || hasSnapshot(r)) return false;
  const info = await contractInfo(ctx, r.contractId);
  const db = await loadReportDb(ctx, r, info);
  return (await freezeWith(ctx, r, db, info)).frozen;
}

/**
 * Se till att en levererad månads- eller slutrapport har fakta i ögonblicksbilden (fryser rapporten om den saknar
 * ögonblicksbild). Returnerar fakta, eller null för rapporter utan fakta.
 */
export async function ensureFacts(ctx: Ctx, reportOrId: Report | string): Promise<ReportFacts | null> {
  const r = typeof reportOrId === "string" ? await ctx.system.table("reports").get(reportOrId) : reportOrId;
  if (!r || !isDelivered(r) || !hasFacts(r.kind)) return null;
  const ready = snapshotFacts(r);
  if (ready) return ready;
  const info = await contractInfo(ctx, r.contractId);
  return (await freezeWith(ctx, r, await loadReportDb(ctx, r, info), info)).facts;
}

/**
 * Fakta för många levererade rapporter i samma avtal (kommunens resultatfil). Rapporter utan ögonblicksbild eller utan fakta
 * fryses (samma systemsteg som när kommunen öppnar en rapport) – underlaget läses en gång för alla ärenden.
 */
export async function ensureFactsMany(ctx: Ctx, reports: readonly Report[], info: ContractInfo): Promise<Map<string, ReportFacts | null>> {
  const out = new Map<string, ReportFacts | null>();
  const todo: Report[] = [];
  for (const r of reports) {
    const ready = snapshotFacts(r);
    if (ready) out.set(r.id, ready);
    else if (isDelivered(r) && hasFacts(r.kind)) todo.push(r);
    else out.set(r.id, null);
  }
  if (!todo.length) return out;
  const db = await loadCasesReportDb(ctx, info.contract.id, todo.map((r) => r.caseId).filter((x): x is string => !!x));
  // Tio i taget: första exporten efter driftsättningen kan behöva frysa hundratals rapporter (en skrivning var) inom rutens
  // tidsgräns. Varje rapport skrivs för sig, så ordningen spelar ingen roll.
  for (let i = 0; i < todo.length; i += FREEZE_BATCH) {
    const batch = todo.slice(i, i + FREEZE_BATCH);
    const done = await Promise.all(batch.map((r) => freezeWith(ctx, r, db, info)));
    batch.forEach((r, j) => out.set(r.id, done[j].facts));
  }
  return out;
}
const FREEZE_BATCH = 10;
