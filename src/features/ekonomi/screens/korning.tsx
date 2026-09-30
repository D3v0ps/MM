"use client";
// Fakturakörningen för en månad (prototypens eko.korning): regler, stegen i körningen, fakturalistan med filter och sök,
// detaljen per faktura (kontroller och åtgärder), reservvägen (export och manuellt fakturerad) och Fortnox-körningarna.
import { useState, type ReactNode } from "react";
import { useCommand, useQuery, useQueryRunner } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { fmtDate, fmtDateShort, fmtDateTime, fmtWeekKey, fmtWeekRange, monthName } from "@/core/time";
import { kr, krExact, num } from "@/core/format";
import {
  Badge, BuildPhase, Button, Card, Check, cn, DemoNote, Empty, ErrorNotice, Field, Icon, Input, Kv, Loading, Modal, Notice, Page, Select, SlaBadge, Table, Tabs, TextArea,
  useConfirm, useDownload, toast, type Column,
} from "@/ui";
import {
  billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox, ekoAskCoordinator, ekoCloseRun, ekoCsv, ekoFortnoxLog, ekoFortnoxSync,
  ekoInvoice, ekoReissue, ekoRun, type InvoiceCheckView, type InvoiceDetailView, type InvoiceRow, type RunView,
} from "../api";
import { BILLED, BUCKET_ORDER, monthLabel, periodOf, pl, plural, weekText } from "../model";
import { CHECK, CheckIcons, EkoKpi, EkoKpis, FixBox, InvStatus, PAGE_SIZE, Pager, Quote, RefBadge, RefCell, RefForm, RoleNotice, SectionTitle, SummaryList, WRAP } from "./parts";

type Filter = "alla" | "stoppade" | "godkannande" | "klara";
const FILTERS: readonly Filter[] = ["alla", "stoppade", "godkannande", "klara"];
const MONTH_RE = /^\d{4}-\d{2}$/;

export function KorningScreen({ params, query }: ScreenProps) {
  const month = MONTH_RE.test(params.month ?? "") ? params.month : undefined;
  const q = useQuery(ekoRun, { month });
  const crumbs = [{ label: "Fakturering", to: "/ekonomi" }, { label: q.data?.month ? monthLabel(q.data.month) : "Fakturakörning" }];
  if (q.error) return <Page className={WRAP} title="Fakturakörning" crumbs={crumbs}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page className={WRAP} title="Fakturakörning" crumbs={crumbs}><Loading /></Page>;
  const v = q.data;
  if (!v.month) {
    return (
      <Page className={WRAP} title="Fakturakörning" crumbs={crumbs}>
        <Empty icon="file" title="Ingen fakturakörning ännu">
          Underlaget räknas fram efter varje månadsskifte.
        </Empty>
      </Page>
    );
  }
  const f = query.get("filter");
  return (
    <Korning
      key={v.month}
      v={v as RunView & { month: string }}
      crumbs={crumbs}
      initialFilter={FILTERS.includes(f as Filter) ? (f as Filter) : "alla"}
      initialOpen={query.get("arende")}
    />
  );
}

