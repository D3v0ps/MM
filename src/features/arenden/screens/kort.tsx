"use client";
// Deltagarkortet (prototypens arende.kort): huvud med insatsen, deltagaren och teamet, samtycke, åtgärder och flikar.
// Chef och systemadmin läser bara. Handledare (teamet) ser fem flikar – inga coachanteckningar, bedömningar eller rapporter.
// Visningen loggas i revisionsloggen (case.view), liksom försök utan behörighet (case.view_denied).
import { useEffect, useState, type ReactNode } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { DemoOnly } from "@/shell/runtime";
import { kr } from "@/core/format";
import { addWorkingDays, dayOf, fmtDate, fmtDateTime, fmtDateTimeLong, fmtTime, holidayName, isWorkingDay } from "@/core/time";
import {
  Badge, BuildPhase, Button, Card, CaseStatusBadge, Check, DateTimeInput, DemoNote, Empty, ErrorNotice, Field, Icon, Kv, Loading, MaskedPnr, Modal, Notice, Page, PerspectiveLink,
  PhaseBar, PhaseTag, Select, SlaBadge, Split, Stack, Tabs, TabPanel, TextArea, toast, useAuditView, useConfirm, UserName,
} from "@/ui";
import { auditView } from "@/features/session/api";
import {
  caseBookFirstMeeting, caseCard, caseChangeCoach, caseRevealPnr, CASE_TABS, consentSet, messageRead, TEAM_TABS, type CaseCard, type CaseTab,
} from "../api";
import { canOpen, cap, fd, Facts, Label, MiniList } from "./common";
import { TabAvstamningar, TabKartlaggning, TabNarvaro, TabOversikt } from "./kort-flikar";
import { TabManad } from "./kort-manad";
import { TabTidslinje } from "./kort-tidslinje";
import { TabAvvikelser, TabHandelser, TabPraktik } from "./kort-arbete";
import { TabHistorik, TabMeddelanden, TabRapporter } from "./kort-kommunikation";
import { VoiceNotesCard } from "@/features/rost/screens/coach-parts";

const TAB_LABEL: Record<CaseTab, string> = {
  oversikt: "Översikt", tidslinje: "Tidslinje", kartlaggning: "Kartläggning", avstamningar: "Avstämningar", narvaro: "Närvaro", manad: "Månadsunderlag",
  handelser: "Händelser och utfall", avvikelser: "Avvikelser", praktik: "Praktik", rapporter: "Rapporter", meddelanden: "Meddelanden", historik: "Historik",
};
const CUST_WHO = { kommun_handlaggare: "kommunen", kommun_chef: "kommunens chef" } as const;

/** Vad varje flik får från kortet. */
export type TabProps = { card: CaseCard; setTab: (t: CaseTab) => void; openModal: (m: ModalKind) => void };
type ModalKind = "coach" | "meeting" | "consent";

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
  useEffect(() => {
    if (caseNumber) document.title = `Deltagarkort ${caseNumber} – Miljonmatch`;
  }, [caseNumber]);

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
  if (d.kind === "denied") return <NoAccess caseId={caseId} restricted={d.restricted} caseNumber={d.caseNumber} status={d.status} crumbs={crumbs} />;
  return <CaseView card={d} crumbs={crumbs} flik={query.get("flik")} manad={query.get("manad")} />;
}

