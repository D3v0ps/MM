// Steg efter mappningen: beslutet 2026-11-04 i testdatat (påhittade uppgifter) – incitamentsmodellen med bonussteg 1–5.
// Prototypens tillstånd och generatorerna ändras inte, så slumpen och ordningen ligger kvar.
//
//   Prislistan     fem prisrader för bonusstegen (unit bonus_step, artiklarna BOT-BONUS-1 … BOT-BONUS-5, utan avtalsområde) –
//                  samma giltighet som veckopriserna. Beloppen står bara här och i prislistan, aldrig i koden.
//   Anspråk        ett litet urval (förslagen från regeln skapas av jobbet från dagen efter att testdatat lästes in,
//                  src/features/bonus/ensure.ts – testdatat har sina anspråk):
//     BOT-26-0008  (huvudcoach Amira, handläggare Maria) bonussteg 2 godkänt i december (bonusfakturan för december är manuellt
//                  fakturerad), bonussteg 3 och 5 godkända i januari (januaris bonusfaktura väntar på ekonomen – taket 12 000 kr
//                  gör att summan stannar vid taket), och bonussteg 4 som förslag att granska (hållbart resultat efter tre månader).
//     BOT-26-0027  (huvudcoach Erik, handläggare Maria) bonussteg 3 och 5 skickade till kommunen – Maria beslutar i portalen.
//     BOT-26-0043  (huvudcoach Erik, handläggare Maria) förslag till bonussteg 3 och 5 från regeln – att granska och skicka.
//     BOT-26-0064  (huvudcoach Erik, handläggare Maria) bonussteg 3 avslaget av kommunen med motivering.
//     BOT-26-0002  (huvudcoach Erik, handläggare Maria) förslag till bonussteg 1 – coachen bockar av checklistan.
//   Redovisningsunderlaget för skickade och beslutade anspråk byggs med samma funktion som när coachen skickar
//   (src/features/bonus/underlag.ts) på testdatat, med tiden då det skickades. Kommunens beslut står i bonus_claim_decisions
//   (via portal) och samma värden på anspråket (det som triggern skulle ha skrivit). Revisionsloggen har en rad per händelse – bara
//   id:n, steg och beslut.
import { bonusLineIdOf, bonusLineNote, bonusAmounts, BONUS_GROUP } from "@/core/bonus-billing";
import { invoiceIdOf } from "@/core/billing";
import { bonusBillingModel, requireOperational } from "@/core/config";
import { stepKind } from "@/core/bonus";
import { buildUnderlag } from "@/features/bonus/underlag";
import type { AuditLogEntry, BonusClaim, BonusClaimDecision, Db, PriceItem } from "../schema";

/** Bonusstegens priser i testdatat (öre exkl. moms) – samma som incitamentsmodellen. */
const BONUS_PRICES: readonly [number, number][] = [[1, 150000], [2, 300000], [3, 600000], [4, 400000], [5, 200000]];

export const SEED_BONUS_PRICE_ITEMS: readonly PriceItem[] = BONUS_PRICES.map(([step, priceOre]) => ({
  id: `pi-bonus-${step}`, contractId: "c-bot", areaCode: null, code: `BOT-BONUS-${step}`, unit: "bonus_step", packageMonths: null, priceOre, vatRate: 25,
  validFrom: "2026-09-10", validTo: "2027-09-09", fortnoxArticleNo: `BOT-BONUS-${step}`, exampleOnly: false,
}));

type Plan = {
  id: string;
  caseId: string;
  step: number;
  source: "auto" | "manual";
  eventId?: string;
  follows?: string;
  reachedOn: string | null;
  verification?: [string, string];
  checklist?: BonusClaim["checklist"];
  basis?: string;
  createdBy: string;
  createdAt: string;
  submitted?: [string, string];
  decision?: { decision: "approved" | "rejected"; by: string; at: string; note?: string };
};

