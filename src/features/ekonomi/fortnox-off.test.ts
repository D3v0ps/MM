// Fortnox av i skarp drift (beslut 2026-10-08, pengasäkerhet): i supabase-läget saknas ctx.fortnox tills en riktig klient
// finns. Då svarar "Skapa i Fortnox", "Hämta status från Fortnox" och "Kreditera och skapa ny" med fortnox_off utan att
// ändra eller logga något, vyerna säger connected: false, och inget påhittat fakturanummer visas. Ctx byggs som servern gör
// (liveCtx utan fortnox) mot testdatat i minnet. Minneskörningen (createMemoryRuntime) har den simulerade porten och
// fungerar som förut – samma testdata, samma kommandon.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { execute } from "@/api/handlers";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import type { AppRepo, TableName, Tables } from "@/data/schema";
import { liveCtx } from "@/server/ctx";
import { createSimulatedFortnox, FORTNOX_OFF_ERROR, fortnoxOff } from "@/features/_shared/fortnox-port";
import { billingApproveInvoice, billingApproveZeroWeek, billingSendFortnox, ekoFortnoxSync, ekoPreview, ekoReissue, ekoRun, ekoStart, invoiceSetBuyerRef } from "./api";

const SEED: MemoryData<Tables> = createSeed();
const JAN = "inv-c-bot-2027-01-avtal";
const DEC1 = "inv-c-bot-2026-12-avtal";
const DEC2 = "inv-c-bot-2026-12-avtal-tillagg-2";
/** Tabellerna som Fortnox-kommandona skriver – ska vara orörda utan port. */
const WRITTEN: readonly TableName[] = ["invoice_drafts", "invoice_lines", "fortnox_runs", "invoice_credits", "audit_log"];

let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});

const lars = (): Actor => listPersonas(rt.raw()).find((x) => x.actor.userId === "u-lars" && x.actor.role === "ekonom")!.actor;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const snapshot = () => JSON.stringify(WRITTEN.map((t) => rt.store.rows(t)));

/** Serverns Ctx i supabase-läget (liveCtx) utan Fortnox-port, över samma testdata som minneskörningen. */
function offCtx(actor: Actor = lars()) {
  const system = new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const repo = new MemoryRepo<Tables>(rt.store, actor, POLICIES) as unknown as AppRepo;
  let n = 0;
  return liveCtx({ actor, now: rt.clock.now(), repo, system, enqueue: async () => undefined, newId: (p) => `${p}-off${++n}` });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const offCmd = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>) => execute("command", def.key, input, offCtx()) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const offQry = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>) => execute("query", def.key, input, offCtx()) as Promise<ResultOf<D>>;
// Minnesläget (den simulerade porten) – som prototypen och utvecklingsläget.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const memCmd = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>) => rt.run("command", def.key, input, lars()) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const memQry = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>) => rt.run("query", def.key, input, lars()) as Promise<ResultOf<D>>;

