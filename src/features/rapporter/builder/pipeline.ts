// Rapportbyggarens körning på servern: urval → fakta → steg 3:s tabeller → motorn → filen. Delas av Miljonbemannings hanterare
// (builder-handlers.ts, regeln "mb") och kommunens (kommun/shared-report-handlers.ts, regeln "customer"). Bara för hanterare.
//
// Ordningen (D2): perioden → urvalet (selectDelivered) → fakta (loadBuilderFacts: pickJson, frysning bara för det som saknas)
// → buildResultExport → motorn (urval, uppdelning; datamängdens tabell utan rader = empty) → kolumnkontrollen mot registret
// (column_missing) → gränsen för antal rader → filen och storleken. Loggningen gör hanteraren innan svaret.
import type { Ctx } from "@/api/server";
import type { OperationalConfig } from "@/core/config";
import { bytesToBase64 } from "@/core/export/base64";
import type { LocalDateTime, MonthKey } from "@/core/time";
import type { Contract, ContractArea, Report } from "@/data/schema";
import { buildResultExport, CSV_MIME, XLSX_MIME, type ExportRow, type ResultExport } from "../export";
import type { FinalFacts, MonthlyFacts } from "../facts";
import { contractInfo, type ContractInfo } from "../load";
import { isDelivered } from "../report-helpers";
import { loadBuilderFacts, selectDelivered, type AccessRule } from "../selection";
import { DATASET_TABLE, resolvePeriod, type ReportDefinition } from "./definition";
import { builderCsv, builderFilename, builderXlsx, fileTable, MAX_BUILDER_RESPONSE_CHARS, TOO_LARGE_TEXT, withinLimit, type BuilderFormat } from "./files";
import { MAX_GROUPS, missingColumn, runDefinition, type BuilderAudience, type BuilderView } from "./run";

/**
 * Gränserna (antal rader i tabellen, tecken i svaret). Bara testerna ändrar dem – testdatat räcker inte för att nå gränserna,
 * och felvägarna (too_many_groups, too_large med loggraden saved_report.export_blocked) ska prövas genom hanterarna.
 */
export const LIMITS = { groups: MAX_GROUPS, chars: MAX_BUILDER_RESPONSE_CHARS };

export type PipelineError = "period" | "empty" | "column_missing" | "too_many_groups";
export type PipelineOk = {
  ok: true;
  view: BuilderView;
  /** Datamängdens rader efter urvalet – bara för filen, aldrig i ett svar. */
  rows: ExportRow[];
  exp: ResultExport;
  info: ContractInfo;
  areas: ContractArea[];
  period: { from: MonthKey; to: MonthKey };
  /** Alla rapporter vars fakta används: datamängdens rapporter och (för avslut) de kopplade månadsrapporterna. */
  reportIds: string[];
};
export type PipelineFail = { ok: false; error: PipelineError; message: string; column?: string };

export type PipelineInput = {
  contract: Contract;
  cfg: OperationalConfig;
  def: ReportDefinition;
  rule: AccessRule;
  audience: BuilderAudience;
  title: string;
};

/** Kolumntexten för column_missing (Miljonbemanning – kommunen får en egen text). */
export const columnMissingText = (column: string): string => `Kolumnen ${column} finns inte längre. Ändra rapporten.`;

