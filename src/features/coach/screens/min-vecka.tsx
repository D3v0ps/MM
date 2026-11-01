"use client";
// Min vecka (/min-vecka) – coachens startsida (paket 2, UX-genomgången 2026-10-31): överst listan "Att göra i dag" sorterad på
// tidsgräns – närvaro att registrera, insatser att starta, dagens möten och gruppaktiviteter, rapporter som förfaller,
// månadsbedömningarna, mötesrapporter att granska, meddelanden från kommunen och röstmeddelanden. Varje sak står en gång med sin
// knapp; bara nästa möte har en svart knapp. Under listan: Följ upp (påminnelser, egna flaggor och olästa notiser – samma ärende
// en gång), Att kartlägga (deltagare utan nivå) och veckokalendern bakom "Visa hela veckan". Ordningen räknas med todoRows
// (src/core/todo.ts), raderna ritas av kitet (TodoList i src/ui/vecka.tsx).
import { useState, type ReactNode } from "react";
import { GROUP_KIND_LABEL } from "@/core/group-activities";
import { plural } from "@/core/format";
import { todoRows, todoSummary, whenText, type TodoPart } from "@/core/todo";
import { addDays, dayOf, fmtDate, fmtDateShort, fmtDateTime, fmtTime, fmtWeekKey, holidayName, isoWeek, monthName, relative, WEEKDAYS } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Link, useNav } from "@/shell/nav";
import {
  Badge, Button, Card, CaseName, cn, DemoNote, Field, focusSoon, Icon, Input, Row, Split, Stack, TitleLink, toast, TodoList, WeekMore, WeekPage, type IconName,
  type TodoItem, type TodoStatus,
} from "@/ui";
import { alertAck } from "@/features/ledning/api";
import { notifRead } from "@/features/notiser/api";
import { pendingNotes } from "@/features/rost/api";
import { minVecka, type CalendarActivity, type MinVeckaView } from "../api";
import { ATT, kindOf, lc, PageState, Persp } from "./shared";

export function MinVeckaScreen() {
  const q = useQuery(minVecka, {});
  if (!q.data) return <PageState title="Min vecka" error={q.error} onRetry={() => void q.refetch()} />;
  return <MinVecka v={q.data} />;
}

type Part = TodoPart & { item: Omit<TodoItem, "key"> };

/** SLA-läget som status under tiden (text + ikon). "I god tid" visas inte – tiden står redan i raden. */
const slaToStatus = (sla: { label: string; tone: string }): TodoStatus | null =>
  sla.tone === "over" ? { text: sla.label, tone: "late" } : sla.tone === "urgent" ? { text: sla.label, tone: "urgent" } : sla.tone === "soon" ? { text: sla.label, tone: "soon" } : null;

/** "Senast i dag kl. 10.00" – en sista tid (skiljer sig från dagens möten, som bara har klockslaget). */
const by = (dueAt: string, now: string) => `Senast ${whenText(dueAt, now)}`;

/** Ordningen vid samma tid och för det som saknar tid (C1: närvaro, möten, mötesrapporter, månadsbedömningar, kommunen). */
const W = { narvaro: 10, starta: 15, forfaller: 18, mote: 20, manad: 30, utkast: 40, kommunen: 50, rost: 55 } as const;

