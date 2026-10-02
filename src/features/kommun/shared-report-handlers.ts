// Hanterare: rapporter som Miljonbemanning har delat med kommunens chef (rapporter steg 4). Registreras via kommun/handlers.ts.
//
// Kommunens chef bygger inget själv och kan inte ändra något. Rapporten körs med chefens egen behörighet: urvalet med regeln
// "customer" (bara ärenden i chefens enhet, aldrig skyddade personuppgifter) och kommunens läge i motorn ("färre än N", inget
// internt mål, inga texter om Miljonbemannings interna vyer). Ett avtal i taget: chefContract – samma som resultatfilen och
// menyns räknare (session.navCounts). Visningen (saved_report.viewed) och varje fil (export.saved_report) loggas innan svaret.
// Feltexterna är skrivna för kommunens chef – aldrig Miljonbemannings interna texter.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import type { SavedReport } from "@/data/schema";
import { DATASET_LABEL, OUTPUT_LABEL, periodDefText, ReportDefinitionSchema } from "../rapporter/builder/definition";
import { builderFile, exportDetails, runPipeline, type PipelineError } from "../rapporter/builder/pipeline";
import { templateFor } from "../rapporter/builder/templates";
import { sharedReport, sharedReportExport, sharedReports, type SharedReportRow } from "./api";
import { chefContract, seesResults } from "./load";

const CHEF = ["kommun_chef"] as const;

/** Feltexterna till kommunens chef (D4). */
export const KOM_ERROR = {
  not_found: "Rapporten finns inte längre. Miljonbemanning kan ha slutat dela den.",
  empty: "Det finns inga uppgifter för din enhet i den här rapporten.",
  period: "Rapporten har inga hela månader med uppgifter ännu. Försök igen nästa månad.",
  review: "Rapporten behöver ses över av Miljonbemanning.",
  failed: "Filen kunde inte skapas. Försök igen om en stund.",
} as const;
const komText = (e: PipelineError | "too_large" | "definition"): string => (e === "empty" ? KOM_ERROR.empty : e === "period" ? KOM_ERROR.period : KOM_ERROR.review);

/** Den delade rapporten i chefens avtal (via ctx.repo – RLS ger bara 'customer', inte arkiverade), eller null. */
async function sharedFor(ctx: Ctx, id: string): Promise<{ r: SavedReport; chosen: NonNullable<Awaited<ReturnType<typeof chefContract>>> } | null> {
  const chosen = await chefContract(ctx);
  if (!chosen || !seesResults(chosen.cfg)) return null;
  const r = await ctx.repo.table("saved_reports").get(id);
  if (!r || r.contractId !== chosen.contract.id || r.visibility !== "customer" || r.archivedAt) return null;
  return { r, chosen };
}

handleQuery(sharedReports, { roles: CHEF }, async (ctx) => {
  const chosen = await chefContract(ctx);
  if (!chosen || !seesResults(chosen.cfg)) return { allowed: false, reports: [] };
  // Samma filter som session.navCounts (sharedReports), så att kortet och listan alltid visar samma antal. Läser inga fakta.
  const rows = await ctx.repo.table("saved_reports").list({ contractId: chosen.contract.id, visibility: "customer", archivedAt: null });
  const reports: SharedReportRow[] = rows
    .sort((a, b) => ((a.sharedAt ?? "") < (b.sharedAt ?? "") ? 1 : (a.sharedAt ?? "") > (b.sharedAt ?? "") ? -1 : a.id < b.id ? -1 : 1))
    .map((r) => {
      const d = ReportDefinitionSchema.safeParse(r.definition);
      return {
        id: r.id, title: r.title, outputLabel: d.success ? OUTPUT_LABEL[d.data.output] : "", datasetLabel: d.success ? DATASET_LABEL[d.data.dataset] : "",
        periodLabel: d.success ? periodDefText(d.data.period) : "", sharedAt: r.sharedAt,
      };
    });
  return { allowed: true, reports };
});