function Korning({ v, crumbs, initialFilter, initialOpen }: { v: RunView & { month: string }; crumbs: { label: string; to?: string }[]; initialFilter: Filter; initialOpen: string | null }) {
  const nav = useNav();
  const confirm = useConfirm();
  const download = useDownload();
  const runQuery = useQueryRunner();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [manual, setManual] = useState<{ presetId: string | null } | null>(null);
  const approveInvoice = useCommand(billingApproveInvoice);
  const sendFortnox = useCommand(billingSendFortnox);
  const fortnoxLog = useCommand(ekoFortnoxLog);
  const fortnoxSync = useCommand(ekoFortnoxSync);
  const exportCmd = useCommand(billingExport);
  const closeRunCmd = useCommand(ekoCloseRun);

  const mk = v.month;
  const act = v.canAct;
  const rows = v.rows;
  const counts = {
    alla: rows.length,
    stoppade: rows.filter((r) => r.bucket === "blocked").length,
    godkannande: rows.filter((r) => r.bucket === "review").length,
    klara: rows.filter((r) => r.bucket === "ready").length,
  };
  const withRemarks = rows.filter((r) => r.bucket === "review" && r.remarks).length;
  const clean = rows.filter((r) => r.status === "draft" && !r.blocked && !r.needsApproval && !r.remarks);
  const approved = rows.filter((r) => r.status === "approved" && !r.blocked && !r.needsApproval);
  const already = rows.filter((r) => BILLED.includes(r.status));
  const fresh = approved.filter((r) => !r.hasKey);
  const toSync = rows.filter((r) => ["fortnox_created", "booked", "sent"].includes(r.status));
  const allDone = rows.length > 0 && rows.every((r) => BILLED.includes(r.status));

  const needle = search.trim().toUpperCase();
  const list = rows
    .filter(
      (r) =>
        (filter === "alla" || (filter === "stoppade" && r.bucket === "blocked") || (filter === "godkannande" && r.bucket === "review") || (filter === "klara" && r.bucket === "ready")) &&
        (!needle || r.caseNumber.includes(needle)),
    )
    .sort((a, x) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[x.bucket] || (x.remarks ? 1 : 0) - (a.remarks ? 1 : 0) || (a.caseNumber < x.caseNumber ? -1 : 1));
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const shown = list.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const setF = (x: Filter) => {
    setFilter(x);
    setPage(0);
  };

  const approveAll = async () => {
    const ok = await confirm({
      title: "Godkänn fakturor utan anmärkning",
      confirmLabel: `Godkänn ${plural(clean.length, "faktura", "fakturor")}`,
      body: (
        <div className="flex flex-col gap-2">
          <p>{plural(clean.length, "faktura", "fakturor")} har giltig beställarreferens och inga anmärkningar. De blir klara att skapa i Fortnox.</p>
          <p className="text-small text-text-muted">
            {plural(withRemarks, "faktura", "fakturor")} med anmärkning och {plural(counts.stoppade, "stoppad faktura", "stoppade fakturor")} tas inte med. Dem granskar du var för
            sig.
          </p>
        </div>
      ),
    });
    if (!ok) return;
    await approveInvoice.run({ month: mk, caseIds: clean.map((r) => r.caseId) });
    toast(`${plural(clean.length, "faktura", "fakturor")} ${pl(clean.length, "är godkänd", "är godkända")}. ${plural(withRemarks, "faktura", "fakturor")} med anmärkning återstår.`);
  };
  const createInFortnox = async () => {
    const notReady = counts.godkannande;
    const ok = await confirm({
      title: "Skapa fakturor i Fortnox",
      confirmLabel: fresh.length ? `Skapa ${plural(fresh.length, "faktura", "fakturor")}` : "Kör ändå",
      body: (
        <div className="flex flex-col gap-2">
          <p>
            {fresh.length
              ? `${plural(fresh.length, "godkänd faktura", "godkända fakturor")} skapas som ${pl(fresh.length, "ej bokfört utkast", "ej bokförda utkast")} i Fortnox.`
              : "Det finns inga nya godkända fakturor att skapa."}
          </p>
          <ul className="m-0 list-disc pl-5 text-small">
            <li>
              {plural(already.length, "faktura finns", "fakturor finns")} redan i Fortnox eller är {pl(already.length, "manuellt fakturerad", "manuellt fakturerade")} och hoppas över. En
              omkörning skapar inga dubbletter.
            </li>
            <li>{plural(counts.stoppade, "stoppad faktura", "stoppade fakturor")} kan inte skapas.</li>
            <li>{plural(notReady, "faktura som inte är godkänd", "fakturor som inte är godkända")} tas inte med.</li>
          </ul>
          <p className="text-small text-text-muted">
            I den riktiga tjänsten skickas anropen i takt med Fortnox gräns (25 anrop per 5 sekunder) och varje faktura får idempotensnyckeln månad + ärendenummer.
          </p>
        </div>
      ),
    });
    if (!ok) return;
    if (fresh.length) await sendFortnox.run({ month: mk, caseIds: fresh.map((r) => r.caseId) });
    await fortnoxLog.run({ month: mk, created: fresh.map((r) => r.caseId), skipped: already.length, notReady, blocked: counts.stoppade });
    toast(
      fresh.length
        ? `${plural(fresh.length, "faktura", "fakturor")} skapades i Fortnox som ${pl(fresh.length, "ej bokfört utkast", "ej bokförda utkast")} (simulerat). Inga dubbletter.`
        : `Inga nya fakturor. ${plural(already.length, "faktura", "fakturor")} fanns redan – inga dubbletter skapades.`,
    );
  };
  const sync = async () => {
    const r = await fortnoxSync.run({ month: mk, caseIds: toSync.map((x) => x.caseId) });
    toast(`Status hämtad från Fortnox (simulerat): ${plural(r.ok ? r.changed : 0, "faktura", "fakturor")} gick vidare ett steg.`);
  };
  const exportCsv = async () => {
    await exportCmd.run({ month: mk, format: "csv" });
    const file = await runQuery(ekoCsv, { month: mk });
    await download(file.filename, file.csv);
  };
  const closeRun = async () => {
    const ok = await confirm({
      title: `Stäng körningen för ${monthName(mk)}`,
      confirmLabel: "Stäng körningen",
      body: "Alla fakturor är skapade eller manuellt fakturerade. När körningen är stängd försvinner den från listan över sådant som förfaller.",
    });
    if (!ok) return;
    await closeRunCmd.run({ month: mk });
    toast(`Fakturakörningen för ${monthName(mk)} är stängd.`);
  };

  const columns: Column<InvoiceRow>[] = [
    { key: "number", label: "Ärende", nowrap: true, render: (r) => <span className="font-bold tabular-nums tracking-[0.01em]">{r.caseNumber}</span> },
    {
      key: "area",
      label: "Område",
      render: (r) => (
        <>
          <span className="font-bold">{r.areaCode}</span> <span className="text-small text-text-muted">{r.areaTitle}</span>
        </>
      ),
    },
    { key: "weeks", label: "Veckor", nowrap: true, render: (r) => weekText(r.weeks, true) },
    { key: "quantity", label: "Antal", num: true },
    { key: "price", label: "À-pris", num: true, nowrap: true, render: (r) => kr(r.unitPriceOre) },
    { key: "amount", label: "Belopp", num: true, nowrap: true, render: (r) => <span className="font-bold">{kr(r.amountOre)}</span> },
    { key: "ref", label: "Beställar­referens", render: (r) => <RefCell value={r.buyerReference} info={r.ref} /> },
    { key: "status", label: "Status", render: (r) => <InvStatus status={r.status} /> },
    { key: "checks", label: "Kontroller", render: (r) => <CheckIcons checks={r.checks} column /> },
  ];
  const step1Done = counts.stoppade === 0;
  const step2Done = counts.godkannande === 0;
  const step3Done = allDone;
  const sumQty = list.reduce((s, x) => s + x.quantity, 0);
  const sumAmount = list.reduce((s, x) => s + x.amountOre, 0);
  const openInv = openId ? rows.find((r) => r.caseId === openId) : null;

  return (
    <Page className={WRAP}
      title={`Fakturakörning ${monthName(mk)}`}
      eyebrow={`Fakturering · ${v.customerName}`}
      crumbs={crumbs}
      lead="Underlaget räknas fram per ärende och månad efter månadsskiftet. Granska stoppade fakturor och anmärkningar, godkänn och skapa fakturorna i Fortnox."
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor="eko-month" className="text-small font-bold">
            Månad
          </label>
          <div className="w-[210px] max-w-full">
            <Select
              id="eko-month"
              value={mk}
              options={v.runs.map((r) => ({ value: r.month, label: `${monthLabel(r.month)}${r.status === "draft" ? " (pågår)" : ""}` }))}
              onValueChange={(x) => nav.replace(`/ekonomi/${x}`)}
            />
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {v.run ? (
          <Badge tone={v.run.status === "draft" ? "dark" : "outline"} icon={v.run.status === "draft" ? "clock" : "check"}>
            {v.run.status === "draft" ? "Körningen pågår" : "Körningen är stängd"}
          </Badge>
        ) : (
          <Badge tone="outline">Preliminärt underlag</Badge>
        )}
        {v.due && (
          <>
            <span className="text-small font-bold">Ska vara i Fortnox:</span>
            <SlaBadge sla={v.due.sla} dueAt={v.due.at} />
            <span className="text-small text-text-muted">Internt mål – {v.due.days} arbetsdagar efter månadsskiftet.</span>
          </>
        )}
      </div>
      {!act && <RoleNotice canAct={act} />}
      <EkoKpis>
        <EkoKpi label="Fakturor" value={num(v.count)} sub={`${plural(v.weeks, "vecka", "veckor")} · en per ärende`} />
        <EkoKpi label="Belopp exkl. moms" value={kr(v.totalOre)} sub={`Inkl. moms ${kr(v.totalOre + v.vatOre)}`} />
        <EkoKpi label="Veckor" value={num(v.weeks)} sub={`${plural(v.calendarWeeks, "kalendervecka", "kalenderveckor")} i månaden`} />
        <EkoKpi
          label="Stoppade"
          value={num(counts.stoppade)}
          tone={counts.stoppade ? "alert" : null}
          statusText="Rätta först"
          sub={counts.stoppade ? "Kan inte skapas utan giltig beställarreferens" : "Inga stoppade"}
        />
        <EkoKpi label={"Kräver godkän­nande"} value={num(counts.godkannande)} tone={withRemarks ? "watch" : null} statusText="Granska" sub={`Varav ${withRemarks} med anmärkning`} />
      </EkoKpis>
      <MonthRulesCard v={v} />
      <Card
        title="Gör körningen"
        icon="list"
        foot={
          <>
            <span className="text-small font-bold">Reservväg:</span>
            <Button kind="secondary" icon="download" className="whitespace-normal" onClick={() => void exportCsv()}>
              Exportera underlag (CSV)
            </Button>
            {act && (
              <Button kind="secondary" icon="edit" className="whitespace-normal" onClick={() => setManual({ presetId: null })}>
                Markera som manuellt fakturerad
              </Button>
            )}
            <span className="text-small text-text-muted">Registrera för hand i Fortnox eller i kommunens kostnadsfria fakturaportal.</span>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          <Step n={1} done={step1Done}>
            <StepText title="Rätta stoppade">
              {counts.stoppade
                ? `${plural(counts.stoppade, "faktura saknar", "fakturor saknar")} giltig beställarreferens och kan inte skapas.`
                : "Alla fakturor har giltig beställarreferens."}
            </StepText>
            {counts.stoppade > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button kind="secondary" icon="filter" className="text-left whitespace-normal" onClick={() => setF("stoppade")}>
                  Visa stoppade ({counts.stoppade})
                </Button>
              </div>
            )}
          </Step>
          <Step n={2} done={step2Done}>
            <StepText title="Granska och godkänn">
              {clean.length ? `${plural(clean.length, "faktura", "fakturor")} utan anmärkning kan godkännas på en gång.` : "Inga fakturor utan anmärkning väntar."}{" "}
              {withRemarks ? `${plural(withRemarks, "faktura", "fakturor")} med anmärkning godkänner du var för sig.` : ""}
            </StepText>
            <div className="flex flex-wrap items-center gap-1.5">
              {act && (
                <Button kind="primary" icon="check" className="text-left whitespace-normal" disabled={!clean.length} pending={approveInvoice.pending} onClick={() => void approveAll()}>
                  Godkänn alla utan anmärkning ({clean.length})
                </Button>
              )}
              {withRemarks > 0 && (
                <Button kind="secondary" icon="filter" className="text-left whitespace-normal" onClick={() => setF("godkannande")}>
                  Visa de som kräver godkännande
                </Button>
              )}
            </div>
          </Step>
          <Step n={3} done={step3Done}>
            <StepText
              title={
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold">Skapa i Fortnox</span>
                  <BuildPhase fas={2} />
                </span>
              }
            >
              {fresh.length ? `${plural(fresh.length, "godkänd faktura väntar", "godkända fakturor väntar")}.` : "Inga nya godkända fakturor väntar."}{" "}
              {already.length
                ? `${plural(already.length, "faktura är redan skapad eller manuellt fakturerad", "fakturor är redan skapade eller manuellt fakturerade")}.`
                : ""}{" "}
              Stoppade fakturor kan inte skapas.
              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-small">
                <InvStatus status="fortnox_created" />
                <Icon name="arrow-right" />
                <InvStatus status="booked" />
                <Icon name="arrow-right" />
                <InvStatus status="sent" />
                <Icon name="arrow-right" />
                <InvStatus status="paid" />
              </span>
            </StepText>
            <div className="flex flex-wrap items-center gap-1.5">
              {act && (
                <Button
                  kind="primary"
                  icon="upload"
                  className="text-left whitespace-normal"
                  disabled={!fresh.length && !already.length}
                  pending={sendFortnox.pending || fortnoxLog.pending}
                  onClick={() => void createInFortnox()}
                >
                  Skapa i Fortnox ({fresh.length})
                </Button>
              )}
              {act && toSync.length > 0 && (
                <Button kind="secondary" icon="refresh" className="text-left whitespace-normal" pending={fortnoxSync.pending} onClick={() => void sync()}>
                  Hämta status från Fortnox
                </Button>
              )}
              {act && allDone && v.run?.status === "draft" && (
                <Button kind="secondary" icon="check-square" className="text-left whitespace-normal" onClick={() => void closeRun()}>
                  Stäng körningen
                </Button>
              )}
            </div>
          </Step>
        </div>
      </Card>
      <Card title={`Fakturor ${monthName(mk)}`} icon="file" flush foot={<Pager page={pg} total={list.length} onPage={setPage} />}>
        <div className="flex flex-col gap-4 px-[18px] pt-3.5 pb-1">
          <Tabs<Filter>
            ariaLabel="Filter för fakturor"
            active={filter}
            onChange={setF}
            tabs={[
              { id: "alla", label: "Alla", count: counts.alla },
              { id: "stoppade", label: "Stoppade", count: counts.stoppade, icon: "x-circle" },
              { id: "godkannande", label: "Kräver godkännande", count: counts.godkannande, icon: "clock" },
              { id: "klara", label: "Klara", count: counts.klara, icon: "check" },
            ]}
          />
          <div className="max-w-[460px]">
            <Field id="eko-search" label="Sök ärendenummer" help="Till exempel 0143 eller BOT-26-0143. Klicka på en rad för kontroller och åtgärder.">
              <Input
                type="search"
                value={search}
                onValueChange={(x) => {
                  setSearch(x);
                  setPage(0);
                }}
              />
            </Field>
          </div>
        </div>
        <div className="max-[620px]:hidden [&_td]:px-2 [&_td:first-child]:pl-4 [&_th]:px-2 [&_th]:align-bottom [&_th]:whitespace-normal [&_th:first-child]:pl-4">
          <Table
            caption={`Fakturor ${monthName(mk)}`}
            columns={columns}
            rows={shown}
            rowKey="caseId"
            onRowClick={(r) => setOpenId(r.caseId)}
            rowTone={(r) => (r.bucket === "blocked" ? "alert" : openId === r.caseId ? "selected" : null)}
            empty={
              filter === "stoppade"
                ? "Inga stoppade fakturor."
                : filter === "godkannande"
                  ? "Inga fakturor väntar på godkännande."
                  : filter === "klara"
                    ? "Inga fakturor är klara ännu. Godkänn fakturor i steg 2."
                    : "Inga fakturor matchar sökningen."
            }
            footer={
              list.length > 0 && (
                <tr>
                  <td colSpan={3}>Summa ({plural(list.length, "faktura", "fakturor")})</td>
                  <td className="text-right tabular-nums">{sumQty}</td>
                  <td />
                  <td className="text-right whitespace-nowrap tabular-nums">{kr(sumAmount)}</td>
                  <td colSpan={3} />
                </tr>
              )
            }
          />
        </div>
        {/* Under 620 px: lista i stället för tabell (samma innehåll). */}
        <div className="hidden flex-col border-t-2 border-antracit max-[620px]:flex">
          {shown.length === 0 && <div className="border-b border-ljusgra px-[18px] py-3 text-text-muted">Inga fakturor att visa.</div>}
          {shown.map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => setOpenId(r.caseId)}
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 border-0 border-b border-ljusgra bg-transparent px-[18px] py-3 text-left hover:bg-ljusgra-ton",
                r.bucket === "blocked" && "shadow-[inset_4px_0_0_var(--color-rod)]",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold tabular-nums">{r.caseNumber}</span>
                  <InvStatus status={r.status} />
                </span>
                <span className="text-small">
                  {r.areaName} · {weekText(r.weeks)}
                </span>
                <span className="text-small">
                  {r.quantity} × {kr(r.unitPriceOre)} = <b>{kr(r.amountOre)}</b>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-small">
                  Beställarreferens <RefBadge value={r.buyerReference} info={r.ref} />
                </span>
                {r.checks.some((x) => x.severity !== "info") && <CheckIcons checks={r.checks} />}
              </span>
              <Icon name="chevron-right" className="self-center" />
            </button>
          ))}
          {list.length > 0 && (
            <div className="flex items-start gap-3 border-b border-ljusgra px-[18px] py-3">
              <span className="flex-1 font-bold">Summa ({plural(list.length, "faktura", "fakturor")})</span>
              <span className="font-bold whitespace-nowrap">{kr(sumAmount)}</span>
            </div>
          )}
        </div>
      </Card>
      {v.fortnoxRuns.length > 0 && (
        <Card title="Fortnox-körningar" icon="refresh" actions={<BuildPhase fas={2} />}>
          <div className="flex flex-col gap-2">
            {v.fortnoxRuns.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-1.5">
                <Icon name="upload" />
                <span className="font-bold">{fmtDateTime(r.at)}</span>
                <span className="text-text-muted">{r.byName}</span>
                <Badge tone="bluetone" icon="check">
                  {plural(r.created, "skapad", "skapade")}
                </Badge>
                <Badge tone="outline" icon="copy">
                  {plural(r.skipped, "dubblett hoppades över", "dubbletter hoppades över")}
                </Badge>
                {r.blocked > 0 && (
                  <Badge tone="red" icon="x-circle">
                    {plural(r.blocked, "stoppad", "stoppade")}
                  </Badge>
                )}
              </div>
            ))}
            <div className="text-small text-text-muted">
              Idempotensnyckel: månad + ärendenummer (till exempel {mk}:{rows[0]?.caseNumber ?? "BOT-26-0001"}). Samma nyckel skapar aldrig en ny faktura.
            </div>
          </div>
        </Card>
      )}
      <DemoNote>
        Fortnox är simulerat. ”Skapa i Fortnox” sätter status ”Skapad i Fortnox (ej bokförd)” och ”Hämta status” flyttar fakturorna ett steg i taget. Priserna är exempel
        {v.priceSpan ? ` inom prislistans spann (${v.priceSpan} per vecka)` : ""}.
      </DemoNote>
      {openInv && (
        <InvoiceDetail
          month={mk}
          caseId={openInv.caseId}
          onClose={() => setOpenId(null)}
          onOpen={(id) => setOpenId(id)}
          onManual={(id) => {
            setOpenId(null);
            setManual({ presetId: id });
          }}
        />
      )}
      {manual && <ManualModal month={mk} invoices={rows} presetId={manual.presetId} onClose={() => setManual(null)} />}
    </Page>
  );
}

