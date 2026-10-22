// Byt yrkesområde (Karims beslut 2026-10-22): kommandot arenden.bytYrkesomrade och raden på deltagarkortet mot testdatat i
// minnet (MemoryRuntime, samma hanterare som appen). Ordningen: anteckningen, bytet, ärendets yrkesområde, revisionsloggen och
// sist afterCaseAreaChanged (kopplas till inbjudningarna i integrationen).
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { billingLines } from "@/core/billing";
import { requireOperational } from "@/core/config";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { caseAreaView, caseChangeArea } from "./api";

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
const change = (input: ParamsOf<typeof caseChangeArea>, actor: Actor) => rt.run("command", caseChangeArea.key, input, actor) as Promise<ResultOf<typeof caseChangeArea>>;

const NADIA = "case-260143";
const amira = () => as("u-amira", "coach");
const erik = () => as("u-erik", "coach");
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const karin = () => as("u-karin", "chef");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");
const WHY = "Kartläggningen visade erfarenhet från bygg och ett tydligt mål att arbeta där.";

describe("Byt yrkesområde (arenden.bytYrkesomrade)", () => {
  it("huvudcoachen byter: anteckning, byte, ärendets yrkesområde, revisionslogg – fakturan från månaden efter", async () => {
    const before = rt.raw().get("cases", NADIA)!;
    expect(before.primaryAreaCode).toBe("G");
    const res = await change({ caseId: NADIA, toArea: "C", motivation: `  ${WHY}  ` }, amira());
    expect(res).toMatchObject({ ok: true, effectiveMonth: "2027-03" });
    if (!res.ok) return;
    const raw = rt.raw();
    expect(raw.get("cases", NADIA)?.primaryAreaCode).toBe("C");
    const note = raw.get("case_notes", res.noteId)!;
    expect(note).toMatchObject({ caseId: NADIA, authorId: "u-amira", kind: "other", audience: "team" });
    expect(note.body).toBe(`Byte av yrkesområde: G Lager och logistik → C Bygg och anläggning. ${WHY}`);
    expect(raw.get("case_area_changes", res.changeId)).toMatchObject({
      contractId: "c-bot", caseId: NADIA, fromArea: "G", toArea: "C", effectiveMonth: "2027-03", changedBy: "u-amira", noteId: res.noteId,
    });
    const log = raw.all("audit_log").filter((l) => l.action === "case.area_changed");
    expect(log).toHaveLength(1);
    expect(log[0].details).toEqual({ caseId: NADIA, fromArea: "G", toArea: "C", effectiveMonth: "2027-03", changeId: res.changeId, noteId: res.noteId });
    // Revisionsloggen har aldrig motiveringen.
    expect(JSON.stringify(raw.all("audit_log"))).not.toContain("Kartläggningen visade");
  });

  it("samordnare, avtalsansvarig och en annan coach i avtalet får byta – chef, admin och ekonom nekas av rollkontrollen", async () => {
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY }, erik())).toMatchObject({ ok: true });
    expect(await change({ caseId: NADIA, toArea: "E", motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(await change({ caseId: NADIA, toArea: "G", motivation: WHY }, johan())).toMatchObject({ ok: true });
    for (const a of [karin(), robin(), lars()]) await expect(change({ caseId: NADIA, toArea: "C", motivation: WHY }, a), a.role).rejects.toBeInstanceOf(ApiError);
    expect(rt.raw().all("case_area_changes").filter((x) => x.caseId === NADIA).map((x) => [x.fromArea, x.toArea])).toEqual([["G", "C"], ["C", "E"], ["E", "G"]]);
  });

  it("nekas: samma eller okänt yrkesområde, för kort eller för lång motivering, personnummer, avslutat ärende – inget skrivs", async () => {
    const closed = rt.raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot")!;
    const cases: [ParamsOf<typeof caseChangeArea>, string][] = [
      [{ caseId: NADIA, toArea: "G", motivation: WHY }, "same"],
      [{ caseId: NADIA, toArea: "Z", motivation: WHY }, "area"],
      [{ caseId: NADIA, toArea: "C", motivation: "  kort  " }, "motivation"],
      [{ caseId: NADIA, toArea: "C", motivation: "x".repeat(301) }, "motivation"],
      [{ caseId: NADIA, toArea: "C", motivation: "Enligt kommunen gäller 19730216-9545 numera." }, "pnr"],
      [{ caseId: closed.id, toArea: closed.primaryAreaCode === "C" ? "E" : "C", motivation: WHY }, "closed"],
      [{ caseId: "case-finns-inte", toArea: "C", motivation: WHY }, "not_found"],
    ];
    const notes = rt.raw().all("case_notes").length;
    for (const [input, code] of cases) expect(await change(input, amira()), code).toMatchObject({ ok: false, error: code });
    expect(rt.raw().all("case_area_changes")).toHaveLength(1); // bara testdatats byte
    expect(rt.raw().all("case_notes")).toHaveLength(notes);
    expect(rt.raw().get("cases", NADIA)?.primaryAreaCode).toBe("G");
  });

  it("ett alternativt yrkesområde som blir det nya tas bort som alternativ", async () => {
    const c = rt.raw().all("cases").find((x) => x.status === "active" && x.secondaryAreaCode && x.secondaryAreaCode !== x.primaryAreaCode)!;
    const second = c.secondaryAreaCode!;
    expect(await change({ caseId: c.id, toArea: second, motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", c.id)).toMatchObject({ primaryAreaCode: second, secondaryAreaCode: null });
  });

  it("fakturan: bytesmånaden på det gamla yrkesområdet, månaden efter på det nya", async () => {
    const res = await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira());
    expect(res).toMatchObject({ ok: true, effectiveMonth: "2027-03" });
    const raw = rt.raw();
    const cfg = requireOperational(raw.get("contracts", "c-bot")!.config);
    const db = {
      cases: raw.all("cases").filter((c) => c.id === NADIA), activities: [...raw.all("activities")], attendance: [...raw.all("attendance")], price_items: [...raw.all("price_items")],
      billing_week_approvals: [], case_area_changes: [...raw.all("case_area_changes")],
    };
    const [feb] = billingLines(db, "2027-02", { now: "2027-03-20T09:00", cfg });
    expect(feb.areaCode).toBe("G");
    expect(feb.unitPriceOre).toBe(raw.all("price_items").find((p) => p.areaCode === "G")!.priceOre);
  });
});

describe("Yrkesområdet på deltagarkortet (arenden.kortYrkesomrade)", () => {
  it("nuvarande yrkesområde, de andra aktiva att byta till, och bytena – nyast först", async () => {
    const v = (await q(caseAreaView, { caseId: "case-260163" }, amira()))!;
    expect(v.current).toEqual({ code: "D", name: "Kök, restaurang och måltidsservice" });
    expect(v.canChange).toBe(true);
    expect(v.options.map((a) => a.code)).not.toContain("D");
    expect(v.options).toHaveLength(11);
    expect(v.effectiveMonth).toBe("2027-03");
    expect(v.history).toEqual([{ id: "cac-seed-linnea", changedAt: "2027-01-27T14:10", fromArea: "G", toArea: "D", byName: "Amira Haddad", effectiveMonth: "2027-02" }]);
  });

  it("chef och systemadministratör ser raden i läsläge; kommunen och ekonomen får inget", async () => {
    for (const a of [karin(), robin()]) expect(await q(caseAreaView, { caseId: "case-260163" }, a), a.role).toMatchObject({ canChange: false, blockedText: null });
    await expect(q(caseAreaView, { caseId: "case-260163" }, lars())).rejects.toBeInstanceOf(ApiError);
    const kommun = as(rt.raw().get("cases", "case-260163")!.referrerId!, "kommun_handlaggare");
    await expect(q(caseAreaView, { caseId: "case-260163" }, kommun)).rejects.toBeInstanceOf(ApiError);
  });

  it("avslutat ärende: kan inte bytas och raden säger varför", async () => {
    const closed = rt.raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot")!;
    expect(await q(caseAreaView, { caseId: closed.id }, sara())).toMatchObject({ canChange: false, blockedText: "Insatsen är avslutad. Yrkesområdet kan inte bytas." });
  });
});
