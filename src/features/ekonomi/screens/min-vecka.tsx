"use client";
// Min vecka för ekonomen (beslut 2026-10-06; paket 2, E2) i Min veckas stil (src/ui/vecka.tsx): en att göra-lista grupperad
// per faktura – en rad per faktura med alla anmärkningar (stoppad, beställarreferensen, returnerad, veckor utan närvaro att
// godkänna, preskriptionsrisk, sista dag i Fortnox) och en knapp – och uppgifterna till ekonomen. Varje siffra står på ett
// ställe. Fakturering (/ekonomi, ./start.tsx) behåller månadsöversikten och historiken. Fråga: ekonomi.start (commercial –
// stängd för begränsade testare, som förut) och notiser.list. Raderna räknas av invoiceTodos (../todo.ts).
import { TESTER_HIDDEN_PAGE } from "@/api/tester-access";
import { slaStatus } from "@/core/sla";
import { todoSummary, whenText } from "@/core/todo";
import { monthName } from "@/core/time";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import { sessionPing } from "@/features/session/api";
import { useWeekToday } from "@/features/vecka/today";
import { useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import { BuildPhase, Button, DemoNote, ErrorNotice, Loading, Notice, TodoList, WeekPage, type TodoItem, type TodoStatus } from "@/ui";
import { ekoStart, type BillingStartView } from "../api";
import { plural } from "../model";
import { invoiceTodos, type InvoiceTodoAction } from "../todo";
import { WRAP } from "./parts";
import { runPath, useBillingActions, type BillingActions } from "./start-cards";

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
  // Klockan (session.ping – demoklockan i prototypen): "försenad" och "kvar" i att göra-listan.
  const now = useQuery(sessionPing, {}).data?.now ?? null;
  const cur = q.data?.current ?? null;
  return (
    <WeekPage
      today={today}
      className={WRAP}
      actions={
        <Button kind="secondary" iconRight="arrow-right" to={cur ? `/ekonomi/${cur.month}` : "/ekonomi"}>
          {cur ? `Öppna körningen ${monthName(cur.month).split(" ")[0]}` : "Fakturering"}
        </Button>
      }
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data || !now ? <Loading /> : <Week v={q.data} now={now} />}
      <DemoNote>Fortnox, kreditering och statushämtning är simulerade. Allt du gör sparas i revisionsloggen.</DemoNote>
    </WeekPage>
  );
}

const statusOf = (dueAt: string | null, now: string): TodoStatus | null => {
  if (!dueAt) return null;
  const s = slaStatus(dueAt.includes("T") ? dueAt : `${dueAt}T23:59`, null, { now });
  return s.tone === "over" ? { text: s.label, tone: "late" } : s.tone === "urgent" ? { text: s.label, tone: "urgent" } : s.tone === "soon" ? { text: s.label, tone: "soon" } : null;
};

function Week({ v, now }: { v: BillingStartView; now: string }) {
  const a = useBillingActions(v);
  const rows = invoiceTodos(v, now);
  const sum = todoSummary(rows, now);
  const items: TodoItem[] = rows.map((r) => ({
    key: r.key,
    icon: r.action?.kind === "task" ? "inbox" : "file",
    when: r.dueAt ? `Senast ${whenText(r.dueAt, now)}` : undefined,
    status: statusOf(r.dueAt, now),
    title: r.title,
    notes: r.notes,
    action: r.action ? <ActionButton act={r.action} title={r.title} a={a} /> : null,
  }));
  return (
    <>
      <TodoList
        id="mv-att-gora"
        title="Att göra"
        icon="card"
        summary={`${plural(sum.total, "sak", "saker")}${sum.late ? ` · ${sum.late} försenad${sum.late === 1 ? "" : "e"}` : ""}`}
        items={items}
        empty="Inget att göra – alla fakturor har giltig referens och inga veckor väntar på godkännande."
        foot="En rad per faktura med alla anmärkningar. Månadsöversikten och historiken finns under Fakturering."
      />
      <UnreadNotices hideEmpty />
      {a.modal}
    </>
  );
}

/** Radens knapp. Kommandona är desamma som på Fakturering (useBillingActions). */
function ActionButton({ act, title, a }: { act: InvoiceTodoAction; title: string; a: BillingActions }) {
  const what = <>{" "}<span className="sr-only">– {title}</span></>;
  if (!a.canAct && act.kind !== "run" && act.kind !== "approve") return null;
  switch (act.kind) {
    case "ref":
      return (
        <Button kind="secondary" icon="edit" onClick={() => a.openRef(act)}>
          Fyll i referensen{what}
        </Button>
      );
    case "reissue":
      return (
        <>
          <Button kind="secondary" icon="refresh" pending={a.reissuePending} onClick={() => void a.reissue(act.row)}>
            Kreditera och skapa ny{what}
          </Button>
          <BuildPhase fas={2} />
        </>
      );
    case "approve":
      return (
        <Button kind="secondary" iconRight="arrow-right" to={runPath(act.month, { filter: "godkannande" })}>
          Godkänn veckorna{what}
        </Button>
      );
    case "run":
      return (
        <Button kind="secondary" iconRight="arrow-right" to={runPath(act.month)}>
          Öppna körningen{what}
        </Button>
      );
    case "task":
      return (
        <Button kind="secondary" icon="check" pending={a.taskDonePending} onClick={() => void a.taskDone(act.task)}>
          Markera som klar <span className="sr-only">– uppgiften från {act.task.fromName}</span>
        </Button>
      );
  }
}
