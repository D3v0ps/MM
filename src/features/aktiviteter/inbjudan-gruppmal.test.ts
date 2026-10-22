// Spår G (coachmötet 2026-10-09) genom samma execute() som appen och prototypen, mot testdatat i minnet:
//   * bjud in per yrkesområde eller nivå (Karims beslut 2026-10-22): formuläret ger nivåerna och yrkesområdena med deltagarna,
//     urvalet (selectByGroupings) ger rätt deltagare och hoppar över redan inbjudna och avslutade, och målgruppen (audience) låter
//     servern bjuda in de aktiva deltagarna och hoppa över dem som inte kan vara med
//   * meddelandet till deltagarna: inbjudan, ny tid eller plats, borttagen deltagare och inställd aktivitet – mallen, bara tid,
//     plats och telefonnummer, aldrig för en aktivitet som har börjat, och samordnarens uppgift med den gamla tiden stängs
//   * gruppmålet: alla klarar automatiskt, coachen markerar Klarade inte och ändrar tillbaka – internt: aldrig i veckomål,
//     progression, samlad status, rapporter, resultatfil, export, faktura eller kommunens vyer
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { selectByGroupings } from "@/core/group-activities";
import { listPersonas } from "@/data/actors";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, decodeTestPnr, DEMO_START, normalizePnr } from "@/data/seed";
import { MemoryRepo } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import type { TableName, Tables } from "@/data/schema";
import { detailText, type AuditLookups } from "@/features/admin/audit-text";
import { caseHistory } from "@/features/arenden/api";
import { attendanceSet } from "@/features/coach/api";
import { TEMPLATES } from "@/server/notify/templates";
import "@/api/handlers";
import {
  groupActivityCancel, groupActivityCreate, groupActivityForm, groupActivityInvite, groupActivityRemove, groupActivityUpdate, groupActivityView, groupGoalResultSet,
} from "./api";

const SEED: MemoryData<Tables> = createSeed();
const NADIA = "case-260143";
const ELIF = "case-270003";
const NIVA_2 = "grp-c-bot-niva-2";
const NIVA_3 = "grp-c-bot-niva-3";
/** I övermorgon – aktiviteten har inte börjat (testklockan står på 2027-02-01 09.12). */
const LATER = "2027-02-03T13:00";
/** I dag 08.00 – aktiviteten har startat. */
const STARTED = "2027-02-01T08:00";

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
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const amira = () => as("u-amira", "coach");
const sara = () => as("u-sara", "samordnare");
const audit = (action: string) => rows("audit_log").filter((x) => x.action === action);
const base = { name: "CV-verkstad", kind: "yrkesmoment" as const, startsAt: LATER, durationMin: 90, location: "Miljonbemanning Alby" };
async function create(caseIds: string[], extra: Partial<ParamsOf<typeof groupActivityCreate>> = {}, actor = amira()) {
  const res = await run(groupActivityCreate, { ...base, caseIds, ...extra }, actor);
  if (!res.ok) throw new Error(`${res.error}: ${res.message}`);
  return res;
}
const partsOf = (id: string) => rows("activities").filter((a) => a.groupActivityId === id);
const messages = (template: string) => rows("outbound_messages").filter((m) => m.template === template);

/** Inga namn, personnummer, ärendenummer, aktivitetens namn eller ord om insatsen i utskicken (CLAUDE.md punkt 9). */
function expectOnlyTimePlacePhone(texts: string[]) {
  const pii = rows("persons").flatMap((p) => [p.firstName, p.lastName, p.email, normalizePnr(decodeTestPnr(p.personnummerEnc))]).filter((x) => x && x.length >= 4);
  for (const t of texts) {
    for (const x of pii) expect(t.includes(x), `"${x}" i "${t}"`).toBe(false);
    expect(t).not.toMatch(/BOT-\d|CV-verkstad|arbetsmarknad|insats|kommun|Botkyrka/i);
  }
}