const PLANS: readonly Plan[] = [
  // BOT-26-0008: praktik 12 oktober, arbete 16 oktober (start 24 september – inom tio veckor).
  {
    id: "bonus-case-260008-2-1", caseId: "case-260008", step: 2, source: "auto", eventId: "oe-14830", reachedOn: "2026-10-12", verification: ["praktikavtal", "2026-10-09"],
    basis: "Praktiken på lagret ledde direkt till en anställning.", createdBy: "system", createdAt: "2026-12-08T06:00", submitted: ["u-amira", "2026-12-10T10:15"],
    decision: { decision: "approved", by: "k-maria", at: "2026-12-15T10:20" },
  },
  {
    id: "bonus-case-260008-3-1", caseId: "case-260008", step: 3, source: "auto", eventId: "oe-14831", reachedOn: "2026-10-16", verification: ["anställningsbevis", "2026-10-14"],
    basis: "Tillsvidareanställning som lagerarbetare, heltid.", createdBy: "system", createdAt: "2026-12-08T06:00", submitted: ["u-amira", "2027-01-11T09:40"],
    decision: { decision: "approved", by: "k-maria", at: "2027-01-12T14:05" },
  },
  {
    id: "bonus-case-260008-5-1", caseId: "case-260008", step: 5, source: "auto", follows: "bonus-case-260008-3-1", reachedOn: "2026-10-16", verification: ["anställningsbevis", "2026-10-14"],
    basis: "", createdBy: "system", createdAt: "2026-12-08T06:00", submitted: ["u-amira", "2027-01-11T09:42"],
    decision: { decision: "approved", by: "k-maria", at: "2027-01-12T14:06" },
  },
  {
    id: "bonus-case-260008-4-1", caseId: "case-260008", step: 4, source: "auto", follows: "bonus-case-260008-3-1", reachedOn: "2027-01-16", createdBy: "system", createdAt: "2027-01-17T06:00",
  },
  // BOT-26-0027: arbete 18 november (start 6 oktober – inom tio veckor). Skickat, väntar på Marias beslut.
  {
    id: "bonus-case-260027-3-1", caseId: "case-260027", step: 3, source: "auto", eventId: "oe-14871", reachedOn: "2026-11-18", verification: ["anställningsbevis", "2026-11-16"],
    basis: "Visstidsanställning sex månader som lagermedarbetare.", createdBy: "system", createdAt: "2026-12-08T06:00", submitted: ["u-erik", "2027-01-28T13:40"],
  },
  {
    id: "bonus-case-260027-5-1", caseId: "case-260027", step: 5, source: "auto", follows: "bonus-case-260027-3-1", reachedOn: "2026-11-18", verification: ["anställningsbevis", "2026-11-16"],
    basis: "", createdBy: "system", createdAt: "2026-12-08T06:00", submitted: ["u-erik", "2027-01-28T13:41"],
  },
  // BOT-26-0043: arbete 19 december, dagen efter att insatsen slutade (i anslutning till insatsen). Förslag att granska.
  { id: "bonus-case-260043-3-1", caseId: "case-260043", step: 3, source: "auto", eventId: "oe-14903", reachedOn: "2026-12-19", verification: ["anställningsbevis", ""], createdBy: "system", createdAt: "2027-01-02T06:00" },
  { id: "bonus-case-260043-5-1", caseId: "case-260043", step: 5, source: "auto", follows: "bonus-case-260043-3-1", reachedOn: "2026-12-19", createdBy: "system", createdAt: "2027-01-02T06:00" },
  // BOT-26-0064: avslaget av kommunen.
  {
    id: "bonus-case-260064-3-1", caseId: "case-260064", step: 3, source: "auto", eventId: "oe-14950", reachedOn: "2026-12-11", verification: ["anställningsbevis", "2026-12-09"],
    basis: "Timanställning i butik.", createdBy: "system", createdAt: "2027-01-02T06:00", submitted: ["u-erik", "2027-01-18T11:00"],
    decision: { decision: "rejected", by: "k-maria", at: "2027-01-20T09:30", note: "Anställningen omfattar för få timmar i veckan för att räknas som arbete. Skicka ett nytt anspråk om anställningen utökas." },
  },
  // BOT-26-0002: förslag till bonussteg 1 (närvaron och två godkända bedömningar) – coachen bockar av checklistan.
  { id: "bonus-case-260002-1-1", caseId: "case-260002", step: 1, source: "auto", reachedOn: "2027-01-30", createdBy: "system", createdAt: "2027-01-30T06:00" },
];

const log = (id: string, at: string, actorId: string, action: string, claimId: string, details: Record<string, unknown>): AuditLogEntry => ({
  id, occurredAt: at, actorId, action, entity: "bonus_claim", entityId: claimId, contractId: "c-bot", details,
});

