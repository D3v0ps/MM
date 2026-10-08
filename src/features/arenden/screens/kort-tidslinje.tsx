"use client";
// Deltagarkortets flik Tidslinje (rapporter steg 2, SPEC §7.18): allt som hänt i insatsen per månad, med det senaste först,
// och de fria anteckningarna (skriv, ändra, ta bort). Tidslinjen upprepar ingen fritext i grundvyn – bara anteckningarnas
// text visas. Meddelandets text och avstämningens anteckning och hinder kan fällas ut på plats ("Visa text", ihopfällt som
// standard) av den som får läsa dem på fliken; texten hämtas först då (arenden.kortTidslinjeText) – beslut 2026-10-02,
// Karim. Kommunen ser aldrig tidslinjen. Data: arenden.kortTidslinje (domänfunktionen timeline.ts).
import { useEffect, useState, type MouseEvent } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { useSession } from "@/shell/session";
import { CASE_NOTE_AUDIENCE_LABEL, CASE_NOTE_KIND_LABEL } from "@/core/labels";
import { dayOf, fmtDateTime, MONTHS } from "@/core/time";
import { looksLikePnr } from "@/core/validation";
import { CASE_NOTE_KINDS, CASE_NOTE_MAX, type CaseNoteAudience, type CaseNoteKind } from "@/data/schema";
import {
  Badge, Button, cn, DateInput, ErrorNotice, Field, Icon, Loading, Modal, Notice, Refreshing, Section, Seg, Select, Stack, STATUS_ICON, TextArea, Timeline, toast, confirmDiscard, ModalCancelButton, useConfirm, type TimelineItem,
} from "@/ui";
import {
  caseNoteRemove, caseNoteSave, caseTimeline, caseTimelineText, messageRead, TIMELINE_CAT_LABEL, TIMELINE_CATS, type CaseTimeline, type CaseTimelineMonth, type TimelineCat, type TimelineEntry,
  type TimelineNote,
} from "../api";
import { caseLink, fd } from "./common";
import type { TabProps } from "./kort";

const EMPTY_CARD = "Här samlas allt som händer i insatsen: aktiviteter, närvaro, avstämningar, bedömningar, händelser och anteckningar. Inget är registrerat än.";
const EMPTY_FILTER = "Inget i den här kategorin för perioden.";
const monthTitle = (mk: string) => `${MONTHS[Number(mk.slice(5, 7)) - 1]} ${mk.slice(0, 4)}`;

export function TabTidslinje({ card, openTab }: TabProps) {
  const [visa, setVisa] = useState<TimelineCat>("alla");
  const [older, setOlder] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ note: TimelineNote | null } | null>(null);
  // Utfällda texter (postens id). Ihopfällt som standard; bara i minnet medan fliken visas – inget i adressen eller webblagring.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Filterbyte: listan står kvar (dämpad) tills den nya har hämtats – inget "Hämtar…" i stället för listan.
  const q = useQuery(caseTimeline, { caseId: card.caseId, visa }, { keepPrevious: true });
  const changeFilter = (v: TimelineCat) => {
    setVisa(v);
    setOlder([]);
  };
  const t = q.data;
  const pageProps = { card, openTab, onEdit: (note: TimelineNote) => setDialog({ note }), open, toggle };
  return (
    <Section
      title="Tidslinje"
      actions={t?.canWrite ? <Button kind="primary" icon="plus" onClick={() => setDialog({ note: null })}>Skriv anteckning</Button> : undefined}
    >
      <p>Allt som hänt i insatsen, med det senaste först. Visa text fäller ut meddelandet eller avstämningens anteckning här. Öppna visar raden i sin flik – med Tillbaka kommer du hit igen.</p>
      <Seg<TimelineCat> ariaLabel="Visa" value={visa} onValueChange={changeFilter} options={TIMELINE_CATS.map((c) => ({ value: c, label: TIMELINE_CAT_LABEL[c] }))} />
      {q.error ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : t === undefined ? (
        <Loading />
      ) : t === null ? (
        <Notice tone="info" title="Den delen visas inte för din roll" />
      ) : t.empty ? (
        <p className="text-text-muted">{EMPTY_CARD}</p>
      ) : (
        <Refreshing busy={q.isPlaceholderData}>
          <Stack>
            <TimelinePage t={t} last={older.length === 0} onMore={(m) => setOlder([m])} {...pageProps} />
            {older.map((fore, i) => (
              <OlderPage key={fore} caseId={card.caseId} visa={visa} fore={fore} last={i === older.length - 1} onMore={(m) => setOlder([...older, m])} {...pageProps} />
            ))}
          </Stack>
        </Refreshing>
      )}
      {dialog && <NoteDialog card={card} note={dialog.note} onClose={() => setDialog(null)} />}
    </Section>
  );
}

