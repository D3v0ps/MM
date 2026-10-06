"use client";
// Fakturering (/ekonomi, prototypens eko.start): månadens fakturering, uppgifter, preskriptionsrisk, returnerade fakturor,
// referenser som saknas eller är fel, veckor utan närvaro, körningar per månad och Fortnox-synk. Ekonomens startsida är Min
// vecka (beslut 2026-10-06), som visar samma kort (./start-cards.tsx); sidan här ligger under fliken Ekonomi.
import type { ReactNode } from "react";
import { ROLE_LABEL } from "@/api/roles";
import { useQuery } from "@/shell/backend";
import { useRuntime } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import { fmtDateShort, fmtDateTime, fmtTime, monthName } from "@/core/time";
import { kr, num } from "@/core/format";
import { Badge, BuildPhase, Card, DemoNote, ErrorNotice, Icon, Kv, Loading, Page, Table } from "@/ui";
import { ekoStart, type BillingStartView, type RunRow } from "../api";
import { cap, monthLabel, plural } from "../model";
import { EkoKpi, EkoKpis, InvStatus, RoleNotice, STATUS_ONE, STATUS_PLURAL, WRAP } from "./parts";
import { RefCasesCard, ReturnedCard, RunCard, TasksCard, UnbilledCard, useBillingActions, ZeroCard } from "./start-cards";

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

function Start({ v }: { v: BillingStartView }) {
  const demo = useRuntime() === "demo";
  const a = useBillingActions(v);
  const act = v.canAct;
  const cur = v.current;
  const openTasks = v.tasks.filter((t) => t.status === "open");
  const limit = v.unbilled.limit;
  const toRun = a.toRun;

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
            tone={cur.blocked ? "watch" : null}
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
        <RunCard v={v} />
        <TasksCard v={v} a={a} />
      </TwoCols>
      <Halves>
        <UnbilledCard v={v} />
        <ReturnedCard v={v} a={a} />
      </Halves>
      <Halves>
        <RefCasesCard v={v} a={a} />
        <ZeroCard v={v} />
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
      {a.modal}
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
