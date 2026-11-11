// Bonus: incitamentsmodellen med bonussteg 1–5 (SPEC §7.17, beslut 2026-11-04 – Botkyrka har godtagit modellen).
// Ren logik utan React och utan I/O: reglerna för förslagen, kontrollerna innan ett anspråk skickas till kommunen och taket.
// Alla värden läses ur avtalskonfigurationen (bonusModel i ./config.ts) – inget hårdkodas (CLAUDE.md punkt 4). Stegens belopp
// står i prislistan (price_items, unit bonus_step) och räknas bara på bonusfakturan (./bonus-billing.ts).
//
// Regler (förslag – regelstyrt, ingen AI; en människa skickar alltid):
//   Steg 1  närvaron från start till i dag (eller slutdatum) är minst attendanceMinPercent och ärendet har minst två godkända
//           månadsbedömningar (före och efter). Coachen bockar av de fyra punkterna (individuell plan, förbättrade
//           ansökningshandlingar, branschintroduktion, arbetsgivarnära aktivitet) med var underlaget finns innan anspråket skickas.
//   Steg 2  en händelse av typerna step2EventKinds under insatsen. Coachen fyller i verifieringens typ och datum. Jobbspår och
//           antagning till utbildningsförberedande aktivitet har ingen händelsetyp – coachen skapar steg 2 själv.
//   Steg 3  en händelse av typerna step3EventKinds med registrerad verifiering, från start till och med resultWindowMonthsAfterEnd
//           månader efter slutdatum (pågående insats: allt från start). Resultatdatum = händelsens dag.
//   Steg 5  tillsammans med steg 3 när resultatdatum är senast speedWeeks veckor från start.
//   Steg 4  när det gått sustainMonths månader från steg 3:s resultatdatum och steg 3 är skickat eller godkänt. Coachen fyller i
//           en ny verifiering daterad tidigast den dagen.
// Ett förslag skapas bara när ärendet saknar ett anspråk som räknas (suggested, submitted, approved) för steget, och aldrig två
// gånger för samma underlag: ett avslaget eller återtaget anspråk från samma händelse (steg 2–3), samma steg 3 (steg 4–5) eller –
// för steg 1 – något tidigare anspråk för steg 1 föreslås inte igen. Coachen kan alltid skapa ett nytt anspråk själv (ett
// avslaget hindrar inte det).
//
// Taket: anspråken avräknas aldrig mot varandra (offset "never") – stegen läggs ihop. Per ärende: de godkända anspråken i
// ordning efter kommunens beslut (decidedAt, sedan id) får beloppet min(pris, max(0, tak − summan av de tidigare)). Ett anspråk
// som redan står på en skapad faktura räknas med det fakturerade beloppet; ett anspråk utan ett riktigt pris stoppar de senare
// anspråken i ärendet (taket går inte att räkna).
import type { BonusClaim, BonusClaimStatus, BonusChecklist, BonusKind, Case, Db, MonthlyAssessment, OutcomeEvent } from "@/data/schema";
import { BONUS_ACTIVE_STATUSES, BONUS_CHECKLIST_ITEMS } from "@/data/schema";
import { attendanceStats } from "./attendance";
import { bonusStepLabel, type BonusModel } from "./config";
import type { DomainEnv } from "./env";
import { addDays, addMonthsDate, dayOf, type LocalDate, type LocalDateTime } from "./time";
import { looksLikePnr } from "./validation";

// ---------------------------------------------------------------- Steg och lägen
/** Steg 1–2 = progression, steg 3–5 = work (bonus_claims.kind). */
export const stepKind = (step: number): BonusKind => (step <= 2 ? "progression" : "work");
/** Bonusstegen som bygger på ett anspråk för steg 3 (follows_claim_id). */
export const FOLLOWS_STEP3: readonly number[] = [4, 5];
/** Ärenden där bonus kan bli aktuellt: insatsen har startat. */
const STARTED_STATUSES: readonly Case["status"][] = ["active", "paused", "closed"];
export const isActiveClaim = (x: Pick<BonusClaim, "status">): boolean => BONUS_ACTIVE_STATUSES.includes(x.status);

/** Läget i klarspråk med ikon – status visas alltid som text + ikon, aldrig bara färg. "none" = inget anspråk för steget. */
export const BONUS_STATUS_TEXT: Record<BonusClaimStatus | "none", { text: string; icon: "circle" | "help" | "send" | "check-circle" | "x-circle" | "minus-circle" }> = {
  none: { text: "Inte aktuellt än", icon: "circle" },
  suggested: { text: "Förslag att granska", icon: "help" },
  submitted: { text: "Skickat till kommunen", icon: "send" },
  approved: { text: "Godkänt av kommunen", icon: "check-circle" },
  rejected: { text: "Avslaget", icon: "x-circle" },
  withdrawn: { text: "Återtaget", icon: "minus-circle" },
};

