"use client";
// Avropsinkorgen (/inkorg/:emailId?) – port av prototypens vy sam.inkorg (prototyp/src/views/inkorg.js):
// originalet bredvid det tolkade formuläret, ordererkännande, dubblettkontroll, acceptera/avböj, kompletteringar och
// mejl som klassats som Övrigt.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { messageSend } from "@/features/arenden/api";
import { useCommand, usePrefetch, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import {
  Badge, Button, Card, CaseLink, CaseStatusBadge, CellSub, cn, DemoNote, Empty, ErrorNotice, Field, Icon, Kv, Loading, Notice, Page, PerspectiveLink, SlaBadge, Stepper,
  Table, Tabs, TextArea, toast, type Column, type IconName,
} from "@/ui";
import {
  emailApplySupplement, emailSetStatus, inboxItem, inboxList, type InboxItemDetail, type InboxList, type InboxRow, type OrderBodyView, type OtherBodyView, type PendingSupplement,
  type SupplementBodyView,
} from "../api";
import { CLASS_ICON, CLASSIFICATION, METHOD, statusLook } from "../texts";
import { AckCard, CaseFieldsCard, ConfirmationCard, DeclinedCard, DuplicateCard, OriginalCard, ParsedCard } from "./cards";
import { AcceptModal, CorrectModal, DeclineModal } from "./modals";
import { Caps, IconLine, KommunSwitch, Quote, useIsDemo, WrapBtns } from "./parts";

type Pick_ = (id: string) => void;
/** Metadata med ikon (14 px, dämpad) – i stället för ett konturmärke. */
const MetaText = ({ icon, children }: { icon: IconName; children?: ReactNode }) => (
  <span className="inline-flex items-center gap-1 text-small text-text-muted">
    <Icon name={icon} className="flex-none" />
    {children}
  </span>
);
const Pair = ({ even, children }: { even?: boolean; children?: ReactNode }) => (
  <div className={cn("grid grid-cols-1 items-start gap-4", even ? "@min-[720px]:grid-cols-2" : "@min-[720px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]")}>{children}</div>
);

// ---------------------------------------------------------------- Skärmen
export function InkorgScreen({ params, query }: ScreenProps) {
  const q = useQuery(inboxList, {});
  return (
    <Page
      title="Avropsinkorg"
      eyebrow="avrop@miljonbemanning.se"
      lead={q.data ? `Mejl till avrop@ läses in automatiskt och får ärendenummer och ordererkännande inom ${q.data.ackMinutes} minuter. Svara med Acceptera eller Avböj senast ${q.data.answerText} efter mottagandet.` : undefined}
      actions={
        <>
          {/* Beslut 4a (2026-10-08): avrop som kom med mejl som inte kunde tolkas, telefon eller på annat sätt registreras här.
              Tom inkorg: knappen ligger i rutan i stället (en primär knapp per vy). */}
          {!!q.data?.rows.length && <Button kind="primary" icon="plus" to="/inkorg/registrera">Registrera beställning</Button>}
          <PerspectiveLink role="kommun_handlaggare" to="/portal/bestall" label="Se hur kommunen beställer" />
        </>
      }
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : (
        <Inbox data={q.data} emailId={params.emailId ?? null} caseId={query.get("arende")} latest={query.get("senaste") === "1"} visa={query.get("visa")} />
      )}
      <DemoNote>
        Mejlen här är påhittade. I tjänsten hämtas mejlen från avrop@ via Microsoft Graph varannan minut och flyttas till mappen Inläst, där de ligger kvar som reserv.
        Inga mejl eller SMS skickas på riktigt – de syns i utskicksloggen. Demoklockan går en minut framåt för varje åtgärd.
      </DemoNote>
    </Page>
  );
}

