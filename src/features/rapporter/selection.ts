// Urvalet av levererade rapporter för resultatfilen (steg 3) och rapportbyggaren (steg 4). Bara för hanterare.
//
// Samma urval för förhandsvisning och export, så att antalen stämmer:
//   - levererade, inte ersatta månadsrapporter i perioden (deliveredOk), och slutrapporter för insatser som avslutades i perioden
//   - via ctx.repo (policyn/RLS) – sedan regeln för åtkomsten (AccessRule):
//       mb        Miljonbemanning (samordnare, avtalsansvarig, chef): åtkomst "full", INTE skyddade personuppgifter (också
//                 avtalsansvarig, som har full åtkomst i skyddade ärenden – spärren är vilande sedan 2026-10-07) och reportAccess
//     Regeln "customer" (kommunens chef hämtade resultatfilen själv) är borttagen med rollen (beslut 2026-10-07).
//   - bara den senaste levererade versionen per ärende och månad (slutrapporten: per ärende)
//   - joinMonthly (datamängden avslut i byggaren): ärendets senaste levererade månadsrapport (månad <= to) för varje slutrapport
//
// Fakta (loadBuilderFacts) läses med Table.pickJson – bara fakta, aldrig ögonblicksbildernas modeller. Bara rapporter utan frysta
// fakta läses hela och fryses (ensureFactsMany, systemsteg som i steg 3). Därför körs rapportbyggarens förhandsvisning som ett
// tyst kommando: frågor räknar aldrig fram fakta.
import type { Ctx } from "@/api/server";
import type { OperationalConfig } from "@/core/config";
import { monthEnd, type MonthKey } from "@/core/time";
import type { Case, Report } from "@/data/schema";
import { latestVersions } from "./export";
import type { ReportFacts } from "./facts";
import { ensureFactsMany, FACTS_JSON, factsFromPick } from "./freeze";
import { reportAccess, viewerFor, type ContractInfo, type Viewer } from "./load";
import { deliveredOk } from "./report-helpers";

/** Fälten som urvalet behöver (deliveredOk, reportAccess, versionerna) – inte ögonblicksbilden. */
export const LIGHT = ["contractId", "caseId", "kind", "month", "periodEnd", "status", "deliveredAt", "deliveredTo", "recipientUserId", "superseded", "version", "previousId", "correctionPending"] as const;
export type LightReport = Pick<Report, (typeof LIGHT)[number] | "id">;

export type Selection<R> = { monthly: R[]; finals: R[]; cases: Map<string, Case>; viewer: Viewer; dropped: string[] };
export type AccessRule = "mb";

export type SelectParams = {
  contractId: string;
  cfg: OperationalConfig;
  from: MonthKey;
  to: MonthKey;
  rule: AccessRule;
  /** Slutrapporter för insatser som avslutades i perioden (periodEnd = avslutsdagen). */
  finals: boolean;
  /** Ärendets senaste levererade månadsrapport (månad <= to) för varje slutrapport i urvalet (datamängden avslut). */
  latestMonthlyForFinals?: boolean;
};

/** Får läsaren se rapporten enligt regeln? */
export function ruleAllows(rule: AccessRule, r: LightReport, c: Case | undefined, viewer: Viewer): boolean {
  if (!c || rule !== "mb") return false;
  return viewer.access(c) === "full" && !viewer.isProtected(c) && reportAccess(r, c, viewer).ok;
}

/** Urvalet (steg 2 i exporten) – samma för förhandsvisningen och exporten. Läser bara LIGHT-fälten. */
export async function selectDelivered(ctx: Ctx, p: SelectParams): Promise<Selection<LightReport> & { joinMonthly: LightReport[] }> {
  const { contractId, from, to } = p;
  const reports = ctx.repo.table("reports");
  const [monthlyAll, finalsAll] = await Promise.all([
    reports.pick(LIGHT, { contractId, kind: "monthly", month: { gte: from, lte: to } }),
    p.finals ? reports.pick(LIGHT, { contractId, kind: "final", periodEnd: { gte: `${from}-01`, lte: monthEnd(to) } }) : Promise.resolve([] as LightReport[]),
  ]);
  const delivered = monthlyAll.filter((r) => deliveredOk(r));
  const deliveredFinals = finalsAll.filter((r) => deliveredOk(r));
  // joinMonthly: månadsrapporter före perioden för slutrapporternas ärenden (de i perioden finns redan i monthlyAll).
  const finalCaseIds = [...new Set(deliveredFinals.map((r) => r.caseId).filter((x): x is string => !!x))];
  const earlier = p.latestMonthlyForFinals && finalCaseIds.length
    ? (await reports.pick(LIGHT, { contractId, kind: "monthly", caseId: { in: finalCaseIds }, month: { lt: from } })).filter((r) => deliveredOk(r))
    : [];
  const caseIds = [...new Set([...delivered, ...deliveredFinals].map((r) => r.caseId).filter((x): x is string => !!x))];
  const cases = caseIds.length ? await ctx.repo.table("cases").list({ id: { in: caseIds } }) : [];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const viewer = await viewerFor(ctx, cases);
  const visible = (r: LightReport) => ruleAllows(p.rule, r, r.caseId ? byId.get(r.caseId) : undefined, viewer);
  // Bara den senaste levererade versionen per ärende och månad (slutrapporten: per ärende) – aldrig två rader med samma nyckel.
  const m = latestVersions(delivered.filter(visible));
  const f = latestVersions(deliveredFinals.filter(visible));
  let joinMonthly: LightReport[] = [];
  if (p.latestMonthlyForFinals) {
    const candidates = latestVersions([...delivered, ...earlier].filter(visible)).kept;
    const best = new Map<string, LightReport>();
    for (const r of candidates) {
      const cur = best.get(r.caseId as string);
      if (!cur || (r.month ?? "") > (cur.month ?? "")) best.set(r.caseId as string, r);
    }
    joinMonthly = f.kept.map((fin) => best.get(fin.caseId as string)).filter((r): r is LightReport => !!r);
  }
  return { monthly: m.kept, finals: f.kept, cases: byId, viewer, dropped: [...m.dropped, ...f.dropped].map((r) => r.id), joinMonthly };
}

/**
 * Fakta för urvalets rapporter (och joinMonthly): läses med pickJson (bara snapshot.facts – inte modellerna). Bara rapporter
 * utan giltiga frysta fakta läses hela och fryses med ensureFactsMany (systemsteg, som steg 3:s export). Bara kommandon får
 * anropa den. Returnerar fakta per rapport-id (null = rapporten har inga fakta).
 */
export async function loadBuilderFacts(ctx: Ctx, reports: readonly LightReport[], info: ContractInfo): Promise<Map<string, ReportFacts | null>> {
  const ids = [...new Set(reports.map((r) => r.id))];
  const out = new Map<string, ReportFacts | null>();
  if (!ids.length) return out;
  const table = ctx.repo.table("reports");
  const picked = await table.pickJson(["kind"], FACTS_JSON, { id: { in: ids } });
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const r of picked) {
    seen.add(r.id);
    const f = factsFromPick(r);
    if (f) out.set(r.id, f);
    else missing.push(r.id);
  }
  for (const id of ids) if (!seen.has(id)) out.set(id, null);
  if (missing.length) {
    const full = await table.list({ id: { in: missing } });
    const frozen = await ensureFactsMany(ctx, full, info);
    for (const id of missing) out.set(id, frozen.get(id) ?? null);
  }
  return out;
}