function Step({ n, done, children }: { n: number; done: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3.5 rounded-card border-[1.5px] border-ljusgra px-4 py-3.5", done && "bg-ljusgra-ton")}>
      <span
        className={cn(
          "grid size-[30px] flex-none place-items-center rounded-full border-2 border-antracit text-small font-extrabold",
          done && "border-bla bg-bla",
        )}
      >
        {done ? <Icon name="check" /> : n}
        {done && <span className="sr-only">Klart</span>}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2.5">{children}</div>
    </div>
  );
}
function StepText({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-1">
      <div className="font-bold">{title}</div>
      <div className="text-small">{children}</div>
    </div>
  );
}

function MonthRulesCard({ v }: { v: RunView & { month: string } }) {
  const coll = v.rules.collectiveAllowed;
  return (
    <Card title="Regler för körningen" icon="info">
      <div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1 [&>*]:min-w-0">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="font-bold">Veckan faktureras i den månad där torsdagen infaller</div>
          <div className="flex flex-wrap gap-1.5">
            {v.rules.weeks.map((k) => (
              <Badge key={k} tone="outline" icon="calendar">
                {fmtWeekKey(k)} · {fmtWeekRange(k)}
              </Badge>
            ))}
          </div>
          {v.rules.notes.map((n) => (
            <div key={n} className="text-small">
              {n}
            </div>
          ))}
          <div className="text-small text-text-muted">Varje vecka faktureras exakt en gång. Debiterbar vecka är varje vecka deltagaren är inskriven, utom pausade veckor.</div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="font-bold">{coll ? "Samlingsfaktura per beställarreferens är tillåten" : "En faktura per ärende och månad"}</div>
          <div className="text-small">
            {coll
              ? "Kommunen har skriftligt godkänt samlingsfakturor per beställarreferens."
              : `Samlingsfakturor är inte tillåtna enligt avtalet med ${v.customerName}. Varje ärende får en egen faktura med ärendenumret som faktureringsobjekt.`}
          </div>
          <div className="text-small">
            Utan giltig beställarreferens ({v.rules.refLen} siffror) kan ingen faktura skapas. Inköpsordernummer används bara om kommunen beställer via sin e-handel.
          </div>
        </div>
      </div>
    </Card>
  );
}

