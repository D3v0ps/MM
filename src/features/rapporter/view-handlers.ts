// Hanterare för rapporternas frågor och egna kommandon (prototypens rapporter.lista, rapport.visa och rap.*).
// Registreras via handlers.ts – importeras aldrig av skärmar. Datainläsning och behörighet: load.ts (med kommentarer
// om när ctx.system används).
import { fail, ok } from "@/api/contract";
import { isCustomerRole, type Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { hidesCommercial } from "@/api/tester-access";
import { isOperational, progressionRuleText, type OperationalConfig } from "@/core/config";
import { plural } from "@/core/format";
import { personName, reportKindLabel } from "@/core/labels";
import { slaStatus } from "@/core/sla";
import { addDays, dayOf, fmtDateTime, fmtDateTimeLong, fmtTime, fmtWeekday, fmtWeekRange, monday, monthKey, monthName, addMonths, WEEKDAYS, type LocalDateTime } from "@/core/time";
import { weeklyReport } from "@/core/weekly-report";
import type { Case, MonthlyAssessment, Profile, Report } from "@/data/schema";
import { weeklyComplete } from "../_shared/weekly";
import {
  reportCorrectionNote, reportDocument, reportDownload, reportList, reportQualityReview, reportSaveFinal, reportSaveSummary, reportSnapshot, reportView,
  type OrderDocModel, type PortalReportInfo, type ReportDocResult, type ReportDocView, type ReportList, type ReportListRow, type ReportVersion, type ReportView, type ReportViewDenied, type WeeklyDocSection,
} from "./api";
import { docBase, monthlyDocView } from "./doc-view";
import { freezeReport } from "./freeze";
import { contractInfo, loadReportDb, pendingCorrection, recipientOf, reportAccess, versionChain, viewerFor, type ContractInfo, type Viewer } from "./load";
import {
  driftedSinceDelivery, hasDocument, hasSnapshot, lastApprovedCheckIn, obstaclesText, personWithUnit, reportModel, summaryFromNumbers,
  type OrderModel, type ReportModel, type SummaryModel,
} from "./model";
import { DENIED, effStatus, isDelivered, lifecycleIndex, periodText, REPORT_LIST_KINDS, reportFilename, reportTitle, statusLabel, ucfirst, wdFull } from "./report-helpers";

const LIST_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "chef"];
const MB_VIEW_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef"];
const VIEW_ROLES: readonly Role[] = [...MB_VIEW_ROLES, "kommun_handlaggare"];
const NOT_FOUND = "Rapporten finns inte, eller så har du inte behörighet att se den.";

// ================================================================ Gemensamt
type Step = { key: string; label: string };
const hasRecommendation = (r: Report) => !!(r.finalText && String(r.finalText.recommendation || "").trim());
const isProvisional = (r: Report) => !!r.provisionalDue || r.kind === "customer_summary";
const isOverdue = (r: Report, now: LocalDateTime) => !isDelivered(r) && !r.superseded && !!r.dueAt && r.dueAt < now;
const weekEndOf = (now: LocalDateTime) => `${addDays(monday(dayOf(now)), 6)}T23:59`;
const dueThisWeek = (r: Report, now: LocalDateTime) => !isDelivered(r) && !r.superseded && !!r.dueAt && r.dueAt >= now && r.dueAt <= weekEndOf(now);

/** Förklaring till en förfallotid som inte är fastställd med kommunen (läses från avtalskonfigurationen). */
function provisionalText(r: Report, cfg: OperationalConfig, customerName: string): string {
  const key = r.kind === "monthly" ? "manadsrapport" : r.kind === "final" ? "slutrapport" : null;
  const rule = key ? cfg.sla.find((s) => s.key === key) : null;
  const raw = rule ? String(rule.due || (typeof rule.within === "string" ? rule.within : "") || "") : "";
  const m = raw.match(/\(([^)]*)\)/);
  const base = `Sista dagen är inte fastställd med ${customerName}.`;
  return m ? `${base} Tills vidare gäller ${m[1]}.` : `${base} Förfallotiden är ett förslag.`;
}

