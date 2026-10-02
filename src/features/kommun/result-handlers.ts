// Hanterare: kommunens resultatfil (/portal/resultat, rapporter steg 3). Registreras via kommun/handlers.ts.
//
// Ordningen i exporten (allt på servern – webbläsaren gör bara nedladdningen):
//   1. Spärr: chefens avtal, avtalet tillåter individrapporter, perioden.
//   2. Urval via ctx.repo (policyn/RLS): levererade, inte ersatta månadsrapporter i perioden och slutrapporter för insatser som
//      avslutades i perioden; ärendena med åtkomst "customer" (utesluter skyddade personuppgifter och andra enheter) och
//      reportAccess. Bara den senaste versionen per ärende och månad.
//   3. Frysning: rapporter utan ögonblicksbild eller fakta fryses (samma systemsteg som när kommunen öppnar en rapport).
//   4. Kolumnspärren: kolumnlistan jämförs med den senast utlämnade filen för avtalet och schemaversionen.
//   5. Bygg raderna (buildResultExport) och filen (CSV eller Excel).
//   6. Logga export.results (id:n, period, antal, kolumner – aldrig namn eller ärendenummer). Kastar loggningen: ingen fil.
//   7. Svara med filen.
// ctx.system används bara där det står en kommentar vid anropet.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import type { OperationalConfig } from "@/core/config";
import { addMonths, monthKey, monthName, type MonthKey } from "@/core/time";
import type { AuditLogEntry, Contract } from "@/data/schema";
import { periodError, periodLabel, resultFilename, type ExportFileTable, type ExportFormat } from "../rapporter/export";
import {
  columnsStillCompatible, EXPORT_SCHEMA_VERSION, EXPORT_TABLES, exportColumns, FIELD_DESCRIPTION_COLUMNS, MAX_EXPORT_MONTHS, qualifiedKeys, tableColumns,
} from "../rapporter/export-columns";
import { contractInfo } from "../rapporter/load";
import { loadResultFacts, resultExportFor, resultFileContent } from "../rapporter/result-file";
import { selectDelivered } from "../rapporter/selection";
import { resultExport, resultExportPreview, type ResultPreview } from "./api";
import { chefContract, seesResults } from "./load";

const CHEF = ["kommun_chef"] as const;
const NOT_ALLOWED = "Ert avtal har inte resultatfilen.";
const NO_FILE = "Filen kan inte skapas just nu. Kontakta Miljonbemanning.";
const EMPTY = "Det finns inga levererade månadsrapporter för perioden. Välj en annan period.";

const periodOpts = (ctx: Ctx, contract: Contract) => ({ current: monthKey(ctx.now()), start: monthKey(contract.startsOn), maxMonths: MAX_EXPORT_MONTHS });

/** Urvalet: kommunens regel (åtkomst "customer") – samma funktion som rapportbyggaren (rapporter/selection.ts). */
const select = (ctx: Ctx, contractId: string, cfg: OperationalConfig, from: MonthKey, to: MonthKey, opts: { finals: boolean }) =>
  selectDelivered(ctx, { contractId, cfg, from, to, rule: "customer", finals: opts.finals });

// ================================================================ Förhandsvisningen (bara antal, ingen loggning)
handleQuery(resultExportPreview, { roles: CHEF }, async (ctx, p): Promise<ResultPreview> => {
  const found = await chefContract(ctx);
  const none: ResultPreview = {
    allowed: false, contractId: null, months: [], from: "", to: "", periodLabel: "", periodError: null, maxMonths: MAX_EXPORT_MONTHS, participants: 0, reports: 0, xlsxFilename: "",
  };
  if (!found || !seesResults(found.cfg)) return none;
  const { contract, cfg } = found;
  const opts = periodOpts(ctx, contract);
  const months: ResultPreview["months"] = [];
  for (let mk = opts.current; mk >= opts.start; mk = addMonths(mk, -1)) months.push({ value: mk, label: monthName(mk) });
  // Förval: förra månaden (eller innevarande om avtalet startade den här månaden).
  const prev = addMonths(opts.current, -1);
  const def = prev >= opts.start ? prev : opts.current;
  const from = p.from ?? def;
  const to = p.to ?? p.from ?? def;
  const err = periodError(from, to, opts);
  const sel = err ? null : await select(ctx, contract.id, cfg, from, to, { finals: false });
  return {
    allowed: true, contractId: contract.id, months, from, to, periodLabel: periodLabel(from, to), periodError: err, maxMonths: MAX_EXPORT_MONTHS,
    participants: sel ? new Set(sel.monthly.map((r) => r.caseId)).size : 0, reports: sel ? sel.monthly.length : 0,
    xlsxFilename: resultFilename(cfg.casePrefix, from, to, "xlsx"),
  };
});

