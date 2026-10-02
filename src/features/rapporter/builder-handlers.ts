// Hanterare: rapportbyggaren för Miljonbemanning (rapporter steg 4, SPEC §7.11 k). Registreras via rapporter/handlers.ts.
// Roller: samordnare, avtalsansvarig och chef (inte admin, coach, handledare eller ekonom – beslut 10).
//
// Allt läses och skrivs via ctx.repo (policyn/RLS avgör: saved_reports i 0021). ctx.system används bara i systemstegen som
// steg 3 redan har (frysningen i freeze.ts, uppslagen för behörigheten i load.ts och rättelsernas status i pipeline.ts).
// När indata har savedReportId gäller den sparade rapportens avtal (konfiguration, områden, urval) – ett annat contractId
// ger not_found. Varje fil loggas (export.saved_report) och varje visning av en sparad rapport (saved_report.viewed) innan
// svaret; kastar loggningen lämnas ingen fil ut. Loggen har bara id:n – aldrig namn, ärendenummer, titlar eller urvalets värden.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { isOperational, requireOperational, type OperationalConfig } from "@/core/config";
import { addMonths, monthKey, monthName } from "@/core/time";
import type { Contract, SavedReport, SavedReportVisibility } from "@/data/schema";
import {
  builderCatalog, builderExport, builderPreview, contractResultExport, contractResultPreview, savedReport, savedReportArchive, savedReportList, savedReportSave,
  savedReportShare, type BuilderCatalog, type ContractResultPreview, type SavedReportRow,
} from "./api";
import { columnRule, dimensionChoices } from "./builder/catalog";
import {
  canonicalJson, DATASET_DIMENSIONS, DATASET_HELP, DATASET_LABEL, DATASET_TABLE, DATASETS, datasetDimensions, DIMENSION_LABEL, MULTI_COLUMN_MEASURES, OUTPUT_LABEL,
  periodDefText, ReportDefinitionSchema, TitleSchema, type ReportDefinition,
} from "./builder/definition";
import { measuresFor, resultReasons } from "./builder/measures";
import { builderFile, exportDetails, runPipeline } from "./builder/pipeline";
import { templateFor, templateSentence, TEMPLATES } from "./builder/templates";
import { periodError, periodLabel, resultFilename } from "./export";
import { exportColumns, MAX_EXPORT_MONTHS, plainText, tableColumns } from "./export-columns";
import { contractInfo } from "./load";
import { dFull } from "./report-helpers";
import { loadResultFacts, resultExportFor, resultFileContent } from "./result-file";
import { selectDelivered } from "./selection";

const BUILDERS: readonly Role[] = ["samordnare", "avtalsansvarig", "chef"];
const NOT_FOUND = "Rapporten finns inte eller så har du inte tillgång till den.";
const NO_CONTRACT = "Avtalet finns inte eller så har du inte tillgång till det.";
const FORBIDDEN = "Du kan inte ändra den här rapporten.";
/** En rapport som är delad med kommunen: ägaren (som inte är avtalsansvarig) ändrar den först när avtalsansvarig slutat dela den. */
const CUSTOMER_SHARED_OWNER = "Rapporten är delad med kommunen. Be avtalsansvarig sluta dela den om du vill ändra den, eller gör en kopia.";
const CUSTOMER_SHARED = "Rapporten är delad med kommunen. Gör en kopia om du vill ändra något.";
/** Delad med kommunen, men avtalet tillåter det inte längre: bara "Sluta dela med kommunen" går (RLS nekar allt annat). */
const SHARING_ENDED_OWNER = "Avtalet tillåter inte längre att rapporter delas med kommunen. Sluta dela rapporten med kommunen innan du ändrar eller arkiverar den.";
const SHARING_ENDED = "Avtalet tillåter inte längre att rapporter delas med kommunen. Sluta dela rapporten med kommunen innan du arkiverar den.";
const ONLY_AVTALSANSVARIG = "Bara avtalsansvarig kan dela med kommunen.";
const CONTRACT_NO_SHARING = "Avtalet tillåter inte att rapporter delas med kommunen.";
const NOT_OWNER = "Bara den som skapade rapporten kan ändra innehållet. Du kan dela, sluta dela eller arkivera den.";
const COPY_TO_CHANGE = "Bara den som skapade rapporten kan ändra den. Gör en kopia om du vill ändra något.";
const EMPTY_RESULT = "Det finns inga levererade månadsrapporter för perioden. Välj en annan period.";

