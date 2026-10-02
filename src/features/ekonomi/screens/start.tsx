"use client";
// Ekonomens startsida (prototypens eko.start): månadens fakturering, uppgifter, preskriptionsrisk, returnerade fakturor,
// referenser som saknas eller är fel, veckor utan närvaro, körningar per månad och Fortnox-synk.
import { useState, type ReactNode } from "react";
import { ROLE_LABEL } from "@/api/roles";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { useRuntime } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import { fmtDate, fmtDateShort, fmtDateTime, fmtTime, fmtWeekKey, fmtWeekRange, monthName } from "@/core/time";
import { kr, num } from "@/core/format";
import {
  Badge, BuildPhase, Button, Card, CaseLink, cn, DemoNote, Empty, ErrorNotice, Icon, Kv, Loading, Notice, Page, PerspectiveLink, Stepper, Table, useConfirm, toast,
  type IconName,
} from "@/ui";
import { ekoReissue, ekoStart, ekoTaskDone, type BillingStartView, type RefFormCase, type ReturnedRow, type RunRow, type TaskRef, type TaskView } from "../api";
import { cap, monthLabel, pl, plural, refInfo, weekText } from "../model";
import { EkoKpi, EkoKpis, InvStatus, RefBadge, RefModal, RoleNotice, STATUS_ONE, STATUS_PLURAL, WRAP } from "./parts";

export function StartScreen() {
  const session = useSession();
  const q = useQuery(ekoStart, {});
  const eyebrow = session.user.name ? `${session.user.name} · ${ROLE_LABEL[session.actor.role]}` : "Ekonomi";
  const lead = (name: string) => `Fakturaunderlag per ärende och månad för avtalet med ${name}. Peppol-faktura via Fortnox, en faktura per ärende och månad.`;
  if (q.error) return <Page className={WRAP} title="Fakturering" eyebrow={eyebrow}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page className={WRAP} title="Fakturering" eyebrow={eyebrow}><Loading /></Page>;
  return (
    <Page className={WRAP} title="Fakturering" eyebrow={eyebrow} lead={lead(q.data.customerName)}>
      <Start v={q.data} />
    </Page>
  );
}

type RefModalState = { cases: RefFormCase[]; task: TaskRef | null } | null;

