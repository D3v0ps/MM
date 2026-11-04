// Bonusfakturan (SPEC §7.17, beslut 2026-11-04): en faktura per avtal och månad (eller per ärende och månad med
// billing.invoicePer "case_and_month") för de bonusanspråk som kommunen godkände under månaden (Stockholmstid), skild från de
// periodiska fakturorna (kind "bonus", grupp "bonus", tilläggsfakturor "bonus-tillagg-2" …). En rad per godkänt anspråk:
// "BOT-26-0042 · Bonussteg 3", artikeln och priset ur prislistan för bonussteget (price_items med koden i
// contracts.config.bonus.steps, unit bonus_step) som gällde den dag kommunen beslutade – aldrig ett hårdkodat belopp.
// Taket per deltagare (bonus.capOre) räknas på alla godkända anspråk i ärendet i beslutsordning (capAmounts i ./bonus.ts): ett
// anspråk som sänks till 0 kr får ingen rad men visas för ekonomen som "Taket är nått". Ett anspråk som redan står på en skapad
// faktura räknas med det fakturerade beloppet (inte dagens prislista). Ett anspråk utan riktigt pris (saknas, exempelpris eller
// 0 kr) är en prisrad som stoppar fakturan – och de senare anspråken i ärendet stoppas också (taket kan inte räknas).
// Samma kedja som de periodiska fakturorna (./billing.ts buildMonthInvoice): beställarreferens och inköpsordernummer per faktura
// kontrolleras, priserna stoppar fakturan, raderna fryses när fakturan skapas (invoice_lines.bonus_claim_id) och anspråk som
// godkänns efteråt hamnar på en tilläggsfaktura. Bonus står aldrig på en periodisk faktura (triggern invoice_lines_bonus_check,
// 0039) och aldrig i resultatfilen, KPI:erna eller rapporterna. Beloppen lämnas bara ut till ekonomen (hidesMoney).
import type { BonusClaim, Case, Db, InvoiceDraft, PriceItem } from "@/data/schema";
import {
  buildMonthInvoice, compareGroup, CREATED_STATUSES, groupingKeyOf, isCreated, isCredited, parseGroupingKey, priceLineCheck, priceProblemOf, type BillingCheck, type InvoiceLineView,
  type MonthInvoice,
} from "./billing";
import { capAmounts, type CappedAmount } from "./bonus";
import { bonusBillingModel, type BonusBillingModel, type OperationalConfig } from "./config";
import type { DomainEnv } from "./env";
import { kr } from "./format";
import { dayOf, fmtDate, monthKey, type MonthKey } from "./time";

/** Bonusfakturans grupp för hela avtalet (invoicePer "contract_and_month"). */
export const BONUS_GROUP = "bonus";
/** Gruppen för ärendets bonusrad: hela avtalet, eller ärendet (invoicePer "case_and_month"). */
export const bonusBaseOf = (cfg: Pick<OperationalConfig, "billing">, caseId: string): string => (cfg.billing.invoicePer === "case_and_month" ? `${BONUS_GROUP}-${caseId}` : BONUS_GROUP);
/** Radens id på bonusfakturan: en rad per anspråk (`<faktura>:<ärende>:steg<n>`). */
export const bonusLineIdOf = (invoiceId: string, caseId: string, step: number): string => `${invoiceId}:${caseId}:steg${step}`;
/** Månaden som ett godkänt anspråk faktureras i: månaden då kommunen beslutade (Stockholmstid). */
export const bonusMonthOf = (k: Pick<BonusClaim, "decidedAt">): MonthKey | null => (k.decidedAt ? monthKey(k.decidedAt) : null);

/** Prisraden för bonussteget den dagen (koden ur konfigurationen, unit bonus_step), eller null. */
export function bonusPriceItem(items: readonly PriceItem[], m: Pick<BonusBillingModel, "steps">, step: number, day: string, contractId: string): PriceItem | null {
  const code = m.steps.find((s) => s.step === step)?.priceItemCode;
  if (!code) return null;
  return items.find((p) => p.unit === "bonus_step" && p.code === code && p.contractId === contractId && p.validFrom <= day && (!p.validTo || p.validTo >= day)) ?? null;
}

export type BonusBillingDb = Pick<Db, "cases" | "price_items" | "buyer_references" | "invoice_drafts" | "invoice_lines" | "bonus_claims">;

/** Godkända anspråk med bonussteg och beslut – de som faktureras. */
const approvedClaims = (db: Pick<Db, "bonus_claims">, contractId: string): BonusClaim[] =>
  db.bonus_claims.filter((k) => k.contractId === contractId && k.status === "approved" && k.step != null && !!k.decidedAt);

/**
 * Beloppen för ärendenas godkända anspråk med taket (alla månader – taket gäller hela ärendet). Nyckel: anspråkets id. Ett
 * anspråk på en skapad faktura räknas med det fakturerade beloppet. Ett anspråk utan riktigt pris räknas aldrig som 0 kr: det
 * stoppar sin egen faktura och de senare anspråken i ärendet (blocked).
 */
