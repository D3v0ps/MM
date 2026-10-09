"use client";
// Deltagarkortet (prototypens arende.kort): huvud med insatsen, deltagaren och teamet, samtycke, åtgärder och flikar.
// Chef och systemadmin läser bara. Handledare (teamet) ser fem flikar – inga coachanteckningar, bedömningar eller rapporter.
// Visningen loggas i revisionsloggen (case.view), liksom försök utan behörighet (case.view_denied).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePageTitle } from "@/shell/page-effects";
import { useCommand, usePrefetch, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { addWorkingDays, dayOf, fmtDate, fmtDateShort, fmtDateTime, fmtDateTimeLong, fmtTime, holidayName, isWorkingDay } from "@/core/time";
import {
  Badge, BuildPhase, Button, Card, CaseStatusBadge, Check, DateTimeInput, Empty, ErrorNotice, Field, Icon, Kv, Loading, MaskedPnr, Modal, Notice, Page, PerspectiveLink,
  anchorTabs, PhaseBar, Select, SlaBadge, Stack, Tabs, TabPanel, TextArea, toast, useAuditView, useConfirm, UserName,
} from "@/ui";
import { auditView } from "@/features/session/api";
import { recordingOffered } from "@/features/coach/api";
import {
  caseAttendance, caseBookFirstMeeting, caseCard, caseChangeCoach, caseCheckIns, caseDeviations, caseEvents, caseHistory, caseIntake, caseMessages, caseMonthBasis,
  caseOverview, casePlacements, caseReports, caseRevealPnr, caseTimeline, CASE_TABS, consentSet, messageRead, TEAM_TABS, type CaseCard, type CaseTab,
} from "../api";
import { canOpen, cap, fd, Facts, Label, MiniList } from "./common";
import { TabAvstamningar, TabKartlaggning, TabNarvaro, TabOversikt } from "./kort-flikar";
import { TabManad } from "./kort-manad";
import { TabTidslinje } from "./kort-tidslinje";
import { TabAvvikelser, TabHandelser, TabPraktik } from "./kort-arbete";
import { ActivityModal, StartModal, TeamModal } from "./kort-start";
import { TabHistorik, TabMeddelanden, TabRapporter } from "./kort-kommunikation";
import { VoiceNotesRow } from "@/features/rost/screens/coach-parts";
import { CaseGroupingRow } from "@/features/grupper/screens/grouping-card";

const TAB_LABEL: Record<CaseTab, string> = {
  oversikt: "Översikt", tidslinje: "Tidslinje", kartlaggning: "Kartläggning", avstamningar: "Möten", narvaro: "Närvaro", manad: "Månadsunderlag",
  handelser: "Händelser och utfall", avvikelser: "Avvikelser", praktik: "Praktik", rapporter: "Rapporter", meddelanden: "Meddelanden", historik: "Historik",
};
const CUST_WHO = { kommun_handlaggare: "kommunen" } as const;

/** Vad varje flik får från kortet. */
export type TabProps = {
  card: CaseCard;
  /** Byt flik (samma historikpost, ingen hoppning). */
  setTab: (t: CaseTab) => void;
  /** Öppna en post i en annan flik (ny historikpost, så att Tillbaka leder tillbaka). mal = postens id (timeline.ts). */
  openTab: (t: CaseTab, o?: { mal?: string | null; manad?: string | null }) => void;
  openModal: (m: ModalKind) => void;
};
type ModalKind = "coach" | "meeting" | "consent" | "start" | "plan" | "activity" | "team";

function useCrumbs() {
  const role = useSession().actor.role;
  return [role === "handledare" ? { label: "Mina tilldelade ärenden", to: "/handledare" } : { label: role === "coach" ? "Mina ärenden" : "Ärenden", to: "/arenden" }];
}

export function DeltagarkortScreen({ params, query }: ScreenProps) {
  const caseId = params.caseId;
  const crumbs = useCrumbs();
  const q = useQuery(caseCard, caseId ? { caseId } : null);
  const logView = useCommand(auditView);
  const kind = q.data?.kind;
  useAuditView(kind === "ok" ? `case.view:${caseId}` : kind === "denied" ? `case.view_denied:${caseId}` : null, () =>
    logView.run({ action: kind === "ok" ? "case.view" : "case.view_denied", entity: "case", entityId: caseId }).catch(() => undefined),
  );
  const caseNumber = q.data?.kind === "ok" ? q.data.caseNumber : null;
  usePageTitle(caseNumber ? `Deltagarkort ${caseNumber}` : null);

  if (q.error) return <Page title="Deltagarkort" crumbs={crumbs}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page title="Deltagarkort" crumbs={crumbs}><Loading /></Page>;
  const d = q.data;
  if (d.kind === "not_found") {
    return (
      <Page title="Ärendet hittades inte" crumbs={crumbs}>
        <Card>
          <Empty icon="search" title="Det finns inget ärende med den länken" action={<Button kind="primary" icon="list" to={crumbs[0].to}>Till ärendelistan</Button>}>
            Ärendet kan ha tagits bort. Sök i ärendelistan i stället.
          </Empty>
        </Card>
      </Page>
    );
  }
  if (d.kind === "denied") return <NoAccess crumbs={crumbs} />;
  return <CaseView card={d} crumbs={crumbs} flik={query.get("flik")} manad={query.get("manad")} mal={query.get("mal")} visa={query.get("visa")} starta={query.get("starta") === "1"} />;
}

function NoAccess({ crumbs }: { crumbs: { label: string; to: string }[] }) {
  return (
    <Page eyebrow="Ärende" title="Åtkomst saknas" crumbs={[...crumbs, { label: "Åtkomst saknas" }]}>
      <Card tone="sub">
        <div className="flex flex-nowrap items-start gap-4">
          <Icon name="lock" size="xl" />
          <Stack gap="sm" className="min-w-0">
            <h2 className="text-h2 font-extrabold">Du saknar åtkomst till det här deltagarkortet</h2>
            <p>
              Du ser bara ärenden i avtal där du är medlem. Behöver du arbeta i ärendet? Kontakta samordnaren.
            </p>
            <p className="text-text-muted">Försöket att öppna kortet är loggat i revisionsloggen.</p>
          </Stack>
        </div>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button kind="primary" icon="arrow-left" to={crumbs[0].to}>Tillbaka till listan</Button>
      </div>
    </Page>
  );
}

/** Perspektivbyte till kundens ärendesida (bara i prototypen). Visas inte om ingen kundroll har åtkomst. */
export function CustSwitch({ card, tab, label }: { card: CaseCard; tab?: string | null; label: (who: string) => string }) {
  const r = card.customerRole;
  if (!r) return null;
  return <PerspectiveLink role={r} to={path(`/portal/deltagare/${encodeURIComponent(card.caseId)}`, { flik: tab ?? null })} label={label(CUST_WHO[r])} />;
}

/** Förhämta en fliks data – exakt samma fråga och parametrar som fliken själv använder (samma nyckel i cachen). */
function prefetchCaseTab(prefetch: ReturnType<typeof usePrefetch>, t: CaseTab, caseId: string) {
  const p = { caseId };
  switch (t) {
    case "oversikt": return prefetch(caseOverview, p);
    case "tidslinje": return prefetch(caseTimeline, { caseId, visa: "alla" });
    case "kartlaggning": return prefetch(caseIntake, p);
    case "avstamningar": return prefetch(caseCheckIns, p);
    case "narvaro": return prefetch(caseAttendance, p);
    case "manad": return prefetch(caseMonthBasis, p);
    case "handelser": return prefetch(caseEvents, p);
    case "avvikelser": return prefetch(caseDeviations, p);
    case "praktik": return prefetch(casePlacements, p);
    case "rapporter": return prefetch(caseReports, p);
    case "meddelanden": return prefetch(caseMessages, p);
    case "historik": return prefetch(caseHistory, p);
  }
}

/** Tidslinjens id (timeline.ts) → postens mål i fliken (data-mal). Flera tidslinjeposter pekar på samma rad. */
export const malOf = (id: string): string =>
  id.replace(/^act:/, "att:").replace(/^dev-end:/, "dev:").replace(/^pl-(start|end):/, "pl:");

/**
 * "Öppna" i tidslinjen: visa posten (?mal=) i sin flik – skrolla dit, fokusera och markera den en stund. Finns den inte
 * (t.ex. kartläggningen) visas flikens början. Bara id:n i adressen.
 */
function useScrollToTarget(mal: string | null, tab: CaseTab, panelId: string) {
  useEffect(() => {
    if (!mal) return;
    const want = malOf(mal);
    let stop = false;
    let clear = 0;
    const t0 = performance.now();
    const tick = () => {
      if (stop) return;
      const panel = document.getElementById(panelId);
      // Flera träffar (tabell och lista för smal skärm): den som syns.
      const el = [...(panel?.querySelectorAll<HTMLElement>(`[data-mal="${CSS.escape(want)}"]`) ?? [])].find((x) => x.getClientRects().length > 0);
      const waited = performance.now() - t0;
      if (el) {
        // Direkt, utan mjuk skroll: Tillbaka direkt efteråt ska inte krocka med en pågående skrollanimation.
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
        el.setAttribute("data-mal-active", "");
        clear = window.setTimeout(() => el.removeAttribute("data-mal-active"), 2000);
        return;
      }
      if (panel && ((waited > 400 && !panel.querySelector("[data-loading]")) || waited > 3000)) {
        anchorTabs(panel.parentElement?.querySelector<HTMLElement>("[role=tablist]")?.parentElement ?? null, panelId, true);
        panel.focus({ preventScroll: true });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      stop = true;
      window.clearTimeout(clear);
    };
  }, [mal, tab, panelId]);
}

/** "Visa alla uppgifter" kommer ihåg läget under sessionen (bara i minnet, aldrig i adressen). */
let showAllFacts = false;

function CaseView({ card, crumbs, flik, manad, mal, visa, starta }: { card: CaseCard; crumbs: { label: string; to: string }[]; flik: string | null; manad: string | null; mal: string | null; visa: string | null; starta: boolean }) {
  const nav = useNav();
  const role = useSession().actor.role;
  const team = card.access === "team";
  const tabIds: readonly CaseTab[] = team ? TEAM_TABS : CASE_TABS;
  // ?visa=rost ("Läs röstmeddelandet" på Min vecka): röstmeddelandena ligger under Meddelanden sedan 2026-10-09.
  const tab: CaseTab = tabIds.includes(flik as CaseTab) ? (flik as CaseTab) : visa === "rost" && tabIds.includes("meddelanden") ? "meddelanden" : "oversikt";
  const blocked = !!flik && !tabIds.includes(flik as CaseTab) && (CASE_TABS as readonly string[]).includes(flik);
  const [modal, setModal] = useState<ModalKind | null>(null);
  // ?starta=1 (knappen Starta insatsen på Min vecka): dialogen öppnas en gång när kortet har laddats.
  const autoStarted = useRef(false);
  const canStart = !!card.start;
  useEffect(() => {
    if (starta && canStart && !autoStarted.current) {
      autoStarted.current = true;
      setModal("start");
    }
  }, [starta, canStart]);
  const base = `/arenden/${encodeURIComponent(card.caseId)}`;
  // Flikbyte: samma historikpost (replace) och ingen hoppning – Tillbaka lämnar kortet. Länkar i kortet byter flik likadant.
  const setTab = (t: CaseTab) => nav.replace(path(base, { flik: t === "oversikt" ? null : t }));
  // "Öppna" från tidslinjen: en ny historikpost med målet, så att Tillbaka leder tillbaka till tidslinjen.
  const openTab = (t: CaseTab, o: { mal?: string | null; manad?: string | null } = {}) =>
    nav.push(path(base, { flik: t === "oversikt" ? null : t, manad: o.manad ?? null, mal: o.mal ?? null }));
  const prefetch = usePrefetch();
  const prefetchTab = (t: CaseTab) => {
    if (tabIds.includes(t)) prefetchCaseTab(prefetch, t, card.caseId);
  };
  // När kortet har laddats och webbläsaren är ledig: förhämta de flikar som öppnas oftast.
  useEffect(() => {
    const run = () => {
      for (const t of ["tidslinje", "narvaro"] as const) if (tabIds.includes(t)) prefetchCaseTab(prefetch, t, card.caseId);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(run, 500);
    return () => window.clearTimeout(t);
    // tabIds följer team.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.caseId, team, prefetch]);
  useScrollToTarget(mal, tab, "arende-panel");
  const read = useCommand(messageRead);
  const unread = card.unread;
  useEffect(() => {
    if (tab === "meddelanden" && unread > 0) void read.run({ caseId: card.caseId }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, unread, card.caseId]);
  const tabs = tabIds.map((id) => ({
    id,
    label: team && id === "handelser" ? "Arbetsgivarkontakter och händelser" : TAB_LABEL[id],
    count: id === "meddelanden" ? unread : id === "avvikelser" ? card.openDeviations : id === "oversikt" ? card.flags.length : null,
  }));
  const props: TabProps = { card, setTab, openTab, openModal: setModal };

  return (
    <Page
      eyebrow={`Deltagarkort · ${card.caseNumber}`}
      title={card.displayName}
      crumbs={[...crumbs, { label: card.caseNumber }]}
      lead={`${card.areaName}${card.vocationalTrack ? ` · ${card.vocationalTrack}` : ""}`}
      actions={!team && <CustSwitch card={card} tab={tab === "rapporter" || tab === "meddelanden" ? tab : null} label={(who) => `Se ärendet som ${who}`} />}
    >
      {card.readOnly && (
        <Notice tone="info" icon="eye" title="Läsläge">
          Du kan inte ändra något i ärendet. Visningen loggas.
        </Notice>
      )}
      {team && (
        <Notice tone="info" icon="users" title={`Du ingår i teamet som ${(card.myTeamRoleLabel ?? "").toLowerCase()}`} />
      )}
      {!team && card.myTeamRoleLabel && (
        <Notice tone="info" icon="users" title={`Du ingår i teamet som ${card.myTeamRoleLabel.toLowerCase()}`} />
      )}

      <CaseSummary card={card} openModal={setModal} />

      <Stack>
        <Tabs
          id="arende"
          tabs={tabs}
          active={tab}
          onChange={setTab}
          onIntent={prefetchTab}
          sticky
          ariaLabel="Delar av deltagarkortet"
          className="relative min-[621px]:flex-wrap min-[621px]:overflow-x-visible [&_[role=tab]]:px-2.5"
        />
        {blocked && (
          <Notice tone="info" title="Den delen visas inte för din roll" />
        )}
        {mal && tab !== "tidslinje" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-mb bg-bla-ton px-3 py-1.5 text-small">
            <Icon name="info" />
            <span>Du kom hit från tidslinjen. Raden är markerad.</span>
            <Button kind="ghost" icon="arrow-left" onClick={() => nav.back()}>
              Tillbaka till tidslinjen
            </Button>
          </div>
        )}
        {/* Minsta höjd: flikraden kan alltid ligga överst efter ett flikbyte, även när fliken är kort eller laddar. */}
        <TabPanel tabsId="arende" active={tab} className="min-h-[calc(100dvh-var(--mm-sticky-top,0px)-9rem)]">
          {tab === "oversikt" && <TabOversikt {...props} />}
          {tab === "tidslinje" && <TabTidslinje {...props} />}
          {tab === "kartlaggning" && <TabKartlaggning {...props} />}
          {tab === "avstamningar" && <TabAvstamningar {...props} />}
          {tab === "narvaro" && <TabNarvaro {...props} />}
          {tab === "manad" && <TabManad {...props} month={manad && /^\d{4}-\d{2}$/.test(manad) ? manad : null} />}
          {tab === "handelser" && <TabHandelser {...props} />}
          {tab === "avvikelser" && <TabAvvikelser {...props} />}
          {tab === "praktik" && <TabPraktik {...props} />}
          {tab === "rapporter" && <TabRapporter {...props} />}
          {tab === "meddelanden" && (
            <Stack>
              {/* Deltagarens röstmeddelanden (flyttade hit från kortets topp 2026-10-09) läses av coach, samordnare, avtalsansvarig, chef och admin (rost.caseVoice) – inte handledaren. */}
              {!team && role !== "handledare" && (
                <div className="rounded-card border border-ljusgra bg-vit px-[18px] py-4">
                  <VoiceNotesRow caseId={card.caseId} autoOpen={visa === "rost"} />
                </div>
              )}
              <TabMeddelanden {...props} />
            </Stack>
          )}
          {tab === "historik" && <TabHistorik {...props} />}
        </TabPanel>
      </Stack>

      {modal === "coach" && <CoachModal card={card} onClose={() => setModal(null)} />}
      {modal === "meeting" && <MeetingModal card={card} onClose={() => setModal(null)} />}
      {modal === "consent" && <ConsentModal card={card} onClose={() => setModal(null)} />}
      {modal === "start" && card.start && <StartModal card={card} mode="start" onClose={() => setModal(null)} />}
      {modal === "plan" && <StartModal card={card} mode="plan" onClose={() => setModal(null)} />}
      {modal === "activity" && (
        <ActivityModal cases={[{ caseId: card.caseId, caseNumber: card.caseNumber, name: card.displayName, location: card.location }]} now={card.now} onClose={() => setModal(null)} />
      )}
      {modal === "team" && <TeamModal card={card} onClose={() => setModal(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------- Huvud (kompakt)
// Det viktigaste på några rader så att flikarna syns utan att skrolla: status och fas, huvudcoach, start, slut och
// handläggare, varningar, åtgärder och samtycke. Röstmeddelandena ligger under fliken Meddelanden. Allt annat under "Visa alla uppgifter" – inget har tagits bort.
function CaseSummary({ card: c, openModal }: { card: CaseCard; openModal: (m: ModalKind) => void }) {
  const team = c.access === "team";
  const [all, setAll] = useState(showAllFacts);
  const toggle = () => {
    showAllFacts = !all;
    setAll(!all);
  };
  const k = c.referrer;
  const fact = (label: string, value: ReactNode) => (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-text-muted">{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
  const warn: ReactNode[] = [];
  if (c.buyer && !c.buyer.reference) warn.push(<Badge key="ref" tone="red" icon="alert-circle">Beställarreferens saknas – krävs för bekräftelse och faktura</Badge>);
  if (c.buyer?.reference && c.buyer.problem) warn.push(<Badge key="refp" tone="red" icon="alert-circle">Beställarreferensen: {c.buyer.problem}</Badge>);
  if (c.endDate && c.resultPrelim) warn.push(<Badge key="prel" tone="red" icon="alert-circle">Preliminärt – verifiering saknas</Badge>);
  const row = "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ljusgra pt-3";
  // En ruta med kortets utseende men utan egen rubrik (div, inte section): flikarnas och rutornas rubriker står för sig.
  return (
    <div role="group" aria-label="Ärendet i korthet" className="flex min-w-0 flex-col gap-3 rounded-card border border-ljusgra bg-vit px-[18px] py-4">
      {/* Rad A: status, fas och markeringar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <CaseStatusBadge status={c.status} />
          {/* Fasen står en gång: stapeln och texten "Fas 4 av 5 · …" här intill. Läsläget står i rutan överst på sidan. */}
          {c.stuck && (
            // Kvitterad flagga (Min vecka, listan): taggen säger det – annars ser det ut som att kvitteringen inte tog.
            <Badge tone={c.stuck.acked ? "outline" : "grey"} icon={c.stuck.acked ? "check" : "clock"}>
              Fastnat: {c.stuck.days} dagar i fas {c.stuck.phase} (gräns {c.stuck.maxDays})
              {c.stuck.acked ? ` · kvitterad av ${c.stuck.acked.byName} ${fmtDateShort(c.stuck.acked.at)}` : ""}
            </Badge>
          )}
        </span>
        <span className="flex min-w-[min(100%,260px)] flex-1 items-center gap-2.5">
          <span className="w-24 flex-none [&_[role=img]>div]:h-2">
            <PhaseBar phase={c.phase} total={c.phaseCount} />
          </span>
          <span className="text-small text-text-muted">
            Fas {c.phase} av {c.phaseCount} · {c.phaseName}
            {c.phaseSince ? ` · sedan ${fd(c.phaseSince, dayOf(c.now))}` : ""}
            {c.status === "paused" ? " · pausad" : ""}
          </span>
        </span>
      </div>
      {/* Rad B: de viktigaste uppgifterna */}
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {fact("Huvudcoach", c.leadCoach ? c.leadCoach.name : "Inte tilldelad")}
        {fact("Start", c.startDate ? fmtDate(c.startDate) : c.firstMeetingAt ? `Planerad ${fmtDate(c.firstMeetingAt)}` : "Inte bestämd")}
        {c.endDate
          ? fact("Avslutad", `${fmtDate(c.endDate)} · ${c.endReasonLabel ?? "–"}`)
          : fact("Planerat slut", c.plannedEnd ? fmtDate(c.plannedEnd) : "Inte angivet")}
        {fact("Handläggare", k ? k.name : "–")}
      </div>
      {warn.length > 0 && <div className="flex flex-wrap gap-1.5">{warn}</div>}
      {/* Rad B2: nivå, grupper och taggar (internt – coachmötet 2026-10-09) med Ändra */}
      <CaseGroupingRow caseId={c.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5" />
      {/* Rad C: åtgärder */}
      <CaseActions card={c} openModal={openModal} />
      {/* Rad D: samtycke (inte för teamet) */}
      {!team && <ConsentRow card={c} onRegister={() => openModal("consent")} className={row} />}
      {/* Rad F: alla uppgifter */}
      <div className={row}>
        <Button kind="ghost" icon={all ? "chevron-up" : "chevron-down"} aria-expanded={all} aria-controls="arende-uppgifter" onClick={toggle}>
          {all ? "Dölj uppgifterna" : "Visa alla uppgifter"}
        </Button>
        {!all && <span className="text-small text-text-muted max-[620px]:hidden">Insatsen, deltagaren, kommunen och teamet</span>}
      </div>
      <div id="arende-uppgifter" hidden={!all}>
        <CaseFacts card={c} onRegister={() => openModal("consent")} />
      </div>
    </div>
  );
}

/** Alla uppgifter i huvudet: insatsen, deltagaren, kommunen och teamet – och vad kommunen ser. */
function CaseFacts({ card: c, onRegister }: { card: CaseCard; onRegister: () => void }) {
  const reveal = useCommand(caseRevealPnr);
  const team = c.access === "team";
  const insats: ([string, ReactNode] | null)[] = [
    ["Avtalsområde", `${c.areaName}${c.secondaryAreaName ? ` (även ${c.secondaryAreaName})` : ""}`],
    ["Yrkesspår", c.vocationalTrack || "Väljs i kartläggningen"],
    ["Beställd", `${fmtDate(c.referredAt)} kl. ${fmtTime(c.referredAt)} via ${c.sourceText}`],
    ["Start", c.startDate ? fmtDate(c.startDate) : c.firstMeetingAt ? `Planerad ${fmtDate(c.firstMeetingAt)}` : "Inte bestämd"],
    ["Planerat slut", c.plannedEnd ? fmtDate(c.plannedEnd) : "Inte angivet"],
    c.endDate
      ? [
          "Avslutad",
          <>
            {fmtDate(c.endDate)} · {c.endReasonLabel ?? "–"}
            {c.resultPrelim && (
              <div className="mt-1">
                <Badge tone="red" icon="alert-circle">Preliminärt – verifiering saknas</Badge>
              </div>
            )}
          </>,
        ]
      : null,
    c.order
      ? [
          "Beställning",
          c.order.weeks ? (
            `${c.order.weeks} ${c.order.weeks === 1 ? "vecka" : "veckor"}`
          ) : (
            "Omfattning inte angiven"
          ),
        ]
      : null,
  ];
  const deltagare: [string, ReactNode][] = [
    [
      "Personnummer",
      <MaskedPnr
        key="pnr"
        masked={c.pnr.masked}
        hidden={c.pnr.hidden}
        onReveal={
          c.pnr.canReveal
            ? async () => {
                const res = await reveal.run({ caseId: c.caseId });
                return res.ok ? res.pnr : null;
              }
            : undefined
        }
      />,
    ],
    ["Kontaktväg", c.contactText],
    ["Språk", c.languageText],
    ["Anpassning", c.accessibilityNeeds],
  ];
  const k = c.referrer;
  const kommun: ([string, ReactNode] | null)[] = [
    [
      "Handläggare",
      k ? (
        <>
          {k.name}
          {(k.title || k.unit) && <div className="text-small text-text-muted">{[k.title, k.unit].filter(Boolean).join(", ")}</div>}
        </>
      ) : (
        "–"
      ),
    ],
    c.buyer
      ? [
          "Beställarreferens",
          c.buyer.reference ? (
            <>
              <span className="tabular-nums">{c.buyer.reference}</span>
              {c.buyer.problem && (
                <div className="mt-1">
                  <Badge tone="red" icon="alert-circle">{c.buyer.problem}</Badge>
                </div>
              )}
            </>
          ) : (
            <Badge tone="red" icon="alert-circle">Saknas – krävs för bekräftelse och faktura</Badge>
          ),
        ]
      : null,
    c.buyer?.purchaseOrderNumber ? ["Inköpsorder", <span key="po" className="tabular-nums">{c.buyer.purchaseOrderNumber}</span>] : null,
    ["Huvudcoach", c.leadCoach ? <UserName key="lc" name={c.leadCoach.name} /> : <span className="text-text-muted">Inte tilldelad</span>],
    [
      "Team",
      c.team.length ? (
        <div className="flex flex-col gap-1">
          {c.team.map((t) => (
            <div key={t.userId}>
              {t.name}
              <div className="text-small text-text-muted">{t.roleLabel}</div>
            </div>
          ))}
        </div>
      ) : c.hasLeadInTeam ? (
        "Bara huvudcoach"
      ) : (
        "–"
      ),
    ],
  ];
  return (
    <Stack>
      <div className="grid grid-cols-3 gap-5 max-[1100px]:grid-cols-1 [&>*]:min-w-0">
        <div>
          <Label>Insatsen</Label>
          <Facts items={insats} />
        </div>
        <div className="max-[1100px]:border-t max-[1100px]:border-ljusgra max-[1100px]:pt-4">
          <Label>Deltagaren</Label>
          <Facts items={deltagare} />
        </div>
        <div className="max-[1100px]:border-t max-[1100px]:border-ljusgra max-[1100px]:pt-4">
          <Label>Kommunen och teamet</Label>
          <Facts items={kommun} />
        </div>
      </div>
      {c.manage && c.status !== "closed" && c.status !== "declined" && c.leadCoach && (
        <p className="text-text-muted">
          Byte av huvudcoach kräver orsak. {k ? k.name : "Handläggaren"} och nya coachen får notis.
          {c.keyPersonnelChangeRequiresApproval ? " Avtalet kräver kommunens godkännande vid byte av nyckelpersonal." : ""}
        </p>
      )}
      {/* Smal skärm: samtyckets förklaring och knappar ligger här (huvudet visar bara läget) så att flikarna syns utan att skrolla. */}
      {!team && c.consent && (
        <div className="flex flex-col gap-2 min-[621px]:hidden">
          <p className="m-0">
            <span className="font-bold">Samtycke till inspelning och AI:</span> <ConsentText card={c} />
          </p>
          <ConsentButtons card={c} onRegister={onRegister} />
        </div>
      )}
      {!team && (
        <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted">
          <Icon name="building" className="mt-px" />
          <div>
            <b className="font-bold text-antracit">Det här ser kommunen:</b> status, fas, huvudcoach, närvaro, levererade rapporter och meddelanden.
            {!c.customerSeesCoachNotes ? " Inte coachens anteckningar." : ""}
          </div>
        </div>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- Samtycke (inspelning och AI, fas 2)
const CONSENT_STATE = {
  given: ["blue", "check-circle", "Samtycke registrerat"],
  declined: ["grey", "minus-circle", "Deltagaren har avböjt"],
  revoked: ["red", "x-circle", "Samtycket är återkallat"],
  not_asked: ["outline", "help", "Inte tillfrågad ännu"],
} as const;

/** Samtycket på en rad: läge, kort förklaring och knapparna (på smal skärm ligger förklaringen och knapparna under "Visa alla uppgifter"). */
function ConsentRow({ card, onRegister, className }: { card: CaseCard; onRegister: () => void; className?: string }) {
  const cons = card.consent;
  if (!cons) return null;
  const state = CONSENT_STATE[cons.value] ?? CONSENT_STATE.not_asked;
  return (
    <div role="group" aria-labelledby="arende-samtycke" className={className}>
      <h2 id="arende-samtycke" className="flex items-center gap-1.5 text-body font-bold">
        <Icon name="mic" />
        Samtycke till inspelning och AI
      </h2>
      <Badge tone={state[0]} icon={state[1]}>{state[2]}</Badge>
      <BuildPhase fas={2} />
      <span className="max-[620px]:hidden">
        <ConsentText card={card} />
      </span>
      <ConsentButtons card={card} onRegister={onRegister} className="max-[620px]:hidden" />
    </div>
  );
}

/** Samtyckets knappar: Återkalla / Registrera (nytt) samtycke och Deltagaren avböjer – bara för den som får ändra, i ett öppet ärende. */
function ConsentButtons({ card, onRegister, className }: { card: CaseCard; onRegister: () => void; className?: string }) {
  const confirm = useConfirm();
  const set = useCommand(consentSet);
  const cons = card.consent;
  const active = card.status !== "closed" && card.status !== "declined";
  if (!cons || !card.edit || !active) return null;
  const v = cons.value;
  const revoke = async () => {
    const ok = await confirm({
      title: "Återkalla samtycket?",
      confirmLabel: "Återkalla samtycket",
      tone: "danger",
      body: <p>Inspelning och AI-stöd stängs av direkt för det här ärendet. Redan godkända mötesrapporter påverkas inte. Deltagaren kan lämna nytt samtycke senare.</p>,
    });
    if (!ok) return;
    const res = await set.run({ caseId: card.caseId, value: "revoked" }).catch(() => null);
    if (!res || !res.ok) {
      toast("Samtycket kunde inte ändras.", "error");
      return;
    }
    toast("Samtycket är återkallat. Inspelning och AI är avstängt för ärendet.");
  };
  const decline = async () => {
    await set.run({ caseId: card.caseId, value: "declined" }).catch(() => null);
    toast("Registrerat att deltagaren avböjer. Mötena dokumenteras manuellt.");
  };
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {v === "given" ? (
        // Textknapp: återkallandet är ovanligt och har en bekräftelsedialog – det ska inte dra blicken från huvudhandlingen.
        <Button kind="ghost" icon="x-circle" onClick={() => void revoke()} className="whitespace-normal">
          Återkalla samtycke
        </Button>
      ) : (
        <Button icon="check" onClick={onRegister} className="whitespace-normal">
          {v === "revoked" ? "Registrera nytt samtycke" : "Registrera samtycke"}
        </Button>
      )}
      {v === "not_asked" && (
        <Button kind="ghost" onClick={() => void decline()}>
          Deltagaren avböjer
        </Button>
      )}
    </span>
  );
}

/** Vad samtyckets läge betyder (datum, vem som informerade, textversion). */
function ConsentText({ card }: { card: CaseCard }) {
  const cons = card.consent;
  if (!cons) return null;
  const v = cons.value;
  if (v === "given" && cons.givenAt)
    return (
      <span className="text-small text-text-muted">
        Lämnat {fd(cons.givenAt, dayOf(card.now))} · informerad av {cons.informedByName ?? "–"} · <ConsentVersion version={cons.textVersion} />
        {cons.language ? ` på ${cons.language}` : ""}.
      </span>
    );
  if (v === "revoked" && cons.revokedAt) return <span className="text-text-muted">Återkallat {fmtDateTime(cons.revokedAt)}. Inspelning och AI är avstängt.</span>;
  if (v === "declined") return <span className="text-text-muted">Mötena dokumenteras manuellt. Deltagaren kan ändra sig.</span>;
  if (v === "not_asked") return <span className="text-text-muted">Inspelning kan bara startas när samtycke är registrerat.</span>;
  return null;
}

/** "informationstext version 1.0" – datumet i textversionen ("v1.0 (2026-10-01)") ligger i title-attributet. */
function ConsentVersion({ version }: { version: string | null }) {
  const m = /^v?([^\s(]+)\s*(?:\((.+)\))?$/.exec(version ?? "");
  if (!m) return <>informationstext {version ?? "–"}</>;
  return <span title={m[2] ? `Textversionen är från ${m[2]}` : undefined}>informationstext version {m[1]}</span>;
}

function ConsentModal({ card, onClose }: { card: CaseCard; onClose: () => void }) {
  const set = useCommand(consentSet);
  const langs = [...new Set(["lättläst svenska", card.language && card.language !== "svenska" ? card.language : null, "engelska", "arabiska", "somaliska"].filter((x): x is string => !!x))];
  const [lang, setLang] = useState(langs[0]);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!ok) {
      setErr("Bekräfta att deltagaren har fått informationen och själv har sagt ja.");
      return;
    }
    const res = await set.run({ caseId: card.caseId, value: "given", language: lang }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Samtycket kunde inte registreras. Försök igen.", "error");
      return;
    }
    toast("Samtycket är registrerat. Inspelning och AI-stöd kan nu användas i mötena.");
    onClose();
  };
  return (
    <Modal
      title="Registrera samtycke"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={set.pending} onClick={() => void save()}>Registrera samtycke</Button>
        </>
      }
    >
      <p>Samtycket gäller inspelning av möten och AI-stöd för utkast till mötesrapporter. Ljudet raderas direkt efter transkribering.</p>
      <Field label="Informationen gavs på" id="arn-cons-lang">
        <Select value={lang} onValueChange={setLang} options={langs.map((x) => ({ value: x, label: cap(x) }))} />
      </Field>
      <Field id="arn-cons-ok-field" error={err}>
        <Check
          id="arn-cons-ok"
          checked={ok}
          onCheckedChange={(v) => {
            setOk(v);
            setErr(null);
          }}
        >
          Deltagaren har fått informationen muntligt och skriftligt och har själv sagt ja. Deltagaren vet att samtycket kan återkallas när som helst.
        </Check>
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- Åtgärder
/** Åtgärderna som knappar på en rad (samma villkor som tidigare åtgärdskortet). */
function CaseActions({ card: c, openModal }: { card: CaseCard; openModal: (m: ModalKind) => void }) {
  const role = useSession().actor.role;
  // Läsläge (chef, systemadministratör): rutan överst säger det – ingen tom åtgärdsrad.
  if (c.readOnly) return null;
  const team = c.access === "team";
  const active = c.status !== "closed" && c.status !== "declined";
  const id = encodeURIComponent(c.caseId);
  const btns: ReactNode[] = [];
  // Smal skärm: knapparna staplas lika breda.
  const btn = "whitespace-normal max-[560px]:w-full";
  // Starta insatsen (beslut 2026-10-08): det självklara nästa steget när första mötet är bokat.
  if (c.start) btns.push(<Button key="start" kind="primary" icon="play" className={btn} onClick={() => openModal("start")}>Starta insatsen</Button>);
  if (c.manage && c.status === "confirmed" && !c.firstMeetingAt) btns.push(<Button key="meet" kind="primary" icon="calendar" className={btn} onClick={() => openModal("meeting")}>Boka första möte</Button>);
  if (c.manage && (c.status === "received" || c.status === "acknowledged") && canOpen("sam.inkorg", role)) btns.push(<Button key="inbox" kind="primary" icon="inbox" className={btn} to={`/inkorg?arende=${id}`}>Hantera avropet i inkorgen</Button>);
  // Mötet (beslut 2026-10-09): "Spela in mötet" är coachens huvudväg – inspelning, AI-utkast till mötesrapport, granskning och godkännande på samma skärm.
  // Har deltagaren sagt nej eller återkallat samtycket erbjuds ingen inspelning: huvudknappen är "Nytt möte" (manuell dokumentation).
  if (c.edit && c.status === "active" && canOpen("coach.avstamning", role)) {
    if (recordingOffered(c.consent?.value)) {
      btns.push(<Button key="rec" kind="primary" icon="mic" className={btn} to={`/avstamning/${id}?spela=1`}>Spela in mötet</Button>);
      btns.push(<Button key="ci" kind="secondary" icon="edit" className={btn} to={`/avstamning/${id}`}>Nytt möte utan inspelning</Button>);
    } else {
      btns.push(<Button key="ci" kind="primary" icon="edit" className={btn} to={`/avstamning/${id}`}>Nytt möte</Button>);
    }
  }
  if ((c.edit || team) && c.status === "active" && canOpen("coach.narvaro", role)) btns.push(<Button key="att" icon="calendar" className={btn} to={`/narvaro?arende=${encodeURIComponent(c.caseId)}`}>Registrera närvaro</Button>);
  if (c.edit && (c.status === "active" || c.status === "closed") && canOpen("coach.handelse", role)) btns.push(<Button key="ev" icon="award" className={btn} to={`/handelse/${id}`}>Registrera händelse</Button>);
  if (c.manage && active && c.leadCoach) btns.push(<Button key="coach" icon="users" className={btn} onClick={() => openModal("coach")}>Byt huvudcoach</Button>);
  if (c.manage && active && c.teamOptions) btns.push(<Button key="team" icon="users" className={btn} onClick={() => openModal("team")}>Ändra team</Button>);
  return (
    <div role="group" aria-label="Åtgärder" className="flex flex-wrap items-center gap-2">
      {btns.length > 0 ? (
        btns
      ) : (
        <p className="text-text-muted">
          {team ? "Du registrerar närvaro och praktik via Närvaro och Arbetsgivare och praktik." : "Inga åtgärder för din roll just nu."}
        </p>
      )}
    </div>
  );
}

function CoachModal({ card: c, onClose }: { card: CaseCard; onClose: () => void }) {
  const change = useCommand(caseChangeCoach);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<{ to?: string | null; reason?: string | null }>({});
  const k = c.referrer;
  const kName = k ? k.name : "Handläggaren";
  const save = async () => {
    const e: { to?: string; reason?: string } = {};
    if (!to) e.to = "Välj ny huvudcoach.";
    if (!reason.trim()) e.reason = "Skriv orsaken till bytet. Den sparas i historiken.";
    setErr(e);
    if (Object.keys(e).length) return;
    const res = await change.run({ caseId: c.caseId, toCoachId: to, reason: reason.trim() }).catch(() => null);
    if (!res || !res.ok) {
      toast("Bytet sparades inte.", "error");
      return;
    }
    const name = c.coachOptions.find((x) => x.id === to)?.name ?? "";
    toast(`${name} är ny huvudcoach för ${c.caseNumber}. ${kName} och ${name} har fått notis.`);
    onClose();
  };
  return (
    <Modal
      title="Byt huvudcoach"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={change.pending} onClick={() => void save()}>Byt huvudcoach</Button>
        </>
      }
    >
      {c.keyPersonnelChangeRequiresApproval && (
        <Notice tone="warn" title="Kommunen ska godkänna bytet">
          Avtalet kräver kommunens godkännande vid byte av nyckelpersonal. Stäm av med {k ? k.name : "handläggaren"} innan du sparar, till exempel med ett säkert meddelande i ärendet.
        </Notice>
      )}
      <Kv items={[["Ärende", <span key="n" className="font-bold tabular-nums">{c.caseNumber}</span>], ["Nuvarande huvudcoach", c.leadCoach?.name ?? "–"]]} />
      <Field label="Ny huvudcoach" id="arn-coach-to" required error={err.to}>
        <Select
          value={to}
          onValueChange={(v) => {
            setTo(v);
            setErr({ ...err, to: null });
          }}
          placeholder="Välj coach"
          options={c.coachOptions.map((u) => ({ value: u.id, label: `${u.name} – ${u.active} aktiva ärenden` }))}
        />
      </Field>
      <Field label="Orsak till bytet" id="arn-coach-reason" required error={err.reason} help="Orsaken syns i ärendets historik.">
        <TextArea
          value={reason}
          onValueChange={(v) => {
            setReason(v);
            if (err.reason) setErr({ ...err, reason: null });
          }}
          rows={3}
        />
      </Field>
      <Card tone="sub">
        <Stack gap="sm">
          <Label className="m-0">Det här händer när du sparar</Label>
          <MiniList
            items={[
              { key: "coach", icon: "bell", children: <><b>Nya coachen</b> får en notis i appen och ett mejl utan personuppgifter: ”Du har fått ett nytt ärende i Miljonmatch: {c.caseNumber}. Logga in för att se detaljerna.”</> },
              { key: "k", icon: "mail", children: <><b>{kName}</b> får ett mejl: ”Ärende {c.caseNumber} har fått ny huvudcoach. Logga in i portalen för att se vem.”</> },
              { key: "log", icon: "book", children: "Bytet sparas i historiken med orsak, tidpunkt och vem som gjorde det." },
            ]}
          />
        </Stack>
      </Card>
    </Modal>
  );
}

function MeetingModal({ card: c, onClose }: { card: CaseCard; onClose: () => void }) {
  const book = useCommand(caseBookFirstMeeting);
  const today = dayOf(c.now);
  const due = c.firstMeeting.dueAt;
  const [at, setAt] = useState(`${addWorkingDays(today, 1)}T10:00`);
  const [err, setErr] = useState<string | null>(null);
  const late = !!at && !!due && at > due;
  const save = async () => {
    if (!at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) {
      setErr("Välj datum och tid för mötet.");
      return;
    }
    if (at < c.now) {
      setErr("Tiden har redan passerat. Välj en senare tid.");
      return;
    }
    if (!isWorkingDay(at)) {
      setErr(`${holidayName(at) || "Dagen"} är inte en arbetsdag. Välj en vardag.`);
      return;
    }
    const res = await book.run({ caseId: c.caseId, at }).catch(() => null);
    if (!res || !res.ok) {
      toast("Mötet kunde inte bokas.", "error");
      return;
    }
    toast(`Första mötet är bokat ${fmtDateTimeLong(at)}. Kallelsen skickas via föredragen kontaktväg.`);
    onClose();
  };
  return (
    <Modal
      title="Boka första möte"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="calendar" pending={book.pending} onClick={() => void save()}>Boka mötet</Button>
        </>
      }
    >
      <Kv
        items={[
          ["Ärende", <span key="n" className="font-bold tabular-nums">{c.caseNumber}</span>],
          ["Huvudcoach", c.leadCoach?.name ?? "–"],
          ["Beställt", fmtDateTimeLong(c.referredAt)],
          ["Senast bokat", c.firstMeeting.sla ? <SlaBadge key="sla" sla={c.firstMeeting.sla} dueAt={due} /> : "–"],
        ]}
      />
      <Field
        label="Datum och tid"
        id="arn-meet-at"
        required
        error={err}
        help={`Mötet ska hållas ${c.firstMeeting.withinText}${due ? ` – senast ${fmtDateTimeLong(due)}` : ""}. Plats: Miljonbemanning ${c.location || ""}.`}
      >
        <DateTimeInput
          value={at}
          onValueChange={(v) => {
            setAt(v);
            setErr(null);
          }}
        />
      </Field>
      {late && due && (
        <Notice tone="warn" title="Senare än avtalets gräns">
          Tiden ligger efter {fmtDateTimeLong(due)}. Mötet markeras som sent i uppföljningen.
        </Notice>
      )}
      <p>
        {`Deltagaren får en kallelse via ${(c.contactLabel ?? "SMS").toLowerCase()} och en påminnelse dagen före. Kallelsen innehåller bara tid och plats.`}
      </p>
    </Modal>
  );
}
