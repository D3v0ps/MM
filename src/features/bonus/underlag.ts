// Redovisningsunderlaget för ett bonusanspråk (SPEC §7.17, beslut 2026-11-04) – byggs bara av godkända uppgifter, ingen AI.
// Rena funktioner – bara för hanterarna (src/features/bonus/handlers.ts) och testerna. Fryses i bonus_claims.snapshot när
// anspråket skickas till kommunen; kommunen läser det som PDF (src/features/bonus/pdf.tsx).
//
// Med i underlaget: insatsens period och mål (den senaste godkända planen), närvarograden och deltagarens egna tillfällen per typ,
// progressionen före och efter (första och senaste godkända månadsbedömningen: nivå 0–3 per område och samlad status som text),
// bonussteget med namn, resultatdatum och startdatum, verifieringens typ och datum (aldrig dokumentet), arbetsgivaren eller
// skolan med kontaktperson och coachens korta kommentar (och för steg 1 checklistan).
// Aldrig med: belopp, nivå (grupperingen), taggar, gruppaktiviteter, gruppmål, coachens anteckningar, avstämningarnas text,
// personnummer och deltagarens namn (namnet visas för kommunen när underlaget öppnas, se bonus.underlag).
import { approvedAssessments, bonusAttendance, BONUS_CHECKLIST_LABEL, FOLLOWS_STEP3, resultWindowEnd, speedDeadline, sustainDate } from "@/core/bonus";
import { bonusStepLabel, progressionAreas, type BonusModel, type OperationalConfig } from "@/core/config";
import { areaName, eventLabel, personName, TRAFFIC_LIGHT_LABEL } from "@/core/labels";
import { dayOf, type LocalDateTime } from "@/core/time";
import { BONUS_CHECKLIST_ITEMS, type BonusChecklist, type BonusClaim, type Case, type Db } from "@/data/schema";
import type { BonusUnderlag } from "./api";

export type UnderlagDb = Pick<
  Db,
  "activities" | "attendance" | "monthly_assessments" | "monthly_plans" | "outcome_events" | "employers" | "placements" | "bonus_claims" | "contract_areas" | "profiles"
>;

/** Tillfällenas typer i underlaget (deltagarens egna tillfällen – gruppaktiviteterna räknas inte). */
const ACTIVITY_LABEL: Record<string, string> = { möte: "Coachträffar", yrkesmoment: "Yrkesmoment", praktikdag: "Praktikdagar", arbetsgivarbesök: "Arbetsgivarbesök", annat: "Andra aktiviteter" };

/** Vad bonussteget innebär, med talen ur avtalskonfigurationen. */
export function bonusRuleText(m: BonusModel, step: number): string {
  switch (step) {
    case 1:
      return `Dokumenterad progression: närvaro minst ${m.attendanceMinPercent} procent, genomförd individuell plan, förbättrade ansökningshandlingar, genomförd branschintroduktion och aktivt deltagande i arbetsgivarnära aktivitet. Underlag: närvaron, progressionsbedömningen före och efter, coachens bedömning och aktivitetsloggen.`;
    case 2:
      return "Stark progression: praktik eller arbetsträning, validering, branschintyg, genomförd arbetsintervju, påbörjat jobbspår eller antagning till utbildningsförberedande aktivitet. Underlag: praktikintyg, arbetsgivarens återkoppling, valideringsunderlag, kallelse till intervju eller utbildningsunderlag.";
    case 3:
      return `Resultat arbete eller studier: deltagaren påbörjar arbete, reguljär utbildning eller yrkesutbildning under insatsen eller högst ${m.resultWindowMonthsAfterEnd} månader efter att den slutat. Underlag: anställningsintyg, arbetsgivarintyg, antagningsbesked eller studieintyg.`;
    case 4:
      return `Hållbart resultat: arbetet eller studierna kvarstår ${m.sustainMonths} månader efter resultatdatum. Underlag: uppföljning efter ${m.sustainMonths} månader med intyg eller annan verifiering som kommunen godtar.`;
    case 5:
      return `Snabbhetspremie: steg 3 nås senast ${m.speedWeeks} veckor från start. Underlag: samma som steg 3, startdatum och resultatdatum.`;
    default:
      return "";
  }
}

/** Arbetsgivaren eller skolan: arbetsgivarregistret (samma namn), annars praktiken som började samma dag, annars bara namnet. */
function actorOf(db: Pick<UnderlagDb, "employers" | "placements">, caseId: string, name: string, day: string): BonusUnderlag["actor"] {
  const n = name.trim();
  const byName = n ? db.employers.find((e) => e.name.trim().toLowerCase() === n.toLowerCase()) : undefined;
  const placement = db.placements.find((p) => p.caseId === caseId && p.startsOn === day);
  const e = byName ?? (placement ? db.employers.find((x) => x.id === placement.employerId) : undefined);
  if (!e && !n) return null;
  return { name: e?.name ?? n, contactName: e?.contactName || null, phone: e?.phone || null, email: e?.email || null };
}

export type UnderlagInput = {
  db: UnderlagDb;
  cfg: OperationalConfig;
  model: BonusModel;
  claim: BonusClaim;
  case: Case;
  contract: { contractNumber: string };
  customerName: string;
  now: LocalDateTime;
  /** Den som skickar. null = förhandsvisning av ett anspråk som inte är skickat (utkast – inget "Skickat … av …"). */
  sentBy: string | null;
};