// ---------------------------------------------------------------- Avtalen
type Chosen = { contract: Contract; cfg: OperationalConfig };
/** Läsarens avtal i drift (via ctx.repo), i medlemskapens ordning. */
async function builderContracts(ctx: Ctx): Promise<Chosen[]> {
  const ids = ctx.actor.contractIds;
  if (!ids.length) return [];
  const contracts = await ctx.repo.table("contracts").list({ id: { in: ids } });
  return ids
    .map((id) => contracts.find((c) => c.id === id))
    .filter((c): c is Contract => !!c && isOperational(c.config))
    .map((contract) => ({ contract, cfg: requireOperational(contract.config) }));
}
async function chooseContract(ctx: Ctx, contractId?: string): Promise<Chosen | null> {
  const all = await builderContracts(ctx);
  return (contractId ? all.find((c) => c.contract.id === contractId) : all[0]) ?? null;
}
const contractLabel = (c: Contract) => `${c.contractNumber} ${c.name}`.trim();
const customerSharing = (cfg: OperationalConfig) => cfg.customerVisibility.seesIndividualReports === true;
const monthsFor = (ctx: Ctx, c: Contract) => {
  const out: { value: string; label: string }[] = [];
  for (let mk = monthKey(ctx.now()); mk >= monthKey(c.startsOn); mk = addMonths(mk, -1)) out.push({ value: mk, label: monthName(mk) });
  return out;
};

// ---------------------------------------------------------------- Den sparade rapporten eller utkastet
type Target = Chosen & { saved: SavedReport | null; def: ReportDefinition; templateKey: string | null; title: string };
type TargetInput = { contractId?: string; savedReportId?: string; definition?: Record<string, unknown>; templateKey?: string };
type TargetFail = { fail: "not_found" | "definition"; message: string };

/**
 * Rapporten att köra: den sparade raden (via ctx.repo – inte arkiverad; avtalet följer raden och ett annat contractId ger
 * not_found) eller utkastet med contractId. Definitionen valideras med zod.
 */
async function target(ctx: Ctx, p: TargetInput): Promise<Target | TargetFail> {
  if (p.savedReportId) {
    const saved = await ctx.repo.table("saved_reports").get(p.savedReportId);
    if (!saved || saved.archivedAt || (p.contractId && p.contractId !== saved.contractId)) return { fail: "not_found", message: NOT_FOUND };
    const chosen = await chooseContract(ctx, saved.contractId);
    if (!chosen) return { fail: "not_found", message: NOT_FOUND };
    const parsed = ReportDefinitionSchema.safeParse(saved.definition);
    if (!parsed.success) return { fail: "definition", message: parsed.error.issues[0]?.message ?? "Rapporten är inte giltig." };
    const tpl = templateFor(saved.templateKey);
    return { ...chosen, saved, def: parsed.data, templateKey: tpl?.key ?? null, title: saved.title };
  }
  const chosen = await chooseContract(ctx, p.contractId);
  if (!chosen) return { fail: "not_found", message: NO_CONTRACT };
  const parsed = ReportDefinitionSchema.safeParse(p.definition);
  if (!parsed.success) return { fail: "definition", message: parsed.error.issues[0]?.message ?? "Rapporten är inte giltig." };
  const tpl = templateFor(p.templateKey);
  return { ...chosen, saved: null, def: parsed.data, templateKey: tpl?.key ?? null, title: tpl?.name ?? "Ny rapport" };
}
const isFail = (t: Target | TargetFail): t is TargetFail => "fail" in t;

