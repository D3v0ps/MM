"use client";
// Korten på ekonomens Fakturering (/ekonomi): fakturakörningen, uppgifterna, preskriptionsrisken, returnerade fakturor,
// fakturor som saknar beställarreferens och veckor utan närvaro. Delas med ekonomens Min vecka (beslut 2026-10-06), så att samma
// uppgift ser likadan ut och gör samma sak på båda sidorna.
// Beslut 2026-10-07 (synpunkt #13): en faktura per avtal och månad – referensen fylls i per faktura.
import { useState, type ReactNode } from "react";
import { useCommand } from "@/shell/backend";
import { Link, useNav } from "@/shell/nav";
import { useRuntime } from "@/shell/runtime";
import { fmtDate, fmtDateTime, fmtWeekKey, fmtWeekRange, monthName } from "@/core/time";
import { kr } from "@/core/format";
import { Badge, BuildPhase, Button, Card, CaseLink, cn, DoneLine, Icon, Stepper, useConfirm, toast, type IconName } from "@/ui";
import { ekoReissue, ekoTaskDone, type BillingStartView, type RefInvoiceRow, type ReturnedRow, type TaskView } from "../api";
import { pl, plural, refInfo, weekText } from "../model";
import { InvoiceRefModal, InvStatus, RefBadge, type RefInvoice } from "./parts";

/** Åtgärderna i korten: fyll i fakturans referens (dialogen), kreditera och skapa ny, markera uppgift som klar, öppna körningen. */
export type BillingActions = {
  canAct: boolean;
  openRef: (inv: { invoiceId: string; month: string; title: string; buyerReference: string | null }) => void;
  reissue: (inv: ReturnedRow) => Promise<void>;
  reissuePending: boolean;
  taskDone: (t: TaskView) => Promise<void>;
  taskDonePending: boolean;
  toRun: (month: string, extra?: Record<string, string>) => void;
  /** Dialogen för beställarreferensen (renderas av sidan). */
  modal: ReactNode;
};

/** Sökvägen till månadens fakturakörning, t.ex. runPath("2027-01", { filter: "godkannande" }) – för länkar och rutor. */
export function runPath(month: string, extra?: Record<string, string>): string {
  const qs = new URLSearchParams(extra).toString();
  return `/ekonomi/${month}${qs ? `?${qs}` : ""}`;
}

export function useBillingActions(v: BillingStartView): BillingActions {
  const nav = useNav();
  const demo = useRuntime() === "demo";
  const confirm = useConfirm();
  const reissueCmd = useCommand(ekoReissue);
  const taskDoneCmd = useCommand(ekoTaskDone);
  const [refModal, setRefModal] = useState<RefInvoice | null>(null);
  const reissue = async (inv: ReturnedRow) => {
    const r = await reissueCmd.run({ month: inv.month, invoiceId: inv.invoiceId });
    if (!r.ok) toast(r.message ?? "Rätta beställarreferensen innan du skapar en ny faktura.", "error");
    else if (!r.reissued) toast(`${inv.title} är krediterad. Inga veckor återstår att fakturera, så ingen ny faktura skapades.`);
    else toast(`${inv.title} är krediterad och en ny är skapad${demo ? " (simulerat)" : ""}.`);
  };
  const taskDone = async (t: TaskView) => {
    if (v.refInvoices.length) {
      const ok = await confirm({
        title: "Markera uppgiften som klar?",
        body: "Minst en faktura saknar fortfarande giltig beställarreferens. Vill du ändå markera uppgiften som klar?",
        confirmLabel: "Markera som klar",
      });
      if (!ok) return;
    }
    await taskDoneCmd.run({ taskId: t.id });
    toast("Uppgiften är markerad som klar.");
  };
  const toRun = (month: string, extra?: Record<string, string>) => nav.push(runPath(month, extra));
  return {
    canAct: v.canAct,
    openRef: (inv) =>
      setRefModal({
        id: inv.invoiceId, month: inv.month, title: inv.title, buyerReference: inv.buyerReference, ref: refInfo(inv.buyerReference, v.refRules),
        refSuggestions: v.refSuggestions[inv.invoiceId] ?? [],
      }),
    reissue,
    reissuePending: reissueCmd.pending,
    taskDone,
    taskDonePending: taskDoneCmd.pending,
    toRun,
    modal: refModal ? <InvoiceRefModal inv={refModal} rules={v.refRules} canAct={v.canAct} onClose={() => setRefModal(null)} /> : null,
  };
}