// ================================================================ Detalj: en faktura i körningen
function InvoiceDetail({ month, caseId, onClose, onOpen, onManual }: { month: string; caseId: string; onClose: () => void; onOpen: (id: string) => void; onManual: (id: string) => void }) {
  const q = useQuery(ekoInvoice, { month, caseId });
  const d = q.data;
  const title = d ? `Faktura ${d.inv.caseNumber}` : "Faktura";
  if (q.error) {
    return (
      <Modal className={WRAP} title={title} onClose={onClose}>
        <ErrorNotice error={q.error} />
      </Modal>
    );
  }
  if (d === undefined) {
    return (
      <Modal className={WRAP} title={title} onClose={onClose}>
        <Loading />
      </Modal>
    );
  }
  if (d === null) {
    return (
      <Modal className={WRAP} title={title} onClose={onClose}>
        <Empty icon="file" title="Ingen faktura att visa" />
      </Modal>
    );
  }
  return <InvoiceDetailBody d={d} onClose={onClose} onOpen={onOpen} onManual={onManual} />;
}

function InvoiceDetailBody({ d, onClose, onOpen, onManual }: { d: InvoiceDetailView; onClose: () => void; onOpen: (id: string) => void; onManual: (id: string) => void }) {
  const nav = useNav();
  const approveCmd = useCommand(billingApproveInvoice);
  const reissueCmd = useCommand(ekoReissue);
  const [checked, setChecked] = useState(false);
  const { inv, month } = d;
  const act = d.canAct;
  const rem = inv.checks.filter((c) => c.severity === "needs_approval" || c.severity === "warning");
  const pendingZero = inv.checks.filter((x) => x.kind === "zero_week" && x.severity === "needs_approval");
  const isDraft = inv.status === "draft";
  const canApprove = act && isDraft && !inv.blocked && !pendingZero.length && (!rem.length || checked);
  const approve = async () => {
    await approveCmd.run({ month, caseIds: [inv.caseId] });
    toast(`Fakturan för ${inv.caseNumber} är godkänd och klar för Fortnox.`);
  };
  const reissue = async () => {
    const r = await reissueCmd.run({ month, caseId: inv.caseId });
    if (!r.ok) toast("Rätta beställarreferensen innan du skapar en ny faktura.", "error");
    else toast(`Den returnerade fakturan för ${inv.caseNumber} är krediterad och en ny faktura är skapad i Fortnox (simulerat).`);
  };
  const why = inv.blocked
    ? "Fakturan är stoppad. Rätta beställarreferensen först."
    : pendingZero.length
      ? "Godkänn veckan utan närvaro först."
      : rem.length && !checked
        ? "Bekräfta att du har kontrollerat anmärkningarna."
        : "";
  const [pStart, pEnd] = periodOf(inv.weeks);
  const footer = (
    <>
      <Button kind="ghost" icon="file" onClick={() => nav.push(`/ekonomi/${month}/faktura/${encodeURIComponent(inv.caseId)}`)}>
        Förhandsgranska faktura
      </Button>
      <Button kind="ghost" icon="briefcase" onClick={() => nav.push(`/ekonomi/arende/${encodeURIComponent(inv.caseId)}`)}>
        Öppna ärendet
      </Button>
      {act && !inv.blocked && !BILLED.includes(inv.status) && inv.status !== "returned" && (
        <Button kind="secondary" icon="edit" onClick={() => onManual(inv.caseId)}>
          Markera som manuellt fakturerad
        </Button>
      )}
      {act && isDraft && (
        <Button kind="primary" icon="check" disabled={!canApprove} title={why || undefined} pending={approveCmd.pending} onClick={() => void approve()}>
          Godkänn fakturan
        </Button>
      )}
    </>
  );
  return (
    <Modal className={WRAP} wide title={`Faktura ${inv.caseNumber}`} onClose={onClose} footer={footer}>
      <div className="flex flex-wrap items-center gap-1.5">
        <InvStatus status={inv.status} />
        <span className="text-small text-text-muted">{monthLabel(month)} · en faktura per ärende och månad</span>
      </div>
      <Kv
        items={[
          ["Avtalsområde", `${inv.areaName} (artikel ${inv.articleNo || "–"})`],
          [
            "Veckor",
            <>
              {weekText(inv.weeks)}{" "}
              <span className="text-text-muted">
                ({fmtDateShort(pStart)}–{fmtDate(pEnd)})
              </span>
            </>,
          ],
          [
            "Belopp",
            <span key="b" className="tabular-nums">
              {inv.quantity} × {krExact(inv.unitPriceOre)} = <b>{krExact(inv.amountOre)}</b> exkl. moms
            </span>,
          ],
          ["Beställarreferens", <RefBadge key="r" value={inv.buyerReference} info={inv.ref} />],
          inv.fortnoxNo ? ["Fakturanummer i Fortnox", inv.fortnoxNo] : null,
          inv.manualInvoiceNo ? ["Manuellt fakturanummer", inv.manualInvoiceNo] : null,
        ]}
      />
      <SectionTitle>Kontroller</SectionTitle>
      {inv.checks.length === 0 ? (
        <Notice tone="ok" title="Inga anmärkningar">
          Referensen är giltig och alla veckor har närvaro.
        </Notice>
      ) : (
        <div>
          {inv.checks.map((ch, i) => (
            <CheckRow key={`${ch.kind}-${ch.label}-${i}`} d={d} ch={ch} onOpen={onOpen} />
          ))}
        </div>
      )}
      {inv.status === "returned" && (
        <Notice tone={inv.blocked ? "critical" : "warn"} title="Fakturan är returnerad av kommunen">
          <div className="flex flex-col gap-2">
            {inv.blocked
              ? "Rätta beställarreferensen ovan. Sedan krediterar du den returnerade fakturan och skapar en ny."
              : "Referensen är rättad. Kreditera den returnerade fakturan och skapa en ny med rätt referens."}
            {act && !inv.blocked && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button kind="primary" icon="refresh" pending={reissueCmd.pending} onClick={() => void reissue()}>
                  Kreditera och skapa ny faktura
                </Button>
                <BuildPhase fas={2} />
              </div>
            )}
          </div>
        </Notice>
      )}
      {d.credit && (
        <Notice tone="ok" title="Krediterad och fakturerad på nytt">
          Kreditfaktura och ny faktura skapades {fmtDateTime(d.credit.at)} med referens {d.credit.reference}.
        </Notice>
      )}
      {act && isDraft && !inv.blocked && !pendingZero.length && rem.length > 0 && (
        <Check id={`eko-rem-${inv.caseId}`} checked={checked} onCheckedChange={setChecked}>
          Jag har kontrollerat anmärkningarna. Fakturan ska skickas som den är.
        </Check>
      )}
      {act && why && isDraft && <p className="text-small text-text-muted">{why}</p>}
      <SectionTitle>Upparbetat och återstående</SectionTitle>
      <SummaryList inv={inv} sm={d.summary} />
    </Modal>
  );
}