function Start({ v }: { v: BillingStartView }) {
  const nav = useNav();
  const demo = useRuntime() === "demo";
  const confirm = useConfirm();
  const reissueCmd = useCommand(ekoReissue);
  const taskDoneCmd = useCommand(ekoTaskDone);
  const [refModal, setRefModal] = useState<RefModalState>(null);
  const act = v.canAct;
  const cur = v.current;
  const rules = v.refRules;
  const openTasks = v.tasks.filter((t) => t.status === "open");
  const taskFor = (caseId: string): TaskRef | null => v.tasks.find((t) => t.status === "open" && t.cases.some((c) => c.caseId === caseId)) ?? null;
  const limit = v.unbilled.limit;

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
  const toRun = (month: string, extra?: Record<string, string>) => {
    const qs = new URLSearchParams(extra).toString();
    nav.push(`/ekonomi/${month}${qs ? `?${qs}` : ""}`);
  };

  return (
    <>
      <RoleNotice canAct={act} />
      {cur && (
        <EkoKpis>
          <EkoKpi
            label={`${cap(monthName(cur.month).split(" ")[0])} att fakturera`}
            value={kr(cur.totalOre)}
            sub={`${plural(cur.count, "faktura", "fakturor")} · ${plural(cur.weeks, "vecka", "veckor")} · exkl. moms`}
          />
          <EkoKpi
            label="Stoppade fakturor"
            value={num(cur.blocked)}
            tone={cur.blocked ? "alert" : null}
            statusText="Rätta referensen"
            sub={cur.blocked ? "Fel eller saknad beställarreferens" : "Inga stoppade"}
          />
          <EkoKpi
            label={"Preskriptions­risk"}
            value={kr(v.unbilled.totalOre)}
            tone={v.unbilled.count ? "alert" : null}
            statusText="Fakturera nu"
            sub={v.unbilled.count ? `${plural(v.unbilled.count, "vecka ofakturerad", "veckor ofakturerade")} i mer än ${limit} dagar` : `Inga veckor äldre än ${limit} dagar`}
          />
          {cur.status === "draft" ? (
            <EkoKpi
              label="Senast i Fortnox"
              value={fmtDateShort(cur.due)}
              tone="watch"
              statusText="Bevaka tiden"
              sub={`${cur.dueRelative} kl. ${fmtTime(cur.due)} · internt mål ${cur.fortnoxDays} arbetsdagar efter månadsskiftet`}
            />
          ) : (
            <EkoKpi label="Öppna uppgifter" value={num(openTasks.length)} sub="Från avtalsansvarig" />
          )}
        </EkoKpis>
      )}
      <TwoCols>
        {cur && (
          <Card
            title={`Fakturakörning ${monthName(cur.month)}`}
            icon="file"
            tone={cur.status === "draft" ? "blue" : undefined}
            actions={
              <Button kind="primary" iconRight="arrow-right" onClick={() => toRun(cur.month)}>
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
                  <button
                    type="button"
                    key={label}
                    onClick={() => toRun(cur.month, { filter: f })}
                    className="flex w-full cursor-pointer items-center gap-3 border-0 border-b border-ljusgra bg-transparent px-[18px] py-3 text-left last:border-b-0 hover:bg-ljusgra-ton"
                  >
                    <Icon name={icon} className={hot && n > 0 ? "text-rod" : undefined} />
                    <span className={cn("min-w-0 flex-1", n > 0 && hot && "font-bold")}>{label}</span>
                    <span className="font-bold tabular-nums">{n}</span>
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </div>
              <div className="text-small text-text-muted">
                Veckorna faktureras i den månad där torsdagen infaller. Samlingsfakturor är {cur.collectiveAllowed ? "tillåtna per beställarreferens" : "inte tillåtna"}.
              </div>
            </div>
          </Card>
        )}
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
                          <RefBadge value={c.buyerReference} info={refInfo(c.buyerReference, rules)} />
                        </span>
                      ))}
                    </div>
                  )}
                  {act && t.status === "open" && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!fixed && (
                        <Button kind="primary" icon="edit" onClick={() => setRefModal({ cases: t.cases.filter((c) => c.problem), task: t })}>
                          Rätta referensen
                        </Button>
                      )}
                      <Button kind={fixed ? "primary" : "secondary"} icon="check" pending={taskDoneCmd.pending} onClick={() => void taskDone(t)}>
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
      </TwoCols>
      <Halves>
        <Card title={`Ofakturerade veckor äldre än ${limit} dagar`} icon="alert" tone={v.unbilled.rows.length ? "red" : undefined} flush>
          {v.unbilled.rows.length === 0 ? (
            <Empty icon="check-circle" title="Inga gamla ofakturerade veckor">
              Alla debiterbara veckor äldre än {limit} dagar är fakturerade.
            </Empty>
          ) : (
            <>
              <div className="px-[18px] pt-3.5">
                <Notice tone="critical" title="Risk för preskription">
                  Faktureringen preskriberas {v.unbilled.prescText} efter utfört arbete. Rätta referensen och fakturera veckorna nu.
                </Notice>
              </div>
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
                    <Icon name={cr ? "check-circle" : "reply"} size="lg" className={cr ? undefined : "text-rod"} />
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
                        <RefBadge value={inv.buyerReference} info={refInfo(inv.buyerReference, rules)} />
                      </div>
                      <div className="text-small">
                        {cr
                          ? `Krediterad och fakturerad på nytt ${fmtDateTime(cr.at)} med referens ${cr.reference}. ${pl(inv.quantity, "Veckan", "Veckorna")} räknas nu som ${pl(inv.quantity, "fakturerad", "fakturerade")}.`
                          : `${plural(inv.quantity, "vecka faktureras", "veckor faktureras")} om på en ny faktura. ${inv.refOk ? "Referensen är rättad. Kreditera den returnerade fakturan och skapa en ny." : "Fakturan returnerades eftersom beställarreferensen inte finns hos kommunen. Rätta referensen först."}`}
                      </div>
                      {act && !cr && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {inv.refOk ? (
                            <>
                              <Button kind="primary" icon="refresh" pending={reissueCmd.pending} onClick={() => void reissue(inv)}>
                                Kreditera och skapa ny
                              </Button>
                              {/* Knappen fungerar – bara prototypen visar utvecklingsfasen. */}
                              <BuildPhase fas={2} />
                            </>
                          ) : (
                            <Button
                              kind="secondary"
                              icon="edit"
                              onClick={() => setRefModal({ cases: [{ caseId: inv.caseId, caseNumber: inv.caseNumber, buyerReference: inv.buyerReference }], task: taskFor(inv.caseId) })}
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
      </Halves>
      <Halves>
        <Card
          title="Beställarreferens saknas eller är fel"
          icon="hash"
          flush
          foot={
            <>
              <span className="text-small text-text-muted">Kommunen anger referensen när de beställer.</span>
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
                      <RefBadge value={c.buyerReference} info={refInfo(c.buyerReference, rules)} />
                    </div>
                    <div className="text-small">{c.problem}</div>
                    {!c.started && (
                      <div className="text-small text-text-muted">Insatsen har inte startat. Ingen faktura ännu – samordnaren tar in referensen från kommunen.</div>
                    )}
                    {act && c.started && (
                      <div>
                        <Button
                          kind="secondary"
                          icon="edit"
                          onClick={() => setRefModal({ cases: [{ caseId: c.caseId, caseNumber: c.caseNumber, buyerReference: c.buyerReference }], task: taskFor(c.caseId) })}
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
        <Card title="Veckor utan närvaro att kontrollera" icon="clock" flush>
          {v.zero.length === 0 ? (
            <Empty icon="check-circle" title="Inga veckor att kontrollera" />
          ) : (
            <div className="flex flex-col">
              {v.zero.map((z) => (
                <button
                  type="button"
                  key={z.id}
                  onClick={() => toRun(z.month, { arende: z.caseId })}
                  className="flex w-full cursor-pointer items-start gap-3 border-0 border-b border-ljusgra bg-transparent px-[18px] py-3 text-left last:border-b-0 hover:bg-ljusgra-ton max-[620px]:flex-wrap"
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
                </button>
              ))}
            </div>
          )}
        </Card>
      </Halves>
      <Card title="Fakturakörningar per månad" icon="calendar" flush>
        <Table<RunRow>
          caption="Fakturakörningar per månad"
          rows={v.runs}
          onRowClick={(r) => toRun(r.month)}
          columns={[
            { key: "m", label: "Månad", nowrap: true, render: (r) => <span className="font-bold">{monthLabel(r.month)}</span> },
            {
              key: "run",
              label: "Körning",
              render: (r) =>
                r.status === "draft" ? (
                  <Badge tone="dark" icon="clock">
                    Pågår
                  </Badge>
                ) : (
                  <Badge tone="outline" icon="check">
                    Stängd
                  </Badge>
                ),
            },
            { key: "count", label: "Fakturor", num: true, render: (r) => num(r.count) },
            { key: "weeks", label: "Veckor", num: true, render: (r) => num(r.weeks) },
            { key: "total", label: "Belopp exkl. moms", num: true, nowrap: true, render: (r) => kr(r.totalOre) },
            {
              key: "status",
              label: "Fakturastatus",
              render: (r) => (
                <div className="flex flex-col gap-1">
                  <span>
                    <InvStatus status={r.entries[0] ? r.entries[0][0] : "draft"} />
                  </span>
                  {r.entries.length > 1 && (
                    <span className="text-small">
                      {r.entries
                        .slice(1)
                        .map(([s, n]) => `${n} ${(n === 1 ? STATUS_ONE : STATUS_PLURAL)[s] ?? s}`)
                        .join(" · ")}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "todo",
              label: "Att åtgärda",
              render: (r) =>
                r.todo ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Icon name="alert-circle" />
                    {r.todo}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Icon name="check" />
                    Inget
                  </span>
                ),
            },
          ]}
        />
      </Card>
      <Card title="Fortnox-synk" icon="refresh" actions={<BuildPhase fas={2} off />}>
        <TwoCols>
          <Kv
            items={[
              ["Koppling", demo ? "Simulerad i prototypen. I fas 1 används export och manuell registrering i Fortnox." : "Inte ansluten ännu. Under tiden används export och manuell registrering i Fortnox."],
              ["Inloggning", "Fortnox godkänner kopplingen. Nycklarna sparas krypterade."],
              ["Hastighetsgräns", "25 anrop per 5 sekunder. Körningen köar anropen."],
              ["Dubbletter", "Varje faktura känns igen på månad och ärendenummer. En omkörning skapar inga dubbletter."],
            ]}
          />
          <Kv
            items={[
              ["Status tillbaka", "Skapad → bokförd → skickad → betald"],
              [
                "Senaste körning",
                v.fortnox.lastRun
                  ? `${fmtDateTime(v.fortnox.lastRun.at)}: ${plural(v.fortnox.lastRun.created, "faktura skapad", "fakturor skapade")}, ${plural(v.fortnox.lastRun.skipped, "dubblett", "dubbletter")} hoppades över`
                  : demo
                    ? "Ingen körning i prototypen ännu"
                    : "Ingen körning ännu",
              ],
              [
                "Senaste statushämtning",
                v.fortnox.lastSync ? `${fmtDateTime(v.fortnox.lastSync.at)} (${plural(v.fortnox.lastSync.changed, "faktura uppdaterad", "fakturor uppdaterade")})` : "Ingen ännu",
              ],
              ["Att kontrollera", `Licenser för Fortnox Integration och Fortnox e-faktura, samt ${possessive(v.customerName)} Peppol-id.`],
            ]}
          />
        </TwoCols>
      </Card>
      <DemoNote>
        Fortnox, kreditering och statushämtning är simulerade. Allt du gör sparas i revisionsloggen. Priserna är exempel
        {v.priceSpan ? ` inom prislistans spann (${v.priceSpan} per vecka)` : ""}.
      </DemoNote>
      {refModal && <RefModal cases={refModal.cases} task={refModal.task} rules={rules} canAct={act} onClose={() => setRefModal(null)} />}
    </>
  );
}

/** "Botkyrka kommun" → "Botkyrkas". */
const possessive = (customerName: string) => `${customerName.replace(/ kommun$/, "")}s`;

function TwoCols({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 items-start gap-5 max-[980px]:grid-cols-1 [&>*]:min-w-0">{children}</div>;
}
function Halves({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1 [&>*]:min-w-0">{children}</div>;
}
function Row({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0 max-[620px]:flex-wrap">{children}</div>;
}
