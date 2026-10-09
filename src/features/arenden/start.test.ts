// Starta insatsen, veckoplan, tillfällen, praktik och team (beslut 2026-10-08, skarp drift). Mot testdatat i minnet med
// demoklockan (måndag 1 februari 2027 kl. 09.12): Maria Ekdahls avrop em-101 accepteras med första möte i dag 09.00 och
// insatsen startas av huvudcoachen. Förväntade antal räknas ur veckoplanen och helgdagarna (src/core/schedule.ts).
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { holidayName } from "@/core/holidays";
import { defaultWeekPlan } from "@/core/schedule";
import { dayOf, isWorkingDay, weekday } from "@/core/time";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { inboxDecisionForm, type DecisionForm } from "@/features/inkorg/api";
import { caseCard, supervisorStart, type CaseCardResult, type SupervisorStart } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
type Res = { ok: boolean; error?: string; message?: string } & Record<string, unknown>;
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<Res>;
const sara = () => as("u-sara", "samordnare");
const amira = () => as("u-amira", "coach");
const leila = () => as("u-leila", "coach");
const petra = () => as("u-petra", "handledare");
const lars = () => as("u-lars", "ekonom");

const FIRST_MEETING = "2027-02-01T09:00";
const PLAN = defaultWeekPlan(BOTKYRKA_CONFIG, FIRST_MEETING);
/** Marias avrop (em-101) – ärendet som accepteras och startas. */
const mariaCase = () => rt.raw().get("inbound_emails", "em-101")!.caseId as string;
const activitiesOf = (caseId: string) => rt.raw().all("activities").filter((a) => a.caseId === caseId).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
const auditActions = (caseId: string) => rt.raw().all("audit_log").filter((l) => l.entityId === caseId || (l.details as { caseId?: string })?.caseId === caseId).map((l) => l.action);

/** Accepterar em-101 med Amira som huvudcoach, första möte i dag 09.00 och sex månaders omfattning (planerat slut 31 juli). */
async function acceptMaria(team: { userId: string; role: string }[] = []) {
  const caseId = mariaCase();
  const res = await cmd("arenden.caseAccept", { caseId, leadCoachId: "u-amira", firstMeetingAt: FIRST_MEETING, primaryArea: "G", vocationalTrack: "Lagerarbete", orderPeriodMonths: 6, team }, sara());
  expect(res.ok, res.message).toBe(true);
  return caseId;
}
async function startMaria(startDate = "2027-02-01") {
  const caseId = await acceptMaria();
  const res = await cmd("arenden.caseStart", { caseId, startDate, plan: PLAN }, amira());
  expect(res.ok, res.message).toBe(true);
  return { caseId, res };
}