// ================================================================ Katalogen
handleQuery(builderCatalog, { roles: BUILDERS }, async (ctx, p): Promise<BuilderCatalog> => {
  const all = await builderContracts(ctx);
  const chosen = (p.contractId ? all.find((c) => c.contract.id === p.contractId) : null) ?? all[0] ?? null;
  const base: BuilderCatalog = {
    contracts: all.map((c) => ({ id: c.contract.id, label: contractLabel(c.contract) })), contractId: chosen?.contract.id ?? null,
    templates: TEMPLATES.map((t) => ({ key: t.key, name: t.name, sentence: templateSentence(t, chosen ? { resultReasons: resultReasons(chosen.cfg) } : null), definition: t.definition as unknown as Record<string, unknown> })),
    datasets: [], months: [], maxMonths: MAX_EXPORT_MONTHS, minN: 0, canShareWithCustomer: false, customerSharingAllowed: false, role: ctx.actor.role,
  };
  if (!chosen) return base;
  const { contract, cfg } = chosen;
  const areas = await ctx.repo.table("contract_areas").list({ contractId: contract.id });
  const env = { cfg, areas };
  const register = exportColumns(cfg, areas);
  const allowed = customerSharing(cfg);
  return {
    ...base,
    months: monthsFor(ctx, contract),
    minN: cfg.pulse.minNForAggregate,
    customerSharingAllowed: allowed,
    canShareWithCustomer: allowed && ctx.actor.role === "avtalsansvarig",
    datasets: DATASETS.map((ds) => ({
      key: ds, label: DATASET_LABEL[ds], help: DATASET_HELP[ds],
      dimensions: datasetDimensions(ds).map((d) => ({ key: d, label: DIMENSION_LABEL[d], joined: DATASET_DIMENSIONS[ds].joined.includes(d), choices: dimensionChoices(d, env) })),
      measures: measuresFor(ds).map((m) => ({
        key: m.key, label: m.label, help: m.help(cfg), columns: m.columns(cfg).map((c) => ({ key: c.key, label: c.label, unit: c.unit })),
        chartable: !MULTI_COLUMN_MEASURES.includes(m.key),
      })),
      columns: tableColumns(register, DATASET_TABLE[ds]).map((c) => {
        const rule = columnRule(c.table, c.key);
        return { qualified: `${c.table}.${c.key}`, key: c.key, description: plainText(c.description), section: rule?.section ?? "Rapporten", cls: rule?.class ?? "fakta" };
      }),
    })),
  };
});

// ================================================================ Förhandsvisningen (tyst kommando)
handleCommand(builderPreview, { roles: BUILDERS, silent: true }, async (ctx, p) => {
  const t = await target(ctx, p);
  if (isFail(t)) return fail(t.fail, t.message);
  // "Visa som kommunens chef ser den" bara när avtalet låter kommunens chef se individrapporter.
  const audience = p.audience === "kommun" && customerSharing(t.cfg) ? "kommun" : "mb";
  // En sparad rapport som visas loggas (beslut 12) – ett osparat utkast inte.
  if (t.saved) await ctx.audit({ action: "saved_report.viewed", entity: "saved_report", entityId: t.saved.id, contractId: t.contract.id, details: { audience } });
  const run = await runPipeline(ctx, { contract: t.contract, cfg: t.cfg, def: t.def, rule: "mb", audience, title: t.title });
  if (!run.ok) return fail(run.error, run.message);
  return ok(run.view);
});

