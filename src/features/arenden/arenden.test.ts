// Tester för områdets frågor och kommandot "visa personnummer" (ärendelistan, deltagarkortet, handledarens start) mot
// testdatat i minnet. Förväntade värden är den gamla prototypens (prototyp/src/views/arenden.js och MM.sel på samma testdata).
// Beslut 2026-10-07: skyddade personuppgifter är borttagna ur appen – ärendet case-260120 (Omars beställning) är ett vanligt
// ärende. Den vilande spärren prövas genom att slå på den (protect()): ärendet visas då inte alls för den utan full åtkomst.
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { auditView } from "@/features/session/api";
import {
  caseAttendance, caseCard, caseCheckIns, caseDeviations, caseEvents, caseHistory, caseIntake, caseList, caseMessages, caseOverview, casePlacements,
  caseMonthBasis, caseReports, caseRevealPnr, caseTimeline, messageRead, supervisorStart, type CaseCard,
} from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<{ ok: boolean; error?: string; pnr?: string }>;
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const amira = () => as("u-amira", "coach");
const petra = () => as("u-petra", "handledare");
const karin = () => as("u-karin", "chef");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");

const NADIA = "case-260143";
const YUSUF = "case-260148";
const SKYDDAD = "case-260120";
/** Den vilande spärren: personen i SKYDDAD får skyddade personuppgifter (testdatat har inga sedan 2026-10-07). */
const protect = () => rt.store.updateRow("persons", rt.raw().get("cases", SKYDDAD)!.personId, { protectedIdentity: true });
const INGETMOTE = "case-270039";

const card = async (caseId: string, actor: Actor): Promise<CaseCard> => {
  const c = await q(caseCard, { caseId }, actor);
  if (c.kind !== "ok") throw new Error(`Inget kort: ${c.kind}`);
  return c;
};

describe("arenden.lista (arenden.lista)", () => {
  it("antal ärenden per roll som prototypens sel.visibleCases", async () => {
    const counts: Record<string, number> = {};
    for (const [name, a] of [["samordnare", sara()], ["avtalsansvarig", johan()], ["coach", amira()], ["handledare", petra()], ["chef", karin()], ["admin", robin()]] as const) {
      counts[name] = (await q(caseList, {}, a)).rows.length;
    }
    // Beslut 2026-10-09: coach och handledare ser alla ärenden i avtalet (29 respektive 63 före beslutet). Listan markerar de egna.
    expect(counts).toEqual({ samordnare: 231, avtalsansvarig: 231, coach: 231, handledare: 231, chef: 231, admin: 231 });
    expect((await q(caseList, {}, amira())).rows.filter((r) => r.mine)).toHaveLength(29);
    expect((await q(caseList, {}, petra())).rows.filter((r) => r.mine)).toHaveLength(63);
  });

  it("samordnaren: alla ärenden med namn (inga skyddade i testdatat), åtta flaggade ärenden, tre med olästa meddelanden", async () => {
    const m = await q(caseList, {}, sara());
    expect(m.rows.find((r) => r.id === SKYDDAD)).toMatchObject({ caseNumber: "BOT-26-0120", displayName: "Sanna Lindgren" });
    for (const key of ["protectedIdentity", "restricted"]) expect(m.rows[0]).not.toHaveProperty(key);
    expect(m.rows.filter((r) => r.flagged)).toHaveLength(8);
    expect(m.rows.filter((r) => (r.detail?.unread ?? 0) > 0)).toHaveLength(3);
    expect(m.rows.filter((r) => r.status === "active")).toHaveLength(91);
    expect(m.customerName).toBe("Botkyrka kommun");
    expect(m.weeks.label).toBe("v. 1–4");
    expect(m.phases.map((p) => p.no)).toEqual([1, 2, 3, 4, 5]);
    expect(m.areas).toHaveLength(12);
    const nadia = m.rows.find((r) => r.id === NADIA)!;
    expect(nadia.detail).toMatchObject({ areaName: "G Lager och logistik", phase: 4, phaseName: "Praktik/APL", leadCoachName: "Amira Haddad", start: "2026-12-14", end: "2027-02-19" });
    expect(nadia.detail!.attendance).toMatchObject({ planned: 11, present: 8, late: 1, unregistered: 2, rate: 1 });
  });

  it("vilande spärr påslagen: avtalsansvarig ser ärendet med namn; samordnare, chef och coach ser det inte alls (fail-closed)", async () => {
    protect();
    const j = await q(caseList, {}, johan());
    expect(j.rows.find((r) => r.id === SKYDDAD)).toMatchObject({ displayName: "Sanna Lindgren" });
    for (const a of [sara(), karin(), amira()]) expect((await q(caseList, {}, a)).rows.find((r) => r.id === SKYDDAD), a.role).toBeUndefined();
    expect((await q(caseList, {}, sara())).rows).toHaveLength(230);
  });

  it("coach och handledare ser aldrig eskaleringar till chef – chefen gör det", async () => {
    const kinds = async (a: Actor) => (await q(caseList, {}, a)).rows.flatMap((r) => r.detail?.flags ?? []).map((f) => f.kind);
    expect(await kinds(amira())).not.toContain("no_progress_escalated");
    expect(await kinds(petra())).not.toContain("no_progress_escalated");
    expect(await kinds(karin())).toContain("no_progress_escalated");
  });

  it("chef och systemadmin får ingen olästmarkering (läsläge)", async () => {
    const m = await q(caseList, {}, karin());
    expect(m.rows.every((r) => (r.detail?.unread ?? 0) === 0)).toBe(true);
  });

  it("ekonomen når inte ärendelistan", async () => {
    await expect(q(caseList, {}, lars())).rejects.toBeInstanceOf(ApiError);
  });
});