function MinVecka({ v }: { v: MinVeckaView }) {
  const nav = useNav();
  const read = useCommand(notifRead);
  const voice = useQuery(pendingNotes, {});
  const now = v.now;
  const today = dayOf(now);
  const unreg = v.unregistered.count;
  const wLast = v.lastWeek.no;
  const pm = v.monthly.month;
  const openMessage = async (n: MinVeckaView["messages"][number]) => {
    if (n.notificationId) await read.run({ ids: [n.notificationId] }).catch(() => undefined);
    nav.push(`/arenden/${encodeURIComponent(n.caseId)}?flik=meddelanden`);
  };

  const parts: Part[] = [];
  // Närvaro att registrera (förra veckan) – med regeln om automatisk närvaro i en rad.
  if (unreg > 0) {
    parts.push({
      key: "narvaro", dueAt: v.reg.dueAt, weight: W.narvaro,
      item: {
        id: "mv-narvaro", icon: "check-square", when: by(v.reg.dueAt, now), status: slaToStatus(v.reg.sla),
        title: `Närvaro att registrera – vecka ${wLast}`,
        notes: [
          `${plural(unreg, "tillfälle", "tillfällen")} saknar närvaro: ${v.unregistered.byCase.map((r) => `${r.name} (${r.items.length})`).join(", ")}.`,
          ...(v.unregistered.waitingFor.length
            ? [`${v.unregistered.waitingFor.length === 1 ? "Veckorapporten" : "Veckorapporterna"} till ${v.unregistered.waitingFor.join(" och ")} publiceras när dina tillfällen är registrerade, senast ${v.reg.pubText}.`]
            : []),
          ...(v.autoPresentAt ? [`Det som saknar närvaro klockan ${v.autoPresentAt.replace(":", ".")} samma dag registreras automatiskt som närvarande – frånvaro registrerar du själv.`] : []),
        ],
        action: (
          <Button kind="secondary" icon="check-square" to="/narvaro?vecka=forra">
            Registrera närvaro <span className="sr-only">för vecka {wLast}</span>
          </Button>
        ),
      },
    });
  }
  // Insatser att starta (beslut 2026-10-08): bekräftade ärenden vars första möte är i dag eller har passerat.
  for (const c of v.toStart) {
    parts.push({
      key: `starta:${c.caseId}`, dueAt: c.firstMeetingAt, weight: W.starta,
      item: {
        icon: "play", when: whenText(c.firstMeetingAt, now).replace(/^./, (x) => x.toUpperCase()), title: <CaseName big caseId={c.caseId} name={c.name} caseNumber={c.caseNumber} />,
        notes: ["Insats att starta: första mötet har hållits. Starta insatsen så att tillfällen, närvaro och rapporter kommer igång."],
        action: (
          <Button kind="secondary" icon="play" to={`/arenden/${encodeURIComponent(c.caseId)}?starta=1`}>
            Starta insatsen <span className="sr-only">för {c.name} {c.caseNumber}</span>
          </Button>
        ),
      },
    });
  }
  // Dagens möten och andra enskilda tillfällen. Klara (passerade med närvaro och godkänd mötesrapport) står i listans fot.
  const done: string[] = [];
  for (const a of v.today) {
    const k = kindOf(a.kind);
    const past = a.startsAt < now;
    const isNext = v.next?.id === a.id;
    const ci = a.checkIn;
    const meetingDone = a.kind !== "möte" || !!ci?.approved;
    if (past && a.attendance && meetingDone) {
      done.push(`${fmtTime(a.startsAt)} ${a.name}`);
      continue;
    }
    const enc = encodeURIComponent(a.caseId);
    // C17: bara nästa möte har en svart knapp – övriga är textlänkar med ikon.
    const kind = isNext ? "primary" : "ghost";
    const who = <>{" "}<span className="sr-only">med {a.name}</span></>;
    const action: ReactNode =
      a.kind === "möte" && !ci ? (
        a.recordable ? (
          <Button kind={kind} icon="mic" to={`/avstamning/${enc}?spela=1`}>
            Spela in mötet{who}
          </Button>
        ) : (
          <Button kind={kind} icon="edit" to={`/avstamning/${enc}`}>
            Nytt möte{who}
          </Button>
        )
      ) : a.kind === "möte" && ci && !ci.approved ? (
        <Button kind={kind} icon="edit" to={`/avstamning/${enc}?avstamning=${encodeURIComponent(ci.id)}`}>
          Öppna mötet{who}
        </Button>
      ) : past && !a.attendance ? (
        <Button kind="ghost" icon="check-square" to={`/narvaro?vecka=denna&arende=${enc}`}>
          Registrera närvaro{who}
        </Button>
      ) : null;
    const status: TodoStatus | null = isNext
      ? { text: `Nästa · ${relative(a.startsAt, now)}`, tone: "next" }
      : past && !a.attendance
        ? { text: "Närvaro saknas", tone: "plain" }
        : past && a.attendance
          ? { text: ATT[a.attendance.status]?.label ?? "Registrerad", tone: "done" }
          : null;
    parts.push({
      key: `akt:${a.id}`, dueAt: a.startsAt, weight: W.mote,
      item: {
        icon: k.icon, when: fmtTime(a.startsAt), status, marked: isNext, title: <CaseName big caseId={a.caseId} name={a.name} caseNumber={a.caseNumber} />,
        notes: [`${k.label} · ${a.location} · ${a.durationMin} min${ci && !ci.approved ? " · mötet är påbörjat" : ""}`],
        action,
      },
    });
  }
  // Dagens gruppaktiviteter: en rad per aktivitet med länk till aktivitetsvyn (där närvaron tas).
  for (const g of v.groups) {
    const past = g.startsAt < now;
    const href = `/aktiviteter/${encodeURIComponent(g.id)}`;
    const isNext = v.next?.group && v.next.id === g.id;
    const all = g.registered === g.invited;
    parts.push({
      key: `grupp:${g.id}`, dueAt: g.startsAt, weight: W.mote,
      item: {
        testId: "dagens-gruppaktivitet", icon: "users", when: fmtTime(g.startsAt), marked: !!isNext,
        status: isNext ? { text: `Nästa · ${relative(g.startsAt, now)}`, tone: "next" } : past ? (all ? { text: "Närvaron är registrerad", tone: "done" } : { text: `${g.registered} av ${g.invited} registrerade`, tone: "plain" }) : null,
        title: <TitleLink to={href}>{g.name}</TitleLink>,
        notes: [`Gruppaktivitet · ${GROUP_KIND_LABEL[g.kind]} · ${g.location} · ${plural(g.invited, "deltagare", "deltagare")}${g.responsibleName ? ` · ansvarig ${g.responsibleName}` : ""}`],
        action: past && !all ? (
          <Button kind={isNext ? "primary" : "ghost"} icon="check-square" to={href}>
            Ta närvaro <span className="sr-only">för {g.name}</span>
          </Button>
        ) : null,
      },
    });
  }
  // Rapporter och uppföljningar som förfaller inom en vecka (månadsrapporterna står i månadsbedömningarnas rad).
  for (const x of v.due.other) {
    parts.push({
      key: `dl:${x.id}`, dueAt: x.dueAt, weight: W.forfaller,
      item: {
        icon: "file", when: by(x.dueAt, now), status: slaToStatus(x.sla),
        title: x.caseId && x.caseNumber && x.name ? (
          <>
            {x.label}: <CaseName big caseId={x.caseId ?? ""} name={x.name} caseNumber={x.caseNumber} />
          </>
        ) : x.label,
        notes: x.provisional ? ["Sista dag ej fastställd med kommunen – förslag i avtalet."] : [],
        action: x.href ? (
          <Button kind="secondary" iconRight="arrow-right" to={x.href}>
            Öppna <span className="sr-only">{x.label.toLowerCase()}{x.caseNumber ? ` ${x.caseNumber}` : ""}</span>
          </Button>
        ) : null,
      },
    });
  }
  // Månadsbedömningarna: en rad för månaden – nästa att bedöma som knapp, resten bakom "Visa alla".
  if (v.monthly.open.length > 0) {
    const first = v.monthly.open[0];
    const reports = v.due.monthly;
    parts.push({
      key: "manad", dueAt: v.monthly.dueAt, weight: W.manad,
      item: {
        id: "mv-manad", icon: "clipboard", when: <span title={v.monthly.dueNote}>Förslag: {by(v.monthly.dueAt, now).toLowerCase()}</span>,
        status: reports ? slaToStatus(reports.sla) : null,
        title: `Månadsbedömningar ${monthName(pm)}`,
        notes: [
          `${v.monthly.done} av ${v.monthly.total} godkända – ${plural(v.monthly.open.length, "kvar att gå igenom", "kvar att gå igenom")}. De är ifyllda automatiskt; du går igenom och godkänner.`,
          ...(reports ? [`Månadsrapporterna byggs av bedömningarna: ${reports.count} st ${reports.byStatus.draft ? `· ${reports.byStatus.draft} väntar på din bedömning ` : ""}${reports.byStatus.approved ? `· ${reports.byStatus.approved} godkända, ska levereras` : ""}`.trim()] : []),
        ],
        action: (
          <Button kind="secondary" iconRight="arrow-right" to={`/manadsbedomning/${encodeURIComponent(first.caseId)}?manad=${pm}`}>
            Bedöm {first.name} <span className="sr-only">{first.caseNumber}</span>
          </Button>
        ),
        children: v.monthly.open.length > 1 ? <MonthlyRest v={v} /> : null,
      },
    });
  }
  // Mötesrapporter att granska (AI-utkast) – ingen tidsgräns.
  for (const ci of v.drafts) {
    parts.push({
      key: `utkast:${ci.checkInId}`, dueAt: null, weight: W.utkast,
      item: {
        icon: "sparkles", title: <CaseName big caseId={ci.caseId} name={ci.name} caseNumber={ci.caseNumber} />,
        notes: [
          `Mötesrapport att granska – utkast från AI · möte ${fmtDateTime(ci.heldAt)} · ${ci.inputMethod === "teams" ? "Teams-transkript" : ci.inputMethod === "notes" ? "inklistrade anteckningar" : "inspelning"}`,
          `${ci.audioDeletedAt ? "Ljudet är raderat. " : ""}Råtranskriptet raderas när du godkänner, senast ${fmtDate(ci.rawTranscriptDeleteBy)}.`,
        ],
        action: (
          <Button kind="secondary" iconRight="arrow-right" to={`/avstamning/${encodeURIComponent(ci.caseId)}?avstamning=${encodeURIComponent(ci.checkInId)}`}>
            Granska <span className="sr-only">mötesrapporten för {ci.name} {ci.caseNumber}</span>
          </Button>
        ),
      },
    });
  }
  // Svara kommunen: olästa meddelanden, ett per ärende.
  for (const n of v.messages) {
    parts.push({
      key: `msg:${n.caseId}`, dueAt: null, weight: W.kommunen,
      item: {
        icon: "message", title: <CaseName big caseId={n.caseId} name={n.name} caseNumber={n.caseNumber} />,
        notes: [
          `Svara kommunen: ${n.count > 1 ? `${n.count} olästa meddelanden` : "nytt meddelande"} från ${n.from ?? "handläggaren"} · ${fmtDateTime(n.createdAt)}`,
          ...(n.excerpt ? [<q key="q" className="[quotes:none] before:content-['”'] after:content-['”']">{n.excerpt}</q>] : []),
        ],
        action: (
          <Button kind="secondary" iconRight="arrow-right" pending={read.pending} onClick={() => void openMessage(n)}>
            Läs och svara <span className="sr-only">– {n.name} {n.caseNumber}</span>
          </Button>
        ),
      },
    });
  }
  // Deltagarnas röstmeddelanden (fas 2).
  for (const r of voice.data ?? []) {
    parts.push({
      key: `rost:${r.id}`, dueAt: null, weight: W.rost,
      item: {
        icon: "mic", title: <CaseName big caseId={r.caseId} name={r.name} caseNumber={r.caseNumber} />,
        notes: [
          `Nytt röstmeddelande ${fmtDateTime(r.createdAt)} · ${r.translated ? `talat på ${r.languageName}, AI-översättning` : "AI-transkribering"}`,
          ...(r.excerpt ? [r.excerpt] : []),
        ],
        action: (
          <Button kind="secondary" iconRight="arrow-right" to={`/arenden/${encodeURIComponent(r.caseId)}?visa=rost`}>
            Läs röstmeddelandet <span className="sr-only">från {r.name}</span>
          </Button>
        ),
      },
    });
  }

  const rows = todoRows(parts);
  const sum = todoSummary(rows, now);
  const items: TodoItem[] = rows.map((r) => ({ key: r.key, ...r.main.item }));
  const foot = [
    unreg === 0 ? `Närvaron för vecka ${wLast} är registrerad.` : null,
    done.length ? `Klart i dag: ${done.join(", ")}.` : null,
  ].filter(Boolean).join(" ");

  return (
    <WeekPage
      today={today}
      actions={
        <Button icon="plus" to="/aktiviteter/ny">
          Ny aktivitet
        </Button>
      }
    >
      <TodoList
        id="mv-att-gora"
        title="Att göra i dag"
        icon="check-square"
        summary={`${plural(sum.total, "sak", "saker")}${sum.late ? ` · ${sum.late} försenad${sum.late === 1 ? "" : "e"}` : ""}`}
        items={items}
        empty="Inget att göra just nu – allt är registrerat och granskat."
        foot={foot || undefined}
      />
      {v.toMap.length > 0 ? (
        <Split wide>
          <FollowUp v={v} />
          <ToMap v={v} />
        </Split>
      ) : (
        <FollowUp v={v} />
      )}
      <WeekMore id="mv-veckan" label="Visa hela veckan" hideLabel="Dölj veckan">
        <Card title={`Veckokalender – vecka ${isoWeek(today).week}`} icon="calendar">
          <WeekCalendar mon={v.calendar.mon} acts={v.calendar.activities} now={now} />
        </Card>
      </WeekMore>
      <DemoNote>
        Kalendern visar aktiviteterna i dina aktiva ärenden. I den riktiga tjänsten kan den synkas med Outlook. Påminnelser om progression är interna regler för
        Miljonbemanning och går bara till dig. <Persp role="kommun_handlaggare" to="/portal/rapporter" label="Se vad handläggaren får" />
      </DemoNote>
    </WeekPage>
  );
}

