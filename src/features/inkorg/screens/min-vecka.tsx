"use client";
// Min vecka för samordnare och avtalsansvarig (beslut 2026-10-06; paket 2, UX-genomgången 2026-10-31) i Min veckas stil
// (src/ui/vecka.tsx): överst listan "Att göra" sorterad på sista tid, där varje ärende står en gång med sin knapp – avrop att
// acceptera, första möten att boka, insatser att starta, uppgifter (ring deltagaren), flaggor att kvittera och det som förfaller
// och är användarens eget ansvar. Ordningen och sammanslagningen räknas med todoRows (src/core/todo.ts).
// Avtalsansvarig (S5) börjar med det som är hans: beställarrapporten, åtgärdsplanerna, varningarna och målen. Inkorgen är en
// rad ("N i inkorgen – samordnaren hanterar") och flaggorna står under hans egna saker. /start leder hit.
import { useRef, useState, type ReactNode } from "react";
import { caseBookFirstMeeting } from "@/features/arenden/api";
import { alertAck } from "@/features/ledning/api";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import { plural } from "@/core/format";
import { slaStatus } from "@/core/sla";
import { addWorkingDays, fmtTime, fmtWeekday } from "@/core/time";
import { todoRows, todoSummary, whenText, type TodoPart } from "@/core/todo";
import { useCommand, useQuery } from "@/shell/backend";
import { Link } from "@/shell/nav";
import { useSession } from "@/shell/session";
import {
  Badge, BuildPhase, Button, Card, CaseLink, DateInput, ErrorNotice, Field, FormGrid, Grid, Icon, Kpi, Loading, Meter, Modal, Notice, Row, TextArea,
  TimeInput, TitleLink, toast, TodoList, WeekPage, type TodoItem, type TodoStatus,
} from "@/ui";
import { TodayGroupsCard } from "@/features/aktiviteter/screens/idag";
import { inboxRowPath, inboxStart, inboxTaskDone, type AlertView, type InboxRow, type StartTask, type StartView } from "../api";
import { CLASSIFICATION, METHOD } from "../texts";
import { AcceptModal } from "./modals";
import { MiniList, MiniRow } from "./parts";

const SEV: Record<AlertView["severity"], [string, "red" | "grey" | "outline", "alert" | "alert-circle" | "info"]> = {
  critical: ["Kritisk", "red", "alert"],
  warning: ["Bevaka", "grey", "alert-circle"],
  info: ["Info", "outline", "info"],
};

export function SamMinVeckaScreen() {
  const q = useQuery(inboxStart, {});
  const { actor } = useSession();
  return (
    <WeekPage
      today={q.data?.today ?? null}
      actions={
        <Row gap="sm">
          {/* Avtalsansvarig: inkorgen är samordnarens (en rad under att göra-listan). */}
          {actor.role !== "avtalsansvarig" && (
            <Button icon="inbox" to="/inkorg">
              Öppna avropsinkorgen
            </Button>
          )}
          <Button icon="plus" to="/aktiviteter/ny">
            Ny aktivitet
          </Button>
        </Row>
      }
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : <Week v={q.data} />}
    </WeekPage>
  );
}

type Booking = NonNullable<StartTask["rebook"]>;
type Dialog = { kind: "ack"; a: AlertView } | { kind: "book"; c: Booking; rebook?: boolean } | { kind: "accept"; caseId: string; caseNumber: string } | null;

/**
 * En del i att göra-listan: rubrik, anmärkningar och åtgärd. restNotes = anmärkningarna när delen slås ihop med något annat i
 * ärendet (då står inte delens rubrik i radens rubrik). flag = en flagga (Kvittera med en textknapp när den inte är radens åtgärd).
 */
type Part = TodoPart & {
  icon: TodoItem["icon"]; title: ReactNode; notes: ReactNode[]; restNotes?: ReactNode[]; action?: ReactNode; flag?: AlertView;
  /** En andra åtgärd som textknapp under anmärkningarna (t.ex. "Deltagaren kom inte" bredvid Starta insatsen). */
  extra?: ReactNode;
};

