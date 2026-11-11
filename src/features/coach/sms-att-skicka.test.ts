// SMS att skicka på coachens Min vecka (Karims beslut 2026-11-11, SPEC §9): texterna (bara tid, plats och Miljonbemannings
// telefonnummer – CLAUDE.md punkt 9), veckans tider (fredag kl. 00.00 Stockholms tid tills veckans första tillfälle börjar,
// pausade veckor, inställda aktiviteter, inga praktikdagar), meddelanden som inte kunde skickas automatiskt och samordnarens
// uppgift (bara för ett tillfälle som finns, tills tiden har passerat och inte medan veckans tider har tillfället), Markera som
// skickat (idempotent, jämför tillfällena eller meddelandet utan klockan, inget nummer i utskicksloggen eller revisionsloggen),
// coachens egna deltagare, siffran vid Min vecka och vem som når frågan. Testdatat i minnet (måndag 1 februari 2027 kl. 09.12).
// Bara påhittade uppgifter.
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, realClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, decodeTestPnr, DEMO_START, normalizePnr } from "@/data/seed";
import type { Activity, OutboundMessage, Tables } from "@/data/schema";
import { groupActivityCancel } from "@/features/aktiviteter/api";
import { activityMove, activityRemove } from "@/features/arenden/api";
import { inboxTaskDone } from "@/features/inkorg/api";
import { navCounts, type NavCounts } from "@/features/session/nav-api";
import { CONTACT_PHONE } from "../_shared/contact";
import { MESSAGING_OFF, PARTICIPANT_TO, type MessagingStatus } from "../_shared/messaging-port";
import { closeExpiredContactTasks, messageMatchesTask, participantMessage, slotOfMessage, weeklyScheduleMessage, whenInText } from "../_shared/participant-notify";
import { manualSmsId, scheduleWeek } from "../_shared/sms-to-send";
import { SYSTEM_ACTOR } from "@/api/roles";
import { smsHref } from "./screens/sms-att-skicka";
import { smsAttSkicka, smsMarkSent, type SmsToSendRow } from "./api";
import "@/api/handlers";

const SEED: MemoryData<Tables> = createSeed();
const NADIA = "case-260143";
/** E-post till deltagare stoppas av spärrlistan och SMS är inte kopplat – som i produktionen i dag. */
const PRODUCTION_LIKE: MessagingStatus = { ...MESSAGING_OFF, emailReaches: () => false };

let rt: MemoryRuntime;
const start = (opts: { clock?: ReturnType<typeof demoClock>; messaging?: MessagingStatus } = {}) => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: opts.clock ?? demoClock(DEMO_START), ...(opts.messaging ? { messaging: opts.messaging } : {}) });
};
beforeEach(() => start());

const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
const amira = () => as("u-amira", "coach");
/** En annan coach än Nadias huvudcoach – alla coacher ser alla deltagare (punkt 6). */
const erik = () => as("u-erik", "coach");
const sara = () => as("u-sara", "samordnare");
const rows = <N extends keyof Tables>(name: N) => rt.store.rows(name) as Tables[N][];
const sms = async (actor: Actor = erik()) => ((await rt.run("query", smsAttSkicka.key, {}, actor)) as { rows: SmsToSendRow[] }).rows;
type MarkRes = { ok: boolean; already?: boolean; error?: string; message?: string };
const mark = (key: string, text: string, actor: Actor = erik(), extra: { slots?: SmsToSendRow["slots"]; messageId?: string | null } = {}) =>
  rt.run("command", smsMarkSent.key, { key, text, ...(extra.slots ? { slots: extra.slots } : {}), ...(extra.messageId ? { messageId: extra.messageId } : {}) }, actor) as Promise<MarkRes>;
/** Markera raden som skärmen gör: med tillfällena eller meddelandets id. */
const markRow = (r: SmsToSendRow, actor: Actor = erik()) => mark(r.key, r.text, actor, { slots: r.slots, messageId: r.messageId });