/** Övriga månadsbedömningar att gå igenom – fälls ut under månadens rad. */
function MonthlyRest({ v }: { v: MinVeckaView }) {
  const [open, setOpen] = useState(false);
  const rest = v.monthly.open.slice(1);
  const id = "mv-manad-ovriga";
  return (
    <div className="flex flex-col gap-1">
      <div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="-ml-1.5 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-mb px-1.5 text-body font-bold text-antracit underline underline-offset-3 hover:bg-antracit-ton"
        >
          <Icon name={open ? "chevron-up" : "chevron-down"} />
          {open ? "Dölj de andra" : `Visa alla ${v.monthly.open.length}`}
        </button>
      </div>
      <ul id={id} hidden={!open} aria-label="Månadsbedömningar som återstår" className="m-0 flex list-none flex-col p-0">
        {rest.map((r) => (
          <li key={r.caseId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-ljusgra py-1">
            <TitleLink to={`/manadsbedomning/${encodeURIComponent(r.caseId)}?manad=${v.monthly.month}`}>
              {r.name} <span className="sr-only">– bedöm</span>
            </TitleLink>
            <span className="text-body text-text-muted tabular-nums">{r.caseNumber}</span>
            <span className="text-body text-text-muted">{r.prefilled ? "· ifylld automatiskt – gå igenom" : "· utkast"}{r.hasAi ? " · AI-utkast finns" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Följ upp
type FollowPart = TodoPart & { title: ReactNode; note: ReactNode; action?: ReactNode; flag?: MinVeckaView["flags"][number] };

/**
 * Följ upp: påminnelser om progression, egna flaggor och olästa notiser i en lista – samma ärende en gång (todoRows med
 * ärendet som grupp). Meddelanden från kommunen står i Att göra i dag (Svara kommunen) och räknas inte här.
 */
function FollowUp({ v }: { v: MinVeckaView }) {
  const parts: FollowPart[] = [];
  const caseTitle = (caseId: string, name: string, caseNumber: string) => <CaseName big caseId={caseId} name={name} caseNumber={caseNumber} />;
  const reminded = new Set(v.reminders.map((w) => w.caseId));
  for (const w of v.reminders) {
    parts.push({
      key: `p:${w.caseId}`, group: w.caseId, dueAt: null, weight: 20, title: caseTitle(w.caseId, w.name, w.caseNumber),
      note: `Påminnelse: ingen progression ${w.streak === 1 ? "förra veckan" : `${w.streak} veckor i rad`} – ${lc(w.reason)} (${fmtWeekKey(w.weekKey)}).`,
      action: (
        <Button kind="secondary" iconRight="arrow-right" to={`/avstamning/${encodeURIComponent(w.caseId)}`}>
          Öppna mötet <span className="sr-only">med {w.name} {w.caseNumber}</span>
        </Button>
      ),
    });
  }
  for (const f of v.flags) {
    const critical = f.severity === "critical";
    const primary: [string, string] | null =
      f.kind === "stuck" && f.caseId ? [`/kartlaggning/${encodeURIComponent(f.caseId)}`, "Slutför kartläggningen"]
        : f.kind === "absence" && f.caseId ? [`/avstamning/${encodeURIComponent(f.caseId)}`, "Öppna mötet"]
          : f.href ? [f.href, "Öppna"] : null;
    parts.push({
      key: `f:${f.key}`, group: f.caseId, dueAt: null, weight: critical ? 10 : 30, flag: f,
      title: f.caseId && f.name && f.caseNumber ? caseTitle(f.caseId, f.name, f.caseNumber) : f.title,
      note: (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <Badge tone={critical ? "red" : "grey"} icon={critical ? "alert" : "flag"}>
            {critical ? "Åtgärd krävs" : "Bevaka"}
          </Badge>
          <span>
            <b className="text-antracit">{f.title}.</b> {f.text}
          </span>
        </span>
      ),
      action: primary ? (
        <Button kind="secondary" iconRight="arrow-right" to={primary[0]}>
          {primary[1]} <span className="sr-only">– {f.name ?? f.title}</span>
        </Button>
      ) : undefined,
    });
  }
  for (const n of v.unread.items) {
    if (n.kind === "message") continue; // Svara kommunen i Att göra i dag
    if (n.kind === "progress_reminder" && n.caseId && reminded.has(n.caseId)) continue; // samma sak som påminnelsen
    parts.push({
      key: `n:${n.id}`, group: n.caseId, dueAt: null, weight: 40,
      title: n.caseId && n.name && n.caseNumber ? caseTitle(n.caseId, n.name, n.caseNumber) : n.title,
      note: (
        <span className="inline-flex items-center gap-1.5">
          <Icon name="bell" className="flex-none" />
          Oläst notis: {n.title}
        </span>
      ),
    });
  }
  const rows = todoRows(parts);
  const unread = v.unread.count;
  const items: TodoItem[] = rows.map((r) => {
    const all = [r.main, ...r.rest];
    const flags = all.map((p) => p.flag).filter((f): f is MinVeckaView["flags"][number] => !!f);
    const action = all.find((p) => p.action)?.action;
    return {
      key: r.key, icon: all.some((p) => p.flag?.severity === "critical") ? "alert" : all.some((p) => p.flag) ? "flag" : "bell", title: r.main.title,
      notes: all.map((p) => p.note), action,
      children: flags.length ? <FlagAcks flags={flags} /> : null,
    };
  });
  return (
    <TodoList
      id="mv-folj-upp"
      title="Följ upp"
      icon="bell"
      items={items}
      summary={unread ? <Link to="/notiser" className="inline-flex min-h-11 items-center font-bold text-antracit underline underline-offset-3">{plural(unread, "oläst notis", "olästa notiser")}</Link> : undefined}
      empty={
        <>
          Inget att följa upp – alla dina ärenden har dokumenterad progression och inga flaggor är öppna.{" "}
          <Link to="/notiser" className="font-bold text-antracit underline underline-offset-3">Öppna notiser</Link>
        </>
      }
      foot="Påminnelsen kommer när veckomålet inte nåtts eller när en godkänd mötesrapport saknas. Flaggor kvitteras med en kort åtgärd."
    />
  );
}

/** Kvittera flaggorna i raden: knappen visar fältet "Kort åtgärd". Efter kvitteringen: fokus till Följ upp-rubriken. */
function FlagAcks({ flags }: { flags: MinVeckaView["flags"] }) {
  return (
    <div className="flex flex-col gap-1">
      {flags.map((f) => (
        <FlagAck key={f.key} f={f} />
      ))}
    </div>
  );
}

function FlagAck({ f }: { f: MinVeckaView["flags"][number] }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState("");
  const ack = useCommand(alertAck);
  const id = `ack-${f.key.replace(/[^a-z0-9]/gi, "-")}`;
  const save = async () => {
    const res = await ack.run({ key: f.key, plan: plan.trim() }).catch(() => null);
    if (res && res.ok) {
      toast("Flaggan är kvitterad.");
      focusSoon("mv-folj-upp-rubrik");
    } else toast("Flaggan kunde inte kvitteras.", "error");
  };
  // Kvittera visar fältet och knappen försvinner: fokus till fältet. Avbryt: fokus tillbaka till Kvittera.
  const openAck = () => {
    setOpen(true);
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  };
  const cancelAck = () => {
    setOpen(false);
    requestAnimationFrame(() => document.getElementById(`${id}-kvittera`)?.focus());
  };
  if (!open) {
    return (
      <div>
        <Button id={`${id}-kvittera`} kind="ghost" icon="check" onClick={openAck}>
          Kvittera flaggan <span className="sr-only">{f.title}</span>
        </Button>
      </div>
    );
  }
  return (
    <Stack gap="sm" className="mt-1.5">
      <Field label={`Kort åtgärd – ${f.title}`} id={id} help="Skriv vad du gör åt flaggan.">
        <Input value={plan} onValueChange={setPlan} maxLength={160} />
      </Field>
      <Row gap="sm">
        <Button kind="primary" icon="check" disabled={!plan.trim()} pending={ack.pending} onClick={() => void save()}>
          Spara kvittering
        </Button>
        <Button kind="ghost" onClick={cancelAck}>
          Avbryt
        </Button>
      </Row>
    </Stack>
  );
}

// ---------------------------------------------------------------- Att kartlägga
/** Deltagare utan nivå (samma urval som Grupper och nivåer-sidans "Utan nivå – att kartlägga", bara coachens egna). */
function ToMap({ v }: { v: MinVeckaView }) {
  const items: TodoItem[] = v.toMap.map((m) => ({
    key: m.caseId,
    title: <CaseName big caseId={m.caseId} name={m.name} caseNumber={m.caseNumber} />,
    notes: [m.intake === "draft" ? "Kartläggning pågår" : m.intake === "approved" ? "Kartläggningen är godkänd – nivå saknas" : "Inte kartlagd"],
    action: (
      <Button kind="ghost" icon="arrow-right" to={`/kartlaggning/${encodeURIComponent(m.caseId)}`}>
        Kartlägg <span className="sr-only">{m.name} {m.caseNumber}</span>
      </Button>
    ),
  }));
  return (
    <TodoList
      id="mv-kartlagga"
      title={`Att kartlägga (${v.toMap.length})`}
      icon="layers"
      items={items}
      foot={
        <>
          Nivån väljs i kartläggningen.{" "}
          <Link to="/grupper" className="inline-flex min-h-11 items-center font-bold text-antracit underline underline-offset-3">
            Grupper och nivåer
          </Link>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------- Veckokalendern
/** Slår ihop tillfällen med samma tid och typ (t.ex. gemensamt yrkesmoment) till en rad i kalendern. Coachträffar visas var för sig. */
function groupSlots(list: CalendarActivity[]): CalendarActivity[][] {
  const out: CalendarActivity[][] = [];
  const idx = new Map<string, number>();
  for (const a of list) {
    const k = a.kind === "möte" ? a.id : `${a.startsAt}|${a.kind}|${a.location}`;
    if (!idx.has(k)) {
      idx.set(k, out.length);
      out.push([]);
    }
    out[idx.get(k) as number].push(a);
  }
  return out;
}

const EV_BORDER: Record<string, string> = { mote: "border-l-antracit", yrke: "border-l-bla", praktik: "border-l-antracit [border-left-style:dashed]", "": "border-l-antracit" };

function WeekCalendar({ mon, acts, now }: { mon: string; acts: CalendarActivity[]; now: string }) {
  const nav = useNav();
  const today = dayOf(now);
  return (
    <Stack gap="sm" className="gap-3">
      <div className="grid grid-cols-5 gap-2.5 max-[1100px]:grid-cols-1">
        {[0, 1, 2, 3, 4].map((i) => {
          const day = addDays(mon, i);
          const list = acts.filter((a) => dayOf(a.startsAt) === day);
          const hol = holidayName(day);
          const isToday = day === today;
          return (
            <div
              key={day}
              data-testid="kalender-dag"
              className={cn("flex min-w-0 flex-col rounded-mb border border-ljusgra bg-vit", isToday && "border-antracit shadow-[inset_0_4px_0_var(--color-rod)]")}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 border-b border-ljusgra px-2.5 pt-2.5 pb-2">
                <span className="text-label font-extrabold tracking-[0.08em] uppercase">
                  {WEEKDAYS[i]} {fmtDateShort(day)}
                </span>
                {isToday ? <Badge tone="dark">I dag</Badge> : <span className="text-small text-text-muted">{plural(list.length, "tillfälle", "tillfällen")}</span>}
              </div>
              <div className="flex flex-col gap-1.5 p-2 max-[1100px]:flex-row max-[1100px]:flex-wrap">
                {hol && <span className="text-small text-text-muted">{hol}</span>}
                {list.length === 0 && !hol && <span className="text-small text-text-muted">Inga aktiviteter</span>}
                {groupSlots(list).map((grp) => {
                  const a = grp[0];
                  const k = kindOf(a.kind);
                  const past = a.startsAt < now;
                  const regd = grp.filter((x) => x.attendance).length;
                  const open = past ? grp.length - regd : 0;
                  const names = grp.map((x) => x.shortName);
                  const single = grp.length === 1;
                  const target = single && a.kind === "möte" ? `/avstamning/${encodeURIComponent(a.caseId)}` : `/narvaro?vecka=denna${single ? `&arende=${encodeURIComponent(a.caseId)}` : ""}`;
                  const icon: IconName | null = single ? (a.attendance ? ATT[a.attendance].icon : past ? "circle" : null) : past ? (open ? "circle" : "check-circle") : null;
                  const label = `${fmtTime(a.startsAt)} ${k.label} med ${names.join(", ")}${past ? (open ? `, ${open} ej registrerade` : ", närvaro registrerad") : ""}`;
                  const tile = cn(
                    "flex min-h-11 w-full min-w-0 flex-col gap-px rounded-[4px] border border-l-4 border-ljusgra bg-vit text-left text-meta leading-[1.35] text-antracit [font-family:inherit]",
                    "max-[1100px]:w-auto max-[1100px]:flex-[1_1_170px]",
                    EV_BORDER[k.cls],
                  );
                  const when = (
                    <span className="flex items-center gap-1 font-bold">
                      {fmtTime(a.startsAt)} · {k.label}
                      {!single ? ` (${grp.length})` : ""}
                      {icon && <Icon name={icon} className="ml-auto size-3.5" />}
                    </span>
                  );
                  if (single) {
                    // En deltagare: två mål – tiden och typen leder till mötet (eller närvaron), namnet till deltagarkortet.
                    return (
                      <div key={a.id} className={tile}>
                        <Link to={target} aria-label={label} className="flex min-h-11 flex-col justify-center rounded-t-[3px] px-2 pt-1.5 no-underline hover:bg-ljusgra-ton">
                          {when}
                        </Link>
                        <Link
                          to={`/arenden/${encodeURIComponent(a.caseId)}`}
                          className="inline-flex min-h-11 items-center rounded-b-[3px] px-2 pb-1 text-text-muted underline underline-offset-2 [overflow-wrap:anywhere] hover:bg-ljusgra-ton"
                        >
                          {names[0]}
                          <span className="sr-only"> – deltagarkortet</span>
                        </Link>
                      </div>
                    );
                  }
                  return (
                    <button type="button" key={a.id} onClick={() => nav.push(target)} aria-label={label} className={cn(tile, "cursor-pointer px-2 py-1.5 hover:bg-ljusgra-ton")}>
                      {when}
                      <span className="text-text-muted [overflow-wrap:anywhere]">{names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1.5 text-small text-text-muted">
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-3.5 rounded-[2px] bg-antracit align-middle" />
          Coachträff
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-3.5 rounded-[2px] bg-bla align-middle" />
          Yrkesmoment
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-3.5 rounded-[2px] border-2 border-dashed border-antracit align-middle" />
          Praktikdag
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="check-circle" />
          närvaro registrerad
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="circle" />
          passerat, något ej registrerat
        </span>
        <span>(3) = antal deltagare vid gemensamt tillfälle</span>
      </div>
    </Stack>
  );
}
