// Steg 3: månadsbedömningar, månadsplaner och rapporter (månad, slut, orderbekräftelse, vecka, beställarrapport).
// Port av prototyp/src/01-seed.js rad 657–768 – samma ordning på slumpanropen.
import { addDays, addMinutes, addMonths, addWorkingDays, diffDays, fmtDateShort, isoWeek, monday, monthEnd, MONTHS, nthWorkingDay } from "@/core/time";
import { uniq } from "@/core/util";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { GOALS, NEXT, NOW, OBS, TODAY } from "./constants";
import type { Gen, PCheckIn, PReport } from "./context";
import type { AiObservationDraft, AreaAssessment, MonthlyAssessment, ProgressLevel, ReportStatus, TrafficLight } from "../schema";

export function genMonthly(g: Gen) {
  const { r, S, cases } = g;
  const months = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
  const levelFor = (area: string, idx: number): number => {
    const base = Math.min(3, Math.max(0, Math.round(idx * 0.8 + r.next() * 1.6 - 0.4)));
    return area === "ovrigt" && r.chance(0.6) ? 0 : base;
  };
  for (const c of cases) {
    if (!c.startDate || c.startDate > TODAY) continue;
    let idx = 0;
    const caseCis = g.idx.checkInsByCase.get(c.id) ?? [];
    const caseActs = g.idx.activitiesByCase.get(c.id) ?? [];
    for (const mk of months) {
      const mStart = `${mk}-01`;
      const mEnd = monthEnd(mk);
      const actStart = c.startDate > mStart ? c.startDate : mStart;
      const actEnd = (c.endDate && c.endDate < mEnd) ? c.endDate : mEnd;
      if (actStart > actEnd || diffDays(actStart, actEnd) < 10) continue;
      idx++;
      const isJan = mk === "2027-01";
      const coachFast = c.leadCoachId === "u-mats" || c.leadCoachId === "u-sofia";
      const approved = !isJan || (c.status === "closed") || (coachFast && r.chance(0.7));
      const areas: Record<string, AreaAssessment> = {};
      // Underlag för AI-utkast: bara godkända avstämningar och registrerad närvaro i månaden
      const monthCis: PCheckIn[] = caseCis.filter((x) => x.status === "approved" && x.heldAt.slice(0, 7) === mk).sort((a, b) => (a.heldAt < b.heldAt ? -1 : 1));
      const monthActs = caseActs.filter((a) => a.startsAt.slice(0, 7) === mk && a.startsAt < NOW);
      const monthAtt = monthActs.map((a) => g.idx.attendanceByActivity.get(a.id)).filter((x) => !!x);
      const attended = monthAtt.filter((x) => x.status === "present" || x.status === "late").length;
      const hasContact = (x: PCheckIn) => !!(x.employerContacts && x.employerContacts.count && x.employerContacts.count !== "0");
      const contacts = monthCis.filter(hasContact).length;
      const srcLabel = (ci: PCheckIn) => `Avstämning ${fmtDateShort(ci.heldAt)}`;
      const late = monthAtt.filter((x) => x.status === "late").length;
      const invalid = monthAtt.filter((x) => x.status === "absent_invalid").length;
      const goalsMet = monthCis.filter((x) => x.goalStatus === "yes" || x.goalStatus === "partly");
      const withAct = (t: string) => monthCis.filter((x) => (x.activitiesDone || []).includes(t));
      const allSrc = monthCis.map(srcLabel);
      /** AI-utkast med belägg ur godkända avstämningar och registrerad närvaro. Saknas belägg: "Framgår inte". */
      const evidenceDraft = (key: string): AiObservationDraft => {
        const nf: AiObservationDraft = { text: "Framgår inte av månadens godkända avstämningar.", sources: [], noEvidence: true };
        if (key === "narvaro_rutiner") return monthAtt.length ? { text: `Närvarande vid ${attended} av ${monthAtt.length} registrerade tillfällen${late ? `, varav ${late} med sen ankomst` : ""}.${invalid ? ` ${invalid} ogiltig frånvaro.` : " Ingen ogiltig frånvaro."}`, sources: ["Närvaroregistrering", ...allSrc.slice(-1)] } : nf;
        if (key === "arbetsgivarkontakter") return contacts ? { text: `Arbetsgivarkontakt registrerad ${contacts === 1 ? "en vecka" : `${contacts} veckor`} (${uniq(monthCis.flatMap((x) => (x.employerContacts && x.employerContacts.types) || [])).join(", ")}).`, sources: monthCis.filter(hasContact).map(srcLabel) } : { text: "Ingen arbetsgivarkontakt framgår av avstämningarna.", sources: allSrc, noEvidence: true };
        if (key === "yrkesfardigheter" && withAct("Yrkesspecifika moment").length) return { text: `Yrkesspecifika moment genomförda ${withAct("Yrkesspecifika moment").length} av ${monthCis.length} veckor.`, sources: withAct("Yrkesspecifika moment").map(srcLabel) };
        if (key === "beredskap" && withAct("Praktik/APL").length) return { text: `Har genomfört praktik ${withAct("Praktik/APL").length === 1 ? "en vecka" : `${withAct("Praktik/APL").length} veckor`} under månaden.`, sources: withAct("Praktik/APL").map(srcLabel) };
        if (key === "sjalvstandighet" && monthCis.length) return { text: `Veckomålet uppnått helt eller delvis ${goalsMet.length} av ${monthCis.length} veckor.`, sources: allSrc };
        if (key === "digital_sjalvstandighet" && withAct("CV och ansökningar").length) return { text: `Har arbetat med CV och ansökningar ${withAct("CV och ansökningar").length === 1 ? "en vecka" : `${withAct("CV och ansökningar").length} veckor`}.`, sources: withAct("CV och ansökningar").map(srcLabel) };
        return nf;
      };
      for (const key of BOTKYRKA_CONFIG.progression.areas) {
        const lvl = levelFor(key, idx);
        const aiLevel = Math.max(0, Math.min(3, lvl + r.pick([0, 0, 1, -1]))) as ProgressLevel;
        areas[key] = approved
          ? { level: lvl as ProgressLevel, observation: lvl >= 1 ? r.pick(OBS[key]) : "", nextStep: NEXT[key], aiLevelSuggestion: null, aiObservationDraft: null }
          : {
            level: null, observation: "", nextStep: "", aiLevelSuggestion: c.aiConsent === "given" ? aiLevel : null,
            aiObservationDraft: c.aiConsent === "given" && monthCis.length ? evidenceDraft(key) : null,
          };
        const draft = areas[key].aiObservationDraft;
        if (!approved && draft && draft.noEvidence) areas[key].aiLevelSuggestion = null;
      }
      const id = g.nid("ma");
      const decidedAt = approved ? `${nthWorkingDay(addMonths(mk, 1), r.int(1, 4))}T14:00` : null;
      const summary = approved ? "Deltagaren följer planen och har gjort tydlig progression inom yrkesfärdigheter. Fortsatt fokus på tempo och arbetsgivarkontakter." : "";
      const aiSummaryDraft = !approved && c.aiConsent === "given" && monthCis.length
        ? `Under ${MONTHS[Number(mk.slice(5)) - 1]} deltog deltagaren i ${attended} av ${monthAtt.length} registrerade tillfällen. ${contacts ? `Arbetsgivarkontakter fanns ${contacts === 1 ? "en vecka" : `${contacts} veckor`}.` : "Inga arbetsgivarkontakter framgår."} (Källa: ${monthCis.length} godkända avstämningar, ${monthCis.map((x) => fmtDateShort(x.heldAt)).join(", ")}.)`
        : null;
      const overallStatus = approved ? r.weighted<TrafficLight>([["green", 70], ["yellow", 25], ["red", 5]]) : null;
      const ma: MonthlyAssessment = { id, caseId: c.id, month: mk, areas, status: approved ? "approved" : "draft", decidedBy: approved ? c.leadCoachId : null, decidedAt, summary, aiSummaryDraft, overallStatus };
      // Januaribedömningar godkänns tidigast måndag morgon efter månadsskiftet (före demoklockan). Slumpanropen behålls så att övriga testdata inte ändras.
      if (approved && (ma.decidedAt as string) >= NOW) { r.int(0, 3); r.int(8, 8); r.int(0, 55); ma.decidedAt = `${TODAY}T0${["7:35", "7:50", "8:05", "8:20", "8:40"][parseInt(c.number.slice(-4), 10) % 5]}`; }
      S.monthlyAssessments.push(ma);
      const mpId = g.nid("mp");
      const goal1 = r.pick(GOALS[Math.min(5, c.phase)]);
      const goal2 = r.pick(GOALS[Math.min(5, c.phase + 1)] || GOALS[5]);
      S.monthlyPlans.push({
        id: mpId, caseId: c.id, month: mk, goal1, goal2,
        plannedActivities: "Yrkesmoment två dagar i veckan och en coachträff", plannedEmployerContact: c.phase >= 3 ? "Studiebesök hos arbetsgivare inom spåret" : "Inget planerat",
        plannedAdaptation: "", nextCustomerMeeting: approved ? null : "2027-02-15", status: approved ? "approved" : "draft",
      });
      // Rapport
      const dueDay = nthWorkingDay(addMonths(mk, 1), 5);
      let status: ReportStatus = "draft";
      let deliveredAt: string | null = null;
      let approvedAt: string | null = null;
      let openedAt: string | null = null;
      if (approved) {
        status = "delivered"; approvedAt = ma.decidedAt; deliveredAt = addMinutes(ma.decidedAt as string, r.int(10, 120));
        openedAt = r.chance(0.8) ? addDays(deliveredAt, r.int(0, 3)) : (deliveredAt < "2027-01-25" ? addDays(deliveredAt, 1) : null);
        if (isJan && r.chance(0.3)) { status = "approved"; deliveredAt = null; openedAt = null; }
        if (openedAt && openedAt > NOW) openedAt = null;
        if (deliveredAt && deliveredAt > NOW) { deliveredAt = null; status = "approved"; }
      }
      S.reports.push({
        id: g.nid("rep"), contractId: "c-bot", caseId: c.id, kind: "monthly", periodStart: `${mk}-01`, periodEnd: monthEnd(mk), month: mk, status, version: 1,
        dueAt: `${dueDay}T23:59`, approvedBy: approvedAt ? c.leadCoachId : null, approvedAt, deliveredAt, deliveredTo: deliveredAt ? [c.referrerId] : [], openedAt, provisionalDue: true,
      });
    }
  }
  // En decemberrapport levererades sent (för KPI)
  const lateDec = S.reports.find((x) => x.kind === "monthly" && x.month === "2026-12" && x.status === "delivered");
  if (lateDec) lateDec.deliveredAt = addMinutes(lateDec.dueAt as string, 60 * 17 + 15);
}