/** Vad är nästa steg för rapporten? (prototypens nextStep) */
function nextStep(r: Report, ma: MonthlyAssessment | null, pend: Report | null): Step {
  if (r.superseded) return { key: "superseded", label: "Ersatt av en rättad version" };
  const s = effStatus(r);
  if (isDelivered(r) && pend) return { key: "correcting", label: `Rättas – version ${pend.version} är ett utkast` };
  if (s === "opened") return { key: "done", label: "Mottagaren har öppnat rapporten" };
  // Beställarrapporten lämnas utanför Miljonmatch (beslut 2026-10-07): ingen kvittens att vänta på.
  if (s === "delivered" && r.kind === "customer_summary") return { key: "done", label: "Lämnad till kommunen utanför Miljonmatch" };
  if (s === "delivered") return { key: "unopened", label: "Levererad – inte öppnad än" };
  if (r.kind === "final" && !hasRecommendation(r)) return { key: "blocked", label: "Coachen skriver rekommenderad fortsättning" };
  if (s === "approved") return { key: "deliver", label: r.kind === "customer_summary" ? "Väntar på att lämnas till kommunen" : "Väntar på leverans till kommunen" };
  if (s === "waiting") return { key: "registration", label: "Väntar på närvaroregistrering" };
  if (r.kind === "monthly") {
    if (!ma || ma.status !== "approved") return { key: "blocked", label: "Månadsbedömningen ska godkännas först" };
    return { key: "approval", label: "Väntar på coachens godkännande" };
  }
  if (r.kind === "final") return { key: "approval", label: "Väntar på coachens godkännande" };
  if (r.kind === "customer_summary") return { key: "approval", label: "Väntar på avtalsansvarigs godkännande" };
  return { key: "approval", label: "Väntar på godkännande" };
}

/** Rapporten och ärendet via ctx.system (för att kunna säga varför rapporten inte visas – aldrig innehållet). */
async function reportAndCase(ctx: Ctx, id: string): Promise<{ r: Report; c: Case | null } | null> {
  const r = await ctx.system.table("reports").get(id);
  if (!r || (ctx.actor.role !== "admin" && !ctx.actor.contractIds.includes(r.contractId))) return null;
  const c = r.caseId ? await ctx.system.table("cases").get(r.caseId) : null;
  return { r, c };
}

/** Policyn (RLS i produktion) ska också släppa igenom rapporten – dubbel kontroll av reportAccess. */
const policyAllows = async (ctx: Ctx, id: string) => (await ctx.repo.table("reports").get(id)) !== null;

const monthlyAssessmentOf = async (ctx: Ctx, r: Report): Promise<MonthlyAssessment | null> =>
  r.kind === "monthly" && r.caseId && r.month ? await ctx.system.table("monthly_assessments").first({ caseId: r.caseId, month: r.month }) : null;

// ================================================================ Rapportlistan
handleQuery(reportList, { roles: LIST_ROLES }, async (ctx): Promise<ReportList> => {
  const { role, userId } = ctx.actor;
  const now = ctx.now();
  // Avtalet där rapporterna hanteras (ett nytt avtal i utkast har inga rapporter än).
  const contracts = await ctx.repo.table("contracts").list({ id: { in: ctx.actor.contractIds } });
  const contractId = (contracts.find((c) => isOperational(c.config)) ?? contracts[0])?.id ?? ctx.actor.contractIds[0];
  const info = await contractInfo(ctx, contractId);
  // Ärendena läses via ctx.repo (behörigheten). Rapporterna via ctx.system: listan visar bara rubrik, ärendenummer, status
  // och förfallotid – även för ärenden med skyddade personuppgifter, där namnet inte visas (samma som ärendelistan).
  const [cases, reports, profiles] = await Promise.all([
    ctx.repo.table("cases").list({ contractId }),
    ctx.system.table("reports").list({ contractId }, { orderBy: "id" }),
    ctx.repo.table("profiles").list(),
  ]);
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const viewer = await viewerFor(ctx, cases);
  const myCases = role === "coach" ? cases.filter((c) => c.leadCoachId === userId) : [];
  const hasCaseIn = (r: Report) =>
    myCases.some((c) => c.referrerId === r.recipientUserId && c.startDate && c.startDate <= (r.periodEnd ?? "") && (!c.endDate || c.endDate >= (r.periodStart ?? "")));
  const monthlyCaseIds = [...new Set(reports.filter((r) => r.kind === "monthly" && r.caseId).map((r) => r.caseId as string))];
  // ctx.system: bara månadsbedömningens status (för nästa steg).
  const mas = monthlyCaseIds.length ? await ctx.system.table("monthly_assessments").list({ caseId: { in: monthlyCaseIds } }) : [];
  const maOf = new Map(mas.map((m) => [`${m.caseId}:${m.month}`, m]));
  const repById = new Map(reports.map((r) => [r.id, r]));
  const pendOf = (r: Report) => {
    const nx = r.correctionPending ? repById.get(r.correctionPending) : null;
    return nx && !isDelivered(nx) && !nx.superseded ? nx : null;
  };
  const rows: ReportListRow[] = [];
  for (const r of reports) {
    if (r.superseded || !(REPORT_LIST_KINDS as readonly string[]).includes(r.kind)) continue;
    const c = r.caseId ? caseMap.get(r.caseId) ?? null : null;
    if (r.caseId && !c) continue; // ärendet syns inte för rollen
    if (role === "coach" && (c ? c.leadCoachId !== userId : !(r.kind === "weekly_attendance" && hasCaseIn(r)))) continue;
    if (r.kind === "customer_summary" && role === "coach") continue;
    const who = c ? `${c.caseNumber} · ${viewer.name(c)}` : `Till ${personName(profiles, r.recipientUserId)}`;
    const sub = r.kind === "final" || r.kind === "order_confirmation" ? `${who} · ${periodText(r)}` : r.kind === "weekly_attendance" && r.week ? `${who} · ${fmtWeekRange(r.week)}` : who;
    const title = reportTitle(r);
    const delivered = isDelivered(r);
    const sla = r.dueAt ? slaStatus(r.dueAt, delivered ? r.deliveredAt : null, { now }) : null;
    rows.push({
      id: r.id, kind: r.kind, title, sub, status: r.status, eff: effStatus(r), statusLabel: statusLabel(r),
      next: nextStep(r, r.caseId && r.month ? maOf.get(`${r.caseId}:${r.month}`) ?? null : null, pendOf(r)),
      overdue: isOverdue(r, now), week: dueThisWeek(r, now), delivered, dueAt: r.dueAt, deliveredAt: r.deliveredAt,
      sla: sla ? { label: sla.label, tone: sla.tone } : null,
      dueText: delivered ? `Levererad ${fmtDateTime(r.deliveredAt)}` : sla && sla.tone !== "ok" ? `Förfaller ${fmtDateTime(r.dueAt)}` : null,
      provisional: isProvisional(r) ? provisionalText(r, info.cfg, info.customerName) : null,
      version: r.version || 1, periodStart: r.periodStart, periodEnd: r.periodEnd, search: `${title} ${sub}`.toLowerCase(),
    });
  }
  const months: string[] = [];
  for (let mk = monthKey(now); mk >= monthKey(info.contract.startsOn); mk = addMonths(mk, -1)) months.push(mk);
  return {
    rows, coach: role === "coach", customerName: info.customerName, contractNumber: info.contract.contractNumber, months, weekEnd: weekEndOf(now),
    emailAttachmentAllowed: info.cfg.reportDelivery.emailAttachmentAllowed,
  };
});