type PageProps = Pick<TabProps, "card" | "openTab"> & {
  last: boolean;
  onMore: (fore: string) => void;
  onEdit: (note: TimelineNote) => void;
  /** Poster vars text är utfälld, och växlingen. */
  open: ReadonlySet<string>;
  toggle: (id: string) => void;
};

/** Tre äldre månader (fore = månaden efter den äldsta som visas). */
function OlderPage({ caseId, visa, fore, ...rest }: PageProps & { caseId: string; visa: TimelineCat; fore: string }) {
  const q = useQuery(caseTimeline, { caseId, visa, fore });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  return <TimelinePage t={q.data} {...rest} />;
}

function TimelinePage({ t, last, onMore, ...rest }: PageProps & { t: CaseTimeline }) {
  const months = t.months.filter((m) => m.entries.length > 0);
  const oldest = t.months[t.months.length - 1]?.month;
  return (
    <>
      {months.length === 0 && <p className="text-text-muted">{EMPTY_FILTER}</p>}
      {months.map((m) => (
        <MonthBlock key={m.month} m={m} {...rest} />
      ))}
      {last && t.more && oldest && (
        <div>
          <Button icon="chevron-down" onClick={() => onMore(oldest)}>
            Visa tidigare månader
          </Button>
        </div>
      )}
    </>
  );
}

function MonthBlock({ m, card, openTab, onEdit, open, toggle }: Omit<PageProps, "last" | "onMore"> & { m: CaseTimelineMonth }) {
  const today = dayOf(card.now);
  const id = `tl-${m.month}`;
  return (
    <section aria-labelledby={id} aria-describedby={m.report ? `${id}-report` : undefined} className="flex flex-col gap-3 border-t border-ljusgra pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Rubriken är bara månaden (versal etikett). tabIndex -1: fokus hamnar här när en anteckning har tagits bort. */}
        <h3 id={id} tabIndex={-1} data-tl-month="" className="text-label font-extrabold tracking-[0.1em] uppercase">
          {monthTitle(m.month)}
        </h3>
        {/* Rapportens status är information, inte en etikett: brödtext med ikon. */}
        {m.report && (
          <span id={`${id}-report`} className="inline-flex items-center gap-1.5 text-body">
            <Icon name="file" className="flex-none" />
            {m.report.statusLabel}
          </span>
        )}
        <span className="flex-1" />
        {m.report && (
          <Button kind="ghost" iconRight="arrow-right" onClick={() => openTab("manad", { manad: m.month })}>
            Visa månadsunderlaget
          </Button>
        )}
      </div>
      <Timeline as="ol" ariaLabel={`Händelser ${monthTitle(m.month)}`} items={m.entries.map((e) => entryItem(e, { card, openTab, onEdit, today, headingId: id, open, toggle }))} />
    </section>
  );
}

/** Panelens id i DOM (aria-controls): postens id med bara bokstäver, siffror och bindestreck. */
const textPanelId = (entryId: string) => `tl-text-${entryId.replace(/[^a-zA-Z0-9-]/g, "-")}`;

