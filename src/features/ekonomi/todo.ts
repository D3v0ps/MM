// Ekonomens att göra-lista på Min vecka (paket 2, E2): en rad per faktura med alla anmärkningar – stoppad, saknar eller har
// spärrad beställarreferens, returnerad av kommunen, veckor utan närvaro att godkänna, preskriptionsrisk och sista dag i
// Fortnox – och en knapp. Varje siffra står på ett ställe (raden för sin faktura). Uppgifterna till ekonomen står på egna rader.
// Ren funktion av ekonomi.start (ingen I/O, ingen React) – faktureringsreglerna och kommandona är oförändrade; den här filen
// ordnar bara det som vy-modellen redan har. Ordningen och sammanslagningen: todoRows (src/core/todo.ts).
import { kr } from "@/core/format";
import { todoRows, whenText, type TodoPart } from "@/core/todo";
import { fmtDate, fmtWeekKey } from "@/core/time";
import type { BillingStartView, ReturnedRow, TaskView } from "./api";
import { plural, weekText } from "./model";

/** Radens knapp: fyll i referensen (dialogen), kreditera och skapa ny, godkänn veckor utan närvaro, öppna körningen, uppgiften klar. */
export type InvoiceTodoAction =
  | { kind: "ref"; invoiceId: string; month: string; title: string; buyerReference: string | null }
  | { kind: "reissue"; row: ReturnedRow }
  | { kind: "approve"; month: string }
  | { kind: "run"; month: string }
  | { kind: "bonus"; month: string }
  | { kind: "task"; task: TaskView };

export type InvoiceTodo = {
  key: string;
  /** Fakturan (null för uppgifter och för veckor som bara är underlag). */
  invoiceId: string | null;
  title: string;
  /** Sista tid: Fortnox-dagen för körningens fakturor, preskriptionsdagen för gamla veckor. */
  dueAt: string | null;
  dueText: string | null;
  /** Anmärkningarna, en per sak – siffrorna står bara här. */
  notes: string[];
  action: InvoiceTodoAction | null;
};

type Part = TodoPart & { title: string | null; note: string; action: InvoiceTodoAction | null; dueText: string | null };

/** Ordningen och vilken anmärkning som ger raden dess knapp (lägre först). */
const W = { reissue: 5, ref: 10, unbilled: 15, approve: 20, run: 30, bonus: 35, task: 40 } as const;

