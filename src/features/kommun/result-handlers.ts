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
import { isOperational, requireOperational, type OperationalConfig } from "@/core/config";
import { bytesToBase64 } from "@/core/export/base64";
import { addMonths, monthEnd, monthKey, monthName, type MonthKey } from "@/core/time";
import type { AuditLogEntry, Case, Contract, Report } from "@/data/schema";
import {
  buildResultExport, CSV_MIME, latestVersions, periodError, periodLabel, resultCsv, resultFilename, resultXlsx, XLSX_MIME, type ExportFileTable, type ExportFormat,
} from "../rapporter/export";
import {
  columnsStillCompatible, EXPORT_SCHEMA_VERSION, EXPORT_TABLES, exportColumns, FIELD_DESCRIPTION_COLUMNS, MAX_EXPORT_MONTHS, qualifiedKeys, tableColumns,
} from "../rapporter/export-columns";
import type { FinalFacts, MonthlyFacts } from "../rapporter/facts";
import { ensureFactsMany } from "../rapporter/freeze";
import { contractInfo, reportAccess, viewerFor, type Viewer } from "../rapporter/load";
import { isDelivered } from "../rapporter/report-helpers";
import { resultExport, resultExportPreview, type ResultPreview } from "./api";
import { deliveredOk } from "./load";

const CHEF = ["kommun_chef"] as const;
const NOT_ALLOWED = "Ert avtal har inte resultatfilen.";
const NO_FILE = "Filen kan inte skapas just nu. Kontakta Miljonbemanning.";
const EMPTY = "Det finns inga levererade månadsrapporter för perioden. Välj en annan period.";

/** Avtalet där chefen hämtar resultat: det första av chefens avtal med driftkonfiguration (via ctx.repo). */
async function chefContract(ctx: Ctx, contractId?: string): Promise<{ contract: Contract; cfg: OperationalConfig } | null> {
  const ids = contractId ? (ctx.actor.contractIds.includes(contractId) ? [contractId] : []) : ctx.actor.contractIds;
  if (!ids.length) return null;
  const contracts = await ctx.repo.table("contracts").list({ id: { in: ids } });
  const contract = ids.map((id) => contracts.find((c) => c.id === id)).find((c): c is Contract => !!c && isOperational(c.config)) ?? null;
  return contract ? { contract, cfg: requireOperational(contract.config) } : null;
}

const seesResults = (cfg: OperationalConfig) => cfg.customerVisibility.seesIndividualReports === true;
const periodOpts = (ctx: Ctx, contract: Contract) => ({ current: monthKey(ctx.now()), start: monthKey(contract.startsOn), maxMonths: MAX_EXPORT_MONTHS });

/** Fälten som urvalet behöver (deliveredOk, reportAccess, versionerna) – inte ögonblicksbilden, som bara exporten läser. */
const LIGHT = ["contractId", "caseId", "kind", "month", "periodEnd", "status", "deliveredAt", "deliveredTo", "recipientUserId", "superseded", "version", "previousId", "correctionPending"] as const;
type LightReport = Pick<Report, (typeof LIGHT)[number] | "id">;

type Selection<R> = { monthly: R[]; finals: R[]; cases: Map<string, Case>; viewer: Viewer; dropped: string[] };

/**
 * Urvalet (steg 2) – samma för förhandsvisningen och exporten, så att antalen stämmer. Läser bara de fält som behövs
 * (förhandsvisningen körs vid varje månadsbyte); exporten läser sedan hela raderna för de valda rapporterna.
 * finals: slutrapporter för insatser som avslutades i perioden (periodEnd = avslutsdagen) – bara för exporten.
 */
