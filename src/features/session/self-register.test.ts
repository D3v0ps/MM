// Självregistreringen i kommunens portal (beslut 2026-10-07, synpunkt #2) i minnesläget – samma funktion som servern kör
// efter en lyckad kod (src/server/auth/service.ts): profil och medlemskap som kommunens handläggare, ingen åtkomst till
// andras deltagare, revisionsloggen utan e-postadress och Mina uppgifter med "fyll i". Bara påhittade adresser.
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { SELF_REGISTERED } from "@/core/self-registration";
import { actorFor } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const q = (key: string, input: unknown, actor: Actor) => rt.run("query", key, input, actor) as Promise<Record<string, unknown>>;

describe("självregistrering", () => {
  it("en ny adress på kommunens domän får ett konto som handläggare – namnet ur adressen, enheten tom", async () => {
    const before = rt.clock.now();
    const res = await rt.selfRegister("Ny.Handlaggare@Botkyrka.se");
    expect(res).toMatchObject({ ok: true, contractIds: ["c-bot"], domain: "botkyrka.se" });
    if (!res.ok) return;
    expect(rt.clock.now() > before).toBe(true);
    const p = rt.raw().get("profiles", res.profileId)!;
    expect(p).toMatchObject({
      email: "ny.handlaggare@botkyrka.se", fullName: "Ny Handlaggare", title: "Handläggare", organizationId: "org-botkyrka", active: true,
      customerUnit: null, phone: "", invitedBy: SELF_REGISTERED, invitedAt: rt.clock.now(), lastLoginAt: null,
    });
    expect(rt.raw().all("memberships").filter((m) => m.userId === res.profileId).map((m) => [m.contractId, m.role])).toEqual([["c-bot", "kommun_handlaggare"]]);
    // Revisionsloggen: bara id:n och domänen – aldrig adressen eller namnet.
    const log = rt.raw().all("audit_log").at(-1)!;
    expect(log).toMatchObject({ action: "profile.self_registered", entity: "profile", entityId: res.profileId, actorId: res.profileId, contractId: "c-bot", details: { contractIds: ["c-bot"], domain: "botkyrka.se" } });
    expect(JSON.stringify(log)).not.toMatch(/ny\.handlaggare|Handlaggare/i);
  });

  it("det nya kontot ser inga deltagare och hamnar på Mina uppgifter (fyll i namn, telefon och enhet)", async () => {
    const res = await rt.selfRegister("kim.testsson@botkyrka.se");
    if (!res.ok) throw new Error(res.reason);
    const actor = actorFor(rt.raw(), res.profileId)!;
    expect(actor).toMatchObject({ role: "kommun_handlaggare", contractIds: ["c-bot"], customerUnit: null });
    expect(await q("kommun.profil", {}, actor)).toMatchObject({ name: "Kim Testsson", email: "kim.testsson@botkyrka.se", unit: "", phone: "", incomplete: true });
    expect((await q("kommun.deltagareLista", {}, actor)).rows).toEqual([]);
    expect((await q("kommun.rapporter", {}, actor)).reports).toEqual([]);
    expect(await q("kommun.deltagare", { caseId: "case-260143" }, actor)).toEqual({ kind: "denied" });
    // Admin ser kontot som självregistrerat.
    const users = await q("admin.users", {}, actorFor(rt.raw(), "u-robin")!);
    expect((users.customers as { id: string; selfRegistered: boolean }[]).find((u) => u.id === res.profileId)).toMatchObject({ selfRegistered: true });
  });

  it("en befintlig adress registreras aldrig om – inte heller en spärrad; andra domäner får inget konto", async () => {
    const n = rt.raw().all("profiles").length;
    expect(await rt.selfRegister("maria.ekdahl@botkyrka.se")).toEqual({ ok: false, reason: "exists" });
    rt.store.updateRow("profiles", "k-omar", { active: false });
    expect(await rt.selfRegister("OMAR.FARAH@botkyrka.se")).toEqual({ ok: false, reason: "exists" });
    for (const email of ["ny@gmail.com", "ny@sub.botkyrka.se", "ny@miljonbemanning.se", "botkyrka.se"]) {
      expect(await rt.selfRegister(email), email).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(rt.raw().all("profiles")).toHaveLength(n);
    expect(rt.raw().all("audit_log").some((l) => l.action === "profile.self_registered")).toBe(false);
    // Andra gången för samma nya adress: redan registrerad.
    expect((await rt.selfRegister("ny.person@botkyrka.se")).ok).toBe(true);
    expect(await rt.selfRegister("ny.person@botkyrka.se")).toEqual({ ok: false, reason: "exists" });
  });

  it("ett spärrat konto kringgås inte med en plusadress till samma brevlåda", async () => {
    const res = await rt.selfRegister("kim.testsson@botkyrka.se");
    if (!res.ok) throw new Error(res.reason);
    rt.store.updateRow("profiles", res.profileId, { active: false });
    expect(await rt.selfRegister("kim.testsson@botkyrka.se")).toEqual({ ok: false, reason: "exists" });
    expect(await rt.selfRegister("kim.testsson+1@botkyrka.se")).toEqual({ ok: false, reason: "not_allowed" });
    expect(rt.raw().all("profiles").filter((p) => p.email.startsWith("kim.testsson"))).toHaveLength(1);
  });

  it("enheten som handläggaren skriver själv ger aldrig åtkomst till enhetens beställningar (synligheten unit)", async () => {
    const res = await rt.selfRegister("vem.som.helst@botkyrka.se");
    if (!res.ok) throw new Error(res.reason);
    const unit = rt.raw().all("memberships").find((m) => m.userId === "k-maria")!.customerUnit!;
    expect(unit).toBeTruthy();
    let actor = actorFor(rt.raw(), res.profileId)!;
    expect(await rt.run("command", "kommun.profilSpara", { fullName: "Vem Som Helst", phone: "0701234567", unit }, actor)).toMatchObject({ ok: true });
    // Avtalet ändras i efterhand till synligheten "unit": nya konton kan inte längre skapas …
    const bot = rt.raw().get("contracts", "c-bot")!;
    rt.store.updateRow("contracts", "c-bot", { config: { ...bot.config, customerVisibility: { ...bot.config.customerVisibility!, scope: "unit" } } });
    expect(await rt.selfRegister("en.till@botkyrka.se")).toEqual({ ok: false, reason: "not_allowed" });
    // … och det befintliga kontot ser fortfarande bara sina egna: enheten tas från medlemskapet (satt av Miljonbemanning).
    actor = actorFor(rt.raw(), res.profileId)!;
    expect(actor.customerUnit).toBeNull();
    expect(rt.raw().get("profiles", res.profileId)?.customerUnit).toBe(unit);
    expect((await q("kommun.deltagareLista", {}, actor)).rows).toEqual([]);
    // Maria (medlemskapets enhet) ser enhetens beställningar med synligheten unit.
    const maria = actorFor(rt.raw(), "k-maria")!;
    expect(maria.customerUnit).toBe(unit);
    expect(((await q("kommun.deltagareLista", {}, maria)).rows as unknown[]).length).toBeGreaterThan(0);
  });

  it("avtalet styr: utan selfRegistration i avtalets konfiguration skapas inget konto", async () => {
    const bot = rt.raw().get("contracts", "c-bot")!;
    rt.store.updateRow("contracts", "c-bot", { config: { ...bot.config, selfRegistration: undefined } });
    expect(await rt.selfRegister("ny.person@botkyrka.se")).toEqual({ ok: false, reason: "not_allowed" });
  });
});