describe("arenden.caseStart – starta insatsen", () => {
  it("skapar tillfällena för sex månader enligt veckoplanen: inga helgdagar, inga dubbletter, status Pågår och startdatum", async () => {
    const { caseId, res } = await startMaria();
    const c = rt.raw().get("cases", caseId)!;
    expect(c).toMatchObject({ status: "active", startDate: "2027-02-01", plannedEnd: "2027-07-31", meetingDay: 0, meetingTime: "09:00", phaseSince: "2027-02-01" });
    const acts = activitiesOf(caseId);
    // 26 veckor × 3 tillfällen, minus annandag påsk (måndag 29 mars) och Kristi himmelsfärdsdag (torsdag 6 maj) 2027.
    expect(holidayName("2027-03-29")).toBe("Annandag påsk");
    expect(holidayName("2027-05-06")).toBe("Kristi himmelsfärdsdag");
    expect(res.activities).toBe(76);
    expect(acts).toHaveLength(76);
    expect(new Set(acts.map((a) => a.startsAt)).size).toBe(76);
    expect(acts.every((a) => isWorkingDay(a.startsAt) && dayOf(a.startsAt) >= "2027-02-01" && dayOf(a.startsAt) <= "2027-07-31")).toBe(true);
    expect(acts.every((a) => [0, 1, 3].includes(weekday(a.startsAt)))).toBe(true);
    // Första tillfället är första mötet – coachträff måndag 09.00 i 60 minuter.
    expect(acts[0]).toMatchObject({ kind: "möte", startsAt: FIRST_MEETING, durationMin: 60, location: "Miljonbemanning" });
    expect(acts.filter((a) => a.kind === "möte")).toHaveLength(25);
    expect(acts.filter((a) => a.kind === "yrkesmoment")).toHaveLength(51);
    // Statushistorik och revisionslogg (bara id:n och planen – inga personuppgifter).
    const hist = rt.raw().all("case_status_history").filter((h) => h.caseId === caseId);
    expect(hist.at(-1)).toMatchObject({ fromStatus: "confirmed", toStatus: "active", reason: "Insatsen startad", changedBy: "u-amira" });
    const log = rt.raw().all("audit_log").find((l) => l.action === "case.started" && l.entityId === caseId)!;
    expect(log.details).toEqual({ startDate: "2027-02-01", plannedEnd: "2027-07-31", activities: 76, plan: ["måndag 09:00 möte", "tisdag 09:00 yrkesmoment", "torsdag 09:00 yrkesmoment"] });
  });

  it("kan inte startas två gånger, inte utan bokat möte och inte före första mötet", async () => {
    const { caseId } = await startMaria();
    const again = await cmd("arenden.caseStart", { caseId, startDate: "2027-02-01", plan: PLAN }, amira());
    expect(again).toMatchObject({ ok: false, error: "wrong_status" });
    expect(activitiesOf(caseId)).toHaveLength(76);
    // Bekräftat ärende utan bokat möte (testdatats "första mötet inte bokat").
    const noMeeting = await cmd("arenden.caseStart", { caseId: "case-270039", startDate: "2027-02-02", plan: PLAN }, sara());
    expect(noMeeting).toMatchObject({ ok: false, error: "no_meeting" });
    expect(rt.raw().get("cases", "case-270039")!.status).toBe("confirmed");
  });

  it("startdatumet kan inte vara före första mötet, och bara huvudcoachen, samordnaren och avtalsansvarig startar", async () => {
    const caseId = await acceptMaria();
    expect(await cmd("arenden.caseStart", { caseId, startDate: "2027-01-29", plan: PLAN }, amira())).toMatchObject({ ok: false, error: "start_date" });
    // En annan coach ser inte ärendet alls; handledaren får inte köra kommandot.
    expect(await cmd("arenden.caseStart", { caseId, startDate: "2027-02-01", plan: PLAN }, leila())).toMatchObject({ ok: false, error: "not_found" });
    await expect(cmd("arenden.caseStart", { caseId, startDate: "2027-02-01", plan: PLAN }, petra())).rejects.toThrow();
    expect(rt.raw().get("cases", caseId)!.status).toBe("confirmed");
    // Senare start: tillfällena börjar först då.
    const later = await cmd("arenden.caseStart", { caseId, startDate: "2027-02-03", plan: PLAN }, sara());
    expect(later.ok).toBe(true);
    expect(activitiesOf(caseId)[0].startsAt).toBe("2027-02-04T09:00");
  });

  it("deltagarkortet erbjuder starten bara när första mötet är bokat, med avtalets standardplan", async () => {
    const caseId = await acceptMaria();
    const card = (await rt.run("query", caseCard.key, { caseId }, amira())) as CaseCardResult;
    expect(card.kind).toBe("ok");
    if (card.kind !== "ok") return;
    expect(card.start).toEqual({ firstMeetingAt: FIRST_MEETING, startDate: "2027-02-01", plan: PLAN });
    expect(card.weekPlan).toBeNull();
    await cmd("arenden.caseStart", { caseId, startDate: "2027-02-01", plan: PLAN }, amira());
    const after = (await rt.run("query", caseCard.key, { caseId }, amira())) as CaseCardResult;
    if (after.kind !== "ok") throw new Error("kortet");
    expect(after.start).toBeNull();
    expect(after.weekPlan).toEqual(PLAN);
    expect(after.status).toBe("active");
  });
});

