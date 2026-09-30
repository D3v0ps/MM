"use client";
// Förhandsvisning av en faktura (prototypens eko.faktura): Peppol-fält, så tar kommunen emot fakturan, fakturan som papper,
// upparbetat och återstående och fältmappningen Fortnox → Peppol. Fakturan innehåller inga namn eller personnummer.
import { useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { fmtDate, monthName } from "@/core/time";
import { krExact } from "@/core/format";
import { Badge, Button, Card, DemoNote, Empty, ErrorNotice, Icon, Kv, Loading, Notice, Page, Paper, PaperFixedText, PerspectiveLink, Stepper, Table } from "@/ui";
import { ekoPreview, type InvoicePreviewView } from "../api";
import { IN_FORTNOX, monthLabel, pl, plural, weekText } from "../model";
import { CHECK, InvStatus, SummaryList, WRAP } from "./parts";

const MONTH_RE = /^\d{4}-\d{2}$/;
const STEPS = ["draft", "approved", "fortnox_created", "booked", "sent", "paid"];
const STEP_LABEL = ["Underlag", "Godkänd", "Skapad i Fortnox", "Bokförd", "Skickad (Peppol)", "Betald"];

export function FakturaScreen({ params }: ScreenProps) {
  const month = MONTH_RE.test(params.month ?? "") ? params.month : undefined;
  const q = useQuery(ekoPreview, { month, caseId: params.caseId ?? "" });
  const crumbsFor = (v?: InvoicePreviewView) =>
    [
      { label: "Fakturering", to: "/ekonomi" },
      month ? { label: monthLabel(month), to: `/ekonomi/${month}` } : null,
      { label: v?.caseNumber ?? "Faktura" },
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
  const stepIdx = STEPS.indexOf(inv.status);
  const remarks = inv.checks.filter((x) => x.severity !== "info");
  const desc = p.lineText;
  const [pStart, pEnd] = p.period;
  const custRole = p.referrerId ? "kommun_handlaggare" : "kommun_chef";
  const mapping = [
    { id: "m1", f: "Er referens", p: "BuyerReference (BT-10)", v: inv.buyerReference || "–", note: `Kommunens beställarreferens, ${p.refLen} siffror. Krävs – utan den kan fakturan inte skapas.` },
    { id: "m2", f: "Ert ordernummer", p: "OrderReference (BT-13)", v: p.po || "Tomt", note: `Bara kommunens inköpsordernummer (${p.poText}). Aldrig ärendenumret eller andra egna nummer.` },
    { id: "m3", f: "Artikel och benämning", p: "Item (BT-153, BT-155)", v: `${inv.articleNo} · ${inv.areaTitle}`, note: "En artikel per avtalsområde, pris per deltagarvecka." },
    { id: "m4", f: "Radtext", p: "InvoiceLine Note (BT-127)", v: desc, note: "Ärendenummer och veckor på varje rad. Inga namn." },
    {
      id: "m5",
      f: "Fakturatext",
      p: "Note (BT-22)",
      v: "Upparbetat och återstående",
      note: "Beställningen, denna faktura, tidigare fakturerat, veckor som faktureras om efter returnerad faktura, upparbetat och återstående.",
    },
    { id: "m6", f: "Faktureringsobjekt", p: "InvoicedObjectIdentifier (BT-18)", v: inv.caseNumber, note: "Ärendenumret. Hur fältet fylls från Fortnox ska bekräftas." },
    { id: "m7", f: "Betalningsvillkor", p: "PaymentTerms (BT-20)", v: `${p.paymentTermsDays} dagar`, note: "Enligt avtalet." },
    { id: "m8", f: "Bankgiro", p: "PaymentMeans (BG-16)", v: "Hämtas från Fortnox", note: "Anges inte i Miljonmatch." },
  ];
  const sm = p.summary;
  return (
    <Page className={WRAP}
      title={`Faktura ${inv.caseNumber}`}
      eyebrow={`Förhandsvisning · Peppol BIS Billing 3 via Fortnox · ${monthName(mk)}`}
      crumbs={crumbs}
      lead={`Så här blir fakturan när den skapas i Fortnox och skickas till ${p.customer.name}. Fakturan innehåller inga namn eller personnummer.`}
      actions={
        <>
          <Button kind="secondary" icon="arrow-left" onClick={() => nav.push(`/ekonomi/${mk}?arende=${encodeURIComponent(v.caseId)}`)}>
            Tillbaka till körningen
          </Button>
          <Button kind="ghost" icon="briefcase" onClick={() => nav.push(`/ekonomi/arende/${encodeURIComponent(v.caseId)}`)}>
            Öppna ärendet
          </Button>
        </>
      }
    >
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
          {remarks.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-small">
              <Icon name="check-circle" />
              Inga anmärkningar
            </span>
          ) : (
            remarks.map((ch, i) => (
              <Badge key={`${ch.kind}-${i}`} tone={CHECK[ch.severity].tone} icon={CHECK[ch.severity].icon} title={ch.text}>
                {ch.label}
              </Badge>
            ))
          )}
        </div>
        {stepIdx >= 0 && <Stepper steps={STEP_LABEL} current={inv.status === "paid" ? STEPS.length : stepIdx} />}
      </div>
      {inv.blocked && (
        <Notice tone="critical" title="Fakturan kan inte skapas">
          {inv.ref.text} Rätta beställarreferensen i fakturakörningen.
        </Notice>
      )}
      {inv.status === "returned" && (
        <Notice tone="warn" title="Returnerad av kommunen">
          Fakturan returnerades. Kreditera den och skapa en ny med rätt beställarreferens.
        </Notice>
      )}
      <div className="grid grid-cols-2 items-start gap-5 max-[980px]:grid-cols-1 [&>*]:min-w-0">
        <Card title="Peppol-fält" icon="layers">
          <Kv
            items={[
              [
                "BuyerReference",
                <span key="br">
                  <span className="font-bold tabular-nums">{inv.buyerReference || "Saknas"}</span> <span className="text-small">({inv.ref.label.toLowerCase()})</span>
                </span>,
              ],
              [
                "OrderReference",
                p.po ? (
                  <span className="tabular-nums">{p.po}</span>
                ) : (
                  <span>
                    Tomt <span className="text-small text-text-muted">– kommunen beställer utanför e-handeln</span>
                  </span>
                ),
              ],
              ["Faktureringsobjekt", <span key="fo" className="font-bold tabular-nums">{inv.caseNumber}</span>],
              ["Moms per artikel", `${inv.vatRate} % (${inv.articleNo})`],
              ["Format", "Peppol BIS Billing 3 via Fortnox e-faktura"],
            ]}
          />
        </Card>
        <Card title="Så tar kommunen emot fakturan" icon="building">
          <div className="flex flex-col gap-2">
            <p className="text-small">
              Fakturan kommer som Peppol-faktura till kommunens e-fakturasystem. Kommunen använder beställarreferensen{" "}
              {inv.buyerReference ? <b className="tabular-nums">{inv.buyerReference}</b> : ""} för att skicka den till rätt enhet{inv.ref.unit ? ` (${inv.ref.unit})` : ""}.
            </p>
            <p className="text-small">Ärendenumret kopplar fakturan till beställningen. Handläggaren ser samma ärendenummer i portalen – men ingen faktura där.</p>
            <div>
              <PerspectiveLink
                role={custRole}
                userId={p.referrerId ?? undefined}
                to={`/portal/deltagare/${encodeURIComponent(v.caseId)}`}
                label="Se ärendet från kundens håll"
              />
            </div>
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
          ["Ert ordernummer", p.po || "–"],
          ["Faktureringsobjekt", inv.caseNumber],
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
            ["Period", `${fmtDate(pStart)} – ${fmtDate(pEnd)} (${weekText(inv.weeks)})`],
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
              <tr>
                <td>
                  <b className="whitespace-nowrap">{inv.articleNo}</b>
                  <div className="text-small">{inv.areaTitle}, deltagarvecka</div>
                </td>
                <td>{desc}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{plural(inv.quantity, "vecka", "veckor")}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{krExact(inv.unitPriceOre)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{inv.vatRate} %</td>
                <td className="text-right whitespace-nowrap tabular-nums">{krExact(inv.amountOre)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="ml-auto flex w-[min(100%,340px)] flex-col">
          <SumRow label="Summa exkl. moms" value={krExact(inv.amountOre)} />
          <SumRow label={`Moms ${inv.vatRate} %`} value={krExact(p.vatOre)} />
          <SumRow label="Öresavrundning" value={krExact(p.roundingOre)} />
          <SumRow total label="Att betala" value={krExact(p.grossRoundedOre)} />
        </div>
        <h2>Fakturatext</h2>
        <p>{sm.text}</p>
        <h2>Betalning</h2>
        <p>Betalningsvillkor {p.paymentTermsDays} dagar efter godkänd leverans och korrekt faktura. Bankgiro hämtas från Fortnox. Ange fakturanumret vid betalning.</p>
        <PaperFixedText>
          Periodisk fakturering, månadsvis i efterskott, en faktura per ärende och månad. Ärendenumret {inv.caseNumber} är faktureringsobjekt. Fakturan skickas som Peppol BIS
          Billing 3 – inte som e-post eller papper.
        </PaperFixedText>
      </Paper>
      <Card title="Upparbetat och återstående" icon="layers">
        <div className="grid grid-cols-2 items-start gap-5 max-[980px]:grid-cols-1 [&>*]:min-w-0">
          <SummaryList inv={inv} sm={sm} />
          <div className="flex flex-col gap-2 text-small">
            <p>
              <b>Upparbetat</b> är alla debiterbara veckor till och med {monthName(mk)}. Pausade veckor räknas inte.
            </p>
            <p>
              <b>Tidigare fakturerat</b> är veckor på fakturor som är skapade i Fortnox eller manuellt fakturerade.
            </p>
            {sm.returned.qty > 0 ? (
              <p>
                <b>Faktureras om</b>: kommunen returnerade fakturan för {sm.returned.months.map((r) => monthName(r.mk)).join(", ")}. {pl(sm.returned.qty, "Veckan", "Veckorna")} räknas
                som {pl(sm.returned.qty, "upparbetad", "upparbetade")} men inte som {pl(sm.returned.qty, "fakturerad", "fakturerade")} förrän den returnerade fakturan är krediterad och
                en ny faktura är skapad.
              </p>
            ) : (
              <p>
                <b>Faktureras om</b>: veckor på en faktura som kommunen har returnerat. De räknas inte som fakturerade förrän en ny faktura är skapad.
              </p>
            )}
            <p>Samma siffror står i fakturatexten och i ärendets vy.</p>
          </div>
        </div>
      </Card>
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
            Skicka en testfaktura och kontrollera med {p.customer.eInvoiceContact} att ”Er referens” hamnar i BuyerReference och att ”Ert ordernummer” ger ett tomt
            OrderReference.
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