export function invoiceTodos(v: BillingStartView, now: string): InvoiceTodo[] {
  const parts: Part[] = [];
  const cur = v.current;
  // Körningens fakturor som inte är klara: stoppade eller att godkänna, med Fortnox-dagen som sista tid.
  if (cur) {
    for (const inv of cur.invoiceRows.filter((x) => x.bucket !== "ready")) {
      parts.push({
        key: `run:${inv.invoiceId}`, group: inv.invoiceId, dueAt: cur.status === "draft" ? cur.due : null, weight: W.run, title: inv.title,
        dueText: cur.status === "draft" ? `ska vara skapad i Fortnox ${whenText(cur.due, now)}` : null,
        note: `${plural(inv.lines, "rad", "rader")} · ${plural(inv.weeks, "vecka", "veckor")} · ${kr(inv.amountOre)} exkl. moms · ${inv.bucket === "blocked" ? "stoppad" : "att granska och godkänna"}${cur.status === "draft" ? ` – skapas i Fortnox senast ${whenText(cur.due, now)}` : ""}.`,
        action: { kind: "run", month: cur.month },
      });
    }
  }
  // Returnerade fakturor som inte är krediterade.
  for (const r of v.returned.filter((x) => !x.credit)) {
    parts.push({
      key: `returned:${r.invoiceId}`, group: r.invoiceId, dueAt: null, weight: r.refOk ? W.reissue : W.ref, title: r.title, dueText: null,
      note: `Returnerad av kommunen: ${r.bonus ? plural(r.quantity, "bonussteg faktureras", "bonussteg faktureras") : plural(r.quantity, "vecka faktureras", "veckor faktureras")} om på en ny faktura (${plural(r.lines, "rad", "rader")}, ${kr(r.amountOre)}).${r.refOk ? " Referensen är rättad – kreditera och skapa en ny." : ""}`,
      action: r.refOk ? { kind: "reissue", row: r } : { kind: "ref", invoiceId: r.invoiceId, month: r.month, title: r.title, buyerReference: r.buyerReference },
    });
  }
  // Fakturor som saknar eller har fel beställarreferens (öppna körningar och returnerade).
  for (const r of v.refInvoices) {
    parts.push({
      key: `ref:${r.invoiceId}`, group: r.invoiceId, dueAt: null, weight: W.ref, title: r.title, dueText: null, note: r.problem,
      action: { kind: "ref", invoiceId: r.invoiceId, month: r.month, title: r.title, buyerReference: r.buyerReference },
    });
  }
  // Veckor utan närvaro att godkänna – en anmärkning per faktura.
  const zeroBy = new Map<string, BillingStartView["zero"]>();
  for (const z of v.zero.filter((x) => !x.approved)) zeroBy.set(z.invoiceId, [...(zeroBy.get(z.invoiceId) ?? []), z]);
  for (const [invoiceId, zs] of zeroBy) {
    parts.push({
      key: `zero:${invoiceId}`, group: invoiceId, dueAt: null, weight: W.approve, title: null, dueText: null,
      note: `${plural(zs.length, "vecka", "veckor")} utan närvaro att godkänna: ${zs.map((z) => `${z.caseNumber} ${fmtWeekKey(z.weekKey).replace(/ \d{4}$/, "")}`).join(", ")}.`,
      action: { kind: "approve", month: zs[0].month },
    });
  }
  // Preskriptionsrisk: ofakturerade veckor äldre än gränsen – på fakturan som har veckan.
  for (const u of v.unbilled.rows) {
    parts.push({
      key: `presc:${u.caseId}`, group: u.invoiceId ?? `arende:${u.caseId}`, dueAt: u.presc, weight: W.unbilled, title: u.invoiceId ? null : `Ofakturerade veckor – ${u.caseNumber}`,
      dueText: `preskriberas ${fmtDate(u.presc)}`,
      note: `Preskriptionsrisk ${u.caseNumber}: ${plural(u.weeks.length, "vecka", "veckor")} (${weekText(u.weeks)}) · ${kr(u.amountOre)} · preskriberas ${fmtDate(u.presc)} (${u.left >= 0 ? `om ${plural(u.left, "dag", "dagar")}` : "passerat"}).`,
      action: null,
    });
  }
  // Bonusfakturor som inte är skapade (beslut 2026-11-04) – en rad per faktura, ingen tidsgräns.
  for (const b of v.bonus) {
    parts.push({
      key: `bonus:${b.invoiceId}`, group: b.invoiceId, dueAt: null, weight: W.bonus, title: b.title, dueText: null,
      note: `${plural(b.lines, "bonussteg", "bonussteg")} godkända av kommunen · ${kr(b.amountOre)} exkl. moms · ${b.bucket === "blocked" ? "stoppad" : b.bucket === "review" ? "att granska och godkänna" : "klar att skapa"}.`,
      action: { kind: "bonus", month: b.month },
    });
  }
  // Uppgifter till ekonomen: egna rader.
  for (const t of v.tasks.filter((x) => x.status === "open")) {
    parts.push({ key: `task:${t.id}`, group: null, dueAt: null, weight: W.task, title: `Uppgift från ${t.fromName}`, dueText: null, note: t.text, action: { kind: "task", task: t } });
  }

  return todoRows(parts).map((r) => {
    const all = [r.main, ...r.rest];
    const title = all.find((p) => p.title)?.title ?? "Faktura";
    const action = [...all].sort((a, b) => a.weight - b.weight).find((p) => p.action)?.action ?? null;
    const first = all.filter((p) => p.dueAt).sort((a, b) => ((a.dueAt as string) < (b.dueAt as string) ? -1 : 1))[0];
    return {
      key: r.key, invoiceId: r.main.group && !r.main.group.startsWith("arende:") ? r.main.group : null, title, dueAt: r.dueAt, dueText: first?.dueText ?? null,
      notes: [...all].sort((a, b) => a.weight - b.weight).map((p) => p.note), action,
    };
  });
}