export function bonusAmounts(
  db: Pick<Db, "bonus_claims" | "price_items" | "invoice_drafts" | "invoice_lines">, contractId: string, m: BonusBillingModel,
): Map<string, CappedAmount & { item: PriceItem | null }> {
  const claims = approvedClaims(db, contractId);
  const items = new Map(claims.map((k) => [k.id, bonusPriceItem(db.price_items, m, k.step as number, dayOf(k.decidedAt as string), contractId)]));
  // Fakturerat: raderna på skapade bonusfakturor som inte är krediterade.
  const created = new Set(db.invoice_drafts.filter((d) => d.kind === "bonus" && d.contractId === contractId && isCreated(d.status)).map((d) => d.id));
  const frozen = new Map<string, number>();
  for (const l of db.invoice_lines) if (l.bonusClaimId && created.has(l.invoiceDraftId)) frozen.set(l.bonusClaimId, Math.round(l.quantity * l.unitPriceOre));
  const capped = capAmounts(
    claims.map((k) => {
      const item = items.get(k.id) ?? null;
      return { id: k.id, caseId: k.caseId, decidedAt: k.decidedAt as string, priceOre: priceProblemOf(item) ? null : (item as PriceItem).priceOre, frozenOre: frozen.get(k.id) ?? null };
    }),
    m.capOre,
  );
  return new Map([...capped].map(([id, a]) => [id, { ...a, item: items.get(id) ?? null }]));
}

const capCheck = (a: CappedAmount, capOre: number): BillingCheck => ({
  kind: "bonus_cap", severity: "info", label: "Taket per deltagare",
  text: `Beloppet är sänkt från ${kr(a.priceOre)} till ${kr(a.amountOre)}: bonusstegen läggs ihop utan avräkning upp till taket ${kr(capOre)} per deltagare.`,
});

/**
 * Radens anmärkning på bonusfakturan (Peppol BT-127): bonussteget enligt incitamentsmodellen och dagen kommunen godkände – och
 * om taket sänkte beloppet. Inga namn.
 */
export function bonusLineNote(k: Pick<BonusClaim, "step" | "decidedAt">, m: Pick<BonusBillingModel, "steps" | "capOre">, reduced: boolean): string {
  const step = k.step ?? 0;
  const label = m.steps.find((s) => s.step === step)?.label;
  const cap = reduced ? ` Bonusstegen läggs ihop upp till taket ${kr(m.capOre)} per deltagare – beloppet är sänkt till taket.` : "";
  return `Bonussteg ${step}${label ? ` (${label})` : ""} enligt incitamentsmodellen, godkänt av kommunen ${k.decidedAt ? fmtDate(k.decidedAt) : "–"}.${cap}`;
}

/** Bonusradens vy (live – inte fryst än). */
function bonusLine(c: Case, k: BonusClaim, a: CappedAmount & { item: PriceItem | null }, month: MonthKey, m: BonusBillingModel): InvoiceLineView {
  const step = k.step as number;
  const capOre = m.capOre;
  const problem = priceProblemOf(a.item) ?? (a.blocked ? "earlier" : null);
  const checks: BillingCheck[] = [...(problem ? [priceLineCheck(problem)] : []), ...(a.reduced && a.amountOre > 0 ? [capCheck(a, capOre)] : [])];
  return {
    month, contractId: c.contractId, caseId: c.id, caseNumber: c.caseNumber, areaCode: null, weeks: [], quantity: 1, unitPriceOre: a.amountOre, amountOre: a.amountOre,
    vatRate: a.item?.vatRate ?? 25, articleNo: a.item?.fortnoxArticleNo ?? a.item?.code ?? "", priceItemId: a.item?.id ?? "",
    priceProblem: problem, caseBuyerReference: c.buyerReference,
    casePurchaseOrderNumber: c.purchaseOrderNumber || "", orderWeeks: 0, accruedWeeks: 0, remainingWeeks: 0, checks, needsApproval: false,
    lineText: `${c.caseNumber} · Bonussteg ${step}`, bonusClaimId: k.id, bonusStep: step, frozen: false, lineId: null, note: bonusLineNote(k, m, a.reduced),
  };
}

/**
 * Månadens bonusfakturor för avtalet: skapade fakturor med sina frysta rader, och de godkända anspråk i månaden som inte står på
 * någon skapad faktura på den öppna fakturan i sin grupp (huvudfakturan, eller en tilläggsfaktura om den redan är skapad).
 * Tom lista när bonus inte är påslagen i avtalet.
 */
