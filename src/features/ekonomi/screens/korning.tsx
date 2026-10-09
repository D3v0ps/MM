"use client";
// Fakturakörningen för en månad (prototypens eko.korning): regler, stegen i körningen, månadens fakturor med en rad per ärende,
// detaljen per rad (kontroller och åtgärder), reservvägen (export och manuellt fakturerad) och Fortnox-körningarna.
// Beslut 2026-10-07 (Karim, synpunkt #13): en faktura per avtal och månad med en rad per ärende. Ekonomen fyller i
// beställarreferensen (en per faktura), godkänner fakturan och skapar den i Fortnox. Veckor som registreras efter att
// fakturan skapats kommer på en tilläggsfaktura för samma månad.
import { useEffect, useState, type ReactNode } from "react";
import { useCommand, useQuery, useQueryRunner } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { useRuntime } from "@/shell/runtime";
import { useQueryPatch } from "@/shell/url-state";
import type { ScreenProps } from "@/shell/routes";
import { fmtDate, fmtDateShort, fmtDateTime, fmtWeekKey, fmtWeekRange, monthName } from "@/core/time";
import { kr, krExact, num } from "@/core/format";
import {
  Badge, BuildPhase, Button, Card, Check, cn, DemoNote, Empty, ErrorNotice, Field, focusSection, Icon, Input, Kv, Loading, Modal, Notice, Page, Select, SlaBadge, Table, Tabs, TextArea,
  ModalCancelButton, useConfirm, useDownload, useModalDirty, toast, type Column,
} from "@/ui";
import {
  billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox, ekoAskCoordinator, ekoCloseRun, ekoCsv, ekoFortnoxSync, ekoLine,
  ekoReissue, ekoRun, FORTNOX_OFF_TEXT, type InvoiceCheckView, type InvoiceView, type LineDetailView, type LineRow, type RunView,
} from "../api";
import { BILLED, monthLabel, periodOf, pl, plural, weekText } from "../model";
import {
  CHECK, CheckIcons, EkoKpi, EkoKpis, FixBox, InvoicePoForm, InvoiceRefForm, InvStatus, PAGE_SIZE, Pager, Quote, RefBadge, RoleNotice, SectionTitle, SummaryList, WRAP,
} from "./parts";

type Filter = "alla" | "anmarkning" | "godkannande";
const FILTERS: readonly Filter[] = ["alla", "anmarkning", "godkannande"];
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
      filter={FILTERS.includes(f as Filter) ? (f as Filter) : "alla"}
      initialOpen={query.get("arende")}
    />
  );
}

/** Rader som kräver godkännande först (vecka utan närvaro), sedan med anmärkning, sedan på ärendenummer. */
const lineOrder = (a: LineRow, x: LineRow) => (x.needsApproval ? 1 : 0) - (a.needsApproval ? 1 : 0) || (x.remarks ? 1 : 0) - (a.remarks ? 1 : 0) || (a.caseNumber < x.caseNumber ? -1 : 1);