// ================================================================ Rapportdokumentet
/** Vy-modellen för dokumentet: modellen plus det läsaren ser (namn, veckorapportens sektioner). */
/**
 * Orderbekräftelsen utan pris och ordervärde för alla läsare (beslut 2026-10-07, synpunkt #10). Efter reportModel(), så att det
 * gäller också frysta rapporter (reports.snapshot) från före beslutet: veckopriset tas bort och omfattningen räknas fram ur veckorna.
 */
function orderDocModel(m: OrderModel & { price?: unknown }): OrderDocModel {
  const { price, ...rest } = m;
  void price;
  return { ...rest, period: rest.period || (rest.weeks ? plural(rest.weeks, "vecka", "veckor") : "Inte angiven") };
}

async function docView(ctx: Ctx, r: Report, c: Case | null, viewer: Viewer, info: ContractInfo, m: ReportModel, profiles: readonly Profile[]): Promise<ReportDocView> {
  const base = docBase(r, info, profiles, m.kind === "weekly_attendance" ? m.recipientUserId : r.recipientUserId);
  switch (m.kind) {
    case "monthly":
      return monthlyDocView(base, viewer.name(c), m);
    case "final":
      return { ...base, kind: "final", participant: viewer.name(c), m };
    case "order_confirmation":
      return { ...base, kind: "order_confirmation", participant: viewer.name(c), m: orderDocModel(m) };
    case "customer_summary":
      return {
        ...base, kind: "customer_summary", m, approver: personName(profiles, r.approvedBy || info.contract.contractManagerId), resultNote: info.cfg.result.prototypeDefinition || "",
        progressionRule: progressionRuleText(info.cfg),
      };
    case "weekly_attendance": {
      const { sections, ...rest } = m;
      // ctx.system: ärendena i rapportens sektioner, för behörigheten per deltagare (namnen läses via ctx.repo i viewerFor).
      const ids = sections.map((s) => s.caseId);
      const cases = ids.length ? await ctx.system.table("cases").list({ id: { in: ids } }) : [];
      const byId = new Map(cases.map((x) => [x.id, x]));
      const v = await viewerFor(ctx, cases);
      const visible: WeeklyDocSection[] = [];
      for (const s of sections) {
        const cs = byId.get(s.caseId);
        const a = v.access(cs);
        if (a === "none") continue;
        visible.push(a === "restricted" ? { restricted: true, caseId: s.caseId, caseNumber: s.caseNumber } : { ...s, restricted: false, name: v.name(cs) });
      }
      // Veckodag och klockslag från avtalet (sla[veckorapport_publicering]) – samma regel som rapportens sista dag (dueAt).
      const pub = info.cfg.sla.find((x) => x.key === "veckorapport_publicering");
      const pubTime = pub?.time || "16:00";
      const pubDay = WEEKDAYS[pub?.weekday ?? 0];
      return { ...base, kind: "weekly_attendance", m: rest, sections: visible, total: sections.length, customer: isCustomerRole(ctx.actor.role), pubTime, pubDay };
    }
  }
}

