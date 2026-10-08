"use client";
// Delade delar för coachens skärmar (prototypens hjälpare i views/coach.js): deltagarhuvud, deltagarlista, spärr,
// närvaromärken, perspektivbyte och små texthjälpare.
import type { ReactNode } from "react";
import type { Role } from "@/api/roles";
import { plural } from "@/core/format";
import { fmtDateShort, weekday, WEEKDAYS_SHORT, type LocalDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { path } from "@/shell/nav";
import {
  Avatar, Badge, Button, Card, CaseLink, CaseStatusBadge, Empty, ErrorNotice, List, ListItem, Loading, Notice, Page, PerspectiveLink, PhaseTag, Row, useAuditView,
  type BadgeTone, type IconName, type SegOption,
} from "@/ui";
import { auditView } from "@/features/session/api";
import { casePicker, type AttMark, type CaseHead, type CasePickerKind, type CoachGate, type ReferrerView } from "../api";

// ---------------------------------------------------------------- Texter
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const lc = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** "ons 27 jan" */
export const dayLabel = (day: string) => `${WEEKDAYS_SHORT[weekday(day)]} ${fmtDateShort(day)}`;
export { plural };
/** Mjuka bindestreck i långa sammansatta ord och brytpunkt efter snedstreck (t.ex. "Arbetsgivar-kontakter/nätverk"). */
export const breakable = (s: string) =>
  String(s || "")
    .replace(/\//g, "/​")
    .replace(/(Arbetsgivar|Arbets|Yrkes|yrkes|Själv|själv|ansvars|kommu)(?=[a-zåäö]{4,})/g, "$1­");

// ---------------------------------------------------------------- Aktiviteter och närvaro
export const KIND: Record<string, { label: string; icon: IconName; cls: "mote" | "yrke" | "praktik" | "" }> = {
  möte: { label: "Coachträff", icon: "message-circle", cls: "mote" },
  yrkesmoment: { label: "Yrkesmoment", icon: "tool", cls: "yrke" },
  praktikdag: { label: "Praktikdag", icon: "briefcase", cls: "praktik" },
};
export const kindOf = (k: string | null | undefined) => KIND[k ?? ""] ?? { label: k || "Aktivitet", icon: "calendar" as IconName, cls: "" as const };

type AttKey = "present" | "late" | "absent_valid" | "absent_invalid";
export const ATT: Record<AttKey, { label: string; icon: IconName; tone: BadgeTone; seg?: "green" | "yellow" | "red" }> = {
  present: { label: "Närvarande", icon: "check-circle", tone: "blue", seg: "green" },
  late: { label: "Sen", icon: "clock", tone: "grey", seg: "yellow" },
  absent_valid: { label: "Giltig frånvaro", icon: "minus-circle", tone: "outline" },
  absent_invalid: { label: "Ogiltig frånvaro", icon: "x-circle", tone: "red", seg: "red" },
};
export const ATT_OPTIONS: SegOption<AttKey>[] = (["present", "late", "absent_valid", "absent_invalid"] as const).map((k) => ({
  value: k, label: ATT[k].label, icon: ATT[k].icon, tone: ATT[k].seg,
}));

/** Närvaromärke: "Närvarande", "Giltig frånvaro · Sjukdom" eller "Ej registrerad". */
export function AttBadge({ at }: { at: AttMark }) {
  if (!at) return <Badge tone="outline" icon="circle">Ej registrerad</Badge>;
  const a = ATT[at.status] ?? ATT.present;
  return (
    <Badge tone={a.tone} icon={a.icon}>
      {a.label}
      {at.status === "absent_valid" && at.reason ? ` · ${at.reason}` : ""}
    </Badge>
  );
}

// ---------------------------------------------------------------- Ärendehuvud, spärr och perspektiv
/** Deltagarhuvudet i ärendevyerna (prototypens CaseHead). Namnet och ärendenumret leder till deltagarkortet. */
export function CaseHeadView({ head }: { head: CaseHead }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={head.name} />
      <div className="flex min-w-0 flex-col gap-1">
        <Row gap="sm">
          <CaseLink caseId={head.caseId} caseNumber={head.caseNumber} className="-ml-1.5 gap-2">
            <span>{head.name}</span>
            <span className="text-small font-semibold whitespace-nowrap text-text-muted tabular-nums tracking-[0.01em]">{head.caseNumber}</span>
          </CaseLink>
        </Row>
        <Row gap="sm">
          <PhaseTag phase={head.phase} name={head.phaseName} />
          <CaseStatusBadge status={head.status} />
          <span className="text-small text-text-muted">
            {head.areaName} · {head.track}
          </span>
        </Row>
      </div>
    </div>
  );
}

/** Rollen och testpersonen för perspektivbytet till kommunen: handläggaren som beställde (annars den förvalda handläggaren). */
export function customerPerspective(referrer: ReferrerView | null | undefined): { role: Role; userId?: string } {
  return referrer?.id ? { role: "kommun_handlaggare", userId: referrer.id } : { role: "kommun_handlaggare" };
}

/** Perspektivbyte (bara i prototypen) som får radbrytas på smal skärm. */
export function Persp({ role, userId, to, label }: { role: Role; userId?: string; to: string; label: string }) {
  return (
    <span className="inline-flex max-w-full min-w-0 [&_button]:max-w-full [&_button]:text-left [&_button]:whitespace-normal">
      <PerspectiveLink role={role} userId={userId} to={to} label={label} />
    </span>
  );
}

export const MIN_VECKA_CRUMB = { label: "Min vecka", to: "/min-vecka" };

/** Brödsmulor för coachens sidor om ett ärende: Mina ärenden / BOT-26-0174 (deltagarkortet) / sidan. */
export function caseCrumbs(head: { caseId: string; caseNumber: string }, label: string): { label: string; to?: string }[] {
  return [{ label: "Mina ärenden", to: "/arenden" }, { label: head.caseNumber, to: `/arenden/${encodeURIComponent(head.caseId)}` }, { label }];
}

/** Knapp till deltagarkortet (t.ex. efter en godkänd avstämning). */
export function ToCaseButton({ caseId, kind = "secondary" }: { caseId: string; kind?: "primary" | "secondary" | "ghost" }) {
  return (
    <Button kind={kind} icon="user" to={`/arenden/${encodeURIComponent(caseId)}`}>
      Till deltagarkortet
    </Button>
  );
}

/** Vyn kan inte visa ärendet (prototypens GateView). */
export function GateView({ gate, title, listPath }: { gate: CoachGate; title: string; listPath: string }) {
  return (
    <Page title={title} crumbs={[MIN_VECKA_CRUMB, { label: title }]}>
      <Notice tone="warn" title={gate.title}>
        {gate.text}
      </Notice>
      <Row>
        <Button kind="primary" icon="list" to={listPath}>
          Välj bland dina ärenden
        </Button>
      </Row>
    </Page>
  );
}

/** Laddning och fel för en fråga på en hel sida. */
export function PageState({ title, error, onRetry }: { title: string; error?: unknown; onRetry?: () => void }) {
  return (
    <Page title={title} crumbs={[MIN_VECKA_CRUMB, { label: title }]}>
      {error ? <ErrorNotice error={error as Error} onRetry={onRetry} /> : <Loading />}
    </Page>
  );
}

/** Visningslogg för deltagarkortet (prototypens ui.useAuditView('case', id, 'case.view')). */
export function useCaseView(caseId: string | null | undefined) {
  const log = useCommand(auditView);
  useAuditView(caseId ? `case.view:${caseId}` : null, () => log.run({ action: "case.view", entity: "case", entityId: caseId ?? null }).catch(() => undefined));
}

// ---------------------------------------------------------------- Deltagarlistan
/** Lista över coachens ärenden när vyn öppnas utan ärende (prototypens CasePicker). */
export function CasePicker({
  kind, title, lead, basePath, query, actionLabel, month,
}: {
  kind: CasePickerKind;
  title: string | ((month: string) => string);
  lead: string | ((v: { monthDueAt: LocalDateTime; monthDueNote: string }) => string);
  basePath: string;
  query?: Record<string, string | null | undefined>;
  actionLabel: string;
  month?: string;
}) {
  const q = useQuery(casePicker, { kind, month });
  const t = q.data ? (typeof title === "function" ? title(q.data.month) : title) : typeof title === "string" ? title : "";
  if (!q.data) return <PageState title={t} error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  return (
    <Page title={t} lead={typeof lead === "function" ? lead(v) : lead} crumbs={[MIN_VECKA_CRUMB, { label: t }]}>
      <Card title="Välj deltagare" icon="users" flush>
        {v.rows.length === 0 ? (
          <Empty icon="users" title="Inga ärenden">
            Du har inga aktiva ärenden just nu.
          </Empty>
        ) : (
          <List>
            {v.rows.map((c) => (
              <ListItem
                key={c.caseId}
                lead={<Avatar name={c.name} />}
                title={c.name}
                sub={`${c.caseNumber} · ${c.phaseLabel}`}
                side={
                  <Button kind="secondary" iconRight="arrow-right" to={path(`${basePath}/${encodeURIComponent(c.caseId)}`, { ...(query ?? {}), ...(kind === "manad" ? { manad: v.month } : {}) })}>
                    {actionLabel}
                  </Button>
                }
              >
                {(c.badge || c.note) && (
                  <Row gap="sm">
                    {c.badge && (
                      <Badge tone={c.badge.tone} icon={c.badge.icon ?? undefined}>
                        {c.badge.text}
                      </Badge>
                    )}
                    {c.note && <span className="text-small text-text-muted">{c.note}</span>}
                  </Row>
                )}
              </ListItem>
            ))}
          </List>
        )}
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------- Förslagsknappar (prototypens co-chip)
export function ChipButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-1.5 text-left text-ui text-antracit [font-family:inherit] hover:border-antracit"
    >
      {children}
    </button>
  );
}
/** Förslag att klicka på (veckomål, arbetsgivare …). */
export function Chips({ label, items, onPick }: { label: string; items: readonly { key: string; label: string }[] | readonly string[]; onPick: (x: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((raw) => {
        const it = typeof raw === "string" ? { key: raw, label: raw } : raw;
        return (
          <ChipButton key={it.key} onClick={() => onPick(it.key)}>
            {it.label}
          </ChipButton>
        );
      })}
    </div>
  );
}

