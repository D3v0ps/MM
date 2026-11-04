// Ekonomens att göra-lista på Min vecka (paket 2, E2): en rad per faktura med alla anmärkningar och en knapp. Körs mot
// testdatat (demoklockan 1 februari 2027 kl. 09.12) genom samma execute() som appen och prototypen.
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import "@/api/handlers";
import type { Actor } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { ekoStart, type BillingStartView } from "./api";
import { invoiceTodos } from "./todo";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const lars = (): Actor => listPersonas(rt.raw()).find((x) => x.actor.userId === "u-lars" && x.actor.role === "ekonom")!.actor;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;

describe("invoiceTodos – en rad per faktura", () => {
  it("testdatat: januarifakturan, den returnerade tilläggsfakturan och uppgiften – sorterade på sista tid", async () => {
    const v = await q(ekoStart, {}, lars());
    const rows = invoiceTodos(v, DEMO_START);
    expect(rows.map((r) => r.title)).toEqual(["Faktura januari 2027", "Tilläggsfaktura 2 · december 2026", "Uppgift från Johan Berg"]);
    const [jan, dec, task] = rows;
    // Januari: sista dag i Fortnox, referensen saknas och tre veckor utan närvaro – knappen fyller i referensen (stoppar fakturan).
    expect(jan.dueAt).toBe(v.current?.due);
    expect(jan.notes[0]).toMatch(/^Beställarreferens saknas/);
    expect(jan.notes[1]).toBe("3 veckor utan närvaro att godkänna: BOT-26-0157 v. 3, BOT-26-0159 v. 2, BOT-27-0031 v. 4.");
    expect(jan.notes[2]).toMatch(/^124 rader · 356 veckor · 511 332 kr exkl\. moms · stoppad/);
    expect(jan.action).toMatchObject({ kind: "ref", invoiceId: jan.invoiceId });
    // December: returnerad, spärrad referens och preskriptionsrisken för båda ärendena på fakturan – en rad.
    expect(dec.dueAt).toBe("2027-02-06");
    expect(dec.notes.filter((n) => n.startsWith("Preskriptionsrisk"))).toHaveLength(2);
    expect(dec.notes.some((n) => n.startsWith("Returnerad av kommunen"))).toBe(true);
    expect(dec.action).toMatchObject({ kind: "ref", invoiceId: dec.invoiceId });
    expect(task.action).toMatchObject({ kind: "task" });
  });

  it("varje siffra på ett ställe: varje faktura och varje ofakturerad vecka står på exakt en rad", async () => {
    const v = await q(ekoStart, {}, lars());
    const rows = invoiceTodos(v, DEMO_START);
    const ids = rows.map((r) => r.invoiceId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    // Alla fakturor som saknar referens (två – inte "1 stoppad") står på var sin rad.
    expect(v.refInvoices).toHaveLength(2);
    for (const r of v.refInvoices) expect(rows.filter((x) => x.invoiceId === r.invoiceId)).toHaveLength(1);
    for (const u of v.unbilled.rows) expect(rows.flatMap((r) => r.notes).filter((n) => n.startsWith(`Preskriptionsrisk ${u.caseNumber}:`))).toHaveLength(1);
  });

  it("en returnerad faktura med rättad referens: knappen krediterar och skapar en ny", () => {
    const v = {
      current: null, tasks: [], refInvoices: [], zero: [], unbilled: { rows: [] },
      returned: [
        {
          invoiceId: "inv-1", month: "2026-12", title: "Tilläggsfaktura 2 · december 2026", status: "returned", lines: 2, quantity: 10, amountOre: 1393500, caseNumbers: [],
          buyerReference: "55102938", refOk: true, credit: null,
        },
      ],
    } as unknown as BillingStartView;
    const [r] = invoiceTodos(v, DEMO_START);
    expect(r.action).toMatchObject({ kind: "reissue" });
    expect(r.notes[0]).toContain("Referensen är rättad");
  });
});
