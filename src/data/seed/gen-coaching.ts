// Steg 2: aktiviteter, närvaro, avstämningar, avvikelser, AI-utkast, kartläggning, samtycken, praktik och händelser.
// Port av prototyp/src/01-seed.js rad 507–655 – samma ordning på slumpanropen.
import { addDays, addMinutes, diffDays, isWorkingDay, isoWeek, monday } from "@/core/time";
import { uniq } from "@/core/util";
import { ABS_VALID, ACTIVITY_TYPES, AREAS, GOALS, NOTES, NOW, OBSTACLES, TODAY } from "./constants";
import { pad2, type Gen, type PCheckIn } from "./context";
import type { Activity, ActivityKind, Attendance, AttendanceStatus, CheckInMode, EmployerContactCount, GoalStatus, InputMethod, TrafficLight } from "../schema";

export function genActivities(g: Gen) {
  const { r, S, cases } = g;
  const w4Missing = new Set<string>(); // Amiras oregistrerade tillfällen vecka 4
  for (const c of cases) {
    if (!c.startDate || c.startDate > addDays(TODAY, 6)) continue;
    const until = c.status === "closed" ? (c.endDate as string) : addDays(monday(TODAY), 4);
    for (let mon = monday(c.startDate); mon <= until; mon = addDays(mon, 7)) {
      const wk = isoWeek(mon).key;
      const paused = c.pausedWeeks.includes(wk);
      const ph = g.phaseAt(c, mon);
      const mDay = addDays(mon, c.meetingDay as number);
      const plan: { kind: ActivityKind; day: string; time: string; dur: number; loc: string }[] = [
        { kind: "möte", day: mDay, time: c.meetingTime as string, dur: 60, loc: `Miljonbemanning ${c.location}` },
        { kind: "yrkesmoment", day: addDays(mon, c.meetingDay === 2 ? 1 : 2), time: "09:00", dur: 180, loc: `Miljonbemanning ${c.location}` },
        ph >= 4 ? { kind: "praktikdag", day: addDays(mon, 3), time: "08:00", dur: 420, loc: "Praktikplats" } : { kind: "yrkesmoment", day: addDays(mon, c.meetingDay === 3 ? 4 : 3), time: "09:00", dur: 180, loc: `Miljonbemanning ${c.location}` },
      ];
      if (paused) continue;
      const zeroWeek = (c.tags.includes("noll1") && wk === "2027-W03") ? "valid" : (c.tags.includes("noll2") && wk === "2027-W02") ? "invalid" : null;
      const weekAtt: { act: Activity; att: Attendance }[] = [];
      for (const p of plan) {
        if (p.day < c.startDate || (c.endDate && p.day > c.endDate) || !isWorkingDay(p.day)) continue;
        const startsAt = `${p.day}T${p.time}`;
        const act: Activity = { id: g.nid("a"), caseId: c.id, kind: p.kind, startsAt, durationMin: p.dur, location: p.loc, note: "" };
        S.activities.push(act);
        if (startsAt >= NOW) continue;
        if (c.leadCoachId === "u-amira" && wk === "2027-W04" && (c.tags.includes("nadia") || c.tags.includes("elif") || c.tags.includes("amal")) && p.kind !== "möte") { w4Missing.add(act.id); continue; }
        let status = r.weighted<AttendanceStatus>([["present", 85], ["late", 4], ["absent_valid", 7], ["absent_invalid", 4]]);
        if (zeroWeek === "valid") status = "absent_valid";
        if (zeroWeek === "invalid") status = "absent_invalid";
        if (c.tags.includes("yusuf") && (p.day === "2027-01-20" || p.day === "2027-01-27")) status = "absent_invalid";
        if (c.tags.includes("yusuf") && wk >= "2027-W03" && status === "absent_invalid" && !(p.day === "2027-01-20" || p.day === "2027-01-27")) status = "present";
        const reason = status === "absent_valid" ? r.pick(ABS_VALID) : status === "absent_invalid" ? "Uteblev utan att meddela" : "";
        const regAt = `${p.day}T${pad2(Math.min(17, Number(p.time.slice(0, 2)) + Math.ceil(p.dur / 60)))}:${pad2(r.int(0, 50))}`;
        const att: Attendance = { id: g.nid("at"), activityId: act.id, caseId: c.id, status, reason, registeredBy: p.kind === "praktikdag" ? "u-david" : (c.leadCoachId as string), registeredAt: regAt, customerNotifiedAt: null };
        S.attendance.push(att);
        weekAtt.push({ act, att });
      }
      // Veckoavstämning (knuten till mötet)
      const meet = weekAtt.find((x) => x.act.kind === "möte");
      if (meet && (meet.att.status === "present" || meet.att.status === "late") && meet.act.startsAt < NOW) {
        const invalids = weekAtt.filter((x) => x.att.status === "absent_invalid").length;
        let overall: TrafficLight = invalids >= 2 ? "red" : invalids === 1 || r.chance(0.12) ? "yellow" : "green";
        if (r.chance(0.02)) overall = "red";
        if (c.tags.includes("yusuf") && wk === "2027-W04") overall = "red";
        const obstacles = overall === "green" ? (r.chance(0.2) ? [r.pick(OBSTACLES.slice(0, 2))] : []) : [r.pick(OBSTACLES), ...(r.chance(0.4) ? [r.pick(OBSTACLES)] : [])];
        const ec: EmployerContactCount = ph >= 4 ? r.pick<EmployerContactCount>(["1", "2+"]) : ph >= 3 ? r.pick<EmployerContactCount>(["0", "1"]) : "0";
        // Fältordningen styr slumpen: längd, form, arbetssätt, måluppfyllelse, nästa mål, kontakttyp, anteckning, godkänd.
        const id = g.nid("ci");
        const durationMin = r.pick([30, 45, 45, 60]);
        const mode = r.weighted<CheckInMode>([["fysiskt", 80], ["telefon", 12], ["video", 8]]);
        const inputMethod: InputMethod = c.aiConsent === "given" && mon >= "2027-01-04" && r.chance(0.5) ? r.pick<InputMethod>(["ai_recording", "teams", "notes"]) : "manual";
        const goalStatus: GoalStatus = overall === "green" ? r.pick<GoalStatus>(["yes", "yes", "partly"]) : overall === "yellow" ? r.pick<GoalStatus>(["partly", "no"]) : "no";
        const nextGoal = r.pick(GOALS[ph]);
        const activitiesDone = ACTIVITY_TYPES.filter((_, i) => (ph === 1 ? [0] : ph === 2 ? [1, 5] : ph === 3 ? [1, 2, 5] : ph === 4 ? [2, 4, 7] : [5, 6, 7]).includes(i));
        const employerContacts = { count: ec, types: ec === "0" ? [] : [r.pick(["ansökan", "intervju", "praktikkontakt", "studiebesök"])] };
        const note = r.pick(NOTES[overall]);
        const approvedAt = addMinutes(meet.act.startsAt, r.int(65, 180));
        const ci: PCheckIn = {
          id, caseId: c.id, heldAt: meet.act.startsAt, durationMin, mode, inputMethod, goalStatus, nextGoal, phase: ph, activitiesDone: [...activitiesDone],
          employerContacts, overallStatus: overall, obstacles: uniq(obstacles), note, status: "approved", approvedBy: c.leadCoachId, approvedAt, aiRunId: null, docMinutes: null,
        };
        S.checkIns.push(ci);
        ci.docMinutes = ci.inputMethod === "manual" ? r.int(5, 11) : r.int(2, 5);
        if (overall === "red") {
          S.deviations.push({
            id: g.nid("dev"), caseId: c.id, createdAt: addMinutes(meet.act.startsAt, 70),
            description: invalids >= 2 ? "Upprepad ogiltig frånvaro" : "Planen håller inte – behöver omplanering",
            assessment: invalids >= 2 ? "Risk att insatsen avbryts om frånvaron fortsätter." : "Deltagaren behöver annan uppläggning.",
            action: invalids >= 2 ? "Samtal om hinder, ny veckoplan och uppföljningsmöte med handläggaren." : "Uppföljningsmöte med handläggaren och ny plan.",
            ownerId: c.leadCoachId, followUpOn: addDays(meet.act.startsAt.slice(0, 10), 7),
            needsCustomerDecision: invalids >= 2, followUpMeetingAt: null, status: (c.status === "closed" || mon < "2027-01-18") ? "closed" : "open",
          });
        }
      }
    }
  }
  S.w4MissingActivityIds = [...w4Missing];

  // Mehmet: AI-utkast från fredagens möte väntar på granskning
  const mehmet = g.script.mehmet;
  const mehList = S.checkIns.filter((x) => x.caseId === mehmet.id).sort((a, b) => (a.heldAt < b.heldAt ? -1 : a.heldAt > b.heldAt ? 1 : 0));
  const mehFri = mehList[mehList.length - 1];
  if (mehFri) {
    mehFri.status = "draft"; mehFri.approvedAt = null; mehFri.approvedBy = null; mehFri.inputMethod = "ai_recording";
    const run = {
      id: "ai-run-mehmet", caseId: mehmet.id, kind: "transcribe_extract" as const, provider: "Berget AI (test)", model: "KB-Whisper large + öppen språkmodell", status: "succeeded" as const,
      createdAt: addMinutes(mehFri.heldAt, 48), audioSeconds: 2460, costOre: 82, latencyMs: 71000, inputDeletedAt: addMinutes(mehFri.heldAt, 49),
    };
    S.aiRuns.push(run);
    mehFri.aiRunId = run.id;
    mehFri.ai = {
      // Förslag med belägg (citat + tidpunkt i sekunder). Bedömningsfält (samlad status) föreslås aldrig.
      attendanceComment: { value: "Närvarande måndag, tisdag och torsdag. Onsdag frånvaro med giltigt skäl (möte på kommunen), anmäld i förväg.", quote: "Jag var här måndag, tisdag och torsdag. I onsdags var jag på kommunen, det sa jag till om innan.", t: 150 },
      goalStatus: { value: "partly", quote: "Jag hann två leveranser själv, men den tredje åkte jag med Kristina.", t: 312 },
      nextGoal: { value: "Köra hela distributionsrundan själv en dag", quote: "Nästa vecka vill jag köra hela rundan själv på tisdag.", t: 1510 },
      phase: { value: 3, quote: "Vi fortsätter med ruttplaneringen och lastsäkringen.", t: 1622 },
      activitiesDone: { value: ["Yrkesspecifika moment", "CV och ansökningar"], quote: "I onsdags gjorde vi lastsäkring, och så skrev vi om CV:t.", t: 205 },
      employerContacts: { value: { count: "1", types: ["praktikkontakt"] }, quote: "Södertörns Distribution ringde och frågade om praktik i mars.", t: 948 },
      obstacles: { value: ["Språk"], quote: "Ibland förstår jag inte ruttlappen, orden är svåra.", t: 1133 },
      note: { value: "Har kört två leveranser på egen hand. Behöver stöd med yrkesord på ruttlappen. Intresse för praktik hos Södertörns Distribution i mars.", quote: "Framgår av samtalet 03:25–18:53", t: 205 },
      transcript: [
        { t: 150, who: "Deltagare", text: "Jag var här måndag, tisdag och torsdag. I onsdags var jag på kommunen, det sa jag till om innan." },
        { t: 205, who: "Coach", text: "Vad gjorde ni i onsdags?" }, { t: 212, who: "Deltagare", text: "I onsdags gjorde vi lastsäkring, och så skrev vi om CV:t." },
        { t: 312, who: "Deltagare", text: "Jag hann två leveranser själv, men den tredje åkte jag med Kristina." },
        { t: 948, who: "Deltagare", text: "Södertörns Distribution ringde och frågade om praktik i mars." },
        { t: 1133, who: "Deltagare", text: "Ibland förstår jag inte ruttlappen, orden är svåra." },
        { t: 1510, who: "Deltagare", text: "Nästa vecka vill jag köra hela rundan själv på tisdag." },
        { t: 1622, who: "Coach", text: "Vi fortsätter med ruttplaneringen och lastsäkringen." },
      ],
      audioDeletedAt: run.inputDeletedAt, rawTranscriptDeleteBy: addDays(mehFri.heldAt, 30),
    };
    mehFri.goalStatus = null; mehFri.overallStatus = null; mehFri.nextGoal = ""; mehFri.note = ""; mehFri.activitiesDone = []; mehFri.obstacles = []; mehFri.employerContacts = { count: null, types: [] };
    mehFri.tags = ["ai-draft"];
  }

  // Progression: Yusuf utan progression v. 3 och v. 4 (eskaleras), Elif utan progression bara v. 4 (påminnelse)
  for (const ci of S.checkIns.filter((x) => x.caseId === g.script.yusuf.id && x.heldAt >= "2027-01-18" && x.heldAt < "2027-02-01")) { ci.goalStatus = "no"; if (ci.overallStatus === "green") ci.overallStatus = "yellow"; }
  for (const ci of S.checkIns.filter((x) => x.caseId === g.script.elif.id)) {
    ci.goalStatus = ci.heldAt >= "2027-01-25" ? "no" : "yes";
    if (ci.heldAt >= "2027-01-25" && ci.overallStatus === "green") { ci.overallStatus = "yellow"; ci.obstacles = ["Digital vana"]; ci.note = "Hann inte klart med CV:t. Behöver mer tid vid datorn."; }
  }
  for (const ci of S.checkIns.filter((x) => x.caseId === g.script.nadia.id || x.caseId === g.script.hodan.id)) { if (ci.goalStatus === "no") ci.goalStatus = "partly"; }

  // Uppslag för stegen efter (samma resultat som prototypens find/filter – id:n är unika och ordningen bevaras)
  for (const a of S.attendance) if (!g.idx.attendanceByActivity.has(a.activityId)) g.idx.attendanceByActivity.set(a.activityId, a);
  for (const a of S.activities) { const l = g.idx.activitiesByCase.get(a.caseId); if (l) l.push(a); else g.idx.activitiesByCase.set(a.caseId, [a]); }
  for (const ci of S.checkIns) { const l = g.idx.checkInsByCase.get(ci.caseId); if (l) l.push(ci); else g.idx.checkInsByCase.set(ci.caseId, [ci]); }
}