function entryItem(
  e: TimelineEntry,
  o: { card: TabProps["card"]; openTab: TabProps["openTab"]; onEdit: (n: TimelineNote) => void; today: string; headingId: string; open: ReadonlySet<string>; toggle: (id: string) => void },
): TimelineItem {
  const expanded = !!e.text && o.open.has(e.id);
  const actions =
    e.note ? (
      e.note.canEdit || e.note.canRemove ? (
        <NoteActions note={e.note} card={o.card} onEdit={o.onEdit} headingId={o.headingId} />
      ) : undefined
    ) : e.tab ? (
      <>
        {e.text && (
          // Fäller ut texten på plats (meddelandet, avstämningens anteckning och hinder). Texten hämtas först då.
          <Button kind="ghost" icon={expanded ? "chevron-up" : "chevron-down"} aria-expanded={expanded} aria-controls={expanded ? textPanelId(e.id) : undefined} onClick={() => o.toggle(e.id)}>
            {expanded ? "Dölj text" : "Visa text"}
          </Button>
        )}
        <Button
          kind="ghost"
          iconRight="arrow-right"
          ariaLabel={`Öppna: ${e.title}`}
          // Ny historikpost med målet (postens id): fliken visar raden, och Tillbaka leder hit igen.
          onClick={() => o.openTab(e.tab!, { mal: e.id, manad: e.tab === "manad" ? (e.month ?? null) : null })}
        >
          Öppna
        </Button>
      </>
    ) : undefined;
  const subIcon = e.light ? STATUS_ICON[e.light] : e.state === "varning" ? "alert" : e.state === "ej_verifierad" ? "help" : null;
  return {
    key: e.id,
    icon: e.icon,
    tone: e.state === "varning" ? "alert" : undefined,
    date: e.weekLabel ?? fd(e.at, o.today),
    title: e.title,
    sub: e.sub ? (
      <span className="inline-flex items-start gap-1.5">
        {subIcon && <Icon name={subIcon} className={cn("mt-0.5", e.state === "varning" && "text-rod")} />}
        <span>{e.sub}</span>
      </span>
    ) : undefined,
    body: e.note ? (
      <p className={cn("m-0 mt-1 whitespace-pre-line [overflow-wrap:anywhere]", e.note.removed && "text-text-muted")}>{e.note.body}</p>
    ) : expanded ? (
      <TimelineTextPanel id={textPanelId(e.id)} caseId={o.card.caseId} entryId={e.id} title={e.title} />
    ) : undefined,
    actions,
  };
}

/**
 * Texten bakom en post, hämtad först när den fälls ut (egen fråga – inte i tidslinjens grundfråga). Andra utfällningen
 * hämtar inte igen (frågans cache). null = rollen får inte läsa texten (teamet) – samma regel som fliken. Ett oläst
 * meddelande från kommunen markeras som läst när texten visas (samma tysta kommando som fliken Meddelanden, bara det
 * meddelandet) – annars står det som oläst fast coachen läst det.
 */
