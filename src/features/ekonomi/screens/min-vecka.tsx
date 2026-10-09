"use client";
// Min vecka för ekonomen (beslut 2026-10-06) i coachens stil (src/ui/vecka.tsx): fakturakörningen, uppgifterna, fakturor som
// saknar beställarreferens och preskriptionsrisken – samma kort som på Fakturering (/ekonomi, ./start-cards.tsx), som finns kvar under fliken
// Ekonomi. Fråga: ekonomi.start (commercial – stängd för begränsade testare, som förut) och notiser.list.
import { TESTER_HIDDEN_PAGE } from "@/api/tester-access";
import { kr, num } from "@/core/format";
import { fmtDateShort, fmtTime, monthName } from "@/core/time";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import { useWeekToday } from "@/features/vecka/today";
import { useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import { Button, DemoNote, ErrorNotice, focusSection, Kpi, Loading, Notice, Split, Stack, WeekKpis, WeekPage } from "@/ui";
import { ekoStart, type BillingStartView } from "../api";
import { cap, plural } from "../model";
import { WRAP } from "./parts";
import { RefInvoicesCard, ReturnedCard, RunCard, runPath, TasksCard, UnbilledCard, useBillingActions, ZeroCard } from "./start-cards";

/** Belopp i rutan: siffran krymper så att "511 332 kr" får plats också i en smal ruta (som Faktureringens rutor). */
const AMOUNT_KPI = "max-[620px]:p-3 [container-type:inline-size] [&>div:nth-child(2)]:whitespace-nowrap [&>div:nth-child(2)]:text-[clamp(1.25rem,12cqi,2rem)]";
/** Ruta med text i stället för siffra (tom databas: "Inget ännu"). */
const TEXT_KPI = "max-[620px]:p-3 [&>div:nth-child(2)]:text-h3";

export function EkonomMinVeckaScreen() {
  const today = useWeekToday();
  const { hidesCommercial } = useSession();
  // En begränsad testare får inte agera som ekonom (src/api/tester-access.ts) – servern nekar dessutom frågorna.
  if (hidesCommercial) {
    return (
      <WeekPage today={today}>
        <Notice tone="info">{TESTER_HIDDEN_PAGE}</Notice>
      </WeekPage>
    );
  }
  return <EkonomWeek today={today} />;
}

function EkonomWeek({ today }: { today: string | null }) {
  const q = useQuery(ekoStart, {});
  const cur = q.data?.current ?? null;
  return (
    <WeekPage
      today={today}
      className={WRAP}
      actions={
        <Button kind="primary" iconRight="arrow-right" to={cur ? `/ekonomi/${cur.month}` : "/ekonomi"}>
          {cur ? `Öppna körningen ${monthName(cur.month).split(" ")[0]}` : "Fakturering"}
        </Button>
      }
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : <Week v={q.data} />}
      <DemoNote>Fortnox, kreditering och statushämtning är simulerade. Allt du gör sparas i revisionsloggen.</DemoNote>
    </WeekPage>
  );
}

function Week({ v }: { v: BillingStartView }) {
  const a = useBillingActions(v);
  const cur = v.current;
  const openTasks = v.tasks.filter((t) => t.status === "open");
  const limit = v.unbilled.limit;
  return (
    <>
      {/* Nyckeltalsraden finns alltid – även utan körning (tom databas) står det vad som gäller. */}
      <WeekKpis>
        {cur ? (
          <Kpi
            className={AMOUNT_KPI}
            to={runPath(cur.month)}
            actionHint="Visa"
            label={`${cap(monthName(cur.month).split(" ")[0])} att fakturera`}
            value={kr(cur.totalOre)}
            sub={`${plural(cur.invoices, "faktura", "fakturor")} · ${plural(cur.count, "rad", "rader")} · ${plural(cur.weeks, "vecka", "veckor")} · exkl. moms`}
          />
        ) : (
          <Kpi className={TEXT_KPI} label="Att fakturera" value="Inget ännu" sub="Underlaget räknas fram efter månadsskiftet" />
        )}
        {/* Bevaka i stället för röd: bara ett rött ämne per sida (preskriptionsrisken). */}
        <Kpi
          className={AMOUNT_KPI}
          to={cur ? runPath(cur.month) : undefined}
          actionHint={cur ? "Visa" : undefined}
          label="Stoppade fakturor"
          value={num(cur?.blocked ?? 0)}
          tone={cur?.blocked ? "watch" : undefined}
          statusText="Fyll i referensen"
          sub={cur?.blocked ? "Fel eller saknad beställarreferens" : "Inga stoppade"}
        />
        <Kpi
          className={AMOUNT_KPI}
          onClick={() => focusSection("mv-preskription")}
          actionHint="Visa"
          label="Preskriptionsrisk"
          value={kr(v.unbilled.totalOre)}
          tone={v.unbilled.count ? "alert" : undefined}
          statusText="Fakturera nu"
          sub={v.unbilled.count ? `${plural(v.unbilled.count, "vecka ofakturerad", "veckor ofakturerade")} i mer än ${limit} dagar` : `Inga veckor äldre än ${limit} dagar`}
        />
        {cur?.status === "draft" ? (
          <Kpi
            className={AMOUNT_KPI}
            to={runPath(cur.month)}
            actionHint="Visa"
            label="Senast i Fortnox"
            value={fmtDateShort(cur.due)}
            tone="watch"
            statusText="Bevaka tiden"
            sub={`${cur.dueRelative} kl. ${fmtTime(cur.due)} · internt mål ${cur.fortnoxDays} arbetsdagar efter månadsskiftet`}
          />
        ) : cur ? (
          <Kpi className={AMOUNT_KPI} onClick={() => focusSection("mv-uppgifter")} actionHint="Visa" label="Öppna uppgifter" value={num(openTasks.length)} sub="Från avtalsansvarig" />
        ) : (
          <Kpi className={AMOUNT_KPI} label="Senast i Fortnox" value="–" sub="Ingen körning pågår" />
        )}
      </WeekKpis>
      <Split wide>
        <Stack>
          <RunCard v={v} buttonKind="secondary" />
          <div id="mv-uppgifter" className="scroll-mt-4">
            <TasksCard v={v} a={a} />
          </div>
          <RefInvoicesCard v={v} a={a} />
        </Stack>
        <Stack>
          <div id="mv-preskription" className="scroll-mt-4">
            <UnbilledCard v={v} />
          </div>
          <ReturnedCard v={v} a={a} />
          <ZeroCard v={v} />
          <UnreadNotices />
        </Stack>
      </Split>
      {a.modal}
    </>
  );
}