export function genIntakeConsentsPlacements(g: Gen) {
  const { r, S, cases } = g;
  // ---- Kartläggning
  for (const c of cases) {
    if (!c.startDate || c.startDate > TODAY) continue;
    const p = c.personId ? g.idx.personById.get(c.personId) : undefined;
    const approved = !c.tags.includes("amal") && diffDays(c.startDate, TODAY) >= 4;
    const id = g.nid("ia");
    const education = r.pick(["Grundskola i hemlandet", "Gymnasieutbildning", "SFI kurs C", "SFI kurs D", "Påbörjad gymnasieutbildning"]);
    const languageNotes = p && p.language !== "svenska" ? `Förstår vardagssvenska. Modersmål: ${p.language}.` : "Svenska som modersmål.";
    const digitalSkills = r.pick(["Van vid mobil, ovan vid dator", "Använder e-post och BankID själv", "Behöver stöd med digitala tjänster"]);
    const drivingLicence = r.pick(["B-körkort", "Inget körkort", "Inget körkort", "Övningskör"]);
    const areaName = (AREAS.find((a) => a[0] === c.primaryArea) as (typeof AREAS)[number])[1];
    const approvedAt = approved ? `${addDays(c.startDate, r.int(1, 4))}T15:30` : null;
    S.intakeAssessments.push({
      id, caseId: c.id,
      workExperience: (c.backgroundInfo || "").split(".")[0] + ".", education, languageNotes, digitalSkills, drivingLicence,
      workGoals: `Arbete inom ${areaName.toLowerCase()}`,
      chosenTrack: c.tags.includes("amal") ? "" : c.vocationalTrack, adaptations: p ? p.accessibilityNeeds : "", firstWeekGoal: GOALS[1][0],
      status: approved ? "approved" : "draft", approvedBy: approved ? c.leadCoachId : null, approvedAt,
    });
  }

  // ---- Samtycken
  for (const c of cases) {
    if (c.aiConsent === "given") S.consents.push({ id: g.nid("cons"), personId: c.personId as string, caseId: c.id, kind: "recording_and_ai", textVersion: "v1.0 (2026-10-01)", givenAt: c.firstMeetingAt || c.confirmedAt, informedBy: c.leadCoachId as string, language: "lättläst svenska", revokedAt: null });
    if (c.aiConsent === "declined") S.consents.push({ id: g.nid("cons"), personId: c.personId as string, caseId: c.id, kind: "recording_and_ai", textVersion: "v1.0 (2026-10-01)", givenAt: null, declinedAt: c.firstMeetingAt, informedBy: c.leadCoachId as string, language: "lättläst svenska", revokedAt: null });
  }

  // ---- Placeringar (praktik) och händelser
  const empFor = (area: string) => S.employers.find((e) => e.areas.includes(area)) || S.employers[0];
  const empById = (id: string) => S.employers.find((e) => e.id === id) as (typeof S.employers)[number];
  for (const c of cases) {
    if (!c.startDate || c.startDate > TODAY) continue;
    const reachedFour = c.phase >= 4 || (c.status === "closed" && c.resultClass === "result");
    if (reachedFour) {
      const emp = empFor(c.primaryArea);
      const empId = c.tags.includes("nadia") ? "emp-1" : emp.id;
      const start = c.tags.includes("nadia") ? "2027-01-25" : addDays(c.startDate, Math.floor(c.plannedWeeks * 7 * 0.66));
      if (start <= (c.endDate || TODAY)) {
        S.placements.push({
          id: g.nid("pl"), caseId: c.id, employerId: empId, startsOn: start, endsOn: c.endDate || c.plannedEnd,
          tasks: c.tags.includes("nadia") ? "Plock och pack, inleverans, truckkörning under handledning" : `Arbetsuppgifter inom ${c.vocationalTrack.toLowerCase()}`,
          supervisorName: empById(empId).contactName, goals: "Klara arbetsuppgifterna i rätt tempo med stöd av handledaren",
          followUpDates: [addDays(start, 7), addDays(start, 14)], status: c.status === "closed" ? "completed" : "ongoing",
          fourRights: { uppgift: true, handledning: true, timing: true, uppfoljning: !c.tags.includes("nadia") },
        });
        S.outcomeEvents.push({ id: g.nid("oe"), caseId: c.id, kind: "praktik_startad", occurredOn: start, actor: empById(empId).name, verificationKind: "praktikavtal", verificationPath: "praktikavtal.pdf", note: "" });
      }
    }
    if (c.status === "closed" && c.resultClass === "result") {
      const kind = c.endReason === "arbete" ? "arbete_paborjat" : "studier_paborjade";
      const actor = c.endReason === "arbete" ? empFor(c.primaryArea).name : r.pick(["Vuxenutbildningen (Komvux) – yrkesutbildning", "Yrkeshögskola – logistik", "Folkhögskola – allmän kurs"]);
      const id = g.nid("oe");
      S.outcomeEvents.push({
        id, caseId: c.id, kind, occurredOn: addDays(c.endDate as string, r.int(-3, 3)), actor,
        verificationKind: c.resultVerifiedAt ? (c.endReason === "arbete" ? "anställningsbevis" : "antagningsbesked") : null,
        verificationPath: c.resultVerifiedAt ? (c.endReason === "arbete" ? "anstallningsbevis.pdf" : "antagningsbesked.pdf") : null,
        note: c.resultVerifiedAt ? "" : "Muntlig uppgift – verifiering begärd", possibleBonus: c.endReason === "arbete",
      });
    }
    if (c.status === "active" && c.phase >= 4 && r.chance(0.5)) {
      const id = g.nid("oe");
      S.outcomeEvents.push({ id, caseId: c.id, kind: "intervju_arbetsgivarkontakt", occurredOn: addDays(TODAY, -r.int(2, 12)), actor: empFor(c.primaryArea).name, verificationKind: null, verificationPath: null, note: "Anställningsintervju" });
    }
    if (c.tags.includes("hodan")) S.outcomeEvents.push({ id: g.nid("oe"), caseId: c.id, kind: "arbetserbjudande", occurredOn: "2027-01-26", actor: "Tumba Städ & Fastighet AB", verificationKind: "e-post från arbetsgivare", verificationPath: "erbjudande.pdf", note: "Visstidsanställning 75 % från 8 februari" });
  }
  // Några fler arbetserbjudanden bland aktiva i fas 5 (prognos)
  cases.filter((c) => c.status === "active" && c.phase === 5 && !c.tags.includes("hodan")).slice(0, 3).forEach((c) => {
    const id = g.nid("oe");
    S.outcomeEvents.push({ id, caseId: c.id, kind: "arbetserbjudande", occurredOn: addDays(TODAY, -r.int(1, 8)), actor: empFor(c.primaryArea).name, verificationKind: null, verificationPath: null, note: "Erbjudande om provanställning" });
  });
}