/** Redovisningsunderlaget för anspråket (se överst i filen). */
export function buildUnderlag(x: UnderlagInput): BonusUnderlag {
  const { db, cfg, model: m, claim: k, case: c } = x;
  const step = k.step ?? 0;
  const today = dayOf(x.now);
  const att = bonusAttendance(db, c, m, { now: x.now });
  const to = c.startDate ? (c.endDate && c.endDate < today ? c.endDate : today) : null;
  // Deltagarens egna tillfällen under insatsen som har passerat (aldrig gruppaktiviteter).
  const own = db.activities.filter((a) => a.caseId === c.id && !a.groupActivityId && !!c.startDate && dayOf(a.startsAt) >= c.startDate && (!to || dayOf(a.startsAt) <= to) && a.startsAt < x.now);
  const counts = new Map<string, number>();
  for (const a of own) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const activities = Object.keys(ACTIVITY_LABEL).filter((kind) => counts.has(kind)).map((kind) => ({ label: ACTIVITY_LABEL[kind], count: counts.get(kind) ?? 0 }));
  // Progression före och efter (bara godkända bedömningar, bara de obligatoriska områdena).
  const approved = approvedAssessments(db, c.id);
  const first = approved[0];
  const latest = approved[approved.length - 1];
  const areas = progressionAreas(cfg);
  const overall = (v: string | null | undefined) => (v ? (TRAFFIC_LIGHT_LABEL as Record<string, string>)[v] ?? null : null);
  const progression = first && latest && first.id !== latest.id
    ? {
        first: { month: first.month, overall: overall(first.overallStatus) },
        latest: { month: latest.month, overall: overall(latest.overallStatus) },
        rows: areas.map((a) => ({ label: a.label, first: first.areas[a.key]?.level ?? null, latest: latest.areas[a.key]?.level ?? null })),
        scale: Object.entries(cfg.progression.scale).map(([n, t]) => `${n} = ${t}`).join(", "),
      }
    : null;
  // Målen ur den senaste godkända planen.
  const plan = db.monthly_plans.filter((p) => p.caseId === c.id && p.status === "approved").sort((a, b) => (a.month < b.month ? 1 : -1))[0];
  const goals = plan ? [plan.goal1, plan.goal2].map((g) => g.trim()).filter(Boolean) : [];
  // Händelsen (steg 2–3) och steg 3-anspråket (steg 4–5).
  const step3 = FOLLOWS_STEP3.includes(step) && k.followsClaimId ? db.bonus_claims.find((y) => y.id === k.followsClaimId) ?? null : null;
  const eventId = step3 ? step3.outcomeEventId : k.outcomeEventId;
  const ev = eventId ? db.outcome_events.find((e) => e.id === eventId && e.caseId === c.id) ?? null : null;
  // Steg 4 och 5: resultatdatum är steg 3:s (det levande – aldrig en gammal kopia på anspråket).
  const resultDay = step3 ? step3.reachedOn : k.reachedOn;
  const checklist = step === 1
    ? BONUS_CHECKLIST_ITEMS.map((item) => ({ label: BONUS_CHECKLIST_LABEL[item], where: ((k.checklist as BonusChecklist)[item]?.where ?? "").trim() })).filter((r, i) => !!(k.checklist as BonusChecklist)[BONUS_CHECKLIST_ITEMS[i]]?.done)
    : [];
  return {
    v: 1,
    claimId: k.id,
    caseNumber: c.caseNumber,
    contractNumber: x.contract.contractNumber,
    customerName: x.customerName,
    step,
    stepLabel: bonusStepLabel(m, step),
    rule: bonusRuleText(m, step),
    createdAt: x.now,
    draft: x.sentBy == null,
    sentByName: x.sentBy ? personName(db.profiles, x.sentBy) : null,
    coachName: c.leadCoachId ? personName(db.profiles, c.leadCoachId) : null,
    period: { start: c.startDate, end: c.endDate, plannedEnd: c.plannedEnd, ongoing: !c.endDate },
    area: areaName(db.contract_areas, c.primaryAreaCode),
    track: c.vocationalTrack || null,
    goals,
    attendance: { percent: att.percent, planned: att.planned, registered: att.registered, attended: att.attended, from: c.startDate, to, minPercent: m.attendanceMinPercent },
    activities,
    progression,
    reachedOn: resultDay,
    event: ev ? { label: eventLabel(ev.kind), date: ev.occurredOn } : null,
    speed: step === 5 && c.startDate ? { deadline: speedDeadline(c.startDate, m), weeks: m.speedWeeks } : null,
    sustain: step === 4 && resultDay ? { since: resultDay, until: sustainDate(resultDay, m), months: m.sustainMonths } : null,
    verification: k.verificationKind ? { kind: k.verificationKind, on: k.verificationOn } : null,
    actor: ev && step >= 2 ? actorOf(db, c.id, ev.actor, ev.occurredOn) : null,
    checklist,
    comment: k.basis.trim(),
  };
}

/** Fönstret för steg 3 i klarspråk för granskningen (sista dag eller null för en pågående insats). */
export const windowEndOf = (c: Pick<Case, "endDate">, m: BonusModel) => resultWindowEnd(c, m);

/** PDF:ens filnamn: bara ärendenummer och steg – inga namn. */
export const underlagFilename = (u: Pick<BonusUnderlag, "caseNumber" | "step" | "draft">): string =>
  `redovisningsunderlag-progression-och-resultat-${u.caseNumber}-steg${u.step}${u.draft ? "-utkast" : ""}.pdf`;
