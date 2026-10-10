// Alla roller samtidigt (Karims beslut 7, 2026-10-09) – hanterarna efter granskningen: aldrig mer än summan av rollerna.
// Hela vägen genom hanterarna i minnesläget med testdatat och ett påhittat andra avtal (c-ny, en kopia av Botkyrkas
// konfiguration) där personer får roller som skiljer sig från rollerna i Botkyrka:
//   * en roll ger bara rätt i de avtal där personen har just den rollen (chef i c-ny och coach i c-bot får ledningsvyn, chefens
//     eskaleringar, inkorgen och beställningen bara i c-ny – aldrig i c-bot);
//   * ekonomen ändrar bara beställarreferensen (case.setBuyerRef) – coach och ekonom ändrar inte ett skyddat ärende som ingen av
//     rollerna ensam får ändra; ekonom och kommunens handläggare ändrar inget annat i ett ärende hen inte beställt;
//   * belopp i kronor bara i avtalen där personen är ekonom;
//   * en begränsad testare med ekonom och en annan roll arbetar med den andra rollen (testerActor) i stället för att bli utelåst.
import { beforeEach, describe, expect, it } from "vitest";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { testerActor } from "@/api/tester-access";
import { actorFor } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  const data = structuredClone(SEED);
  const bot = data.contracts.find((c) => c.id === "c-bot")!;
  data.contracts.push({ ...bot, id: "c-ny", name: "Nytt kommunavtal (påhittat)", contractNumber: "000000001", casePrefix: "NYK", config: { ...bot.config, casePrefix: "NYK" } });
  rt = createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
});

const addRole = (userId: string, role: Role, contractId: string) =>
  rt.store.insertRow("memberships", { id: `${userId}:${contractId}:${role}:x`, userId, contractId, role, customerUnit: null });
const actor = (userId: string): Actor => {
  const a = actorFor(rt.raw(), userId);
  if (!a) throw new Error(`Ingen aktör: ${userId}`);
  return a;
};
type Res = { ok: boolean; error?: string; [k: string]: unknown };
const q = <T = Record<string, unknown>>(key: string, input: unknown, a: Actor) => rt.run("query", key, input, a) as Promise<T>;
const cmd = (key: string, input: unknown, a: Actor) => rt.run("command", key, input, a) as Promise<Res>;
const protect = (caseId: string) => rt.store.updateRow("persons", rt.raw().get("cases", caseId)!.personId, { protectedIdentity: true });