// ================================================================ Bjud in per yrkesområde, nivå eller enskilda
describe("bjud in per yrkesområde eller nivå", () => {
  it("formuläret: avtalets fem nivåer och yrkesområdena med deltagarna (inga fria grupper, inga taggar), och de i nivåerna vars insats inte pågår", async () => {
    rt.store.updateRow("cases", "case-260174", { status: "closed" });
    const f = await q(groupActivityForm, {}, amira());
    expect(f.groupings.filter((g) => g.kind === "level").map((g) => g.name)).toEqual([
      "Nivå 1 – Långt från arbete", "Nivå 2 – Behöver stöd för att komma igång", "Nivå 3 – På väg", "Nivå 4 – Nära arbete", "Nivå 5 – Redo för arbete",
    ]);
    const areas = f.groupings.filter((g) => g.kind === "area");
    expect(areas.map((g) => g.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
    expect(areas.find((g) => g.id === "G")!.name).toBe("G – Lager och logistik");
    expect(f.groupings.every((g) => g.kind === "level" || g.kind === "area")).toBe(true);
    expect(f.groupings.find((g) => g.id === NIVA_3)!.caseIds).toHaveLength(17);
    // Yrkesområdet: de pågående (och pausade) ärendena med yrkesområdet – den avslutade är inte med.
    expect(areas.find((g) => g.id === "E")!.caseIds).toEqual(["case-260130", "case-260167", "case-270009", "case-270016"]);
    expect(areas.find((g) => g.id === "F")!.caseIds).not.toContain("case-260174");
    // Den avslutade deltagaren i nivå 2 är inte en kandidat – den räknas upp med orsaken.
    expect(f.candidates.some((c) => c.caseId === "case-260174")).toBe(false);
    expect(f.others).toEqual([{ caseId: "case-260174", caseNumber: "BOT-26-0174", name: expect.any(String), reason: "Insatsen är avslutad" }]);
  });

  it("urvalet för en nivå och ett yrkesområde: rätt deltagare en gång var – redan inbjudna och avslutade hoppas över med orsaken", async () => {
    rt.store.updateRow("cases", "case-260174", { status: "closed" });
    const f = await q(groupActivityForm, {}, amira());
    // case-260130 hör till både nivå 3 och yrkesområde E – en gång. Linnea (case-260163) är redan inbjuden.
    const sel = selectByGroupings([NIVA_3, "E"], f.groupings, f.candidates, f.others, "2027-02-03", new Set(["case-260163"]));
    expect(sel.invite.map((c) => c.caseId)).toEqual([
      "case-260130", "case-260135", "case-260139", "case-260142", "case-260150", "case-260155", "case-260158", "case-260164", "case-260167", "case-260176",
      "case-260177", "case-260178", "case-260181", "case-270001", "case-270003", "case-270004", "case-270009", "case-270016", "case-270019",
    ]);
    expect(sel.skipped.map((s) => [s.caseId, s.reason])).toEqual([["case-260163", "Redan inbjuden"]]);
    const two = selectByGroupings([NIVA_2], f.groupings, f.candidates, f.others, "2027-02-03", new Set());
    expect(two.invite).toHaveLength(22);
    expect(two.skipped.map((s) => [s.caseId, s.reason])).toEqual([["case-260174", "Insatsen är avslutad"]]);
  });

  it("servern: målgruppen nivå bjuder in de aktiva deltagarna (källan audience) – den som har en annan aktivitet vid samma tid hoppas över; enskilt valda stoppar som förut", async () => {
    const other = await create(["case-260130"], { name: "Annan aktivitet" });
    // Enskilt (utan målgrupp): hela inbjudan stoppas.
    expect(await run(groupActivityCreate, { ...base, caseIds: ["case-260130", "case-260135"] }, amira())).toMatchObject({ ok: false, error: "not_invitable" });
    // Målgrupp och enskilda blandas inte, och målgruppen måste finnas i avtalet.
    expect(await run(groupActivityCreate, { ...base, caseIds: [NADIA], audience: { kind: "level", levelId: NIVA_3 } }, amira())).toMatchObject({ ok: false, error: "audience" });
    expect(await run(groupActivityCreate, { ...base, caseIds: [], audience: { kind: "level", levelId: "grp-finns-inte" } }, amira())).toMatchObject({ ok: false, error: "audience" });
    expect(await run(groupActivityCreate, { ...base, caseIds: [], audience: { kind: "area", areaCode: "Z" } }, amira())).toMatchObject({ ok: false, error: "audience" });
    const res = await create([], { audience: { kind: "level", levelId: NIVA_3 }, via: "niva" });
    // case-260130 är inbjuden till den andra aktiviteten och case-270019 har ett eget tillfälle vid samma tid i testdatat.
    expect(res.invited).toBe(15);
    expect(res.skipped).toEqual([
      { caseId: "case-260130", caseNumber: "BOT-26-0130", reason: "Har en annan aktivitet vid samma tid" },
      { caseId: "case-270019", caseNumber: "BOT-27-0019", reason: "Har en annan aktivitet vid samma tid" },
    ]);
    const parts = partsOf(res.groupActivityId);
    expect(parts).toHaveLength(15);
    expect(parts.every((a) => a.inviteSource === "audience")).toBe(true);
    expect(rows("group_activities").find((g) => g.id === res.groupActivityId)).toMatchObject({ audience: "level", audienceLevelId: NIVA_3, audienceAreaCode: null, seriesId: null, notify: false });
    expect(partsOf(other.groupActivityId)).toHaveLength(1);
    const log = audit("group_activity.created").pop()!;
    expect(log.details).toMatchObject({ count: 15, via: "niva", audience: "level", audienceId: NIVA_3, skippedCaseIds: ["case-260130", "case-270019"] });
    expect(JSON.stringify(log.details)).not.toMatch(/CV-verkstad|Alby|Nivå 3/);
    // En målgruppsrad tas inte bort för hand – byt nivå i stället.
    expect(await run(groupActivityRemove, { id: res.groupActivityId, caseId: ELIF }, amira())).toMatchObject({ ok: false, error: "audience" });
    // Fler kan bjudas in enskilt (källan manual).
    expect(await run(groupActivityInvite, { id: res.groupActivityId, caseIds: [NADIA], via: "enskilda" }, amira())).toMatchObject({ ok: true, invited: 1 });
    expect(partsOf(res.groupActivityId).find((a) => a.caseId === NADIA)!.inviteSource).toBe("manual");
  });

  it("en aktivitet utan målgrupp får ett yrkesområde i efterhand – en gång, och inte efter att den har börjat", async () => {
    const { groupActivityId: id } = await create([NADIA]);
    const inv = await run(groupActivityInvite, { id, caseIds: [], audience: { kind: "area", areaCode: "E" }, via: "omrade" }, amira());
    expect(inv).toMatchObject({ ok: true, invited: 4, already: 0, skipped: [] });
    expect(partsOf(id).map((a) => [a.caseId, a.inviteSource]).sort()).toEqual([
      ["case-260130", "audience"], ["case-260143", "manual"], ["case-260167", "audience"], ["case-270009", "audience"], ["case-270016", "audience"],
    ]);
    expect(audit("group_activity.invited").pop()!.details).toMatchObject({ count: 4, via: "omrade", audience: "area", audienceId: "E" });
    expect(await run(groupActivityInvite, { id, caseIds: [], audience: { kind: "level", levelId: NIVA_3 } }, amira())).toMatchObject({ ok: false, error: "audience" });
    const { groupActivityId: started } = await create([NADIA], { startsAt: STARTED });
    expect(await run(groupActivityInvite, { id: started, caseIds: [], audience: { kind: "area", areaCode: "E" } }, amira())).toMatchObject({ ok: false, error: "audience" });
  });

  it("samma behörighet som förut: chef, systemadministratör, ekonom och kommunen bjuder inte in; formuläret nekas dem", async () => {
    const { groupActivityId } = await create([NADIA]);
    for (const actor of [as("u-karin", "chef"), as("u-robin", "admin"), as("u-lars", "ekonom"), as("k-maria")]) {
      await expect(run(groupActivityInvite, { id: groupActivityId, caseIds: [], audience: { kind: "area", areaCode: "G" }, via: "omrade", notify: true }, actor), actor.role).rejects.toBeInstanceOf(ApiError);
      await expect(q(groupActivityForm, {}, actor), actor.role).rejects.toBeInstanceOf(ApiError);
    }
    // Den vilande rollen handledare: regeln ligger kvar som i RLS.
    expect(await run(groupActivityInvite, { id: groupActivityId, caseIds: [ELIF] }, dormantSupervisor())).toMatchObject({ ok: true, invited: 1 });
  });
});

// ================================================================ Meddelandet till deltagarna
describe("meddelandet till deltagarna", () => {
  it("inbjudan med kryssrutan: ett utskick per deltagare med mallen aktivitetsinbjudan – bara tid, plats och telefonnummer", async () => {
    const res = await create([NADIA, ELIF], { notify: true });
    expect(res.notified).toEqual({ sent: 2, tasks: 0, summary: "Inbjudan skickas till 2 deltagare med e-post." });
    const mail = messages("aktivitetsinbjudan").filter((m) => m.channel === "email");
    expect(mail.map((m) => m.caseId).sort()).toEqual([NADIA, ELIF].sort());
    expect(mail[0].body).toBe("Hej! Du är inbjuden till en aktivitet hos Miljonbemanning onsdag 3 februari kl. 13.00, Miljonbemanning Alby. Frågor? Ring 08-400 22 750.");
    expect(mail.every((m) => m.to === "deltagare (e-post)")).toBe(true);
    expectOnlyTimePlacePhone(messages("aktivitetsinbjudan").flatMap((m) => [m.body, m.subject ?? "", m.to]));
    expect(audit("group_activity.notified").pop()).toMatchObject({
      entityId: res.groupActivityId, details: { template: "aktivitetsinbjudan", caseIds: [NADIA, ELIF].sort(), count: 2, sent: 2, tasks: 0 },
    });
  });

  it("utan kryssrutan, eller för en aktivitet som har börjat: inget meddelande", async () => {
    expect((await create([NADIA], { notify: false })).notified).toBeNull();
    expect((await create([ELIF], { notify: true, startsAt: STARTED })).notified).toBeNull();
    const { groupActivityId } = await create([], { notify: true, startsAt: "2027-02-04T15:00" });
    expect((await run(groupActivityInvite, { id: groupActivityId, caseIds: ["case-270012"] }, amira()))).toMatchObject({ ok: true, notified: null });
    expect(messages("aktivitetsinbjudan")).toEqual([]);
    expect(audit("group_activity.notified")).toEqual([]);
  });

  it("bjud in fler: bara de nya får inbjudan", async () => {
    const { groupActivityId } = await create([NADIA], { notify: true });
    const inv = await run(groupActivityInvite, { id: groupActivityId, caseIds: [NADIA, ELIF], notify: true }, amira());
    expect(inv).toMatchObject({ ok: true, invited: 1, already: 1, notified: { sent: 1, tasks: 0 } });
    expect(messages("aktivitetsinbjudan").filter((m) => m.channel === "email").map((m) => m.caseId)).toEqual([NADIA, ELIF]);
  });

  it("ny tid eller plats: mallen aktivitet_andrad med den tidigare tiden – ingen utringning; en ändrad längd eller namn ger inget meddelande", async () => {
    const { groupActivityId } = await create([NADIA, ELIF], { notify: true });
    const name = await run(groupActivityUpdate, { id: groupActivityId, ...base, name: "CV-verkstad del 2", durationMin: 60, notify: true }, amira());
    expect(name).toMatchObject({ ok: true, notified: null });
    const moved = await run(groupActivityUpdate, {
      id: groupActivityId, ...base, name: "CV-verkstad del 2", durationMin: 60, startsAt: "2027-02-04T10:00", location: "Rum 2", notify: true, replaceOverlapping: true,
    }, amira());
    expect(moved).toMatchObject({ ok: true, notified: { sent: 2, tasks: 0, summary: "Meddelandet om ändringen skickas till 2 deltagare med e-post." } });
    const changed = messages("aktivitet_andrad");
    expect(changed.map((m) => m.channel)).toEqual(["email", "sms", "email", "sms"]);
    expect(changed.some((m) => m.channel === "call")).toBe(false);
    expect(changed[0].body).toBe("Hej! Aktiviteten hos Miljonbemanning onsdag 3 februari kl. 13.00 är ändrad. Nu gäller torsdag 4 februari kl. 10.00, Rum 2. Frågor? Ring 08-400 22 750.");
    expectOnlyTimePlacePhone(changed.flatMap((m) => [m.body, m.subject ?? ""]));
    // Bara platsen ändras: samma mall, och ämnet säger inte att tiden har ändrats.
    const place = await run(groupActivityUpdate, {
      id: groupActivityId, ...base, name: "CV-verkstad del 2", durationMin: 60, startsAt: "2027-02-04T10:00", location: "Rum 3", notify: true,
    }, amira());
    expect(place).toMatchObject({ ok: true, notified: { sent: 2, summary: "Meddelandet om ändringen skickas till 2 deltagare med e-post." } });
    const placeOnly = messages("aktivitet_andrad").slice(4);
    expect(placeOnly.find((m) => m.channel === "email")!.body).toBe(
      "Hej! Aktiviteten hos Miljonbemanning torsdag 4 februari kl. 10.00 är ändrad. Nu gäller torsdag 4 februari kl. 10.00, Rum 3. Frågor? Ring 08-400 22 750.",
    );
    // Mejlets ämne (src/server/notify/templates.ts) gäller både ny tid och ny plats.
    expect(TEMPLATES.aktivitet_andrad.subject).toBe("Ändrad aktivitet hos Miljonbemanning");
  });

  it("ta bort en deltagare och ställa in: mallen aktivitet_installd till dem som inte längre är med", async () => {
    const { groupActivityId } = await create([NADIA, ELIF, "case-270012"], { notify: true });
    expect(await run(groupActivityRemove, { id: groupActivityId, caseId: ELIF, notify: true }, amira())).toMatchObject({ ok: true, notified: { sent: 1 } });
    expect(messages("aktivitet_installd").filter((m) => m.channel === "email").map((m) => m.caseId)).toEqual([ELIF]);
    const res = await run(groupActivityCancel, { id: groupActivityId, notify: true }, amira());
    expect(res).toMatchObject({ ok: true, removed: 2, notified: { sent: 2, tasks: 0, summary: "Meddelandet om inställd aktivitet skickas till 2 deltagare med e-post." } });
    const cancelled = messages("aktivitet_installd").filter((m) => m.channel === "email");
    expect(cancelled.map((m) => m.caseId)).toEqual([ELIF, NADIA, "case-270012"]);
    expect(cancelled[1].body).toBe("Hej! Aktiviteten hos Miljonbemanning onsdag 3 februari kl. 13.00, Miljonbemanning Alby, är inställd. Frågor? Ring 08-400 22 750.");
    expect(messages("aktivitet_installd").some((m) => m.channel === "call")).toBe(false);
    expectOnlyTimePlacePhone(messages("aktivitet_installd").flatMap((m) => [m.body, m.subject ?? ""]));
  });

  it("ingen kanal: samordnaren får en uppgift; när tiden ändras stängs den gamla och en ny skapas med den nya tiden – vid inställd stängs den", async () => {
    const elifPerson = rows("cases").find((c) => c.id === ELIF)!.personId;
    rt.store.updateRow("persons", elifPerson, { email: "", phone: "" });
    const res = await create([NADIA, ELIF], { notify: true });
    expect(res.notified).toEqual({ sent: 1, tasks: 1, summary: "Inbjudan skickas till 1 deltagare med e-post. Samordnaren har fått en uppgift att ringa 1 deltagare." });
    const open = () => rows("tasks").filter((t) => t.kind === "participant_contact" && t.status === "open");
    expect(open().map((t) => t.text)).toEqual([expect.stringMatching(/^Ring deltagaren och bjud in till aktiviteten – ärende BOT-27-0003, onsdag 3 februari kl\. 13\.00, Miljonbemanning Alby\./)]);
    const first = open()[0];
    expect(await run(groupActivityUpdate, { id: res.groupActivityId, ...base, startsAt: "2027-02-04T10:00", notify: true, replaceOverlapping: true }, amira())).toMatchObject({ ok: true });
    expect(rows("tasks").find((t) => t.id === first.id)).toMatchObject({ status: "done", doneBy: "system", doneNote: "Aktiviteten har fått ny tid eller plats." });
    expect(open().map((t) => t.text)).toEqual([expect.stringMatching(/^Ring deltagaren och berätta om aktivitetens nya tid eller plats – ärende BOT-27-0003, torsdag 4 februari kl\. 10\.00/)]);
    const second = open()[0];
    // Inställd utan meddelande: uppgiften med den gamla tiden stängs ändå – ingen ny.
    await run(groupActivityCancel, { id: res.groupActivityId, notify: false }, amira());
    expect(rows("tasks").find((t) => t.id === second.id)).toMatchObject({ status: "done", doneNote: "Aktiviteten är inställd." });
    expect(open()).toEqual([]);
    expectOnlyTimePlacePhone(rows("tasks").filter((t) => t.kind === "participant_contact").map((t) => t.text.replace(/ärende BOT-\d\d-\d{4}/, "ärende")));
  });
});

// ================================================================ Gruppmålet
describe("gruppmålet", () => {
  async function started(goal: string | null = "Alla skriver ett CV", startsAt = STARTED) {
    const res = await create([NADIA, ELIF], { startsAt, goal });
    return res.groupActivityId;
  }
  const view = async (id: string, actor = amira()) => {
    const v = await q(groupActivityView, { id }, actor);
    if (v.kind !== "ok") throw new Error("gate");
    return v;
  };

  it("alla klarar målet automatiskt; coachen markerar Klarade inte och ändrar tillbaka – sparas per deltagare och loggas utan målets text", async () => {
    const id = await started();
    expect(rows("group_activities").find((g) => g.id === id)!.goal).toBe("Alla skriver ett CV");
    let v = await view(id);
    expect(v.activity.goal).toBe("Alla skriver ett CV");
    expect(v.participants.map((p) => [p.caseId, p.goal])).toEqual(expect.arrayContaining([[NADIA, { achieved: true, auto: true }], [ELIF, { achieved: true, auto: true }]]));
    expect(rows("group_goal_results")).toEqual([]);
    // Klarade när det redan är automatiskt: ingenting ändras.
    expect(await run(groupGoalResultSet, { id, caseId: NADIA, achieved: true }, amira())).toEqual({ ok: true, changed: false });
    expect(await run(groupGoalResultSet, { id, caseId: NADIA, achieved: false }, amira())).toEqual({ ok: true, changed: true });
    expect(rows("group_goal_results")).toEqual([expect.objectContaining({ groupActivityId: id, caseId: NADIA, achieved: false, setBy: "u-amira", contractId: "c-bot" })]);
    v = await view(id);
    expect(v.participants.find((p) => p.caseId === NADIA)!.goal).toEqual({ achieved: false, auto: false });
    expect(v.participants.find((p) => p.caseId === ELIF)!.goal).toEqual({ achieved: true, auto: true });
    // Elif är frånvarande: hon står ändå som Klarade automatiskt (Karims beslut 2 – alla klarar tills coachen markerar annat).
    const elifAct = partsOf(id).find((a) => a.caseId === ELIF)!;
    expect(await run(attendanceSet, { activityId: elifAct.id, status: "absent_invalid" }, amira())).toMatchObject({ ok: true });
    v = await view(id);
    expect(v.participants.find((p) => p.caseId === ELIF)).toMatchObject({ attendance: { status: "absent_invalid" }, goal: { achieved: true, auto: true } });
    // Samordnaren ändrar tillbaka: Klarade, inte längre automatiskt.
    expect(await run(groupGoalResultSet, { id, caseId: NADIA, achieved: true }, sara())).toEqual({ ok: true, changed: true });
    expect((await view(id)).participants.find((p) => p.caseId === NADIA)!.goal).toEqual({ achieved: true, auto: false });
    expect(rows("group_goal_results")).toHaveLength(1);
    const logs = audit("group_goal.marked");
    expect(logs.map((x) => [x.actorId, x.details])).toEqual([
      ["u-amira", { caseIds: [NADIA], achieved: false, wasAuto: true }],
      ["u-sara", { caseIds: [NADIA], achieved: true }],
    ]);
    expect(JSON.stringify([...logs, ...audit("group_activity.created")])).not.toMatch(/Alla skriver ett CV/);
    expect(audit("group_activity.created").pop()!.details).toMatchObject({ goal: true });
  });

  it("ett val gäller målet och inbjudan det gjordes för: nytt mål, målet borttaget och inskrivet igen eller ny inbjudan – Klarade automatiskt igen", async () => {
    const id = await started();
    const goalOf = async (caseId: string) => (await view(id)).participants.find((p) => p.caseId === caseId)!.goal;
    const version = () => rows("group_activities").find((g) => g.id === id)!.goalVersion;
    const setGoal = (goal: string, name = base.name) => run(groupActivityUpdate, { id, ...base, name, startsAt: STARTED, goal }, amira());
    expect(version()).toBe(0);
    expect(await run(groupGoalResultSet, { id, caseId: ELIF, achieved: false }, amira())).toEqual({ ok: true, changed: true });
    expect(await goalOf(ELIF)).toEqual({ achieved: false, auto: false });
    // Coachen byter målet: Elif har inte bedömts mot det nya målet.
    expect(await setGoal("Alla söker tre jobb")).toMatchObject({ ok: true, changed: 1 });
    expect(version()).toBe(1);
    expect(await goalOf(ELIF)).toEqual({ achieved: true, auto: true });
    // Klarade ändrar inget (automatiskt); Klarade inte för över raden till det nya målet.
    expect(await run(groupGoalResultSet, { id, caseId: ELIF, achieved: true }, amira())).toEqual({ ok: true, changed: false });
    expect(await run(groupGoalResultSet, { id, caseId: ELIF, achieved: false }, amira())).toEqual({ ok: true, changed: true });
    expect(await goalOf(ELIF)).toEqual({ achieved: false, auto: false });
    expect(rows("group_goal_results")).toEqual([expect.objectContaining({ caseId: ELIF, goalVersion: 1, achieved: false })]);
    expect(audit("group_goal.marked").map((x) => x.details)).toEqual([
      { caseIds: [ELIF], achieved: false, wasAuto: true }, { caseIds: [ELIF], achieved: false, wasAuto: true },
    ]);
    // Ett annat namn ändrar inte målet: valet gäller fortfarande.
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: STARTED, name: "Nytt namn" }, amira())).toMatchObject({ ok: true, changed: 1 });
    expect(version()).toBe(1);
    expect(await goalOf(ELIF)).toEqual({ achieved: false, auto: false });
    // Målet tas bort och skrivs in igen med samma text: ett nytt mål – automatiskt igen.
    expect(await setGoal("", "Nytt namn")).toMatchObject({ ok: true, changed: 1 });
    expect(await setGoal("Alla söker tre jobb", "Nytt namn")).toMatchObject({ ok: true, changed: 1 });
    expect(version()).toBe(3);
    expect(await goalOf(ELIF)).toEqual({ achieved: true, auto: true });
    // Elif markeras igen, tas bort och bjuds in igen: valet gällde den tidigare inbjudan.
    await run(groupGoalResultSet, { id, caseId: ELIF, achieved: false }, amira());
    expect(await goalOf(ELIF)).toEqual({ achieved: false, auto: false });
    expect(await run(groupActivityRemove, { id, caseId: ELIF, notify: false }, amira())).toMatchObject({ ok: true });
    expect(await run(groupActivityInvite, { id, caseIds: [ELIF], notify: false }, amira())).toMatchObject({ ok: true, invited: 1 });
    expect(await goalOf(ELIF)).toEqual({ achieved: true, auto: true });
    expect(await goalOf(NADIA)).toEqual({ achieved: true, auto: true });
  });

  it("utan mål, före start, för en deltagare som inte är inbjuden eller en inställd aktivitet: nekas", async () => {
    const none = await started(null);
    expect((await view(none)).participants.every((p) => p.goal === null)).toBe(true);
    expect(await run(groupGoalResultSet, { id: none, caseId: NADIA, achieved: false }, amira())).toMatchObject({ ok: false, error: "no_goal" });
    const later = (await create([NADIA], { goal: "Mål" })).groupActivityId;
    expect(await run(groupGoalResultSet, { id: later, caseId: NADIA, achieved: false }, amira())).toMatchObject({ ok: false, error: "not_started" });
    const id = await started("Alla skriver ett CV", "2027-02-01T06:00");
    expect(await run(groupGoalResultSet, { id, caseId: "case-270012", achieved: false }, amira())).toMatchObject({ ok: false, error: "not_invited" });
    await run(groupActivityCancel, { id }, amira());
    expect(await run(groupGoalResultSet, { id, caseId: NADIA, achieved: false }, amira())).toMatchObject({ ok: false, error: "cancelled" });
    expect(rows("group_goal_results")).toEqual([]);
  });

  it("målet skrivs när aktiviteten skapas eller ändras – tom text tar bort det, personnummer stoppas, högst 300 tecken", async () => {
    const id = await started(null);
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: STARTED, goal: "Alla gör en intervju" }, amira())).toMatchObject({ ok: true, changed: 1 });
    const updated = audit("group_activity.updated").pop()!;
    expect(updated.details).toMatchObject({ fields: ["goal"] });
    expect(JSON.stringify(audit("group_activity.updated"))).not.toMatch(/intervju/);
    // Kortets Historik och adminens revisionslogg skriver fältet på svenska – aldrig kodordet goal.
    const history = (await q(caseHistory, { caseId: NADIA }, as("u-karin", "chef")))!.log.filter((x) => x.text === "Gruppaktiviteten ändrades");
    expect(history.map((x) => x.sub)).toEqual(["Ändrat: gruppmål"]);
    const l: AuditLookups = { userName: () => null, caseNumber: () => null, kpiLabel: () => null, templateLabel: (k) => k };
    const admin = detailText({ action: updated.action, entity: updated.entity, entityId: updated.entityId, details: { fields: updated.details.fields } }, l);
    expect(admin).toMatch(/gruppmål/);
    expect(admin).not.toMatch(/goal/);
    expect(rows("group_activities").find((g) => g.id === id)!.goal).toBe("Alla gör en intervju");
    // Utelämnat: oförändrat.
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: STARTED, name: "Nytt namn" }, amira())).toMatchObject({ ok: true, changed: 1 });
    expect(rows("group_activities").find((g) => g.id === id)!.goal).toBe("Alla gör en intervju");
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: STARTED, name: "Nytt namn", goal: "Ring 19900101-1234" }, amira())).toMatchObject({ ok: false, error: "goal" });
    await expect(run(groupActivityUpdate, { id, ...base, startsAt: STARTED, name: "Nytt namn", goal: "x".repeat(301) }, amira())).rejects.toBeInstanceOf(ApiError);
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: STARTED, name: "Nytt namn", goal: "  " }, amira())).toMatchObject({ ok: true, changed: 1 });
    expect(rows("group_activities").find((g) => g.id === id)!.goal).toBeNull();
  });

  it("behörighet: chef och systemadministratör ser målet men markerar inte; ekonomen och kommunen varken ser eller markerar", async () => {
    const id = await started();
    await run(groupGoalResultSet, { id, caseId: NADIA, achieved: false }, amira());
    expect((await view(id, as("u-karin", "chef"))).participants.find((p) => p.caseId === NADIA)!.goal).toEqual({ achieved: false, auto: false });
    for (const actor of [as("u-karin", "chef"), as("u-robin", "admin"), as("u-lars", "ekonom"), as("k-maria")]) {
      await expect(run(groupGoalResultSet, { id, caseId: ELIF, achieved: false }, actor), actor.role).rejects.toBeInstanceOf(ApiError);
    }
    for (const actor of [as("u-lars", "ekonom"), as("k-maria")]) {
      await expect(q(groupActivityView, { id }, actor), actor.role).rejects.toBeInstanceOf(ApiError);
      const repo = new MemoryRepo<Tables>(rt.store, actor, POLICIES);
      expect(await repo.table("group_goal_results").count(), actor.role).toBe(0);
      expect(await repo.table("group_activities").count(), actor.role).toBe(0);
    }
  });
});

