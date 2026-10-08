// Steg efter mappningen: besluten från genomgången 2026-10-07 (synpunkterna 6 oktober) i testdatat. Prototypens tillstånd
// (createProtoState) och generatorerna ändras inte – raderna justeras här, efter toTables() och de andra stegen, så att
// slumpen och ordningen i den gamla prototypen ligger kvar. Bara påhittade uppgifter.
//
//   Kommunens chef bort (beslut 1)   k-eva (Eva Bergström) och hennes medlemskap tas bort. Beställarrapporterna har ingen
//                                    mottagare: en per avtal och månad, lämnade utanför portalen (deliveredTo tom).
//   Skyddade personuppgifter bort    personen i ärendet "skyddad" blir en vanlig person (ort, telefon, kontaktväg telefon),
//   (beslut 2, spärren vilande)      samtycket "Inte tillfrågad". Mejlet em-104 blir en vanlig fråga (Övrigt) utan generisk
//                                    bekräftelse, och uppgiften till avtalsansvarig (task-2) finns inte.
//   Beställningsformuläret (#3–#9)   de öppna avropen får omfattning i månader (Maria 6, Linda 12). Ahmeds mejl (em-102)
//                                    saknar omfattningen (inga planerade veckor) – kompletteringen (em-103) anger 6 månader och
//                                    beställarreferensen.
//                                    Kartläggning genomförd: Maria ja, Linda vet inte, Ahmed framgår inte.
//   Fakturan (beslut 3, #13)         en faktura per avtal och månad med en rad per ärende. Prototypens status per månad och
//                                    ärende (S.invoiceStatus) blir fakturor med frysta rader: september–november en betald
//                                    faktura per månad, december en skickad faktura och en tilläggsfaktura för Ahmeds två
//                                    ärenden (deras startdatum registrerades efter att decemberfakturan skapats) med referensen
//                                    ur hans beställningar, 55102983 – den returnerades. Januari är öppen (räknas fram) och
//                                    saknar beställarreferens tills ekonomen fyller i den. Samma veckor och belopp som förut.
import { billingLines, CONTRACT_GROUP, fortnoxKeyOf, fortnoxNumber, groupingKeyOf, invoiceIdOf, isCreated } from "@/core/billing";
import { requireOperational } from "@/core/config";
import type { Db, InvoiceStatus } from "../schema";
import { NOW } from "./constants";

const KOMMUNENS_CHEF = "k-eva";
/** Beställarreferensen som Botkyrka har bekräftat för månadsfakturan (Arbetsmarknadsenheten Tumba i testdatat). */
const MONTHLY_REFERENCE = "55102938";

/** Prototypens fakturastatus per månad: standard för månaden och avvikande status per ärende. */
export type ProtoInvoiceStatus = Record<string, Record<string, InvoiceStatus>>;