// ================================================================ Exporten
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
async function previousColumns(ctx: Ctx, contractId: string, tables: readonly string[]): Promise<Map<string, string[] | null>> {
  // ctx.system: kommunen läser inte revisionsloggen. Bara kolumnlistan i loggraderna för avtalets resultatfiler används.
  const log = ctx.system.table("audit_log");
  const where = { action: "export.results", contractId } as const;
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

handleCommand(resultExport, { roles: CHEF, silent: true }, async (ctx, p) => {
  // 1. Spärr
  const found = await chefContract(ctx, p.contractId);
  if (!found || !seesResults(found.cfg)) return fail("forbidden", NOT_ALLOWED);
  const { contract, cfg } = found;
  const err = periodError(p.from, p.to, periodOpts(ctx, contract));
  if (err) return fail("period", err);
  const format: ExportFormat = p.format;
  const table: ExportFileTable = format === "xlsx" ? "resultat" : (p.table ?? "resultat");

  // 2. Urval
  const sel = await select(ctx, contract.id, cfg, p.from, p.to, { finals: true });
  if (!sel.monthly.length) return fail("empty", EMPTY);
  if (sel.dropped.length) console.error("resultatfil: äldre versioner var levererade och inte ersatta – bara den senaste kom med", sel.dropped);

  // 3. Frysning (hela raderna för de valda rapporterna; systemsteg i freeze.ts)
  const info = await contractInfo(ctx, contract.id);
  const rf = await loadResultFacts(ctx, sel, info);

  // 4. Kolumnspärren: den gamla listan måste vara början av den nya (nya kolumner bara sist). Samma register som filen.
  const areas = await ctx.repo.table("contract_areas").list({ contractId: contract.id });
  const register = exportColumns(cfg, areas);
  const tables = format === "xlsx" ? [...EXPORT_TABLES] : [table];
  const colsFor = (t: ExportFileTable): string[] =>
    t === "faltbeskrivning" ? FIELD_DESCRIPTION_COLUMNS.map((c) => `faltbeskrivning.${c.key}`) : qualifiedKeys(tableColumns(register, t));
  const previous = await previousColumns(ctx, contract.id, tables);
  for (const t of tables) {
    const prev = previous.get(t);
    if (prev && !columnsStillCompatible(prev, colsFor(t))) {
      await ctx.audit({ action: "export.results_blocked", entity: "contract", entityId: contract.id, contractId: contract.id, details: { schema: EXPORT_SCHEMA_VERSION, table: t, reason: "columns_changed" } });
      return fail("schema", NO_FILE);
    }
  }

  // 5. Raderna och filen
  const exp = resultExportFor(sel, rf, { cfg, areas, from: p.from, to: p.to, now: ctx.now() });
  const { content, mime, encoding, rows } = await resultFileContent(exp, cfg, format, table, { contractNumber: contract.contractNumber, customerName: info.customerName });
  const filename = resultFilename(cfg.casePrefix, p.from, p.to, format, table);

  // 6. Logga innan filen lämnas ut. Inga namn eller ärendenummer – bara id:n, period, antal och kolumnnamn. Rapport-id:na är
  // rapporterna vars uppgifter finns i just den här filen; fältbeskrivningen innehåller inga uppgifter ur rapporterna.
  await ctx.audit({
    action: "export.results", entity: "contract", entityId: contract.id, contractId: contract.id,
    details: {
      from: p.from, to: p.to, format, table: format === "xlsx" ? "alla" : table, rows, cases: exp.meta.cases, schema: EXPORT_SCHEMA_VERSION,
      columns: tables.flatMap(colsFor),
      ...(format === "xlsx" ? { reportIds: exp.meta.reportIds } : table === "faltbeskrivning" ? {} : { reportIds: exp.meta.tableReportIds[table] }),
    },
  });

  // 7. Svara
  return ok({ filename, mime, encoding, content, rows, cases: exp.meta.cases });
});