describe("arenden.kort (arende.kort)", () => {
  it("flaggorna på kortet är desamma som i listan (samma regler, räknade på ärendets egna data)", async () => {
    for (const a of [sara(), amira(), karin()]) {
      const list = await q(caseList, {}, a);
      for (const r of list.rows.filter((x) => x.detail && x.flagged).slice(0, 12)) {
        const c = await card(r.id, a);
        expect(c.flags.map((f) => f.key), `${a.role} ${r.caseNumber}`).toEqual(r.detail!.flags.map((f) => f.key));
      }
    }
  });

  it("Nadia som coach: faktauppgifter, maskerat personnummer och kommunens roll för perspektivbytet", async () => {
    const c = await card(NADIA, amira());
    expect(c).toMatchObject({
      caseNumber: "BOT-26-0143", displayName: "Nadia Warsame", access: "full", edit: true, manage: false, readOnly: false, phase: 4, phaseName: "Praktik/APL", phaseCount: 5,
      phaseSince: "2027-01-25", sourceText: "mejl", order: { weeks: 10 }, contactText: "SMS", languageText: "Somaliska", unread: 1, customerRole: "kommun_handlaggare",
      referrer: { name: "Maria Ekdahl", title: "Handläggare", unit: "Arbetsmarknadsenheten Alby" }, buyer: { reference: "4410023817", problem: null },
      firstMeeting: { withinText: "inom en vecka från beställningen" }, keyPersonnelChangeRequiresApproval: true, customerSeesCoachNotes: false,
    });
    expect(c.pnr).toEqual({ masked: "••••••••-9545", canReveal: true, hidden: false });
    expect(c.team.map((t) => `${t.name} (${t.roleLabel})`)).toEqual(["Petra Ek (Yrkesspecifik handledare)", "David Olsson (Arbetsgivarmatchare)"]);
    expect(c.consent).toMatchObject({ value: "given", informedByName: "Amira Haddad", textVersion: "v1.0 (2026-10-01)", language: "lättläst svenska" });
    expect(JSON.stringify(c)).not.toContain("19730216");
  });

  it("utan åtkomst: 'denied' utan ärendenummer – med den vilande spärren påslagen för en annan coach, handledare, samordnare och chef", async () => {
    // Erik är huvudcoach; Amira ser kollegans ärende sedan 2026-10-09.
    expect(await card(SKYDDAD, amira())).toMatchObject({ displayName: "Sanna Lindgren", access: "full", edit: true });
    expect(await q(caseCard, { caseId: "case-finns-inte" }, sara())).toEqual({ kind: "not_found" });
    // Ett vanligt ärende för samordnaren i dag.
    // Omars beställning – prototypens handläggare (Maria) har inte beställt den, så inget perspektivbyte.
    expect(await card(SKYDDAD, sara())).toMatchObject({ displayName: "Sanna Lindgren", contactText: "Telefon", customerRole: null });
    protect();
    expect(await q(caseCard, { caseId: SKYDDAD }, amira())).toEqual({ kind: "denied" });
    expect(await q(caseCard, { caseId: SKYDDAD }, petra())).toEqual({ kind: "denied" });
    expect(await q(caseCard, { caseId: SKYDDAD }, sara())).toEqual({ kind: "denied" });
    expect(await q(caseCard, { caseId: SKYDDAD }, karin())).toEqual({ kind: "denied" });
    const j = await card(SKYDDAD, johan());
    expect(j).toMatchObject({ displayName: "Sanna Lindgren" });
    expect(j).not.toHaveProperty("protectedIdentity");
  });

  it("handledaren: full åtkomst i hela avtalet (beslut 2026-10-09) – alla flikar, men ändrar inte ärendet; teamrollen visas", async () => {
    const c = await card(NADIA, petra());
    expect(c).toMatchObject({ access: "full", edit: false, manage: false, readOnly: false, myTeamRoleLabel: "Yrkesspecifik handledare" });
    expect(c.order).not.toBeNull();
    expect(c.consent).not.toBeNull();
    for (const def of [caseIntake, caseCheckIns, caseMonthBasis, caseDeviations, caseReports, caseMessages, caseHistory, caseOverview, caseTimeline, caseAttendance, casePlacements, caseEvents]) {
      expect(await q(def, { caseId: NADIA }, petra()), def.key).not.toBeNull();
    }
    const ov = (await q(caseOverview, { caseId: NADIA }, petra()))!;
    expect(ov.latest).not.toBeNull();
    // En handledare utanför teamet ser också ärendet – utan teamroll.
    expect(await card(NADIA, as("u-hanna", "handledare"))).toMatchObject({ access: "full", edit: false, myTeamRoleLabel: null });
  });

  it("samordnaren: coacher att byta till med antal aktiva ärenden; första möte som inte är bokat", async () => {
    const c = await card(NADIA, sara());
    expect(c.manage).toBe(true);
    expect(c.coachOptions.map((x) => x.id)).not.toContain("u-amira");
    expect(c.coachOptions.find((x) => x.id === "u-leila")?.active).toBeGreaterThan(0);
    const m = await card(INGETMOTE, sara());
    expect(m).toMatchObject({ status: "confirmed", firstMeetingAt: null, firstMeeting: { dueAt: "2027-02-02T10:40" } });
    expect(m.flags.map((f) => f.kind)).toContain("first_meeting");
  });
});