// ================================================================ Exporten (tyst kommando)
handleCommand(builderExport, { roles: BUILDERS, silent: true }, async (ctx, p) => {
  // 1. Spärr: den sparade rapporten (inte arkiverad), avtalet från den, definitionen och perioden.
  const t = await target(ctx, p);
  if (isFail(t)) return fail(t.fail, t.message);
  const entity = t.saved ? { entity: "saved_report", entityId: t.saved.id } : { entity: "contract", entityId: t.contract.id };
  // 2–5. Urval, fakta, motorn och kolumnkontrollen.
  const run = await runPipeline(ctx, { contract: t.contract, cfg: t.cfg, def: t.def, rule: "mb", audience: "mb", title: t.title });
  if (!run.ok) {
    if (run.error === "column_missing") {
      await ctx.audit({ action: "saved_report.export_blocked", ...entity, contractId: t.contract.id, details: { savedReportId: t.saved?.id ?? null, reason: "column_missing", column: run.column } });
    }
    return fail(run.error, run.message);
  }
  const file = await builderFile(run, { def: t.def, format: p.format, templateKey: t.templateKey, title: t.title, now: ctx.now(), cfg: t.cfg, contract: t.contract });
  if (!file.ok) {
    if (file.error === "too_large") {
      await ctx.audit({ action: "saved_report.export_blocked", ...entity, contractId: t.contract.id, details: { savedReportId: t.saved?.id ?? null, reason: "too_large" } });
    }
    return fail(file.error, file.message);
  }
  // 6. Logga innan svaret (filen eller PDF-modellen). Kastar loggningen lämnas ingenting ut.
  const rows = file.kind === "file" ? file.rows : (run.view.table ? run.view.table.rows.length + 1 : 0);
  await ctx.audit({
    action: "export.saved_report", ...entity, contractId: t.contract.id,
    details: exportDetails(run, { def: t.def, savedReportId: t.saved?.id ?? null, templateKey: t.templateKey, audience: "mb", format: p.format, rows }),
  });
  // 7. Svara
  if (file.kind === "pdf") return ok({ filename: file.filename, pdf: file.pdf });
  return ok({ filename: file.filename, mime: file.mime, encoding: file.encoding, content: file.content, rows: file.rows, cases: run.view.counts.cases });
});

// ================================================================ Listorna
const savedRow = (r: SavedReport, mine: boolean, names: Map<string, string>): SavedReportRow => {
  const def = ReportDefinitionSchema.safeParse(r.definition);
  const d = def.success ? def.data : null;
  const dateText = r.updatedAt ? `Ändrad ${dFull(r.updatedAt)}` : r.sharedAt && r.visibility !== "private" ? `Delad ${dFull(r.sharedAt)}` : `Skapad ${dFull(r.createdAt)}`;
  return {
    id: r.id, title: r.title, outputLabel: d ? (d.output === "lista" ? "Lista" : OUTPUT_LABEL.sammanstallning) : "Behöver ändras",
    datasetLabel: d ? DATASET_LABEL[d.dataset] : "", periodText: d ? periodDefText(d.period) : "", visibility: r.visibility,
    createdBy: mine ? null : `Skapad av ${names.get(r.ownerId) ?? "–"}`, dateText,
  };
};
const newest = (r: SavedReport) => r.updatedAt ?? r.sharedAt ?? r.createdAt;

handleQuery(savedReportList, { roles: BUILDERS }, async (ctx, p) => {
  const chosen = await chooseContract(ctx, p.contractId);
  if (!chosen) return { contractId: null, mine: [], sharedMb: [], sharedCustomer: [] };
  const rows = (await ctx.repo.table("saved_reports").list({ contractId: chosen.contract.id, archivedAt: null }))
    .sort((a, b) => (newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : a.id < b.id ? -1 : 1));
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const profiles = ownerIds.length ? await ctx.repo.table("profiles").list({ id: { in: ownerIds } }) : [];
  const names = new Map(profiles.map((x) => [x.id, x.fullName]));
  const me = ctx.actor.userId;
  return {
    contractId: chosen.contract.id,
    mine: rows.filter((r) => r.ownerId === me && r.visibility !== "customer").map((r) => savedRow(r, true, names)),
    sharedMb: rows.filter((r) => r.ownerId !== me && r.visibility === "mb").map((r) => savedRow(r, false, names)),
    sharedCustomer: rows.filter((r) => r.visibility === "customer").map((r) => savedRow(r, r.ownerId === me, names)),
  };
});

