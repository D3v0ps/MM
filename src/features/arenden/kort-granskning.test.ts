// Granskningen av D2 (2026-10-03), deltagarkortet: ett meddelande som läses via "Visa text" i tidslinjen markeras som
// läst (bara det meddelandet), och kortets huvud visar att flaggan "Fastnat" är kvitterad (samma källa som Min vecka).
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { addMinutes } from "@/core/time";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { TableName, Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { alertAck } from "@/features/ledning/api";
import { caseCard, caseTimelineText, messageRead } from "./api";

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
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const amira = () => as("u-amira", "coach");
const NADIA = "case-260143";
const AMAL = "case-270012";

describe("tidslinjens text och läskvittot", () => {
  it("messageRead med messageId markerar bara det meddelandet; unreadByMe blir false; chefen får inget kvitto", async () => {
    const logsBefore = rows("audit_log").length;
    const before = await q(caseTimelineText, { caseId: NADIA, id: "msg:msg-3" }, amira());
    expect(before).toMatchObject({ kind: "message", unreadByMe: true, readText: "Oläst" });
    const others = rows("messages").filter((m) => m.caseId === NADIA && m.id !== "msg-3").map((m) => [m.id, [...m.readBy]]);
    expect(await run(messageRead, { caseId: NADIA, messageId: "msg-3" }, amira())).toMatchObject({ ok: true, marked: 1 });
    expect(rows("messages").find((m) => m.id === "msg-3")!.readBy).toContain("u-amira");
    expect(rows("messages").filter((m) => m.caseId === NADIA && m.id !== "msg-3").map((m) => [m.id, [...m.readBy]])).toEqual(others);
    const after = await q(caseTimelineText, { caseId: NADIA, id: "msg:msg-3" }, amira());
    expect(after).toMatchObject({ kind: "message", unreadByMe: false, readText: "Läst av Amira Haddad" });
    // Samma meddelande igen: inget nytt kvitto. Ett meddelande i ett annat ärende: inget markeras.
    expect(await run(messageRead, { caseId: NADIA, messageId: "msg-3" }, amira())).toMatchObject({ ok: true, marked: 0 });
    expect(await run(messageRead, { caseId: AMAL, messageId: "msg-3" }, amira())).toMatchObject({ ok: true, marked: 0 });
    // Chefen läser utan kvitto – texten säger inte "oläst av mig" för henne.
    const karin = await q(caseTimelineText, { caseId: NADIA, id: "msg:msg-3" }, as("u-karin", "chef"));
    expect(karin).toMatchObject({ kind: "message", unreadByMe: false });
    // Inga loggrader av läsningen (tyst kommando, som fliken).
    expect(rows("audit_log")).toHaveLength(logsBefore);
  });
});

describe("kortets huvud: Fastnat med kvittering", () => {
  it("efter kvittering på Min vecka visar kortet vem som kvitterade och när", async () => {
    const card = await q(caseCard, { caseId: AMAL }, amira());
    if (card.kind !== "ok") throw new Error("gate");
    expect(card.stuck).toMatchObject({ phase: 1, acked: null });
    expect(card.flags.some((f) => f.key === `stuck:${AMAL}:1`)).toBe(true);
    expect(await run(alertAck, { key: `stuck:${AMAL}:1`, plan: "Kartläggningen slutförs vecka 6." }, amira())).toMatchObject({ ok: true });
    const after = await q(caseCard, { caseId: AMAL }, amira());
    if (after.kind !== "ok") throw new Error("gate");
    expect(after.stuck).toMatchObject({ phase: 1, acked: { byName: "Amira Haddad", at: addMinutes(DEMO_START, 1) } });
    // Flaggraden är borta (samma källa) – taggen i huvudet säger kvitterad i stället för att stå kvar oförändrad.
    expect(after.flags.some((f) => f.key === `stuck:${AMAL}:1`)).toBe(false);
  });
});