/** Allt som inte får stå i ett SMS till deltagaren: namn, kontaktuppgifter, personnummer, ärendenummer, aktiviteternas namn, insatsens ord. */
function forbiddenParts(): string[] {
  const people = rows("persons").flatMap((p) => [p.firstName, p.lastName, p.email, p.phone, normalizePnr(decodeTestPnr(p.personnummerEnc))]);
  const caseNumbers = rows("cases").map((c) => c.caseNumber);
  const activityNames = rows("group_activities").map((g) => g.name);
  return [...people, ...caseNumbers, ...activityNames].filter((x): x is string => !!x && x.trim().length >= 4);
}
const INSATS_WORDS = /BOT-\d|coachträff|yrkesmoment|praktikdag|arbetsgivarbesök|arbetsmarknad|insats|kommun|Botkyrka|nivå|grupp/i;
/** Bara veckodag, datum, klockslag, plats och telefonnumret. */
function expectOnlyTimePlacePhone(texts: readonly string[]) {
  const bad = forbiddenParts();
  for (const t of texts) {
    for (const x of bad) expect(t.includes(x), `"${x}" i "${t}"`).toBe(false);
    expect(t).not.toMatch(INSATS_WORDS);
  }
}

// ================================================================ Texterna
describe("texterna till deltagaren", () => {
  it("veckans tider: veckodag, datum, klockslag och plats – samma dag och plats slås ihop – och Miljonbemannings telefonnummer", () => {
    const text = weeklyScheduleMessage(
      [{ startsAt: "2027-02-09T13:30", place: "Alby" }, { startsAt: "2027-02-08T10:00", place: "Alby" }, { startsAt: "2027-02-08T13:30", place: "Alby" }, { startsAt: "2027-02-12T08:00", place: "  Praktikplats  " }],
      true,
    );
    expect(text).toBe(`Hej! Dina tider hos Miljonbemanning nästa vecka: mån 8 feb kl. 10.00 och 13.30, Alby. tis 9 feb kl. 13.30, Alby. fre 12 feb kl. 08.00, Praktikplats. Frågor? Ring ${CONTACT_PHONE}.`);
    expect(weeklyScheduleMessage([{ startsAt: "2027-02-03T09:00", place: "" }], false)).toBe(`Hej! Dina tider hos Miljonbemanning den här veckan: ons 3 feb kl. 09.00, Miljonbemanning. Frågor? Ring ${CONTACT_PHONE}.`);
  });

  it("testdatats veckans tider innehåller inga namn, ärendenummer, aktivitetsnamn eller ord om insatsen – och testet hittar dem om de kommer med", async () => {
    const all = await sms();
    expect(all.length).toBeGreaterThan(10);
    expectOnlyTimePlacePhone(all.map((r) => r.text));
    // Kontrollen fäller en text med namn, ärendenummer eller aktivitetens namn.
    const p = rows("persons")[0];
    const g = rows("group_activities")[0];
    for (const leak of [`${all[0].text} ${p.firstName}`, `${all[0].text} ${rows("cases")[0].caseNumber}`, `${all[0].text} ${g.name}`]) {
      expect(() => expectOnlyTimePlacePhone([leak])).toThrow();
    }
  });

  it("tiden och platsen läses tillbaka ur alla fyra meddelandena – samma form som samordnarens uppgift", () => {
    const when = "2027-02-08T09:30";
    const slot = "måndag 8 februari kl. 09.30, Hallunda, plan 2.";
    for (const t of ["kallelse", "aktivitetsinbjudan", "aktivitet_andrad", "aktivitet_installd"] as const) {
      const body = participantMessage(t, when, "  Hallunda,   plan 2. ", "2027-02-05T13:00");
      expect(slotOfMessage(t, body), t).toBe(slot);
      expect(messageMatchesTask(t, body, "BOT-26-0143", `x – ärende BOT-26-0143, ${slot}.`), t).toBe(false);
    }
    expect(slotOfMessage("aktivitet_andrad", participantMessage("aktivitet_andrad", when, "Alby"))).toBe("måndag 8 februari kl. 09.30, Alby");
    expect(slotOfMessage("kallelse", "Något annat")).toBeNull();
  });
});