handleQuery(reportDocument, { roles: VIEW_ROLES }, async (ctx, p): Promise<ReportDocResult> => {
  const found = await reportAndCase(ctx, p.reportId);
  const customer = isCustomerRole(ctx.actor.role);
  if (!found) return { ok: false, reason: "not_found", title: "Rapporten finns inte", caseId: null, caseNumber: null };
  const req = found.r;
  let { r, c } = found;
  // Kommunen ser den senast levererade versionen medan en rättelse är ett utkast.
  let chain: Report[] | null = null;
  if (customer && !isDelivered(req)) {
    chain = await versionChain(ctx, req);
    const latest = chain.filter(isDelivered).pop();
    if (latest) {
      r = latest;
      c = r.caseId ? await ctx.system.table("cases").get(r.caseId) : null;
    }
  }
  const info = await contractInfo(ctx, r.contractId);
  const viewer = await viewerFor(ctx, c ? [c] : []);
  const acc = reportAccess(r, c, viewer);
  const denied = (reason: Extract<ReportDocResult, { ok: false }>["reason"]): ReportDocResult =>
    customer ? { ok: false, reason, title: "", caseId: null, caseNumber: null } : { ok: false, reason, title: reportTitle(r), caseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null };
  if (!acc.ok) return denied(acc.reason);
  if (!(await policyAllows(ctx, r.id))) return denied(customer ? "not_yours" : "not_assigned");
  const db = await loadReportDb(ctx, r, info);
  const m = reportModel(db, r, { ...info.env, now: ctx.now() });
  if (!m) return denied("missing");
  const doc = await docView(ctx, r, c, viewer, info, m, db.profiles);
  let portal: PortalReportInfo | null = null;
  if (customer) {
    chain = chain ?? (await versionChain(ctx, r));
    const pend = await pendingCorrection(ctx, r);
    const access = viewer.access(c);
    portal = {
      requestedId: req.id, title: reportTitle(r), caseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null, participant: c && access !== "restricted" ? viewer.name(c) : null,
      deliveredText: wdFull(r.deliveredAt), version: r.version || 1, isRecipient: r.deliveredTo.includes(ctx.actor.userId), openedAt: r.openedAt,
      recipientName: personName(db.profiles, r.deliveredTo[0] || recipientOf(r, c)),
      correcting: !!pend, superseded: r.superseded,
      newerId: r.superseded ? chain.filter((v) => v.version > r.version && isDelivered(v)).pop()?.id ?? null : null,
      canMessage: !!c && access === "customer", leadCoachId: c?.leadCoachId ?? null,
    };
  }
  return { ok: true, doc, portal, needsSnapshot: isDelivered(r) && !hasSnapshot(r) && hasDocument(r.kind) };
});

// ================================================================ Ladda ner PDF (tyst)
// Samma behörighet som reportDocument för exakt den rapport som laddas ned (ingen omdirigering till en annan version –
// skärmen skickar id:t på dokumentet den visar). Loggen innehåller bara id, typ, version och period.
handleCommand(reportDownload, { roles: VIEW_ROLES, silent: true }, async (ctx, p) => {
  const customer = isCustomerRole(ctx.actor.role);
  const found = await reportAndCase(ctx, p.reportId);
  if (!found || !hasDocument(found.r.kind)) return fail("not_found", DENIED.not_found[0]);
  const { r, c } = found;
  const info = await contractInfo(ctx, r.contractId);
  const viewer = await viewerFor(ctx, c ? [c] : []);
  const acc = reportAccess(r, c, viewer);
  if (!acc.ok) return fail(acc.reason, DENIED[acc.reason][0]);
  if (!(await policyAllows(ctx, r.id))) {
    const reason = customer ? "not_yours" : "not_assigned";
    return fail(reason, DENIED[reason][0]);
  }
  const version = r.version || 1;
  const filename = reportFilename({ kind: r.kind, version, week: r.week, month: r.month, caseNumber: c?.caseNumber ?? null, contractNumber: info.contract.contractNumber });
  await ctx.audit({
    action: "report.downloaded", entity: "report", entityId: r.id, contractId: r.contractId,
    details: { kind: r.kind, version, ...(r.week ? { week: r.week } : {}), ...(r.month ? { month: r.month } : {}), format: "pdf" },
  });
  return ok({ filename });
});