describe("gruppmålet är internt: aldrig veckomål, progression, samlad status, rapporter, resultatfil, export, faktura eller kommunen", () => {
  const SECRET = "HEMLIGT-GRUPPMÅL-4711";
  /** Allt som kommunen, rapporterna, exporterna, fakturan och coachens bedömningsvyer visar för Nadia och avtalet. */
  async function outputs() {
    // Samma klockslag varje omgång (testklockan går framåt medan testet körs).
    rt.clock.set("2027-02-01T10:00");
    const maria = as("k-maria");
    const johan = as("u-johan", "avtalsansvarig");
    const lars = as("u-lars", "ekonom");
    const out: Record<string, unknown> = {
      "kommun.start": await rt.run("query", "kommun.start", {}, maria),
      "kommun.deltagareLista": await rt.run("query", "kommun.deltagareLista", {}, maria),
      "kommun.deltagare": await rt.run("query", "kommun.deltagare", { caseId: NADIA }, maria),
      "kommun.rapporter": await rt.run("query", "kommun.rapporter", {}, maria),
      "rapporter.dokument": await rt.run("query", "rapporter.dokument", { reportId: "rep-16008" }, sara()),
      "rapporter.dokument kommun": await rt.run("query", "rapporter.dokument", { reportId: "rep-16008" }, maria),
      "ekonomi.csv": await rt.run("query", "ekonomi.csv", { month: "2027-02" }, lars),
      "ekonomi.run": await rt.run("query", "ekonomi.run", { month: "2027-02" }, lars),
      // Veckomålet och fasen (mötesrapporten), månadsbedömningen med progressionen och kortets samlade status.
      "coach.checkInPage": await rt.run("query", "coach.checkInPage", { caseId: NADIA }, amira()),
      "coach.assessmentPage": await rt.run("query", "coach.assessmentPage", { caseId: NADIA, month: "2027-02" }, amira()),
      "arenden.kortOversikt": await rt.run("query", "arenden.kortOversikt", { caseId: NADIA }, amira()),
      "arenden.lista": await rt.run("query", "arenden.lista", {}, sara()),
    };
    for (const table of ["resultat", "progression", "handelser", "avslut", "faltbeskrivning"] as const) {
      out[`resultatfil ${table}`] = await rt.run("command", "rapporter.resultatfilExport", { contractId: "c-bot", from: "2026-09", to: "2027-02", format: "csv", table }, johan);
    }
    for (const id of ["sr-seed-privat", "sr-seed-mb", "sr-seed-kommun"]) {
      const owner = rt.raw().get("saved_reports", id)!.ownerId;
      const actor = listPersonas(rt.raw()).find((p) => p.actor.userId === owner)!.actor;
      out[`byggExport ${id}`] = await rt.run("command", "rapporter.byggExport", { savedReportId: id, format: "csv" }, actor);
    }
    return out;
  }

  it("samma svar före och efter att målet skrivits och Nadia markerats Klarade inte – och målet syns ingenstans", async () => {
    const { groupActivityId: id } = await create([NADIA, ELIF], { startsAt: STARTED });
    for (const a of partsOf(id)) expect(await run(attendanceSet, { activityId: a.id, status: "present" }, amira())).toMatchObject({ ok: true });
    // En första omgång: rapportens ögonblicksbild sparas första gången dokumentet läses (needsSnapshot) – sedan är svaren stabila.
    await outputs();
    const before = await outputs();
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: STARTED, goal: SECRET }, amira())).toMatchObject({ ok: true });
    expect(await run(groupGoalResultSet, { id, caseId: NADIA, achieved: false }, amira())).toMatchObject({ ok: true, changed: true });
    const after = await outputs();
    for (const key of Object.keys(before)) {
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
      expect(JSON.stringify(after[key]), key).not.toMatch(/HEMLIGT|group_goal|groupGoal/);
    }
    // Veckomålen i mötesrapporterna är orörda.
    expect(rows("check_ins").some((c) => JSON.stringify(c).includes(SECRET))).toBe(false);
  });
});