export function applyDecisions20261104(db: Db): void {
  const contract = db.contracts.find((c) => c.id === "c-bot");
  if (!contract) return;
  const cfg = requireOperational(contract.config);
  const m = bonusBillingModel(cfg);
  for (const p of SEED_BONUS_PRICE_ITEMS) db.price_items.push({ ...p });
  if (!m) return;
  const customer = db.organizations.find((o) => o.id === contract.customerId);
  for (const p of PLANS) {
    const c = db.cases.find((x) => x.id === p.caseId);
    if (!c || (p.eventId && !db.outcome_events.some((e) => e.id === p.eventId && e.caseId === c.id))) continue;
    if (p.follows && !db.bonus_claims.some((k) => k.id === p.follows)) continue;
    const verOn = p.verification?.[1] || null;
    const k: BonusClaim = {
      id: p.id, caseId: c.id, contractId: c.contractId, step: p.step, kind: stepKind(p.step), status: "suggested", source: p.source, basis: p.basis ?? "", evidencePaths: [],
      outcomeEventId: p.eventId ?? null, followsClaimId: p.follows ?? null, reachedOn: p.reachedOn, verificationKind: p.verification?.[0] ?? null, verificationOn: verOn,
      checklist: p.checklist ?? {}, snapshot: null, createdBy: p.createdBy, createdAt: p.createdAt, submittedAt: null, submittedBy: null, withdrawnBy: null, withdrawnAt: null,
      customerDecision: null, decidedBy: null, decidedAt: null, decisionNote: null, amountOre: null, invoiceDraftId: null,
    };
    db.audit_log.push(log(`log-${p.id}-skapad`, p.createdAt, p.createdBy, p.source === "auto" ? "bonus_claim.suggested" : "bonus_claim.created", k.id, { caseId: c.id, step: p.step, source: p.source }));
    if (p.submitted) {
      const [by, at] = p.submitted;
      // Underlaget som det såg ut när det skickades (samma funktion som bonus.skicka).
      const snapshot = buildUnderlag({ db, cfg, model: m, claim: k, case: c, contract, customerName: customer?.name ?? "", now: at, sentBy: by });
      Object.assign(k, { status: "submitted", snapshot: snapshot as unknown as Record<string, unknown>, submittedAt: at, submittedBy: by });
      db.audit_log.push(log(`log-${p.id}-skickad`, at, by, "bonus_claim.submitted", k.id, { caseId: c.id, step: p.step }));
    }
    if (p.decision) {
      const d: BonusClaimDecision = {
        id: `bonusbeslut-${p.id}`, claimId: k.id, caseId: c.id, contractId: c.contractId, decision: p.decision.decision, note: p.decision.note ?? null, via: "portal",
        decidedBy: p.decision.by, recordedBy: p.decision.by, decidedAt: p.decision.at,
      };
      db.bonus_claim_decisions.push(d);
      Object.assign(k, { status: d.decision, customerDecision: d.decision, decidedBy: d.decidedBy, decidedAt: d.decidedAt, decisionNote: d.note });
      db.audit_log.push(log(`log-${p.id}-beslut`, d.decidedAt, d.decidedBy as string, "bonus_claim.decided", k.id, { caseId: c.id, step: p.step, decision: d.decision, via: "portal", decisionId: d.id }));
    }
    db.bonus_claims.push(k);
  }
  // Bonusfakturan för december: manuellt fakturerad med den frysta raden (samma referens som månadens periodiska faktura).
  const dec = "2026-12";
  const decided = db.bonus_claims.filter((k) => k.status === "approved" && k.decidedAt?.startsWith(dec));
  if (decided.length) {
    const amounts = bonusAmounts(db, contract.id, m);
    const id = invoiceIdOf(contract.id, dec, BONUS_GROUP);
    const ref = db.invoice_drafts.find((d) => d.kind === "periodic" && d.month === dec && d.buyerReference)?.buyerReference ?? "55102938";
    db.invoice_drafts.push({
      id, billingRunId: db.billing_runs.find((r) => r.contractId === contract.id && r.month === dec)?.id ?? null, contractId: contract.id, month: dec, kind: "bonus", caseId: null,
      groupingKey: BONUS_GROUP, buyerReference: ref, purchaseOrderNumber: "", invoicedObject: contract.contractNumber, accruedOre: null, remainingOre: null, status: "manual",
      approvedBy: "u-lars", approvedAt: "2027-01-05T09:30", manualInvoiceNo: "20261299", fortnoxDocumentNumber: null, fortnoxIdempotencyKey: null,
      fortnoxCreatedAt: null, syncedAt: null,
    });
    for (const k of decided) {
      const c = db.cases.find((x) => x.id === k.caseId);
      const a = amounts.get(k.id);
      if (!c || !a?.item) continue;
      db.invoice_lines.push({
        id: bonusLineIdOf(id, c.id, k.step as number), invoiceDraftId: id, caseId: c.id, priceItemId: a.item.id, quantity: 1, unitPriceOre: a.amountOre, vatRate: a.item.vatRate,
        description: `${c.caseNumber} · Bonussteg ${k.step}`, isoWeeks: [], zeroAttendanceWeeks: [], note: bonusLineNote(k, m, a.reduced), bonusClaimId: k.id,
      });
    }
    db.audit_log.push({
      id: "log-bonusfaktura-2026-12", occurredAt: "2027-01-05T09:35", actorId: "u-lars", action: "billing.manual", entity: "invoice", entityId: id, contractId: contract.id,
      details: { month: dec, invoiceNo: "20261299" },
    });
  }
}
