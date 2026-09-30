import { describe, expect, it } from "vitest";
import { alerts } from "./alerts";
import { deadlines } from "./deadlines";
import { mkActivity, mkAttendance, mkBillingRun, mkCase, mkCheckIn, mkDeviation, mkProfile, mkPulseResponse, mkReport, testDb, testEnv } from "./test-data";

const env = testEnv();
const profiles = [mkProfile({ id: "u-amira", fullName: "Amira Haddad" }), mkProfile({ id: "u-erik", fullName: "Erik Holm" }), mkProfile({ id: "k-maria", fullName: "Maria Ekdahl" })];
const memberships = [
  { id: "m1", userId: "u-amira", contractId: "c-bot", role: "coach" as const, customerUnit: null },
  { id: "m2", userId: "u-erik", contractId: "c-bot", role: "coach" as const, customerUnit: null },
];
const recent = (id: string, caseId: string) => mkCheckIn({ id, caseId, heldAt: "2027-01-27T10:00" });

// a: Amira, fastnat i fas 1. b: Erik, upprepad ogiltig frånvaro. c: bekräftad utan bokat första möte.
const db = testDb({
  profiles, memberships,
  cases: [
    mkCase({ id: "a", caseNumber: "BOT-27-0012", startDate: "2027-01-18", phase: 1, leadCoachId: "u-amira" }),
    mkCase({ id: "b", caseNumber: "BOT-26-0148", startDate: "2026-12-01", leadCoachId: "u-erik" }),
    mkCase({ id: "c", caseNumber: "BOT-27-0039", status: "confirmed", referredAt: "2027-01-26T10:40", leadCoachId: "u-amira" }),
    mkCase({ id: "d", caseNumber: "BOT-27-0048", status: "acknowledged", referredAt: "2027-01-29T10:05", leadCoachId: null }),
  ],
  check_ins: [recent("ci-a", "a"), recent("ci-b", "b"), mkCheckIn({ id: "ci-a3", caseId: "a", heldAt: "2027-01-21T10:00" }), mkCheckIn({ id: "ci-b3", caseId: "b", heldAt: "2027-01-19T10:00" })],
  activities: [mkActivity({ id: "x1", caseId: "b", startsAt: "2027-01-20T10:00" }), mkActivity({ id: "x2", caseId: "b", startsAt: "2027-01-27T10:00" }), mkActivity({ id: "x3", caseId: "a", startsAt: "2027-01-29T10:00" })],
  attendance: [
    mkAttendance({ activityId: "x1", caseId: "b", status: "absent_invalid", registeredAt: "2027-01-20T12:00" }),
    mkAttendance({ activityId: "x2", caseId: "b", status: "absent_invalid", registeredAt: "2027-01-27T12:35" }),
  ],
  reports: [
    mkReport({ id: "r-final", kind: "final", caseId: "b", dueAt: "2027-01-29T23:59" }),
    mkReport({ id: "r-month", kind: "monthly", caseId: "a", month: "2027-01", dueAt: "2027-02-05T23:59", provisionalDue: true }),
    mkReport({ id: "r-week", kind: "weekly_attendance", recipientUserId: "k-maria", week: "2027-W04", dueAt: "2027-02-01T16:00", status: "waiting" }),
  ],
  pulse_responses: [mkPulseResponse({ id: "pr1", inviteId: "i1", caseId: "a", submittedAt: "2027-01-20T10:00", answers: { q1: 3, q2: 3, q3: 2, q4: "jobb", q5: "ja" }, contactRequested: true })],
  deviations: [mkDeviation({ id: "dev1", caseId: "a", createdAt: "2027-01-28T10:00", description: "Planen håller inte", followUpOn: "2027-02-04" })],
  billing_runs: [mkBillingRun({ month: "2027-01", status: "draft" })],
});

