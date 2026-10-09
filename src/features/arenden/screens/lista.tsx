"use client";
// Ärendelistan (prototypens arenden.lista): sök, filter, sortering och sidor om 50. Coach och handledare ser aldrig
// eskaleringar till chef. Funktionen protected_identity (persons) är borttagen ur appen (beslut 2026-10-07 – spärren är vilande i behörigheten).
import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/api/roles";
import { useQuery } from "@/shell/backend";
import { Link, useNav } from "@/shell/nav";
import { pick, pickInt, useMemoryState, useQueryPatch } from "@/shell/url-state";
import type { ScreenProps } from "@/shell/routes";
import { useSession } from "@/shell/session";
import {
  Badge, Button, Card, CaseStatusBadge, Check, Empty, ErrorNotice, Field, Input, Kpi, Loading, Page, PerspectiveLink, PhaseBar, rowNavigate, Select, Spacer, Status, cn,
} from "@/ui";
import { CASE_LIST_SCOPES, caseList, type CaseListModel, type CaseListRow } from "../api";
import { AttCell, fd, FlagBadges, pct0 } from "./common";

const PAGE = 50;
const READ_ONLY: readonly Role[] = ["chef", "admin"];
const WAITING = ["received", "acknowledged", "confirmed"];
const STATUS_KEYS = [
  ["received", "Mottagen"], ["acknowledged", "Ordererkänd"], ["confirmed", "Bekräftad"], ["active", "Pågår"], ["paused", "Pausad"], ["closed", "Avslutad"], ["declined", "Avböjd"],
] as const;
/** Rollens namn i prototypen (sidans överrubrik). */
const ROLE_EYEBROW: Partial<Record<Role, string>> = { samordnare: "Samordnare", avtalsansvarig: "Avtalsansvarig", coach: "Huvudcoach", handledare: "Handledare" };
const SORTS = [
  { value: "nyast", label: "Senast beställda först" },
  { value: "flaggor", label: "Flaggade först" },
  { value: "slut", label: "Planerat slut – närmast först" },
  { value: "nummer", label: "Ärendenummer" },
];

/** Den äldre ingången ?filter= (scenarier, länkar) översätts till listans parametrar. */
const FROM_FILTER: Record<string, Record<string, string>> = {
  aktiva: { status: "active" },
  oppna: { status: "open" },
  flaggor: { flaggor: "1", sort: "flaggor" },
};

export function ArendenListaScreen({ query }: ScreenProps) {
  const filter = query.get("filter");
  const patch = useQueryPatch();
  const q = useQuery(caseList, {});
  // ?filter=flaggor → ?flaggor=1&sort=flaggor (replace, ingen ny historikpost). Övriga val nollställs, som när listan öppnas med filtret.
  useEffect(() => {
    if (filter === null) return;
    patch({ filter: null, status: null, coach: null, omrade: null, fas: null, flaggor: null, olasta: null, sort: null, visa: null, ...(FROM_FILTER[filter] ?? {}) });
  }, [filter, patch]);
  if (q.error) return <Page title="Ärenden"><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page title="Ärenden"><Loading /></Page>;
  // Medan ?filter= översätts visas redan listan som den blir.
  const effective = filter !== null ? new URLSearchParams(FROM_FILTER[filter] ?? {}) : query;
  return <List model={q.data} query={effective} />;
}

const STATUS_VALUES = ["alla", "open", ...STATUS_KEYS.map(([v]) => v)] as const;
const SORT_VALUES = ["nyast", "flaggor", "slut", "nummer"] as const;

const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s-]/g, "");
const newest = (a: CaseListRow, b: CaseListRow) => (a.referredAt < b.referredAt ? 1 : a.referredAt > b.referredAt ? -1 : 0);