// ================================================================ Rapportsidan (Miljonbemanning)
function idleText(r: Report, role: Role, step: Step, coachName: string | null): string | null {
  if (role === "chef" || role === "handledare") return "Du kan läsa rapporten. Coach, samordnare och avtalsansvarig hanterar godkännande och leverans.";
  if (step.key === "blocked" || step.key === "correcting") return null;
  if (step.key === "registration") return "Rapporten publiceras automatiskt när coacherna har registrerat närvaron.";
  if (step.key === "approval") {
    if (r.kind === "customer_summary") return "Avtalsansvarig godkänner beställarrapporten nedan.";
    if (r.kind === "monthly" || r.kind === "final") return `Huvudcoachen${coachName ? ` ${coachName}` : ""} godkänner rapporten.`;
    return "Samordnaren eller avtalsansvarig godkänner rapporten.";
  }
  if (step.key === "deliver") {
    if (r.kind === "customer_summary") return "Avtalsansvarig eller samordnaren registrerar när rapporten har lämnats till kommunen.";
    return "Coach, samordnare eller avtalsansvarig levererar rapporten till kommunen.";
  }
  return "Inga åtgärder behövs just nu.";
}

const LEAD: Partial<Record<Report["kind"], string>> = {
  customer_summary:
    "Månadsrapport om avtalet till kommunen. Avtalsansvarig lämnar den till kommunen utanför Miljonmatch, till exempel på ett möte. Den visar bara avtalets mål – aldrig Miljonbemannings interna mål.",
  weekly_attendance: "En rapport per handläggare och vecka, med en sektion per deltagare. Skapas automatiskt från närvaroregistreringen.",
};

