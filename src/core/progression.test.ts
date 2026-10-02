import { describe, expect, it } from "vitest";
import { noProgressStreak, notificationsFor, progressionWatch, unreadNotifications, weekProgress } from "./progression";
import { mkCase, mkCheckIn, mkProfile, testDb, testEnv } from "./test-data";

const env = testEnv();
// Förra veckan = v. 4 2027 (25–31 jan). Veckan före = v. 3.
const c = mkCase({ id: "c1", caseNumber: "BOT-27-0003", startDate: "2027-01-04", leadCoachId: "u-amira" });

describe("progression per vecka", () => {
  it("godkänd avstämning med veckomålet Ja eller Delvis = progression", () => {
    const db = testDb({ check_ins: [mkCheckIn({ id: "ci", caseId: "c1", heldAt: "2027-01-26T10:00", goalStatus: "partly" })] });
    expect(weekProgress(c, "2027-W04", db)).toEqual({ key: "2027-W04", progress: true, reason: "Veckomålet uppnått helt eller delvis" });
  });
  it("veckomålet Nej, utkast eller ingen avstämning = ingen progression", () => {
    const no = testDb({ check_ins: [mkCheckIn({ id: "ci", caseId: "c1", heldAt: "2027-01-26T10:00", goalStatus: "no" })] });
    expect(weekProgress(c, "2027-W04", no)?.reason).toBe("Veckomålet inte uppnått");
    const draft = testDb({ check_ins: [mkCheckIn({ id: "ci", caseId: "c1", heldAt: "2027-01-26T10:00", status: "draft" })] });
    expect(weekProgress(c, "2027-W04", draft)).toEqual({ key: "2027-W04", progress: false, reason: "Avstämningen är inte godkänd" });
    expect(weekProgress(c, "2027-W04", testDb())).toEqual({ key: "2027-W04", progress: false, reason: "Ingen avstämning dokumenterad" });
  });
  it("startveckan och pausade veckor räknas inte; före start inget värde", () => {
    expect(weekProgress(c, "2027-W01", testDb())).toEqual({ key: "2027-W01", progress: null, reason: "Startvecka" });
    expect(weekProgress({ ...c, pausedWeeks: ["2027-W03"] }, "2027-W03", testDb())).toEqual({ key: "2027-W03", progress: null, reason: "Pausad" });
    expect(weekProgress(c, "2026-W52", testDb())).toBeNull();
  });
});

describe("veckor i rad utan progression", () => {
  const db = testDb({
    cases: [c, mkCase({ id: "c2", caseNumber: "BOT-27-0004", startDate: "2027-01-11", leadCoachId: "u-erik" })],
    check_ins: [mkCheckIn({ id: "ci1", caseId: "c1", heldAt: "2027-01-12T10:00", goalStatus: "yes" }), mkCheckIn({ id: "ci2", caseId: "c2", heldAt: "2027-01-19T10:00", goalStatus: "no" })],
    profiles: [mkProfile({ id: "u-amira", fullName: "Amira Haddad" }), mkProfile({ id: "u-erik", fullName: "Erik Holm" })],
  });
  it("räknar bakåt från förra veckan tills progression eller startvecka", () => {
    expect(noProgressStreak(c, db, env)).toEqual({
      streak: 2,
      weeks: [
        { key: "2027-W03", progress: false, reason: "Ingen avstämning dokumenterad" },
        { key: "2027-W04", progress: false, reason: "Ingen avstämning dokumenterad" },
      ],
    });
  });
  it("påminnelse efter en vecka, eskalering efter två veckor i rad (interna regler)", () => {
    const w = progressionWatch(db, {}, env);
    expect(w.map((x) => [x.case.id, x.streak, x.level, x.lastWeek])).toEqual([["c1", 2, "escalated", "2027-W04"], ["c2", 2, "escalated", "2027-W04"]]);
    const org = { ...env.org, notifications: { ...env.org.notifications, progressionWatch: { ...env.org.notifications.progressionWatch, escalateAfterConsecutiveWeeks: 3 } } };
    expect(progressionWatch(db, { coachId: "u-amira" }, { ...env, org }).map((x) => x.level)).toEqual(["reminder"]);
  });
  it("coachen får påminnelser men aldrig eskaleringen", () => {
    const n = notificationsFor(db, "u-amira", "coach", env);
    expect(n.map((x) => x.id)).toEqual(["nprog:c1:2027-W04"]);
    expect(n[0]).toMatchObject({
      kind: "progress_reminder", title: "Påminnelse: ingen progression 2 veckor i rad", createdAt: "2027-02-01T08:00", channels: ["app", "email"],
      body: "BOT-27-0003: Ingen avstämning dokumenterad (v. 4 2027). Planera nästa steg och dokumentera i veckoavstämningen.",
      emailBody: "Påminnelse från Miljonmatch: ett av dina ärenden (BOT-27-0003) saknar dokumenterad progression. Logga in för att se vilket steg som behövs.",
      readAt: null,
    });
    expect(n.some((x) => x.kind === "progress_escalation")).toBe(false);
  });
  it("chefen får eskaleringen utan personuppgifter i e-posten", () => {
    const n = notificationsFor(db, "u-karin", "chef", env);
    expect(n.map((x) => x.id)).toEqual(["nesc:c1:2027-W04", "nesc:c2:2027-W04"]);
    expect(n[0]).toMatchObject({
      title: "Eskalering: 2 veckor i rad utan progression", visibleToCoach: false,
      body: "BOT-27-0003 · coach Amira Haddad · v. 3 2027: Ingen avstämning dokumenterad · v. 4 2027: Ingen avstämning dokumenterad.",
      emailBody: "Eskalering i Miljonmatch: ett ärende (BOT-27-0003) har 2 veckor i rad utan progression. Logga in för att se detaljerna.",
    });
    expect(notificationsFor(db, "u-sara", "samordnare", env)).toEqual([]);
  });
  it("sparade notiser bara för mottagaren, lästa enligt notification_reads, senaste först", () => {
    const withSaved = testDb({
      ...db,
      user_notifications: [
        { id: "un1", recipientId: "u-amira", kind: "assignment", caseId: "c1", createdAt: "2027-01-04T10:00", channels: ["app", "email"], title: "Nytt ärende tilldelat dig", body: "", emailBody: "" },
        { id: "un2", recipientId: "u-erik", kind: "assignment", caseId: "c2", createdAt: "2027-01-11T10:00", channels: ["app"], title: "Nytt ärende tilldelat dig", body: "", emailBody: "" },
      ],
      notification_reads: [{ id: "u-amira:un1", userId: "u-amira", notificationKey: "un1", readAt: "2027-01-04T11:00" }],
    });
    const n = notificationsFor(withSaved, "u-amira", "coach", env);
    expect(n.map((x) => [x.id, x.readAt])).toEqual([["nprog:c1:2027-W04", null], ["un1", "2027-01-04T11:00"]]);
    expect(unreadNotifications(withSaved, "u-amira", "coach", env)).toBe(1);
    expect(notificationsFor(withSaved, null, "coach", env)).toEqual([]);
  });
});