/** Checklistans punkter för steg 1 i klarspråk. */
export const BONUS_CHECKLIST_LABEL: Record<(typeof BONUS_CHECKLIST_ITEMS)[number], string> = {
  individuell_plan: "Genomförd individuell plan",
  ansokningshandlingar: "Förbättrade ansökningshandlingar",
  branschintroduktion: "Genomförd branschintroduktion",
  arbetsgivarnara_aktivitet: "Aktivt deltagande i arbetsgivarnära aktivitet",
};

/** Steg 5 i incitamentsmodellen: steg 3 nås inom avtalets antal veckor från start. */
export const SPEED_STEP = 5;
/**
 * Stegets namn för coacherna och kommunen (Karims beslut 2026-11-11): steg 5 heter "Snabbt resultat" – "premie" är ett ord om
 * pengar och står bara hos ekonomen och i prislistan (avtalets namn, bonusStepLabel).
 */
export const progressStepLabel = (m: Pick<BonusModel, "steps"> | null | undefined, step: number): string => (step === SPEED_STEP ? "Snabbt resultat" : bonusStepLabel(m, step));
/** Kort text för ett steg: "Steg 3 · Arbete eller studier" (ordet bonus syns bara för ekonomen – Karims beslut 2026-11-11). */
export const bonusStepTitle = (m: Pick<BonusModel, "steps"> | null, step: number): string => `Steg ${step} · ${progressStepLabel(m, step)}`;

// ---------------------------------------------------------------- Tider
/** Sista dagen i fönstret "i anslutning till insatsen" (slutdatum + resultWindowMonthsAfterEnd månader), null för en pågående insats. */
export const resultWindowEnd = (c: Pick<Case, "endDate">, m: Pick<BonusModel, "resultWindowMonthsAfterEnd">): LocalDate | null =>
  c.endDate ? addMonthsDate(c.endDate, m.resultWindowMonthsAfterEnd) : null;
/** Dagen ligger i fönstret för steg 3: från start till och med fönstrets slut (pågående insats: allt från start). */
export function inResultWindow(c: Pick<Case, "startDate" | "endDate">, day: LocalDate, m: Pick<BonusModel, "resultWindowMonthsAfterEnd">): boolean {
  if (!c.startDate || day < c.startDate) return false;
  const end = resultWindowEnd(c, m);
  return end == null || day <= end;
}
/** Dagen ligger under insatsen: från start till och med slutdatum (pågående: till och med i dag). */
export function duringInsats(c: Pick<Case, "startDate" | "endDate">, day: LocalDate, today: LocalDate): boolean {
  return !!c.startDate && day >= c.startDate && day <= (c.endDate ?? today);
}
/** Snabbhetspremien: steg 3 nås senast den här dagen (start + speedWeeks veckor). */
export const speedDeadline = (start: LocalDate, m: Pick<BonusModel, "speedWeeks">): LocalDate => addDays(start, m.speedWeeks * 7);
/** Hållbart resultat: dagen då arbetet eller studierna kvarstått sustainMonths månader. */
export const sustainDate = (reachedOn: LocalDate, m: Pick<BonusModel, "sustainMonths">): LocalDate => addMonthsDate(reachedOn, m.sustainMonths);

// ---------------------------------------------------------------- Steg 1: närvaro och bedömningar
export type BonusAttendance = {
  /** Passerade tillfällen, registrerade, närvarande (också sena). */
  planned: number;
  registered: number;
  attended: number;
  /** Närvarograd i procent med en decimal, null om inget är registrerat. */
  percent: number | null;
  /** Minst attendanceMinPercent. */
  meets: boolean;
};
/** Närvaron för steg 1: från startdatum till i dag (eller slutdatum) – samma räkning som närvarograden (attendanceStats). */
export function bonusAttendance(db: Pick<Db, "activities" | "attendance">, c: Pick<Case, "id" | "startDate" | "endDate">, m: Pick<BonusModel, "attendanceMinPercent">, env: Pick<DomainEnv, "now">): BonusAttendance {
  if (!c.startDate) return { planned: 0, registered: 0, attended: 0, percent: null, meets: false };
  const today = dayOf(env.now);
  const to = c.endDate && c.endDate < today ? c.endDate : today;
  const s = attendanceStats(db, c.id, c.startDate, to, env);
  const registered = s.planned - s.unregistered;
  const attended = s.present + s.late;
  return {
    planned: s.planned, registered, attended, percent: registered ? Math.round((attended * 1000) / registered) / 10 : null,
    // Heltal – ingen avrundning avgör gränsen.
    meets: registered > 0 && attended * 100 >= m.attendanceMinPercent * registered,
  };
}
/** Godkända månadsbedömningar i ärendet, äldst först (före och efter). */
export const approvedAssessments = (db: Pick<Db, "monthly_assessments">, caseId: string): MonthlyAssessment[] =>
  db.monthly_assessments.filter((a) => a.caseId === caseId && a.status === "approved").sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