// ================================================================ Veckans tider
describe("veckans tider", () => {
  it("måndag före veckans första tillfälle: raden från i fredags står kvar med texten för den här veckan – sedan försvinner den, och tisdag–torsdag finns ingen", async () => {
    expect(scheduleWeek(DEMO_START).key).toBe("2027-W05");
    const nadia = (await sms()).find((r) => r.caseId === NADIA);
    expect(nadia).toMatchObject({ key: `vecka:${NADIA}:2027-W05`, kind: "veckoschema", week: 5, caseNumber: "BOT-26-0143", name: "Nadia Warsame", leadCoach: "Amira" });
    expect(nadia?.text).toMatch(/^Hej! Dina tider hos Miljonbemanning den här veckan: mån 1 feb kl\. 10\.00, /);
    expect(nadia?.phone).toBe(rows("persons").find((p) => p.id === rows("cases").find((c) => c.id === NADIA)?.personId)?.phone?.trim());
    // Praktikdagarna står inte med (praktiken har egna tider): Nadias torsdag är en praktikdag.
    expect(rows("activities").some((a) => a.caseId === NADIA && a.kind === "praktikdag" && a.startsAt === "2027-02-04T08:00")).toBe(true);
    expect(nadia?.text).not.toContain("tor 4 feb");
    expect(nadia?.slots?.map((x) => x.startsAt)).toEqual(rows("activities").filter((a) => a.caseId === NADIA && a.kind !== "praktikdag" && a.startsAt >= "2027-02-01" && a.startsAt < "2027-02-08").map((a) => a.startsAt).sort());
    // Veckans första tillfälle har börjat: raden försvinner.
    rt.clock.set("2027-02-01T10:00");
    expect((await sms()).some((r) => r.caseId === NADIA && r.kind === "veckoschema")).toBe(false);
    // Tisdag–torsdag: ingen rad för den här veckan för den vars vecka har börjat – högst en rad per deltagare.
    rt.clock.set("2027-02-02T12:00");
    const tue = (await sms()).filter((r) => r.kind === "veckoschema");
    for (const r of tue) expect(r.slots![0].startsAt > "2027-02-02T12:00").toBe(true);
    expect(new Set(tue.map((r) => r.caseId)).size).toBe(tue.length);
  });

  it("fredag kl. 00.00 Stockholms tid (vintertid, UTC+1): raden för nästa vecka kommer – torsdag kl. 23.59 finns den inte", async () => {
    start({ clock: realClock(() => "2027-02-04T22:59:00Z") });
    expect(scheduleWeek(rt.clock.now()).key).toBe("2027-W05");
    expect((await sms()).some((r) => r.week === 6)).toBe(false);
    expect((await sms()).some((r) => r.caseId === NADIA)).toBe(false);
    start({ clock: realClock(() => "2027-02-04T23:00:00Z") });
    expect(rt.clock.now()).toBe("2027-02-05T00:00");
    expect(scheduleWeek(rt.clock.now()).key).toBe("2027-W06");
    // Högst en rad per deltagare – bara nästa vecka.
    const fri = (await sms()).filter((r) => r.kind === "veckoschema");
    expect(fri.every((r) => r.week === 6)).toBe(true);
    expect(new Set(fri.map((r) => r.caseId)).size).toBe(fri.length);
    const next = (await sms()).find((r) => r.caseId === NADIA && r.week === 6);
    expect(next?.key).toBe(`vecka:${NADIA}:2027-W06`);
    expect(next?.text).toMatch(/^Hej! Dina tider hos Miljonbemanning nästa vecka: mån 8 feb kl\. /);
    expectOnlyTimePlacePhone([next?.text ?? ""]);
    // Sommartid (UTC+2): fredag 00.00 i Stockholm är torsdag 22.00 UTC.
    start({ clock: realClock(() => "2027-06-10T22:00:00Z") });
    expect(rt.clock.now()).toBe("2027-06-11T00:00");
    expect(scheduleWeek(rt.clock.now()).key).toBe("2027-W24");
  });

  it("en pausad vecka får ingen rad", async () => {
    start({ clock: realClock(() => "2027-02-04T23:00:00Z") });
    const weeks = async () => (await sms()).filter((r) => r.caseId === NADIA).map((r) => r.week);
    expect(await weeks()).toContain(6);
    rt.store.updateRow("cases", NADIA, { pausedWeeks: ["2027-W06"] });
    expect(await weeks()).not.toContain(6);
  });

  it("en inställd gruppaktivitet står inte med – texten följer schemat tills raden är markerad", async () => {
    start({ clock: realClock(() => "2027-02-04T23:00:00Z") });
    const g = rows("group_activities").find((x) => x.startsAt >= "2027-02-08" && x.startsAt < "2027-02-15" && !x.cancelledAt && rows("activities").some((a) => a.groupActivityId === x.id))!;
    const caseId = rows("activities").find((a) => a.groupActivityId === g.id)!.caseId;
    const slot = `kl. ${g.startsAt.slice(11).replace(":", ".")}`;
    const before = (await sms()).find((r) => r.caseId === caseId && r.week === 6)!;
    expect(before.text).toContain(slot);
    // Inställd men tillfället ligger kvar (t.ex. under tiden) – står ändå inte med.
    rt.store.updateRow("group_activities", g.id, { cancelledAt: "2027-02-05T00:00" });
    const hidden = (await sms()).find((r) => r.caseId === caseId && r.week === 6);
    expect(hidden?.text ?? "").not.toBe(before.text);
    rt.store.updateRow("group_activities", g.id, { cancelledAt: null });
    // Ställs in med kommandot: deltagarnas tillfällen tas bort.
    const res = (await rt.run("command", groupActivityCancel.key, { id: g.id, notify: false }, sara())) as { ok: boolean };
    expect(res.ok).toBe(true);
    const after = (await sms()).find((r) => r.caseId === caseId && r.week === 6);
    expect(after?.text ?? "").not.toBe(before.text);
  });

  it("deltagare utan telefonnummer, avslutade insatser och skyddade personuppgifter (vilande spärr) får ingen rad", async () => {
    const all = await sms();
    const nadia = all.find((r) => r.caseId === NADIA)!;
    const personId = rows("cases").find((c) => c.id === NADIA)!.personId;
    rt.store.updateRow("persons", personId, { phone: "" });
    expect((await sms()).some((r) => r.caseId === NADIA)).toBe(false);
    rt.store.updateRow("persons", personId, { phone: nadia.phone, protectedIdentity: true });
    expect((await sms()).some((r) => r.caseId === NADIA)).toBe(false);
    rt.store.updateRow("persons", personId, { protectedIdentity: false });
    rt.store.updateRow("cases", NADIA, { status: "closed" });
    expect((await sms()).some((r) => r.caseId === NADIA)).toBe(false);
  });
});