describe("arenden.caseScheduleChange, activityAdd och activityRemove", () => {
  it("ändrad veckoplan ersätter framtida tillfällen utan närvaro – registrerad närvaro rörs aldrig", async () => {
    const { caseId } = await startMaria();
    const first = activitiesOf(caseId)[0];
    const reg = await cmd("coach.attendanceSet", { activityId: first.id, status: "present", reason: "" }, amira());
    expect(reg.ok, reg.message).toBe(true);
    // Ny plan: bara ett yrkesmoment på onsdagar.
    const plan = [{ weekday: 2, kind: "yrkesmoment", time: "10:00", durationMin: 120, location: "Miljonbemanning Alby" }];
    const res = await cmd("arenden.caseScheduleChange", { caseId, plan }, amira());
    expect(res.ok, res.message).toBe(true);
    expect(res.removed).toBe(75);
    const acts = activitiesOf(caseId);
    expect(acts.find((a) => a.id === first.id)).toBeTruthy();
    expect(acts.filter((a) => a.id !== first.id).every((a) => weekday(a.startsAt) === 2 && a.startsAt.endsWith("T10:00") && a.durationMin === 120)).toBe(true);
    expect(acts.filter((a) => a.id !== first.id)).toHaveLength(res.added as number);
    expect(acts[1].startsAt).toBe("2027-02-03T10:00");
    expect(rt.raw().all("attendance").filter((x) => x.caseId === caseId)).toHaveLength(1);
    expect(auditActions(caseId)).toContain("case.schedule_changed");
  });

  it("enstaka tillfällen läggs till och tas bort – inte med registrerad närvaro, inte dubbletter, inte före startdatumet", async () => {
    const { caseId } = await startMaria();
    const first = activitiesOf(caseId)[0];
    await cmd("coach.attendanceSet", { activityId: first.id, status: "late", reason: "" }, amira());
    const add = await cmd("arenden.activityAdd", { caseId, kind: "arbetsgivarbesök", startsAt: "2027-02-05T13:00", durationMin: 90, location: "Tumba Städ AB" }, amira());
    expect(add.ok, add.message).toBe(true);
    expect(activitiesOf(caseId)).toHaveLength(77);
    expect(await cmd("arenden.activityAdd", { caseId, kind: "arbetsgivarbesök", startsAt: "2027-02-05T13:00", durationMin: 90, location: "x" }, amira())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await cmd("arenden.activityAdd", { caseId, kind: "annat", startsAt: "2027-01-28T13:00", durationMin: 60, location: "x" }, amira())).toMatchObject({ ok: false, error: "date" });
    expect(await cmd("arenden.activityRemove", { activityId: first.id }, amira())).toMatchObject({ ok: false, error: "has_attendance" });
    const rm = await cmd("arenden.activityRemove", { activityId: add.activityId as string }, amira());
    expect(rm.ok).toBe(true);
    expect(activitiesOf(caseId)).toHaveLength(76);
    expect(auditActions(caseId)).toEqual(expect.arrayContaining(["activity.added", "activity.removed"]));
    // Ekonomen arbetar inte i ärendet.
    await expect(cmd("arenden.activityAdd", { caseId, kind: "annat", startsAt: "2027-02-05T15:00", durationMin: 60, location: "x" }, lars())).rejects.toThrow();
  });
});