describe("deltagarkortets flikar", () => {
  it("närvaro för Yusuf: upprepad ogiltig frånvaro enligt avtalets regel och registreringstid från avtalet", async () => {
    const a = (await q(caseAttendance, { caseId: YUSUF }, amira()))!;
    expect(a.repeated).toMatchObject({ absentInvalid: 2, withinDays: 14 });
    expect(a.repeated!.dates).toHaveLength(2);
    expect(a.registerBy).toBe("måndag 10.00");
    expect(a.weeks[0].key).toBe("2027-W05");
    expect(a.past).toHaveLength(10);
  });

  // Beslut 2026-10-07, synpunkt #12: månadsrapporten visar bara närvarograden – internt finns all närvaroinformation kvar.
  it("närvaro internt (synpunkt #12): veckorna, frånvaroorsakerna, upprepad frånvaro och tillfällena finns kvar på fliken Närvaro", async () => {
    const a = (await q(caseAttendance, { caseId: YUSUF }, amira()))!;
    expect(a.weeks.length).toBeGreaterThan(1);
    expect(a.weeks.every((w) => typeof w.stats.planned === "number")).toBe(true);
    expect(a.total.reasons.length).toBeGreaterThan(0);
    expect(a.repeated?.absentInvalid).toBe(2);
    expect(a.past.some((x) => x.attendance?.status === "absent_invalid")).toBe(true);
    // Samma flik för samordnaren och handledaren (internt oförändrat).
    expect((await q(caseAttendance, { caseId: YUSUF }, sara()))?.weeks).toEqual(a.weeks);
  });

  it("avvikelser: ansvariga, förval och uppföljningens tidsgräns (interna regler 16.00)", async () => {
    const d = (await q(caseDeviations, { caseId: YUSUF }, amira()))!;
    expect(d).toMatchObject({ repeated: { count: 2, withinDays: 14 }, defaultOwnerId: "u-amira", defaultFollowUpOn: "2027-02-08", defaultCallAt: "2027-02-03T10:00" });
    expect(d.owners.map((o) => o.label)).toContain("Amira Haddad – Huvudcoach");
    const open = (await q(caseDeviations, { caseId: "case-260117" }, sara()))?.deviations.find((x) => x.open && x.followUpOn);
    if (open) expect(open.due?.dueAt).toBe(`${open.followUpOn}T16:00`);
  });

  it("meddelanden: läskvitton som i prototypen och läsning markerar kommunens meddelanden", async () => {
    let m = (await q(caseMessages, { caseId: NADIA }, amira()))!;
    expect(m.messages.map((x) => x.readText)).toEqual(["Läst av Amira Haddad", "Läst av kommunen 27 jan kl. 13.40", "Oläst"]);
    expect(m.messages[1]).toMatchObject({ mine: true, orgName: "Miljonbemanning AB", senderName: "Amira Haddad" });
    expect(m.messages[0]).toMatchObject({ mine: false, orgName: "Botkyrka kommun" });
    await cmd(messageRead.key, { caseId: NADIA }, amira());
    m = (await q(caseMessages, { caseId: NADIA }, amira()))!;
    expect(m.messages[2].readText).toBe("Läst av Amira Haddad");
    expect((await card(NADIA, amira())).unread).toBe(0);
  });

  it("månadsunderlag och rapporter för Nadia", async () => {
    // Fliken Månadsbedömning blev Månadsunderlag (rapporter steg 2) – se monthbasis.test.ts för hela innehållet.
    const a = (await q(caseMonthBasis, { caseId: NADIA }, amira()))!;
    expect(a).toMatchObject({ month: "2027-01", missingMonth: null, beforeStart: false, delivered: null, canAssess: true });
    expect(a.months.map((x) => [x.month, x.current, x.delivered])).toEqual([["2027-02", true, false], ["2027-01", false, false], ["2026-12", false, true]]);
    expect(a.matrix.months).toEqual(["2026-12"]);
    const r = (await q(caseReports, { caseId: NADIA }, sara()))!;
    expect(r.reports.find((x) => x.id === "rep-16008")).toMatchObject({ kindLabel: "Månadsrapport individ", periodText: "December 2026", statusLabel: "Levererad", correctionVersion: null });
  });

  it("historik: coachen ser bara egna åtgärder, chefen hela revisionsloggen med visningar", async () => {
    await cmd(auditView.key, { action: "case.view", entity: "case", entityId: YUSUF }, karin());
    const coach = (await q(caseHistory, { caseId: YUSUF }, amira()))!;
    expect(coach.ownOnly).toBe(true);
    expect(coach.log.length).toBeGreaterThan(0);
    expect(coach.log.every((x) => x.actorName === "Amira Haddad")).toBe(true);
    expect(coach.log.map((x) => x.text)).toContain("Avstämning godkändes");
    expect(JSON.stringify(coach)).not.toMatch(/Karin Wallin|Öppnade deltagarkortet|eskaler/i);
    const chef = (await q(caseHistory, { caseId: YUSUF }, karin()))!;
    expect(chef.ownOnly).toBe(false);
    expect(chef.log.find((x) => x.actorName === "Karin Wallin")?.text).toBe("Öppnade deltagarkortet");
    expect(chef.items.map((x) => x.title)).toEqual(["Ordererkänd → Bekräftad", "Ordererkänd"]);
  });

  it("kartläggning, avstämningar, händelser och praktik", async () => {
    expect((await q(caseIntake, { caseId: YUSUF }, amira()))!.intake).toMatchObject({ approved: true, chosenTrack: "Restaurangbiträde", approvedByName: "Amira Haddad" });
    const ci = (await q(caseCheckIns, { caseId: YUSUF }, amira()))!.checkIns;
    expect(ci[0]).toMatchObject({ heldAt: "2027-01-18T11:00", goalStatus: "no", overallStatus: "yellow", approved: true });
    const ev = (await q(caseEvents, { caseId: YUSUF }, amira()))!;
    expect(ev).toMatchObject({ checkInContacts: 1, resultDefinitionUnset: true, bonusEnabled: false, result: null });
    const pl = (await q(casePlacements, { caseId: NADIA }, amira()))!;
    expect(pl.placements[0]).toMatchObject({ employerName: "Hallunda Lagerservice AB", status: "ongoing", fourRights: { uppfoljning: false } });
  });
});