async function select(ctx: Ctx, contractId: string, cfg: OperationalConfig, from: MonthKey, to: MonthKey, opts: { finals: boolean }): Promise<Selection<LightReport>> {
  const reports = ctx.repo.table("reports");
  const [monthlyAll, finalsAll] = await Promise.all([
    reports.pick(LIGHT, { contractId, kind: "monthly", month: { gte: from, lte: to } }),
    opts.finals ? reports.pick(LIGHT, { contractId, kind: "final", periodEnd: { gte: `${from}-01`, lte: monthEnd(to) } }) : Promise.resolve([] as LightReport[]),
  ]);
  const delivered = monthlyAll.filter((r) => deliveredOk(r));
  const deliveredFinals = finalsAll.filter((r) => deliveredOk(r));
  const caseIds = [...new Set([...delivered, ...deliveredFinals].map((r) => r.caseId).filter((x): x is string => !!x))];
  const cases = caseIds.length ? await ctx.repo.table("cases").list({ id: { in: caseIds } }) : [];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const viewer = await viewerFor(ctx, cases);
  // Bara ärenden med åtkomst "customer": skyddade personuppgifter (restricted) och andra enheter (none) kommer aldrig med.
  const visible = (r: LightReport) => {
    const c = r.caseId ? byId.get(r.caseId) : undefined;
    return !!c && viewer.access(c) === "customer" && reportAccess(r, c, viewer, cfg).ok;
  };
  // Bara den senaste levererade versionen per ärende och månad (slutrapporten: per ärende) – aldrig två rader med samma nyckel.
  const m = latestVersions(delivered.filter(visible));
  const f = latestVersions(deliveredFinals.filter(visible));
  return { monthly: m.kept, finals: f.kept, cases: byId, viewer, dropped: [...m.dropped, ...f.dropped].map((r) => r.id) };
}

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
  // Hela raderna (med ögonblicksbilden) för de valda rapporterna, i urvalets ordning.
  const chosen = [...sel.monthly, ...sel.finals];
  const full = new Map((await ctx.repo.table("reports").list({ id: { in: chosen.map((r) => r.id) } })).map((r) => [r.id, r]));
  const monthlyReports = sel.monthly.map((r) => full.get(r.id)).filter((r): r is Report => !!r);
  const finalReports = sel.finals.map((r) => full.get(r.id)).filter((r): r is Report => !!r);

  // 3. Frysning (systemsteg i freeze.ts)
  const info = await contractInfo(ctx, contract.id);
  const facts = await ensureFactsMany(ctx, [...monthlyReports, ...finalReports], info);
  // Rättelse pågår: den nya versionen är ett utkast. ctx.system: bara status för rättelsen (kommunen läser inte utkastet).
  const pendIds = [...monthlyReports, ...finalReports].map((r) => r.correctionPending).filter((x): x is string => !!x);
  const pend = pendIds.length ? await ctx.system.table("reports").list({ id: { in: pendIds } }) : [];
  const pendingOpen = new Set(pend.filter((x) => !isDelivered(x) && !x.superseded).map((x) => x.id));

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

  // 5. Raderna. Namnen enligt läsarens behörighet (viewerFor) – buildResultExport kastar om ett namn saknas eller är dolt.
  const names = new Map(monthlyReports.map((r) => [r.caseId as string, sel.viewer.name(sel.cases.get(r.caseId as string))]));
  const pending = (r: Report) => !!r.correctionPending && pendingOpen.has(r.correctionPending);
  const exp = buildResultExport({
    cfg, areas, names, from: p.from, to: p.to, now: ctx.now(),
    monthly: monthlyReports.flatMap((r) => {
      const f = facts.get(r.id);
      return f && f.kind === "monthly" ? [{ report: r, correctionPending: pending(r), facts: f as MonthlyFacts }] : [];
    }),
    finals: finalReports.flatMap((r) => {
      const f = facts.get(r.id);
      return f && f.kind === "final" ? [{ report: r, correctionPending: pending(r), facts: f as FinalFacts }] : [];
    }),
  });
  if (exp.meta.rows.resultat !== sel.monthly.length) throw new Error("Resultatfilen: fakta saknas för en levererad månadsrapport");

  // 5. Filen
  let content: string;
  let mime: string;
  let encoding: "text" | "base64";
  let rows: number;
  if (format === "xlsx") {
    content = bytesToBase64(await resultXlsx(exp, cfg, { contractNumber: contract.contractNumber, customerName: info.customerName }));
    mime = XLSX_MIME;
    encoding = "base64";
    rows = EXPORT_TABLES.reduce((n, t) => n + exp.meta.rows[t], 0);
  } else {
    content = resultCsv(exp, table);
    mime = CSV_MIME;
    encoding = "text";
    rows = table === "faltbeskrivning" ? exp.allColumns.length : exp.meta.rows[table];
  }
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