function NoAccess({ caseId, restricted, caseNumber, status, crumbs }: { caseId: string; restricted: boolean; caseNumber: string | null; status: string | null; crumbs: { label: string; to: string }[] }) {
  const role = useSession().actor.role;
  return (
    <Page eyebrow={caseNumber ? `Ärende ${caseNumber}` : "Ärende"} title={restricted ? "Skyddade personuppgifter" : "Åtkomst saknas"} crumbs={[...crumbs, { label: caseNumber ?? "Åtkomst saknas" }]}>
      <Card tone="sub">
        <div className="flex flex-nowrap items-start gap-4">
          <Icon name={restricted ? "shield" : "lock"} size="xl" />
          <Stack gap="sm" className="min-w-0">
            <h2 className="text-h2 font-extrabold">Du saknar åtkomst till det här deltagarkortet</h2>
            {restricted ? (
              <p>Ärendet har skyddade personuppgifter. Bara namngiven huvudcoach och avtalsansvarig kan öppna det. Du ser att ärendet finns så att det kan planeras och följas upp, men inte vem det gäller.</p>
            ) : (
              <p>
                {role === "handledare" ? "Du ser bara ärenden du är tilldelad." : "Du ser bara ärenden där du är huvudcoach eller ingår i teamet."} Behöver du arbeta i ärendet? Be samordnaren
                lägga till dig i teamet.
              </p>
            )}
            {restricted && caseNumber && (
              <Kv items={[["Ärendenummer", <span key="n" className="font-bold tabular-nums">{caseNumber}</span>], ["Status", status ? <CaseStatusBadge key="s" status={status} /> : "–"]]} />
            )}
            <p className="text-small text-text-muted">Försöket att öppna kortet är loggat i revisionsloggen.</p>
          </Stack>
        </div>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button kind="primary" icon="arrow-left" to={crumbs[0].to}>Tillbaka till listan</Button>
      </div>
      {restricted && (
        <DemoNote>
          Jämför med en roll som har åtkomst.{" "}
          <span className="mt-1.5 inline-block">
            <PerspectiveLink role="avtalsansvarig" to={`/arenden/${encodeURIComponent(caseId)}`} label="Visa som avtalsansvarig" />
          </span>
        </DemoNote>
      )}
    </Page>
  );
}

/** Perspektivbyte till kundens ärendesida (bara i prototypen). Visas inte om ingen kundroll har åtkomst. */
export function CustSwitch({ card, tab, label }: { card: CaseCard; tab?: string | null; label: (who: string) => string }) {
  const r = card.customerRole;
  if (!r) return null;
  return <PerspectiveLink role={r} to={path(`/portal/deltagare/${encodeURIComponent(card.caseId)}`, { flik: tab ?? null })} label={label(CUST_WHO[r])} />;
}