export function applyDecisions20261007(db: Db, proto: { invoiceStatus: ProtoInvoiceStatus } = { invoiceStatus: {} }): void {
  // ---- Kommunens chef bort
  db.profiles = db.profiles.filter((p) => p.id !== KOMMUNENS_CHEF);
  db.memberships = db.memberships.filter((m) => m.userId !== KOMMUNENS_CHEF);
  db.notification_reads = db.notification_reads.filter((n) => n.userId !== KOMMUNENS_CHEF);
  for (const r of db.reports) {
    if (r.kind !== "customer_summary") continue;
    r.recipientUserId = null;
    r.deliveredTo = [];
    r.openedAt = null;
    r.openedBy = null;
  }

  // ---- Skyddade personuppgifter bort ur testdatat (spärren finns kvar vilande i behörigheten)
  for (const p of db.persons) {
    if (!p.protectedIdentity) continue;
    p.protectedIdentity = false;
    p.city = p.city || "Tumba";
    p.phone = p.phone || "070-555 01 47";
    p.preferredContact = "phone";
  }
  for (const c of db.cases) if (c.aiConsentStatus === "not_applicable") c.aiConsentStatus = "not_asked";

  const em104 = db.inbound_emails.find((m) => m.id === "em-104");
  if (em104) {
    const omar = db.profiles.find((p) => p.email === em104.fromAddress);
    Object.assign(em104, {
      subject: "Fråga om startdatum", classification: "other", status: "other", parseMethod: "ai", ackSentAt: null, ackKind: null,
      bodyText: `Hej,\nNär kan ni ta emot nästa deltagare från vår enhet? Ring mig gärna${omar?.phone ? ` på ${omar.phone}` : ""}.\n\n/Omar Farah`,
    });
    db.outbound_messages = db.outbound_messages.filter((n) => !(n.template === "generisk_mottagningsbekraftelse" && n.to === em104.fromAddress));
    db.audit_log = db.audit_log.filter((a) => !(a.entityId === "em-104" && a.action === "notify.email"));
    for (const a of db.audit_log) if (a.entityId === "em-104" && a.action === "email.received") a.details = { classification: "övrigt" };
  }
  db.tasks = db.tasks.filter((t) => t.id !== "task-2");

  // ---- Beställningsformuläret: omfattning och kartläggning för de öppna avropen
  const caseOfEmail = (id: string) => {
    const m = db.inbound_emails.find((x) => x.id === id);
    return { m, c: m?.caseId ? db.cases.find((x) => x.id === m.caseId) : undefined };
  };
  const maria = caseOfEmail("em-101");
  if (maria.c && maria.m) {
    Object.assign(maria.c, { orderPeriodMonths: 6, priorAssessment: "yes" });
    maria.m.extracted = { ...maria.m.extracted, orderPeriod: "6", priorAssessment: "ja" };
    maria.m.confidence = { ...maria.m.confidence, orderPeriod: 1, priorAssessment: 1 };
  }
  const linda = caseOfEmail("em-106");
  if (linda.c && linda.m) {
    Object.assign(linda.c, { orderPeriodMonths: 12, priorAssessment: "unknown" });
    linda.m.extracted = { ...linda.m.extracted, orderPeriod: "12", priorAssessment: "vet_inte" };
    linda.m.confidence = { ...linda.m.confidence, orderPeriod: 1, priorAssessment: 1 };
  }
  const ahmed = caseOfEmail("em-102");
  if (ahmed.c && ahmed.m) {
    ahmed.m.extracted = { ...ahmed.m.extracted, orderPeriod: "", priorAssessment: "" };
    ahmed.m.confidence = { ...ahmed.m.confidence, orderPeriod: 0, priorAssessment: 0 };
    ahmed.m.missingFields = ["orderPeriod"];
    // Omfattningen saknas i beställningen: inga planerade veckor eller slutdatum förrän den är känd (prototypens sex veckor bort).
    Object.assign(ahmed.c, { plannedWeeks: null, plannedEnd: null, orderValueWeeks: null });
    const sup = db.inbound_emails.find((x) => x.id === "em-103");
    if (sup) {
      Object.assign(sup, {
        bodyText: "Hej,\nOmfattning: 6 månader.\nBeställarreferens: 55102938\n\n/Ahmed",
        extracted: { orderPeriod: "6", buyerReference: "55102938" }, confidence: { orderPeriod: 0.95, buyerReference: 0.98 },
      });
    }
    for (const a of db.audit_log) if (a.entityId === ahmed.c.id && a.action === "case.created") a.details = { ...a.details, missing: ["omfattning"] };
    for (const n of db.outbound_messages) {
      if (n.caseId === ahmed.c.id && n.template === "ordererkannande") {
        n.body = n.body.replace("• Beställarreferens (8–10 siffror)\n• Planerat slutdatum", "• Omfattning (6 eller 12 månader, eller annan tidsperiod med motivering)");
      }
    }
  }

  // ---- Fakturan: en faktura per avtal och månad (beslut 3)
  invoicesPerMonth(db, proto.invoiceStatus);
}

/**
 * Prototypens fakturor per ärende → en faktura per avtal och månad med frysta rader (invoice_lines). Ärenden med samma status
 * som månaden står på månadens faktura; ärenden med en annan status (december: Ahmeds två returnerade) på en tilläggsfaktura
 * per status. Raderna räknas med samma funktion som appen (billingLines) – veckor och belopp blir desamma som förut.
 * En månad där allt är underlag (januari) får ingen rad: fakturan räknas fram tills ekonomen gör något med den.
 */