// ================================================================ En sparad rapport
/** Raden är delad med kommunen, men avtalet tillåter inte längre att rapporter delas med kommunen. */
const customerSharingEnded = (r: SavedReport, cfg: OperationalConfig) => r.visibility === "customer" && !customerSharing(cfg);

/** Vad läsaren får göra med raden – samma regler som policyn/RLS (savedReportWrite, 0021). */
function rights(r: SavedReport, ctx: Ctx, cfg: OperationalConfig) {
  const role = ctx.actor.role;
  const isOwner = r.ownerId === ctx.actor.userId;
  const open = !r.archivedAt && (r.visibility !== "customer" || role === "avtalsansvarig");
  const avtalsansvarig = role === "avtalsansvarig";
  const sharingAllowed = customerSharing(cfg);
  // Delad med kommunen men avtalet tillåter det inte längre: varje ändring där raden förblir 'customer' nekas (with check i
  // 0021, customerOk i policy.ts). Bara att sluta dela (till mb eller privat) går – ändra och arkivera kommer efter det.
  const sharingEnded = customerSharingEnded(r, cfg);
  return {
    isOwner,
    sharingEnded,
    canEdit: open && isOwner && !sharingEnded,
    canChangeSharing: open && isOwner,
    // Avtalsansvarig: "Dela med kommunen" (bara när avtalet tillåter det) / "Sluta dela med kommunen" (alltid) – egna rapporter
    // och andras som inte är privata.
    canShareCustomer: open && avtalsansvarig && (isOwner || r.visibility !== "private") && (sharingAllowed || r.visibility === "customer"),
    canArchive: open && !sharingEnded && (isOwner || (avtalsansvarig && r.visibility !== "private")),
    canChooseCustomer: avtalsansvarig && sharingAllowed,
  };
}

handleQuery(savedReport, { roles: BUILDERS }, async (ctx, p) => {
  const r = await ctx.repo.table("saved_reports").get(p.savedReportId);
  const chosen = r ? await chooseContract(ctx, r.contractId) : null;
  if (!r || !chosen) return { found: false as const };
  const owner = await ctx.repo.table("profiles").get(r.ownerId);
  const parsed = ReportDefinitionSchema.safeParse(r.definition);
  const d = parsed.success ? parsed.data : null;
  const can = rights(r, ctx, chosen.cfg);
  const tpl = templateFor(r.templateKey);
  const avtalsansvarig = ctx.actor.role === "avtalsansvarig";
  const lockedText = r.archivedAt ? null
    : r.visibility === "customer" && !avtalsansvarig ? (can.isOwner ? CUSTOMER_SHARED_OWNER : CUSTOMER_SHARED)
    : can.sharingEnded ? (can.isOwner ? SHARING_ENDED_OWNER : SHARING_ENDED)
    : !can.isOwner ? (avtalsansvarig && r.visibility !== "private" ? NOT_OWNER : COPY_TO_CHANGE) : null;
  return {
    found: true as const, id: r.id, contractId: r.contractId, title: r.title, templateKey: tpl?.key ?? null, templateName: tpl?.name ?? null,
    definition: r.definition, definitionError: parsed.success ? null : (parsed.error.issues[0]?.message ?? "Rapporten är inte giltig."),
    datasetLabel: d ? DATASET_LABEL[d.dataset] : "", outputLabel: d ? OUTPUT_LABEL[d.output] : "", periodText: d ? periodDefText(d.period) : "",
    visibility: r.visibility, createdBy: owner?.fullName ?? "–", createdAt: r.createdAt, updatedAt: r.updatedAt, sharedAt: r.sharedAt, archived: !!r.archivedAt,
    ...can, customerSharingAllowed: customerSharing(chosen.cfg), minN: chosen.cfg.pulse.minNForAggregate, lockedText,
  };
});