export async function runPipeline(ctx: Ctx, p: PipelineInput): Promise<PipelineOk | PipelineFail> {
  const { contract, cfg, def } = p;
  const period = resolvePeriod(def.period, { now: ctx.now(), contractStart: contract.startsOn });
  if ("error" in period) return { ok: false, error: "period", message: period.error };
  const { from, to } = period;
  // Urvalet: avslut behöver ärendets senaste levererade månadsrapport (avtalsområde, yrkesspår och enhet).
  const sel = await selectDelivered(ctx, { contractId: contract.id, cfg, from, to, rule: p.rule, finals: true, latestMonthlyForFinals: def.dataset === "avslut" });
  const info = await contractInfo(ctx, contract.id);
  const facts = await loadBuilderFacts(ctx, [...sel.monthly, ...sel.finals, ...sel.joinMonthly], info);
  const areas = await ctx.repo.table("contract_areas").list({ contractId: contract.id });
  // Rättelse pågår (rattelse_pagar). ctx.system: bara status för rättelsen (läsaren läser inte utkastet).
  const pendIds = [...sel.monthly, ...sel.finals].map((r) => r.correctionPending).filter((x): x is string => !!x);
  const pend: Report[] = pendIds.length ? await ctx.system.table("reports").list({ id: { in: pendIds } }) : [];
  const pendingOpen = new Set(pend.filter((x) => !isDelivered(x) && !x.superseded).map((x) => x.id));
  const pending = (r: { correctionPending: string | null }) => !!r.correctionPending && pendingOpen.has(r.correctionPending);
  // Namnen enligt läsarens behörighet – buildResultExport kastar om ett namn saknas eller är dolt (programfel).
  const names = new Map(sel.monthly.map((r) => [r.caseId as string, sel.viewer.name(sel.cases.get(r.caseId as string))]));
  const exp = buildResultExport({
    cfg, areas, names, from, to, now: ctx.now(),
    monthly: sel.monthly.flatMap((r) => {
      const f = facts.get(r.id);
      return f && f.kind === "monthly" ? [{ report: r, correctionPending: pending(r), facts: f as MonthlyFacts }] : [];
    }),
    finals: sel.finals.flatMap((r) => {
      const f = facts.get(r.id);
      return f && f.kind === "final" ? [{ report: r, correctionPending: pending(r), facts: f as FinalFacts }] : [];
    }),
  });
  if (exp.meta.rows.resultat !== sel.monthly.length) throw new Error("Rapportbyggaren: fakta saknas för en levererad månadsrapport");
  const joinFacts = new Map<string, MonthlyFacts>();
  for (const r of sel.joinMonthly) {
    const f = facts.get(r.id);
    if (f && f.kind === "monthly") joinFacts.set(f.caseNumber, f);
  }
  const res = runDefinition({ exp, joinFacts, def, period, audience: p.audience, cfg, areas, title: p.title, maxGroups: LIMITS.groups });
  if (!res.ok && res.error === "empty") return { ok: false, error: "empty", message: res.message };
  const missing = missingColumn(def, exp.allColumns);
  if (missing) return { ok: false, error: "column_missing", message: columnMissingText(missing), column: missing };
  if (!res.ok) return { ok: false, error: res.error, message: res.message };
  const table = DATASET_TABLE[def.dataset];
  const used = new Set(res.rows.map((r) => String(r.arendenummer)));
  const joinIds = def.dataset === "avslut" ? sel.joinMonthly.filter((r) => used.has((facts.get(r.id) as MonthlyFacts | null)?.caseNumber ?? "")).map((r) => r.id) : [];
  const reportIds = [...new Set([...exp.meta.tableReportIds[table], ...joinIds])];
  return { ok: true, view: res.view, rows: res.rows, exp, info, areas, period, reportIds };
}

export type BuilderFile =
  | { ok: true; kind: "file"; filename: string; mime: string; encoding: "text" | "base64"; content: string; rows: number }
  | { ok: true; kind: "pdf"; filename: string; pdf: BuilderView & { title: string; contractNumber: string; customerName: string; fetchedAt: LocalDateTime } }
  | { ok: false; error: "too_large" | "definition"; message: string };

/** Filen (eller PDF-modellen) för en körning. Gränsen för svaret är en parameter (testerna använder en liten gräns). */
export async function builderFile(run: PipelineOk, p: { def: ReportDefinition; format: BuilderFormat; templateKey: string | null; title: string; now: LocalDateTime; cfg: OperationalConfig; contract: Contract; limit?: number }): Promise<BuilderFile> {
  const filename = builderFilename(p.cfg.casePrefix, p.templateKey, p.def.dataset, run.period.from, run.period.to, p.format);
  if (p.format === "pdf") {
    if (p.def.output !== "sammanstallning") return { ok: false, error: "definition", message: "PDF finns bara för sammanställningar." };
    return { ok: true, kind: "pdf", filename, pdf: { ...run.view, title: p.title, contractNumber: p.contract.contractNumber, customerName: run.info.customerName, fetchedAt: p.now } };
  }
  const t = fileTable(run.view, p.def, run.exp, run.rows);
  let content: string;
  let mime: string;
  let encoding: "text" | "base64";
  if (p.format === "xlsx") {
    content = bytesToBase64(await builderXlsx(run.view, p.def, run.exp, run.rows, {
      title: p.title, contractNumber: p.contract.contractNumber, customerName: run.info.customerName, now: p.now, cfg: p.cfg, areas: run.areas,
    }));
    mime = XLSX_MIME;
    encoding = "base64";
  } else {
    content = builderCsv(t);
    mime = CSV_MIME;
    encoding = "text";
  }
  if (!withinLimit(content, p.limit ?? LIMITS.chars)) return { ok: false, error: "too_large", message: TOO_LARGE_TEXT };
  return { ok: true, kind: "file", filename, mime, encoding, content, rows: t.rows.length };
}

/** Loggradens detaljer för export.saved_report (D2 punkt 6) – aldrig namn, ärendenummer, titel eller urvalets värden. */
export function exportDetails(run: PipelineOk, p: { def: ReportDefinition; savedReportId: string | null; templateKey: string | null; audience: BuilderAudience; format: BuilderFormat; rows: number }): Record<string, unknown> {
  const d = p.def;
  return {
    savedReportId: p.savedReportId, template: p.templateKey, dataset: d.dataset, audience: p.audience, format: p.format, output: d.output,
    from: run.period.from, to: run.period.to, rows: p.rows, cases: run.view.counts.cases, schema: run.exp.meta.schema, reportIds: run.reportIds,
    ...(d.output === "lista" ? { columns: [...d.columns] } : { measures: [...d.measures], groupBy: d.groupBy, split: d.split }),
  };
}
