// Ändra kontaktväg på deltagarkortet (coachmötet 2026-10-09): kommunen anger inte längre kontaktvägen – Miljonbemanning frågar
// vid första mötet. Kommandot arenden.caseSetContact mot testdatat i minnet (MemoryRuntime, samma hanterare som appen).
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { canWriteRow } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { caseCard, caseSetContact, CONTACT_EDITORS } from "./api";

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
const set = (input: ParamsOf<typeof caseSetContact>, actor: Actor) => rt.run("command", caseSetContact.key, input, actor) as Promise<ResultOf<typeof caseSetContact>>;

const NADIA = "case-260143";
const nadia = () => {
  const c = rt.raw().get("cases", NADIA)!;
  return { c, person: rt.raw().get("persons", c.personId)! };
};
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const amira = () => as("u-amira", "coach");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");
const karin = () => as("u-karin", "chef");
const kommunOf = (caseId: string) => as(rt.raw().get("cases", caseId)!.referrerId!, "kommun_handlaggare");
const contactLog = () => rt.raw().all("audit_log").filter((l) => l.action === "person.contact_changed");

describe("Ändra kontaktväg (arenden.caseSetContact)", () => {
  it("samordnare, avtalsansvarig, coach och systemadministratör ändrar kontaktvägen – personen sparas", async () => {
    expect([...CONTACT_EDITORS]).toEqual(["samordnare", "avtalsansvarig", "coach", "admin"]);
    const steps: [Actor, ParamsOf<typeof caseSetContact>][] = [
      [sara(), { caseId: NADIA, preferredContact: "email", phone: "", email: "deltagare@example.invalid" }],
      [johan(), { caseId: NADIA, preferredContact: "phone", phone: "070-000 00 01", email: "deltagare@example.invalid" }],
      [amira(), { caseId: NADIA, preferredContact: "sms", phone: "070-000 00 02", email: "" }],
      [robin(), { caseId: NADIA, preferredContact: "email", phone: "070-000 00 02", email: "ny@example.invalid" }],
    ];
    for (const [actor, input] of steps) {
      expect(await set(input, actor), actor.role).toEqual({ ok: true, changed: true });
      const { person } = nadia();
      expect({ preferredContact: person.preferredContact, phone: person.phone, email: person.email }, actor.role).toEqual({
        preferredContact: input.preferredContact, phone: input.phone, email: input.email,
      });
    }
  });

  it("kommunens handläggare, ekonomen och chefen nekas (rollkontrollen) – personen är orörd", async () => {
    const before = structuredClone(nadia().person);
    for (const actor of [kommunOf(NADIA), lars(), karin()]) {
      await expect(set({ caseId: NADIA, preferredContact: "email", phone: "", email: "x@example.invalid" }, actor), actor.role).rejects.toBeInstanceOf(ApiError);
    }
    expect(nadia().person).toEqual(before);
    expect(contactLog()).toHaveLength(0);
  });

  it("samma regler som Registrera beställning: SMS och telefon kräver telefonnummer, e-post kräver en hel adress", async () => {
    const res = await Promise.all([
      set({ caseId: NADIA, preferredContact: "sms", phone: "070-12", email: "" }, amira()),
      set({ caseId: NADIA, preferredContact: "phone", phone: "", email: "x@example.invalid" }, amira()),
      set({ caseId: NADIA, preferredContact: "email", phone: "070-000 00 00", email: "" }, amira()),
      set({ caseId: NADIA, preferredContact: "sms", phone: "070-000 00 00", email: "inte-en-adress" }, amira()),
    ]);
    expect(res.map((r) => (r.ok ? "ok" : r.error))).toEqual(["phone", "phone", "email", "email"]);
    expect(contactLog()).toHaveLength(0);
    // Brev väljs inte på deltagarkortet (zod).
    await expect(set({ caseId: NADIA, preferredContact: "letter" as "sms", phone: "", email: "" }, amira())).rejects.toBeInstanceOf(ApiError);
  });

  it("revisionsloggen: person.contact_changed med id:n och vilka fält som ändrades – aldrig värdena; ingen ändring loggas inte", async () => {
    const phone = "070-111 22 33";
    const email = "kontakt-test@example.invalid";
    expect(await set({ caseId: NADIA, preferredContact: "sms", phone, email }, amira())).toEqual({ ok: true, changed: true });
    const { c, person } = nadia();
    const log = contactLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: "u-amira", entity: "person", entityId: person.id, contractId: c.contractId, details: { caseId: NADIA } });
    const text = JSON.stringify(log[0]);
    for (const value of [phone, email, "111 22 33", person.firstName, person.lastName]) expect(text).not.toContain(value);
    // Samma uppgifter igen: ingen ändring och ingen ny rad i loggen.
    expect(await set({ caseId: NADIA, preferredContact: "sms", phone, email }, amira())).toEqual({ ok: true, changed: false });
    expect(contactLog()).toHaveLength(1);
  });

  it("adressen töms (den används bara för brev) och ett ärende som inte finns ger not_found", async () => {
    const { person } = nadia();
    rt.store.raw().get("persons", person.id)!.address = "Testgatan 1, 123 45 Testby";
    expect(await set({ caseId: NADIA, preferredContact: "sms", phone: "070-000 00 00", email: "" }, sara())).toMatchObject({ ok: true });
    expect(nadia().person.address).toBeNull();
    expect(await set({ caseId: "case-finns-inte", preferredContact: "sms", phone: "070-000 00 00", email: "" }, sara())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("deltagarkortet har kontaktuppgifterna att ändra bara för rollerna som får ändra dem", async () => {
    for (const actor of [sara(), johan(), amira(), robin()]) {
      const card = await q(caseCard, { caseId: NADIA }, actor);
      expect(card.kind, actor.role).toBe("ok");
      if (card.kind === "ok") expect(card.contact, actor.role).toEqual({ preferredContact: nadia().person.preferredContact, phone: nadia().person.phone, email: nadia().person.email });
    }
    const chef = await q(caseCard, { caseId: NADIA }, karin());
    expect(chef.kind === "ok" && chef.contact).toBeNull();
  });
});

describe("behörigheten (policy.ts, speglar mm.person_write och triggern i 0032)", () => {
  it("systemadministratören ändrar bara kontaktuppgifterna – aldrig namn eller språk", () => {
    const raw = rt.raw();
    const { person } = nadia();
    expect(canWriteRow("persons", { ...person, phone: "070-000 00 09", preferredContact: "sms" }, robin(), raw)).toBe(true);
    expect(canWriteRow("persons", { ...person, address: null, email: "ny@example.invalid" }, robin(), raw)).toBe(true);
    expect(canWriteRow("persons", { ...person, firstName: "Annat" }, robin(), raw)).toBe(false);
    expect(canWriteRow("persons", { ...person, language: "engelska", phone: "070-000 00 09" }, robin(), raw)).toBe(false);
    // Samordnaren och coachen får ändra personen som tidigare; ekonomen och chefen aldrig.
    expect(canWriteRow("persons", { ...person, firstName: "Annat" }, sara(), raw)).toBe(true);
    expect(canWriteRow("persons", { ...person, phone: "070-000 00 09" }, amira(), raw)).toBe(true);
    expect(canWriteRow("persons", { ...person, phone: "070-000 00 09" }, lars(), raw)).toBe(false);
    expect(canWriteRow("persons", { ...person, phone: "070-000 00 09" }, karin(), raw)).toBe(false);
  });
});