describe("ekonomen ändrar bara beställarreferensen – också med andra roller", () => {
  it("coach och ekonom ändrar inte plats, bakgrund eller omfattning i ett skyddat ärende (vilande spärr) – bara referensen", async () => {
    const c = rt.raw().get("cases", "case-260117")!;
    expect(c.leadCoachId).not.toBe("u-amira");
    protect(c.id);
    // Bara coach: nekas (samma som förut).
    expect(await cmd("arenden.caseUpdate", { caseId: c.id, patch: { location: "Ny plats" } }, actor("u-amira"))).toMatchObject({ ok: false, error: "forbidden" });
    addRole("u-amira", "ekonom", "c-bot");
    const amira = actor("u-amira");
    expect(amira.roles).toEqual(["coach", "ekonom"]);
    for (const patch of [{ location: "Ny plats" }, { backgroundInfo: "Ny bakgrund" }, { orderValueWeeks: 99 }, { meetingTime: "10:00" }]) {
      expect(await cmd("arenden.caseUpdate", { caseId: c.id, patch }, amira), JSON.stringify(patch)).toMatchObject({ ok: false, error: "forbidden" });
    }
    expect(rt.raw().get("cases", c.id)).toMatchObject({ location: c.location, backgroundInfo: c.backgroundInfo, orderValueWeeks: c.orderValueWeeks });
    // Beställarreferensen (ekonomens enda fält) går.
    expect(await cmd("arenden.caseSetBuyerRef", { caseId: c.id, reference: "1234567890" }, amira)).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", c.id)!.buyerReference).toBe("1234567890");
  });

  it("ekonom och kommunens handläggare: varken ärendets fält eller meddelanden i ett ärende hen inte beställt – bara referensen", async () => {
    const c = rt.raw().all("cases").find((x) => x.referrerId === "k-maria" && x.status === "active")!;
    addRole("u-lars", "kommun_handlaggare", "c-bot");
    const lars = actor("u-lars");
    expect(lars.roles).toEqual(["ekonom", "kommun_handlaggare"]);
    expect(await cmd("arenden.caseUpdate", { caseId: c.id, patch: { orderValueWeeks: 99 } }, lars)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd("arenden.caseUpdate", { caseId: c.id, patch: { backgroundInfo: "Ny" } }, lars)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd("arenden.caseUpdate", { caseId: c.id, patch: { referrerPhone: "070-000 00 00" } }, lars)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd("arenden.messageSend", { caseId: c.id, body: "Hej" }, lars)).toMatchObject({ ok: false, error: "forbidden" });
    expect(rt.raw().get("cases", c.id)).toMatchObject({ orderValueWeeks: c.orderValueWeeks, backgroundInfo: c.backgroundInfo, referrerPhone: c.referrerPhone });
    expect(await cmd("arenden.caseSetBuyerRef", { caseId: c.id, reference: "1234567890" }, lars)).toMatchObject({ ok: true });
    // Beställande handläggare ändrar sina kontaktuppgifter – inte omfattningen.
    const maria = actor("k-maria");
    expect(await cmd("arenden.caseUpdate", { caseId: c.id, patch: { referrerPhone: "070-000 00 01" } }, maria)).toMatchObject({ ok: true });
    expect(await cmd("arenden.caseUpdate", { caseId: c.id, patch: { orderValueWeeks: 99 } }, maria)).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("roller i olika avtal: en roll ger bara rätt i sitt eget avtal", () => {
  it("chef i c-ny och coach i c-bot: ledningsvyn för c-ny, inga eskaleringar för ärendena i c-bot", async () => {
    addRole("u-amira", "chef", "c-ny");
    const amira = actor("u-amira");
    expect(amira.roleContracts).toEqual({ coach: ["c-bot"], chef: ["c-ny"] });
    expect(await q("ledning.head", {}, amira)).toMatchObject({ contractNumber: "000000001", alertCount: 0 });
    // Chefen i c-bot får eskaleringarna (testdatat har tre); chefen i c-ny inga för c-bot – coachen ser dem aldrig.
    const esc = (items: { kind: string }[]) => items.filter((n) => n.kind === "progress_escalation").length;
    expect(esc((await q<{ items: { kind: string }[] }>("notiser.list", {}, actor("u-karin"))).items)).toBeGreaterThan(0);
    const mine = await q<{ items: { kind: string }[]; isEscalationRole: boolean }>("notiser.list", {}, amira);
    expect(mine.isEscalationRole).toBe(true);
    expect(esc(mine.items)).toBe(0);
    // Coachens påminnelser i c-bot finns kvar.
    expect(mine.items.some((n) => n.kind === "progress_reminder")).toBe(true);
    // Registret över avtalsavvikelser: bara c-ny (c-bot har avvikelser i testdatat).
    expect((await q<{ rows: unknown[] }>("ledning.cdevRegister", {}, amira)).rows).toEqual([]);
    const cd = rt.raw().all("contract_deviations").find((x) => x.contractId === "c-bot")!;
    expect(await q("ledning.cdevDetail", { id: cd.id }, amira)).toEqual({ found: false });
  });

  it("samordnare i c-ny och coach i c-bot: beställningen hamnar i c-ny; veckorapporter i c-bot godkänns och levereras inte", async () => {
    addRole("u-amira", "samordnare", "c-ny");
    const amira = actor("u-amira");
    const created = await cmd("arenden.caseCreate", { firstName: "Test", lastName: "Testsson", desiredStart: "2027-02-08", orderPeriodMonths: 6 }, amira);
    expect(created).toMatchObject({ ok: true });
    expect(String(created.caseNumber)).toMatch(/^NYK-/);
    expect(rt.raw().get("cases", String(created.caseId))!.contractId).toBe("c-ny");
    // Inkorgens startsida gäller samordnarens avtal: inga flaggor eller uppgifter från coachens avtal.
    const start = await q<{ alerts: unknown[]; tasks: unknown[] }>("inkorg.start", {}, amira);
    expect(start.alerts).toEqual([]);
    expect(start.tasks).toEqual([]);
    // En veckorapport i c-bot: samordnaren i c-bot godkänner, samordnaren i c-ny (coach i c-bot) inte.
    const weekly = rt.raw().all("reports").find((r) => r.contractId === "c-bot" && r.kind === "weekly_attendance" && !r.superseded && !r.deliveredAt)!;
    expect(weekly).toBeTruthy();
    rt.store.updateRow("reports", weekly.id, { status: "draft" });
    expect(await cmd("rapporter.reportApprove", { reportId: weekly.id }, amira)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd("rapporter.reportApprove", { reportId: weekly.id }, actor("u-sara"))).toMatchObject({ ok: true });
  });

  it("samordnare och coach i samma avtal: Min veckas samordningsdel har bara samordningens flaggor och uppgifter", async () => {
    addRole("u-amira", "samordnare", "c-bot");
    const both = await q<{ alerts: { key: string }[]; tasks: { id: string }[] }>("inkorg.start", {}, actor("u-amira"));
    const sara = await q<{ alerts: { key: string }[]; tasks: { id: string }[] }>("inkorg.start", {}, actor("u-sara"));
    // Samma flaggor som samordnaren Sara – inga av coachens egna (de står i coachens del).
    expect(both.alerts.map((a) => a.key).sort()).toEqual(sara.alerts.map((a) => a.key).sort());
    // Uppgifterna till rollen samordnare – aldrig uppgifter till coachen.
    const coachTasks = rt.raw().all("tasks").filter((t) => t.toRole === "coach" && t.status === "open").map((t) => t.id);
    expect(both.tasks.some((t) => coachTasks.includes(t.id))).toBe(false);
  });

  it("coach i c-bot och ekonom i c-ny: ekonomin gäller c-ny – prislistan för c-ny, inga belopp i c-bot", async () => {
    addRole("u-amira", "ekonom", "c-ny");
    const amira = actor("u-amira");
    expect(await q("ekonomi.priceList", {}, amira)).toMatchObject({ contractNumber: "000000001" });
    // Lars (ekonom i c-bot) får c-bot.
    expect(await q("ekonomi.priceList", {}, actor("u-lars"))).toMatchObject({ contractNumber: "332026110" });
    // Ekonomen i c-bot ser priserna där; den som är coach i c-bot (och ekonom i c-ny) läser samma rader i datalagret utan
    // belopp (MONEY_MASK per avtal).
    const prices = await rt.run("query", "ekonomi.priceList", {}, actor("u-lars")) as { items: { priceOre: number }[] };
    expect(prices.items.some((p) => p.priceOre > 0)).toBe(true);
    const repo = new MemoryRepo<Tables>(rt.store, amira, POLICIES);
    const botPrices = await repo.table("price_items").list({ contractId: "c-bot" });
    expect(botPrices.length).toBeGreaterThan(0);
    expect(botPrices.every((p) => p.priceOre === 0)).toBe(true);
  });

  it("systemadministratören som är ekonom i ett annat avtal ser inte prislistan eller vitenas belopp i c-bot", async () => {
    addRole("u-robin", "ekonom", "c-ny");
    const robin = actor("u-robin");
    const view = await q<{ priceItems?: unknown[]; penaltiesHidden: boolean; config: { penalties?: unknown } }>("admin.contract", { contractId: "c-bot" }, robin);
    expect(view.priceItems).toBeUndefined();
    expect(view.penaltiesHidden).toBe(true);
    expect(view.config.penalties).toBeUndefined();
    // Ekonom i c-bot: prislistan och vitena syns.
    addRole("u-robin", "ekonom", "c-bot");
    const both = await q<{ priceItems?: unknown[]; config: { penalties?: { deviationOre: number } } }>("admin.contract", { contractId: "c-bot" }, actor("u-robin"));
    expect(both.priceItems?.length).toBeGreaterThan(0);
    expect(both.config.penalties?.deviationOre).toBe(2500000);
  });
});

describe("begränsad testare med rollen ekonom och en annan roll", () => {
  it("arbetar som coach (coach.minVecka) – ekonomins frågor nekas, inte allt", async () => {
    addRole("u-amira", "ekonom", "c-bot");
    const raw = { ...actor("u-amira"), testerId: "tester-sara" };
    const a = testerActor(raw);
    expect(a.roles).toEqual(["coach"]);
    expect(await q("coach.minVecka", {}, a)).toBeTruthy();
    await expect(rt.run("query", "ekonomi.start", {}, a)).rejects.toBeInstanceOf(ApiError);
    await expect(rt.run("query", "ekonomi.start", {}, a)).rejects.toMatchObject({ status: 403 });
    // Utan testerActor (rollen kvar) nekas allt utom sessionens frågor – det testaren skulle ha mött.
    await expect(rt.run("query", "coach.minVecka", {}, raw)).rejects.toMatchObject({ status: 403, code: "tester_hidden" });
  });
});