// ---------------------------------------------------------------- Förslagen
export type BonusRuleDb = Pick<Db, "cases" | "activities" | "attendance" | "monthly_assessments" | "outcome_events" | "bonus_claims">;
/** Ett förslag som ska bli ett anspråk (status suggested, source auto). follows = steg 3-anspråket (id, eller "new" = förslaget till steg 3 i samma omgång). */
export type BonusSuggestion = {
  caseId: string;
  contractId: string;
  step: number;
  kind: BonusKind;
  outcomeEventId: string | null;
  follows: string | "new" | null;
  reachedOn: LocalDate | null;
  verificationKind: string | null;
};

/**
 * Förslagen för ärendena (se reglerna överst). Ordningen: per ärende steg 3, 5, 4, 2, 1 – steg 5 kan bygga på förslaget till
 * steg 3 i samma omgång (follows "new"). Idempotent: samma data ger inga förslag när förslagen redan finns.
 */
export function bonusSuggestions(db: BonusRuleDb, m: BonusModel, env: Pick<DomainEnv, "now">): BonusSuggestion[] {
  const today = dayOf(env.now);
  const out: BonusSuggestion[] = [];
  const claimsOf = new Map<string, BonusClaim[]>();
  for (const x of db.bonus_claims) claimsOf.set(x.caseId, [...(claimsOf.get(x.caseId) ?? []), x]);
  const eventsOf = new Map<string, OutcomeEvent[]>();
  for (const e of db.outcome_events) eventsOf.set(e.caseId, [...(eventsOf.get(e.caseId) ?? []), e]);
  const byDay = (a: OutcomeEvent, b: OutcomeEvent) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.id < b.id ? -1 : 1);

  for (const c of [...db.cases].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!c.startDate || !STARTED_STATUSES.includes(c.status) || c.startDate > today) continue;
    const claims = claimsOf.get(c.id) ?? [];
    const active = (step: number) => claims.find((x) => x.step === step && isActiveClaim(x)) ?? null;
    const usedEvent = (step: number, eventId: string) => claims.some((x) => x.step === step && x.outcomeEventId === eventId);
    const usedFollows = (step: number, claimId: string) => claims.some((x) => x.step === step && x.followsClaimId === claimId);
    const events = (eventsOf.get(c.id) ?? []).filter((e) => e.occurredOn <= today).sort(byDay);
    const base = { caseId: c.id, contractId: c.contractId };

    // Steg 3 (och steg 5 tillsammans med det).
    let step3: { id: string | "new"; reachedOn: LocalDate; status: BonusClaimStatus } | null = null;
    const cur3 = active(3);
    if (cur3) step3 = cur3.reachedOn ? { id: cur3.id, reachedOn: cur3.reachedOn, status: cur3.status } : null;
    else {
      const e = events.find((x) => (m.step3EventKinds as readonly string[]).includes(x.kind) && !!x.verificationKind && inResultWindow(c, x.occurredOn, m) && !usedEvent(3, x.id));
      if (e) {
        out.push({ ...base, step: 3, kind: stepKind(3), outcomeEventId: e.id, follows: null, reachedOn: e.occurredOn, verificationKind: e.verificationKind });
        step3 = { id: "new", reachedOn: e.occurredOn, status: "suggested" };
      }
    }
    if (step3 && !active(5) && step3.reachedOn <= speedDeadline(c.startDate, m) && (step3.id === "new" || !usedFollows(5, step3.id))) {
      out.push({ ...base, step: 5, kind: stepKind(5), outcomeEventId: null, follows: step3.id, reachedOn: step3.reachedOn, verificationKind: null });
    }
    // Steg 4: hållbart resultat – steg 3 är skickat eller godkänt och tiden har gått.
    if (step3 && step3.id !== "new" && !active(4) && (step3.status === "submitted" || step3.status === "approved") && today >= sustainDate(step3.reachedOn, m) && !usedFollows(4, step3.id)) {
      out.push({ ...base, step: 4, kind: stepKind(4), outcomeEventId: null, follows: step3.id, reachedOn: sustainDate(step3.reachedOn, m), verificationKind: null });
    }
    // Steg 2: en händelse under insatsen.
    if (!active(2)) {
      const e = events.find((x) => (m.step2EventKinds as readonly string[]).includes(x.kind) && duringInsats(c, x.occurredOn, today) && !usedEvent(2, x.id));
      if (e) out.push({ ...base, step: 2, kind: stepKind(2), outcomeEventId: e.id, follows: null, reachedOn: e.occurredOn, verificationKind: e.verificationKind });
    }
    // Steg 1: närvaron och minst två godkända bedömningar – en gång per ärende.
    if (!claims.some((x) => x.step === 1)) {
      const att = bonusAttendance(db, c, m, env);
      if (att.meets && approvedAssessments(db, c.id).length >= 2) {
        out.push({ ...base, step: 1, kind: stepKind(1), outcomeEventId: null, follows: null, reachedOn: today, verificationKind: null });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- Coachen skapar ett anspråk
/**
 * Varför coachen inte kan skapa ett anspråk för steget, eller null. Insatsen ska ha startat, ärendet får inte ha ett anspråk
 * som räknas för steget, och steg 4 och 5 kräver ett anspråk för steg 3 som inte är avslaget eller återtaget (det nya
 * anspråket bygger på det). Ett avslaget anspråk hindrar inte ett nytt.
 */
export function manualCreateProblem(c: Pick<Case, "startDate" | "status">, claims: readonly Pick<BonusClaim, "id" | "step" | "status">[], step: number): string | null {
  if (!c.startDate || !STARTED_STATUSES.includes(c.status)) return "Insatsen har inte startat. Progression och resultat blir aktuellt när insatsen har startat.";
  if (claims.some((x) => x.step === step && isActiveClaim(x))) return `Det finns redan ett anspråk för steg ${step} i ärendet.`;
  if (FOLLOWS_STEP3.includes(step) && !step3For(claims)) return `Steg ${step} bygger på steg 3. Skapa anspråket för steg 3 först.`;
  return null;
}
/** Anspråket för steg 3 som steg 4 och 5 bygger på: det som räknas (suggested, submitted, approved), annars null. */
export const step3For = <T extends Pick<BonusClaim, "step" | "status">>(claims: readonly T[]): T | null => claims.find((x) => x.step === 3 && isActiveClaim(x)) ?? null;

// ---------------------------------------------------------------- Innan anspråket skickas
export type SubmitContext = {
  claim: Pick<BonusClaim, "step" | "status" | "reachedOn" | "verificationKind" | "verificationOn" | "checklist" | "basis">;
  case: Pick<Case, "startDate" | "endDate">;
  /** Anspråket för steg 3 (steg 4 och 5). */
  step3: Pick<BonusClaim, "status" | "reachedOn"> | null;
  attendance: Pick<BonusAttendance, "meets" | "percent">;
  approvedAssessments: number;
  today: LocalDate;
};
/** Längsta kommentar i underlaget. */
export const BONUS_COMMENT_MAX = 500;
/** Längsta text för var underlaget finns (steg 1) och verifieringens typ. */
export const BONUS_SHORT_MAX = 200;

/**
 * Det som saknas innan anspråket kan skickas till kommunen (tom lista = klart). Texterna är till coachen och innehåller inga
 * personuppgifter.
 */
export function submitProblems(x: SubmitContext, m: BonusModel): string[] {
  const out: string[] = [];
  const { claim: k } = x;
  if (k.status !== "suggested") return ["Anspråket är redan skickat, beslutat eller återtaget."];
  const step = k.step ?? 0;
  if (k.basis.length > BONUS_COMMENT_MAX) out.push(`Kommentaren får vara högst ${BONUS_COMMENT_MAX} tecken.`);
  if (looksLikePnr(k.basis)) out.push("Kommentaren får inte innehålla personnummer.");
  if (step >= 2) {
    if (!k.verificationKind?.trim()) out.push("Fyll i vilken verifiering som finns (till exempel anställningsavtal eller antagningsbesked).");
    if (!k.verificationOn) out.push("Fyll i verifieringens datum.");
    else if (k.verificationOn > x.today) out.push("Verifieringens datum kan inte vara i framtiden.");
    if (k.verificationKind && looksLikePnr(k.verificationKind)) out.push("Verifieringens typ får inte innehålla personnummer.");
  }
  if (step === 1) {
    if (!x.attendance.meets) out.push(`Närvaron är under ${m.attendanceMinPercent} procent.`);
    if (x.approvedAssessments < 2) out.push("Det behövs minst två godkända månadsbedömningar (före och efter).");
    for (const item of BONUS_CHECKLIST_ITEMS) {
      const c = (k.checklist as BonusChecklist)[item];
      if (!c?.done) out.push(`Bocka av: ${BONUS_CHECKLIST_LABEL[item]}.`);
      else if (!c.where.trim()) out.push(`Skriv var underlaget finns: ${BONUS_CHECKLIST_LABEL[item]}.`);
      else if (looksLikePnr(c.where)) out.push("Texten om var underlaget finns får inte innehålla personnummer.");
    }
  }
  if (step === 2 && (!k.reachedOn || !duringInsats(x.case, k.reachedOn, x.today))) out.push("Datumet när steget nåddes ska ligga under insatsen.");
  if (step === 3 && (!k.reachedOn || !inResultWindow(x.case, k.reachedOn, m) || k.reachedOn > x.today)) {
    out.push(`Resultatdatum ska ligga under insatsen eller högst ${m.resultWindowMonthsAfterEnd} månader efter slutdatum.`);
  }
  if (FOLLOWS_STEP3.includes(step)) {
    if (!x.step3 || !(x.step3.status === "submitted" || x.step3.status === "approved")) out.push("Skicka steg 3 till kommunen först.");
    else if (x.step3.reachedOn && step === 5 && x.case.startDate && x.step3.reachedOn > speedDeadline(x.case.startDate, m)) {
      out.push(`Steg 3 nåddes inte inom ${m.speedWeeks} veckor från start.`);
    } else if (x.step3.reachedOn && step === 4) {
      const due = sustainDate(x.step3.reachedOn, m);
      if (x.today < due) out.push(`Hållbart resultat kan skickas tidigast ${due}.`);
      else if (k.verificationOn && k.verificationOn < due) out.push(`Verifieringen ska vara daterad ${due} eller senare (efter ${m.sustainMonths} månader).`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Taket (aldrig avräkning)
export type CapClaim = {
  id: string;
  caseId: string;
  decidedAt: LocalDateTime;
  /** Priset i prislistan den dag kommunen beslutade – null när det inte finns ett riktigt pris (saknas, exempelpris, 0 kr). */
  priceOre: number | null;
  /** Beloppet på en skapad (fryst) faktura – det räknas mot taket i stället för dagens prislista. */
  frozenOre?: number | null;
};
export type CappedAmount = {
  amountOre: number;
  priceOre: number;
  /** Beloppet är lägre än priset (taket). */
  reduced: boolean;
  /** Ett tidigare anspråk i ärendet saknar ett riktigt pris: taket kan inte räknas, raden stoppar fakturan. */
  blocked: boolean;
};
/**
 * Beloppet per godkänt anspråk med taket per ärende: i ordning efter kommunens beslut (decidedAt, sedan id) får varje anspråk
 * min(pris, max(0, tak − summan av de tidigare)). Inget avräknas (offset "never") – stegen läggs ihop upp till taket.
 * Ett fryst anspråk räknas med det fakturerade beloppet. Ett anspråk utan riktigt pris får 0 kr (dess egen prisrad stoppar
 * fakturan) och alla senare anspråk i ärendet blir blocked – de räknas aldrig som om det första vore 0 kr.
 */
export function capAmounts(claims: readonly CapClaim[], capOre: number): Map<string, CappedAmount> {
  const out = new Map<string, CappedAmount>();
  const sorted = [...claims].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : a.id < b.id ? -1 : 1));
  const used = new Map<string, number>();
  const stopped = new Set<string>();
  for (const k of sorted) {
    const before = used.get(k.caseId) ?? 0;
    const price = k.priceOre ?? 0;
    if (k.frozenOre != null) {
      used.set(k.caseId, before + k.frozenOre);
      out.set(k.id, { amountOre: k.frozenOre, priceOre: price, reduced: k.priceOre != null && k.frozenOre < k.priceOre, blocked: false });
      continue;
    }
    if (stopped.has(k.caseId)) {
      out.set(k.id, { amountOre: 0, priceOre: price, reduced: false, blocked: true });
      continue;
    }
    if (k.priceOre == null) {
      stopped.add(k.caseId);
      out.set(k.id, { amountOre: 0, priceOre: 0, reduced: false, blocked: false });
      continue;
    }
    const amountOre = Math.min(k.priceOre, Math.max(0, capOre - before));
    used.set(k.caseId, before + amountOre);
    out.set(k.id, { amountOre, priceOre: k.priceOre, reduced: amountOre < k.priceOre, blocked: false });
  }
  return out;
}
