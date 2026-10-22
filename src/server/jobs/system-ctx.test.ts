// Jobbens Ctx (system-ctx.ts) har alltid samma läge för SMS och utringning som hanterarna – också rapportjobbets, som bjuder in
// till nya tillfällen i de återkommande aktiviteterna. Utan läget skulle en deltagare som bara har telefon aldrig få inbjudan och
// samordnaren få en ring-uppgift för varje tillfälle. Bara påhittade uppgifter.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { PnrCrypto } from "@/api/server";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { MessagingStatus } from "@/features/_shared/messaging-port";
import { notifyParticipant } from "@/features/_shared/participant-notify";
import { jobCtx, type JobCtxBase } from "./system-ctx";

const CONNECTED: MessagingStatus = { sms: { connected: true, missing: [] }, call: { connected: true, missing: [] } };
const NO_CRYPTO = {} as PnrCrypto;

describe("jobbens Ctx", () => {
  it("bär läget för SMS och utringning: en inbjudan från jobbet går som SMS till den som bara har telefon", async () => {
    const rt = createMemoryRuntime({ data: structuredClone(createSeed()), clock: demoClock(DEMO_START) });
    const NADIA = "case-260143";
    const c = rt.store.getRow("cases", NADIA)!;
    rt.store.updateRow("persons", c.personId, { email: null, phone: "070-123 45 67", preferredContact: "sms" } as never);
    const base: JobCtxBase = { system: rt.ctxFor(SYSTEM_ACTOR).system, enqueue: async () => undefined, crypto: NO_CRYPTO, messaging: CONNECTED };
    const ctx = jobCtx(base, { now: "2027-02-01T09:12" });
    expect(ctx.actor).toEqual(SYSTEM_ACTOR);
    expect(ctx.messaging).toBe(CONNECTED);
    const sent = await notifyParticipant(ctx, { caseId: NADIA, template: "aktivitetsinbjudan", when: "2027-02-15T10:00", place: "Alby" });
    expect(sent.channels).toContain("sms");
    expect(sent.taskId ?? null).toBeNull();
  });

  it("jobbkörningen bygger varje Ctx med jobCtx – ingen liveCtx direkt i live.ts", () => {
    const src = readFileSync(new URL("./live.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\bliveCtx\(/);
    expect(src.match(/\bjobCtx\(base,/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