// ================================================================ Markera som skickat
describe("Markera som skickat", () => {
  it("en rad i utskicksloggen – SMS skickat för hand, vem och när, aldrig numret – raden försvinner för alla och ett andra tryck ändrar ingenting", async () => {
    const row = (await sms()).find((r) => r.caseId === NADIA)!;
    const out0 = rows("outbound_messages").length;
    const log0 = rows("audit_log").length;
    expect(await mark(row.key, row.text)).toEqual({ ok: true, already: false });
    // Två coacher samtidigt: den andra får already – en rad.
    expect(await mark(row.key, row.text, amira())).toEqual({ ok: true, already: true });
    const added = rows("outbound_messages").slice(out0);
    expect(added).toHaveLength(1);
    const m = added[0] as OutboundMessage;
    // När: klockan när coachen tryckte (testklockan går en minut per kommando).
    expect(m.createdAt >= DEMO_START && m.createdAt < "2027-02-01T10:00").toBe(true);
    expect(m).toEqual({
      id: manualSmsId(row.key), createdAt: m.createdAt, channel: "sms", to: PARTICIPANT_TO.sms, template: "veckoschema", subject: null, body: row.text,
      caseId: NADIA, status: "sent_manually", sentAt: m.createdAt, statusReason: null, providerMessageId: null, sentBy: "u-erik",
    });
    const digits = row.phone.replace(/\D/g, "");
    expect(JSON.stringify(m).replace(/\D/g, " ")).not.toContain(digits);
    // Revisionsloggen: bara id:n, mallen och veckan – ingen text och inget nummer.
    const logs = rows("audit_log").slice(log0);
    expect(logs.map((l) => l.action)).toEqual(["outbound_message.sent_manually"]);
    expect(logs[0]).toMatchObject({ actorId: "u-erik", entity: "outbound_message", entityId: m.id, details: { caseId: NADIA, template: "veckoschema", channel: "sms", week: "2027-W05" } });
    expect(JSON.stringify(logs[0].details)).not.toContain(digits);
    // Borta för alla coacher.
    expect((await sms(erik())).some((r) => r.key === row.key)).toBe(false);
    expect((await sms(amira())).some((r) => r.key === row.key)).toBe(false);
  });

  it("har tiderna ändrats sedan texten kopierades stoppas markeringen – den nya texten står på raden", async () => {
    const row = (await sms()).find((r) => r.caseId === NADIA)!;
    const res = await mark(row.key, `${row.text} `);
    expect(res).toMatchObject({ ok: false, error: "changed" });
    expect(rows("outbound_messages").some((m) => m.id === manualSmsId(row.key))).toBe(false);
    expect(await mark("vecka:case-finns-inte:2027-W05", row.text)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("siffran vid Min vecka: coachens egna – veckans tider räknas som en sak, som försvinner när den sista är markerad", async () => {
    const count = async (a: Actor) => ((await rt.run("query", navCounts.key, {}, a)) as NavCounts).tasks;
    const own = (await sms(amira())).filter((r) => r.mine);
    const weekly = own.filter((r) => r.kind === "veckoschema");
    expect(weekly.length).toBeGreaterThan(1);
    expect(own.some((r) => r.kind !== "veckoschema")).toBe(false);
    // Erik ser Amiras deltagare (alla ser alla) men de är inte hans – de räknas inte i hans siffra.
    expect((await sms(erik())).some((r) => r.caseId === NADIA && !r.mine)).toBe(true);
    // Amira är också avtalets intagsansvarige: beställningarna att ta emot räknas med.
    const base = await count(amira());
    expect(base).toBeGreaterThanOrEqual(1);
    for (const r of weekly.slice(0, -1)) expect(await markRow(r, amira())).toMatchObject({ ok: true });
    expect(await count(amira())).toBe(base);
    expect(await markRow(weekly[weekly.length - 1], amira())).toMatchObject({ ok: true });
    expect(await count(amira())).toBe(base - 1);
  });
});

// ================================================================ Meddelanden som inte kunde skickas
const nextMeeting = (): Activity => ({
  ...rows("activities").filter((a) => a.caseId === NADIA && !a.groupActivityId && a.kind === "möte" && a.startsAt > DEMO_START).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0],
});
/** Nadias nästa coachträff får ny tid – nästa vecka (tisdag 9 februari kl. 13.30), som ingen rad för veckans tider har med i dag. */
const MOVED_TO = "2027-02-09T13:30";
const moveNadia = async (to: string = MOVED_TO) => {
  const a = nextMeeting();
  const r = (await rt.run("command", activityMove.key, { activityId: a.id, expectedStartsAt: a.startsAt, startsAt: to, durationMin: 60, notify: true }, amira())) as { ok: boolean; message?: string };
  expect(r, r.message).toMatchObject({ ok: true });
  return a;
};
const openTasks = () => rows("tasks").filter((t) => t.kind === "participant_contact" && t.status === "open" && t.caseIds.includes(NADIA));

describe("meddelanden som inte kunde skickas automatiskt", () => {
  it("ändrad tid när e-posten stoppas och SMS inte är kopplat: raden har exakt texten som skulle ha skickats; Markera som skickat stänger samordnarens uppgift", async () => {
    start({ messaging: PRODUCTION_LIKE });
    await moveNadia();
    const task = openTasks()[0];
    expect(task?.text).toMatch(/^Ring deltagaren och berätta om aktivitetens nya tid eller plats – ärende BOT-26-0143, tisdag 9 februari kl\. 13\.30, /);
    const stopped = rows("outbound_messages").filter((m) => m.caseId === NADIA && m.template === "aktivitet_andrad" && m.channel === "sms");
    expect(stopped.map((m) => m.status)).toEqual(["suppressed"]);
    const row = (await sms()).find((r) => r.key === `uppgift:${task.id}`)!;
    expect(row).toMatchObject({ kind: "aktivitet_andrad", caseId: NADIA, text: stopped[0].body, week: null, slots: null, messageId: stopped[0].id });
    expectOnlyTimePlacePhone([row.text]);
    // Veckans tider följer schemat: den gamla tiden står inte med.
    expect((await sms()).find((r) => r.key === `vecka:${NADIA}:2027-W05`)?.text ?? "").not.toContain("mån 1 feb kl. 10.00");

    const log0 = rows("audit_log").length;
    expect(await markRow(row)).toEqual({ ok: true, already: false });
    expect(rows("tasks").find((t) => t.id === task.id)).toMatchObject({ status: "done", doneBy: "u-erik", doneNote: "SMS skickat för hand från Min vecka." });
    expect(rows("audit_log").slice(log0).map((l) => l.action)).toEqual(["outbound_message.sent_manually", "task.done"]);
    const m = rows("outbound_messages").find((x) => x.id === manualSmsId(row.key));
    expect(m).toMatchObject({ channel: "sms", template: "aktivitet_andrad", status: "sent_manually", body: row.text, sentBy: "u-erik" });
    expect((await sms()).some((r) => r.key === row.key)).toBe(false);
    // Samordnaren har inget kvar att ringa om.
    expect(openTasks()).toHaveLength(0);
  });

  it("klarmarkerar samordnaren uppgiften (hen ringde) försvinner coachens rad", async () => {
    start({ messaging: PRODUCTION_LIKE });
    await moveNadia();
    const task = openTasks()[0];
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(true);
    const done = (await rt.run("command", inboxTaskDone.key, { taskId: task.id }, sara())) as { ok: boolean };
    expect(done.ok).toBe(true);
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(false);
    expect(await mark(`uppgift:${task.id}`, "x")).toMatchObject({ ok: false, error: "changed" });
  });

  it("inställd aktivitet: deltagarnas tillfällen tas bort men SMS:et om att den är inställd står på raden", async () => {
    start({ clock: demoClock("2027-02-05T09:00"), messaging: PRODUCTION_LIKE });
    const g = rows("group_activities").find((x) => x.startsAt >= "2027-02-08" && x.startsAt < "2027-02-15" && !x.cancelledAt && rows("activities").some((a) => a.groupActivityId === x.id))!;
    const caseIds = rows("activities").filter((a) => a.groupActivityId === g.id).map((a) => a.caseId);
    const res = (await rt.run("command", groupActivityCancel.key, { id: g.id, notify: true }, sara())) as { ok: boolean };
    expect(res.ok).toBe(true);
    const installd = (await sms()).filter((r) => r.kind === "aktivitet_installd");
    expect(installd.length).toBeGreaterThan(0);
    for (const r of installd) {
      expect(caseIds).toContain(r.caseId);
      expect(r.text).toBe(participantMessage("aktivitet_installd", g.startsAt, g.location));
    }
    expectOnlyTimePlacePhone(installd.map((r) => r.text));
  });

  it("går meddelandet fram automatiskt (e-posten, eller SMS när det är kopplat) blir det ingen rad", async () => {
    // Minnesläget: e-posten når deltagaren.
    await moveNadia();
    expect(openTasks()).toHaveLength(0);
    expect((await sms()).some((r) => r.kind !== "veckoschema")).toBe(false);
    // SMS kopplat (46elks), e-posten stoppad: SMS:et ligger i kön – ingen uppgift och ingen rad.
    start({ messaging: { ...PRODUCTION_LIKE, sms: { connected: true, missing: [] } } });
    await moveNadia();
    expect(rows("outbound_messages").filter((m) => m.caseId === NADIA && m.template === "aktivitet_andrad" && m.channel === "sms").map((m) => m.status)).toEqual(["sent"]);
    expect(openTasks()).toHaveLength(0);
    expect((await sms()).some((r) => r.kind !== "veckoschema")).toBe(false);
  });
});

// ================================================================ Vem når frågan
describe("bara coachen", () => {
  it("kommunen, ekonomen och samordnaren når varken frågan eller kommandot", async () => {
    const row = (await sms()).find((r) => r.caseId === NADIA)!;
    for (const actor of [as("k-maria"), as("u-lars", "ekonom"), sara()]) {
      await expect(rt.run("query", smsAttSkicka.key, {}, actor), actor.role).rejects.toBeInstanceOf(ApiError);
      await expect(rt.run("command", smsMarkSent.key, { key: row.key, text: row.text }, actor), actor.role).rejects.toBeInstanceOf(ApiError);
    }
    expect(rows("outbound_messages").some((m) => m.id === manualSmsId(row.key))).toBe(false);
  });
});

// ================================================================ Granskningen 2026-11-11
describe("granskningen 2026-11-11 – raderna", () => {
  it("ändrad tid i en vecka som veckans tider har med: ingen egen rad (ett SMS räcker) – Markera som skickat för veckan stänger uppgiften", async () => {
    start({ messaging: PRODUCTION_LIKE });
    await moveNadia("2027-02-03T13:30");
    const task = openTasks()[0];
    expect(task).toBeTruthy();
    const all = await sms(amira());
    expect(all.some((r) => r.key === `uppgift:${task.id}`)).toBe(false);
    const weekly = all.find((r) => r.key === `vecka:${NADIA}:2027-W05`)!;
    expect(weekly.text).toContain("ons 3 feb kl. 09.00 och 13.30");
    expect(await markRow(weekly, amira())).toEqual({ ok: true, already: false });
    expect(rows("tasks").find((t) => t.id === task.id)).toMatchObject({ status: "done", doneBy: "u-amira", doneNote: "SMS skickat för hand från Min vecka." });
    expect(rows("audit_log").filter((l) => l.action === "task.done" && l.entityId === task.id).pop()?.details).toMatchObject({ template: "veckoschema", sentManually: true });
  });

  it("ett tillfälle som inte finns längre får ingen rad – Ta bort stänger dessutom uppgiften", async () => {
    start({ messaging: PRODUCTION_LIKE });
    const a = await moveNadia();
    const task = openTasks()[0];
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(true);
    // Inget tillfälle på tiden längre men uppgiften öppen (t.ex. ändrat på annat sätt): ingen rad.
    rt.store.updateRow("activities", a.id, { startsAt: "2027-02-09T15:00" });
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(false);
    rt.store.updateRow("activities", a.id, { startsAt: MOVED_TO });
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(true);
    expect(((await rt.run("command", activityRemove.key, { activityId: a.id }, amira())) as { ok: boolean }).ok).toBe(true);
    expect(rows("tasks").find((t) => t.id === task.id)).toMatchObject({ status: "done", doneNote: "Tillfället är borttaget." });
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(false);
  });

  it("när aktivitetens tid har passerat försvinner raden, och jobbet stänger uppgiften", async () => {
    start({ messaging: PRODUCTION_LIKE });
    await moveNadia();
    const task = openTasks()[0];
    rt.clock.set("2027-02-09T13:29");
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(true);
    expect(await closeExpiredContactTasks(rt.ctxFor(SYSTEM_ACTOR))).toBe(0);
    rt.clock.set("2027-02-09T13:30");
    expect((await sms()).some((r) => r.key === `uppgift:${task.id}`)).toBe(false);
    expect(await closeExpiredContactTasks(rt.ctxFor(SYSTEM_ACTOR))).toBe(1);
    expect(rows("tasks").find((t) => t.id === task.id)).toMatchObject({ status: "done", doneBy: SYSTEM_ACTOR.userId, doneNote: "Aktivitetens tid har passerat." });
    expect(rows("audit_log").filter((l) => l.action === "task.done" && l.entityId === task.id).pop()?.details).toMatchObject({ caseId: NADIA, template: "aktivitet_andrad", expired: true });
    // En gång: nästa körning stänger inget.
    expect(await closeExpiredContactTasks(rt.ctxFor(SYSTEM_ACTOR))).toBe(0);
  });

  it("tiden i uppgiften och meddelandet läses med rätt år – december till januari", () => {
    expect(whenInText("Ring deltagaren – ärende BOT-26-0143, tisdag 9 februari kl. 13.30, Alby.", "2027-02-01T09:12")).toBe("2027-02-09T13:30");
    expect(whenInText("fredag 7 januari kl. 9.00, Alby", "2027-12-28T10:00")).toBe("2028-01-07T09:00");
    expect(whenInText("måndag 1 februari kl. 10.00, Alby", "2027-02-02T10:00")).toBe("2027-02-01T10:00");
    expect(whenInText("Något annat", "2027-02-01T09:12")).toBeNull();
  });

  it("Markera som skickat går också när tiden har gått: texten från fredag (nästa vecka) markeras på måndagen efter veckans första tillfälle", async () => {
    start({ clock: demoClock("2027-02-05T09:00") });
    const row = (await sms(amira())).find((r) => r.key === `vecka:${NADIA}:2027-W06`)!;
    expect(row.text).toMatch(/nästa vecka/);
    rt.clock.set(row.slots![0].startsAt);
    expect((await sms(amira())).some((r) => r.key === row.key)).toBe(false);
    expect(await markRow(row, amira())).toEqual({ ok: true, already: false });
    expect(rows("outbound_messages").find((m) => m.id === manualSmsId(row.key))).toMatchObject({ body: row.text, status: "sent_manually" });
  });

  it("bara veckan som visas – eller veckan före – går att markera, också genom API:et", async () => {
    const row = (await sms(amira())).find((r) => r.key === `vecka:${NADIA}:2027-W05`)!;
    // Fredag: veckan som visas är nästa (W06) – en framtida vecka (W07) stoppas.
    rt.clock.set("2027-02-05T00:00");
    expect(await mark(`vecka:${NADIA}:2027-W07`, row.text, amira())).toMatchObject({ ok: false, error: "changed" });
    expect(rows("outbound_messages").some((m) => m.id === manualSmsId(`vecka:${NADIA}:2027-W07`))).toBe(false);
    // Två veckor bakåt stoppas.
    rt.clock.set("2027-02-15T09:00");
    expect(await markRow(row, amira())).toMatchObject({ ok: false, error: "changed" });
    // Veckan före går: raden kopierades i vecka 5 och markeras efter fredag kl. 00.00.
    rt.clock.set("2027-02-05T00:00");
    expect(await markRow(row, amira())).toEqual({ ok: true, already: false });
    // Fält som raden har som null (veckans tider har inget meddelande) godtas.
    const next = (await sms(amira())).find((r) => r.key === `vecka:${NADIA}:2027-W06`)!;
    expect(next.messageId).toBeNull();
    expect(await rt.run("command", smsMarkSent.key, { key: next.key, text: next.text, slots: next.slots, messageId: next.messageId }, amira())).toEqual({ ok: true, already: false });
  });

  it("har veckans tillfällen ändrats sedan coachen kopierade texten stoppas markeringen", async () => {
    start({ clock: demoClock("2027-02-05T09:00") });
    const row = (await sms(amira())).find((r) => r.key === `vecka:${NADIA}:2027-W06`)!;
    expect(await mark(row.key, row.text, amira(), { slots: [...row.slots!, { id: "a-finns-inte", startsAt: "2027-02-12T10:00" }] })).toMatchObject({ ok: false, error: "changed" });
    expect(await mark(row.key, row.text, amira(), { slots: row.slots!.slice(1) })).toMatchObject({ ok: false, error: "changed" });
    expect(rows("outbound_messages").some((m) => m.id === manualSmsId(row.key))).toBe(false);
  });

  it("coachens egna deltagare: huvudcoach eller i teamet (mine) – alla coacher ser alla", async () => {
    const amiraRows = await sms(amira());
    expect(amiraRows.find((r) => r.caseId === NADIA)?.mine).toBe(true);
    const erikRows = await sms(erik());
    expect(erikRows.find((r) => r.caseId === NADIA)?.mine).toBe(false);
    expect(erikRows.filter((r) => r.mine).every((r) => rows("cases").find((c) => c.id === r.caseId)?.leadCoachId === "u-erik"
      || rows("case_team").some((t) => t.caseId === r.caseId && t.userId === "u-erik"))).toBe(true);
    rt.store.insertRow("case_team", { id: "ct-probe", caseId: NADIA, userId: "u-erik", role: "employer_matcher" });
    expect((await sms(erik())).find((r) => r.caseId === NADIA)?.mine).toBe(true);
  });

  it("Öppna SMS: bara texten i länken – aldrig numret; iPhone får sms:&body=", () => {
    const text = participantMessage("aktivitet_andrad", "2027-02-09T13:30", "Alby");
    const href = smsHref(text, "Mozilla/5.0 (Linux; Android 14)");
    expect(href).toBe(`sms:?body=${encodeURIComponent(text)}`);
    expect(smsHref(text, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(`sms:&body=${encodeURIComponent(text)}`);
    for (const p of rows("persons")) if (p.phone) expect(decodeURIComponent(href)).not.toContain(p.phone.replace(/\s/g, ""));
  });
});