describe("praktik.placementCreate och placementEnd", () => {
  it("skapar placeringen, händelsen praktik_startad utan verifiering och praktikdagarna som tillfällen i stället för yrkesmoment", async () => {
    const { caseId } = await startMaria();
    const before = activitiesOf(caseId).length;
    const res = await cmd("praktik.placementCreate", {
      caseId, newEmployer: { name: "Testföretaget AB", city: "Tumba", contactName: "Eva Test", phone: "08-123", email: "eva@example.com" }, supervisorName: "Eva Test",
      startsOn: "2027-02-08", endsOn: "2027-02-19", weekdays: [0, 1, 2, 3, 4], time: "08:00", durationMin: 420, tasks: "Plock och pack",
    }, amira());
    expect(res.ok, res.message).toBe(true);
    expect(res.days).toBe(10);
    const emp = rt.raw().get("employers", res.employerId as string)!;
    expect(emp).toMatchObject({ name: "Testföretaget AB", contactName: "Eva Test", areas: ["G"], createdBy: "u-amira" });
    const pl = rt.raw().get("placements", res.placementId as string)!;
    expect(pl).toMatchObject({ caseId, employerId: emp.id, startsOn: "2027-02-08", endsOn: "2027-02-19", status: "planned", supervisorName: "Eva Test", tasks: "Plock och pack", followUpDates: [] });
    expect(pl.fourRights).toEqual({ uppgift: true, handledning: true, timing: true, uppfoljning: false });
    const ev = rt.raw().all("outcome_events").find((e) => e.caseId === caseId && e.kind === "praktik_startad")!;
    expect(ev).toMatchObject({ occurredOn: "2027-02-08", actor: "Testföretaget AB", verificationKind: null, verificationPath: null, possibleBonus: false });
    const acts = activitiesOf(caseId);
    const practice = acts.filter((a) => a.kind === "praktikdag");
    expect(practice.map((a) => a.startsAt)).toEqual(["2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12", "2027-02-15", "2027-02-16", "2027-02-17", "2027-02-18", "2027-02-19"].map((d) => `${d}T08:00`));
    expect(practice.every((a) => a.location === "Testföretaget AB, Tumba" && a.durationMin === 420)).toBe(true);
    // Yrkesmomenten tisdag och torsdag de två veckorna ersattes (fyra), coachträffarna ligger kvar.
    expect(acts.filter((a) => a.kind === "yrkesmoment" && dayOf(a.startsAt) >= "2027-02-08" && dayOf(a.startsAt) <= "2027-02-19")).toHaveLength(0);
    expect(acts.filter((a) => a.kind === "möte" && dayOf(a.startsAt) >= "2027-02-08" && dayOf(a.startsAt) <= "2027-02-19")).toHaveLength(2);
    expect(acts).toHaveLength(before - 4 + 10);
    expect(auditActions(caseId)).toEqual(expect.arrayContaining(["placement.created", "event.added"]));
    // Avsluta praktiken: praktikdagar efter slutdagen utan närvaro tas bort.
    const end = await cmd("praktik.placementEnd", { placementId: pl.id, endsOn: "2027-02-12" }, amira());
    expect(end).toMatchObject({ ok: true, removed: 5 });
    expect(rt.raw().get("placements", pl.id)).toMatchObject({ status: "completed", endsOn: "2027-02-12" });
    expect(activitiesOf(caseId).filter((a) => a.kind === "praktikdag")).toHaveLength(5);
    expect(await cmd("praktik.placementEnd", { placementId: pl.id, endsOn: "2027-02-12" }, amira())).toMatchObject({ ok: false, error: "wrong_status" });
  });

  it("praktik kräver ett pågående ärende, en arbetsgivare och en rimlig period", async () => {
    const caseId = await acceptMaria();
    const base = { caseId, startsOn: "2027-02-08", weekdays: [0], time: "08:00", durationMin: 420 };
    expect(await cmd("praktik.placementCreate", { ...base, employerId: "emp-1" }, amira())).toMatchObject({ ok: false, error: "wrong_status" });
    await cmd("arenden.caseStart", { caseId, startDate: "2027-02-01", plan: PLAN }, amira());
    expect(await cmd("praktik.placementCreate", { ...base }, amira())).toMatchObject({ ok: false, error: "employer" });
    expect(await cmd("praktik.placementCreate", { ...base, employerId: "emp-1", endsOn: "2027-02-05" }, amira())).toMatchObject({ ok: false, error: "period" });
    expect(await cmd("praktik.placementCreate", { ...base, newEmployer: { name: "X AB", email: "fel" } }, amira())).toMatchObject({ ok: false, error: "email" });
    // Handledaren får inte planera praktik; en annan coach ser inte ärendet.
    await expect(cmd("praktik.placementCreate", { ...base, employerId: "emp-1" }, petra())).rejects.toThrow();
    expect(await cmd("praktik.placementCreate", { ...base, employerId: "emp-1" }, leila())).toMatchObject({ ok: false, error: "not_found" });
    // Befintlig arbetsgivare, utan slutdag: till planerat slut.
    const ok = await cmd("praktik.placementCreate", { ...base, employerId: "emp-1" }, sara());
    expect(ok.ok, ok.message).toBe(true);
    expect(rt.raw().get("placements", ok.placementId as string)).toMatchObject({ employerId: "emp-1", endsOn: null, status: "planned" });
    expect(activitiesOf(caseId).filter((a) => a.kind === "praktikdag").at(-1)!.startsAt).toBe("2027-07-26T08:00");
  });
});

