// Steg 1: användare, arbetsgivare, avrop, ärenden, scriptade ärenden, livscykel, team, personer och statushistorik.
// Port av prototyp/src/01-seed.js rad 270–505 – samma ordning på slumpanropen.
import { addDays, addMinutes, addWorkingDays, diffDays, isWorkingDay, monday, timeOf, weekday } from "@/core/time";
import { AREA_WEIGHTS, BACKGROUND, CITIES, EMPLOYERS, FIRST, LANGS, LAST, NEEDS, TODAY, TRACKS } from "./constants";
import { pad2, type Gen, type PCase, type PersonOverride, type PPerson, type PUser } from "./context";
import { luhn } from "./pnr";
import type { EndReason, PreferredContact, TeamRole } from "../schema";

const asciiLower = (s: string, repl: [string, string][]) => repl.reduce((x, [a, b]) => x.replace(a, b), s.toLowerCase());

export function genUsers(g: Gen) {
  const { S } = g;
  let un = 0;
  // Prototypens U(): e-post av för- och efternamn (bara första å/ö/ä byts), telefon 08-000 00 11, 12 …
  const U = (id: string, name: string, title: string, role: string, extra: Partial<PUser> = {}): PUser => {
    const [first, last] = name.split(" ");
    return {
      id, name, title, role, org: "mb",
      email: `${first.toLowerCase()}.${asciiLower(last, [["å", "a"], ["ö", "o"], ["ä", "a"]])}@miljonbemanning.se`,
      phone: "08-000 00 " + String(10 + ++un), active: true, ...extra,
    };
  };
  S.users.push(
    U("u-sara", "Sara Lindqvist", "Operativ samordnare", "samordnare"),
    U("u-johan", "Johan Berg", "Avtalsansvarig (kundansvarig Botkyrka)", "avtalsansvarig"),
    U("u-amira", "Amira Haddad", "Huvudcoach", "coach"),
    U("u-erik", "Erik Sjöberg", "Huvudcoach", "coach"),
    U("u-leila", "Leila Nouri", "Huvudcoach", "coach"),
    U("u-mats", "Mats Holm", "Huvudcoach", "coach"),
    U("u-sofia", "Sofia Grahn", "Huvudcoach", "coach"),
    U("u-petra", "Petra Ek", "Yrkesspecifik handledare – lager, logistik och transport", "handledare", { teamRole: "vocational_supervisor" }),
    U("u-david", "David Olsson", "Arbetsgivarmatchare", "handledare", { teamRole: "employer_matcher" }),
    U("u-hanna", "Hanna Strand", "SYV/metodstöd", "handledare", { teamRole: "guidance_counselor" }),
    U("u-karin", "Karin Wallin", "Verksamhetschef och controller", "chef"),
    U("u-lars", "Lars Nyström", "Ekonom", "ekonom"),
    U("u-robin", "Robin Åberg", "Systemadministratör", "admin"),
  );
  S.buyerReferences.push(
    { id: "br-alby", customer: "Botkyrka kommun", reference: "4410023817", unit: "Arbetsmarknadsenheten Alby", active: true },
    { id: "br-tumba", customer: "Botkyrka kommun", reference: "55102938", unit: "Arbetsmarknadsenheten Tumba", active: true },
    { id: "br-hallunda", customer: "Botkyrka kommun", reference: "7730045120", unit: "Arbetsmarknadsenheten Hallunda–Fittja", active: true },
    { id: "br-tumba-fel", customer: "Botkyrka kommun", reference: "55102983", unit: "Arbetsmarknadsenheten Tumba", active: false, note: "Finns inte hos kommunen. Decemberfakturorna returnerades 2027-01-12." },
  );
  let kn = 0;
  const K = (id: string, name: string, title: string, unit: string, brId: string | null, role = "handlaggare"): PUser => {
    const [first, last] = name.split(" ");
    return {
      id, name, title, unit, buyerReferenceId: brId, role, org: "customer",
      email: `${first.toLowerCase()}.${asciiLower(last, [["ö", "o"], ["ä", "a"], ["å", "a"]])}@botkyrka.se`,
      phone: "08-530 000 " + String(10 + ++kn), active: true, lastLoginAt: null,
    };
  };
  S.customerUsers.push(
    K("k-maria", "Maria Ekdahl", "Handläggare", "Arbetsmarknadsenheten Alby", "br-alby"),
    K("k-ahmed", "Ahmed Yusuf", "Handläggare", "Arbetsmarknadsenheten Tumba", "br-tumba"),
    K("k-linda", "Linda Karlsson", "Handläggare", "Arbetsmarknadsenheten Hallunda–Fittja", "br-hallunda"),
    K("k-omar", "Omar Farah", "Arbetsmarknadscoach", "Arbetsmarknadsenheten Alby", "br-alby"),
    K("k-eva", "Eva Bergström", "Enhetschef", "Arbetsmarknadsenheten", null, "chef"),
  );
  S.customerUsers[0].lastLoginAt = "2027-01-27T13:40";
  for (const [id, name, areas, contact] of EMPLOYERS) {
    const n = S.employers.length;
    S.employers.push({ id, name, orgNr: `55${String(6000000 + n * 7331).slice(0, 4)}-${String(1000 + n * 37)}`, contactName: contact, phone: "08-000 11 " + String(20 + n), email: "kontakt@example.com", areas: [...areas] });
  }
}

