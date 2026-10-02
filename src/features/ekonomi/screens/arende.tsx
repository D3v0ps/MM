"use client";
// Ärendets fakturaunderlag (prototypens eko.arende): beställning, upparbetat, fakturerat, ej fakturerat och återstående,
// referenser och debiterbara veckor per månad. Utan ärende: sök på ärendenummer.
import { useState } from "react";
import { useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { fmtDate, fmtWeekKey, fmtWeekRange } from "@/core/time";
import { kr } from "@/core/format";
import {
  Badge, Button, Card, CaseStatusBadge, CellSub, DemoNote, Empty, ErrorNotice, Field, Icon, Input, Kv, Loading, Meter, Page, PerspectiveLink, Table,
} from "@/ui";
import { ekoCase, ekoCaseList, type CaseBillingView, type CaseMonthRow } from "../api";
import { monthLabel, pl, plural, weekText } from "../model";
import { EkoKpi, EkoKpis, InvStatus, RefBadge, RefCell, RefModal, RoleNotice, WRAP } from "./parts";

export function ArendeScreen({ params }: ScreenProps) {
  if (!params.caseId) return <CasePicker />;
  return <ArendeLoader caseId={params.caseId} />;
}

function ArendeLoader({ caseId }: { caseId: string }) {
  const q = useQuery(ekoCase, { caseId });
  const crumbs = [{ label: "Fakturering", to: "/ekonomi" }, { label: "Ärende", to: "/ekonomi/arende" }, { label: q.data?.caseNumber ?? "Ärende" }];
  if (q.error) return <Page className={WRAP} title="Ärende" crumbs={crumbs}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (q.data === undefined) return <Page className={WRAP} title="Ärende" crumbs={crumbs}><Loading /></Page>;
  if (q.data === null) return <CasePicker />;
  return <Arende v={q.data} crumbs={crumbs} />;
}

// ---------------------------------------------------------------- Sök ärende
function CasePicker() {
  const nav = useNav();
  const q = useQuery(ekoCaseList, {});
  const [search, setSearch] = useState("");
  const crumbs = [{ label: "Fakturering", to: "/ekonomi" }, { label: "Ärende" }];
  const needle = search.trim().toUpperCase();
  const list = (q.data?.cases ?? []).filter((c) => !needle || c.caseNumber.includes(needle));
  return (
    <Page className={WRAP} title="Ärende" crumbs={crumbs} lead="Sök på ärendenumret för att se debiterbara veckor, fakturastatus och beställningens värde.">
      {q.error ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <>
          <RoleNotice canAct={q.data.canAct} />
          <Card flush>
            <div className="px-[18px] py-3.5">
              <Field id="eko-case-search" label="Sök ärendenummer" help="Till exempel 0143 eller BOT-26-0143.">
                <Input type="search" value={search} onValueChange={setSearch} />
              </Field>
            </div>
            <Table
              caption="Ärenden"
              rows={list.slice(0, 25)}
              rowKey="caseId"
              onRowClick={(c) => nav.push(`/ekonomi/arende/${encodeURIComponent(c.caseId)}`)}
              empty="Inget ärende matchar sökningen."
              columns={[
                { key: "number", label: "Ärende", nowrap: true, render: (c) => <span className="font-bold tabular-nums">{c.caseNumber}</span> },
                { key: "area", label: "Område", render: (c) => c.areaName },
                { key: "start", label: "Start", nowrap: true, render: (c) => fmtDate(c.startDate) },
                { key: "status", label: "Status", render: (c) => <CaseStatusBadge status={c.status} /> },
                { key: "ref", label: "Beställarreferens", render: (c) => <RefCell value={c.buyerReference} info={c.ref} /> },
              ]}
              footer={
                list.length > 25 && (
                  <tr>
                    <td colSpan={5} className="text-small text-text-muted">
                      Visar 25 av {list.length}. Sök för att hitta fler.
                    </td>
                  </tr>
                )
              }
            />
          </Card>
        </>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- Ärendets underlag
function Arende({ v, crumbs }: { v: CaseBillingView; crumbs: { label: string; to?: string }[] }) {
  const nav = useNav();
  const [allWeeks, setAllWeeks] = useState(false);
  const [refModal, setRefModal] = useState(false);
  const act = v.canAct;
  const { accrued, billed, returned, pending, orderWeeks } = v;
  const notBilled = { qty: returned.qty + pending.qty, amountOre: returned.amountOre + pending.amountOre };
  const remaining = Math.max(0, orderWeeks - accrued.qty);
  const over = Math.max(0, accrued.qty - orderWeeks);
  const custRole = v.referrerId ? "kommun_handlaggare" : "kommun_chef";
  return (
    <Page className={WRAP}
      title={`Ärende ${v.caseNumber}`}
      eyebrow="Fakturering · ärendets underlag"
      crumbs={crumbs}
      lead="Debiterbara veckor, fakturastatus och beställningens värde. Ärendenumret är faktureringsobjekt på varje faktura."
      actions={<PerspectiveLink role={custRole} userId={v.referrerId ?? undefined} to={`/portal/deltagare/${encodeURIComponent(v.caseId)}`} label="Se ärendet från kundens håll" />}
    >
      <RoleNotice canAct={act} />
      <EkoKpis>
        <EkoKpi label="Beställning" value={kr(v.orderValueOre)} sub={`${plural(orderWeeks, "vecka", "veckor")} × ${kr(v.priceOre)}`} />
        <EkoKpi label="Upparbetat" value={kr(accrued.amountOre)} sub={`${plural(accrued.qty, "debiterbar vecka", "debiterbara veckor")} hittills`} />
        <EkoKpi label="Fakturerat" value={kr(billed.amountOre)} sub={`${plural(billed.qty, "vecka", "veckor")} i Fortnox eller manuellt fakturerade`} />
        <EkoKpi
          label="Ej fakturerat"
          value={kr(notBilled.amountOre)}
          tone={returned.qty > 0 ? "watch" : null}
          statusText="Faktureras om"
          sub={
            returned.qty > 0
              ? `${plural(notBilled.qty, "vecka", "veckor")}, varav ${plural(returned.qty, "vecka", "veckor")} på returnerad faktura`
              : `${plural(notBilled.qty, "vecka", "veckor")} – underlag eller pågående månad`
          }
        />
        <EkoKpi
          label="Återstående"
          value={kr(remaining * v.priceOre)}
          tone={over > 0 ? "alert" : null}
          statusText="Över beställningen"
          sub={over > 0 ? `${plural(over, "vecka", "veckor")} över beställningen` : `${plural(remaining, "vecka", "veckor")} kvar av beställningen`}
        />
      </EkoKpis>
      {orderWeeks > 0 && (
        <Meter
          value={Math.min(accrued.qty, orderWeeks)}
          max={orderWeeks}
          tone="blue"
          label={`Upparbetat: ${accrued.qty} av ${plural(orderWeeks, "beställd vecka", "beställda veckor")}`}
          markers={[{ value: billed.qty, label: `Fakturerat: ${plural(billed.qty, "vecka", "veckor")}` }]}
        />
      )}
      <p className="text-small text-text-muted">
        Upparbetat {plural(accrued.qty, "vecka", "veckor")} = fakturerat {billed.qty} + faktureras om efter returnerad faktura {returned.qty} + ännu inte fakturerat {pending.qty}.
        Pausade veckor räknas inte.
      </p>
      <div className="grid grid-cols-2 items-start gap-5 max-[980px]:grid-cols-1 [&>*]:min-w-0">
        <Card title="Ärendet" icon="briefcase">
          <Kv
            items={[
              [
                "Ärendenummer",
                <span key="n">
                  <span className="font-bold tabular-nums">{v.caseNumber}</span> <span className="text-small text-text-muted">(faktureringsobjekt)</span>
                </span>,
              ],
              [
                "Deltagare",
                <span key="d">
                  {v.name}
                  {act && <span className="text-small text-text-muted"> (namn visas inte för ekonom)</span>}
                </span>,
              ],
              ["Avtalsområde", `${v.areaName} · artikel ${v.articleNo} · ${kr(v.priceOre)} per vecka`],
              ["Status", <CaseStatusBadge key="s" status={v.status} />],
              ["Start", fmtDate(v.startDate)],
              ["Slut", v.endDate ? fmtDate(v.endDate) : v.plannedEnd ? `Planerat ${fmtDate(v.plannedEnd)}` : "–"],
              [
                "Pausade veckor",
                v.pausedWeeks.length ? (
                  <div key="p" className="flex flex-col gap-1">
                    <div className="flex flex-wrap gap-1.5">
                      {v.pausedWeeks.map((k) => (
                        <Badge key={k} tone="grey" icon="pause">
                          {fmtWeekKey(k)} ({fmtWeekRange(k)})
                        </Badge>
                      ))}
                    </div>
                    <div className="text-small text-text-muted">Debiteras inte. Orsaken visas inte för ekonom.</div>
                  </div>
                ) : (
                  "Inga"
                ),
              ],
            ]}
          />
        </Card>
        <Card title="Referenser" icon="hash">
          <Kv
            items={[
              [
                "Beställarreferens",
                <div key="r">
                  <RefBadge value={v.buyerReference} info={v.ref} />
                  <div className="mt-1 text-small">{v.ref.text}</div>
                </div>,
              ],
              ["Inköpsordernummer", v.purchaseOrderNumber ? <span className="tabular-nums">{v.purchaseOrderNumber}</span> : "Används inte – kommunen beställer utanför e-handeln"],
              ["Beställning mottagen", fmtDate(v.referredAt)],
              ["Beställda veckor", plural(orderWeeks, "vecka", "veckor")],
            ]}
          />
          {act && !v.ref.ok && v.startDate && (
            <div className="mt-3">
              <Button kind="primary" icon="edit" onClick={() => setRefModal(true)}>
                Rätta beställarreferensen
              </Button>
            </div>
          )}
        </Card>
      </div>
      <Card
        title="Debiterbara veckor per månad"
        icon="calendar"
        flush
        actions={
          <Button kind="ghost" icon={allWeeks ? "chevron-up" : "chevron-down"} ariaPressed={allWeeks} onClick={() => setAllWeeks(!allWeeks)}>
            {allWeeks ? "Dölj veckorna" : "Visa alla veckor"}
          </Button>
        }
      >
        {v.months.length === 0 ? (
          <Empty icon="calendar" title="Inga debiterbara veckor ännu">
            Insatsen har inte startat.
          </Empty>
        ) : (
          <Table<CaseMonthRow>
            caption="Debiterbara veckor per månad"
            rows={v.months}
            rowKey="mk"
            onRowClick={(x) => {
              if (x.hasInvoice) nav.push(`/ekonomi/${x.mk}/faktura/${encodeURIComponent(v.caseId)}`);
            }}
            rowTone={(x) => (x.hasInvoice ? null : "muted")}
            columns={[
              { key: "mk", label: "Månad", nowrap: true, render: (x) => <span className="font-bold">{monthLabel(x.mk)}</span> },
              {
                key: "weeks",
                label: "Veckor",
                render: (x) => (
                  <>
                    <span className="whitespace-nowrap">{weekText(x.bill)}</span>
                    {x.paused.length > 0 && <CellSub>Pausad {x.paused.map((w) => fmtWeekKey(w.key)).join(", ")}</CellSub>}
                  </>
                ),
              },
              { key: "qty", label: "Antal", num: true },
              { key: "amount", label: "Belopp", num: true, nowrap: true, render: (x) => kr(x.amountOre) },
              {
                key: "status",
                label: "Fakturastatus",
                render: (x) =>
                  x.status === "open" ? (
                    <Badge tone="outline" icon="clock">
                      Faktureras efter månadsskiftet
                    </Badge>
                  ) : x.status ? (
                    <>
                      <InvStatus status={x.status} />
                      {x.status === "returned" && <CellSub>{pl(x.qty, "Veckan", "Veckorna")} faktureras om på en ny faktura</CellSub>}
                    </>
                  ) : (
                    "–"
                  ),
              },
              { key: "no", label: "Fakturanummer", nowrap: true, render: (x) => x.invoiceNo || "–" },
              {
                key: "go",
                label: "",
                render: (x) =>
                  x.hasInvoice && (
                    <span className="inline-flex items-center gap-1.5 text-small whitespace-nowrap">
                      <Icon name="file" />
                      Förhandsgranska
                    </span>
                  ),
              },
            ]}
          />
        )}
        {allWeeks && v.weeks.length > 0 && (
          <div className="border-t border-ljusgra">
            <Table
              caption="Alla veckor"
              rows={v.weeks}
              rowKey="key"
              columns={[
                { key: "key", label: "Vecka", nowrap: true, render: (w) => <span className="font-bold">{fmtWeekKey(w.key)}</span> },
                { key: "range", label: "Period", nowrap: true, render: (w) => fmtWeekRange(w.key) },
                { key: "month", label: "Faktureras i", nowrap: true, render: (w) => monthLabel(w.monthKey) },
                { key: "days", label: "Inskrivna dagar", num: true, render: (w) => w.enrolledDays },
                { key: "att", label: "Närvaro", nowrap: true, render: (w) => (w.planned ? `${w.attended} av ${plural(w.planned, "tillfälle", "tillfällen")}` : "Inga tillfällen än") },
                {
                  key: "note",
                  label: "Anmärkning",
                  render: (w) => (
                    <div className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      {w.paused && (
                        <Badge tone="grey" icon="pause">
                          Pausad – debiteras inte
                        </Badge>
                      )}
                      {w.partial && !w.paused && (
                        <Badge tone="outline" icon="info">
                          Delvis vecka
                        </Badge>
                      )}
                      {w.zeroAttendance && (
                        <Badge tone="grey" icon="clock">
                          Ingen närvaro
                        </Badge>
                      )}
                      {w.missingRegistration && !w.paused && w.monday < v.thisMonday && (
                        <Badge tone="outline" icon="alert-circle">
                          Närvaro saknas
                        </Badge>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Card>
      <DemoNote>
        Upparbetat räknas som alla debiterbara veckor till och med innevarande vecka. Fakturerat är veckor på fakturor som är skapade i Fortnox eller manuellt fakturerade. Veckor på en
        returnerad faktura räknas som ej fakturerade tills en ny faktura är skapad. Fakturastatus och Fortnox är simulerade.
      </DemoNote>
      {refModal && (
        <RefModal
          cases={[{ caseId: v.caseId, caseNumber: v.caseNumber, buyerReference: v.buyerReference }]}
          task={v.task}
          rules={v.refRules}
          canAct={act}
          onClose={() => setRefModal(false)}
        />
      )}
    </Page>
  );
}