handleQuery(reportView, { roles: MB_VIEW_ROLES }, async (ctx, p): Promise<ReportView | ReportViewDenied> => {
  const role = ctx.actor.role;
  const listCrumb = LIST_ROLES.includes(role);
  const found = await reportAndCase(ctx, p.reportId);
  if (!found) return { ok: false, reason: "not_found", title: "Rapport", listCrumb, caseId: null, caseNumber: null };
  const { r, c } = found;
  const info = await contractInfo(ctx, r.contractId);
  const viewer = await viewerFor(ctx, c ? [c] : []);
  const acc = reportAccess(r, c, viewer);
  const denied = (reason: ReportViewDenied["reason"]): ReportViewDenied => ({ ok: false, reason, title: reportTitle(r), listCrumb, caseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null });
  if (!acc.ok) return denied(acc.reason);
  if (!(await policyAllows(ctx, r.id))) return denied("not_assigned");

  const now = ctx.now();
  const env = { ...info.env, now };
  const db = await loadReportDb(ctx, r, info);
  const profiles = db.profiles;
  const pname = (id: string | null | undefined) => personName(profiles, id);
  const [ma, pend, chain] = await Promise.all([monthlyAssessmentOf(ctx, r), isDelivered(r) ? pendingCorrection(ctx, r) : Promise.resolve(null), versionChain(ctx, r)]);
  const step = nextStep(r, ma, pend);
  const delivered = isDelivered(r);
  const lead = acc.access === "full";
  // Beställarrapporten har ingen mottagare i portalen (beslut 2026-10-07) – den lämnas till kommunen utanför Miljonmatch.
  const outside = r.kind === "customer_summary";
  const to = outside ? null : recipientOf(r, c);
  const toProfile = to ? profiles.find((x) => x.id === to) ?? null : null;

  // Knapparna (prototypens StatusCard)
  const approvable = (r.status === "draft" || r.status === "reviewed") && !r.superseded;
  const canApprove = approvable && step.key === "approval" &&
    (((r.kind === "monthly" || r.kind === "final") && role === "coach" && lead) || ((r.kind === "order_confirmation" || r.kind === "weekly_attendance") && (role === "samordnare" || role === "avtalsansvarig")));
  const deliverRoles: readonly Role[] = r.kind === "customer_summary" ? ["avtalsansvarig", "samordnare"] : ["coach", "samordnare", "avtalsansvarig"];
  const roleOk = deliverRoles.includes(role) && (role !== "coach" || lead);
  const weeklyReady = r.kind === "weekly_attendance" && r.status === "waiting" && !!r.recipientUserId && !!r.week && (await weeklyComplete(ctx, r.contractId, r.recipientUserId, r.week));
  const textOk = r.kind !== "final" || hasRecommendation(r);
  const actions = {
    approve: canApprove,
    quality: role === "samordnare" && !r.superseded && (r.status === "reviewed" || r.status === "approved") && !r.qualityReviewedAt,
    deliver: roleOk && !r.superseded && textOk && (r.status === "approved" || weeklyReady),
    correct: roleOk && !r.superseded && !pend && ["approved", "delivered", "opened"].includes(r.status),
  };

  // Veckorapport som väntar på närvaro: saknade registreringar per coach.
  let waiting: ReportView["waiting"] = null;
  if (r.kind === "weekly_attendance" && r.status === "waiting" && r.recipientUserId && r.week) {
    const wr = weeklyReport(db, r.recipientUserId, r.week, { now });
    const wv = await viewerFor(ctx, wr.sections.map((s) => s.case));
    const byCoach = new Map<string, string[]>();
    for (const s of wr.sections)
      for (const row of s.rows) {
        if (row.att || row.activity.startsAt >= now) continue;
        const key = String(s.case.leadCoachId);
        const text = `${s.case.caseNumber}${wv.access(s.case) !== "restricted" ? ` · ${wv.name(s.case)}` : ""} – ${ucfirst(fmtWeekday(row.activity.startsAt))} kl. ${fmtTime(row.activity.startsAt)}`;
        byCoach.set(key, [...(byCoach.get(key) ?? []), text]);
      }
    const t = (key: string, fallback: string) => (info.cfg.sla.find((x) => x.key === key)?.time || fallback).replace(":", ".");
    const d = (key: string) => WEEKDAYS[info.cfg.sla.find((x) => x.key === key)?.weekday ?? 0];
    waiting = {
      regDay: d("veckorapport_registrering"), regTime: t("veckorapport_registrering", "10:00"), pubDay: d("veckorapport_publicering"), pubTime: t("veckorapport_publicering", "16:00"),
      byCoach: [...byCoach.entries()].map(([coachId, items]) => ({ coach: `${pname(coachId)}: ${items.length} ${items.length === 1 ? "tillfälle" : "tillfällen"} saknas`, items })),
      canRegister: role === "coach",
    };
  }

  // Coachens text till slutrapporten
  let finalText: ReportView["finalText"] = null;
  if (r.kind === "final" && ["draft", "reviewed", "approved"].includes(r.status) && !r.superseded && !(r.status === "approved" && hasRecommendation(r))) {
    const lastCi = c ? lastApprovedCheckIn(db, c.id, r.periodStart || c.startDate || "", r.periodEnd || dayOf(now)) : null;
    finalText = {
      canEdit: (role === "coach" && lead) || role === "samordnare",
      obstacles: r.finalText?.obstacles || obstaclesText(lastCi?.obstacles) || "",
      recommendation: r.finalText?.recommendation || "",
    };
  }

  // Beställarrapportens sammanfattning (förslaget från rapportens siffror)
  let summary: ReportView["summary"] = null;
  if (r.kind === "customer_summary" && (r.status === "draft" || r.status === "reviewed") && !r.superseded) {
    const m = reportModel(db, r, env) as SummaryModel | null;
    summary = { suggestion: m ? summaryFromNumbers(m) : "", text: r.summary || "", canApprove: role === "avtalsansvarig", manager: pname(info.contract.contractManagerId) };
  }

  const pendingOf = (v: Report) => {
    const nx = v.correctionPending ? chain.find((x) => x.id === v.correctionPending) : null;
    return nx && !isDelivered(nx) && !nx.superseded ? nx : null;
  };
  const versions: ReportVersion[] = chain.map((v) => ({
    id: v.id, version: v.version || 1, current: v.id === r.id, status: v.status, statusLabel: statusLabel(v), openedAt: v.openedAt,
    text: `${v.deliveredAt ? `Levererad ${fmtDateTime(v.deliveredAt)}` : v.approvedAt ? `Godkänd ${fmtDateTime(v.approvedAt)}` : "Inte godkänd"}${v.superseded ? " · ersatt" : isDelivered(v) && pendingOf(v) ? " · kommunen ser den här versionen tills rättelsen är levererad" : ""}`,
  }));
  const blockedAccess = c ? viewer.access(c) : "none";
  const sla = r.dueAt ? slaStatus(r.dueAt, delivered ? r.deliveredAt : null, { now }) : null;

  return {
    ok: true, id: r.id, kind: r.kind, title: reportTitle(r),
    eyebrow: c ? `${c.caseNumber} · ${viewer.name(c)}` : outside ? `Till ${info.customerName}` : `Till ${pname(r.recipientUserId)}`,
    lead: LEAD[r.kind] ?? "Förhandsvisning av rapporten som kommunen får. Den byggs bara av godkända uppgifter.",
    listCrumb, caseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null,
    status: r.status, eff: effStatus(r), statusLabel: statusLabel(r), overdue: isOverdue(r, now), version: r.version || 1, delivered, deliveredAt: r.deliveredAt,
    superseded: r.superseded, lifecycleIndex: lifecycleIndex(r), next: step,
    due: r.dueAt && sla ? { dueAt: r.dueAt, sla: { label: sla.label, tone: sla.tone }, long: fmtDateTimeLong(r.dueAt) } : null,
    provisional: isProvisional(r) ? provisionalText(r, info.cfg, info.customerName) : null,
    approved: r.approvedAt ? `${fmtDateTime(r.approvedAt)} av ${pname(r.approvedBy)}` : null,
    qualityReviewed: r.qualityReviewedAt ? `${fmtDateTime(r.qualityReviewedAt)} av ${pname(r.qualityReviewedBy)}` : null,
    recipient: personWithUnit(db, to), recipientId: to,
    deliveredText: r.deliveredAt ? `${fmtDateTime(r.deliveredAt)}${outside ? " – lämnad till kommunen utanför Miljonmatch" : " i portalen"}` : outside ? "Inte lämnad" : "Inte levererad",
    openedText: outside ? "–" : r.openedAt ? `${fmtDateTime(r.openedAt)} – mottagaren har öppnat rapporten` : delivered ? "Inte öppnad än. Bara mottagaren kan kvittera." : "–",
    correction: r.correctionReason ? `${r.correctionReason} (${pname(r.correctedBy)}, ${fmtDateTime(r.correctedAt)})` : null,
    blocked: r.kind === "monthly" && step.key === "blocked" && c && r.month
      ? { monthText: monthName(r.month), missing: !ma, canOpen: blockedAccess === "full" || blockedAccess === "team", caseId: c.id, month: r.month }
      : null,
    missingRecommendation: r.kind === "final" && r.status === "approved" && !hasRecommendation(r),
    pendingCorrection: pend ? { id: pend.id, version: pend.version } : null,
    actions,
    idleText: actions.approve || actions.quality || actions.deliver || actions.correct ? null : idleText(r, role, step, c ? pname(c.leadCoachId) : null),
    drift: driftedSinceDelivery(db, r, env) ? { canCorrect: role === "coach" || role === "samordnare" || role === "avtalsansvarig" } : null,
    waiting, finalText, summary,
    slaHidden: r.kind === "customer_summary" && !info.cfg.customerVisibility.seesSlaStats,
    delivery: outside
      ? {
          outside: true,
          channel: "Lämnas till kommunen utanför Miljonmatch",
          recipientName: null,
          attachmentAllowed: info.cfg.reportDelivery.emailAttachmentAllowed,
          // Texten byggs av avtalets reportDelivery.emailAttachmentAllowed (CLAUDE.md punkt 9).
          notice: info.cfg.reportDelivery.emailAttachmentAllowed
            ? "Rapporten lämnas till kommunen utanför Miljonmatch, till exempel på ett möte. Avtalet tillåter att den skickas som bilaga i e-post enligt kommunens skriftliga instruktion."
            : "Rapporten lämnas till kommunen utanför Miljonmatch, till exempel på ett möte. Skicka den inte som bilaga i vanlig e-post – avtalet tillåter inte det.",
        }
      : {
          outside: false,
          channel: info.cfg.reportDelivery.channel === "portal" ? "Kommunens portal (inloggning med e-postkod)" : info.cfg.reportDelivery.channel,
          recipientName: toProfile?.fullName ?? null,
          attachmentAllowed: info.cfg.reportDelivery.emailAttachmentAllowed,
          notice: `${reportKindLabel(r.kind)}${c ? ` för ärende ${c.caseNumber}` : ""} finns i portalen – logga in för att läsa.`,
        },
    versions,
    needsSnapshot: delivered && !hasSnapshot(r) && hasDocument(r.kind),
  };
});

