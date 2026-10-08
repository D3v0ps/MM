"use client";
// Förhandsvisning av en faktura (prototypens eko.faktura): Peppol-fält, så tar kommunen emot fakturan, fakturan som papper med
// en rad per ärende, radernas anmärkning (upparbetat och återstående) och fältmappningen Fortnox → Peppol. Fakturan innehåller
// inga namn eller personnummer. Beslut 2026-10-07 (synpunkt #13): en faktura per avtal och månad med en rad per ärende.
// Adressen: /ekonomi/:month/faktura (månadens faktura), ?faktura=<id> (en viss faktura, t.ex. en tilläggsfaktura) eller
// /ekonomi/:month/faktura/:caseId (fakturan som har ärendets rad – raden markeras).
import { useState } from "react";
import { useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { fmtDate, monthName } from "@/core/time";
import { krExact } from "@/core/format";
import { Badge, Button, Card, cn, DemoNote, Empty, ErrorNotice, Icon, Kv, Loading, Notice, Page, Paper, PaperFixedText, Stepper, Table } from "@/ui";
import { ekoPreview, type InvoicePreviewView } from "../api";
import { IN_FORTNOX, monthLabel, plural } from "../model";
import { CHECK, InvStatus, WRAP } from "./parts";

const MONTH_RE = /^\d{4}-\d{2}$/;
const STEPS = ["draft", "approved", "fortnox_created", "booked", "sent", "paid"];
const STEP_LABEL = ["Underlag", "Godkänd", "Skapad i Fortnox", "Bokförd", "Skickad (Peppol)", "Betald"];

export function FakturaScreen({ params, query }: ScreenProps) {
  const month = MONTH_RE.test(params.month ?? "") ? params.month : undefined;
  const invoiceId = query.get("faktura") || undefined;
  const q = useQuery(ekoPreview, { month, invoiceId, caseId: params.caseId || undefined });
  const crumbsFor = (v?: InvoicePreviewView) =>
    [
      { label: "Fakturering", to: "/ekonomi" },
      month ? { label: monthLabel(month), to: `/ekonomi/${month}` } : null,
      { label: v?.preview?.inv.title ?? "Faktura" },
    ].filter((x): x is { label: string; to?: string } => !!x);
  if (q.error) return <Page className={WRAP} title="Faktura" crumbs={crumbsFor()}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page className={WRAP} title="Faktura" crumbs={crumbsFor()}><Loading /></Page>;
  const v = q.data;
  if (!v.preview) {
    return (
      <Page className={WRAP} title="Faktura" crumbs={crumbsFor(v)}>
        <Empty
          icon="file"
          title="Ingen faktura att visa"
          action={
            <Button kind="primary" to={month ? `/ekonomi/${month}` : "/ekonomi"}>
              Till fakturakörningen
            </Button>
          }
        >
          {v.caseNumber && month ? `${v.caseNumber} har inga debiterbara veckor i ${monthName(month)}.` : "Välj en faktura i fakturakörningen."}
        </Empty>
      </Page>
    );
  }
  return <Faktura v={v as InvoicePreviewView & { month: string }} crumbs={crumbsFor(v)} />;
}

function Faktura({ v, crumbs }: { v: InvoicePreviewView & { month: string }; crumbs: { label: string; to?: string }[] }) {
  const nav = useNav();
  const p = v.preview!;
  const { inv } = p;
  const mk = v.month;
  const [allNotes, setAllNotes] = useState(false);
  const stepIdx = STEPS.indexOf(inv.status);
  const [pStart, pEnd] = p.period;
  const marked = v.caseId ? inv.lines.find((l) => l.caseId === v.caseId) ?? null : null;
  const first = marked ?? inv.lines[0];
  const remarks = inv.lines.filter((l) => !l.frozen && l.checks.some((c) => c.severity === "needs_approval" || c.severity === "warning")).length;
  const mapping = [
    { id: "m1", f: "Er referens", p: "BuyerReference (BT-10)", v: inv.buyerReference || "–", note: `Kommunens beställarreferens, ${p.refLen} siffror, en per faktura. Krävs – utan den kan fakturan inte skapas.` },
    { id: "m2", f: "Ert ordernummer", p: "OrderReference (BT-13)", v: inv.purchaseOrderNumber || "Tomt", note: `Bara kommunens inköpsordernummer (${p.poText}). Aldrig ärendenumret eller andra egna nummer.` },
    { id: "m3", f: "Artikel och benämning", p: "Item (BT-153, BT-155)", v: first ? `${first.articleNo} · ${first.areaTitle}` : "–", note: "En artikel per avtalsområde, pris per deltagarvecka." },
    { id: "m4", f: "Radtext", p: "InvoiceLine Name (BT-153)", v: first?.lineText ?? "–", note: "Ärendenummer och veckor på varje rad. Inga namn." },
    { id: "m5", f: "Radens anmärkning", p: "InvoiceLine Note (BT-127)", v: "Upparbetat och återstående", note: "Per rad: beställningen i veckor, denna rad, tidigare fakturerat, faktureras om, upparbetat och återstående." },
    { id: "m6", f: "Fakturatext", p: "Note (BT-22)", v: p.invoiceText, note: "Avtalet, månaden och antal ärenden och veckor." },
    { id: "m7", f: "Faktureringsobjekt", p: "InvoiceLine ObjectIdentifier (BT-128)", v: first?.caseNumber ?? "–", note: "Ärendenumret på varje rad. Hur fältet fylls från Fortnox ska bekräftas." },
    { id: "m8", f: "Betalningsvillkor", p: "PaymentTerms (BT-20)", v: `${p.paymentTermsDays} dagar`, note: "Enligt avtalet." },
    { id: "m9", f: "Bankgiro", p: "PaymentMeans (BG-16)", v: "Hämtas från Fortnox", note: "Anges inte i Miljonmatch." },
  ];
  return (
    <Page className={WRAP}
      title={inv.title}
      eyebrow={`Förhandsvisning · Peppol BIS Billing 3 via Fortnox · ${monthName(mk)}`}
      crumbs={crumbs}
      lead={`Så här blir fakturan när den skapas i Fortnox och skickas till ${p.customer.name}: en rad per ärende. Fakturan innehåller inga namn eller personnummer.`}
      actions={
        <>
          <Button kind="secondary" icon="arrow-left" onClick={() => nav.push(`/ekonomi/${mk}${v.caseId ? `?arende=${encodeURIComponent(v.caseId)}` : ""}`)}>
            Tillbaka till körningen
          </Button>
          {v.caseId && (
            <Button kind="ghost" icon="briefcase" onClick={() => nav.push(`/ekonomi/arende/${encodeURIComponent(v.caseId!)}`)}>
              Öppna ärendet
            </Button>
          )}
        </>
      }
    >
      {v.invoices.length > 1 && (
        <nav aria-label="Månadens fakturor" className="flex flex-wrap items-center gap-1.5">
          <span className="text-small font-bold">Månadens fakturor:</span>
          {v.invoices.map((x) => (
            <Button
              key={x.id}
              kind={x.id === inv.id ? "primary" : "secondary"}
              ariaPressed={x.id === inv.id}
              onClick={() => nav.replace(`/ekonomi/${mk}/faktura?faktura=${encodeURIComponent(x.id)}`)}
            >
              {x.title}
            </Button>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <InvStatus status={inv.status} />
          {inv.fortnoxNo && (
            <span className="text-small">
              Fakturanummer i Fortnox: <b className="tabular-nums">{inv.fortnoxNo}</b>
            </span>
          )}
          {inv.manualInvoiceNo && (
            <span className="text-small">
              Manuellt fakturanummer: <b className="tabular-nums">{inv.manualInvoiceNo}</b>
            </span>
          )}
          <span className="ml-2 text-small font-bold">Kontroller:</span>
          {inv.checks.length === 0 && remarks === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-small">
              <Icon name="check-circle" />
              Inga anmärkningar
            </span>
          ) : (
            <>
              {inv.checks.map((ch, i) => (
                <Badge key={`${ch.kind}-${i}`} tone={CHECK[ch.severity].tone} icon={CHECK[ch.severity].icon} className={CHECK[ch.severity].className} title={ch.text}>
                  {ch.label}
                </Badge>
              ))}
              {remarks > 0 && <Badge tone="outline" icon="alert-circle">{plural(remarks, "rad med anmärkning", "rader med anmärkning")}</Badge>}
            </>
          )}
        </div>
        {stepIdx >= 0 && <Stepper steps={STEP_LABEL} current={inv.status === "paid" ? STEPS.length : stepIdx} />}
      </div>
      {inv.blocked && (
        <Notice tone="critical" title="Fakturan kan inte skapas">
          {inv.checks.map((c) => c.text).join(" ")} Fyll i det i fakturakörningen.
        </Notice>
      )}
      {inv.status === "returned" && (
        <Notice tone="warn" title="Returnerad av kommunen">
          Fakturan returnerades. Kreditera den och skapa en ny med rätt beställarreferens – raderna räknas på nytt från dagens underlag.
        </Notice>
      )}
      <div className="grid grid-cols-2 items-start gap-5 max-[980px]:grid-cols-1 [&>*]:min-w-0">
        <Card title="Peppol-fält" icon="layers">
          <Kv
            items={[
              [
                "BuyerReference",
                <span key="br">
                  {inv.buyerReference ? (
                    <>
                      <span className="font-bold tabular-nums">{inv.buyerReference}</span> <span className="text-small">({inv.ref.label.toLowerCase()})</span>
                    </>
                  ) : (
                    <span className="font-bold">{inv.ref.label}</span>
                  )}
                </span>,
              ],
              [
                "OrderReference",
                inv.purchaseOrderNumber ? (
                  <span className="tabular-nums">{inv.purchaseOrderNumber}</span>
                ) : (
                  <span>
                    Tomt <span className="text-small text-text-muted">– kommunen beställer utanför e-handeln</span>
                  </span>
                ),
              ],
              ["Faktureringsobjekt", "Ärendenumret på varje rad"],
              ["Moms per momssats", inv.vat.map((x) => `${x.rate} %`).join(", ") || "–"],
              ["Format", "Peppol BIS Billing 3 via Fortnox e-faktura"],
            ]}
          />
        </Card>
        <Card title="Så tar kommunen emot fakturan" icon="building">
          <div className="flex flex-col gap-2">
            <p>
              Fakturan kommer som Peppol-faktura till kommunens e-fakturasystem. Kommunen använder beställarreferensen{" "}
              {inv.buyerReference ? <b className="tabular-nums">{inv.buyerReference}</b> : ""} för att skicka den till rätt enhet{inv.ref.unit ? ` (${inv.ref.unit})` : ""}.
            </p>
            <p>Varje rad har ärendenumret, så kommunen kan stämma av raden mot beställningen. Handläggaren ser samma ärendenummer i portalen – men ingen faktura där.</p>
          </div>
        </Card>
      </div>
      <Paper
        title="Faktura"
        draft={!IN_FORTNOX.includes(inv.status) && inv.status !== "manual" ? "Förhandsvisning – inte skapad i Fortnox" : null}
        info={[
          ["Fakturanummer", inv.fortnoxNo || inv.manualInvoiceNo || "Sätts av Fortnox"],
          ["Fakturadatum", fmtDate(p.invoiceDate)],
          ["Förfallodatum", fmtDate(p.dueDate)],
          ["Er referens", inv.buyerReference || "–"],
          ["Ert ordernummer", inv.purchaseOrderNumber || "–"],
          ["Avtal", p.contractNumber],
        ]}
      >
        <div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
          <div className="flex flex-col gap-0.5 text-small">
            <span className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Säljare</span>
            <b>{p.supplier.name}</b>
            <span>Org.nr {p.supplier.orgNr}</span>
            <span>Momsreg.nr {p.supplier.vatNo}</span>
            <span className="text-text-muted">Adress och bankgiro hämtas från Fortnox</span>
          </div>
          <div className="flex flex-col gap-0.5 text-small">
            <span className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Köpare</span>
            <b>{p.customer.name}</b>
            <span>Org.nr {p.customer.orgNr}</span>
            <span>{inv.ref.unit || "Enhet enligt beställarreferensen"}</span>
            <span className="text-text-muted">Peppol-id ska bekräftas med kommunens e-handel</span>
          </div>
        </div>
        <Kv
          className="text-small"
          items={[
            ["Avtal", `${p.contractNumber}${p.dnr ? ` (dnr ${p.dnr})` : ""}`],
            ["Period", `${fmtDate(pStart)} – ${fmtDate(pEnd)}`],
            ["Rader", `${plural(inv.lines.length, "ärende", "ärenden")}, ${plural(inv.quantity, "deltagarvecka", "deltagarveckor")}`],
          ]}
        />
        <h2>Fakturarader</h2>
        <div className="max-w-full overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Beskrivning</th>
                <th className="text-right">Antal</th>
                <th className="text-right">À-pris</th>
                <th className="text-right">Moms</th>
                <th className="text-right">Belopp</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => {
                const isMarked = marked?.caseId === l.caseId;
                return (
                  <tr key={l.caseId} className={cn(isMarked && "bg-bla-ton")} aria-current={isMarked ? "true" : undefined}>
                    <td>
                      <b className="whitespace-nowrap">{l.articleNo}</b>
                      <div className="text-small">{l.areaTitle}, deltagarvecka</div>
                    </td>
                    <td>
                      {l.lineText}
                      {(allNotes || isMarked) && p.notes[l.caseId] && <div className="mt-1 text-small text-text-muted">{p.notes[l.caseId]}</div>}
                    </td>
                    <td className="text-right whitespace-nowrap tabular-nums">{plural(l.quantity, "vecka", "veckor")}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{krExact(l.unitPriceOre)}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{l.vatRate} %</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{krExact(l.amountOre)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-print="hide">
          <Button kind="ghost" icon={allNotes ? "chevron-up" : "chevron-down"} ariaPressed={allNotes} onClick={() => setAllNotes(!allNotes)}>
            {allNotes ? "Dölj radernas anmärkning" : "Visa radernas anmärkning (upparbetat och återstående)"}
          </Button>
        </div>
        <div className="ml-auto flex w-[min(100%,340px)] flex-col">
          <SumRow label="Summa exkl. moms" value={krExact(inv.amountOre)} />
          {inv.vat.map((x) => (
            <SumRow key={x.rate} label={`Moms ${x.rate} %`} value={krExact(x.vatOre)} />
          ))}
          <SumRow label="Öresavrundning" value={krExact(p.roundingOre)} />
          <SumRow total label="Att betala" value={krExact(p.grossRoundedOre)} />
        </div>
        <h2>Fakturatext</h2>
        <p>{p.invoiceText}</p>
        <h2>Betalning</h2>
        <p>Betalningsvillkor {p.paymentTermsDays} dagar efter godkänd leverans och korrekt faktura. Bankgiro hämtas från Fortnox. Ange fakturanumret vid betalning.</p>
        <PaperFixedText>
          Periodisk fakturering, månadsvis i efterskott, en faktura för avtalet och månaden med en rad per ärende. Ärendenumret på varje rad är faktureringsobjekt. Fakturan
          skickas som Peppol BIS Billing 3 – inte som e-post eller papper.
        </PaperFixedText>
      </Paper>
      {marked && p.notes[marked.caseId] && (
        <Card title={`Upparbetat och återstående – ${marked.caseNumber}`} icon="layers">
          <div className="flex flex-col gap-2">
            <p>{p.notes[marked.caseId]}</p>
            <p className="text-small text-text-muted">
              <b>Upparbetat</b> är alla debiterbara veckor till och med {monthName(mk)} (pausade veckor räknas inte). <b>Tidigare fakturerat</b> är veckor på fakturor som är skapade i
              Fortnox eller manuellt fakturerade. <b>Faktureras om</b> är veckor på en faktura som kommunen har returnerat – de räknas inte som fakturerade förrän en ny faktura är skapad.
            </p>
          </div>
        </Card>
      )}
      <Card title="Fältmappning Fortnox → Peppol" icon="link" flush>
        <Table
          caption="Fältmappning Fortnox till Peppol"
          rows={mapping}
          columns={[
            { key: "f", label: "Fält i Fortnox", render: (r) => <span className="font-bold">{r.f}</span> },
            { key: "p", label: "Peppol BIS Billing 3", nowrap: true },
            { key: "v", label: "Värde på den här fakturan", render: (r) => <span className="tabular-nums">{r.v}</span> },
            { key: "note", label: "Regel", render: (r) => <span className="text-small">{r.note}</span> },
          ]}
        />
        <div className="px-[18px] py-3.5">
          <Notice tone="warn" title="Bekräftas innan skarp drift">
            Skicka en testfaktura och kontrollera med {p.customer.eInvoiceContact} att ”Er referens” hamnar i BuyerReference, att ”Ert ordernummer” ger ett tomt OrderReference och
            att ärendenumret står på varje rad.
          </Notice>
        </div>
      </Card>
      <DemoNote>Förhandsvisningen är byggd av fakturaunderlaget i prototypen. Fakturanummer, bankgiro och adresser sätts av Fortnox i den riktiga tjänsten. Priserna är exempel.</DemoNote>
    </Page>
  );
}

function SumRow({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={total ? "flex justify-between gap-4 border-b-2 border-antracit py-[5px] font-extrabold tabular-nums" : "flex justify-between gap-4 border-b border-ljusgra py-[5px] tabular-nums"}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
