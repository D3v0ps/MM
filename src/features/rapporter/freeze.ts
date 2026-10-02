// Frysning av en levererad rapport (prototypens rap.snapshot). Bara för hanterare – importeras aldrig av skärmar.
//
// Används av kommandot rapporter.snapshot och kan anropas av andra hanterare direkt efter att de levererat en rapport,
// t.ex. när veckorapporten publiceras automatiskt vid närvaroregistreringen (src/features/_shared/weekly.ts):
//   await freezeReport(ctx, reportId);
// ctx.system: frysningen är ett systemsteg – underlaget läses och ögonblicksbilden skrivs oavsett vem som levererade.
import type { Ctx } from "@/api/server";
import type { Report } from "@/data/schema";
import { contractInfo, loadReportDb } from "./load";
import { frozenModel, hasDocument, hasSnapshot } from "./model";
import { isDelivered } from "./report-helpers";

/** Spara innehållet som gällde vid leveransen. Returnerar true om rapporten frystes nu (false: inte levererad, redan fryst). */
export async function freezeReport(ctx: Ctx, reportOrId: Report | string): Promise<boolean> {
  const r = typeof reportOrId === "string" ? await ctx.system.table("reports").get(reportOrId) : reportOrId;
  if (!r || !isDelivered(r) || !hasDocument(r.kind) || hasSnapshot(r)) return false;
  const info = await contractInfo(ctx, r.contractId);
  const db = await loadReportDb(ctx, r, info);
  const m = frozenModel(db, r, { ...info.env, now: ctx.now() });
  if (!m) return false;
  await ctx.system.table("reports").update(r.id, { snapshot: { reportId: r.id, takenAt: ctx.now(), deliveredAt: r.deliveredAt, model: JSON.parse(JSON.stringify(m)) } });
  return true;
}
