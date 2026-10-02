// Resultatfilen (steg 3) för ett urval – delas av kommunens resultatfil (kommun/result-handlers.ts, regeln "customer") och
// Miljonbemannings "Resultatfil för hela avtalet" (builder-handlers.ts, regeln "mb"). Bara för hanterare.
//   1. loadResultFacts: hela raderna för urvalets rapporter, frysning av det som saknar fakta (systemsteg i freeze.ts) och
//      vilka rapporter som har en rättelse på väg.
//   2. resultFileFor: raderna (buildResultExport) och filen (CSV som text, Excel som base64).
// Loggningen och spärrarna (kolumnspärren för kommunen) gör hanteraren.
import type { Ctx } from "@/api/server";
import type { OperationalConfig } from "@/core/config";
import { bytesToBase64 } from "@/core/export/base64";
import type { MonthKey } from "@/core/time";
import type { ContractArea, Report } from "@/data/schema";
import { buildResultExport, CSV_MIME, resultCsv, resultXlsx, XLSX_MIME, type ExportFileTable, type ExportFormat, type ResultExport } from "./export";
import { EXPORT_TABLES } from "./export-columns";
import type { FinalFacts, MonthlyFacts, ReportFacts } from "./facts";
import { ensureFactsMany } from "./freeze";
import type { ContractInfo } from "./load";
import { isDelivered } from "./report-helpers";
import type { LightReport, Selection } from "./selection";

export type ResultFacts = { monthly: Report[]; finals: Report[]; facts: Map<string, ReportFacts | null>; pendingOpen: Set<string> };

/** Hela raderna (med ögonblicksbilden) för urvalets rapporter, i urvalets ordning – och fakta (fryser det som saknas). */
export async function loadResultFacts(ctx: Ctx, sel: Selection<LightReport>, info: ContractInfo): Promise<ResultFacts> {
  const chosen = [...sel.monthly, ...sel.finals];
  const full = new Map((await ctx.repo.table("reports").list({ id: { in: chosen.map((r) => r.id) } })).map((r) => [r.id, r]));
  const monthly = sel.monthly.map((r) => full.get(r.id)).filter((r): r is Report => !!r);
  const finals = sel.finals.map((r) => full.get(r.id)).filter((r): r is Report => !!r);
  // Frysning (systemsteg i freeze.ts)
  const facts = await ensureFactsMany(ctx, [...monthly, ...finals], info);
  // Rättelse pågår: den nya versionen är ett utkast. ctx.system: bara status för rättelsen (läsaren läser inte utkastet).
  const pendIds = [...monthly, ...finals].map((r) => r.correctionPending).filter((x): x is string => !!x);
  const pend = pendIds.length ? await ctx.system.table("reports").list({ id: { in: pendIds } }) : [];
  const pendingOpen = new Set(pend.filter((x) => !isDelivered(x) && !x.superseded).map((x) => x.id));
  return { monthly, finals, facts, pendingOpen };
}

/** Raderna i resultatfilen. Namnen enligt läsarens behörighet (viewerFor) – buildResultExport kastar om ett namn saknas eller är dolt. */
export function resultExportFor(sel: Selection<LightReport>, rf: ResultFacts, opts: { cfg: OperationalConfig; areas: readonly ContractArea[]; from: MonthKey; to: MonthKey; now: string }): ResultExport {
  const names = new Map(rf.monthly.map((r) => [r.caseId as string, sel.viewer.name(sel.cases.get(r.caseId as string))]));
  const pending = (r: Report) => !!r.correctionPending && rf.pendingOpen.has(r.correctionPending);
  const exp = buildResultExport({
    cfg: opts.cfg, areas: opts.areas, names, from: opts.from, to: opts.to, now: opts.now,
    monthly: rf.monthly.flatMap((r) => {
      const f = rf.facts.get(r.id);
      return f && f.kind === "monthly" ? [{ report: r, correctionPending: pending(r), facts: f as MonthlyFacts }] : [];
    }),
    finals: rf.finals.flatMap((r) => {
      const f = rf.facts.get(r.id);
      return f && f.kind === "final" ? [{ report: r, correctionPending: pending(r), facts: f as FinalFacts }] : [];
    }),
  });
  if (exp.meta.rows.resultat !== sel.monthly.length) throw new Error("Resultatfilen: fakta saknas för en levererad månadsrapport");
  return exp;
}

export type ResultFileContent = { content: string; mime: string; encoding: "text" | "base64"; rows: number };

/** Filen: Excel (alla flikar, base64) eller en tabell som CSV-text. */
export async function resultFileContent(exp: ResultExport, cfg: OperationalConfig, format: ExportFormat, table: ExportFileTable, about: { contractNumber: string; customerName: string }): Promise<ResultFileContent> {
  if (format === "xlsx") {
    return { content: bytesToBase64(await resultXlsx(exp, cfg, about)), mime: XLSX_MIME, encoding: "base64", rows: EXPORT_TABLES.reduce((n, t) => n + exp.meta.rows[t], 0) };
  }
  return { content: resultCsv(exp, table), mime: CSV_MIME, encoding: "text", rows: table === "faltbeskrivning" ? exp.allColumns.length : exp.meta.rows[table] };
}
