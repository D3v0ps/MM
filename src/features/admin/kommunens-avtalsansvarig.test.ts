// Kommunens avtalsansvarig (Karims beslut 2026-11-27): systemadministratören lägger in kommunens kontaktperson för avtalet –
// namn, telefon och e-post i contracts.config.customerContact – på avtalssidan (admin.setCustomerContact). Hanterarna körs genom
// execute() mot testdatat i minnet som testpersonerna i rollväljaren. Påhittade uppgifter – aldrig riktiga personuppgifter.
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/server";
import { TESTER_HIDDEN_CODE } from "@/api/tester-access";
import { ContractConfigSchema } from "@/core/config";
import { listPersonas } from "@/data/actors";
import "./handlers";
import { adminAuditLog, adminContract, adminSetCustomerContact } from "./api";
import { testRuntime } from "./test-runtime";

let rt: ReturnType<typeof testRuntime>;
beforeEach(() => {
  rt = testRuntime();
});
const robin = () => rt.as("u-robin", "admin");
const TESTA = { name: "Testa Testsson", phone: "070-000 00 00", email: "testa.testsson@exempel.se" };
const SAVED = { name: "Testa Testsson", phone: "+46700000000", email: "testa.testsson@exempel.se" };
const EMPTY = { name: "", phone: "", email: "" };
const set = (input: { name: string; phone: string; email: string }, actor = robin()) => rt.command(adminSetCustomerContact, { contractId: "c-bot", ...input }, actor);
const contract = () => rt.rows("contracts").find((c) => c.id === "c-bot")!;
const logs = () => rt.rows("audit_log").filter((a) => a.action === "contract.customer_contact_changed");

describe("kommunens avtalsansvarig – admin.setCustomerContact", () => {
  it("testdatat har ingen; avtalssidan visar null och att systemadministratören får ändra", async () => {
    expect(contract().config).not.toHaveProperty("customerContact");
    const d = await rt.query(adminContract, {}, robin());
    expect(d.contract.customerContact).toBeNull();
    expect(d.contract.canEditCustomerContact).toBe(true);
  });

  it("sparas i avtalskonfigurationen med telefonnumret som E.164 – resten av konfigurationen är orörd", async () => {
    const before = structuredClone(contract().config);
    expect(await set(TESTA)).toEqual({ ok: true });
    const after = contract().config;
    expect(after.customerContact).toEqual(SAVED);
    const { customerContact: _c, ...rest } = after;
    void _c;
    expect(rest).toEqual(before);
    expect(ContractConfigSchema.safeParse(after).success).toBe(true);
    const d = await rt.query(adminContract, {}, robin());
    expect(d.contract.customerContact).toEqual(SAVED);
    expect(d.config.customerContact).toEqual(SAVED);
  });

  it("revisionsloggen har bara vilka fält som ändrades – aldrig namnet, numret eller adressen", async () => {
    await set(TESTA);
    await set({ ...TESTA, phone: "070-123 45 67" });
    await set(EMPTY);
    expect(logs().map((l) => [l.entity, l.entityId, l.contractId, l.actorId, l.details])).toEqual([
      ["contract", "c-bot", "c-bot", "u-robin", { fields: ["name", "phone", "email"] }],
      ["contract", "c-bot", "c-bot", "u-robin", { fields: ["phone"] }],
      ["contract", "c-bot", "c-bot", "u-robin", { fields: ["name", "phone", "email"] }],
    ]);
    const all = JSON.stringify(rt.rows("audit_log"));
    for (const v of ["Testa", "Testsson", "exempel.se", "+46700000000", "070-000", "+46701234567"]) expect(all).not.toContain(v);
    // I loggen i klarspråk: "Fält: namn, telefon, e-post".
    const view = await rt.query(adminAuditLog, {}, robin());
    expect(view.rows.filter((r) => r.action === "contract.customer_contact_changed").map((r) => [r.actionLabel, r.entityLabel, r.detailText])).toEqual([
      ["Ändrade kommunens avtalsansvarig", "Avtal", "Fält: namn, telefon, e-post"],
      ["Ändrade kommunens avtalsansvarig", "Avtal", "Fält: telefon"],
      ["Ändrade kommunens avtalsansvarig", "Avtal", "Fält: namn, telefon, e-post"],
    ].reverse());
  });

  it("tre tomma fält tar bort kontaktpersonen; samma uppgifter igen ändrar ingenting och loggas inte", async () => {
    await set(TESTA);
    expect(await set({ name: " Testa  Testsson ", phone: "+46 70 000 00 00", email: "Testa.Testsson@exempel.se" })).toMatchObject({ ok: false, error: "unchanged" });
    expect(logs()).toHaveLength(1);
    expect(await set(EMPTY)).toEqual({ ok: true });
    expect(contract().config).not.toHaveProperty("customerContact");
    expect(ContractConfigSchema.safeParse(contract().config).success).toBe(true);
    expect((await rt.query(adminContract, {}, robin())).contract.customerContact).toBeNull();
    expect(await set(EMPTY)).toMatchObject({ ok: false, error: "unchanged" });
    expect(logs()).toHaveLength(2);
  });

  it("fel per fält – ingenting sparas, ingenting loggas och felen säger aldrig vad som skrevs", async () => {
    const r = await set({ name: "", phone: "070-000", email: "testa.testsson" });
    expect(r).toMatchObject({ ok: false, error: "invalid", fields: { name: "Skriv namnet.", phone: "Skriv ett svenskt telefonnummer, till exempel 070-123 45 67.", email: "Skriv en hel e-postadress." } });
    expect(JSON.stringify(r)).not.toMatch(/070-000|testa\.testsson/);
    expect(await set({ ...TESTA, phone: "+45 20 12 34 56" })).toMatchObject({ ok: false, error: "invalid", fields: { phone: expect.any(String) } });
    expect(await set({ ...TESTA, email: "" })).toMatchObject({ ok: false, error: "invalid", fields: { email: expect.any(String) } });
    expect(contract().config).not.toHaveProperty("customerContact");
    expect(logs()).toHaveLength(0);
    expect(await rt.command(adminSetCustomerContact, { contractId: "c-finns-inte", ...TESTA }, robin())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("bara systemadministratören: alla andra roller nekas både avtalssidan och kommandot (403)", async () => {
    const others = listPersonas(rt.store.raw()).filter((p) => p.actor.role !== "admin");
    expect(new Set(others.map((p) => p.actor.role))).toEqual(new Set(["avtalsansvarig", "samordnare", "coach", "chef", "ekonom", "kommun_handlaggare", "deltagare"]));
    for (const p of others) {
      for (const call of [rt.query(adminContract, {}, p.actor), set(TESTA, p.actor)]) {
        const e = await call.then(() => null, (x: unknown) => x);
        expect(e, `${p.actor.userId} ${p.actor.role}`).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(403);
      }
    }
    expect(contract().config).not.toHaveProperty("customerContact");
    expect(logs()).toHaveLength(0);
  });

  it("begränsad testare i testmiljön: avtalssidan är stängd (commercial) – också kommandot", async () => {
    const e = await set(TESTA, { ...robin(), testerId: "tester-sara" }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(TESTER_HIDDEN_CODE);
    expect(await set(TESTA, { ...robin(), testerId: "tester-karim" })).toEqual({ ok: true });
  });
});
