// Resultatfilen (steg 3) för ett urval – Miljonbemannings "Resultatfil för hela avtalet" (builder-handlers.ts, regeln "mb").
// Kommunen hämtar inte filen själv längre (beslut 2026-10-07: kommunens chef är borttagen) – avtalsansvarig lämnar den till
// kommunen. Bara för hanterare.
//   1. loadResultFacts: hela raderna för urvalets rapporter, frysning av det som saknar fakta (systemsteg i freeze.ts) och
//      vilka rapporter som har en rättelse på väg.
//   2. resultFileFor: raderna (buildResultExport) och filen (CSV som text, Excel som base64).
//   3. previousColumns: kolumnspärren – kolumnerna i den senast utlämnade filen per tabell (export.results från tiden då
//      kommunen hämtade filen själv, och export.results_mb).
// Loggningen och spärren gör hanteraren.
import type { Ctx } from "@/api/server";
import type { OperationalConfig } from "@/core/config";
import { bytesToBase64 } from "@/core/export/base64";
import type { MonthKey } from "@/core/time";
import type { AuditLogEntry, ContractArea, Report } from "@/data/schema";
import { buildResultExport, CSV_MIME, resultCsv, resultXlsx, XLSX_MIME, type ExportFileTable, type ExportFormat, type ResultExport } from "./export";
import { EXPORT_SCHEMA_VERSION, EXPORT_TABLES } from "./export-columns";
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

// ---------------------------------------------------------------- Kolumnspärren
/** Loggraderna som räknas som en utlämnad resultatfil: kommunens egna hämtningar (före 2026-10-07) och Miljonbemannings. */
export const RESULT_FILE_ACTIONS = ["export.results", "export.results_mb"] as const;
/** Loggrader per sida när kolumnspärren letar bakåt i loggen. */
const LOCK_PAGE = 10;

/** Tabellens kolumner i en loggrad för schemaversionen (tom lista = raden gäller inte tabellen). */
function loggedColumns(l: AuditLogEntry, table: string): string[] {
  const d = l.details ?? {};
  if (d.schema !== EXPORT_SCHEMA_VERSION || !Array.isArray(d.columns)) return [];
  const prefix = `${table}.`;
  return (d.columns as unknown[]).filter((c): c is string => typeof c === "string" && c.startsWith(prefix));
}

/**
 * Kolumnerna i den senast utlämnade filen per tabell för avtalet och schemaversionen (null = ingen tidigare fil). Läser loggen
 * bakåt en sida i taget och slutar när alla tabeller har hittats – inte hela loggen. Raderna har minutprecision, så en hel
 * minut läses alltid samtidigt; inom samma minut vinner den längsta listan (varje utlämnad lista börjar med den föregående,
 * så den längsta är den senaste).
 */
export async function previousColumns(ctx: Ctx, contractId: string, tables: readonly string[]): Promise<Map<string, string[] | null>> {
  // ctx.system: bara kolumnlistan i loggraderna för avtalets resultatfiler används (läsaren behöver inte läsa revisionsloggen).
  const log = ctx.system.table("audit_log");
  const where = { action: { in: [...RESULT_FILE_ACTIONS] }, contractId };
  const found = new Map<string, string[] | null>();
  let before: string | null = null;
  while (found.size < tables.length) {
    const page: AuditLogEntry[] = await log.list(before ? { ...where, occurredAt: { lt: before } } : where, { orderBy: "occurredAt", desc: true, limit: LOCK_PAGE });
    if (!page.length) break;
    const oldest = page[page.length - 1].occurredAt;
    // Rader i samma minut som den äldsta på sidan kan ha hamnat utanför sidan – läs hela den minuten.
    const rows = page.length < LOCK_PAGE ? page : [...page.filter((l) => l.occurredAt > oldest), ...(await log.list({ ...where, occurredAt: oldest }))];
    const minutes = [...new Set(rows.map((l) => l.occurredAt))].sort().reverse();
    for (const at of minutes) {
      for (const t of tables) {
        if (found.has(t)) continue;
        const lists = rows.filter((l) => l.occurredAt === at).map((l) => loggedColumns(l, t)).filter((c) => c.length);
        if (lists.length) found.set(t, lists.reduce((a, b) => (b.length > a.length ? b : a)));
      }
    }
    if (page.length < LOCK_PAGE) break;
    before = oldest;
  }
  for (const t of tables) if (!found.has(t)) found.set(t, null);
  return found;
}