// ================================================================ Egna kommandon (prototypens rap.*)
// ---------------------------------------------------------------- rap.snapshot (tyst)
handleCommand(reportSnapshot, { roles: VIEW_ROLES, silent: true }, async (ctx, p) => {
  const done: string[] = [];
  for (const id of p.reportIds) {
    // Läsaren måste få se rapporten (policyn/RLS). Frysningen är ett systemsteg (freeze.ts): även roller som får läsa men
    // inte ändra rapporten (chef, kommunen) fryser den när de öppnar den.
    const r = await ctx.repo.table("reports").get(id);
    if (r && (await freezeReport(ctx, r))) done.push(r.id);
  }
  return ok({ reportIds: done });
});

// ---------------------------------------------------------------- rap.qualityReview
handleCommand(reportQualityReview, { roles: ["samordnare"] }, async (ctx, p) => {
  const r = await ctx.repo.table("reports").get(p.reportId);
  if (!r) return fail("not_found", NOT_FOUND);
  await ctx.repo.table("reports").update(r.id, { qualityReviewedBy: ctx.actor.userId, qualityReviewedAt: ctx.now() });
  await ctx.audit({ action: "report.quality_reviewed", entity: "report", entityId: r.id, contractId: r.contractId, details: { kind: r.kind } });
  return ok({});
});