function CaseView({ card, crumbs, flik, manad }: { card: CaseCard; crumbs: { label: string; to: string }[]; flik: string | null; manad: string | null }) {
  const nav = useNav();
  const role = useSession().actor.role;
  const team = card.access === "team";
  const tabIds: readonly CaseTab[] = team ? TEAM_TABS : CASE_TABS;
  const tab: CaseTab = tabIds.includes(flik as CaseTab) ? (flik as CaseTab) : "oversikt";
  const blocked = !!flik && !tabIds.includes(flik as CaseTab) && (CASE_TABS as readonly string[]).includes(flik);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const setTab = (t: CaseTab) => nav.replace(path(`/arenden/${encodeURIComponent(card.caseId)}`, { flik: t === "oversikt" ? null : t }));
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
  const props: TabProps = { card, setTab, openModal: setModal };

  return (
    <Page
      eyebrow={`Deltagarkort · ${card.caseNumber}`}
      title={card.displayName}
      crumbs={[...crumbs, { label: card.caseNumber }]}
      lead={`${card.areaName}${card.vocationalTrack ? ` · ${card.vocationalTrack}` : ""}`}
      actions={!team && <CustSwitch card={card} tab={tab === "rapporter" || tab === "meddelanden" ? tab : null} label={(who) => `Se ärendet som ${who}`} />}
    >
      {card.protectedIdentity && (
        <Notice tone="warn" icon="shield" title="Skyddade personuppgifter">
          Ingen adress lagras. Inga SMS eller mejl skickas till deltagaren – kontakt sker per telefon enligt den säkra rutinen. AI och inspelning används aldrig. Bara namngiven
          huvudcoach och avtalsansvarig ser kortet.
        </Notice>
      )}
      {card.readOnly && (
        <Notice tone="info" icon="eye" title="Läsläge">
          {role === "chef" ? "Som chef och controller ser du allt i ärendet men kan inte ändra något." : "Som systemadmin ser du ärendet men arbetar inte i det."} Visningen är
          loggad.
        </Notice>
      )}
      {team && (
        <Notice tone="info" icon="users" title={`Du ingår i teamet som ${(card.myTeamRoleLabel ?? "").toLowerCase()}`}>
          Du ser moment, närvaro, praktik, arbetsgivarkontakter och tidslinjen med anteckningar som är skrivna för teamet. Coachens anteckningar och bedömningar,
          månadsrapporter och slutrapporter visas inte för handledare.
        </Notice>
      )}

      <Split wide>
        <CaseHeader card={card} />
        <Stack>
          {!team && <ConsentCard card={card} onRegister={() => setModal("consent")} />}
          <ActionsCard card={card} openModal={setModal} />
          {/* Röstinspelning: deltagarens röstmeddelanden och inspelningslänken (inte för teamet – underlag för coachen). */}
          {!team && <VoiceNotesCard caseId={card.caseId} />}
        </Stack>
      </Split>

      <Stack>
        <Tabs
          id="arende"
          tabs={tabs}
          active={tab}
          onChange={setTab}
          ariaLabel="Delar av deltagarkortet"
          className="relative min-[621px]:flex-wrap min-[621px]:overflow-x-visible [&_[role=tab]]:px-3"
        />
        {blocked && (
          <Notice tone="info" title="Den delen visas inte för din roll">
            {TAB_LABEL[flik as CaseTab]} innehåller coachens anteckningar och bedömningar. Du ser översikten i stället.
          </Notice>
        )}
        <TabPanel tabsId="arende" active={tab}>
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
          {tab === "meddelanden" && <TabMeddelanden {...props} />}
          {tab === "historik" && <TabHistorik {...props} />}
        </TabPanel>
      </Stack>

      {modal === "coach" && <CoachModal card={card} onClose={() => setModal(null)} />}
      {modal === "meeting" && <MeetingModal card={card} onClose={() => setModal(null)} />}
      {modal === "consent" && <ConsentModal card={card} onClose={() => setModal(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------- Huvud
function CaseHeader({ card: c }: { card: CaseCard }) {
  const reveal = useCommand(caseRevealPnr);
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
            <>
              {c.order.weeks} {c.order.weeks === 1 ? "vecka" : "veckor"} · <span className="font-bold">{kr(c.order.weeks * c.order.priceOre)}</span>
              <div className="text-small text-text-muted">
                {c.order.weeks} × {kr(c.order.priceOre)} per deltagarvecka
              </div>
            </>
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
  const section = "border-t border-ljusgra pt-4";
  return (
    <Card>
      <Stack>
        <div className="flex flex-wrap items-center gap-1.5">
          <CaseStatusBadge status={c.status} />
          <PhaseTag phase={c.phase} name={c.phaseName} />
          {c.protectedIdentity && <Badge tone="dark" icon="lock">Skyddade personuppgifter</Badge>}
          {c.readOnly && <Badge tone="outline" icon="eye">Läsläge</Badge>}
          {c.stuck && (
            <Badge tone="grey" icon="clock">
              Fastnat: {c.stuck.days} dagar i fas {c.stuck.phase} (gräns {c.stuck.maxDays})
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-1.5 [&_[role=img]>div]:h-2.5">
          <PhaseBar phase={c.phase} total={c.phaseCount} />
          <div className="text-small text-text-muted">
            Fas {c.phase} av {c.phaseCount} · {c.phaseName}
            {c.phaseSince ? ` · sedan ${fd(c.phaseSince, dayOf(c.now))}` : ""}
            {c.status === "paused" ? " · pausad" : ""}
          </div>
        </div>
        <div>
          <Label>Insatsen</Label>
          <Facts items={insats} />
        </div>
        <div className={section}>
          <Label>Deltagaren</Label>
          <Facts items={deltagare} />
        </div>
        <div className={section}>
          <Label>Kommunen och teamet</Label>
          <Facts items={kommun} />
        </div>
      </Stack>
    </Card>
  );
}


// ---------------------------------------------------------------- Samtycke (inspelning och AI, fas 2)
const CONSENT_STATE = {
  given: ["blue", "check-circle", "Samtycke registrerat"],
  declined: ["grey", "minus-circle", "Deltagaren har avböjt"],
  revoked: ["red", "x-circle", "Samtycket är återkallat"],
  not_asked: ["outline", "help", "Inte tillfrågad ännu"],
  not_applicable: ["dark", "lock", "Ej tillämpligt"],
} as const;

function ConsentCard({ card, onRegister }: { card: CaseCard; onRegister: () => void }) {
  const confirm = useConfirm();
  const set = useCommand(consentSet);
  const cons = card.consent;
  if (!cons) return null;
  const v = cons.value;
  const state = CONSENT_STATE[v] ?? CONSENT_STATE.not_asked;
  const active = card.status !== "closed" && card.status !== "declined";
  const revoke = async () => {
    const ok = await confirm({
      title: "Återkalla samtycket?",
      confirmLabel: "Återkalla samtycket",
      tone: "danger",
      body: <p>Inspelning och AI-stöd stängs av direkt för det här ärendet. Redan godkända avstämningar påverkas inte. Deltagaren kan lämna nytt samtycke senare.</p>,
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
    toast("Registrerat att deltagaren avböjer. Avstämningar dokumenteras manuellt.");
  };
  return (
    <Card title="Samtycke till inspelning och AI" icon="mic" actions={<BuildPhase fas={2} />}>
      <Stack gap="sm">
        <div>
          <Badge tone={state[0]} icon={state[1]}>{state[2]}</Badge>
        </div>
        {v === "not_applicable" && <p className="text-small">Skyddade personuppgifter: ingen inspelning och ingen AI. Samtycke kan inte registreras.</p>}
        {v === "given" && cons.givenAt && (
          <p className="text-small text-text-muted">
            Lämnat {fd(cons.givenAt, dayOf(card.now))} · informerad av {cons.informedByName ?? "–"} · text {cons.textVersion}
            {cons.language ? ` på ${cons.language}` : ""}.
          </p>
        )}
        {v === "revoked" && cons.revokedAt && <p className="text-small text-text-muted">Återkallat {fmtDateTime(cons.revokedAt)}. Inspelning och AI är avstängt.</p>}
        {v === "declined" && <p className="text-small text-text-muted">Avstämningar dokumenteras manuellt. Deltagaren kan ändra sig.</p>}
        {v === "not_asked" && <p className="text-small text-text-muted">Inspelning kan bara startas när samtycke är registrerat.</p>}
        {card.edit && v !== "not_applicable" && active && (
          <div className="flex flex-wrap items-center gap-1.5">
            {v === "given" ? (
              <Button kind="danger" icon="x-circle" onClick={() => void revoke()} className="whitespace-normal">
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
          </div>
        )}
      </Stack>
    </Card>
  );
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
      toast("Samtycke kan inte registreras för skyddade personuppgifter.", "error");
      return;
    }
    toast("Samtycket är registrerat. Inspelning och AI-stöd kan nu användas i avstämningarna.");
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
      <p>Samtycket gäller inspelning av avstämningar och AI-stöd för textutkast. AI föreslår – coachen bedömer. Ljudet raderas direkt efter transkribering.</p>
      <Field label="Informationen gavs på" id="arn-cons-lang" help="Välj det språk deltagaren fick informationstexten på.">
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
      <DemoNote>Textversion v1.0 (2026-10-01) sparas tillsammans med samtycket och vem som informerade.</DemoNote>
    </Modal>
  );
}

// ---------------------------------------------------------------- Åtgärder
function ActionsCard({ card: c, openModal }: { card: CaseCard; openModal: (m: ModalKind) => void }) {
  const role = useSession().actor.role;
  const team = c.access === "team";
  const active = c.status !== "closed" && c.status !== "declined";
  const id = encodeURIComponent(c.caseId);
  const btns: ReactNode[] = [];
  const btn = "whitespace-normal";
  if (c.manage && active && c.leadCoach) btns.push(<Button key="coach" icon="users" block className={btn} onClick={() => openModal("coach")}>Byt huvudcoach</Button>);
  if (c.manage && c.status === "confirmed" && !c.firstMeetingAt) btns.push(<Button key="meet" kind="primary" icon="calendar" block className={btn} onClick={() => openModal("meeting")}>Boka första möte</Button>);
  if (c.manage && (c.status === "received" || c.status === "acknowledged") && canOpen("sam.inkorg", role)) btns.push(<Button key="inbox" kind="primary" icon="inbox" block className={btn} to={`/inkorg?arende=${id}`}>Hantera avropet i inkorgen</Button>);
  if (c.edit && c.status === "active" && canOpen("coach.avstamning", role)) btns.push(<Button key="ci" icon="check-square" block className={btn} to={`/avstamning/${id}`}>Ny veckoavstämning</Button>);
  if ((c.edit || team) && c.status === "active" && canOpen("coach.narvaro", role)) btns.push(<Button key="att" icon="calendar" block className={btn} to="/narvaro">Registrera närvaro</Button>);
  if (c.edit && (c.status === "active" || c.status === "closed") && canOpen("coach.handelse", role)) btns.push(<Button key="ev" icon="award" block className={btn} to={`/handelse/${id}`}>Registrera händelse</Button>);
  const k = c.referrer;
  return (
    <Card title="Åtgärder" icon="tool">
      <Stack gap="sm">
        {btns.length > 0 ? (
          btns
        ) : (
          <p className="text-small text-text-muted">
            {c.readOnly ? "Läsläge – du kan inte ändra i ärendet." : team ? "Du registrerar närvaro och praktik via Närvaro och Arbetsgivare och praktik." : "Inga åtgärder för din roll just nu."}
          </p>
        )}
        {c.manage && active && c.leadCoach && (
          <p className="text-small text-text-muted">
            Byte av huvudcoach kräver orsak. {k ? k.name : "Handläggaren"} och nya coachen får notis.
            {c.keyPersonnelChangeRequiresApproval ? " Avtalet kräver kommunens godkännande vid byte av nyckelpersonal." : ""}
          </p>
        )}
        {!team && (
          <div className="mt-1 flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted">
            <Icon name="building" className="mt-px" />
            <div>
              <b className="font-bold text-antracit">Det här ser kommunen:</b> status, fas, huvudcoach, närvaro, levererade rapporter och meddelanden.
              {!c.customerSeesCoachNotes ? " Inte coachens anteckningar." : ""}
              {c.protectedIdentity && !c.customerRole && (
                <DemoOnly>
                  {` Skyddade personuppgifter: i portalen ser bara beställande handläggare (${k ? k.name : "handläggaren"}) ärendet. Den rollen finns inte i prototypen, så du kan inte byta till kommunens vy här.`}
                </DemoOnly>
              )}
            </div>
          </div>
        )}
      </Stack>
    </Card>
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
      <Field label="Ny huvudcoach" id="arn-coach-to" required error={err.to} help="Antalet aktiva ärenden hjälper dig att fördela arbetet jämnt.">
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
      <Field label="Orsak till bytet" id="arn-coach-reason" required error={err.reason} help="Obligatorisk. Samma coach genom hela insatsen är huvudregeln, så orsaken loggas och syns i historiken.">
        <TextArea
          value={reason}
          onValueChange={(v) => {
            setReason(v);
            if (err.reason) setErr({ ...err, reason: null });
          }}
          rows={3}
          placeholder="Till exempel: Föräldraledighet från vecka 8."
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
  const prot = c.protectedIdentity;
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
    toast(`Första mötet är bokat ${fmtDateTimeLong(at)}.${prot ? " Ring deltagaren enligt den säkra rutinen." : " Kallelsen skickas via föredragen kontaktväg."}`);
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
      <p className="text-small">
        {prot
          ? "Skyddade personuppgifter: inga SMS eller mejl. Coachen ringer deltagaren enligt den säkra rutinen."
          : `Deltagaren får en kallelse via ${(c.contactLabel ?? "SMS").toLowerCase()} och en påminnelse dagen före. Kallelsen innehåller bara tid och plats.`}
      </p>
    </Modal>
  );
}