function TimelineTextPanel({ id, caseId, entryId, title }: { id: string; caseId: string; entryId: string; title: string }) {
  const q = useQuery(caseTimelineText, { caseId, id: entryId });
  const t = q.data;
  const read = useCommand(messageRead);
  const unread = !!t && t.kind === "message" && t.unreadByMe;
  const messageId = entryId.startsWith("msg:") ? entryId.slice(4) : null;
  useEffect(() => {
    if (unread && messageId) void read.run({ caseId, messageId }).catch(() => undefined);
    // read är stabil per kommando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, messageId, caseId]);
  return (
    <div id={id} role="region" aria-label={title} className="mt-1.5 rounded-mb border border-ljusgra bg-vit px-3 py-2.5">
      {q.error ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : t === undefined ? (
        <Loading className="py-1" />
      ) : t === null ? (
        <p className="m-0 text-text-muted">Texten visas inte för din roll.</p>
      ) : t.kind === "message" ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5 text-small">
            <span className="font-bold">{t.senderName}</span>
            <span className="text-text-muted">
              {t.orgName} · {fmtDateTime(t.createdAt)}
            </span>
            {t.meetingRequest && <Badge tone="outline" icon="calendar">Kallelse till uppföljning</Badge>}
          </div>
          <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{t.body}</div>
          <div className="text-small text-text-muted">{t.readText}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {t.approved ? (
            <>
              <div>
                <span className="font-bold">Anteckning: </span>
                {t.note.trim() ? <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{t.note}</span> : "–"}
              </div>
              <div>
                <span className="font-bold">Hinder: </span>
                {t.obstacles.length ? t.obstacles.join(", ") : "Inga hinder"}
              </div>
              {t.attendanceComment.trim() && (
                <div>
                  <span className="font-bold">Kommentar till närvaron: </span>
                  <span className="[overflow-wrap:anywhere]">{t.attendanceComment}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="m-0 text-small text-text-muted">Utkast – granskas av coachen. Anteckningen visas när avstämningen är godkänd.</p>
              <div>
                <span className="font-bold">Hinder: </span>
                {t.obstacles.join(", ")}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Efter borttagningen finns knappen inte längre: fokus till månadens rubrik (eller den första månaden om månaden försvann). */
function focusAfterRemove(headingId: string) {
  const el = document.getElementById(headingId) ?? document.querySelector<HTMLElement>("[data-tl-month]");
  el?.focus();
}

function NoteActions({ note, card, onEdit, headingId }: { note: TimelineNote; card: TabProps["card"]; onEdit: (n: TimelineNote) => void; headingId: string }) {
  const confirm = useConfirm();
  const remove = useCommand(caseNoteRemove);
  const del = async () => {
    // Författaren (som också får ändra) – annars samordnare eller avtalsansvarig som tar bort någon annans anteckning.
    const mine = note.canEdit;
    const okd = await confirm({
      title: "Ta bort anteckningen?",
      confirmLabel: "Ta bort",
      tone: "danger",
      body: (
        <p>
          {mine
            ? "Anteckningen visas inte längre i deltagarkortet. Den sparas till dess att den gallras och kan inte tas tillbaka här."
            : `Anteckningen visas inte längre i deltagarkortet. ${note.authorName} ser att du har tagit bort den.`}
        </p>
      ),
    });
    if (!okd) return;
    const res = await remove.run({ caseId: card.caseId, noteId: note.id }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Anteckningen kunde inte tas bort.", "error");
      return;
    }
    toast("Anteckningen är borttagen.");
    // Listan är redan hämtad på nytt (useCommand väntar in frågorna) – vänta bara på att React har ritat om.
    setTimeout(() => focusAfterRemove(headingId), 0);
  };
  return (
    <>
      {note.canEdit && (
        <Button kind="ghost" icon="edit" ariaLabel={`Ändra anteckningen från ${fd(note.occurredOn, dayOf(card.now))}`} onClick={() => onEdit(note)}>
          Ändra
        </Button>
      )}
      {note.canRemove && (
        <Button kind="ghost" icon="trash" pending={remove.pending} ariaLabel={`Ta bort anteckningen från ${fd(note.occurredOn, dayOf(card.now))}`} onClick={() => void del()}>
          Ta bort
        </Button>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Skriv anteckning / Ändra anteckning
const AUDIENCE_TEXT: Record<CaseNoteAudience, string> = { full: CASE_NOTE_AUDIENCE_LABEL.full, team: "Även teamet (till exempel handledare)" };

function NoteDialog({ card, note, onClose }: { card: TabProps["card"]; note: TimelineNote | null; onClose: () => void }) {
  const role = useSession().actor.role;
  const save = useCommand(caseNoteSave);
  const today = dayOf(card.now);
  const minDate = dayOf(card.referredAt);
  const team = card.access === "team";
  const [kind, setKind] = useState<CaseNoteKind | "">(note?.kind ?? "");
  const [date, setDate] = useState(note?.occurredOn ?? today);
  const [body, setBody] = useState(note?.body ?? "");
  const [audience, setAudience] = useState<CaseNoteAudience>(note?.audience ?? (team ? "team" : "full"));
  const [err, setErr] = useState<{ kind?: string; date?: string; body?: string }>({});
  const tooLong = body.trim().length > CASE_NOTE_MAX;
  const check = () => {
    const e: typeof err = {};
    if (!kind) e.kind = "Välj vad anteckningen gäller.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = "Välj datum.";
    else if (date > today) e.date = "Datumet kan inte vara senare än i dag.";
    else if (date < minDate) e.date = "Datumet kan inte vara före beställningen.";
    const text = body.trim();
    if (!text) e.body = "Skriv en anteckning.";
    else if (text.length > CASE_NOTE_MAX) e.body = `Anteckningen får vara högst ${CASE_NOTE_MAX} tecken.`;
    else if (looksLikePnr(text)) e.body = "Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.";
    setErr(e);
    return Object.keys(e).length === 0;
  };
  const submit = async () => {
    if (!check() || !kind) return;
    const res = await save
      .run({ caseId: card.caseId, noteId: note?.id, occurredOn: date, kind, audience: team ? "team" : audience, body: body.trim() })
      .catch(() => null);
    if (!res) {
      toast("Anteckningen kunde inte sparas.", "error");
      return;
    }
    if (!res.ok) {
      if (res.error === "pnr") setErr({ body: res.message });
      else if (res.error === "date") setErr({ date: res.message });
      else toast(res.message || "Anteckningen kunde inte sparas.", "error");
      return;
    }
    toast("Anteckningen är sparad.");
    onClose();
  };
  const eventLink = role === "coach" && card.edit;
  const nav = useNav();
  const eventPath = caseLink("/handelse", card.caseId);
  // Osparad text: Esc, klick utanför, krysset, Avbryt och länken Registrera händelse frågar samma sak först.
  const dirty = body.trim() !== (note?.body ?? "").trim();
  const toEvent = async (e: MouseEvent) => {
    if (!dirty) return;
    e.preventDefault();
    if (await confirmDiscard()) nav.push(eventPath);
  };
  return (
    <Modal
      title={note ? "Ändra anteckning" : "Skriv anteckning"}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>
            {note ? "Spara ändringen" : "Spara anteckningen"}
          </Button>
        </>
      }
    >
      <Field label="Vad gäller anteckningen?" id="note-kind" required help="Välj det som passar bäst." error={err.kind}>
        <Select
          value={kind}
          placeholder="Välj"
          onValueChange={(v) => {
            setKind(v as CaseNoteKind);
            setErr({ ...err, kind: undefined });
          }}
          options={CASE_NOTE_KINDS.map((k) => ({ value: k, label: CASE_NOTE_KIND_LABEL[k] }))}
        />
      </Field>
      <Field label="Datum" id="note-date" required help="Dagen det hände." error={err.date}>
        <DateInput
          value={date}
          max={today}
          min={minDate}
          onValueChange={(v) => {
            setDate(v);
            setErr({ ...err, date: undefined });
          }}
        />
      </Field>
      <Field
        label="Anteckning"
        id="note-body"
        required
        help="Skriv sakligt och kort. Inga diagnoser och inga omdömen om personen. Skriv inte personnummer."
        error={err.body}
      >
        <TextArea
          rows={6}
          value={body}
          aria-describedby="note-body-count"
          onValueChange={(v) => {
            setBody(v);
            if (err.body) setErr({ ...err, body: undefined });
          }}
        />
        {/* Räknaren läses som beskrivning av fältet – inte vid varje tangenttryckning. Bara när gränsen passeras läses en text upp. */}
        <div id="note-body-count" className={cn("text-small", tooLong ? "font-bold" : "text-text-muted")}>
          {body.trim().length} av {CASE_NOTE_MAX} tecken
        </div>
        <span role="status" className="sr-only">
          {tooLong ? `Anteckningen får vara högst ${CASE_NOTE_MAX} tecken.` : ""}
        </span>
      </Field>
      {eventLink ? (
        <p>
          Är det en arbetsgivarkontakt eller ett resultat?{" "}
          <Button kind="ghost" icon="award" to={eventPath} onClick={(e) => void toEvent(e)}>Registrera händelse</Button> – då kommer det med i månadsrapporten automatiskt.
        </p>
      ) : (
        <p className="text-text-muted">Arbetsgivarkontakter och resultat registreras som händelser av huvudcoachen. Då kommer de med i månadsrapporten automatiskt.</p>
      )}
      {team ? (
        <Notice tone="info" icon="users" title="Vem ser anteckningen?">
          Hela teamet ser anteckningen, liksom huvudcoach, samordnare, avtalsansvarig, chef och systemadministratör. Kommunen ser aldrig anteckningar.
        </Notice>
      ) : (
        <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-0.5 p-0 text-ui font-bold">Vem ser anteckningen?</legend>
          <div id="note-audience-help" className="text-small leading-[1.45] text-text-muted">Kommunen ser aldrig anteckningar.</div>
          {(["full", "team"] as const).map((a) => (
            <label
              key={a}
              htmlFor={`note-audience-${a}`}
              className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-mb border-[1.5px] border-line-strong px-3 py-2", audience === a && "border-2 border-antracit bg-bla-ton")}
            >
              <input
                type="radio"
                name="note-audience"
                id={`note-audience-${a}`}
                value={a}
                checked={audience === a}
                aria-describedby="note-audience-help"
                onChange={() => setAudience(a)}
                className="m-0 size-5 flex-none accent-antracit"
              />
              <span>{AUDIENCE_TEXT[a]}</span>
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}
