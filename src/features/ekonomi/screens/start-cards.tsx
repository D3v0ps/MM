"use client";
// Korten på ekonomens Fakturering (/ekonomi): fakturakörningen, uppgifterna, preskriptionsrisken, returnerade fakturor,
// referenser som saknas eller är fel och veckor utan närvaro. Delas med ekonomens Min vecka (beslut 2026-10-06), så att samma
// uppgift ser likadan ut och gör samma sak på båda sidorna.
import { useState, type ReactNode } from "react";
import { useCommand } from "@/shell/backend";
import { Link, useNav } from "@/shell/nav";
import { useRuntime } from "@/shell/runtime";
import { fmtDate, fmtDateTime, fmtWeekKey, fmtWeekRange, monthName } from "@/core/time";
import { kr } from "@/core/format";
import { Badge, BuildPhase, Button, Card, CaseLink, cn, Empty, Icon, PerspectiveLink, Stepper, useConfirm, toast, type IconName } from "@/ui";
import { ekoReissue, ekoTaskDone, type BillingStartView, type RefFormCase, type ReturnedRow, type TaskRef, type TaskView } from "../api";
import { monthLabel, pl, plural, refInfo, weekText } from "../model";
import { InvStatus, RefBadge, RefModal } from "./parts";

/** Åtgärderna i korten: rätta referensen (dialogen), kreditera och skapa ny, markera uppgift som klar, öppna körningen. */
export type BillingActions = {
  canAct: boolean;
  openRef: (cases: RefFormCase[], task: TaskRef | null) => void;
  taskFor: (caseId: string) => TaskRef | null;
  reissue: (inv: ReturnedRow) => Promise<void>;
  reissuePending: boolean;
  taskDone: (t: TaskView) => Promise<void>;
  taskDonePending: boolean;
  toRun: (month: string, extra?: Record<string, string>) => void;
  /** Dialogen för beställarreferensen (renderas av sidan). */
  modal: ReactNode;
};

type RefModalState = { cases: RefFormCase[]; task: TaskRef | null } | null;

/** Sökvägen till månadens fakturakörning, t.ex. runPath("2027-01", { filter: "stoppade" }) – för länkar och rutor. */
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
  const [refModal, setRefModal] = useState<RefModalState>(null);
  const taskFor = (caseId: string): TaskRef | null => v.tasks.find((t) => t.status === "open" && t.cases.some((c) => c.caseId === caseId)) ?? null;
  const reissue = async (inv: ReturnedRow) => {
    const r = await reissueCmd.run({ month: inv.month, caseId: inv.caseId });
    if (!r.ok) toast("Rätta beställarreferensen innan du skapar en ny faktura.", "error");
    else toast(`Den returnerade fakturan för ${inv.caseNumber} är krediterad och en ny är skapad${demo ? " (simulerat)" : ""}.`);
  };
  const taskDone = async (t: TaskView) => {
    if (t.cases.some((c) => c.problem)) {
      const ok = await confirm({
        title: "Markera uppgiften som klar?",
        body: "Minst ett ärende har fortfarande fel beställarreferens. Vill du ändå markera uppgiften som klar?",
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
    openRef: (cases, task) => setRefModal({ cases, task }),
    taskFor,
    reissue,
    reissuePending: reissueCmd.pending,
    taskDone,
    taskDonePending: taskDoneCmd.pending,
    toRun,
    modal: refModal ? <RefModal cases={refModal.cases} task={refModal.task} rules={v.refRules} canAct={v.canAct} onClose={() => setRefModal(null)} /> : null,
  };
}

/** Fakturakörningen för månaden: stegvisaren och genvägarna till körningens filter. buttonKind = kortets knapp. */
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
        <Stepper steps={["Underlag framräknat", "Granska och godkänn", "Skapa i Fortnox", "Bokför och skicka"]} current={cur.stepNow} />
        <div className="flex flex-col rounded-mb border border-ljusgra">
          {(
            [
              ["x-circle", "Stoppade – beställarreferens", cur.counts.blocked, "stoppade", true],
              ["clock", "Veckor utan närvaro att godkänna", cur.counts.zeroPending, "godkannande", true],
              ["alert-circle", "Kräver godkännande", cur.counts.review, "godkannande", false],
              ["check", "Klara (godkända eller fakturerade)", cur.counts.ready, "klara", false],
            ] as [IconName, string, number, string, boolean][]
          ).map(([icon, label, n, f, hot]) => (
            // Raderna leder till körningen: riktiga länkar (går att öppna i en ny flik).
            <Link
              key={label}
              to={runPath(cur.month, { filter: f })}
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
          Veckorna faktureras i den månad där torsdagen infaller. Samlingsfakturor är {cur.collectiveAllowed ? "tillåtna per beställarreferens" : "inte tillåtna"}.
        </div>
      </div>
    </Card>
  );
}

/** Uppgifter till ekonomen (t.ex. rätt beställarreferens från kommunen). */
export function TasksCard({ v, a }: { v: BillingStartView; a: BillingActions }) {
  const openTasks = v.tasks.filter((t) => t.status === "open");
  return (
    <Card
      title="Uppgifter till dig"
      icon="inbox"
      flush
      actions={openTasks.length > 0 && <Badge tone="dark">{plural(openTasks.length, "öppen", "öppna")}</Badge>}
    >
      {v.tasks.length === 0 ? (
        <Empty icon="inbox" title="Inga uppgifter">
          Avtalsansvarig skickar uppgifter hit, till exempel rätt beställarreferens från kommunen.
        </Empty>
      ) : (
        v.tasks.map((t) => {
          const fixed = t.cases.every((c) => !c.problem);
          return (
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
                    <span key={c.caseId} className="inline-flex flex-wrap items-center gap-1.5">
                      <CaseLink caseId={c.caseId} caseNumber={c.caseNumber} />
                      <RefBadge value={c.buyerReference} info={refInfo(c.buyerReference, v.refRules)} />
                    </span>
                  ))}
                </div>
              )}
              {a.canAct && t.status === "open" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {!fixed && (
                    <Button kind="primary" icon="edit" onClick={() => a.openRef(t.cases.filter((c) => c.problem), t)}>
                      Rätta referensen
                    </Button>
                  )}
                  <Button kind={fixed ? "primary" : "secondary"} icon="check" pending={a.taskDonePending} onClick={() => void a.taskDone(t)}>
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
          );
        })
      )}
    </Card>
  );
}