// ================================================================ Spara, dela, arkivera
handleCommand(savedReportSave, { roles: BUILDERS }, async (ctx, p) => {
  const title = TitleSchema.safeParse(p.title);
  if (!title.success) return fail("title", title.error.issues[0]?.message ?? "Namnet är inte giltigt.");
  const parsed = ReportDefinitionSchema.safeParse(p.definition);
  if (!parsed.success) return fail("definition", parsed.error.issues[0]?.message ?? "Rapporten är inte giltig.");
  const definition = parsed.data as unknown as Record<string, unknown>;
  const now = ctx.now();
  const me = ctx.actor.userId;
  const table = ctx.repo.table("saved_reports");
  if (!p.savedReportId) {
    const chosen = await chooseContract(ctx, p.contractId);
    if (!chosen) return fail("forbidden", NO_CONTRACT);
    const visibility: SavedReportVisibility = p.visibility ?? "private";
    if (visibility === "customer") {
      if (ctx.actor.role !== "avtalsansvarig") return fail("forbidden", ONLY_AVTALSANSVARIG);
      if (!customerSharing(chosen.cfg)) return fail("forbidden", CONTRACT_NO_SHARING);
    }
    const id = ctx.newId("sr");
    const shared = visibility !== "private";
    await table.insert({
      id, contractId: chosen.contract.id, ownerId: me, title: title.data, templateKey: p.templateKey ?? null, definition, visibility, createdAt: now,
      updatedAt: null, updatedBy: null, sharedAt: shared ? now : null, sharedBy: shared ? me : null, archivedAt: null, archivedBy: null,
    });
    await ctx.audit({ action: "saved_report.created", entity: "saved_report", entityId: id, contractId: chosen.contract.id, details: { visibility, template: p.templateKey ?? null } });
    // Delningen loggas för sig, så att "Ändrade delning av rapport" syns även när rapporten delas redan när den sparas.
    if (shared) await ctx.audit({ action: "saved_report.shared", entity: "saved_report", entityId: id, contractId: chosen.contract.id, details: { sharingFrom: null, sharingTo: visibility } });
    return ok({ savedReportId: id });
  }
  const r = await table.get(p.savedReportId);
  if (!r || r.archivedAt || r.contractId !== p.contractId) return fail("forbidden", FORBIDDEN);
  if (r.visibility === "customer" && ctx.actor.role !== "avtalsansvarig") return fail("customer_shared", r.ownerId === me ? CUSTOMER_SHARED_OWNER : CUSTOMER_SHARED);
  if (r.ownerId !== me) return fail("forbidden", NOT_OWNER);
  if (r.visibility === "customer") {
    const chosen = await chooseContract(ctx, r.contractId);
    if (!chosen) return fail("forbidden", FORBIDDEN);
    if (customerSharingEnded(r, chosen.cfg)) return fail("customer_shared", SHARING_ENDED_OWNER);
  }
  // Oförändrat: ingen skrivning och ingen loggrad (en tom ändring stoppas av triggern och policyn).
  const fields: ("title" | "definition")[] = [];
  if (title.data !== r.title) fields.push("title");
  if (canonicalJson(definition) !== canonicalJson(r.definition)) fields.push("definition");
  if (!fields.length) return ok({ savedReportId: r.id });
  await table.update(r.id, { title: title.data, definition, updatedAt: now, updatedBy: me });
  await ctx.audit({ action: "saved_report.updated", entity: "saved_report", entityId: r.id, contractId: r.contractId, details: { fields } });
  return ok({ savedReportId: r.id });
});