describe("teamet bygger på medlemskapens roller (arenden.caseSetTeam, inkorg.decisionForm)", () => {
  it("handledare utan teamRole kan väljas; arbetsgivarmatchare och SYV ur all MB-personal utom ekonom och admin", async () => {
    rt.store.updateRow("profiles", "u-petra", { teamRole: null });
    const f = (await rt.run("query", inboxDecisionForm.key, { caseId: mariaCase() }, sara())) as DecisionForm;
    expect(f.helpers.find((h) => h.id === "u-petra")).toMatchObject({ teamRole: "vocational_supervisor", label: "yrkesspecifik handledare" });
    const staff = f.staff.map((u) => u.id);
    expect(staff).toEqual(expect.arrayContaining(["u-petra", "u-sara", "u-amira", "u-karin"]));
    expect(staff).not.toContain("u-lars");
    expect(staff).not.toContain("u-robin");
    // Accept med Petra i teamet fungerar utan teamRole i profilen.
    const caseId = await acceptMaria([{ userId: "u-petra", role: "vocational_supervisor" }, { userId: "u-sara", role: "employer_matcher" }]);
    expect(rt.raw().all("case_team").filter((t) => t.caseId === caseId).map((t) => `${t.userId}:${t.role}`).sort()).toEqual(["u-amira:lead_coach", "u-petra:vocational_supervisor", "u-sara:employer_matcher"]);
  });

  it("Ändra team: handledaren ser ärendet direkt, får en notis utan personuppgifter, och ser det inte när hon tas bort", async () => {
    rt.store.updateRow("profiles", "u-petra", { teamRole: null });
    const caseId = await acceptMaria();
    const denied = (await rt.run("query", caseCard.key, { caseId }, petra())) as CaseCardResult;
    expect(denied.kind).toBe("denied");
    const res = await cmd("arenden.caseSetTeam", { caseId, team: [{ userId: "u-petra", role: "vocational_supervisor" }, { userId: "u-leila", role: "guidance_counselor" }] }, sara());
    expect(res).toMatchObject({ ok: true, added: 2, removed: 0 });
    const card = (await rt.run("query", caseCard.key, { caseId }, petra())) as CaseCardResult;
    expect(card.kind).toBe("ok");
    if (card.kind === "ok") expect(card).toMatchObject({ access: "team", myTeamRoleLabel: "Yrkesspecifik handledare" });
    const start = (await rt.run("query", supervisorStart.key, {}, petra())) as SupervisorStart;
    expect(start.groups.start.some((c) => c.id === caseId)).toBe(true);
    const notif = rt.raw().all("user_notifications").filter((n) => n.caseId === caseId && n.recipientId === "u-petra");
    expect(notif).toHaveLength(1);
    expect(notif[0].emailBody).not.toMatch(/Maria|Ekdahl/);
    const log = rt.raw().all("audit_log").find((l) => l.action === "case.team_changed" && l.entityId === caseId)!;
    expect(log.details).toEqual({ added: ["u-petra:vocational_supervisor", "u-leila:guidance_counselor"], removed: [] });
    // Ta bort Petra, behåll Leila: Petra ser inte ärendet längre; huvudcoachen ligger kvar.
    const rm = await cmd("arenden.caseSetTeam", { caseId, team: [{ userId: "u-leila", role: "guidance_counselor" }] }, sara());
    expect(rm).toMatchObject({ ok: true, added: 0, removed: 1 });
    expect(((await rt.run("query", caseCard.key, { caseId }, petra())) as CaseCardResult).kind).toBe("denied");
    expect(((await rt.run("query", supervisorStart.key, {}, petra())) as SupervisorStart).groups.start.some((c) => c.id === caseId)).toBe(false);
    expect(rt.raw().all("case_team").filter((t) => t.caseId === caseId).map((t) => `${t.userId}:${t.role}`).sort()).toEqual(["u-amira:lead_coach", "u-leila:guidance_counselor"]);
    expect(rt.raw().all("user_notifications").filter((n) => n.caseId === caseId && n.recipientId === "u-petra")).toHaveLength(1);
  });

  it("avvisar ekonom och systemadministratör i teamet, samma person i två roller, och bara samordnare och avtalsansvarig ändrar", async () => {
    const caseId = await acceptMaria();
    expect(await cmd("arenden.caseSetTeam", { caseId, team: [{ userId: "u-lars", role: "employer_matcher" }] }, sara())).toMatchObject({ ok: false, error: "team" });
    expect(await cmd("arenden.caseSetTeam", { caseId, team: [{ userId: "u-robin", role: "guidance_counselor" }] }, sara())).toMatchObject({ ok: false, error: "team" });
    expect(await cmd("arenden.caseSetTeam", { caseId, team: [{ userId: "u-petra", role: "vocational_supervisor" }, { userId: "u-petra", role: "employer_matcher" }] }, sara())).toMatchObject({ ok: false, error: "team" });
    await expect(cmd("arenden.caseSetTeam", { caseId, team: [] }, amira())).rejects.toThrow();
    expect(rt.raw().all("case_team").filter((t) => t.caseId === caseId)).toHaveLength(1);
  });
});