describe("resolveChoice – skärmens val till kommandot", () => {
  it("enskilda: de valda som kan bjudas in; yrkesområde och nivå: målgruppen till servern, urvalet och de som hoppas över", async () => {
    const { resolveChoice } = await import("./screens/bjud-in");
    // En deltagare utan nivå pausas (testdatat har ingen pausad insats).
    const f0 = await q(groupActivityForm, {}, amira());
    const loner = f0.candidates.find((c) => c.caseId !== NADIA && c.caseId !== ELIF && !f0.groupings.some((g) => g.kind === "level" && g.caseIds.includes(c.caseId)))!;
    rt.store.updateRow("cases", loner.caseId, { status: "paused" });
    const f = await q(groupActivityForm, {}, amira());
    const one = resolveChoice({ mode: "enskilda", audienceId: "G", caseIds: [NADIA, ELIF] }, f, "2027-02-03", [ELIF]);
    expect(one).toMatchObject({ caseIds: [NADIA], audience: null, skipped: [], payload: { via: "enskilda" } });
    // En vald deltagare som inte kan vara med den dagen (här pausad) skickas ändå – servern nekar och säger vilka; ingen hoppas
    // tyst över.
    const paused = f.candidates.find((c) => c.caseId === loner.caseId && c.status === "paused")!;
    const withPaused = resolveChoice({ mode: "enskilda", audienceId: null, caseIds: [NADIA, paused.caseId] }, f, "2027-02-03");
    expect(withPaused.caseIds.sort()).toEqual([NADIA, paused.caseId].sort());
    expect(withPaused.invite.map((c) => c.caseId)).toEqual([NADIA]);
    expect(withPaused.payload).toEqual({ via: "enskilda" });
    const before = rows("group_activities").length;
    const res = await run(groupActivityCreate, { ...base, caseIds: withPaused.caseIds, ...withPaused.payload }, amira());
    expect(res).toMatchObject({ ok: false, error: "not_invitable", problems: [expect.objectContaining({ caseId: paused.caseId, reason: "Insatsen är pausad" })] });
    expect(rows("group_activities")).toHaveLength(before);
    // Yrkesområde: målgruppen går till servern (inga caseIds), knappen visar antalet som bjuds in nu.
    const area = resolveChoice({ mode: "omrade", audienceId: "E", caseIds: [ELIF] }, f, "2027-02-03", ["case-260130"]);
    expect(area).toMatchObject({ caseIds: [], audience: { kind: "area", areaCode: "E" }, count: 3, payload: { via: "omrade" } });
    expect(area.skipped.map((s) => [s.caseId, s.reason])).toEqual([["case-260130", "Redan inbjuden"]]);
    // Nivå: bara nivåfliken räknas (ett yrkesområde som id ger ingen målgrupp).
    expect(resolveChoice({ mode: "niva", audienceId: NIVA_3, caseIds: [] }, f, "2027-02-03")).toMatchObject({ audience: { kind: "level", levelId: NIVA_3 }, count: 17, payload: { via: "niva" } });
    expect(resolveChoice({ mode: "niva", audienceId: "E", caseIds: [] }, f, "2027-02-03")).toMatchObject({ audience: null, count: 0 });
    const ok = await run(groupActivityCreate, { ...base, caseIds: area.caseIds, audience: area.audience!, ...area.payload }, amira());
    expect(ok).toMatchObject({ ok: true, invited: 4 });
  });
});