handleCommand(savedReportShare, { roles: BUILDERS }, async (ctx, p) => {
  const table = ctx.repo.table("saved_reports");
  const r = await table.get(p.savedReportId);
  if (!r || r.archivedAt) return fail("forbidden", FORBIDDEN);
  if (r.visibility === p.visibility) return ok({});
  const chosen = await chooseContract(ctx, r.contractId);
  if (!chosen) return fail("forbidden", FORBIDDEN);
  const role = ctx.actor.role;
  const me = ctx.actor.userId;
  if (p.visibility === "customer") {
    if (role !== "avtalsansvarig") return fail("not_allowed", ONLY_AVTALSANSVARIG);
    if (!customerSharing(chosen.cfg)) return fail("not_allowed", CONTRACT_NO_SHARING);
  }
  // Samma regler som 0021: ägaren, eller avtalsansvarig när raden inte är privat; en rad delad med kommunen ändras bara av
  // avtalsansvarig; avtalsansvarig gör aldrig någon annans rapport privat.
  const isOwner = r.ownerId === me;
  if (!isOwner && !(role === "avtalsansvarig" && r.visibility !== "private")) return fail("forbidden", FORBIDDEN);
  if (r.visibility === "customer" && role !== "avtalsansvarig") return fail("forbidden", isOwner ? CUSTOMER_SHARED_OWNER : CUSTOMER_SHARED);
  if (!isOwner && p.visibility === "private") return fail("forbidden", FORBIDDEN);
  await table.update(r.id, { visibility: p.visibility, sharedAt: ctx.now(), sharedBy: me });
  await ctx.audit({ action: "saved_report.shared", entity: "saved_report", entityId: r.id, contractId: r.contractId, details: { sharingFrom: r.visibility, sharingTo: p.visibility } });
  return ok({});
});

handleCommand(savedReportArchive, { roles: BUILDERS }, async (ctx, p) => {
  const table = ctx.repo.table("saved_reports");
  const r = await table.get(p.savedReportId);
  if (!r || r.archivedAt) return fail("forbidden", FORBIDDEN);
  const chosen = await chooseContract(ctx, r.contractId);
  if (!chosen) return fail("forbidden", FORBIDDEN);
  const can = rights(r, ctx, chosen.cfg);
  if (!can.canArchive) {
    const text = can.sharingEnded && ctx.actor.role === "avtalsansvarig" ? (can.isOwner ? SHARING_ENDED_OWNER : SHARING_ENDED)
      : r.visibility === "customer" ? (can.isOwner ? CUSTOMER_SHARED_OWNER : CUSTOMER_SHARED) : FORBIDDEN;
    return fail("forbidden", text);
  }
  await table.update(r.id, { archivedAt: ctx.now(), archivedBy: ctx.actor.userId });
  await ctx.audit({ action: "saved_report.archived", entity: "saved_report", entityId: r.id, contractId: r.contractId, details: {} });
  return ok({});
});

// ================================================================ Resultatfil för hela avtalet (färdigrapporten)
const periodOpts = (ctx: Ctx, contract: Contract) => ({ current: monthKey(ctx.now()), start: monthKey(contract.startsOn), maxMonths: MAX_EXPORT_MONTHS });