/** Ordningen vid samma tid och för det som saknar tid – och vilken del i ett ärende som ger raden dess knapp (lägre först). */
// Flaggorna väger lätt: i ett ärende som också har ett avrop att acceptera eller ett möte att boka är det den åtgärden som gäller.
const W = { rapport: 4, komplettering: 8, avrop: 10, atgardsplan: 15, boka: 20, starta: 25, uppgift: 30, kritisk: 45, forfaller: 50, avropOvrigt: 55, bevaka: 60 } as const;

const statusOf = (dueAt: string | null, now: string): TodoStatus | null => {
  if (!dueAt) return null;
  const s = slaStatus(dueAt, null, { now });
  return s.tone === "over" ? { text: s.label, tone: "late" } : s.tone === "urgent" ? { text: s.label, tone: "urgent" } : s.tone === "soon" ? { text: s.label, tone: "soon" } : null;
};

/** Ärendenumret som länk (den som arbetar i inkorgen ser ärendenummer – namnen står i deltagarkortet). */
const caseTitle = (caseId: string, caseNumber: string, what: ReactNode) => (
  <>
    <CaseLink caseId={caseId} caseNumber={caseNumber} className="-ml-1.5" /> <span className="font-bold">· {what}</span>
  </>
);

function Week({ v }: { v: StartView }) {
  const { actor } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const taskDone = useCommand(inboxTaskDone);
  const handles = actor.role === "avtalsansvarig";
  const now = v.now;

  const done = async (t: StartTask, text: string) => {
    const r = await taskDone.run({ taskId: t.id });
    if (r.ok) toast(text);
  };
  const ackButton = (a: AlertView, ghost = false) => (
    <Button kind={ghost ? "ghost" : "secondary"} icon="check" onClick={() => setDialog({ kind: "ack", a })}>
      {ghost ? "Kvittera flaggan" : "Kvittera"} <span className="sr-only">{a.caseNumber ? `${a.caseNumber} – ` : ""}{a.title}</span>
    </Button>
  );
  const alertPart = (a: AlertView): Part => {
    const [sl, tone, icon] = SEV[a.severity] ?? SEV.info;
    const note = (withTitle: boolean) => (
      <span key="f" className="inline-flex flex-wrap items-center gap-x-1.5">
        <Badge tone={tone} icon={icon}>
          {sl}
        </Badge>
        {a.phase && <BuildPhase fas={a.phase} />}
        <span>
          {withTitle ? <b className="text-antracit">{a.title}. </b> : null}
          {a.text} <span className="whitespace-nowrap">({a.when})</span>
        </span>
      </span>
    );
    return {
      key: `flagga:${a.key}`, group: a.caseId, dueAt: null, weight: a.severity === "critical" ? W.kritisk : W.bevaka, flag: a, icon: a.severity === "critical" ? "alert" : "flag",
      title: a.caseId && a.caseNumber ? caseTitle(a.caseId, a.caseNumber, a.title) : <TitleLink to={a.href}>{a.title}</TitleLink>,
      notes: [note(false)], restNotes: [note(true)],
      action: ackButton(a),
    };
  };

  const parts: Part[] = [];
  if (handles) {
    // Avtalsansvarig: beställarrapporten och åtgärdsplanerna först – sedan uppgifter, flaggor står i ett eget avsnitt.
    if (v.summaryReport) {
      const r = v.summaryReport;
      parts.push({
        key: `rapport:${r.id}`, dueAt: r.due?.dueAt ?? null, weight: W.rapport, icon: "chart", title: r.title,
        notes: ["Lämnas till kommunen utanför Miljonmatch. Byggs bara av godkända uppgifter."],
        action: r.href ? (
          <Button kind="secondary" iconRight="arrow-right" to={r.href}>
            Granska <span className="sr-only">{r.title.toLowerCase()}</span>
          </Button>
        ) : undefined,
      });
    }
    for (const x of v.deviations) {
      parts.push({
        key: `avvikelse:${x.id}`, dueAt: x.due?.dueAt ?? null, weight: W.atgardsplan, icon: "flag",
        title: <TitleLink to={x.href}>{x.description}</TitleLink>, notes: [`Åtgärdsplan · ${x.sub}`],
      });
    }
  } else {
    // Samordnaren: avropen i inkorgen, första möten att boka och insatser att starta.
    for (const x of v.items) parts.push(inboxPart(x, setDialog));
    for (const c of v.firstMeetings.rows) {
      parts.push({
        key: `boka:${c.caseId}`, group: c.caseId, dueAt: c.due?.dueAt ?? null, weight: W.boka, icon: "calendar", title: caseTitle(c.caseId, c.caseNumber, "Första mötet ska bokas"),
        notes: [c.sub],
        action: (
          <Button kind="secondary" icon="calendar" onClick={() => setDialog({ kind: "book", c })}>
            Boka första mötet <span className="sr-only">för {c.caseNumber}</span>
          </Button>
        ),
      });
    }
    for (const c of v.toStart) {
      // Deltagaren kom inte till första mötet (Karims beslut 2026-11-09): raden blir "Boka nytt första möte". Avsluta insatsen är
      // coachens (deltagarkortet och coachens Min vecka).
      if (c.noShow) {
        parts.push({
          key: `starta:${c.caseId}`, group: c.caseId, dueAt: c.firstMeetingAt, weight: W.starta, icon: "calendar",
          title: (
            <>
              <span className="font-bold">Boka nytt första möte –</span> <CaseLink caseId={c.caseId} caseNumber={c.caseNumber} className="-ml-1.5" />
            </>
          ),
          notes: [`${c.noShow.text} Coach ${c.coachName}. Kommer deltagaren aldrig avslutar coachen insatsen. Kommunen har inte fått något besked.`],
          action: (
            <Button kind="secondary" icon="calendar" onClick={() => setDialog({ kind: "book", c: c.rebook, rebook: true })}>
              Boka nytt första möte <span className="sr-only">för {c.caseNumber}</span>
            </Button>
          ),
        });
        continue;
      }
      parts.push({
        key: `starta:${c.caseId}`, group: c.caseId, dueAt: c.firstMeetingAt, weight: W.starta, icon: "play", title: caseTitle(c.caseId, c.caseNumber, "Insats att starta"),
        notes: [`${c.sub}. Första mötet har hållits – coachen kan också starta insatsen.`],
        action: (
          <Button kind="secondary" icon="play" to={`/arenden/${encodeURIComponent(c.caseId)}?starta=1`}>
            Starta insatsen <span className="sr-only">{c.caseNumber}</span>
          </Button>
        ),
        // Mötets tid har varit och inget är registrerat: "Deltagaren kom inte" som andra åtgärd.
        extra: c.canRegisterNoShow ? (
          <Button kind="ghost" icon="x-circle" to={`/arenden/${encodeURIComponent(c.caseId)}?uteblev=1`}>
            Deltagaren kom inte <span className="sr-only">{c.caseNumber}</span>
          </Button>
        ) : undefined,
      });
    }
    for (const a of v.alerts) parts.push(alertPart(a));
  }
  // Uppgifter till rollen (S2: uppgiften att ringa deltagaren har första mötets tid som sista tid och numret i raden).
  for (const t of v.tasks) parts.push(taskPart(t, { done, pending: taskDone.pending, rebook: (c) => setDialog({ kind: "book", c, rebook: true }) }));
  // Det som förfaller och är mitt ansvar. Svar på avrop, första möten, åtgärdsplaner och beställarrapporten står redan i sina rader.
  const covered = new Set(parts.map((p) => p.group).filter(Boolean));
  for (const x of v.deadlines.mine) {
    if (x.caseId && covered.has(x.caseId) && (x.kind === "avrop_svar" || x.kind === "forsta_mote")) continue;
    if (handles && (x.kind === "atgardsplan" || x.kind === "bestallarrapport")) continue;
    parts.push({
      key: `dl:${x.id}`, group: x.caseId, dueAt: x.dueAt, weight: W.forfaller, icon: "clock",
      title: x.caseId && x.caseNumber ? caseTitle(x.caseId, x.caseNumber, x.label) : <TitleLink to={x.href}>{x.label}{x.count ? ` · ${x.count} ärenden` : ""}</TitleLink>,
      notes: [dlNote(x, false, now)], restNotes: [dlNote(x, true, now)],
      action: x.caseId && x.href ? (
        <Button kind="ghost" iconRight="arrow-right" to={x.href}>
          Öppna <span className="sr-only">{x.label.toLowerCase()} {x.caseNumber}</span>
        </Button>
      ) : undefined,
    });
  }

  const rows = todoRows(parts);
  const sum = todoSummary(rows, now);
  const items: TodoItem[] = rows.map((r) => {
    const flags = r.rest.map((p) => p.flag).filter((f): f is AlertView => !!f);
    // Övriga delar i samma ärende behåller sina knappar (t.ex. "Ringt – kallad" när ärendet också har ett avrop att svara på).
    const others = r.rest.filter((p) => !p.flag && p.action);
    const extras = [r.main, ...r.rest].filter((p) => p.extra);
    return {
      key: r.key, icon: r.main.icon, title: r.main.title, when: r.dueAt ? `Senast ${whenText(r.dueAt, now)}` : undefined, status: statusOf(r.dueAt, now),
      notes: [...r.main.notes, ...r.rest.flatMap((p) => p.restNotes ?? p.notes)], action: r.main.action,
      // Flaggor i ett ärende som har en annan åtgärd: kvitteras med en textknapp under anmärkningarna.
      children:
        others.length || flags.length || extras.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {extras.map((p) => <span key={`${p.key}:extra`} className="inline-flex flex-wrap gap-x-2">{p.extra}</span>)}
            {others.map((p) => <span key={p.key} className="inline-flex flex-wrap gap-x-2">{p.action}</span>)}
            {flags.map((f) => <span key={f.key}>{ackButton(f, true)}</span>)}
          </div>
        ) : null,
    };
  });
  const flagRows = handles ? todoRows(v.alerts.map(alertPart)) : [];

  return (
    <>
      <TodoList
        id="mv-att-gora"
        title="Att göra"
        icon="check-square"
        summary={`${plural(sum.total, "sak", "saker")}${sum.late ? ` · ${sum.late} försenad${sum.late === 1 ? "" : "e"}` : ""}`}
        items={items}
        initial={12}
        empty={handles ? "Inget att göra just nu – beställarrapporten och åtgärdsplanerna är klara." : "Inget att göra just nu – inkorgen är tom och alla första möten är bokade."}
        foot={
          <>
            Sorterat på sista tid.{" "}
            <Link to="/forfaller" className="inline-flex min-h-11 items-center font-bold text-antracit underline underline-offset-3">
              Allt som förfaller
            </Link>
          </>
        }
      />

      {!handles && <AckedFlags acked={v.acked} />}

      {handles && (
        <>
          <InboxLine count={v.items.length} />
          <Section title="Varningar och mål" icon="target">
            <Notice tone={v.warnings.issued > 0 ? "warn" : "info"} icon="alert-circle" title={`Skriftliga varningar: ${v.warnings.issued} av ${v.warnings.max}`}>
              {v.warnings.text}
              {v.deviationsHref && (
                <>
                  {" "}
                  <Link to={v.deviationsHref} className="font-bold text-antracit underline underline-offset-3">
                    Alla avtalsavvikelser
                  </Link>
                </>
              )}
            </Notice>
            <Goals v={v} />
          </Section>
          <TodoList
            id="mv-flaggor"
            title={`Flaggor (${v.alerts.length})`}
            icon="flag"
            initial={5}
            items={flagRows.map((r) => ({ key: r.key, icon: r.main.icon, title: r.main.title, notes: r.main.notes, action: r.main.action }))}
            empty="Inga öppna flaggor. Allt är kvitterat."
            foot="Flaggor kvitteras med en kort åtgärdsplan. Kvitteringen sparas med namn och tid."
          />
          <AckedFlags acked={v.acked} />
        </>
      )}

      {!handles && (
        <>
          {v.groupsToday.length > 0 && <TodayGroupsCard groups={v.groupsToday} now={v.now} today={v.today} />}
          <Deviations v={v} />
          <Goals v={v} />
        </>
      )}
      <UnreadNotices hideEmpty />

      {dialog?.kind === "ack" && <AckModal a={dialog.a} onClose={() => setDialog(null)} />}
      {dialog?.kind === "book" && <BookModal c={dialog.c} rebook={dialog.rebook} today={v.today} meetingText={v.meetingText} onClose={() => setDialog(null)} />}
      {dialog?.kind === "accept" && <AcceptModal caseId={dialog.caseId} caseNumber={dialog.caseNumber} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Förfallotidens anmärkning: beskrivningen (utan ärendenumret, som står i rubriken) – med typen när den slås ihop med något annat. */
function dlNote(x: StartView["deadlines"]["mine"][number], withLabel: boolean, now: string): string {
  const desc = (x.caseId ? (x.sub ?? "").replace(`${x.caseNumber} · `, "").replace(x.caseNumber ?? "", "") : x.sub) ?? "";
  const text = [withLabel ? `${x.label}: sista dag ${whenText(x.dueAt, now)}` : null, desc || null, x.provisional ? "sista dag ej fastställd med kommunen" : null]
    .filter(Boolean)
    .join(" · ");
  return text || x.label;
}

/** Ett avrop eller mejl i inkorgen. Beställningen accepteras i dialogen (samma som i inkorgen), övrigt öppnas i inkorgen. */
function inboxPart(x: InboxRow, setDialog: (d: Dialog) => void): Part {
  const what = `${x.from} · ${CLASSIFICATION[x.cls]} · ${(METHOD[x.method] ?? METHOD.manual).label}${x.missing.length ? ` · saknar ${x.missing.join(" och ")}` : ""}`;
  const acceptable = x.cls === "order" && !!x.caseId && !!x.caseNumber && (x.status === "acknowledged" || x.status === "received");
  // En textnod: rubriken bryts som vanlig text på smal skärm.
  const title = <TitleLink to={inboxRowPath(x)}>{`${x.caseNumber && !x.subject.includes(x.caseNumber) ? `${x.caseNumber} · ` : ""}${x.subject}`}</TitleLink>;
  return {
    key: `inkorg:${x.id}`, group: x.caseId, dueAt: x.sla?.dueAt ?? null,
    weight: x.cls === "supplement" ? W.komplettering : x.cls === "order" ? W.avrop : W.avropOvrigt,
    icon: x.cls === "order" ? "inbox" : x.cls === "supplement" ? "link" : "message-circle",
    title, notes: [what],
    action: acceptable ? (
      <Button kind="secondary" icon="check" onClick={() => setDialog({ kind: "accept", caseId: x.caseId as string, caseNumber: x.caseNumber as string })}>
        Acceptera {x.caseNumber}
      </Button>
    ) : (
      <Button kind="ghost" iconRight="arrow-right" to={inboxRowPath(x)}>
        {x.cls === "supplement" ? "För in kompletteringen" : "Öppna mejlet"} <span className="sr-only">{x.caseNumber ?? x.subject}</span>
      </Button>
    ),
  };
}

/**
 * Deltagarens telefonnummer i uppgiften att ringa (S2). Numret är markerbar text med knappen Kopiera numret – aldrig en
 * tel:-länk (CLAUDE.md punkt 2: inga personuppgifter i URL:er). navigator.clipboard.writeText anropas direkt i klickhändelsen;
 * går det inte (ingen behörighet, osäker sida eller ramen i prototypen) markeras numret så att det kan kopieras med tangentbordet.
 * Numret kommer bara med i vy-modellen när rollen redan får läsa personen (StartTask.call.phone).
 */
function PhoneToCopy({ phone, caseNumber }: { phone: string; caseNumber: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const selectNumber = () => {
    const el = ref.current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (el && sel) sel.selectAllChildren(el);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      toast("Numret är kopierat.");
    } catch {
      selectNumber();
      toast("Numret kunde inte kopieras automatiskt. Det är markerat – kopiera det med Ctrl+C (Cmd+C på Mac).", "error");
    }
  };
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-3">
      <span className="inline-flex min-h-11 items-center gap-1.5">
        <Icon name="phone" className="flex-none" />
        Telefon: <span ref={ref} data-phone="" className="font-bold text-antracit tabular-nums select-all">{phone}</span>
      </span>
      <Button kind="ghost" icon="copy" className="-ml-1.5 px-1.5" onClick={() => void copy()}>
        Kopiera numret <span className="sr-only">till deltagaren i {caseNumber ?? "ärendet"}</span>
      </Button>
    </span>
  );
}

/** En uppgift. Ring deltagaren (S2): numret att kopiera, "Ringt – kallad" stänger uppgiften och "Boka om" öppnar bokningen. */
function taskPart(
  t: StartTask,
  h: { done: (t: StartTask, text: string) => Promise<void>; pending: boolean; rebook: (c: Booking) => void },
): Part {
  const [head, ...tail] = t.text.split(" – ");
  const rest = tail.join(" – ");
  const call = t.call;
  const notes: ReactNode[] = [];
  if (call) {
    notes.push(rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : t.text);
    notes.push(
      call.phone ? (
        <PhoneToCopy key="tel" phone={call.phone} caseNumber={t.caseNumber} />
      ) : (
        "Telefonnummer saknas i deltagarkortet – fråga beställande handläggare."
      ),
    );
  } else notes.push(t.text);
  notes.push(t.sub);
  return {
    key: `uppgift:${t.id}`, group: t.caseId ?? null, dueAt: t.dueAt, weight: W.uppgift, icon: call ? "phone" : "check-square",
    title: call ? (
      t.href ? <TitleLink to={t.href}>{`${head}${t.caseNumber ? ` – ${t.caseNumber}` : ""}`}</TitleLink> : `${head}${t.caseNumber ? ` – ${t.caseNumber}` : ""}`
    ) : (
      <TitleLink to={t.href}>{t.kind === "report_correction" ? `Rätta rapporterna${t.caseNumber ? ` – ${t.caseNumber}` : ""}` : "Uppgift till dig"}</TitleLink>
    ),
    notes,
    action: call?.firstMeeting ? (
      <>
        <Button kind="secondary" icon="check" pending={h.pending} onClick={() => void h.done(t, "Uppgiften är klar – deltagaren är kallad.")}>
          Ringt – kallad <span className="sr-only">{t.caseNumber}</span>
        </Button>
        {t.rebook && (
          <Button kind="ghost" icon="calendar" onClick={() => h.rebook(t.rebook as Booking)}>
            Boka om <span className="sr-only">första mötet för {t.caseNumber}</span>
          </Button>
        )}
      </>
    ) : (
      <Button kind="secondary" icon="check" pending={h.pending} onClick={() => void h.done(t, "Uppgiften är markerad som klar.")}>
        {call ? "Ringt – klar" : "Markera som klar"} <span className="sr-only">{t.caseNumber ?? ""}</span>
      </Button>
    ),
  };
}

/** Kvitterade flaggor med åtgärdsplanen – stängda från början (knappen Visa kvitterade). Inget när inget är kvitterat. */
function AckedFlags({ acked }: { acked: StartView["acked"] }) {
  const [open, setOpen] = useState(false);
  if (!acked.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <Button kind="ghost" icon={open ? "chevron-up" : "chevron-down"} ariaPressed={open} onClick={() => setOpen(!open)}>
          {open ? "Dölj kvitterade" : `Visa kvitterade (${acked.length})`}
        </Button>
      </div>
      {open && (
        <ul aria-label="Kvitterade flaggor" className="m-0 flex list-none flex-col rounded-card border border-ljusgra bg-vit p-0">
          {acked.map((a) => (
            <li key={`ack-${a.key}`} className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
              <Icon name="check-circle" className="mt-1 flex-none" />
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="font-bold">{a.title}</span>
                <span className="text-body text-text-muted">{a.text}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Avtalsansvarig: inkorgen är samordnarens – en rad med länk. */
function InboxLine({ count }: { count: number }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-ljusgra bg-vit px-[18px] py-2">
      <Icon name="inbox" />
      <Link to="/inkorg" className="inline-flex min-h-11 items-center font-bold text-antracit underline underline-offset-3">
        {count === 0 ? "Inkorgen är tom" : `${count} i inkorgen`}
      </Link>
      <span className="text-body text-text-muted">– samordnaren hanterar avropen och första mötena.</span>
    </div>
  );
}

/** Rubrik utan ram (versal etikett med ikon) – samma stil som korten. */
function Section({ title, icon, children }: { title: string; icon: "target" | "flag"; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 text-label font-extrabold tracking-[0.1em] uppercase">
        <Icon name={icon} />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Målkorten (nyckeltalen mot Miljonbemannings interna mål) – längst ned, utan kraftig ram. */
function Goals({ v }: { v: StartView }) {
  if (!v.kpis.length) return null;
  return (
    <Grid cols={2} className="max-[620px]:grid-cols-1">
      {v.kpis.map((k) => (
        // Inga avrop i månaden (tom databas): klartext i stället för "–" och en tom mätare. Tunn ram – statusen står som text och ikon.
        <Kpi
          key={k.key}
          className="border border-ljusgra"
          label={k.label}
          value={k.meter ? k.value : <span className="text-h3 font-bold">Inga avrop ännu</span>}
          tone={k.below ? "watch" : undefined}
          statusText="Under internt mål"
          sub={k.sub}
        >
          {k.meter && (
            <Meter
              value={k.meter.value}
              max={1}
              tone="blue"
              label={k.meter.valueText}
              markers={k.meter.target != null ? [{ value: k.meter.target, label: k.meter.targetText, tone: "dark" }] : []}
            />
          )}
          {k.late.length > 0 && (
            <div className="flex flex-col">
              <span className="text-body text-text-muted">Inte i tid:</span>
              <span className="flex flex-wrap items-center gap-x-1 text-body">
                {k.late.map((c) => (
                  <CaseLink key={c.caseId} caseId={c.caseId} caseNumber={c.caseNumber} />
                ))}
              </span>
            </div>
          )}
        </Kpi>
      ))}
    </Grid>
  );
}

/** Samordnarens avtalsavvikelser (avtalsansvarig har åtgärdsplanerna i att göra-listan). Inget kort när det inte finns några. */
function Deviations({ v }: { v: StartView }) {
  if (!v.deviations.length) return null;
  return (
    <Card
      title="Avtalsavvikelser"
      icon="flag"
      actions={<BuildPhase fas={2} />}
      flush
      foot={
        v.deviationsHref ? (
          <Button kind="ghost" iconRight="arrow-right" to={v.deviationsHref}>
            Alla avtalsavvikelser
          </Button>
        ) : undefined
      }
    >
      <MiniList>
        {v.deviations.map((x) => (
          <MiniRow
            key={x.id}
            left={x.due ? <span className="text-body font-bold whitespace-nowrap">Åtgärdsplan {whenText(x.due.dueAt, v.now)}</span> : null}
            main={<TitleLink to={x.href}>{x.description}</TitleLink>}
            sub={x.sub}
          />
        ))}
      </MiniList>
    </Card>
  );
}

function AckModal({ a, onClose }: { a: AlertView; onClose: () => void }) {
  const ack = useCommand(alertAck);
  const [plan, setPlan] = useState("");
  const [tried, setTried] = useState(false);
  const err = plan.trim().length < 10 ? "Skriv en kort åtgärdsplan – vad görs, av vem och när." : null;
  const submit = async () => {
    setTried(true);
    if (err) return;
    const r = await ack.run({ key: a.key, plan: plan.trim() });
    if (!r.ok) {
      toast("Flaggan kunde inte kvitteras.", "error");
      return;
    }
    toast("Flaggan är kvitterad. Åtgärdsplanen är sparad i revisionsloggen.");
    onClose();
  };
  return (
    <Modal
      title="Kvittera flagga"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="check" pending={ack.pending} onClick={() => void submit()}>
            Kvittera
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="font-bold">{a.title}</span>
        <span>{a.text}</span>
      </div>
      <Field
        id="ink-ack-plan"
        label="Kort åtgärdsplan"
        required
        help="Vad görs, av vem och när?"
        error={tried ? err : null}
      >
        <TextArea value={plan} onValueChange={setPlan} rows={3} maxLength={500} />
      </Field>
      <div className="text-text-muted">Kvitteringen sparas med namn och tid. Flaggan kommer tillbaka om läget ändras.</div>
    </Modal>
  );
}

function BookModal({ c, rebook, today, meetingText, onClose }: { c: Booking; rebook?: boolean; today: string; meetingText: string; onClose: () => void }) {
  const bookCmd = useCommand(caseBookFirstMeeting);
  const [date, setDate] = useState(addWorkingDays(today, 1));
  const [time, setTime] = useState("10:00");
  const [tried, setTried] = useState(false);
  const err = !date ? "Välj datum." : date < today ? "Datumet har redan passerat." : null;
  const submit = async () => {
    setTried(true);
    if (err || !time) return;
    const r = await bookCmd.run({ caseId: c.caseId, at: `${date}T${time}` });
    if (!r.ok) {
      toast(r.message ?? "Mötet kunde inte bokas.", "error");
      return;
    }
    toast(`Första mötet för ${c.caseNumber} är bokat ${fmtWeekday(date)} kl. ${fmtTime(`${date}T${time}`)}. ${r.invitation}`);
    onClose();
  };
  return (
    <Modal
      title={`${rebook ? "Boka om första mötet" : "Boka första möte"} – ${c.caseNumber}`}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="calendar" pending={bookCmd.pending} onClick={() => void submit()}>
            Boka mötet
          </Button>
        </>
      }
    >
      <p>
        Huvudcoach: <b>{c.coachName}</b>. Mötet ska vara bokat senast {c.dueText} (inom {meetingText} från avropet).
        {rebook ? " Den nya tiden ersätter den gamla." : ""}
      </p>
      <FormGrid>
        <Field id="ink-b-date" label="Datum" required help="En vardag." error={tried ? err : null}>
          <DateInput value={date} onValueChange={setDate} />
        </Field>
        <Field id="ink-b-time" label="Tid" required>
          <TimeInput value={time} onValueChange={setTime} />
        </Field>
      </FormGrid>
      {/* Ingen varning för en tid efter avtalets gräns (Karims beslut 2026-11-11: "Det ska inte vara med"). */}
      <div className="text-text-muted">Deltagaren får kallelsen med e-post och SMS när det går. Går det inte får samordnaren en uppgift att ringa deltagaren. Kallelsen innehåller bara tid och plats.</div>
    </Modal>
  );
}