handleCommand(sharedReport, { roles: CHEF, silent: true }, async (ctx, p) => {
  const chosen = await chefContract(ctx);
  if (!chosen || !seesResults(chosen.cfg)) return { allowed: false, found: false, title: "", view: null, error: null };
  const found = await sharedFor(ctx, p.savedReportId);
  if (!found) return { allowed: true, found: false, title: "", view: null, error: KOM_ERROR.not_found };
  const { r } = found;
  // Visningen loggas före svaret (beslut 12) – bara id:n och läget, ingen titel och inga antal.
  await ctx.audit({ action: "saved_report.viewed", entity: "saved_report", entityId: r.id, contractId: r.contractId, details: { audience: "kommun" } });
  const def = ReportDefinitionSchema.safeParse(r.definition);
  if (!def.success) return { allowed: true, found: true, title: r.title, view: null, error: KOM_ERROR.review };
  try {
    const run = await runPipeline(ctx, { contract: found.chosen.contract, cfg: found.chosen.cfg, def: def.data, rule: "customer", audience: "kommun", title: r.title });
    if (!run.ok) return { allowed: true, found: true, title: r.title, view: null, error: komText(run.error) };
    return { allowed: true, found: true, title: r.title, view: run.view, error: null };
  } catch (e) {
    // Undantag (programfel): kommunens chef får en begriplig text – felet loggas utan innehåll.
    console.error("kommun.delad: rapporten kunde inte byggas", r.id, e instanceof Error ? e.name : "fel");
    return { allowed: true, found: true, title: r.title, view: null, error: KOM_ERROR.failed };
  }
});

handleCommand(sharedReportExport, { roles: CHEF, silent: true }, async (ctx, p) => {
  // 1. Spärr: rapporten finns, är delad med kommunen, inte arkiverad och hör till chefens avtal.
  const found = await sharedFor(ctx, p.savedReportId);
  if (!found) return fail("not_found", KOM_ERROR.not_found);
  const { r, chosen } = found;
  const def = ReportDefinitionSchema.safeParse(r.definition);
  if (!def.success) return fail("definition", KOM_ERROR.review);
  const templateKey = templateFor(r.templateKey)?.key ?? null;
  // 2–5. Urval med kommunens regel, fakta, motorn i kommunens läge och kolumnkontrollen.
  const run = await runPipeline(ctx, { contract: chosen.contract, cfg: chosen.cfg, def: def.data, rule: "customer", audience: "kommun", title: r.title });
  if (!run.ok) {
    if (run.error === "column_missing") {
      await ctx.audit({ action: "saved_report.export_blocked", entity: "saved_report", entityId: r.id, contractId: r.contractId, details: { savedReportId: r.id, reason: "column_missing", column: run.column } });
    }
    return fail(run.error, komText(run.error));
  }
  const file = await builderFile(run, { def: def.data, format: p.format, templateKey, title: r.title, now: ctx.now(), cfg: chosen.cfg, contract: chosen.contract });
  if (!file.ok) {
    if (file.error === "too_large") {
      await ctx.audit({ action: "saved_report.export_blocked", entity: "saved_report", entityId: r.id, contractId: r.contractId, details: { savedReportId: r.id, reason: "too_large" } });
    }
    return fail(file.error, komText(file.error));
  }
  // 6. Logga innan svaret. Kastar loggningen lämnas ingenting ut.
  const rows = file.kind === "file" ? file.rows : (run.view.table ? run.view.table.rows.length + 1 : 0);
  await ctx.audit({
    action: "export.saved_report", entity: "saved_report", entityId: r.id, contractId: r.contractId,
    details: exportDetails(run, { def: def.data, savedReportId: r.id, templateKey, audience: "kommun", format: p.format, rows }),
  });
  if (file.kind === "pdf") return ok({ filename: file.filename, pdf: file.pdf });
  return ok({ filename: file.filename, mime: file.mime, encoding: file.encoding, content: file.content, rows: file.rows, cases: run.view.counts.cases });
});