/** Avropstillfällen per arbetsdag från 14 september 2026 till i går. */
function genSlots(g: Gen): string[] {
  const { r } = g;
  const perDay = (day: string): number => {
    const m = day.slice(0, 7);
    return m === "2026-09" ? r.weighted([[1, 5], [2, 4]]) : m === "2026-10" ? r.weighted([[2, 5], [3, 4]]) : r.weighted([[2, 5], [3, 5]]);
  };
  const slots: string[] = [];
  for (let day = "2026-09-14"; day < TODAY; day = addDays(day, 1)) {
    if (!isWorkingDay(day)) continue;
    const n = perDay(day);
    const times = Array.from({ length: n }, () => `${pad2(r.int(8, 16))}:${pad2(r.int(0, 11) * 5)}`).sort();
    for (const t of times) slots.push(`${day}T${t}`);
  }
  return slots;
}

const fridayOfWeek = (mondayStr: string) => addDays(mondayStr, 4);
export const nextWorking = (day: string) => {
  let x = day;
  while (!isWorkingDay(x)) x = addDays(x, 1);
  return x;
};

/** Personer: påhittade namn och personnummer med medvetet fel kontrollsiffra. */
function initMakePerson(g: Gen) {
  const { r, S } = g;
  const makePnr = (birthYear: number) => {
    const mm = pad2(r.int(1, 12));
    const dd = pad2(r.int(1, 28));
    const nnn = String(r.int(100, 999));
    const base = `${String(birthYear).slice(2)}${mm}${dd}${nnn}`;
    let check = 0;
    for (let c = 0; c <= 9; c++) { if (luhn(base + c)) { check = c; break; } }
    const wrong = (check + 1 + r.int(0, 7)) % 10; // medvetet fel kontrollsiffra – kan inte tillhöra en verklig person
    return { full: `${birthYear}${mm}${dd}-${nnn}${wrong}`, last4: `${nnn}${wrong}` };
  };
  g.makePerson = (over: PersonOverride = {}): PPerson => {
    const first = over.firstName || r.pick(FIRST);
    const last = over.lastName || r.pick(LAST);
    const by = r.int(1968, 2004);
    const p = makePnr(by);
    const pc = r.weighted<PreferredContact>([["sms", 55], ["phone", 25], ["email", 15], ["letter", 5]]);
    // Fältordningen styr slumpen: id, telefon, e-post, ort, adress, anpassning, språk.
    const id = g.nid("p");
    const phone = `070-${r.int(100, 999)} ${r.int(10, 99)} ${r.int(10, 99)}`;
    const email = `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z.]/g, "") + "@example.com";
    const city = r.pick(CITIES);
    const address = pc === "letter" ? `Exempelvägen ${r.int(1, 60)}, 147 00 Tumba` : null;
    const accessibilityNeeds = r.chance(0.22) ? r.pick(NEEDS) : "";
    const language = r.weighted(LANGS);
    const person: PPerson = {
      id, firstName: first, lastName: last, pnr: p.full, pnrLast4: p.last4, birthYear: by, phone, email, city, address, preferredContact: pc,
      protectedIdentity: false, accessibilityNeeds, language, needsInterpreter: false, ...over,
    };
    if (person.language !== "svenska" && r.chance(0.25)) person.needsInterpreter = true;
    S.persons.push(person);
    g.idx.personById.set(person.id, person);
    return person;
  };
}

export function genCases(g: Gen) {
  const { r, S } = g;
  const slots = genSlots(g);
  initMakePerson(g);
  const coachWeights: [string, number][] = [["u-amira", 11], ["u-erik", 23], ["u-leila", 22], ["u-mats", 22], ["u-sofia", 22]];
  const referrerWeights: [string, number][] = [["k-maria", 30], ["k-ahmed", 25], ["k-linda", 25], ["k-omar", 20]];

  // ---- Skapa ärenden
  const counters: Record<number, number> = { 2026: 0, 2027: 0 };
  const cases = g.cases;
  for (const refAt of slots) {
    const year = Number(refAt.slice(0, 4));
    counters[year]++;
    const number = `BOT-${String(year).slice(2)}-${String(counters[year]).padStart(4, "0")}`;
    const area = r.weighted(AREA_WEIGHTS);
    const referrerId = r.weighted(referrerWeights);
    const plannedWeeks = r.weighted([[4, 14], [5, 8], [6, 15], [7, 12], [8, 16], [10, 35]]);
    const source = r.weighted<PCase["source"]>([["email", 80], ["portal", 15], ["phone", 5]]);
    const ackAt = addMinutes(refAt, r.int(1, 4));
    const due = addWorkingDays(refAt, 1);
    let confirmedAt = addMinutes(refAt, r.int(20, 260));
    if (timeOf(confirmedAt) > "16:45") confirmedAt = `${nextWorking(addDays(refAt.slice(0, 10), 1))}T08:${pad2(r.int(10, 55))}`;
    if (confirmedAt > due) confirmedAt = addMinutes(due, -r.int(5, 60));
    if (r.chance(0.022)) confirmedAt = addMinutes(due, r.int(20, 95)); // enstaka sena svar (syns i KPI)
    let fm = addDays(refAt.slice(0, 10), r.chance(0.03) ? r.int(8, 9) : r.int(2, 6));
    fm = nextWorking(fm);
    const meetTime = r.pick(["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"]);
    const firstMeetingAt = `${fm}T${meetTime}`;
    const startDate = fm;
    const plannedEnd = fridayOfWeek(addDays(monday(startDate), (plannedWeeks - 1) * 7));
    // Fältordningen styr slumpen: sekundärt område, yrkesspår, coach, samtycke, ort.
    const secondaryArea = r.chance(0.5) ? r.pick(["G", "F", "H", "J", "D"].filter((x) => x !== area)) : null;
    const vocationalTrack = r.pick(TRACKS[area]);
    const leadCoachId = r.weighted(coachWeights);
    const aiConsent = r.weighted<PCase["aiConsent"]>([["given", 55], ["declined", 12], ["not_asked", 33]]);
    const location = r.pick(["Alby", "Alby", "Tumba", "Hallunda"]);
    cases.push({
      id: `case-${number.slice(4).replace("-", "")}`, number, contractId: "c-bot", personId: null, status: "active", source,
      referredAt: refAt, referrerId, buyerReference: g.brFor(referrerId), purchaseOrderNumber: null, primaryArea: area, secondaryArea, vocationalTrack,
      desiredStart: addDays(refAt.slice(0, 10), 7), plannedWeeks, plannedEnd, acknowledgedAt: source === "phone" ? refAt : ackAt, confirmedAt,
      firstMeetingAt, startDate, endDate: null, endReason: null, resultClass: null, resultVerifiedAt: null, phase: 1,
      leadCoachId, team: [], backgroundInfo: BACKGROUND[area], aiConsent,
      meetingDay: weekday(startDate), meetingTime: meetTime, location, pausedWeeks: [], tags: [],
      declineReason: null, orderValueWeeks: plannedWeeks, closedAt: null,
    });
  }
  S.caseCounters = { "c-bot:2026": counters[2026], "c-bot:2027": counters[2027] };

  // ---- Scriptade ärenden – väljs som det ärende vars avropsdatum ligger närmast måldatumet.
  const used = new Set<string>();
  const pickCase = (targetDay: string, filter: (c: PCase) => boolean = () => true): PCase => {
    let best: PCase | null = null;
    let bestD = 1e9;
    for (const c of cases) {
      if (used.has(c.id) || !filter(c)) continue;
      const dd = Math.abs(diffDays(targetDay, c.referredAt));
      if (dd < bestD) { best = c; bestD = dd; }
    }
    if (!best) throw new Error("Hittade inget ärende för scriptet");
    used.add(best.id);
    return best;
  };
  const setStart = (c: PCase, startDate: string, weeks: number, time?: string) => {
    c.startDate = startDate; c.plannedWeeks = weeks; c.orderValueWeeks = weeks; c.meetingDay = weekday(startDate);
    if (time) c.meetingTime = time;
    c.firstMeetingAt = `${startDate}T${c.meetingTime}`;
    c.plannedEnd = fridayOfWeek(addDays(monday(startDate), (weeks - 1) * 7));
  };
  const script = g.script;
  const S1 = (tag: string, day: string, fn: (c: PCase) => void, filter?: (c: PCase) => boolean) => {
    const c = pickCase(day, filter);
    c.tags.push(tag);
    script[tag] = c;
    fn(c);
    return c;
  };
  const brFor = g.brFor;
  S1("nadia", "2026-12-08", (c) => { c.leadCoachId = "u-amira"; c.primaryArea = "G"; c.vocationalTrack = "Truckförare A+B"; c.referrerId = "k-maria"; c.buyerReference = brFor("k-maria"); c.aiConsent = "given"; setStart(c, "2026-12-14", 10, "10:00"); c.location = "Alby"; c.backgroundInfo = BACKGROUND.G; c.source = "email"; });
  S1("yusuf", "2026-12-10", (c) => { c.leadCoachId = "u-amira"; c.primaryArea = "D"; c.vocationalTrack = "Restaurangbiträde"; c.referrerId = "k-maria"; c.buyerReference = brFor("k-maria"); c.aiConsent = "declined"; setStart(c, "2026-12-14", 8, "11:00"); c.backgroundInfo = BACKGROUND.D; });
  S1("elif", "2027-01-05", (c) => { c.leadCoachId = "u-amira"; c.primaryArea = "A"; c.vocationalTrack = "Kontor och reception"; c.referrerId = "k-linda"; c.buyerReference = brFor("k-linda"); c.aiConsent = "not_asked"; setStart(c, "2027-01-11", 6, "13:00"); c.backgroundInfo = BACKGROUND.A; });
  S1("hodan", "2026-11-24", (c) => { c.leadCoachId = "u-amira"; c.primaryArea = "F"; c.vocationalTrack = "Lokalvårdare med certifiering"; c.referrerId = "k-maria"; c.buyerReference = brFor("k-maria"); c.aiConsent = "given"; setStart(c, "2026-11-30", 10, "15:00"); c.backgroundInfo = BACKGROUND.F; });
  S1("mehmet", "2026-12-01", (c) => { c.forcePhase = 3; c.phaseSince = "2027-01-04"; c.leadCoachId = "u-amira"; c.primaryArea = "E"; c.vocationalTrack = "Budbil och distribution"; c.referrerId = "k-omar"; c.buyerReference = brFor("k-omar"); c.aiConsent = "given"; setStart(c, "2026-12-11", 10, "13:00"); c.backgroundInfo = BACKGROUND.E; });
  S1("amal", "2027-01-12", (c) => { c.leadCoachId = "u-amira"; c.primaryArea = "H"; c.vocationalTrack = "Butik och kundservice"; c.referrerId = "k-maria"; c.buyerReference = brFor("k-maria"); c.aiConsent = "not_asked"; setStart(c, "2027-01-18", 8, "14:00"); c.backgroundInfo = BACKGROUND.L; c.primaryArea = "L"; c.vocationalTrack = "Individuellt spår"; });
  S1("skyddad", "2026-11-24", (c) => { c.leadCoachId = "u-erik"; c.source = "phone"; c.primaryArea = "F"; c.vocationalTrack = "Lokalvårdare med certifiering"; c.referrerId = "k-omar"; c.buyerReference = brFor("k-omar"); c.aiConsent = "not_applicable"; setStart(c, "2026-12-01", 10, "09:00"); });
  S1("reffel1", "2026-11-23", (c) => { c.referrerId = "k-ahmed"; c.buyerReference = "55102983"; c.leadCoachId = "u-mats"; setStart(c, "2026-11-30", 10); c.primaryArea = "G"; c.vocationalTrack = "Lagerarbetare – plock och pack"; });
  S1("reffel2", "2026-11-25", (c) => { c.referrerId = "k-ahmed"; c.buyerReference = "55102983"; c.leadCoachId = "u-sofia"; setStart(c, "2026-12-01", 10); c.primaryArea = "J"; c.vocationalTrack = "Butikssäljare"; });
  S1("overlapGammal", "2026-12-01", (c) => { c.leadCoachId = "u-leila"; setStart(c, "2026-12-07", 8); c.forcedEnd = { date: "2027-01-12", reason: "avbrott_deltagarens_val" }; });
  S1("overlapNy", "2027-01-05", (c) => { c.leadCoachId = "u-leila"; setStart(c, "2027-01-11", 7); c.primaryArea = "G"; c.vocationalTrack = "Lagerarbetare – plock och pack"; });
  S1("noll1", "2026-12-15", (c) => { c.leadCoachId = "u-erik"; setStart(c, "2026-12-21", 8); });
  S1("noll2", "2026-12-16", (c) => { c.leadCoachId = "u-mats"; setStart(c, "2026-12-21", 10); });
  S1("pausad", "2026-12-02", (c) => { c.leadCoachId = "u-sofia"; setStart(c, "2026-12-07", 10); c.pausedWeeks = ["2027-W02"]; c.pauseReason = "Sjukhusvistelse – uppehåll beslutat av kommunen"; });
  S1("slutsen", "2026-11-12", (c) => { c.leadCoachId = "u-leila"; setStart(c, "2026-11-23", 9); });
  S1("prelim", "2026-11-26", (c) => { c.leadCoachId = "u-mats"; setStart(c, "2026-12-01", 9); c.forcedEnd = { date: "2027-01-29", reason: "arbete", verified: false }; c.primaryArea = "G"; c.vocationalTrack = "Truckförare A+B"; });
  S1("fastnat3", "2026-11-30", (c) => { c.leadCoachId = "u-erik"; setStart(c, "2026-12-07", 10); c.primaryArea = "B"; c.vocationalTrack = "Vård- och omsorgsassistent"; c.forcePhase = 3; c.phaseSince = "2026-12-21"; });
  S1("ingetmote", "2027-01-26", (c) => { c.leadCoachId = "u-sofia"; c.referredAt = "2027-01-26T10:40"; c.confirmedAt = "2027-01-27T09:10"; c.acknowledgedAt = "2027-01-26T10:42"; c.firstMeetingAt = null; c.startDate = null; c.noMeeting = true; }, (c) => c.referredAt.startsWith("2027-01-2"));
  S1("coachbyte", "2026-12-03", (c) => { c.leadCoachId = "u-sofia"; setStart(c, "2026-12-09", 10); c.coachChange = { from: "u-erik", at: "2027-01-11T09:30", reason: "Föräldraledighet – ny huvudcoach från vecka 2" }; });

  // ---- Livscykel per ärende
  g.phaseAt = (c: PCase, day: string): number => {
    if (c.forcePhase && day >= (c.phaseSince || c.startDate || "")) return c.forcePhase;
    const w = Math.floor(diffDays(c.startDate as string, day) / 7) + 1;
    const f = w / c.plannedWeeks;
    if (c.tags.includes("amal")) return 1;
    if (c.tags.includes("nadia")) return w >= 7 ? 4 : w >= 4 ? 3 : w >= 2 ? 2 : 1;
    if (c.tags.includes("hodan")) return w >= 9 ? 5 : w >= 6 ? 4 : w >= 3 ? 3 : w >= 2 ? 2 : 1;
    return f <= 0.15 ? 1 : f <= 0.4 ? 2 : f <= 0.65 ? 3 : f <= 0.85 ? 4 : 5;
  };
  const closed = g.closed;
  for (const c of cases) {
    if (c.noMeeting) { c.status = "confirmed"; continue; }
    if (c.forcedEnd) { c.endDate = c.forcedEnd.date; c.status = "closed"; closed.push(c); continue; }
    const start = c.startDate as string;
    if (start > TODAY) { c.status = "confirmed"; continue; }
    if ((c.plannedEnd as string) < TODAY) {
      c.status = "closed";
      if (r.chance(0.15)) {
        const span = diffDays(start, c.plannedEnd as string);
        c.endDate = nextWorking(addDays(start, r.int(7, Math.max(8, span - 3))));
        if (c.endDate > (c.plannedEnd as string)) c.endDate = c.plannedEnd;
        c.interrupted = true;
      } else c.endDate = c.plannedEnd;
      if (c.tags.includes("slutsen")) { c.endDate = "2027-01-22"; c.interrupted = false; }
      closed.push(c);
    } else c.status = "active";
  }
  // Avslutsorsaker: styr så att resultatgraden hamnar strax över 32 % men under 35 % (bara testdata).
  const EXCL: EndReason[] = ["avbrott_flytt", "avbrott_kommunens_beslut"];
  const excluded: PCase[] = [];
  const counted: PCase[] = [];
  for (const c of closed) {
    if (c.forcedEnd) continue;
    if (c.interrupted && r.chance(0.45)) { c.endReason = r.pick(EXCL); excluded.push(c); } else counted.push(c);
  }
  const scriptedCounted = closed.filter((c) => c.forcedEnd);
  const den = counted.length + scriptedCounted.filter((c) => !EXCL.includes((c.forcedEnd as NonNullable<PCase["forcedEnd"]>).reason)).length;
  const targetVerified = Math.round(0.339 * den);
  const ordered = r.shuffle(counted).sort((a, b) => (b.interrupted ? 0 : 1) - (a.interrupted ? 0 : 1));
  let assigned = 0;
  for (const c of ordered) {
    if (assigned < targetVerified && !c.tags.includes("slutsen")) {
      c.endReason = r.chance(0.7) ? "arbete" : "studier"; c.resultClass = "result"; c.resultVerifiedAt = addDays(c.endDate as string, r.int(1, 6)) + "T10:00"; assigned++;
      if (c.resultVerifiedAt.slice(0, 10) > TODAY) c.resultVerifiedAt = `${TODAY}T08:30`;
    } else {
      c.endReason = c.interrupted ? r.pick<EndReason>(["avbrott_deltagarens_val", "avbrott_ovriga_skal", "avbrott_deltagarens_val"]) : "planerat_utan_resultat";
      c.resultClass = "no_result";
    }
  }
  for (const c of excluded) c.resultClass = "excluded";
  for (const c of scriptedCounted) {
    const fe = c.forcedEnd as NonNullable<PCase["forcedEnd"]>;
    c.endReason = fe.reason;
    if (c.endReason === "arbete" || c.endReason === "studier") { c.resultClass = "result"; c.resultVerifiedAt = fe.verified === false ? null : `${addDays(c.endDate as string, 2)}T10:00`; }
    else c.resultClass = EXCL.includes(c.endReason) ? "excluded" : "no_result";
  }
  // En extra preliminär (ej verifierad) avslut till studier i slutet av januari
  const lateClosed = counted.filter((c) => (c.endDate as string) >= "2027-01-25" && c.resultClass === "no_result");
  if (lateClosed[0]) { const c = lateClosed[0]; c.endReason = "studier"; c.resultClass = "result"; c.resultVerifiedAt = null; c.tags.push("prelim2"); }
  for (const c of closed) c.closedAt = `${c.endDate}T16:${pad2(r.int(0, 50))}`;

  // Fas för aktiva/avslutade
  for (const c of cases) {
    if (!c.startDate) { c.phase = 1; continue; }
    const ref = c.status === "closed" ? (c.endDate as string) : TODAY;
    c.phase = c.status === "closed" ? Math.max(g.phaseAt(c, ref), c.resultClass === "result" ? 5 : 1) : g.phaseAt(c, ref);
  }
  // Amira: fyll på till ca 14 aktiva
  const amiraActive = () => cases.filter((c) => c.leadCoachId === "u-amira" && c.status === "active").length;
  for (const c of cases) { if (amiraActive() >= 14) break; if (c.status === "active" && !c.tags.length && c.leadCoachId !== "u-amira") c.leadCoachId = "u-amira"; }
  // Team
  for (const c of cases) {
    c.team = [{ userId: c.leadCoachId as string, role: "lead_coach" }];
    if (["G", "E", "K"].includes(c.primaryArea)) c.team.push({ userId: "u-petra", role: "vocational_supervisor" });
    if (c.phase >= 4) c.team.push({ userId: "u-david", role: "employer_matcher" });
    if (r.chance(0.3) || c.tags.includes("amal")) c.team.push({ userId: "u-hanna", role: "guidance_counselor" as TeamRole });
  }
  // Personer
  for (const c of cases) {
    if (c.tags.includes("overlapNy")) continue;
    let over: PersonOverride = {};
    if (c.tags.includes("nadia")) over = { firstName: "Nadia", lastName: "Warsame", language: "somaliska", city: "Alby", preferredContact: "sms", accessibilityNeeds: "Behöver skriftliga instruktioner" };
    if (c.tags.includes("yusuf")) over = { firstName: "Yusuf", lastName: "Abdi", language: "somaliska", city: "Fittja", preferredContact: "phone", accessibilityNeeds: "" };
    if (c.tags.includes("elif")) over = { firstName: "Elif", lastName: "Yilmaz", language: "turkiska", city: "Hallunda", preferredContact: "email", accessibilityNeeds: "" };
    if (c.tags.includes("hodan")) over = { firstName: "Hodan", lastName: "Farah", language: "somaliska", city: "Norsborg", preferredContact: "sms", accessibilityNeeds: "" };
    if (c.tags.includes("mehmet")) over = { firstName: "Mehmet", lastName: "Kaya", language: "turkiska", city: "Tumba", preferredContact: "sms", accessibilityNeeds: "Hör dåligt – skriftlig sammanfattning efter möten" };
    if (c.tags.includes("amal")) over = { firstName: "Amal", lastName: "Hassan", language: "arabiska", city: "Alby", preferredContact: "sms", accessibilityNeeds: "Behöver tydlig struktur och schema i förväg", needsInterpreter: true };
    if (c.tags.includes("skyddad")) over = { firstName: "Sanna", lastName: "Lindgren", protectedIdentity: true, address: null, city: "", email: "", phone: "", preferredContact: "phone", language: "svenska", accessibilityNeeds: "" };
    const p = g.makePerson(over);
    c.personId = p.id;
    if (c.tags.includes("overlapGammal")) script.overlapNy.personId = p.id;
  }
  if (!script.overlapNy.personId) script.overlapNy.personId = script.overlapGammal.personId;

  // Statushistorik (inklusive coachbyte)
  for (const c of cases) {
    S.caseStatusHistory.push({ id: g.nid("csh"), caseId: c.id, fromStatus: null, toStatus: "acknowledged", changedBy: "system", changedAt: c.acknowledgedAt, reason: "Ordererkännande skickat automatiskt" });
    if (c.confirmedAt) S.caseStatusHistory.push({ id: g.nid("csh"), caseId: c.id, fromStatus: "acknowledged", toStatus: "confirmed", toCoach: c.coachChange ? c.coachChange.from : c.leadCoachId, changedBy: r.pick(["u-sara", "u-sara", "u-johan"]), changedAt: c.confirmedAt, reason: "Avrop accepterat" });
    if (c.coachChange) S.caseStatusHistory.push({ id: g.nid("csh"), caseId: c.id, fromStatus: "active", toStatus: "active", fromCoach: c.coachChange.from, toCoach: c.leadCoachId, changedBy: "u-sara", changedAt: c.coachChange.at, reason: c.coachChange.reason, customerNotifiedAt: c.coachChange.at });
    if (c.status === "closed") S.caseStatusHistory.push({ id: g.nid("csh"), caseId: c.id, fromStatus: "active", toStatus: "closed", changedBy: c.leadCoachId as string, changedAt: c.closedAt as string, reason: c.endReason as string });
  }
}