function invoicesPerMonth(db: Db, invoiceStatus: ProtoInvoiceStatus): void {
  const contract = db.contracts.find((c) => c.id === "c-bot");
  if (!contract) return;
  const env = { now: NOW, cfg: requireOperational(contract.config) };
  for (const run of db.billing_runs.slice().sort((a, b) => (a.month < b.month ? -1 : 1))) {
    const st = invoiceStatus[run.month] ?? {};
    const monthStatus: InvoiceStatus = st.default ?? "draft";
    const other = new Map<InvoiceStatus, Set<string>>();
    for (const [caseId, s] of Object.entries(st)) {
      if (caseId === "default" || s === monthStatus) continue;
      other.set(s, (other.get(s) ?? new Set()).add(caseId));
    }
    const groups = [
      { n: 1, status: monthStatus, has: (id: string) => ![...other.values()].some((ids) => ids.has(id)) },
      ...[...other.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([status, ids], i) => ({ n: i + 2, status, has: (id: string) => ids.has(id) })),
    ];
    const lines = billingLines(db, run.month, env).filter((l) => l.contractId === contract.id);
    for (const g of groups) {
      if (!isCreated(g.status)) continue;
      const rows = lines.filter((l) => g.has(l.caseId));
      if (!rows.length) continue;
      const key = groupingKeyOf(CONTRACT_GROUP, g.n);
      const id = invoiceIdOf(contract.id, run.month, key);
      // Tilläggsfakturan fick referensen ur ärendenas beställning (Ahmeds omkastade siffror), månadsfakturan Botkyrkas referens.
      const caseRefs = [...new Set(rows.map((l) => l.caseBuyerReference).filter((x): x is string => !!x))];
      const ref = g.n === 1 || caseRefs.length !== 1 ? MONTHLY_REFERENCE : caseRefs[0];
      db.invoice_drafts.push({
        id, billingRunId: run.id, contractId: contract.id, month: run.month, kind: "periodic", caseId: null, groupingKey: key, buyerReference: ref,
        purchaseOrderNumber: null, invoicedObject: contract.contractNumber, accruedOre: null, remainingOre: null, status: g.status, approvedBy: "u-lars",
        approvedAt: run.createdAt, manualInvoiceNo: null, fortnoxDocumentNumber: fortnoxNumber(null, run.month, key),
        fortnoxIdempotencyKey: fortnoxKeyOf(contract.id, run.month, key), fortnoxCreatedAt: run.createdAt, syncedAt: null,
      });
      for (const l of rows) {
        db.invoice_lines.push({
          id: `${id}:${l.caseId}`, invoiceDraftId: id, caseId: l.caseId, priceItemId: l.priceItemId, quantity: l.quantity, unitPriceOre: l.unitPriceOre,
          vatRate: l.vatRate, description: l.lineText, isoWeeks: l.weeks.map((w) => w.key), zeroAttendanceWeeks: l.weeks.filter((w) => w.zeroAttendance).map((w) => w.key),
          // Testdatats historiska rader har ingen sparad anmärkning – förhandsvisningen räknar fram den.
          note: "",
        });
      }
    }
  }
  // Referensregistret, uppgiften till ekonomen: tilläggsfakturan för december returnerades.
  const wrong = db.buyer_references.find((b) => b.reference === "55102983");
  if (wrong) wrong.note = "Finns inte hos kommunen. Tilläggsfakturan för december returnerades 2027-01-12.";
  const task = db.tasks.find((t) => t.id === "task-1");
  if (task) {
    const nums = task.caseIds.map((id) => db.cases.find((c) => c.id === id)?.caseNumber).filter(Boolean).join(" och ");
    task.text = `Kommunen har bekräftat rätt beställarreferens ${MONTHLY_REFERENCE} för ${nums}. Tilläggsfakturan för december ska krediteras och göras om med rätt referens, och januarifakturan får samma referens.`;
  }
}