handleQuery(contractResultPreview, { roles: BUILDERS }, async (ctx, p): Promise<ContractResultPreview> => {
  const all = await builderContracts(ctx);
  const chosen = (p.contractId ? all.find((c) => c.contract.id === p.contractId) : null) ?? all[0] ?? null;
  const contracts = all.map((c) => ({ id: c.contract.id, label: contractLabel(c.contract) }));
  if (!chosen) return { allowed: false, contractId: null, contracts, months: [], from: "", to: "", periodLabel: "", periodError: null, maxMonths: MAX_EXPORT_MONTHS, participants: 0, reports: 0 };
  const { contract, cfg } = chosen;
  const opts = periodOpts(ctx, contract);
  const prev = addMonths(opts.current, -1);
  const def = prev >= opts.start ? prev : opts.current;
  const from = p.from ?? def;
  const to = p.to ?? p.from ?? def;
  const err = periodError(from, to, opts);
  // Samma urval som exporten (regeln "mb": alla ärenden i avtalet utom skyddade) – bara antal, inga namn.
  const sel = err ? null : await selectDelivered(ctx, { contractId: contract.id, cfg, from, to, rule: "mb", finals: false });
  return {
    allowed: true, contractId: contract.id, contracts, months: monthsFor(ctx, contract), from, to, periodLabel: periodLabel(from, to), periodError: err,
    maxMonths: MAX_EXPORT_MONTHS, participants: sel ? new Set(sel.monthly.map((r) => r.caseId)).size : 0, reports: sel ? sel.monthly.length : 0,
  };
});

/** "resultat_bot_hela-avtalet_2026-10_2026-12.xlsx" – CSV med tabellens namn sist (som steg 3). */
export const wholeContractFilename = (casePrefix: string, from: string, to: string, format: "xlsx" | "csv", table: Parameters<typeof resultFilename>[4] = "resultat") =>
  resultFilename(casePrefix, from, to, format, table).replace(/^resultat_([a-z0-9]+)_/, "resultat_$1_hela-avtalet_");

handleCommand(contractResultExport, { roles: BUILDERS, silent: true }, async (ctx, p) => {
  // 1. Spärr: avtalet (i drift, läsaren är medlem) och perioden.
  const chosen = await chooseContract(ctx, p.contractId);
  if (!chosen) return fail("forbidden", NO_CONTRACT);
  const { contract, cfg } = chosen;
  const err = periodError(p.from, p.to, periodOpts(ctx, contract));
  if (err) return fail("period", err);
  const table = p.format === "xlsx" ? "resultat" : (p.table ?? "resultat");
  // 2. Urval (alla ärenden i avtalet utom skyddade), 3. frysning, 5. raderna och filen. Ingen kolumnspärr (den gäller kommunens fil).
  const sel = await selectDelivered(ctx, { contractId: contract.id, cfg, from: p.from, to: p.to, rule: "mb", finals: true });
  if (!sel.monthly.length) return fail("empty", EMPTY_RESULT);
  const info = await contractInfo(ctx, contract.id);
  const rf = await loadResultFacts(ctx, sel, info);
  const areas = await ctx.repo.table("contract_areas").list({ contractId: contract.id });
  const exp = resultExportFor(sel, rf, { cfg, areas, from: p.from, to: p.to, now: ctx.now() });
  const file = await resultFileContent(exp, cfg, p.format, table, { contractNumber: contract.contractNumber, customerName: info.customerName });
  const filename = wholeContractFilename(cfg.casePrefix, p.from, p.to, p.format, table);
  const register = exportColumns(cfg, areas);
  const columns = p.format === "xlsx" ? register.map((c) => `${c.table}.${c.key}`) : table === "faltbeskrivning" ? [] : tableColumns(register, table).map((c) => `${c.table}.${c.key}`);
  // 6. Logga innan filen lämnas ut – export.results_mb (aldrig export.results, så kommunens kolumnspärr påverkas inte).
  await ctx.audit({
    action: "export.results_mb", entity: "contract", entityId: contract.id, contractId: contract.id,
    details: {
      from: p.from, to: p.to, format: p.format, table: p.format === "xlsx" ? "alla" : table, rows: file.rows, cases: exp.meta.cases, schema: exp.meta.schema, columns,
      ...(p.format === "xlsx" ? { reportIds: exp.meta.reportIds } : table === "faltbeskrivning" ? {} : { reportIds: exp.meta.tableReportIds[table] }),
    },
  });
  return ok({ filename, mime: file.mime, encoding: file.encoding, content: file.content, rows: file.rows, cases: exp.meta.cases });
});