export function bonusMonthInvoices(db: BonusBillingDb, contractId: string, month: MonthKey, env: Pick<DomainEnv, "cfg">): MonthInvoice[] {
  const m = bonusBillingModel(env.cfg);
  if (!m) return [];
  const caseOf = new Map(db.cases.map((c) => [c.id, c]));
  const amounts = bonusAmounts(db, contractId, m);
  const claims = approvedClaims(db, contractId).filter((k) => bonusMonthOf(k) === month);
  const drafts = db.invoice_drafts
    .filter((d) => d.kind === "bonus" && d.contractId === contractId && d.month === month && !isCredited(d.status))
    .sort((a, b) => compareGroup(a.groupingKey, b.groupingKey));
  const created = drafts.filter((d) => isCreated(d.status));
  const covered = new Set<string>();
  const invoices: MonthInvoice[] = [];
  const at = { contractId, month, kind: "bonus" as const };

  // Skapade fakturor: de frysta raderna (beloppet som fakturerades).
  for (const d of created) {
    const lines: InvoiceLineView[] = [];
    for (const r of db.invoice_lines.filter((l) => l.invoiceDraftId === d.id && l.bonusClaimId)) {
      const k = db.bonus_claims.find((x) => x.id === r.bonusClaimId);
      const c = caseOf.get(r.caseId);
      covered.add(r.bonusClaimId as string);
      lines.push({
        month, contractId, caseId: r.caseId, caseNumber: c?.caseNumber ?? r.description.split(" · ")[0], areaCode: null, weeks: [], quantity: r.quantity, unitPriceOre: r.unitPriceOre,
        amountOre: Math.round(r.quantity * r.unitPriceOre), vatRate: r.vatRate, articleNo: db.price_items.find((p) => p.id === r.priceItemId)?.fortnoxArticleNo ?? "", priceItemId: r.priceItemId,
        priceProblem: null, caseBuyerReference: c?.buyerReference ?? null, casePurchaseOrderNumber: c?.purchaseOrderNumber || "", orderWeeks: 0, accruedWeeks: 0, remainingWeeks: 0,
        checks: [], needsApproval: false, lineText: r.description, bonusClaimId: r.bonusClaimId as string, bonusStep: k?.step ?? undefined, frozen: true, lineId: r.id, note: r.note,
      });
    }
    invoices.push(buildMonthInvoice(db, env, at, d, d.groupingKey, lines));
  }
  // Det som återstår: en rad per anspråk med belopp; anspråk som taket sänkt till 0 kr visas utan rad.
  const open = new Map<string, { lines: InvoiceLineView[]; capped: MonthInvoice["capped"] }>();
  for (const k of claims) {
    const c = caseOf.get(k.caseId);
    const a = amounts.get(k.id);
    if (!c || !a || covered.has(k.id)) continue;
    const base = bonusBaseOf(env.cfg, c.id);
    const g = open.get(base) ?? { lines: [], capped: [] };
    // En rad med belopp, eller en prisrad som stoppar fakturan (pris saknas, exempelpris, 0 kr, ett tidigare steg utan pris).
    // Bara ett anspråk som taket sänkt till 0 kr står utan rad ("Taket är nått").
    if (a.amountOre > 0 || priceProblemOf(a.item) || a.blocked) g.lines.push(bonusLine(c, k, a, month, m));
    else g.capped.push({ claimId: k.id, caseId: c.id, caseNumber: c.caseNumber, step: k.step as number, priceOre: a.priceOre });
    open.set(base, g);
  }
  for (const [base, g] of open) {
    const same = drafts.filter((d) => parseGroupingKey(d.groupingKey).base === base);
    const waiting = same.find((d) => !CREATED_STATUSES.includes(d.status)) ?? null;
    const n = waiting ? parseGroupingKey(waiting.groupingKey).n : Math.max(0, ...same.map((d) => parseGroupingKey(d.groupingKey).n)) + 1;
    const inv = buildMonthInvoice(db, env, at, waiting, waiting?.groupingKey ?? groupingKeyOf(base, n), g.lines);
    invoices.push({ ...inv, capped: g.capped.sort((a, b) => (a.caseNumber < b.caseNumber ? -1 : a.caseNumber > b.caseNumber ? 1 : a.step - b.step)) });
  }
  // En sparad bonusfaktura som väntar men inte har några rader (t.ex. referensen ifylld innan anspråket godkändes) visas också.
  for (const d of drafts) if (!invoices.some((x) => x.id === d.id)) invoices.push(buildMonthInvoice(db, env, at, d, d.groupingKey, []));
  return invoices.sort((a, b) => compareGroup(a.groupingKey, b.groupingKey));
}

/** Bonusfakturans rubrik: "Bonusfaktura november 2026" eller "Tilläggsfaktura 2 · bonus november 2026". */
export function bonusInvoiceTitle(inv: Pick<MonthInvoice, "number" | "month">, monthLabel: (m: MonthKey) => string, caseNumber: string | null = null): string {
  const mk = monthLabel(inv.month).toLowerCase();
  const who = caseNumber ? ` · ${caseNumber}` : "";
  return inv.number > 1 ? `Tilläggsfaktura ${inv.number} · bonus ${mk}${who}` : `Bonusfaktura ${mk}${who}`;
}

/** En ny bonusfakturas rad i invoice_drafts (kind bonus). */
export const isBonusDraft = (d: Pick<InvoiceDraft, "kind">): boolean => d.kind === "bonus";
