"use client";
// Bonusfakturorna (/ekonomi/bonus/:month?, beslut 2026-11-04): en faktura per avtal och månad för de bonusanspråk som kommunen
// godkände under månaden – skild från månadens periodiska faktura. Samma steg som de periodiska: beställarreferens (krävs),
// inköpsordernummer (bara kommunens 99-nummer), godkänn efter månadsskiftet, skapa i Fortnox eller markera som manuellt
// fakturerad. En rad per bonussteg; ett anspråk som taket redan har nått får ingen rad och visas som "Taket är nått". Bara
// ekonomen (belopp).
import { useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { kr } from "@/core/format";
import { monthName } from "@/core/time";
import { Badge, Button, Card, ErrorNotice, Field, Input, Loading, Notice, Page, Row, Select, Stack, Table, toast } from "@/ui";
import { billingApproveInvoice, billingMarkManual, billingSendFortnox, ekoBonus, type BonusBillingView } from "../api";
import { CheckIcons, InvStatus, InvoicePoForm, InvoiceRefForm, RoleNotice, WRAP } from "./parts";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function BonusFakturaScreen({ params }: ScreenProps) {
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month : undefined;
  const q = useQuery(ekoBonus, month ? { month } : {}, { keepPrevious: true });
  const crumbs = [{ label: "Fakturering", to: "/ekonomi" }, { label: "Bonusfakturor" }];
  const lead = "Bonus enligt incitamentsmodellen faktureras på en egen faktura per månad, med en rad per bonussteg som kommunen har godkänt. Stegen läggs ihop utan avräkning upp till taket per deltagare.";
  if (q.error) return <Page className={WRAP} title="Bonusfakturor" crumbs={crumbs} lead={lead}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page className={WRAP} title="Bonusfakturor" crumbs={crumbs} lead={lead}><Loading /></Page>;
  return <Content v={q.data} crumbs={crumbs} lead={lead} />;
}

function Content({ v, crumbs, lead }: { v: BonusBillingView; crumbs: { label: string; to?: string }[]; lead: string }) {
  const nav = useNav();
  const title = v.month ? `Bonusfakturor ${monthName(v.month)}` : "Bonusfakturor";
  return (
    <Page className={WRAP} title={title} crumbs={crumbs} lead={lead}>
      <RoleNotice canAct={v.canAct} />
      {!v.on && <Notice tone="info" title="Bonus är inte påslagen i avtalet">Det finns inga bonusfakturor att skapa.</Notice>}
      {v.months.length > 1 && (
        <Field label="Månad" help="Månaden då kommunen godkände bonusanspråken." id="eko-bonus-manad">
          <Select value={v.month ?? ""} onValueChange={(m) => nav.replace(`/ekonomi/bonus/${m}`)} options={v.months.map((m) => ({ value: m, label: cap(monthName(m)) }))} />
        </Field>
      )}
      {v.month && v.monthOpen && <Notice tone="info" title="Månaden är inte slut">{v.monthOpen}</Notice>}
      {v.invoices.length === 0 ? (
        <Notice tone="info" title="Inga bonusfakturor">{v.month ? `Kommunen har inte godkänt något bonusanspråk i ${monthName(v.month)}.` : "Kommunen har inte godkänt något bonusanspråk än."}</Notice>
      ) : (
        v.invoices.map((inv) => <BonusInvoice key={inv.id} v={v} inv={inv} />)
      )}
    </Page>
  );
}

function BonusInvoice({ v, inv }: { v: BonusBillingView; inv: BonusBillingView["invoices"][number] }) {
  const approve = useCommand(billingApproveInvoice);
  const fortnox = useCommand(billingSendFortnox);
  const manual = useCommand(billingMarkManual);
  const [no, setNo] = useState("");
  const month = inv.month;
  const canChange = v.canAct && !inv.created;
  const onApprove = async () => {
    const res = await approve.run({ month, invoiceId: inv.id }).catch(() => null);
    if (!res || !res.ok) return toast(res && !res.ok ? res.message || "Fakturan kunde inte godkännas." : "Fakturan kunde inte godkännas.", "error");
    toast(`${inv.title} är godkänd.`);
  };
  const onFortnox = async () => {
    const res = await fortnox.run({ month, invoiceIds: [inv.id] }).catch(() => null);
    if (!res || !res.ok) return toast(res && !res.ok ? res.message || "Fakturan kunde inte skapas." : "Fakturan kunde inte skapas.", "error");
    toast(res.created.length ? `${inv.title} är skapad i Fortnox.` : res.blocked.length ? "Fakturan är stoppad." : "Fakturan är inte godkänd än.");
  };
  const onManual = async () => {
    const res = await manual.run({ month, invoiceId: inv.id, invoiceNo: no.trim() }).catch(() => null);
    if (!res || !res.ok) return toast(res && !res.ok ? res.message || "Fakturan kunde inte markeras." : "Fakturan kunde inte markeras.", "error");
    toast(`${inv.title} är markerad som manuellt fakturerad med fakturanummer ${no.trim()}.`);
    setNo("");
  };
  return (
    <Card title={inv.title} icon="award" actions={<InvStatus status={inv.status} />} flush>
      <Stack className="px-[18px] py-4">
        <Row>
          <span>
            <b>{inv.lines.length}</b> {inv.lines.length === 1 ? "bonussteg" : "bonussteg"} · summa exkl. moms <b className="tabular-nums">{kr(inv.amountOre)}</b> · moms <b className="tabular-nums">{kr(inv.vatOre)}</b>
          </span>
          {v.capOre != null && <span className="text-text-muted">Tak per deltagare: {kr(v.capOre)}</span>}
          <span className="text-text-muted">Er referens: <b className="tabular-nums text-antracit">{inv.buyerReference ?? "saknas"}</b></span>
          {inv.manualInvoiceNo && <span className="text-text-muted">Fakturanummer {inv.manualInvoiceNo}</span>}
          {inv.fortnoxNo && <span className="text-text-muted">Fortnox nr {inv.fortnoxNo}</span>}
        </Row>
        {inv.checks.length > 0 && <CheckIcons checks={inv.checks} column />}
      </Stack>
      <Table
        caption={`Rader på ${inv.title.toLowerCase()}`}
        rows={inv.lines}
        rowKey={(l) => `${l.caseId}:${l.bonusStep ?? 0}`}
        empty="Fakturan har inga rader."
        columns={[
          { key: "text", label: "Radtext", render: (l) => <span className="tabular-nums">{l.lineText}</span> },
          { key: "step", label: "Bonussteg", render: (l) => (l.bonusLabel ? `${l.bonusStep} · ${l.bonusLabel}` : "–") },
          { key: "art", label: "Artikel", render: (l) => <span className="tabular-nums">{l.articleNo || "–"}</span> },
          { key: "amount", label: "Belopp exkl. moms", num: true, nowrap: true, render: (l) => kr(l.amountOre) },
          { key: "vat", label: "Moms", num: true, render: (l) => `${l.vatRate} %` },
          { key: "checks", label: "Anmärkning", render: (l) => (l.checks.length ? <CheckIcons checks={l.checks} column /> : "–") },
        ]}
      />
      {inv.capped.length > 0 && (
        <div className="border-t border-ljusgra px-[18px] py-3">
          <Notice tone="info" title="Taket är nått">
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
              {inv.capped.map((x) => (
                <li key={x.claimId}>
                  {x.caseNumber} · Bonussteg {x.step} ({x.label}): godkänt men faktureras inte – deltagaren har redan nått taket. Pris i prislistan {kr(x.priceOre)}.
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      {canChange && (
        <Stack className="border-t border-ljusgra px-[18px] py-4">
          <InvoiceRefForm inv={inv} rules={v.refRules} canAct={v.canAct} idSuffix={`bonus-${inv.id}`} />
          <InvoicePoForm inv={inv} rules={v.refRules} idSuffix={`bonus-${inv.id}`} />
          <Row>
            {inv.status !== "approved" && (
              <Button kind="secondary" icon="check" pending={approve.pending} disabled={!!v.monthOpen || inv.lines.length === 0} onClick={() => void onApprove()}>
                Godkänn fakturan
              </Button>
            )}
            {v.fortnox.connected && (
              <Button kind="primary" icon="send" pending={fortnox.pending} disabled={inv.status !== "approved" || inv.blocked} onClick={() => void onFortnox()}>
                Skapa i Fortnox
              </Button>
            )}
          </Row>
          <Row>
            <Field label="Fakturanummer (manuellt fakturerad)" help="Numret från Fortnox eller kommunens fakturaportal. Kräver giltig beställarreferens." id={`eko-bonus-no-${inv.id}`}>
              <Input value={no} onValueChange={setNo} inputMode="numeric" maxLength={10} />
            </Field>
            <Button kind="ghost" icon="check" pending={manual.pending} disabled={!/^\d{3,10}$/.test(no.trim()) || !!v.monthOpen || inv.blocked} onClick={() => void onManual()}>
              Markera som manuellt fakturerad
            </Button>
          </Row>
          {inv.blocked && <Badge tone="red" icon="alert-circle">Stoppad – rätta det som står ovan först</Badge>}
        </Stack>
      )}
    </Card>
  );
}