/** Ofakturerade veckor äldre än gränsen (preskriptionsrisk). */
export function UnbilledCard({ v }: { v: BillingStartView }) {
  return (
    <Card title={`Ofakturerade veckor äldre än ${v.unbilled.limit} dagar`} icon="alert" tone={v.unbilled.rows.length ? "red" : undefined} flush>
      {v.unbilled.rows.length === 0 ? (
        <Empty icon="check-circle" title="Inga gamla ofakturerade veckor">
          Alla debiterbara veckor äldre än {v.unbilled.limit} dagar är fakturerade.
        </Empty>
      ) : (
        <>
          {/* Kortet är redan rött (sidans enda röda ämne) – ingen röd ruta i den röda rutan. */}
          <p className="max-w-[70ch] border-b border-ljusgra px-[18px] py-3">
            <b>Risk för preskription.</b> Faktureringen preskriberas {v.unbilled.prescText} efter utfört arbete. Rätta referensen och fakturera veckorna nu.
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

/** Fakturor som kommunen har returnerat. */
export function ReturnedCard({ v, a }: { v: BillingStartView; a: BillingActions }) {
  return (
    <Card title="Returnerade fakturor" icon="reply" flush>
      {v.returned.length === 0 ? (
        <Empty icon="check-circle" title="Inga returnerade fakturor">
          Kommunen har inte returnerat någon faktura.
        </Empty>
      ) : (
        <div className="flex flex-col">
          {v.returned.map((inv) => {
            const cr = inv.credit;
            return (
              <Row key={inv.id}>
                <Icon name={cr ? "check-circle" : "reply"} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold tabular-nums">{inv.caseNumber}</span>
                    <InvStatus status={inv.status} />
                  </div>
                  <span className="text-small">
                    {monthLabel(inv.month)} · {weekText(inv.weeks)} · {kr(inv.amountOre)}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-small">Beställarreferens:</span>
                    <RefBadge value={inv.buyerReference} info={refInfo(inv.buyerReference, v.refRules)} />
                  </div>
                  <div>
                    {cr
                      ? `Krediterad och fakturerad på nytt ${fmtDateTime(cr.at)} med referens ${cr.reference}. ${pl(inv.quantity, "Veckan", "Veckorna")} räknas nu som ${pl(inv.quantity, "fakturerad", "fakturerade")}.`
                      : `${plural(inv.quantity, "vecka faktureras", "veckor faktureras")} om på en ny faktura. ${inv.refOk ? "Referensen är rättad. Kreditera den returnerade fakturan och skapa en ny." : "Fakturan returnerades eftersom beställarreferensen inte finns hos kommunen. Rätta referensen först."}`}
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
                        <Button
                          kind="secondary"
                          icon="edit"
                          onClick={() => a.openRef([{ caseId: inv.caseId, caseNumber: inv.caseNumber, buyerReference: inv.buyerReference }], a.taskFor(inv.caseId))}
                        >
                          Rätta referensen
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

/** Ärenden där beställarreferensen saknas eller är fel. */
export function RefCasesCard({ v, a }: { v: BillingStartView; a: BillingActions }) {
  return (
    <Card
      title="Beställarreferens saknas eller är fel"
      icon="hash"
      flush
      foot={
        <>
          <span className="text-text-muted">Kommunen anger referensen när de beställer.</span>
          <PerspectiveLink role="kommun_handlaggare" to="/portal/bestall" label="Se var kommunen anger den" />
        </>
      }
    >
      {v.refCases.length === 0 ? (
        <Empty icon="check-circle" title="Alla referenser är giltiga" />
      ) : (
        <div className="flex flex-col">
          {v.refCases.map((c) => (
            <Row key={c.caseId}>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CaseLink caseId={c.caseId} caseNumber={c.caseNumber} />
                  <RefBadge value={c.buyerReference} info={refInfo(c.buyerReference, v.refRules)} />
                </div>
                <div>{c.problem}</div>
                {!c.started && (
                  <div className="text-text-muted">Insatsen har inte startat. Ingen faktura ännu – samordnaren tar in referensen från kommunen.</div>
                )}
                {a.canAct && c.started && (
                  <div>
                    <Button
                      kind="secondary"
                      icon="edit"
                      onClick={() => a.openRef([{ caseId: c.caseId, caseNumber: c.caseNumber, buyerReference: c.buyerReference }], a.taskFor(c.caseId))}
                    >
                      Rätta referensen
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
  return (
    <Card title="Veckor utan närvaro att kontrollera" icon="clock" flush>
      {v.zero.length === 0 ? (
        <Empty icon="check-circle" title="Inga veckor att kontrollera" />
      ) : (
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