// ---------------------------------------------------------------- rap.saveFinal
handleCommand(reportSaveFinal, { roles: ["coach", "samordnare"] }, async (ctx, p) => {
  const r = await ctx.repo.table("reports").get(p.reportId);
  if (!r) return fail("not_found", NOT_FOUND);
  const c = r.caseId ? await ctx.repo.table("cases").get(r.caseId) : null;
  if (ctx.actor.role === "coach" && (!c || c.leadCoachId !== ctx.actor.userId)) return fail("forbidden", "Huvudcoachen skriver kvarstående hinder och rekommenderad fortsättning innan slutrapporten godkänns.");
  if (isDelivered(r) || r.superseded) return fail("delivered", "Rapporten är redan levererad. Rätta rapporten om texten ska ändras.");
  const recommendation = p.recommendation.trim();
  if (!recommendation) return fail("recommendation", "Skriv en rekommenderad fortsättning. Den behövs innan rapporten kan godkännas.");
  const patch: Partial<Report> = { finalText: { obstacles: p.obstacles.trim(), recommendation } };
  if (r.status === "draft") patch.status = "reviewed";
  if (r.status === "approved") Object.assign(patch, { status: "reviewed", approvedAt: null, approvedBy: null });
  await ctx.repo.table("reports").update(r.id, patch);
  await ctx.audit({ action: "report.final_text_saved", entity: "report", entityId: r.id, contractId: r.contractId, details: { kind: r.kind } });
  return ok({});
});

// ---------------------------------------------------------------- rap.saveSummary
/**
 * Nämner texten Miljonbemannings interna mål? ("internt mål", "35 %", "35 procent")
 * byNumber = false för begränsade testare i testmiljön (src/api/tester-access.ts): de känner inte till målet, och en spärr
 * på just det talet skulle avslöja det ("35 %" stoppas, "34 %" går igenom). Orden "internt mål" stoppas för alla.
 */
function mentionsInternal(text: string, cfg: OperationalConfig, byNumber = true): boolean {
  const t = cfg.kpis.find((x) => x.key === "resultatgrad")?.internalTarget;
  const internalPct = Math.round((typeof t === "number" ? t : 0) * 100);
  return /internt? mål/i.test(text) || (byNumber && internalPct > 0 && new RegExp(`(^|\\D)${internalPct}\\s?(%|procent)`, "i").test(text));
}
handleCommand(reportSaveSummary, { roles: ["avtalsansvarig"] }, async (ctx, p) => {
  const r = await ctx.repo.table("reports").get(p.reportId);
  if (!r) return fail("not_found", NOT_FOUND);
  if (isDelivered(r) || r.superseded) return fail("delivered", "Rapporten är redan levererad. Rätta rapporten om texten ska ändras.");
  const text = p.summary.trim();
  if (!text) return fail("summary", "Skriv en sammanfattning eller använd förslaget. Den behövs innan rapporten kan godkännas.");
  const { cfg } = await contractInfo(ctx, r.contractId);
  if (mentionsInternal(text, cfg, !hidesCommercial(ctx.actor))) return fail("internal_target", "Texten nämner Miljonbemannings interna mål. Det får aldrig stå i beställarrapporten. Ta bort det.");
  await ctx.repo.table("reports").update(r.id, { summary: text, summaryAiUsed: p.aiUsed });
  // Innehållet loggas inte – bara att det sparats och om AI-förslaget användes.
  await ctx.audit({ action: "report.summary_saved", entity: "report", entityId: r.id, contractId: r.contractId, details: { aiUsed: p.aiUsed } });
  return ok({});
});

// ---------------------------------------------------------------- rap.correctionNote
handleCommand(reportCorrectionNote, { roles: ["coach", "samordnare", "avtalsansvarig"] }, async (ctx, p) => {
  const r = await ctx.repo.table("reports").get(p.reportId);
  if (!r) return fail("not_found", NOT_FOUND);
  const reason = p.reason.trim();
  if (!reason) return fail("reason", "Skriv varför rapporten rättas. Orsaken sparas i revisionsloggen.");
  await ctx.repo.table("reports").update(r.id, {
    correctionReason: reason, correctedBy: ctx.actor.userId, correctedAt: ctx.now(), qualityReviewedBy: null, qualityReviewedAt: null, snapshot: null,
  });
  await ctx.audit({ action: "report.correction_reason", entity: "report", entityId: r.id, contractId: r.contractId, details: { previous: r.previousId } });
  return ok({});
});