/** Fakturakörningen för månaden: stegvisaren och genvägarna till körningen. buttonKind = kortets knapp. */
export function RunCard({ v, buttonKind = "primary" }: { v: BillingStartView; buttonKind?: "primary" | "secondary" }) {
  const cur = v.current;
  if (!cur) return null;
  return (
    <Card
      title={`Fakturakörning ${monthName(cur.month)}`}
      icon="file"
      tone={cur.status === "draft" ? "blue" : undefined}
      actions={
        <Button kind={buttonKind} iconRight="arrow-right" to={runPath(cur.month)}>
          Öppna körningen
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Stepper steps={["Underlag framräknat", "Referens och godkännande", "Skapa i Fortnox", "Bokför och skicka"]} current={cur.stepNow} />
        <div className="flex flex-col rounded-mb border border-ljusgra">
          {(
            [
              ["x-circle", "Stoppade fakturor – beställarreferens", cur.counts.blocked, null, true],
              ["clock", "Veckor utan närvaro att godkänna", cur.counts.zeroPending, "godkannande", true],
              ["alert-circle", "Fakturor att godkänna", cur.counts.review, null, false],
              ["check", "Klara fakturor (godkända eller skapade)", cur.counts.ready, null, false],
            ] as [IconName, string, number, string | null, boolean][]
          ).map(([icon, label, n, f, hot]) => (
            // Raderna leder till körningen: riktiga länkar (går att öppna i en ny flik).
            <Link
              key={label}
              to={runPath(cur.month, f ? { filter: f } : undefined)}
              className="flex w-full items-center gap-3 border-b border-ljusgra px-[18px] py-3 text-left text-antracit no-underline last:border-b-0 hover:bg-ljusgra-ton"
            >
              <Icon name={icon} className={hot && n > 0 ? "text-rod" : undefined} />
              <span className={cn("min-w-0 flex-1", n > 0 && hot && "font-bold")}>{label}</span>
              <span className="font-bold tabular-nums">{n}</span>
              <Icon name="chevron-right" />
            </Link>
          ))}
        </div>
        <div className="text-text-muted">
          Veckorna faktureras i den månad där torsdagen infaller.{" "}
          {cur.perContract ? `En faktura för avtalet och månaden med en rad per ärende (${plural(cur.count, "rad", "rader")}).` : "En faktura per ärende och månad."}
        </div>
      </div>
    </Card>
  );
}

/** Uppgifter till ekonomen (t.ex. rätt beställarreferens från kommunen). */
export function TasksCard({ v, a }: { v: BillingStartView; a: BillingActions }) {
  const openTasks = v.tasks.filter((t) => t.status === "open");
  // Inget att göra = en rad (Min veckas stil), inte ett tomt kort.
  if (v.tasks.length === 0) {
    return (
      <DoneLine title="Uppgifter till dig" icon="inbox">
        Inga uppgifter. Avtalsansvarig skickar uppgifter hit, till exempel rätt beställarreferens från kommunen.
      </DoneLine>
    );
  }
  return (
    <Card
      title="Uppgifter till dig"
      icon="inbox"
      flush
      actions={openTasks.length > 0 && <Badge tone="dark">{plural(openTasks.length, "öppen", "öppna")}</Badge>}
    >
      {v.tasks.map((t) => (
          <div key={t.id} className={cn("flex flex-col gap-2 border-b border-ljusgra px-[18px] py-3.5 last:border-b-0", t.status !== "open" && "bg-ljusgra-ton")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={t.status === "open" ? "dark" : "outline"} icon={t.status === "open" ? "clock" : "check"}>
                {t.status === "open" ? "Öppen" : "Klar"}
              </Badge>
              <span className="text-small text-text-muted">
                Från {t.fromName} · {fmtDateTime(t.createdAt)}
              </span>
            </div>
            <div>{t.text}</div>
            {t.cases.length > 0 && (
              <div className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {t.cases.map((c) => (
                  <CaseLink key={c.caseId} caseId={c.caseId} caseNumber={c.caseNumber} />
                ))}
              </div>
            )}
            {a.canAct && t.status === "open" && (
              <div className="flex flex-wrap items-center gap-1.5">
                {v.refInvoices.length > 0 && (
                  <Button kind="primary" icon="edit" onClick={() => a.openRef(v.refInvoices[0])}>
                    Fyll i referensen
                  </Button>
                )}
                <Button kind={v.refInvoices.length ? "secondary" : "primary"} icon="check" pending={a.taskDonePending} onClick={() => void a.taskDone(t)}>
                  Markera som klar
                </Button>
              </div>
            )}
            {t.status !== "open" && t.doneAt && (
              <div className="text-small text-text-muted">
                Klar {fmtDateTime(t.doneAt)} ({t.doneByName ?? "–"}).
              </div>
            )}
          </div>
        ))}
    </Card>
  );
}

/** Ofakturerade veckor äldre än gränsen (preskriptionsrisk). */
export function UnbilledCard({ v }: { v: BillingStartView }) {
  if (v.unbilled.rows.length === 0) {
    return (
      <DoneLine title={`Ofakturerade veckor äldre än ${v.unbilled.limit} dagar`} icon="alert">
        Inga gamla ofakturerade veckor – alla debiterbara veckor äldre än {v.unbilled.limit} dagar är fakturerade.
      </DoneLine>
    );
  }
  return (
    <Card title={`Ofakturerade veckor äldre än ${v.unbilled.limit} dagar`} icon="alert" tone="red" flush>
      {(
        <>
          {/* Kortet är redan rött (sidans enda röda ämne) – ingen röd ruta i den röda rutan. */}
          <p className="max-w-[70ch] border-b border-ljusgra px-[18px] py-3">
            <b>Risk för preskription.</b> Faktureringen preskriberas {v.unbilled.prescText} efter utfört arbete. Fakturera veckorna nu.
          </p>
          <div className="flex flex-col">
            {v.unbilled.rows.map((r) => (
              <Row key={r.caseId}>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CaseLink caseId={r.caseId} caseNumber={r.caseNumber} />
                    <InvStatus status={r.status} />
                  </div>
                  <span className="text-small">
                    {plural(r.weeks.length, "vecka", "veckor")} ({weekText(r.weeks)}) · {kr(r.amountOre)} · äldsta veckan {plural(r.age, "dag", "dagar")}
                  </span>
                </div>
                <div className="flex flex-none flex-col items-end gap-1 max-[620px]:w-full max-[620px]:flex-row max-[620px]:flex-wrap max-[620px]:items-center">
                  <span className="text-small text-text-muted">Preskriberas</span>
                  <span className="font-bold whitespace-nowrap">{fmtDate(r.presc)}</span>
                  <span className="text-small whitespace-nowrap">{r.left >= 0 ? `om ${plural(r.left, "dag", "dagar")}` : "passerat"}</span>
                </div>
              </Row>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** Fakturor som kommunen har returnerat (och de som krediterats och gjorts om). */
export function ReturnedCard({ v, a }: { v: BillingStartView; a: BillingActions }) {
  if (v.returned.length === 0) {
    return (
      <DoneLine title="Returnerade fakturor" icon="reply">
        Inga returnerade fakturor – kommunen har inte returnerat någon faktura.
      </DoneLine>
    );
  }
  return (
    <Card title="Returnerade fakturor" icon="reply" flush>
      {(
        <div className="flex flex-col">
          {v.returned.map((inv) => {
            const cr = inv.credit;
            return (
              <Row key={inv.invoiceId}>
                <Icon name={cr ? "check-circle" : "reply"} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold">{inv.title}</span>
                    <InvStatus status={inv.status} />
                  </div>
                  <span className="text-small">
                    {plural(inv.lines, "rad", "rader")} ({inv.caseNumbers.join(", ")}) · {plural(inv.quantity, "vecka", "veckor")} · {kr(inv.amountOre)}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-small">Beställarreferens:</span>
                    <RefBadge value={inv.buyerReference} info={refInfo(inv.buyerReference, v.refRules)} />
                  </div>
                  <div>
                    {cr
                      ? `Krediterad och fakturerad på nytt ${fmtDateTime(cr.at)} med referens ${cr.reference}. ${pl(inv.quantity, "Veckan", "Veckorna")} räknas nu som ${pl(inv.quantity, "fakturerad", "fakturerade")}.`
                      : `${plural(inv.quantity, "vecka faktureras", "veckor faktureras")} om på en ny faktura (raderna räknas på nytt från dagens underlag). ${inv.refOk ? "Referensen är rättad. Kreditera den returnerade fakturan och skapa en ny." : "Fakturan returnerades eftersom beställarreferensen inte finns hos kommunen. Fyll i rätt referens först."}`}
                  </div>
                  {a.canAct && !cr && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {inv.refOk ? (
                        <>
                          <Button kind="primary" icon="refresh" pending={a.reissuePending} onClick={() => void a.reissue(inv)}>
                            Kreditera och skapa ny
                          </Button>
                          {/* Knappen fungerar – bara prototypen visar utvecklingsfasen. */}
                          <BuildPhase fas={2} />
                        </>
                      ) : (
                        <Button kind="secondary" icon="edit" onClick={() => a.openRef(inv)}>
                          Fyll i rätt referens
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Row>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Fakturor som inte kan skapas eftersom beställarreferensen saknas eller är fel (Miljonbemanning fyller i den). */
export function RefInvoicesCard({ v, a }: { v: BillingStartView; a: BillingActions }) {
  if (v.refInvoices.length === 0) {
    return (
      <DoneLine title="Fakturor som saknar beställarreferens" icon="hash">
        Alla fakturor har giltig referens.
      </DoneLine>
    );
  }
  return (
    <Card
      title="Fakturor som saknar beställarreferens"
      icon="hash"
      flush
      foot={<span className="text-text-muted">Miljonbemanning fyller i kommunens referens – en per faktura. Kommunen anger den inte i beställningen.</span>}
    >
      {(
        <div className="flex flex-col">
          {v.refInvoices.map((inv: RefInvoiceRow) => (
            <Row key={inv.invoiceId}>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold">{inv.title}</span>
                  <RefBadge value={inv.buyerReference} info={refInfo(inv.buyerReference, v.refRules)} />
                </div>
                <div className="text-small">{plural(inv.lines, "rad", "rader")}</div>
                <div>{inv.problem}</div>
                {a.canAct && (
                  <div>
                    <Button kind="secondary" icon="edit" onClick={() => a.openRef(inv)}>
                      Fyll i referensen
                    </Button>
                  </div>
                )}
              </div>
            </Row>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Veckor utan närvaro som ska kontrolleras innan de faktureras. */
export function ZeroCard({ v }: { v: BillingStartView }) {
  if (v.zero.length === 0) {
    return (
      <DoneLine title="Veckor utan närvaro att kontrollera" icon="clock">
        Inga veckor att kontrollera.
      </DoneLine>
    );
  }
  return (
    <Card title="Veckor utan närvaro att kontrollera" icon="clock" flush>
      {(
        <div className="flex flex-col">
          {v.zero.map((z) => (
            <Link
              key={z.id}
              to={runPath(z.month, { arende: z.caseId })}
              className="flex w-full items-start gap-3 border-b border-ljusgra px-[18px] py-3 text-left text-antracit no-underline last:border-b-0 hover:bg-ljusgra-ton max-[620px]:flex-wrap"
            >
              <Icon name={z.approved ? "check" : "clock"} className="mt-0.5" />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="font-bold tabular-nums">{z.caseNumber}</span>
                <span className="text-small text-text-muted">
                  {fmtWeekKey(z.weekKey)} ({fmtWeekRange(z.weekKey)}) · {z.planned != null ? `0 av ${plural(z.planned, "tillfälle", "tillfällen")} med närvaro` : ""}
                </span>
              </span>
              <span className="flex flex-none flex-col items-end gap-1">
                <Badge tone={z.approved ? "bluetone" : "grey"} icon={z.approved ? "check" : "clock"}>
                  {z.approved ? "Godkänd" : "Kontrollera"}
                </Badge>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0 max-[620px]:flex-wrap">{children}</div>;
}