function Korning({ v, crumbs, filter, initialOpen }: { v: RunView & { month: string }; crumbs: { label: string; to?: string }[]; filter: Filter; initialOpen: string | null }) {
  const nav = useNav();
  const patch = useQueryPatch();
  const confirm = useConfirm();
  const download = useDownload();
  const runQuery = useQueryRunner();
  // Prototypen säger "simulerat"; appen säger vad som hände (statusen), utan utvecklartext.
  const demo = useRuntime() === "demo";
  // Fortnox-porten finns (minnesläget: simulerad – knapparna sätter statusen i Miljonmatch). I supabase-läget saknas den tills
  // en riktig klient finns: då döljs "Skapa i Fortnox" och "Hämta status" och ekonomen markerar fakturan som manuellt fakturerad.
  const fortnox = v.fortnox.connected;
  // Fliken ligger i adressen (?filter=, replace): Tillbaka och omladdning visar samma urval.
  const [arrivedWithFilter] = useState(() => filter !== "alla" && nav.entry?.kind === "push");
  useEffect(() => {
    if (arrivedWithFilter) focusSection("fakturor");
  }, [arrivedWithFilter]);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [manual, setManual] = useState<{ presetId: string | null } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const approveInvoice = useCommand(billingApproveInvoice);
  const sendFortnox = useCommand(billingSendFortnox);
  const fortnoxSync = useCommand(ekoFortnoxSync);
  const exportCmd = useCommand(billingExport);
  const closeRunCmd = useCommand(ekoCloseRun);

  const mk = v.month;
  const act = v.canAct;
  const invoices = v.invoices;
  const open = invoices.filter((x) => !x.created);
  const blocked = open.filter((x) => x.blocked);
  const toApprove = open.filter((x) => !x.approved && x.lines.length);
  const approved = open.filter((x) => (x.status === "approved" || (x.blocked && x.approved)) && !x.needsApproval);
  const fresh = approved.filter((x) => !x.blocked);
  const already = invoices.filter((x) => BILLED.includes(x.status));
  const toSync = invoices.filter((x) => ["fortnox_created", "booked", "sent"].includes(x.status));
  const allDone = invoices.length > 0 && invoices.every((x) => BILLED.includes(x.status));
  const allLines = invoices.flatMap((x) => x.lines);
  const pendingZero = open.flatMap((x) => x.lines).filter((l) => l.needsApproval);
  const withRemarks = open.flatMap((x) => x.lines).filter((l) => l.remarks > 0);

  const setF = (x: Filter) => patch({ filter: x === "alla" ? null : x });
  const showFilter = (x: Filter) => {
    setF(x);
    requestAnimationFrame(() => focusSection("fakturor"));
  };
  // Granskningskön i raddialogen: raderna som kräver godkännande eller har anmärkning, i tabellens ordning. Fryses när
  // dialogen öppnas, så att "3 av 8" och Nästa fungerar också när en vecka har godkänts.
  const reviewIds = () => open.flatMap((x) => x.lines).filter((l) => l.needsApproval || l.remarks).sort(lineOrder).map((l) => l.caseId);
  const [queue, setQueue] = useState<string[]>(() => (initialOpen ? reviewIds() : []));
  const openLine = (id: string) => {
    setQueue(reviewIds());
    setOpenId(id);
  };

  const approve = async (inv: InvoiceView) => {
    const r = await approveInvoice.run({ month: mk, invoiceId: inv.id });
    if (r.ok) toast(`${inv.title} är godkänd (${plural(r.lines, "rad", "rader")}).`);
    else toast(r.message ?? "Fakturan kunde inte godkännas.", "error");
  };
  const createInFortnox = async () => {
    const notReady = toApprove.length;
    const ok = await confirm({
      title: "Skapa fakturor i Fortnox",
      confirmLabel: fresh.length ? `Skapa ${plural(fresh.length, "faktura", "fakturor")}` : "Kör ändå",
      body: (
        <div className="flex flex-col gap-2">
          <p>
            {fresh.length
              ? `${plural(fresh.length, "godkänd faktura", "godkända fakturor")} skapas som ${pl(fresh.length, "ej bokfört utkast", "ej bokförda utkast")} i Fortnox. Raderna låses – veckor som registreras senare kommer på en tilläggsfaktura.`
              : "Det finns inga nya godkända fakturor att skapa."}
          </p>
          <ul className="m-0 list-disc pl-5">
            <li>
              {plural(already.length, "faktura finns", "fakturor finns")} redan i Fortnox eller är {pl(already.length, "manuellt fakturerad", "manuellt fakturerade")} och hoppas över. En
              omkörning skapar inga dubbletter.
            </li>
            <li>{plural(blocked.length, "stoppad faktura", "stoppade fakturor")} kan inte skapas.</li>
            <li>{plural(notReady, "faktura som inte är godkänd", "fakturor som inte är godkända")} tas inte med.</li>
          </ul>
          <p className="text-text-muted">
            {demo ? "I den riktiga tjänsten skickas anropen" : "Anropen skickas"} i takt med Fortnox gräns (25 anrop per 5 sekunder) och varje faktura får
            idempotensnyckeln avtal + månad + faktura.
          </p>
        </div>
      ),
    });
    if (!ok) return;
    const r = await sendFortnox.run({ month: mk, invoiceIds: invoices.map((x) => x.id) });
    if (!r.ok) {
      toast(r.message ?? "Fakturorna kunde inte skapas.", "error");
      return;
    }
    toast(
      r.created.length
        ? demo
          ? `${plural(r.created.length, "faktura", "fakturor")} skapades i Fortnox som ${pl(r.created.length, "ej bokfört utkast", "ej bokförda utkast")} (simulerat). Inga dubbletter.`
          : `${plural(r.created.length, "faktura", "fakturor")} har fått status ”Skapad i Fortnox (ej bokförd)”. Inga dubbletter.`
        : `Inga nya fakturor. ${plural(r.skipped.length, "faktura", "fakturor")} fanns redan – inga dubbletter skapades.`,
    );
  };
  const sync = async () => {
    const r = await fortnoxSync.run({ month: mk });
    const moved = plural(r.ok ? r.changed : 0, "faktura", "fakturor");
    toast(demo ? `Status hämtad från Fortnox (simulerat): ${moved} gick vidare ett steg.` : `Status hämtad: ${moved} gick vidare ett steg.`);
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
    const r = await closeRunCmd.run({ month: mk });
    if (r.ok) toast(`Fakturakörningen för ${monthName(mk)} är stängd.`);
    else toast(r.message ?? "Körningen kunde inte stängas.", "error");
  };

  const step1Done = blocked.length === 0;
  const step2Done = toApprove.length === 0;
  const step3Done = allDone;
  const openLineRow = openId ? allLines.find((l) => l.caseId === openId) : null;
  // Månadsväljaren: körningarna som finns, plus den visade månaden om den saknas (tom databas). En enda månad behöver ingen väljare.
  const monthOptions = (() => {
    const opts = v.runs.map((r) => ({ value: r.month, label: `${monthLabel(r.month)}${r.status === "draft" ? " (pågår)" : ""}` }));
    return opts.some((o) => o.value === mk) ? opts : [{ value: mk, label: monthLabel(mk) }, ...opts];
  })();
  // En stängd körning skickar inget mer till Fortnox – knapparna visas inte.
  const closedRun = v.run?.status === "closed";

  return (
    <Page className={WRAP}
      title={`Fakturakörning ${monthName(mk)}`}
      eyebrow={`Fakturering · ${v.customerName}`}
      crumbs={crumbs}
      lead={
        v.rules.perContract
          ? `En faktura för avtalet och månaden med en rad per ärende. Fyll i beställarreferensen, granska raderna med anmärkning, godkänn och ${fortnox ? "skapa fakturan i Fortnox" : "markera fakturan som manuellt fakturerad när den är skapad i Fortnox"}.`
          : `En faktura per ärende och månad. Fyll i beställarreferensen, granska anmärkningarna, godkänn och ${fortnox ? "skapa fakturorna i Fortnox" : "markera fakturorna som manuellt fakturerade när de är skapade i Fortnox"}.`
      }
      actions={
        monthOptions.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor="eko-month" className="text-small font-bold">
              Månad
            </label>
            <div className="w-[210px] max-w-full">
              <Select id="eko-month" value={mk} options={monthOptions} onValueChange={(x) => nav.replace(`/ekonomi/${x}`)} />
            </div>
          </div>
        ) : undefined
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
        <EkoKpi label="Fakturor" value={num(invoices.length)} sub={`${plural(v.count, "rad", "rader")} · en rad per ärende`} />
        <EkoKpi label="Belopp exkl. moms" value={kr(v.totalOre)} sub={`Inkl. moms ${kr(v.totalOre + v.vatOre)}`} />
        <EkoKpi label="Veckor" value={num(v.weeks)} sub={`${plural(v.calendarWeeks, "kalendervecka", "kalenderveckor")} i månaden`} />
        <EkoKpi
          label="Stoppade"
          value={num(blocked.length)}
          tone={blocked.length ? "alert" : null}
          statusText="Fyll i referensen"
          sub={blocked.length ? "Kan inte skapas utan giltig beställarreferens" : "Inga stoppade"}
        />
        <EkoKpi
          label="Att godkänna"
          value={num(pendingZero.length)}
          tone={pendingZero.length ? "watch" : null}
          statusText="Granska"
          sub={`${plural(pendingZero.length, "vecka", "veckor")} utan närvaro · ${plural(withRemarks.length, "rad", "rader")} med anmärkning`}
        />
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
            <span className="text-text-muted">Registrera för hand i Fortnox eller i kommunens kostnadsfria fakturaportal.</span>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          <Step n={1} done={step1Done}>
            <StepText title="Fyll i beställarreferensen">
              {blocked.length
                ? `${plural(blocked.length, "faktura saknar", "fakturor saknar")} giltig beställarreferens och kan inte skapas. Miljonbemanning fyller i referensen – en per faktura.`
                : "Alla fakturor har giltig beställarreferens."}
            </StepText>
            {act &&
              blocked.map((inv) =>
                inv.checks.some((c) => c.kind === "buyer_ref") ? (
                  <div key={inv.id} className="flex w-full flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-small">
                      <span className="font-bold">{inv.title}</span>
                      <RefBadge value={inv.buyerReference} info={inv.ref} />
                    </div>
                    <InvoiceRefForm inv={inv} rules={v.refRules} canAct={act} idSuffix={`steg-${inv.groupingKey}`} />
                  </div>
                ) : (
                  <div key={inv.id} className="w-full text-small">
                    <b>{inv.title}:</b> {inv.checks.map((c) => c.text).join(" ")}
                  </div>
                ),
              )}
          </Step>
          <Step n={2} done={step2Done}>
            <StepText title="Granska raderna och godkänn">
              {pendingZero.length ? `${plural(pendingZero.length, "vecka utan närvaro", "veckor utan närvaro")} ska godkännas först. ` : ""}
              {withRemarks.length ? `${plural(withRemarks.length, "rad", "rader")} har anmärkning – kontrollera dem innan du godkänner. ` : ""}
              {!toApprove.length ? "Inga fakturor väntar på godkännande." : ""}
            </StepText>
            <div className="flex w-full flex-col gap-2">
              {toApprove.map((inv) => {
                const remarks = inv.lines.some((l) => l.remarks > 0);
                const can = act && !inv.needsApproval && (!remarks || checked[inv.id]);
                return (
                  <div key={inv.id} className="flex flex-col gap-1.5">
                    {act && !inv.needsApproval && remarks && (
                      <Check id={`eko-rem-${inv.groupingKey}`} checked={!!checked[inv.id]} onCheckedChange={(x) => setChecked((c) => ({ ...c, [inv.id]: x }))}>
                        Jag har kontrollerat anmärkningarna på raderna i {inv.title.charAt(0).toLowerCase()}{inv.title.slice(1)}. Fakturan ska skickas som den är.
                      </Check>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {act && (
                        <Button
                          kind="primary"
                          icon="check"
                          className="text-left whitespace-normal"
                          disabled={!can}
                          title={inv.needsApproval ? "Godkänn veckorna utan närvaro först." : remarks && !checked[inv.id] ? "Bekräfta att du har kontrollerat anmärkningarna." : undefined}
                          pending={approveInvoice.pending}
                          onClick={() => void approve(inv)}
                        >
                          Godkänn {inv.title.charAt(0).toLowerCase()}{inv.title.slice(1)}
                        </Button>
                      )}
                      {inv.needsApproval && (
                        <Button kind="secondary" icon="filter" className="text-left whitespace-normal" onClick={() => showFilter("godkannande")}>
                          Visa veckorna utan närvaro
                        </Button>
                      )}
                      {remarks && (
                        <Button kind="secondary" icon="filter" className="text-left whitespace-normal" onClick={() => showFilter("anmarkning")}>
                          Visa raderna med anmärkning
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Step>
          <Step n={3} done={step3Done}>
            <StepText
              title={
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold">Skapa i Fortnox</span>
                  {/* Knappen fungerar (sätter statusen) – bara prototypen visar utvecklingsfasen. */}
                  <BuildPhase fas={2} />
                </span>
              }
            >
              {fortnox ? (
                <>
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
                </>
              ) : (
                <>
                  {/* Ingen koppling: inga knappar som ser ut att skicka något. Lugn ruta med text och ikon; reservvägen finns i kortets fot. */}
                  {already.length
                    ? `${plural(already.length, "faktura är redan skapad eller manuellt fakturerad", "fakturor är redan skapade eller manuellt fakturerade")}. `
                    : ""}
                  <Notice tone="info" className="mt-1">
                    {FORTNOX_OFF_TEXT}
                  </Notice>
                </>
              )}
            </StepText>
            <div className="flex flex-wrap items-center gap-1.5">
              {act && fortnox && !closedRun && (
                <Button
                  kind="primary"
                  icon="upload"
                  className="text-left whitespace-normal"
                  disabled={!fresh.length && !already.length}
                  pending={sendFortnox.pending}
                  onClick={() => void createInFortnox()}
                >
                  Skapa i Fortnox ({fresh.length})
                </Button>
              )}
              {act && fortnox && !closedRun && toSync.length > 0 && (
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
      <section id="fakturor" aria-label={`Fakturor ${monthName(mk)}`} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        {invoices.length === 0 && (
          <Card title={`Fakturor ${monthName(mk)}`} icon="file">
            <Empty icon="file" title="Inga fakturor">Inga debiterbara veckor i {monthName(mk)}.</Empty>
          </Card>
        )}
        {invoices.map((inv) => (
          <InvoiceCard key={inv.id} v={v} inv={inv} filter={filter} onFilter={setF} onOpenLine={openLine} openId={openId} />
        ))}
      </section>
      {fortnox && v.fortnoxRuns.length > 0 && (
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
                  <Badge tone="outline" icon="x-circle" className="[&_svg]:text-rod">
                    {plural(r.blocked, "stoppad", "stoppade")}
                  </Badge>
                )}
              </div>
            ))}
            <div className="text-small text-text-muted">Idempotensnyckel: avtal + månad + faktura. Samma nyckel skapar aldrig en ny faktura.</div>
          </div>
        </Card>
      )}
      <DemoNote>
        Fortnox är simulerat. ”Skapa i Fortnox” sätter status ”Skapad i Fortnox (ej bokförd)” och ”Hämta status” flyttar fakturorna ett steg i taget. Priserna är exempel
        {v.priceSpan ? ` inom prislistans spann (${v.priceSpan} per vecka)` : ""}.
      </DemoNote>
      {openLineRow && <LineDetail month={mk} caseId={openLineRow.caseId} queue={queue} onClose={() => setOpenId(null)} onOpen={(id) => setOpenId(id)} />}
      {manual && <ManualModal month={mk} invoices={invoices} presetId={manual.presetId} onClose={() => setManual(null)} />}
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
      <div>{children}</div>
    </div>
  );
}

function MonthRulesCard({ v }: { v: RunView & { month: string } }) {
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
            <div key={n}>{n}</div>
          ))}
          <div className="text-text-muted">Varje vecka faktureras exakt en gång. Debiterbar vecka är varje vecka deltagaren är inskriven, utom pausade veckor.</div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="font-bold">{v.rules.perContract ? "En faktura per månad med en rad per ärende" : "En faktura per ärende och månad"}</div>
          <div>
            {v.rules.perContract
              ? `${v.customerName} får en faktura för avtalet och månaden. Varje ärende är en egen rad med ärendenumret som faktureringsobjekt. Veckor som registreras efter att fakturan skapats kommer på en tilläggsfaktura.`
              : `Varje ärende får en egen faktura med ärendenumret som faktureringsobjekt.`}
          </div>
          <div>
            Miljonbemanning fyller i beställarreferensen ({v.rules.refLen} siffror), en per faktura. Utan giltig referens kan ingen faktura skapas. Inköpsordernummer används bara om
            kommunen beställer via sin e-handel ({v.rules.poText}).
          </div>
        </div>
      </div>
    </Card>
  );
}

// ================================================================ En faktura: huvud, referens, inköpsordernummer och rader
function InvoiceCard({
  v, inv, filter, onFilter, onOpenLine, openId,
}: { v: RunView & { month: string }; inv: InvoiceView; filter: Filter; onFilter: (f: Filter) => void; onOpenLine: (caseId: string) => void; openId: string | null }) {
  const nav = useNav();
  const demo = useRuntime() === "demo";
  const reissueCmd = useCommand(ekoReissue);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editRef, setEditRef] = useState(false);
  const act = v.canAct;
  const needle = search.trim().toUpperCase();
  const counts = {
    alla: inv.lines.length,
    anmarkning: inv.lines.filter((l) => l.remarks > 0).length,
    godkannande: inv.lines.filter((l) => l.needsApproval).length,
  };
  const list = inv.lines
    .filter((l) => (filter === "alla" || (filter === "anmarkning" && l.remarks > 0) || (filter === "godkannande" && l.needsApproval)) && (!needle || l.caseNumber.includes(needle)))
    .sort(lineOrder);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const shown = list.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const sumQty = list.reduce((s, x) => s + x.quantity, 0);
  const sumAmount = list.reduce((s, x) => s + x.amountOre, 0);
  const editable = !inv.created || inv.status === "returned";
  const refProblem = inv.checks.find((c) => c.kind === "buyer_ref");
  const reissue = async () => {
    const r = await reissueCmd.run({ month: inv.month, invoiceId: inv.id });
    if (!r.ok) toast(r.message ?? "Rätta beställarreferensen innan du skapar en ny faktura.", "error");
    else if (!r.reissued) toast(`${inv.title} är krediterad. Inga veckor återstår att fakturera, så ingen ny faktura skapades.`);
    else toast(`${inv.title} är krediterad och en ny faktura är skapad${demo ? " i Fortnox (simulerat)" : ""}.`);
  };
  const columns: Column<LineRow>[] = [
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
    { key: "checks", label: "Kontroller", render: (r) => (r.frozen ? <span className="text-small text-text-muted">Låst</span> : <CheckIcons checks={r.checks} column />) },
  ];
  return (
    <Card
      title={inv.title}
      icon="file"
      flush
      actions={
        <Button kind="ghost" icon="file" onClick={() => nav.push(`/ekonomi/${inv.month}/faktura?faktura=${encodeURIComponent(inv.id)}`)}>
          Förhandsgranska
        </Button>
      }
      foot={<Pager page={pg} total={list.length} onPage={setPage} />}
    >
      <div className="flex flex-col gap-3 px-[18px] pt-3.5 pb-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <InvStatus status={inv.status} />
          <span className="text-small text-text-muted">
            {plural(inv.lines.length, "rad", "rader")} · {plural(inv.quantity, "vecka", "veckor")} · {kr(inv.amountOre)} exkl. moms · {kr(inv.amountOre + inv.vatOre)} inkl. moms
          </span>
        </div>
        <Kv
          items={[
            [
              "Beställarreferens",
              <span key="r" className="flex flex-wrap items-center gap-1.5">
                <RefBadge value={inv.buyerReference} info={inv.ref} />
                {act && editable && !refProblem && (
                  <Button kind="ghost" icon="edit" ariaPressed={editRef} onClick={() => setEditRef(!editRef)}>
                    Ändra referensen
                  </Button>
                )}
              </span>,
            ],
            ["Inköpsordernummer", inv.purchaseOrderNumber ? <span className="tabular-nums">{inv.purchaseOrderNumber}</span> : "Tomt – kommunen beställer utanför e-handeln"],
            inv.fortnoxNo ? ["Fakturanummer i Fortnox", inv.fortnoxNo] : null,
            inv.manualInvoiceNo ? ["Manuellt fakturanummer", inv.manualInvoiceNo] : null,
            inv.approved ? ["Godkänd", `${inv.approved.byName} ${fmtDateTime(inv.approved.at)}`] : null,
          ]}
        />
        {inv.checks.filter((c) => c.kind !== "buyer_ref").map((c) => (
          <Notice key={c.kind} tone="critical" title={c.label}>
            {c.text}
          </Notice>
        ))}
        {act && editable && (refProblem || editRef) && inv.status !== "returned" && !inv.blocked && (
          <InvoiceRefForm inv={inv} rules={v.refRules} canAct={act} idSuffix={`kort-${inv.groupingKey}`} onDone={() => setEditRef(false)} />
        )}
        {act && !inv.created && <InvoicePoForm key={`${inv.id}:${inv.purchaseOrderNumber}`} inv={inv} rules={v.refRules} idSuffix={inv.groupingKey} />}
        {inv.status === "returned" && (
          <Notice tone={inv.blocked ? "critical" : "warn"} title="Fakturan är returnerad av kommunen">
            <div className="flex flex-col gap-2">
              {inv.blocked
                ? "Fyll i rätt beställarreferens. Sedan krediterar du den returnerade fakturan och skapar en ny. Raderna räknas på nytt från dagens underlag."
                : "Referensen är rättad. Kreditera den returnerade fakturan och skapa en ny med rätt referens. Raderna räknas på nytt från dagens underlag – en vecka som inte längre är debiterbar faktureras inte igen."}
              {act && inv.blocked && <InvoiceRefForm inv={inv} rules={v.refRules} canAct={act} idSuffix={`retur-${inv.groupingKey}`} />}
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
        {inv.credit && (
          <Notice tone="ok" title="Krediterad och fakturerad på nytt">
            Kreditfaktura och ny faktura skapades {fmtDateTime(inv.credit.at)} med referens {inv.credit.reference}.
          </Notice>
        )}
        <SectionTitle>Rader</SectionTitle>
        <Tabs<Filter>
          ariaLabel={`Filter för raderna i ${inv.title}`}
          active={filter}
          onChange={(x) => {
            onFilter(x);
            setPage(0);
          }}
          tabs={[
            { id: "alla", label: "Alla", count: counts.alla },
            { id: "anmarkning", label: "Med anmärkning", count: counts.anmarkning, icon: "alert-circle" },
            { id: "godkannande", label: "Kräver godkännande", count: counts.godkannande, icon: "clock" },
          ]}
        />
        <div className="max-w-[460px]">
          <Field id={`eko-search-${inv.groupingKey}`} label="Sök ärendenummer" help="Till exempel 0143 eller BOT-26-0143. Klicka på en rad för kontroller och åtgärder.">
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
      {/* Sju kolumner i 16 px: smalare utfyllnad mellan kolumnerna så att tabellen inte rullar i sidled vid 1280 px. */}
      <div className="max-[620px]:hidden [&_td]:px-1.5 [&_td:first-child]:pl-4 [&_th]:px-1.5 [&_th]:align-bottom [&_th]:whitespace-normal [&_th:first-child]:pl-4">
        <Table
          caption={`Rader – ${inv.title}`}
          columns={columns}
          rows={shown}
          rowKey="caseId"
          onRowClick={(r) => onOpenLine(r.caseId)}
          rowTone={(r) => (r.needsApproval ? "alert" : openId === r.caseId ? "selected" : null)}
          empty={filter === "godkannande" ? "Inga veckor utan närvaro väntar på godkännande." : filter === "anmarkning" ? "Inga rader med anmärkning." : "Inga rader matchar sökningen."}
          footer={
            list.length > 0 && (
              <tr>
                <td colSpan={3}>Summa ({plural(list.length, "rad", "rader")})</td>
                <td className="text-right tabular-nums">{sumQty}</td>
                <td />
                <td className="text-right whitespace-nowrap tabular-nums">{kr(sumAmount)}</td>
                <td />
              </tr>
            )
          }
        />
      </div>
      {/* Under 620 px: lista i stället för tabell (samma innehåll). */}
      <div className="hidden flex-col border-t-2 border-antracit max-[620px]:flex">
        {shown.length === 0 && <div className="border-b border-ljusgra px-[18px] py-3 text-text-muted">Inga rader att visa.</div>}
        {shown.map((r) => (
          <button
            type="button"
            key={r.caseId}
            onClick={() => onOpenLine(r.caseId)}
            className={cn(
              "flex w-full cursor-pointer items-start gap-3 border-0 border-b border-ljusgra bg-transparent px-[18px] py-3 text-left hover:bg-ljusgra-ton",
              r.needsApproval && "shadow-[inset_4px_0_0_var(--color-rod)]",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="font-bold tabular-nums">{r.caseNumber}</span>
              <span className="text-small">
                {r.areaName} · {weekText(r.weeks)}
              </span>
              <span className="text-small">
                {r.quantity} × {kr(r.unitPriceOre)} = <b>{kr(r.amountOre)}</b>
              </span>
              {!r.frozen && r.checks.some((x) => x.severity !== "info") && <CheckIcons checks={r.checks} />}
            </span>
            <Icon name="chevron-right" className="self-center" />
          </button>
        ))}
        {list.length > 0 && (
          <div className="flex items-start gap-3 border-b border-ljusgra px-[18px] py-3">
            <span className="flex-1 font-bold">Summa ({plural(list.length, "rad", "rader")})</span>
            <span className="font-bold whitespace-nowrap">{kr(sumAmount)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ================================================================ Detalj: en rad (ett ärende) i körningen
function LineDetail({ month, caseId, queue, onClose, onOpen }: { month: string; caseId: string; queue: string[]; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useQuery(ekoLine, { month, caseId });
  const d = q.data;
  const title = d ? `Rad ${d.line.caseNumber}` : "Rad";
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
        <Empty icon="file" title="Ingen rad att visa" />
      </Modal>
    );
  }
  return <LineDetailBody d={d} queue={queue} onClose={onClose} onOpen={onOpen} />;
}

function LineDetailBody({ d, queue, onClose, onOpen }: { d: LineDetailView; queue: string[]; onClose: () => void; onOpen: (id: string) => void }) {
  const nav = useNav();
  const { line, month } = d;
  const [pStart, pEnd] = periodOf(line.weeks);
  // Bläddra i granskningskön utan att stänga dialogen.
  const pos = queue.indexOf(line.caseId);
  const prevId = pos > 0 ? queue[pos - 1] : null;
  const nextId = pos >= 0 ? (queue[pos + 1] ?? null) : (queue[0] ?? null);
  const footer = (
    <>
      {queue.length > 0 && (
        <span className="mr-auto flex flex-wrap items-center gap-1.5">
          {prevId && (
            <Button kind="ghost" icon="arrow-left" onClick={() => onOpen(prevId)}>
              Föregående
            </Button>
          )}
          {pos >= 0 && (
            <span className="text-small font-bold tabular-nums">
              {pos + 1} av {queue.length}
            </span>
          )}
          {nextId && (
            <Button kind="secondary" iconRight="arrow-right" onClick={() => onOpen(nextId)}>
              Nästa att granska
            </Button>
          )}
        </span>
      )}
      <Button kind="ghost" icon="file" onClick={() => nav.push(`/ekonomi/${month}/faktura/${encodeURIComponent(line.caseId)}`)}>
        Förhandsgranska fakturan
      </Button>
      <Button kind="ghost" icon="briefcase" onClick={() => nav.push(`/ekonomi/arende/${encodeURIComponent(line.caseId)}`)}>
        Öppna ärendet
      </Button>
    </>
  );
  return (
    <Modal className={WRAP} wide title={`Rad ${line.caseNumber}`} onClose={onClose} footer={footer}>
      <div className="flex flex-wrap items-center gap-1.5">
        <InvStatus status={d.invoice.status} />
        <span className="text-small text-text-muted">
          {d.invoice.title} · en rad per ärende{line.frozen ? " · raden är låst (fakturan är skapad)" : ""}
        </span>
      </div>
      <Kv
        items={[
          ["Avtalsområde", `${line.areaName} (artikel ${line.articleNo || "–"})`],
          [
            "Veckor",
            <>
              {weekText(line.weeks)}{" "}
              <span className="text-text-muted">
                ({fmtDateShort(pStart)}–{fmtDate(pEnd)})
              </span>
            </>,
          ],
          [
            "Belopp",
            <span key="b" className="tabular-nums">
              {line.quantity} × {krExact(line.unitPriceOre)} = <b>{krExact(line.amountOre)}</b> exkl. moms
            </span>,
          ],
          ["Radtext", line.lineText],
        ]}
      />
      <SectionTitle>Kontroller</SectionTitle>
      {line.checks.length === 0 ? (
        <Notice tone="ok" title="Inga anmärkningar">
          Alla veckor har närvaro.
        </Notice>
      ) : (
        <div>
          {line.checks.map((ch, i) => (
            <CheckRow key={`${ch.kind}-${ch.label}-${i}`} d={d} ch={ch} onOpen={onOpen} />
          ))}
        </div>
      )}
      <SectionTitle>Upparbetat och återstående</SectionTitle>
      <SummaryList inv={line} sm={d.summary} />
    </Modal>
  );
}

function CheckRow({ d, ch, onOpen }: { d: LineDetailView; ch: InvoiceCheckView; onOpen: (id: string) => void }) {
  const m = CHECK[ch.severity] ?? CHECK.info;
  return (
    <div className="flex items-start gap-3 border-t border-ljusgra py-3.5 first:border-t-0 first:pt-1">
      <Icon name={m.icon} size="lg" className={ch.severity === "blocking" ? "text-rod" : undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold">{ch.label}</span>
          <Badge tone={m.tone}>{m.word}</Badge>
        </div>
        <div>{ch.text}</div>
        {ch.kind === "zero_week" && <ZeroWeek d={d} ch={ch} />}
        {ch.kind === "overlap" && <OverlapInfo d={d} ch={ch} onOpen={onOpen} />}
        {ch.kind === "paused" && (
          <div className="text-text-muted">
            Fakturan tar bara med de veckor som inte är pausade: {weekText(d.line.weeks)}.
          </div>
        )}
      </div>
    </div>
  );
}

function ZeroWeek({ d, ch }: { d: LineDetailView; ch: InvoiceCheckView }) {
  const approveZero = useCommand(billingApproveZeroWeek);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  // Kommentaren är inte sparad: dialogen frågar innan den stängs.
  useModalDirty(!!note.trim() && ch.severity !== "approved");
  const line = d.line;
  const w = line.weeks.find((x) => x.key === ch.weekKey);
  const id = `eko-zero-${line.caseId}-${ch.weekKey}`;
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
  if (!d.canAct || line.frozen) return facts;
  const save = async () => {
    setTried(true);
    if (err || !ch.weekKey) return;
    await approveZero.run({ month: d.month, caseId: line.caseId, weekKey: ch.weekKey, note: note.trim() });
    toast(`${fmtWeekKey(ch.weekKey)} för ${line.caseNumber} är godkänd för fakturering.`);
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

function OverlapInfo({ d, ch, onOpen }: { d: LineDetailView; ch: InvoiceCheckView; onOpen: (id: string) => void }) {
  const ask = useCommand(ekoAskCoordinator);
  const o = d.overlaps[ch.label];
  if (!o) return null;
  const send = async () => {
    const r = await ask.run({ month: d.month, caseId: d.line.caseId, otherCaseId: o.caseId });
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
      <div>Samma vecka får bara faktureras på en rad. Är du osäker – fråga samordnaren, som ser båda ärendena och kan rätta start- eller slutdatum.</div>
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

// ---- Reservväg: markera fakturan som manuellt fakturerad
function ManualModal({ month, invoices, presetId, onClose }: { month: string; invoices: readonly InvoiceView[]; presetId: string | null; onClose: () => void }) {
  const markManual = useCommand(billingMarkManual);
  const options = invoices.filter((x) => !x.created && !x.blocked && !x.needsApproval && x.lines.length);
  const [invoiceId, setInvoiceId] = useState(presetId && options.some((o) => o.id === presetId) ? presetId : (options.length === 1 ? options[0].id : ""));
  const [no, setNo] = useState("");
  const [tried, setTried] = useState(false);
  const errInv = !invoiceId ? "Välj vilken faktura det gäller." : null;
  const errNo = !/^\d{3,10}$/.test(no.trim()) ? "Skriv fakturanumret med 3–10 siffror, utan mellanslag." : null;
  const save = async () => {
    setTried(true);
    if (errInv || errNo) return;
    const inv = options.find((o) => o.id === invoiceId);
    const r = await markManual.run({ month, invoiceId, invoiceNo: no.trim() });
    if (!r.ok) {
      toast(r.message ?? "Fakturan kunde inte markeras.", "error");
      return;
    }
    toast(`${inv?.title ?? "Fakturan"} är markerad som manuellt fakturerad med fakturanummer ${no.trim()}. Den skapas inte i Fortnox igen.`);
    onClose();
  };
  return (
    <Modal className={WRAP}
      title="Markera som manuellt fakturerad"
      onClose={onClose}
      dirty={!!no.trim()}
      footer={
        options.length === 0 ? (
          <ModalCancelButton>Stäng</ModalCancelButton>
        ) : (
          <>
            <ModalCancelButton />
            <Button kind="primary" icon="check" pending={markManual.pending} onClick={() => void save()}>
              Spara
            </Button>
          </>
        )
      }
    >
      <p>
        Använd reservvägen när fakturan har registrerats för hand i Fortnox eller i kommunens kostnadsfria fakturaportal. Fakturanumret sparas och raderna låses, så att
        samma vecka inte faktureras två gånger.
      </p>
      {options.length === 0 ? (
        // Inga fält som inte går att fylla i: bara beskedet och Stäng.
        <Notice tone="info">Ingen faktura kan markeras just nu. Fakturan behöver giltig beställarreferens och godkända veckor utan närvaro.</Notice>
      ) : (
        <>
          <Field id="eko-manual-invoice" label="Faktura" required help="Stoppade och redan skapade fakturor går inte att välja." error={tried ? errInv : undefined}>
            <Select
              value={invoiceId}
              onValueChange={setInvoiceId}
              placeholder="Välj faktura"
              invalid={tried && !!errInv}
              options={options.map((o) => ({ value: o.id, label: `${o.title} · ${plural(o.lines.length, "rad", "rader")} · ${kr(o.amountOre)}` }))}
            />
          </Field>
          <Field id="eko-manual-no" label="Fakturanummer" required help="Numret från Fortnox eller från kommunens fakturaportal." error={tried ? errNo : undefined}>
            <Input value={no} onValueChange={setNo} inputMode="numeric" maxLength={10} invalid={tried && !!errNo} />
          </Field>
        </>
      )}
    </Modal>
  );
}
