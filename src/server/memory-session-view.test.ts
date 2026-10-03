// Minneslägets sessionssvar: en simulerad testare (testerId i kakan) är testare – vanliga testpersoner är det inte.
import { describe, expect, it } from "vitest";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { memorySessionView } from "./memory-session-view";

const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
const persona = (userId: string) => listPersonas(rt.raw()).find((p) => p.actor.userId === userId)!;
const OPTIONS = [{ userId: "u-amira", role: "coach" as const, name: "Amira Haddad", title: "Huvudcoach" }];

describe("memorySessionView", () => {
  it("vanlig testperson: inloggad, inte testare, ingen impersonering", () => {
    const v = memorySessionView(persona("u-johan"), OPTIONS);
    expect(v).toMatchObject({ backend: "memory", environment: "memory", authenticated: true, isTester: false, impersonating: false, hidesCommercial: false, personas: OPTIONS });
    expect(v.persona?.actor.userId).toBe("u-johan");
    expect(v.persona?.actor.testerId).toBeUndefined();
    expect(v.selfName).toBeUndefined();
  });

  it("simulerad testare (testerId): isTester speglar testerId – Karim ser allt, en begränsad testare döljer priserna", () => {
    const johan = persona("u-johan");
    const karim = memorySessionView({ ...johan, actor: { ...johan.actor, testerId: "tester-karim" } }, OPTIONS);
    expect(karim).toMatchObject({ authenticated: true, isTester: true, impersonating: false, hidesCommercial: false });
    expect(karim.persona?.actor.testerId).toBe("tester-karim");
    const sara = memorySessionView({ ...johan, actor: { ...johan.actor, testerId: "tester-sara" } }, OPTIONS);
    expect(sara).toMatchObject({ isTester: true, hidesCommercial: true });
  });

  it("ingen testperson: inte inloggad", () => {
    expect(memorySessionView(null, [])).toMatchObject({ authenticated: false, isTester: false, personas: [] });
    expect(memorySessionView(null, []).persona).toBeUndefined();
  });
});