function CheckRow({ d, ch, onOpen }: { d: InvoiceDetailView; ch: InvoiceCheckView; onOpen: (id: string) => void }) {
  const m = CHECK[ch.severity] ?? CHECK.info;
  return (
    <div className="flex items-start gap-3 border-t border-ljusgra py-3.5 first:border-t-0 first:pt-1">
      <Icon name={m.icon} size="lg" className={ch.severity === "blocking" ? "text-rod" : undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold">{ch.label}</span>
          <Badge tone={m.tone}>{m.word}</Badge>
        </div>
        <div className="text-small">{ch.text}</div>
        {ch.kind === "buyer_ref" && <RefForm cases={[d.case]} task={d.task} rules={d.refRules} canAct={d.canAct} idSuffix={`detail-${d.case.caseId}`} />}
        {ch.kind === "zero_week" && <ZeroWeek d={d} ch={ch} />}
        {ch.kind === "overlap" && <OverlapInfo d={d} ch={ch} onOpen={onOpen} />}
        {ch.kind === "paused" && (
          <div className="text-small text-text-muted">
            Orsaken till uppehållet visas inte för ekonom. Fakturan tar bara med de veckor som inte är pausade: {weekText(d.inv.weeks)}.
          </div>
        )}
      </div>
    </div>
  );
}

function ZeroWeek({ d, ch }: { d: InvoiceDetailView; ch: InvoiceCheckView }) {
  const approveZero = useCommand(billingApproveZeroWeek);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const inv = d.inv;
  const w = inv.weeks.find((x) => x.key === ch.weekKey);
  const id = `eko-zero-${inv.caseId}-${ch.weekKey}`;
  const err = note.trim().length < 5 ? "Skriv en kort kommentar (minst 5 tecken). Den sparas i revisionsloggen." : null;
  const facts = w ? (
    <div className="text-small">
      {fmtWeekRange(w.key)}: {plural(w.planned, "planerat tillfälle", "planerade tillfällen")}, {w.registered} {pl(w.registered, "registrerat", "registrerade")}, {w.attended} med
      närvaro. Inskriven {w.enrolledDays} av 7 dagar.
    </div>
  ) : null;
  if (ch.severity === "approved") {
    const a = ch.approval;
    return (
      <Quote>
        {facts}
        <span className="text-small">
          <b>Godkänd</b> av {a?.byName ?? "–"} {fmtDateTime(a?.at)}: ”{a?.note}”
        </span>
      </Quote>
    );
  }
  if (!d.canAct) return facts;
  const save = async () => {
    setTried(true);
    if (err || !ch.weekKey) return;
    await approveZero.run({ month: d.month, caseId: inv.caseId, weekKey: ch.weekKey, note: note.trim() });
    toast(`${fmtWeekKey(ch.weekKey)} för ${inv.caseNumber} är godkänd för fakturering.`);
  };
  return (
    <FixBox>
      {facts}
      <Field
        id={id}
        label="Kommentar till godkännandet"
        required
        error={tried ? err : undefined}
        help="Varför ska veckan faktureras? Skriv inga uppgifter om deltagarens hälsa eller frånvaroskäl. Exempel: Kontrollerat med samordnaren – inskriven hela veckan enligt beställningen."
      >
        <TextArea rows={2} value={note} onValueChange={setNote} invalid={tried && !!err} />
      </Field>
      <div>
        <Button kind="primary" icon="check" pending={approveZero.pending} onClick={() => void save()}>
          Godkänn veckan för fakturering
        </Button>
      </div>
    </FixBox>
  );
}

function OverlapInfo({ d, ch, onOpen }: { d: InvoiceDetailView; ch: InvoiceCheckView; onOpen: (id: string) => void }) {
  const ask = useCommand(ekoAskCoordinator);
  const o = d.overlaps[ch.label];
  if (!o) return null;
  const send = async () => {
    const r = await ask.run({ month: d.month, caseId: d.inv.caseId, otherCaseId: o.caseId });
    if (r.ok) toast("Frågan är skickad till samordnaren. Den innehåller bara ärendenummer.");
    else toast(r.message ?? "Frågan kunde inte skickas.", "error");
  };
  return (
    <FixBox>
      <div className="flex flex-wrap items-center gap-1.5 text-small">
        <span>Det andra ärendet:</span>
        <span className="font-bold tabular-nums">{o.caseNumber}</span>
        {o.status && <InvStatus status={o.status} />}
        <span className="text-text-muted">{o.endDate ? `avslutat ${fmtDate(o.endDate)}` : `start ${fmtDate(o.startDate)}`}</span>
      </div>
      <div className="text-small">Godkänn bara den faktura som ska ta med veckan. Är du osäker – fråga samordnaren, som ser båda ärendena.</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {o.status && (
          <Button kind="secondary" icon="arrow-right" onClick={() => onOpen(o.caseId)}>
            Visa {o.caseNumber}
          </Button>
        )}
        {d.canAct &&
          (o.askedAt ? (
            <Badge tone="bluetone" icon="send">
              Fråga skickad till samordnaren {fmtDateTime(o.askedAt)}
            </Badge>
          ) : (
            <Button kind="secondary" icon="message" pending={ask.pending} onClick={() => void send()}>
              Fråga samordnaren
            </Button>
          ))}
      </div>
    </FixBox>
  );
}

// ---- Reservväg: markera som manuellt fakturerad
function ManualModal({ month, invoices, presetId, onClose }: { month: string; invoices: readonly InvoiceRow[]; presetId: string | null; onClose: () => void }) {
  const markManual = useCommand(billingMarkManual);
  const options = invoices.filter((x) => !x.blocked && !BILLED.includes(x.status) && x.status !== "returned");
  const [caseId, setCaseId] = useState(presetId && options.some((o) => o.caseId === presetId) ? presetId : "");
  const [no, setNo] = useState("");
  const [tried, setTried] = useState(false);
  const errCase = !caseId ? "Välj vilket ärende fakturan gäller." : null;
  const errNo = !/^\d{3,10}$/.test(no.trim()) ? "Skriv fakturanumret med 3–10 siffror, utan mellanslag." : null;
  const save = async () => {
    setTried(true);
    if (errCase || errNo) return;
    const inv = options.find((o) => o.caseId === caseId);
    await markManual.run({ month, caseId, invoiceNo: no.trim() });
    toast(`${inv?.caseNumber ?? ""} är markerad som manuellt fakturerad med fakturanummer ${no.trim()}. Den skapas inte i Fortnox igen.`);
    onClose();
  };
  return (
    <Modal className={WRAP}
      title="Markera som manuellt fakturerad"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="check" pending={markManual.pending} onClick={() => void save()}>
            Spara
          </Button>
        </>
      }
    >
      <p>
        Använd reservvägen när fakturan har registrerats för hand i Fortnox eller i kommunens kostnadsfria fakturaportal. Fakturanumret sparas så att samma vecka inte faktureras
        två gånger.
      </p>
      <Field id="eko-manual-case" label="Ärende" required help="Stoppade och redan fakturerade ärenden går inte att välja." error={tried ? errCase : undefined}>
        <Select
          value={caseId}
          onValueChange={setCaseId}
          placeholder="Välj ärende"
          invalid={tried && !!errCase}
          options={options.map((o) => ({ value: o.caseId, label: `${o.caseNumber} · ${weekText(o.weeks)} · ${kr(o.amountOre)}` }))}
        />
      </Field>
      <Field id="eko-manual-no" label="Fakturanummer" required help="Numret från Fortnox eller från kommunens fakturaportal." error={tried ? errNo : undefined}>
        <Input value={no} onValueChange={setNo} inputMode="numeric" maxLength={10} invalid={tried && !!errNo} />
      </Field>
    </Modal>
  );
}

