"use client";
// Deltagarkortets flik Månadsunderlag (?flik=manad, rapporter steg 2): progression över tid, vad som saknas innan
// månadsrapporten kan godkännas och exakt det innehåll som kommer i månadsrapporten – samma domänfunktion (monthlyPreview)
// och samma dokumentkomponent (ReportDocument) som rapporten. Levererade månader visas på rapportsidan (där visningen loggas).
// Chef och systemadministratör ser samma vy utan knappar som ändrar något.
import type { ReactNode } from "react";
import { useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import { useSession } from "@/shell/session";
import { fmtDateFull, MONTHS } from "@/core/time";
import { Button, Card, cn, ErrorNotice, Field, Icon, Loading, Notice, Refreshing, Section, Select, Stack, type IconName } from "@/ui";
import { ReportDocument } from "@/features/rapporter/components/report-document";
import { caseMonthBasis, checkInsApprovedGap, type CaseMonthBasis, type MonthlyGaps } from "../api";
import { canOpen, cap, caseLink } from "./common";
import type { TabProps } from "./kort";

const monthWord = (mk: string) => MONTHS[Number(mk.slice(5, 7)) - 1];
const monthText = (mk: string) => `${monthWord(mk)} ${mk.slice(0, 4)}`;

export function TabManad({ card, setTab, month }: TabProps & { month: string | null }) {
  // Månadsbyte: underlaget står kvar (dämpat) tills nästa månad har hämtats – väljaren och fokus ligger kvar.
  const q = useQuery(caseMonthBasis, { caseId: card.caseId, manad: month ?? undefined }, { keepPrevious: true });
  const nav = useNav();
  const pick = (mk: string) => nav.replace(path(`/arenden/${encodeURIComponent(card.caseId)}`, { flik: "manad", manad: mk }));
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === undefined) return <Loading />;
  if (q.data === null) return <Notice tone="info" title="Den delen visas inte för din roll" />;
  return (
    <Refreshing busy={q.isPlaceholderData}>
      <MonthBasis b={q.data} card={card} setTab={setTab} onMonth={pick} />
    </Refreshing>
  );
}