function List({ model, query }: { model: CaseListModel; query: URLSearchParams }) {
  const { actor } = useSession();
  const role = actor.role;
  const patch = useQueryPatch();
  // Smal skärm: filtren ligger under knappen "Filter (n)" – sökfältet först.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Valen ligger i adressen (Tillbaka och omladdning visar samma lista). Söktexten kan vara ett namn: bara i minnet.
  const [q, setQ] = useMemoryState("q", "");
  // Coach och handledare: öppna ärenden som standard (avslutade finns under "Alla statusar"); övriga roller alla.
  const defaultStatus: (typeof STATUS_VALUES)[number] = role === "coach" || role === "handledare" ? "open" : "alla";
  const status = pick(query, "status", STATUS_VALUES, defaultStatus);
  // Alla på Miljonbemanning ser alla ärenden i avtalet (beslut 2026-10-09). Coachen börjar i sina egna (huvudcoach eller i
  // teamet). Den vilande rollen handledare (beslut 2026-10-09) börjar i alla.
  const scopeable = role === "coach" || role === "handledare";
  const defaultScope: (typeof CASE_LIST_SCOPES)[number] = role === "coach" ? "mina" : "alla";
  const scope = scopeable ? pick(query, "vilka", CASE_LIST_SCOPES, defaultScope) : "alla";
  const coach = model.coaches.some((u) => u.id === query.get("coach")) ? (query.get("coach") as string) : "";
  const area = model.areas.some((a) => a.code === query.get("omrade")) ? (query.get("omrade") as string) : "";
  const phase = model.phases.some((p) => String(p.no) === query.get("fas")) ? (query.get("fas") as string) : "";
  const onlyFlags = query.get("flaggor") === "1";
  const onlyUnread = query.get("olasta") === "1";
  const sort = pick(query, "sort", SORT_VALUES, "nyast");
  const limit = pickInt(query, "visa", PAGE);
  const setLimit = (n: number) => patch({ visa: n > PAGE ? n : null });
  // Ett ändrat filter visar de första 50 igen.
  const setStatus = (v: string) => patch({ status: v === defaultStatus ? null : v, visa: null });
  const setScope = (v: string) => patch({ vilka: v === defaultScope ? null : v, visa: null });
  const setCoach = (v: string) => patch({ coach: v || null, visa: null });
  const setArea = (v: string) => patch({ omrade: v || null, visa: null });
  const setPhase = (v: string) => patch({ fas: v || null, visa: null });
  const setOnlyFlags = (v: boolean) => patch({ flaggor: v, visa: null });
  const setOnlyUnread = (v: boolean) => patch({ olasta: v, visa: null });
  const setSort = (v: string) => patch({ sort: v === "nyast" ? null : v });
  const search = (v: string) => {
    setQ(v);
    if (limit !== PAGE) setLimit(PAGE);
  };
  const all = useMemo(() => (scope === "mina" ? model.rows.filter((c) => c.mine) : model.rows), [model.rows, scope]);
  const readOnly = READ_ONLY.includes(role);
  const needle = norm(q);

  const rows = useMemo(() => {
    const out = all.filter((c) => {
      if (status === "open" && (c.status === "closed" || c.status === "declined")) return false;
      if (status !== "alla" && status !== "open" && c.status !== status) return false;
      if (onlyFlags && !c.flagged) return false;
      if (onlyUnread && !(c.detail?.unread ?? 0)) return false;
      if (coach && c.detail?.leadCoachId !== coach) return false;
      if (area && c.detail?.areaCode !== area) return false;
      if (phase && String(c.detail?.phase) !== phase) return false;
      if (needle && !norm(`${c.caseNumber} ${c.displayName}`).includes(needle)) return false;
      return true;
    });
    const sorters: Record<string, (a: CaseListRow, b: CaseListRow) => number> = {
      nyast: newest,
      flaggor: (a, b) => a.flagRank - b.flagRank || newest(a, b),
      slut: (a, b) => (a.endSortKey < b.endSortKey ? -1 : a.endSortKey > b.endSortKey ? 1 : newest(a, b)),
      nummer: (a, b) => (a.caseNumber < b.caseNumber ? -1 : 1),
    };
    return out.sort(sorters[sort] ?? newest);
  }, [all, status, onlyFlags, onlyUnread, coach, area, phase, needle, sort]);
  const shown = rows.slice(0, limit);
  const anyFilter = !!(q || status !== defaultStatus || scope !== defaultScope || coach || area || phase || onlyFlags || onlyUnread);
  const nFilters = [status !== defaultStatus, scope !== defaultScope, coach, area, phase, onlyFlags, onlyUnread].filter(Boolean).length;
  const clear = () => {
    setQ("");
    patch({ status: null, vilka: null, coach: null, omrade: null, fas: null, flaggor: null, olasta: null, visa: null });
  };
  const nUnread = all.filter((c) => (c.detail?.unread ?? 0) > 0).length;
  const nActive = all.filter((c) => c.status === "active").length;
  const nWaiting = all.filter((c) => WAITING.includes(c.status)).length;
  const nFlag = all.filter((c) => c.flagged).length;
  const showCoach = !scopeable || scope === "alla";
  const title = role === "coach" && scope === "mina" ? "Mina ärenden" : "Ärenden";
  const customer = model.customerName;
  const lead =
    scope === "mina"
      ? `Ärenden där du är ${role === "coach" ? "huvudcoach eller ingår i teamet" : "med i teamet"}. Välj Alla ärenden för att se hela avtalet. Klicka på en rad för att öppna deltagarkortet.`
      : readOnly
        ? `Alla ärenden i avtalet med ${customer}. Du ser dem i läsläge.`
        : `Alla ärenden i avtalet med ${customer}. Klicka på en rad för att öppna deltagarkortet.`;
  const hrefOf = (c: CaseListRow) => `/arenden/${encodeURIComponent(c.id)}`;
  const w4 = model.weeks;
  const today = model.today;

  return (
    <Page
      title={title}
      eyebrow={readOnly ? "Läsläge" : ROLE_EYEBROW[role]}
      lead={lead}
      actions={
        <>
          {readOnly && <Badge tone="outline" icon="eye">Läsläge – inga ändringar</Badge>}
          <PerspectiveLink role="kommun_handlaggare" to="/portal/deltagare" label="Se kommunens lista" />
        </>
      }
    >
      <Card title="Sök och filtrera" icon="filter">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] items-end gap-x-4 gap-y-3">
          <div className="col-span-full">
            <Field label="Sök" id="arn-q" help="Namn eller en del av ärendenumret.">
              <Input type="search" value={q} onValueChange={search} />
            </Field>
          </div>
          <div className="col-span-full hidden max-[620px]:flex max-[620px]:flex-wrap max-[620px]:items-center max-[620px]:gap-2">
            <Button icon="filter" aria-expanded={filtersOpen} aria-controls="arn-filter" onClick={() => setFiltersOpen(!filtersOpen)}>
              Filter ({nFilters})
            </Button>
            {anyFilter && (
              <Button kind="ghost" icon="x" onClick={clear}>
                Rensa filter
              </Button>
            )}
          </div>
        </div>
        <div id="arn-filter" className={cn("mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] items-end gap-x-4 gap-y-3", !filtersOpen && "max-[620px]:hidden")}>
          {scopeable && (
            <Field label="Visa" id="arn-vilka">
              <Select value={scope} onValueChange={setScope} options={[{ value: "mina", label: "Mina ärenden" }, { value: "alla", label: "Alla ärenden i avtalet" }]} />
            </Field>
          )}
          <Field label="Status" id="arn-status">
            <Select value={status} onValueChange={setStatus} options={[{ value: "alla", label: "Alla statusar" }, { value: "open", label: "Öppna (inte avslutade)" }, ...STATUS_KEYS.map(([value, label]) => ({ value, label }))]} />
          </Field>
          {showCoach && (
            <Field label="Huvudcoach" id="arn-coach">
              <Select value={coach} onValueChange={setCoach} placeholder="Alla coacher" options={model.coaches.map((u) => ({ value: u.id, label: u.name }))} />
            </Field>
          )}
          <Field label="Avtalsområde" id="arn-area">
            <Select value={area} onValueChange={setArea} placeholder="Alla områden" options={model.areas.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))} />
          </Field>
          <Field label="Fas" id="arn-phase">
            <Select value={phase} onValueChange={setPhase} placeholder="Alla faser" options={model.phases.map((p) => ({ value: String(p.no), label: `Fas ${p.no} · ${p.name}` }))} />
          </Field>
        </div>
        <div className={cn("mt-2 flex flex-wrap items-center gap-x-6 gap-y-1", !filtersOpen && "max-[620px]:hidden")}>
          <Check id="arn-onlyflags" checked={onlyFlags} onCheckedChange={setOnlyFlags}>
            Bara ärenden med flaggor ({nFlag})
          </Check>
          {(nUnread > 0 || onlyUnread) && (
            <Check id="arn-onlyunread" checked={onlyUnread} onCheckedChange={setOnlyUnread}>
              Bara olästa meddelanden från kommunen ({nUnread})
            </Check>
          )}
          <Spacer />
          {anyFilter && (
            <Button kind="ghost" icon="x" onClick={clear} className="max-[620px]:hidden">
              Rensa filter
            </Button>
          )}
        </div>
      </Card>

      {/* Nyckeltalen efter sökningen (också i koden – samma ordning för skärmläsare och tangentbord), så att sökfältet syns
          direkt under rubriken på smal skärm. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3 max-[620px]:grid-cols-2 max-[620px]:[&>div]:p-3 max-[620px]:[&>div>div:nth-child(2)]:text-[1.5rem]">
        <Kpi label="Ärenden du ser" value={all.length} sub={scope === "mina" ? "dina ärenden – välj Alla för hela avtalet" : "enligt din behörighet"} />
        <Kpi label="Pågår" value={nActive} sub="aktiva insatser" />
        <Kpi label="Väntar på start" value={nWaiting} sub="mottagna eller bekräftade" />
        <Kpi label="Med flaggor" value={nFlag} sub={nFlag > 0 ? "behöver uppmärksamhet" : "inga flaggor för din roll"} tone={nFlag > 0 ? "watch" : undefined} />
      </div>


      <Card
        flush
        title={`${rows.length} ${rows.length === 1 ? "ärende" : "ärenden"}`}
        icon="list"
        actions={
          rows.length > 1 && (
            <div className="flex max-w-full items-center gap-2">
              <label className="text-small font-bold" htmlFor="arn-sort">
                Sortera
              </label>
              <Select id="arn-sort" value={sort} onValueChange={setSort} options={SORTS} className="min-h-11 w-auto max-w-full px-2.5 py-1.5 text-ui" />
            </div>
          )
        }
        foot={
          rows.length > 0 && (
            <>
              <span className="text-small text-text-muted">
                Visar {shown.length} av {rows.length}
              </span>
              <Spacer />
              {rows.length > limit && (
                <Button icon="chevron-down" onClick={() => setLimit(limit + PAGE)}>
                  Visa {Math.min(PAGE, rows.length - limit)} till
                </Button>
              )}
              {rows.length > limit + PAGE && (
                <Button kind="ghost" onClick={() => setLimit(rows.length)}>
                  Visa alla
                </Button>
              )}
            </>
          )
        }
      >
        {rows.length === 0 ? (
          anyFilter ? (
            <Empty icon="search" title="Inga ärenden matchar" action={<Button icon="x" onClick={clear}>Rensa filter</Button>}>
              Ändra sökningen eller filtren.
            </Empty>
          ) : all.length > 0 ? (
            // Standardfiltret (öppna ärenden) döljer allt: alla ärenden är avslutade eller avböjda.
            <Empty icon="search" title="Inga öppna ärenden" action={<Button onClick={() => setStatus("alla")}>Visa alla statusar</Button>}>
              Alla dina ärenden är avslutade eller avböjda.
            </Empty>
          ) : role === "coach" || role === "handledare" ? (
            <Empty icon="users" title="Du har inga ärenden ännu">
              Samordnaren tilldelar dig ärenden när ett avrop har accepterats. De visas här.
            </Empty>
          ) : (
            <Empty
              icon="users"
              title="Inga ärenden ännu"
              action={(role === "samordnare" || role === "avtalsansvarig") && <Button icon="inbox" to="/inkorg">Öppna avropsinkorgen</Button>}
            >
              Ett ärende skapas när ett avrop accepteras i avropsinkorgen.
            </Empty>
          )
        ) : (
          <>
            {/* 16 px i cellerna: tabellen från 1261 px, listan under (annars rullar tabellen i sidled vid 1241–1260 px). */}
            <div className="max-[1260px]:hidden">
              <WideTable rows={shown} today={today} weeks={w4} hrefOf={hrefOf} />
            </div>
            <div className="hidden max-[1260px]:block">
              <div className="flex flex-col">{shown.map((c) => <NarrowItem key={c.id} c={c} weeksLabel={w4.label} href={hrefOf(c)} />)}</div>
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <Badge tone="dark" icon="message" title="Olästa meddelanden från kommunen" className="px-[7px] py-0.5">
      {n === 1 ? "Nytt meddelande" : `${n} nya meddelanden`}
    </Badge>
  );
}