describe("arenden.visaPersonnummer", () => {
  it("full åtkomst: hela numret och visningen loggas utan numret i loggen", async () => {
    const before = rt.store.rows("audit_log").length;
    const res = await cmd(caseRevealPnr.key, { caseId: NADIA }, amira());
    expect(res).toEqual({ ok: true, pnr: "19730216-9545" });
    const log = rt.store.rows("audit_log").slice(before);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "pnr.revealed", entity: "person", actorId: "u-amira", details: { caseId: NADIA } });
    expect(JSON.stringify(log[0])).not.toContain("9545");
  });

  it("handledaren och en annan coach ser numret (full åtkomst sedan 2026-10-09) – inte i ett skyddat ärende", async () => {
    expect(await cmd(caseRevealPnr.key, { caseId: NADIA }, petra())).toMatchObject({ ok: true, pnr: "19730216-9545" });
    expect(await cmd(caseRevealPnr.key, { caseId: SKYDDAD }, amira())).toMatchObject({ ok: true });
    // Den vilande spärren: samordnaren, en annan coach och handledaren ser inte personen.
    protect();
    expect(await cmd(caseRevealPnr.key, { caseId: SKYDDAD }, amira())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd(caseRevealPnr.key, { caseId: SKYDDAD }, petra())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd(caseRevealPnr.key, { caseId: SKYDDAD }, sara())).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("arenden.handledare (hand.start)", () => {
  it("Petras tilldelade ärenden, veckans moment och praktik som saknar något av de fyra rätten", async () => {
    const m = await q(supervisorStart, {}, petra());
    expect([m.groups.pagaende.length, m.groups.start.length]).toEqual([26, 1]);
    expect([m.practiceDays, m.vocationalMoments]).toEqual([11, 41]);
    expect(m.missingFour).toEqual([{ caseId: NADIA, caseNumber: "BOT-26-0143", displayName: "Nadia Warsame", employerName: "Hallunda Lagerservice AB", missing: ["uppföljning"] }]);
    expect(m.upcoming.every((a) => a.kind !== "möte")).toBe(true);
    expect(m.groups.pagaende.find((c) => c.id === NADIA)?.myRoleLabel).toBe("Yrkesspecifik handledare");
  });
  it("bara handledare når sidan", async () => {
    await expect(q(supervisorStart, {}, amira())).rejects.toBeInstanceOf(ApiError);
  });
});