/** Posten som visas först (prototypens initial): mejlet i adressen, ärendets avrop, senaste avropet eller det mest brådskande. */
function initialPick(d: InboxList, emailId: string | null, caseId: string | null, latest: boolean): string | null {
  const rows = d.rows;
  if (emailId && rows.some((x) => x.id === emailId)) return emailId;
  if (caseId) {
    const byCase = rows.filter((x) => x.caseId === caseId);
    const pick = byCase.find((x) => x.cls === "order") ?? byCase[0];
    if (pick) return pick.id;
  }
  if (latest) {
    const pending = new Set(d.pending);
    const l = rows.filter((x) => pending.has(x.id) && x.cls === "order").sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0))[0];
    if (l) return l.id;
  }
  return d.pending[0] ?? null;
}

type Tab = "att" | "hanterade" | "alla";
const LIMIT = 12;
const DECIDE = new Set<InboxRow["cls"]>(["order", "supplement"]);

function Inbox({ data, emailId, caseId, latest, visa }: { data: InboxList; emailId: string | null; caseId: string | null; latest: boolean; visa: string | null }) {
  const nav = useNav();
  // Valt mejl i adressen (/inkorg/<id>, replace – rutten ligger kvar): omladdning och länkar visar samma mejl. Utan id i
  // adressen väljs det mest brådskande (eller ärendets avrop / det senaste, ?arende= och ?senaste=1).
  const [auto] = useState<string | null>(() => initialPick(data, emailId, caseId, latest));
  const selId = emailId && data.rows.some((x) => x.id === emailId) ? emailId : auto;
  // Fliken i adressen (?visa=hanterade|alla).
  const [initialTab] = useState<Tab>(() => {
    const init = data.rows.find((x) => x.id === selId);
    return init && !init.pending && (emailId || caseId) ? "alla" : "att";
  });
  const tab: Tab = visa === "hanterade" || visa === "alla" ? visa : visa === "att" ? "att" : initialTab;
  const setTab = (t: Tab) => nav.replace(path(nav.path, { visa: t === "att" ? (initialTab === "att" ? null : "att") : t }));
  const [showAll, setShowAll] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const userPick = useRef(false);
  // Räknas upp vid varje val – också när samma mejl väljs igen (då ändras inte adressen, men detaljen ska visas).
  const [pickSeq, setPickSeq] = useState(0);
  useEffect(() => {
    if (!userPick.current) return;
    userPick.current = false;
    const el = detailRef.current;
    if (!el) return;
    if (window.matchMedia("(max-width: 1099px)").matches) {
      // Smal skärm: detaljen ligger under listan – visa den direkt. Detaljen har minst skärmens höjd (nedan), så att den kan
      // läggas överst också medan den laddar och när den är sist på sidan.
      el.scrollIntoView({ block: "start" });
    } else {
      // Bred skärm: detaljen ligger fast bredvid listan och skrollar för sig – börja överst och se till att rubriken syns.
      // Nära sidans slut trycks den fasta kolumnen uppåt av listans slut: skrolla då upp så mycket som behövs.
      el.scrollTop = 0;
      const want = parseFloat(getComputedStyle(el).top) || 16;
      const top = el.getBoundingClientRect().top;
      if (top < want) window.scrollBy({ top: top - want });
    }
  }, [selId, pickSeq]);
  const pick: Pick_ = (id) => {
    userPick.current = true;
    setPickSeq((n) => n + 1);
    nav.replace(path(`/inkorg/${encodeURIComponent(id)}`, { visa }));
  };
  const byId = useMemo(() => new Map(data.rows.map((r) => [r.id, r])), [data]);
  const pending = data.pending.map((id) => byId.get(id)).filter((x): x is InboxRow => !!x);
  const handled = data.handled.map((id) => byId.get(id)).filter((x): x is InboxRow => !!x);
  const list = tab === "att" ? pending : tab === "hanterade" ? handled : data.rows;
  const shown = showAll ? list : list.slice(0, LIMIT);
  const item = selId ? byId.get(selId) ?? null : null;
  // Nästa avrop att hantera (det mest brådskande som väntar – samma ordning som "Att hantera"), utom det som visas.
  const nextAfter = (cur: InboxRow): InboxRow | null => pending.find((x) => x.id !== cur.id && DECIDE.has(x.cls) && (!cur.caseId || x.caseId !== cur.caseId)) ?? null;

  // Inte ett enda mejl eller en enda beställning (tom databas): en ruta som säger vad som händer och vad man kan göra.
  if (data.rows.length === 0) {
    return (
      <Card>
        <Empty
          icon="inbox"
          title="Inga beställningar ännu"
          action={
            <Button kind="primary" icon="plus" to="/inkorg/registrera">
              Registrera beställning
            </Button>
          }
        >
          Mejl till avrop@ läses in automatiskt och hamnar här. Kom en beställning per telefon? Registrera den.
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <Summary pending={pending} selId={selId} onPick={pick} />
      <div className="grid grid-cols-1 items-start gap-5 min-[1100px]:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <Tabs<Tab>
            ariaLabel="Filtrera inkorgen"
            active={tab}
            onChange={(t) => {
              setTab(t);
              setShowAll(false);
            }}
            tabs={[{ id: "att", label: "Att hantera", count: pending.length }, { id: "hanterade", label: "Hanterade" }, { id: "alla", label: "Alla" }]}
            className="[&_[role=tab]]:gap-1.5 [&_[role=tab]]:px-3"
          />
          {list.length > 0 && (
            <span className="text-small text-text-muted">
              {tab === "att" ? `${list.length} att hantera, mest brådskande först` : tab === "hanterade" ? `${list.length} hanterade, senaste först` : `${list.length} mejl och beställningar, senaste först`}
            </span>
          )}
          <Card flush foot={list.length > shown.length ? <Button kind="ghost" onClick={() => setShowAll(true)}>Visa alla {list.length}</Button> : undefined}>
            {shown.length === 0 ? (
              tab === "hanterade" ? (
                <Empty icon="check-circle" title="Inget är hanterat ännu">Accepterade, avböjda och hanterade mejl hamnar här.</Empty>
              ) : (
                <Empty icon="check-circle" title="Inget att hantera">Alla avrop är besvarade.</Empty>
              )
            ) : (
              <nav aria-label="Mejl i inkorgen" className="flex flex-col">
                {shown.map((it) => <Row key={it.id} it={it} active={it.id === selId} onPick={pick} />)}
              </nav>
            )}
          </Card>
        </div>
        <div
          ref={detailRef}
          className={cn(
            // Skrollmålet på smal skärm: 16 px marginal (den fasta toppraden räknas redan in i html:s scroll-padding-top).
            "@container min-w-0 scroll-mt-4",
            item && "max-[1099px]:min-h-[calc(100dvh-var(--mm-sticky-top))]",
            // Bred skärm: detaljen följer med när listan skrollas och skrollar själv inuti. Höjden ryms ovanför sidans
            // nedre marginal (pb-24), så att kolumnen inte trycks upp – och rubriken ut ur bild – längst ned på sidan.
            "min-[1100px]:sticky min-[1100px]:top-[calc(var(--mm-sticky-top)+16px)] min-[1100px]:max-h-[calc(100dvh-128px)] min-[1100px]:overflow-y-auto min-[1100px]:overscroll-contain",
          )}
          data-inkorg-detail=""
        >
          {item ? (
            <Detail key={item.id} id={item.id} onPick={pick} next={nextAfter(item)} />
          ) : (
            <Card>
              <Empty icon="inbox" title={pending.length ? "Välj ett mejl" : "Inget väntar på svar"}>
                {pending.length ? "Klicka på ett mejl i listan för att se originalet och det tolkade formuläret." : "Alla avrop är besvarade. Under Hanterade ser du vad som gjorts och när."}
              </Empty>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Sammanfattning: första rutan visar samma tal som fliken "Att hantera" och menyräknaren. Övriga delar upp talet. */
function Summary({ pending, selId, onPick }: { pending: InboxRow[]; selId: string | null; onPick: Pick_ }) {
  const urgent = pending.find((x) => x.sla && !x.sla.metAt);
  const n = (cls: InboxRow["cls"]) => pending.filter((x) => x.cls === cls).length;
  const parts: [string, number][] = [["Avrop att besvara", n("order")], ["Kompletteringar", n("supplement")], ["Övrigt", n("other")]];
  const cell = "flex min-w-0 flex-col gap-0.5 border-r border-ljusgra px-[18px] py-3 max-[620px]:flex-[1_1_45%] max-[620px]:border-r-0 max-[620px]:border-b";
  const num = "text-[1.5rem] leading-[1.1] font-extrabold tabular-nums";
  return (
    <div role="group" aria-label="Sammanfattning av inkorgen" className="flex flex-wrap items-stretch rounded-card border border-ljusgra bg-vit" data-inkorg-summary="">
      <div className={cell}>
        <Caps>Att hantera</Caps>
        <span className={num} data-summary-total="">{pending.length}</span>
        <span className="text-small text-text-muted">mejl och beställningar</span>
      </div>
      {parts.map(([label, k]) => (
        <div key={label} className={cell}>
          <Caps>{label}</Caps>
          <span className={num} data-summary-part="">{k}</span>
        </div>
      ))}
      <div className="flex min-w-0 flex-[1_1_260px] flex-col justify-center gap-0.5 px-[18px] py-3 max-[620px]:basis-full">
        <Caps>Mest brådskande</Caps>
        {urgent?.sla ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <SlaBadge sla={urgent.sla.sla} dueAt={urgent.sla.dueAt} />
            <span className="font-bold">{urgent.caseNumber ?? urgent.subject}</span>
            <span className="text-small text-text-muted">{urgent.from}</span>
            {urgent.id === selId ? (
              <span className="text-small text-text-muted">Visas nu</span>
            ) : (
              <Button kind="ghost" iconRight="arrow-right" onClick={() => onPick(urgent.id)}>Öppna</Button>
            )}
          </span>
        ) : (
          <span className="text-text-muted">Inget väntar på svar.</span>
        )}
      </div>
    </div>
  );
}

function Row({ it, active, onPick }: { it: InboxRow; active: boolean; onPick: Pick_ }) {
  const m = METHOD[it.method] ?? METHOD.manual;
  const [stLabel, stTone, stIcon] = statusLook(it.status);
  // Pekar man på (eller fokuserar) ett mejl hämtas det i förväg, så att det visas direkt vid klick.
  const prefetch = usePrefetch();
  const warm = () => prefetch(inboxItem, { id: it.id });
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={() => onPick(it.id)}
      onPointerEnter={warm}
      onFocus={warm}
      data-inkorg-row=""
      className={cn(
        "flex w-full min-w-0 cursor-pointer items-start gap-2.5 border-x-0 border-t-0 border-b border-ljusgra bg-transparent px-[18px] py-3 text-left text-antracit [font:inherit] last:border-b-0 hover:bg-ljusgra-ton",
        active && "bg-bla-ton shadow-[inset_4px_0_0_var(--color-antracit)] hover:bg-bla-ton",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-bold">{it.from}</span>
          <span className="text-small whitespace-nowrap text-text-muted">{it.receivedWhen}</span>
        </span>
        <span data-inkorg-subject="" className="[overflow-wrap:anywhere]">{it.subject}</span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {it.pending && it.sla ? <SlaBadge sla={it.sla.sla} dueAt={it.sla.dueAt} /> : <Badge tone={stTone} icon={stIcon}>{stLabel}</Badge>}
          {/* Metod och ärendenummer är metadata (14 px, ikon + text) – bara status/SLA är märke. */}
          {it.cls === "order"
            ? <MetaText icon={m.icon}>{m.label}</MetaText>
            : <MetaText icon={CLASS_ICON[it.cls] ?? "mail"}>{CLASSIFICATION[it.cls]}</MetaText>}
          {it.caseNumber && <span className="text-small font-bold tabular-nums tracking-[0.01em]">{it.caseNumber}</span>}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- Detaljvyn
type ModalKind = "accept" | "decline" | "correct" | null;
/** Mejlstatusar där det inte finns mer att göra i mejlet (inbound_emails.status). */
const DONE_STATUS = ["accepted", "declined", "applied", "handled"];

/** Smal skärm: tillbaka upp till listan – raden som visas får fokus. */
function toList() {
  const row = document.querySelector<HTMLElement>('[data-inkorg-row][aria-current="true"]') ?? document.querySelector<HTMLElement>("[data-inkorg-row]");
  if (!row) return;
  row.scrollIntoView({ block: "center" });
  row.focus({ preventScroll: true });
}

function Detail({ id, onPick, next }: { id: string; onPick: Pick_; next: InboxRow | null }) {
  const q = useQuery(inboxItem, { id });
  const [modal, setModal] = useState<ModalKind>(null);
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || q.data === undefined) return <Loading />;
  const it = q.data;
  if (!it) return <Card><Empty icon="inbox" title="Mejlet finns inte">Det kan ha tagits bort, eller så har du inte behörighet att se det.</Empty></Card>;
  const c = it.case;
  const close = () => setModal(null);
  const showEmail = (x: string) => {
    setModal(null);
    onPick(x);
  };
  const b = it.body;
  // Nästa avrop – bara när det här är färdighanterat (accepterat, avböjt, infört eller markerat som hanterat). I ett mejl
  // som väntar på beslut visas knappen i kvittensen efter beslutet, inte överst.
  const nextBtn = next && DONE_STATUS.includes(it.status) && (
    <Button kind="primary" iconRight="arrow-right" onClick={() => onPick(next.id)}>
      Nästa avrop: {next.caseNumber ?? next.subject}
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 min-[1100px]:hidden">
        <Button kind="ghost" icon="arrow-left" onClick={toList}>
          Till listan
        </Button>
      </div>
      <DetailHead
        it={it}
        pendingSup={b.kind === "order" ? (b.pendingSups[0] ?? null) : null}
        onOpenSup={onPick}
        onAccept={() => setModal("accept")}
        onDecline={() => setModal("decline")}
        onCorrect={it.correct ? () => setModal("correct") : null}
      />
      {nextBtn && <div className="flex flex-wrap items-center gap-3">{nextBtn}</div>}
      {b.kind === "supplement" && <SupplementBody b={b} onPick={onPick} onAccept={() => setModal("accept")} />}
      {b.kind === "other" && <OtherBody it={it} b={b} />}
      {b.kind === "order" && <OrderBody it={it} b={b} onPick={onPick} />}
      {modal === "accept" && c && (
        <AcceptModal
          caseId={c.id}
          caseNumber={c.number}
          onClose={close}
          onShowEmail={showEmail}
          next={next ? { label: `Nästa avrop: ${next.caseNumber ?? next.subject}`, open: () => showEmail(next.id) } : null}
        />
      )}
      {modal === "decline" && c && <DeclineModal caseId={c.id} caseNumber={c.number} onClose={close} />}
      {modal === "correct" && it.correct && <CorrectModal f={it.correct} onClose={close} />}
    </div>
  );
}

function DetailHead({
  it, pendingSup, onOpenSup, onAccept, onDecline, onCorrect,
}: { it: InboxItemDetail; pendingSup: PendingSupplement | null; onOpenSup: Pick_; onAccept: () => void; onDecline: () => void; onCorrect: (() => void) | null }) {
  const c = it.case;
  const m = METHOD[it.method] ?? METHOD.manual;
  const [stLabel, stTone, stIcon] = statusLook(it.status);
  const s = it.headSla;
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
            <Caps>{CLASSIFICATION[it.cls] ?? "Mejl"}{c ? ` · ${c.number}` : ""}</Caps>
            <h2 className="text-h2 font-extrabold [overflow-wrap:anywhere]">{it.subject}</h2>
            <div className="text-small text-text-muted">Från {it.from}{it.fromAddress ? ` (${it.fromAddress})` : ""} · mottaget {it.receivedWhen}</div>
          </div>
          {s && (
            <div className="flex flex-col items-start gap-1">
              <span className="text-small text-text-muted">{s.text}</span>
              <SlaBadge sla={s.sla} dueAt={s.dueAt} />
            </div>
          )}
          {!s && it.cls === "other" && <Badge tone="outline" icon="message">Inget avtals-SLA – svara samma dag</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={stTone} icon={stIcon}>{stLabel}</Badge>
          <MetaText icon={m.icon}>{m.label}</MetaText>
          {c && <span className="inline-flex flex-wrap items-center gap-1.5 text-small">Ärende <CaseLink caseId={c.id} caseNumber={c.number} /></span>}
          {it.handledText && <span className="text-small text-text-muted">{it.handledText}</span>}
        </div>
        {it.steps && <Stepper steps={it.steps} current={it.current} />}
        {it.decision && (
          <div className="flex flex-col gap-3">
            {/* En komplettering väntar: den förs in först – då är "Öppna kompletteringen" huvudhandlingen, inte Acceptera. */}
            {pendingSup && (
              <div className="flex flex-wrap items-center gap-3">
                <Button kind="primary" iconRight="arrow-right" onClick={() => onOpenSup(pendingSup.id)}>Öppna kompletteringen</Button>
                <span className="text-small text-text-muted">{pendingSup.fromName} svarade {pendingSup.when} med uppgifter som saknas – för in dem först.</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button kind={pendingSup ? "secondary" : "primary"} icon="check" onClick={onAccept}>Acceptera</Button>
              {onCorrect && <Button kind="ghost" icon="edit" onClick={onCorrect}>Rätta uppgifter</Button>}
              {/* Den riskabla åtgärden sist. */}
              <Button kind="danger" icon="x-circle" onClick={onDecline}>Avböj</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function OrderBody({ it, b, onPick }: { it: InboxItemDetail; b: OrderBodyView; onPick: Pick_ }) {
  const c = it.case;
  return (
    <>
      {b.decided && c && <ConfirmationCard caseId={c.id} />}
      {b.declined && <DeclinedCard d={b.declined} />}
      {b.pendingSups.map((s) => (
        <Notice key={s.id} tone="info" icon="link" title="En komplettering har kommit">
          <div className="flex flex-col gap-2">
            {s.fromName} svarade {s.when}. Svaret kopplades automatiskt via ärendenumret i ämnesraden. För in uppgifterna först – sedan kan avropet accepteras.
            {!it.decision && <div><Button kind="secondary" iconRight="arrow-right" onClick={() => onPick(s.id)}>Öppna kompletteringen</Button></div>}
          </div>
        </Notice>
      ))}
      {b.register && (
        <Notice tone="warn" icon="edit" title="Beställningen behöver registreras för hand">
          <div className="flex flex-col gap-2">
            {b.register.reason}
            <div><Button kind="primary" icon="plus" to={`/inkorg/registrera?mejl=${encodeURIComponent(b.register.emailId)}`}>Registrera beställningen</Button></div>
          </div>
        </Notice>
      )}
      {b.missing && <Notice tone={b.missing.critical ? "critical" : "warn"} title={b.missing.title}>{b.missing.text}</Notice>}
      {b.refProblem && <Notice tone="critical" title="Beställarreferens saknas eller är fel">{b.refProblem}</Notice>}
      <Pair>
        {b.original ? <OriginalCard o={b.original} /> : <AckCard a={b.ack} c={c} />}
        {b.parsed ? <ParsedCard p={b.parsed} /> : b.caseFields && <CaseFieldsCard v={b.caseFields} />}
      </Pair>
      <Pair even>
        {b.original && <AckCard a={b.ack} c={c} />}
        {b.dup && <DuplicateCard d={b.dup} />}
      </Pair>
    </>
  );
}

function SupplementBody({ b, onPick, onAccept }: { b: SupplementBodyView; onPick: Pick_; onAccept: () => void }) {
  const apply = useCommand(emailApplySupplement);
  if (!b.linked) return <Notice tone="warn" title="Inte kopplad">Kompletteringen kunde inte kopplas till något ärende. Koppla den manuellt.</Notice>;
  type R = (typeof b.rows)[number];
  // Två kolumner (ryms på en smal skärm): fältet med nuvarande värde som underrad, och kompletteringens värde.
  const columns: Column<R>[] = [
    {
      key: "f", label: "Fält", render: (r) => (
        <div className="flex flex-col">
          <span className="font-bold">{r.label}</span>
          <CellSub>I ärendet nu: {r.now ?? "Saknas"}</CellSub>
        </div>
      ),
    },
    {
      key: "new", label: "I kompletteringen", render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <span className="font-bold">{r.next}</span>
          {r.low ? <Badge tone="grey" icon="alert-circle">Osäker {r.pct}</Badge> : <CellSub>Säkerhet {r.pct}</CellSub>}
        </div>
      ),
    },
  ];
  const run = async () => {
    const res = await apply.run({ emailId: b.original.emailId });
    if (!res.ok) {
      toast(res.message ?? "Uppgifterna kunde inte föras in.", "error");
      return;
    }
    toast(`Uppgifterna är införda i ${b.caseNumber}. Nu kan avropet accepteras.`);
  };
  const cc = b.caseCard;
  return (
    <>
      <Notice tone="info" icon="link" title={`Kopplad automatiskt till ${b.caseNumber}`}>Svaret på ordererkännandet kopplades via ärendenumret i ämnesraden. Ingen manuell sortering behövs.</Notice>
      <Card
        title={b.applied ? "Uppgifterna är införda" : "Uppgifter att föra in"}
        icon={b.applied ? "check-circle" : "file-plus"}
        tone={b.applied ? "blue" : undefined}
        foot={
          <>
            {!b.applied && <Button kind="primary" icon="check" disabled={!!b.refErr} pending={apply.pending} onClick={() => void run()}>För in uppgifterna</Button>}
            {b.applied && b.canAccept && <Button kind="primary" icon="check" onClick={onAccept}>Acceptera avropet</Button>}
            {b.origEmailId && <Button kind="secondary" iconRight="arrow-right" onClick={() => onPick(b.origEmailId ?? "")}>Visa avropet</Button>}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {b.appliedText && <p>{b.appliedText}</p>}
          <Table caption="Uppgifter i kompletteringen" rows={b.rows} rowKey="key" columns={columns} />
          {b.refErr && <Notice tone="critical" title="Beställarreferensen har fel format">{b.refErr}</Notice>}
        </div>
      </Card>
      <Pair>
        <OriginalCard o={b.original} />
        <Card title="Ärendet" icon="briefcase">
          <Kv
            items={[
              ["Ärendenummer", <CaseLink key="c" caseId={cc.caseId} caseNumber={cc.caseNumber} />],
              ["Status", <CaseStatusBadge key="s" status={cc.status} />],
              ["Deltagare", cc.displayName],
              ["Avtalsområde", cc.areaName],
              ["Beställarreferens", cc.buyerReference || "Saknas"],
              ["Svar på avropet", cc.sla ? <SlaBadge key="sla" sla={cc.sla.sla} dueAt={cc.sla.dueAt} /> : "–"],
            ]}
          />
        </Card>
      </Pair>
    </>
  );
}

function OtherBody({ it, b }: { it: InboxItemDetail; b: OtherBodyView }) {
  const send = useCommand(messageSend);
  const setStatus = useCommand(emailSetStatus);
  const [draft, setDraft] = useState(b.draft);
  const [err, setErr] = useState<string | null>(null);
  const demo = useIsDemo();
  const c = b.caseCard;
  const doSend = async () => {
    if (!c) return;
    if (!draft.trim()) {
      setErr("Skriv ett svar.");
      return;
    }
    const res = await send.run({ caseId: c.caseId, body: draft.trim() });
    if (!res.ok) {
      toast(res.message ?? "Svaret kunde inte skickas.", "error");
      return;
    }
    toast("Svaret är skickat som säkert meddelande. Kommunen fick ett mejl utan innehåll.");
  };
  const markHandled = async () => {
    const res = await setStatus.run({ emailId: b.original.emailId, status: "handled", caseId: c?.caseId });
    if (res.ok) toast("Mejlet är markerat som hanterat.");
  };
  return (
    <>
      <Notice tone="info" title="Klassat som Övrigt – inte en beställning">
        Mejl som inte är beställningar lämnas till en människa.{b.caseNumber ? ` Det kopplades till ${b.caseNumber} via ärendenumret i texten.` : " Inget ärendenummer hittades."}
      </Notice>
      <Pair>
        <OriginalCard o={b.original} />
        {c ? (
          <Card title="Ärendet" icon="briefcase">
            <div className="flex flex-col gap-4">
              <Kv
                items={[
                  ["Ärendenummer", <CaseLink key="c" caseId={c.caseId} caseNumber={c.caseNumber} />],
                  ["Deltagare", c.displayName],
                  ["Huvudcoach", c.coachName],
                  ["Status", <CaseStatusBadge key="s" status={c.status} />],
                  ["Fas", c.phase],
                ]}
              />
              {b.custMsgs.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Caps>Senaste säkra meddelanden från kommunen</Caps>
                  {b.custMsgs.map((m) => (
                    <div key={m.id} className="flex flex-col gap-0.5">
                      <span className="text-small text-text-muted">{m.sender} · {m.when}{m.unread ? " · oläst" : ""}</span>
                      <Quote>{m.body}</Quote>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ) : (
          // Ett mejl utan ärende (till exempel en allmän fråga) – inget säkert meddelande att svara med, men det ska kunna
          // markeras som hanterat så att det inte ligger kvar i inkorgen (testdatat: em-104 sedan 2026-10-07).
          <Card
            title="Hantera"
            icon="check"
            foot={
              !b.handled
                ? <Button kind="primary" icon="check" pending={setStatus.pending} onClick={() => void markHandled()}>Markera som hanterad</Button>
                : <Badge tone="bluetone" icon="check">{b.handledText}</Badge>
            }
          >
            <p>Mejlet gäller inget ärende. Svara handläggaren till exempel per telefon. Skriv aldrig personuppgifter i vanlig e-post. Markera sedan mejlet som hanterat.</p>
          </Card>
        )}
      </Pair>
      {c && (
        <Card
          title="Svara"
          icon="send"
          foot={
            <>
              {!b.lastReply && <Button kind="primary" icon="send" pending={send.pending} onClick={() => void doSend()}>Svara med säkert meddelande</Button>}
              {!b.handled
                ? <Button kind={b.lastReply ? "primary" : "secondary"} icon="check" pending={setStatus.pending} onClick={() => void markHandled()}>Markera som hanterad</Button>
                : <Badge tone="bluetone" icon="check">{b.handledText}</Badge>}
              {demo && <WrapBtns><KommunSwitch c={it.case} /></WrapBtns>}
            </>
          }
        >
          {b.lastReply ? (
            <div className="flex flex-col gap-2">
              <Notice tone="ok" title={`Svar skickat ${b.lastReply.when} som säkert meddelande`}>Svaret ligger i ärendet i portalen. Svara inte med vanligt mejl när det gäller en deltagare.</Notice>
              <Quote>{b.lastReply.body}</Quote>
              {b.replyMail && <IconLine icon="mail"><b>Kommunen fick ett mejl utan innehåll:</b> {b.replyMail}</IconLine>}
            </div>
          ) : (
            <Field
              id="ink-reply" label="Svar till kommunen" required error={err}
              help={`Skickas som säkert meddelande i ärendet. Kommunen får bara ett mejl: ”Du har ett nytt meddelande om ärende ${c.caseNumber} – logga in för att läsa.” Förslaget bygger på schemat i ärendet – ändra fritt.`}
            >
              <TextArea value={draft} onValueChange={(x) => { setDraft(x); setErr(null); }} rows={8} maxLength={2000} />
            </Field>
          )}
        </Card>
      )}
    </>
  );
}