function MonthBasis({ b, card, setTab, onMonth }: Pick<TabProps, "card" | "setTab"> & { b: CaseMonthBasis; onMonth: (mk: string) => void }) {
  const role = useSession().actor.role;
  const canReport = canOpen("rapport.visa", role);
  const options = b.months.map((m) => ({ value: m.month, label: `${monthText(m.month)}${m.current ? " (pågår)" : m.delivered ? " (levererad)" : ""}` }));
  return (
    <Section title="Månadsunderlag">
      <ProgressMatrix b={b} />
      {b.missingMonth && (
        <Notice tone="warn" title={`${cap(monthText(b.missingMonth))} är inte påbörjad`}>
          <Stack gap="sm">
            <div>Månadsbedömningen är underlag för månadsrapporten till kommunen.</div>
            {b.canAssess && (
              <div>
                <Button kind="primary" icon="edit" to={caseLink("/manadsbedomning", card.caseId, { manad: b.missingMonth })}>Påbörja bedömningen</Button>
              </div>
            )}
          </Stack>
        </Notice>
      )}
      {options.length > 0 && (
        <Field label="Månad" id="manad-val" help="Välj vilken månad du vill se underlaget för.">
          <Select value={b.month} onValueChange={onMonth} options={options} className="max-w-[360px]" />
        </Field>
      )}
      {b.months.length === 0 ? (
        <Notice tone="info" title="Insatsen har inte startat än">Månadsunderlaget visas från den månad insatsen startar.</Notice>
      ) : b.beforeStart ? (
        <Notice tone="info" title={`Insatsen hade inte startat i ${monthWord(b.month)}`}>
          Insatsen hade inte startat i {monthWord(b.month)}. Välj en annan månad.
        </Notice>
      ) : b.delivered ? (
        <Card>
          <Stack gap="sm">
            <p className="m-0">
              Månadsrapporten för {monthWord(b.month)} är levererad till kommunen {fmtDateFull(b.delivered.deliveredAt)} (version {b.delivered.version}).
            </p>
            {b.delivered.correctionDraft != null && <p className="m-0">En rättelse (version {b.delivered.correctionDraft}) är ett utkast.</p>}
            {canReport && (
              <div>
                <Button kind="primary" icon="file" to={`/rapporter/${encodeURIComponent(b.delivered.reportId)}`}>Öppna rapporten</Button>
              </div>
            )}
          </Stack>
        </Card>
      ) : (
        <>
          <div className="rounded-mb bg-bla px-4 py-3 text-antracit">
            Det här är samma innehåll som kommer i månadsrapporten till kommunen. Bara godkända uppgifter kommer med.
          </div>
          {b.gaps && <Gaps g={b.gaps} b={b} card={card} setTab={setTab} />}
          <div>
            {b.reportId ? (
              canReport && <Button icon="file" to={`/rapporter/${encodeURIComponent(b.reportId)}`}>Öppna rapportutkastet</Button>
            ) : (
              <p className="m-0 text-text-muted">Rapportutkastet skapas automatiskt när månaden är slut.</p>
            )}
          </div>
          {b.doc && <ReportDocument doc={b.doc} />}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- Progression över tid
function ProgressMatrix({ b }: { b: CaseMonthBasis }) {
  const m = b.matrix;
  return (
    <Card title="Progression över tid" icon="trending-up" flush={m.months.length > 0}>
      {m.months.length === 0 ? (
        <p className="m-0 text-text-muted">Ingen månadsbedömning är godkänd än.</p>
      ) : (
        // Tabellen kan rulla i sidled i sin egen ruta – sidan får inte rulla i sidled.
        <div className="overflow-x-auto" role="region" aria-label="Progression över tid" tabIndex={0}>
          <table className="w-full min-w-[520px] border-collapse text-ui">
            <caption className="sr-only">Nivå per progressionsområde och månad med godkänd bedömning</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b-2 border-antracit px-3 py-2.5 text-left text-label font-extrabold tracking-[0.08em] text-text-muted uppercase">Område</th>
                {m.months.map((mk) => (
                  <th key={mk} scope="col" className="border-b-2 border-antracit px-3 py-2.5 text-left text-label font-extrabold tracking-[0.08em] whitespace-nowrap text-text-muted uppercase">
                    {monthText(mk)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="border-b border-ljusgra px-3 py-2 text-left font-bold">
                    {r.label}
                    {r.optional && <span className="block text-small font-normal text-text-muted">Valfritt område</span>}
                  </th>
                  {r.levels.map((lv, i) => (
                    <td key={m.months[i]} className="border-b border-ljusgra px-3 py-2 whitespace-nowrap">
                      {lv == null ? "–" : `${lv} – ${m.scale[String(lv)] ?? ""}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Innan rapporten kan godkännas
type GapRow = { key: string; kind: "ok" | "warn" | "info"; text: ReactNode; action?: ReactNode };
const GAP_ICON: Record<GapRow["kind"], [IconName, string]> = { ok: ["check-circle", "Klart"], warn: ["alert-circle", "Saknas"], info: ["info", "Information"] };

function Gaps({ g, b, card, setTab }: Pick<TabProps, "card" | "setTab"> & { g: MonthlyGaps; b: CaseMonthBasis }) {
  const word = monthWord(b.month);
  const rows: GapRow[] = [{ key: "ci", ...checkInsApprovedGap(g) }];
  if (g.checkInsDraft > 0) {
    rows.push({
      key: "ci-draft", kind: "warn",
      text: g.checkInsDraft === 1 ? "1 mötesrapport är ett utkast och kommer inte med förrän den är godkänd." : `${g.checkInsDraft} mötesrapporter är utkast och kommer inte med förrän de är godkända.`,
      action: <Button kind="ghost" iconRight="arrow-right" onClick={() => setTab("avstamningar")}>Öppna mötena</Button>,
    });
  }
  rows.push(
    g.unregistered === 0
      ? { key: "att", kind: "ok", text: "All närvaro är registrerad." }
      : {
          key: "att", kind: "warn", text: g.unregistered === 1 ? "1 närvarotillfälle är inte registrerat." : `${g.unregistered} närvarotillfällen är inte registrerade.`,
          action: <Button kind="ghost" iconRight="arrow-right" onClick={() => setTab("narvaro")}>Öppna närvaron</Button>,
        },
  );
  rows.push(
    g.assessment === "approved"
      ? { key: "ma", kind: "ok", text: "Månadsbedömningen är godkänd." }
      : {
          key: "ma", kind: "warn", text: "Månadsbedömningen är inte godkänd. Avsnitt 4, 7 och 8 blir tomma.",
          action: b.canAssess ? (
            <Button kind="primary" icon="edit" to={caseLink("/manadsbedomning", card.caseId, { manad: b.month })}>Gör månadsbedömningen</Button>
          ) : (
            <span className="text-small text-text-muted">Huvudcoachen gör månadsbedömningen.</span>
          ),
        },
  );
  if (g.notes > 0 && g.assessment !== "approved") {
    rows.push({
      key: "notes", kind: "info",
      text: `${g.notes === 1 ? `1 anteckning från ${word} kan` : `${g.notes} anteckningar från ${word} kan`} användas i sammanfattningen. Huvudcoachen lägger till dem i månadsbedömningen.`,
    });
  }
  return (
    <Card title="Innan rapporten kan godkännas" icon="clipboard">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rows.map((r) => {
          const [icon, label] = GAP_ICON[r.kind];
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="flex min-w-0 flex-1 basis-[280px] items-start gap-2">
                <Icon name={icon} className={cn("mt-0.5 flex-none", r.kind === "warn" && "text-rod")} />
                <span className="sr-only">{label}: </span>
                <span>{r.text}</span>
              </span>
              {r.action}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