const TH = "border-b-2 border-antracit bg-vit px-2 py-[9px] max-[1300px]:px-1.5 text-left align-bottom text-label font-extrabold tracking-[0.08em] text-text-muted uppercase first:pl-4";
const TD = "border-b border-ljusgra px-2 py-[9px] align-top first:pl-4 max-[1300px]:px-1.5 max-[1300px]:first:pl-4";
const sub = "text-small text-text-muted";

/**
 * Bred tabell. Ärendenumret är en riktig länk (tabbstopp, länkmeny vid högerklick, ny flik med ctrl/cmd eller mittenklick);
 * klick någonstans i raden gör samma sak.
 */
function WideTable({ rows, today, weeks, hrefOf }: { rows: CaseListRow[]; today: string; weeks: CaseListModel["weeks"]; hrefOf: (c: CaseListRow) => string }) {
  const nav = useNav();
  return (
    <div className="overflow-x-auto rounded-card">
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">Ärenden</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>Ärende</th>
            <th scope="col" className={TH}>Deltagare och område</th>
            <th scope="col" className={TH}>Status och fas</th>
            <th scope="col" className={TH}>Huvud&shy;coach</th>
            <th scope="col" className={TH}>Start – slut</th>
            <th scope="col" className={TH}>Senaste status</th>
            <th scope="col" className={TH} title={`${fd(weeks.from, today)}–${fd(weeks.to, today)}`}>Närvaro {weeks.label}</th>
            <th scope="col" className={TH}>Flaggor och meddelanden</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const d = c.detail;
            return (
              <tr key={c.id} className="cursor-pointer hover:[&>td]:bg-ljusgra-ton" onClick={(e) => rowNavigate(nav, hrefOf(c), e)} onAuxClick={(e) => rowNavigate(nav, hrefOf(c), e)}>
                <td className={`${TD} whitespace-nowrap`}>
                  <Link to={hrefOf(c)} className="inline-flex min-h-11 items-center font-bold tabular-nums tracking-[0.01em] underline underline-offset-3">
                    {c.caseNumber}
                    <span className="sr-only"> – {c.displayName}</span>
                  </Link>
                </td>
                <td className={`${TD} min-w-[150px]`}>
                  <div className="font-bold">{c.displayName}</div>
                  <div className={sub}>
                    {d.areaName}
                    {d.vocationalTrack ? ` · ${d.vocationalTrack}` : ""}
                  </div>
                </td>
                <td className={TD} title={`Fas ${d.phase} · ${d.phaseName}`}>
                  <div className="flex min-w-[118px] max-w-[170px] flex-col items-start gap-[5px]">
                    <CaseStatusBadge status={c.status} />
                    <div className="w-full max-w-[150px]">
                      <PhaseBar phase={d.phase} />
                    </div>
                    <span className={sub}>
                      Fas {d.phase} · {d.phaseName}
                    </span>
                  </div>
                </td>
                <td className={TD}>{d.leadCoachName ?? <span className="text-text-muted">Inte tilldelad</span>}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  {d.end ? (
                    <>
                      {fd(d.start, today)} –
                      <br />
                      {fd(d.end, today)}
                      {d.startNote && <div className={sub}>{d.startNote}</div>}
                    </>
                  ) : (
                    // Inget slut bestämt: bara starten och en underrad – inte två staplade streck.
                    <>
                      {fd(d.start, today)}
                      <div className={sub}>{d.startNote ?? "slut inte bestämt"}</div>
                    </>
                  )}
                </td>
                <td className={TD}>
                  {d.latest ? (
                    <>
                      <Status value={d.latest.overallStatus} short />
                      <div className={sub}>{fd(d.latest.heldAt, today)}</div>
                    </>
                  ) : (
                    <span className="text-small text-text-muted">Ingen ännu</span>
                  )}
                </td>
                <td className={TD}>
                  <AttCell st={d.attendance} />
                </td>
                <td className={`${TD} [&_div]:max-w-[150px]`}>
                  {d.unread > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      <UnreadBadge n={d.unread} />
                      {d.flags.length > 0 && <FlagBadges list={d.flags} />}
                    </div>
                  ) : (
                    <FlagBadges list={d.flags} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NarrowItem({ c, weeksLabel, href }: { c: CaseListRow; weeksLabel: string; href: string }) {
  const cls = "flex w-full min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 text-left last:border-b-0 max-[620px]:flex-wrap";
  const d = c.detail;
  const ast = d.attendance;
  return (
    <Link to={href} className={`${cls} cursor-pointer bg-transparent text-inherit no-underline [font:inherit] hover:bg-ljusgra-ton`}>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px] max-[620px]:basis-[calc(100%-44px)]">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold whitespace-nowrap tabular-nums">{c.caseNumber}</span>
          <CaseStatusBadge status={c.status} />
        </span>
        <span className="block font-bold">{c.displayName}</span>
        <span className={sub}>
          {d.areaName} · Fas {d.phase} · {d.leadCoachName ?? "Ingen coach ännu"}
        </span>
        <span className={sub}>
          Närvaro {weeksLabel}: {ast.planned - ast.unregistered > 0 ? pct0(ast.rate) : "inga tillfällen"}
        </span>
        {(d.unread > 0 || d.flags.length > 0) && (
          <span className="flex flex-wrap gap-1">
            <UnreadBadge n={d.unread} />
            {d.flags.length > 0 && <FlagBadges list={d.flags} />}
          </span>
        )}
      </span>
      <span className="flex flex-none flex-col items-end gap-1 max-[620px]:w-full max-[620px]:flex-row max-[620px]:flex-wrap max-[620px]:items-center max-[620px]:justify-start">
        {d.latest ? <Status value={d.latest.overallStatus} short /> : <span className="text-small text-text-muted">Ej bedömd</span>}
      </span>
    </Link>
  );
}