/** Januari klar att skapas: veckorna utan närvaro godkända, referensen ifylld, fakturan godkänd (rör inte Fortnox). */
async function readyJanuary() {
  const v = await memQry(ekoRun, { month: "2027-01" });
  for (const l of v.invoices.flatMap((x) => x.lines).filter((x) => x.needsApproval)) {
    for (const ch of l.checks.filter((c) => c.kind === "zero_week" && c.severity === "needs_approval")) {
      await memCmd(billingApproveZeroWeek, { month: "2027-01", caseId: l.caseId, weekKey: ch.weekKey!, note: "Kontrollerat med samordnaren." });
    }
  }
  expect(await memCmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" })).toMatchObject({ ok: true });
  expect(await memCmd(billingApproveInvoice, { month: "2027-01", invoiceId: JAN })).toMatchObject({ ok: true });
}

const OFF = { ok: false, error: "fortnox_off", message: FORTNOX_OFF_ERROR };

describe("Fortnox av (ctx.fortnox saknas): ingenting skapas, ändras eller loggas", () => {
  it("porten: liveCtx sätter den bara när den skickas in, minnesläget har den simulerade", () => {
    expect(offCtx().fortnox).toBeUndefined();
    expect(fortnoxOff(offCtx())).toBe(true);
    const base = offCtx();
    const on = liveCtx({ actor: base.actor, now: rt.clock.now(), repo: base.repo, system: base.system, enqueue: async () => undefined, fortnox: createSimulatedFortnox() });
    expect(on.fortnox).toEqual({ provider: "simulated" });
    expect(fortnoxOff(on)).toBe(false);
  });

  it("Skapa i Fortnox: fortnox_off – ingen rad fryses, statusen står kvar, inget nummer, ingen körning och ingen logg", async () => {
    await readyJanuary();
    expect(rt.raw().get("invoice_drafts", JAN)?.status).toBe("approved");
    const before = snapshot();
    expect(await offCmd(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] })).toMatchObject(OFF);
    expect(snapshot()).toBe(before);
    expect(rt.raw().get("invoice_drafts", JAN)).toMatchObject({ status: "approved", fortnoxDocumentNumber: null, fortnoxIdempotencyKey: null, fortnoxCreatedAt: null });
    expect(rows("invoice_lines").some((l) => l.invoiceDraftId === JAN)).toBe(false);
    expect(rows("fortnox_runs").some((r) => r.month === "2027-01")).toBe(false);
    expect(rows("audit_log").some((l) => l.action === "billing.fortnox_created")).toBe(false);
    // Minnesläget (simulerad port) fungerar som förut: fakturan skapas, raderna fryses, numret sätts och körningen loggas.
    expect(await memCmd(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] })).toMatchObject({ ok: true, created: [JAN], skipped: [] });
    expect(rt.raw().get("invoice_drafts", JAN)).toMatchObject({ status: "fortnox_created", fortnoxIdempotencyKey: "c-bot:2027-01:avtal" });
    expect(rt.raw().get("invoice_drafts", JAN)?.fortnoxDocumentNumber).toMatch(/^\d{5}$/);
    expect(rows("invoice_lines").filter((l) => l.invoiceDraftId === JAN)).toHaveLength(124);
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "billing.fortnox_created", entityId: "2027-01" });
  });

  it("Hämta status från Fortnox: fortnox_off – ingen faktura flyttas, ingen körning, ingen logg", async () => {
    const dec = rows("invoice_drafts").filter((d) => d.month === "2026-12" && d.kind === "periodic" && ["fortnox_created", "booked", "sent"].includes(d.status));
    expect(dec.length).toBeGreaterThan(0);
    const before = snapshot();
    expect(await offCmd(ekoFortnoxSync, { month: "2026-12" })).toMatchObject(OFF);
    expect(snapshot()).toBe(before);
    expect(rows("fortnox_runs").some((r) => r.kind === "sync")).toBe(false);
    expect(rows("audit_log").some((l) => l.action === "billing.fortnox_status_synced")).toBe(false);
    // Minnesläget: ett steg per hämtning, som förut.
    expect(await memCmd(ekoFortnoxSync, { month: "2026-12" })).toEqual({ ok: true, changed: dec.length });
    expect(rt.raw().get("invoice_drafts", DEC1)?.status).toBe("paid");
  });

  it("Kreditera och skapa ny: fortnox_off – ingen kreditering, fakturan är fortfarande returnerad", async () => {
    expect(await memCmd(invoiceSetBuyerRef, { month: "2026-12", invoiceId: DEC2, reference: "55102938" })).toMatchObject({ ok: true });
    const before = snapshot();
    expect(await offCmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 })).toMatchObject(OFF);
    expect(snapshot()).toBe(before);
    expect(rt.raw().get("invoice_drafts", DEC2)?.status).toBe("returned");
    expect(rows("invoice_credits").some((x) => x.invoiceDraftId === DEC2)).toBe(false);
    expect(rows("audit_log").some((l) => l.action === "billing.credited_and_reissued")).toBe(false);
  });

  it("vyerna: connected false utan port (körningen och startsidan), true i minnesläget", async () => {
    expect((await offQry(ekoRun, { month: "2027-01" })).fortnox).toEqual({ connected: false });
    expect((await offQry(ekoRun, {})).fortnox).toEqual({ connected: false });
    expect((await offQry(ekoStart, {})).fortnox).toMatchObject({ connected: false });
    expect((await memQry(ekoRun, { month: "2027-01" })).fortnox).toEqual({ connected: true });
    expect((await memQry(ekoStart, {})).fortnox).toMatchObject({ connected: true });
  });

  it("fakturanummer i Fortnox visas bara när det är lagrat – aldrig ett framräknat", async () => {
    // Testdatats skapade fakturor har sitt nummer lagrat (samma i båda körlägena).
    const stored = rt.raw().get("invoice_drafts", DEC1)!.fortnoxDocumentNumber;
    expect(stored).toMatch(/^\d{5}$/);
    const find = (v: ResultOf<typeof ekoRun>, id: string) => v.invoices.find((x) => x.id === id)!;
    expect(find(await offQry(ekoRun, { month: "2026-12" }), DEC1).fortnoxNo).toBe(stored);
    expect(find(await memQry(ekoRun, { month: "2026-12" }), DEC1).fortnoxNo).toBe(stored);
    // Utan lagrat nummer (en faktura skapad för hand i Fortnox, eller innan numret hämtats): inget nummer, i båda körlägena.
    rt.store.updateRow("invoice_drafts", DEC1, { fortnoxDocumentNumber: null });
    expect(find(await offQry(ekoRun, { month: "2026-12" }), DEC1).fortnoxNo).toBeNull();
    expect(find(await memQry(ekoRun, { month: "2026-12" }), DEC1).fortnoxNo).toBeNull();
    // Fakturavyn (faktura.tsx) läser samma fält: "Fakturanummer i Fortnox" visas inte utan lagrat nummer.
    const preview = await offQry(ekoPreview, { month: "2026-12", invoiceId: DEC1 });
    expect(preview.preview?.inv.id).toBe(DEC1);
    expect(preview.preview?.inv.fortnoxNo).toBeNull();
    expect(find(await offQry(ekoRun, { month: "2026-12" }), DEC1).status).toBe("sent");
  });
});