describe("flaggor", () => {
  it("coachen ser flaggor för egna ärenden, allvarligast först", () => {
    const a = alerts(db, { role: "coach", personaId: "u-amira" }, env);
    expect(a.map((x) => x.key)).toEqual(["nomeeting:c", "stuck:a:1"]);
    expect(a[0]).toMatchObject({
      severity: "critical", title: "Första möte inte bokat", createdAt: "2027-01-29T08:00", href: "/arenden/c",
      text: "BOT-27-0039 mottogs 26 jan 2027. Mötet ska vara bokat inom en vecka (senast 2 feb kl. 10.40).",
    });
    expect(a[1].text).toBe("BOT-27-0012 har varit i fas 1 (Kartläggning) i 14 dagar. Gräns: 10 dagar.");
  });
  it("en annan coach ser sin upprepade frånvaro och försenade slutrapport", () => {
    const a = alerts(db, { role: "coach", personaId: "u-erik" }, env);
    expect(a.map((x) => x.key)).toEqual(["overdue:r-final", "absence:b:at-x2"]);
    expect(a[1]).toMatchObject({
      text: "BOT-26-0148: 2 ogiltiga frånvarotillfällen inom 14 dagar. Förslag: åtgärdsplan och uppföljningsmöte med handläggaren.",
      createdAt: "2027-01-27T12:35", href: "/arenden/b?flik=narvaro",
    });
  });
  it("samordnaren ser alla ärenden och pulssvar där deltagaren vill bli kontaktad", () => {
    expect(alerts(db, { role: "samordnare", personaId: "u-sara" }, env).map((x) => x.key)).toEqual([
      "overdue:r-final", "nomeeting:c", "stuck:a:1", "absence:b:at-x2", "pulse_contact:pr1",
    ]);
  });
  it("lågt betyg på stödet från coachen går bara till chefen", () => {
    const chef = alerts(db, { role: "chef", personaId: "u-karin" }, env);
    expect(chef.map((x) => x.key)).toContain("pulse_low:pr1");
    expect(alerts(db, { role: "coach", personaId: "u-amira" }, env).some((x) => x.kind === "pulse_low")).toBe(false);
  });
  it("kvitterade flaggor visas bara med includeAcked", () => {
    const acked = testDb({ ...db, alert_acks: [{ id: "stuck:a:1", alertKey: "stuck:a:1", acknowledgedBy: "u-amira", acknowledgedAt: "2027-02-01T08:00", actionPlan: "Boka kartläggning" }] });
    expect(alerts(acked, { role: "coach", personaId: "u-amira" }, env).map((x) => x.key)).toEqual(["nomeeting:c"]);
    expect(alerts(acked, { role: "coach", personaId: "u-amira", includeAcked: true }, env).find((x) => x.key === "stuck:a:1")?.ack).toEqual({
      by: "u-amira", at: "2027-02-01T08:00", plan: "Boka kartläggning",
    });
  });
  it("eskalering (två veckor utan progression) bara till chef – coachen får påminnelse", () => {
    const noProg = testDb({ ...db, check_ins: [] });
    const chef = alerts(noProg, { role: "chef", personaId: "u-karin" }, env);
    expect(chef.filter((x) => x.kind === "no_progress_escalated").map((x) => x.key)).toEqual(["noprog_esc:b:2027-W04"]);
    const coach = alerts(noProg, { role: "coach", personaId: "u-erik" }, env);
    expect(coach.some((x) => x.kind === "no_progress_escalated")).toBe(false);
    expect(coach.find((x) => x.kind === "no_progress")?.text).toBe("BOT-26-0148: Ingen avstämning dokumenterad. Planera nästa steg och dokumentera i veckoavstämningen.");
  });
});

describe("deadlines", () => {
  it("allt inom sju dagar och det som är försenat, sorterat på förfallotid", () => {
    const d = deadlines(db, {}, env);
    expect(d.map((x) => [x.id, x.bucket, x.sla.label])).toEqual([
      ["rep:r-final", "overdue", "Försenad 2 dagar"],
      ["reg:u-amira", "today", "48 min kvar"],
      ["avrop:d", "today", "53 min kvar"],
      ["rep:r-week", "today", "6 tim kvar"],
      ["fm:c", "week", "Senast 2 feb kl. 10.40"],
      ["bill:2027-01", "week", "Senast 3 feb kl. 16.00"],
      ["dev:dev1", "week", "Senast 4 feb kl. 16.00"],
      ["rep:r-month", "week", "Senast 5 feb kl. 23.59"],
    ]);
  });
  it("texter, ägare och preliminära förfallotider", () => {
    const d = Object.fromEntries(deadlines(db, {}, env).map((x) => [x.id, x]));
    expect(d["reg:u-amira"]).toMatchObject({ label: "Närvaro vecka 4: 1 tillfällen ej registrerade", count: 1, ownerId: "u-amira", href: "/narvaro?vecka=forra" });
    expect(d["rep:r-week"]).toMatchObject({ label: "Veckorapport v. 4 2027 till Maria Ekdahl", owner: "samordnare", href: "/rapporter/r-week" });
    expect(d["rep:r-month"]).toMatchObject({ label: "Månadsrapport januari 2027", provisional: true, caseId: "a" });
    expect(d["bill:2027-01"]).toMatchObject({ label: "Fakturor för januari 2027 i Fortnox (internt mål: 3 arbetsdagar)", owner: "ekonom", href: "/ekonomi/2027-01" });
    expect(d["avrop:d"]).toMatchObject({ label: "Svar på avrop (acceptera eller avböj)", href: "/inkorg?arende=d" });
    expect(d["reg:u-erik"]).toBeUndefined();
  });
  it("coachens egna deadlines", () => {
    expect(deadlines(db, { coachId: "u-amira" }, env).map((x) => x.id)).toEqual(["reg:u-amira", "fm:c", "dev:dev1", "rep:r-month"]);
  });
});