export function genOtherReports(g: Gen) {
  const { r, S, cases } = g;
  // ---- Slutrapporter
  const finalWorkingDays = BOTKYRKA_CONFIG.sla.find((x) => x.key === "slutrapport")?.proposal?.workingDays ?? 5;
  for (const c of cases.filter((x) => x.status === "closed")) {
    const due = addWorkingDays(`${c.endDate}T23:59`, finalWorkingDays);
    let status: ReportStatus = "delivered";
    let delivered: string | null = addDays(c.closedAt as string, r.int(1, 4));
    if (delivered > due) delivered = addMinutes(due, -600);
    if (c.tags.includes("slutsen")) { status = "draft"; delivered = null; }
    if (delivered && delivered > NOW) { status = (c.endDate as string) >= "2027-01-27" ? "draft" : "approved"; delivered = null; }
    const rep: PReport = {
      id: g.nid("rep"), contractId: "c-bot", caseId: c.id, kind: "final", periodStart: c.startDate, periodEnd: c.endDate, status, version: 1, dueAt: due, approvedBy: delivered ? c.leadCoachId : null,
      approvedAt: delivered ? addMinutes(delivered, -30) : null, deliveredAt: delivered, deliveredTo: delivered ? [c.referrerId] : [],
      openedAt: delivered && (r.chance(0.7) || delivered < "2027-01-25") ? addDays(delivered, 1) : null, provisionalDue: true,
    };
    S.reports.push(rep);
  }
  // Orderbekräftelser (prototypen drar två slumptal när länken öppnats före demoklockan)
  for (const c of cases.filter((x) => x.confirmedAt)) {
    const confirmedAt = c.confirmedAt as string;
    const id = g.nid("rep");
    const openedAt = addMinutes(confirmedAt, r.int(20, 600)) > NOW ? null : addMinutes(confirmedAt, r.int(20, 600));
    S.reports.push({
      id, contractId: "c-bot", caseId: c.id, kind: "order_confirmation", periodStart: c.referredAt.slice(0, 10), periodEnd: c.referredAt.slice(0, 10), status: "delivered", version: 1,
      dueAt: addWorkingDays(c.referredAt, 1), approvedBy: "u-sara", approvedAt: confirmedAt, deliveredAt: confirmedAt, deliveredTo: [c.referrerId], openedAt,
    });
  }
  // Veckorapporter per handläggare och vecka (måndag 16.00 för föregående vecka)
  const w4Missing = new Set(S.w4MissingActivityIds);
  for (let mon = monday("2026-09-14"); mon < monday(TODAY); mon = addDays(mon, 7)) {
    const wk = isoWeek(mon);
    const repMon = addDays(mon, 7);
    for (const k of S.customerUsers.filter((x) => x.role === "handlaggare")) {
      const has = cases.some((c) => c.referrerId === k.id && c.startDate && c.startDate <= addDays(mon, 6) && (!c.endDate || c.endDate >= mon));
      if (!has) continue;
      const dueAt = `${repMon}T16:00`;
      let deliveredAt: string | null = `${repMon}T${r.pick(["07:00", "09:40", "10:05", "11:20"])}`;
      if (wk.key === "2026-W47" && k.id === "k-linda") deliveredAt = `${repMon}T16:40`;
      let status: ReportStatus = "delivered";
      if (wk.key === "2027-W04") {
        const waitingFor = new Set(S.activities.filter((a) => w4Missing.has(a.id)).map((a) => cases.find((x) => x.id === a.caseId)?.referrerId));
        const waiting = waitingFor.has(k.id);
        deliveredAt = waiting ? null : `${repMon}T07:00`;
        status = waiting ? "waiting" : "delivered";
      }
      const id = g.nid("rep");
      const openedAt = (() => {
        if (!(deliveredAt && wk.key !== "2027-W04")) return null;
        if (r.chance(0.85)) return addMinutes(deliveredAt, r.int(30, 2000));
        return deliveredAt < "2027-01-18" ? addMinutes(deliveredAt, 240) : null;
      })();
      S.reports.push({
        id, contractId: "c-bot", caseId: null, recipientUserId: k.id, kind: "weekly_attendance", week: wk.key, periodStart: mon, periodEnd: addDays(mon, 6), status, version: 1,
        dueAt, approvedBy: "system", approvedAt: deliveredAt, deliveredAt, deliveredTo: deliveredAt ? [k.id] : [], openedAt,
      });
    }
  }
  // Beställarrapporter (kommunens chef) per månad
  for (const mk of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
    const due = nthWorkingDay(addMonths(mk, 1), 8);
    const done = mk !== "2027-01";
    S.reports.push({
      id: g.nid("rep"), contractId: "c-bot", caseId: null, recipientUserId: "k-eva", kind: "customer_summary", month: mk, periodStart: `${mk}-01`, periodEnd: monthEnd(mk), status: done ? "delivered" : "draft", version: 1,
      dueAt: `${due}T16:00`, approvedBy: done ? "u-johan" : null, approvedAt: done ? `${addDays(due, -2)}T10:00` : null, deliveredAt: done ? `${addDays(due, -2)}T10:05` : null, deliveredTo: done ? ["k-eva"] : [], openedAt: done ? `${addDays(due, -1)}T08:30` : null,
      aiSummaryDraft: done ? null : "I januari var 71 deltagare aktiva och 43 nya ärenden startade. 29 insatser avslutades, varav 10 till arbete eller studier. Närvarograden var 89 procent. En avvikelse har hanterats med åtgärdsplan.",
    });
  }
}
