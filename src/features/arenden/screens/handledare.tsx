"use client";
// Handledarens startsida (prototypens hand.start): tilldelade ärenden, kommande moment och praktikdagar, praktikplatser
// som saknar något av de fyra rätten. Handledaren ser inte coachens anteckningar, bedömningar eller rapporter.
import { useState, type ReactNode } from "react";
import { useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { useMemoryState, useQueryPatch } from "@/shell/url-state";
import { useSession } from "@/shell/session";
import { fmtTime, fmtWeek, fmtWeekday } from "@/core/time";
import {
  Badge, Button, Card, CaseStatusBadge, DemoNote, Empty, ErrorNotice, Field, Grid, Icon, Input, Kpi, List, ListItem, Loading, Notice, Page, PhaseBar, Seg, Select, Spacer, Split, Stack,
} from "@/ui";
import { supervisorStart, type SupervisorCase, type SupervisorStart } from "../api";
import { ActList, actIcon, actLabel, cap, fd, FourBadges, KpiRow, Label, plural } from "./common";

type Group = "pagaende" | "start" | "avslutade";
const GROUP_LABEL: Record<Group, string> = { pagaende: "Pågående", start: "Väntar på start", avslutade: "Avslutade" };
const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s-]/g, "");

export function HandledareScreen() {
  const q = useQuery(supervisorStart, {});
  const { user } = useSession();
  const page = (children: ReactNode) => (
    <Page
      title="Mina tilldelade ärenden"
      eyebrow={`Handledare · ${user.name}`}
      lead="Här planerar du moment och praktik, registrerar närvaro och håller kontakten med arbetsgivarna."
      actions={
        <Button kind="primary" icon="check-square" to="/narvaro">
          Registrera närvaro
        </Button>
      }
    >
      {children}
    </Page>
  );
  if (q.error) return page(<ErrorNotice error={q.error} onRetry={() => void q.refetch()} />);
  if (!q.data) return page(<Loading />);
  return page(<Content m={q.data} />);
}

function Content({ m }: { m: SupervisorStart }) {
  const nav = useNav();
  const patch = useQueryPatch();
  const [group, setGroup] = useState<Group>("pagaende");
  const [limit, setLimit] = useState(12);
  const [showAllUp, setShowAllUp] = useState(false);
  // Sök på namn eller del av ärendenumret (bara i minnet – kan vara ett namn) och avtalsområde i adressen (?omrade=).
  const [q, setQ] = useMemoryState("q", "");
  const g = m.groups;
  const allCases = [...g.pagaende, ...g.start, ...g.avslutade];
  const areas = [...new Map(allCases.filter((c) => c.areaCode).map((c) => [c.areaCode as string, c.areaName])).entries()].sort((a, b) => a[0].localeCompare(b[0], "sv"));
  const area = areas.some(([code]) => code === nav.query.get("omrade")) ? (nav.query.get("omrade") as string) : "";
  const needle = norm(q);
  const matches = (c: SupervisorCase) => (!area || c.areaCode === area) && (!needle || norm(`${c.caseNumber} ${c.displayName}`).includes(needle));
  const filtering = !!needle || !!area;
  // Träffar i de andra flikarna: "2 träffar bland Avslutade – Visa".
  const elsewhere = filtering ? (["pagaende", "start", "avslutade"] as const).filter((x) => x !== group).map((x) => [x, g[x].filter(matches).length] as const).filter(([, n]) => n > 0) : [];
  const list = g[group].filter(matches).sort((a, b) => {
    const x = a.nextAt ?? "9999";
    const y = b.nextAt ?? "9999";
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const up = showAllUp ? m.upcoming : m.upcoming.slice(0, 8);
  const week = fmtWeek(m.today);
  const open = (caseId: string, flik?: string) => nav.push(`/arenden/${encodeURIComponent(caseId)}${flik ? `?flik=${flik}` : ""}`);
  return (
    <>
      <Notice tone="info" icon="shield" title="Du ser bara ärenden du är tilldelad">
        Behörigheten styrs av teamet i varje ärende. Du ser moment, närvaro, praktik och arbetsgivarkontakter – inte coachens anteckningar, bedömningar, månadsrapporter eller slutrapporter.
        Saknar du ett ärende? Be samordnaren lägga till dig i teamet.
      </Notice>
      <KpiRow>
        <Kpi label="Pågående ärenden" value={g.pagaende.length} sub={`${g.start.length} väntar på start`} />
        <Kpi label="Praktikdagar" value={m.practiceDays} sub={`den här veckan (${week})`} />
        <Kpi label="Yrkesmoment" value={m.vocationalMoments} sub={`den här veckan (${week})`} />
        <Kpi
          label="Praktik som saknar något av de fyra rätten"
          value={m.missingFour.length}
          sub={m.missingFour.length ? "komplettera före nästa uppföljning" : "alla praktikplatser är kompletta"}
          tone={m.missingFour.length ? "watch" : undefined}
        />
      </KpiRow>
      <Split>
        <Card
          title="Kommande sju dagar"
          icon="calendar"
          flush
          foot={
            m.upcoming.length > 8 && (
              <>
                <span className="text-small text-text-muted">
                  Visar {up.length} av {m.upcoming.length}
                </span>
                <Spacer />
                <Button kind="ghost" onClick={() => setShowAllUp(!showAllUp)}>
                  {showAllUp ? "Visa färre" : "Visa alla"}
                </Button>
              </>
            )
          }
        >
          {up.length === 0 ? (
            <div className="px-[18px] py-4">
              <p className="text-small text-text-muted">Inga moment eller praktikdagar de närmaste sju dagarna.</p>
            </div>
          ) : (
            <List>
              {up.map((a) => (
                <ListItem
                  key={a.id}
                  icon={actIcon(a.kind)}
                  title={`${cap(fmtWeekday(a.startsAt))} kl. ${fmtTime(a.startsAt)} · ${actLabel(a.kind)}`}
                  sub={`${a.displayName} · ${a.caseNumber} · ${a.location}`}
                  onClick={() => open(a.caseId)}
                />
              ))}
            </List>
          )}
        </Card>
        <Card title="Praktikplatser att följa upp" icon="briefcase" flush>
          {m.missingFour.length === 0 ? (
            <div className="px-[18px] py-4">
              <p className="text-small text-text-muted">Alla pågående praktikplatser har de fyra rätten.</p>
            </div>
          ) : (
            <List>
              {m.missingFour.map((x) => (
                <ListItem
                  key={x.caseId}
                  lead={<Icon name="alert-circle" className="mt-0.5 text-rod" />}
                  title={x.employerName ?? "Praktikplats"}
                  sub={`${x.displayName} · ${x.caseNumber}`}
                  onClick={() => open(x.caseId, "praktik")}
                >
                  <span className="text-small">Saknas: {x.missing.join(", ")}</span>
                </ListItem>
              ))}
            </List>
          )}
        </Card>
      </Split>
      <Card title="Sök bland dina ärenden" icon="search">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] items-end gap-x-4 gap-y-3">
          <Field label="Sök" id="hand-q" help="Namn eller en del av ärendenumret, till exempel 0143.">
            <Input
              type="search"
              value={q}
              onValueChange={(v) => {
                setQ(v);
                setLimit(12);
              }}
              placeholder="Namn eller ärendenummer"
            />
          </Field>
          {areas.length > 1 && (
            <Field label="Avtalsområde" id="hand-area">
              <Select value={area} placeholder="Alla områden" onValueChange={(v) => patch({ omrade: v || null })} options={areas.map(([code, name]) => ({ value: code, label: `${code} ${name}` }))} />
            </Field>
          )}
        </div>
        {elsewhere.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {elsewhere.map(([x, n]) => (
              <span key={x} className="inline-flex items-center gap-1.5">
                <Icon name="info" />
                {plural(n, "träff", "träffar")} bland {GROUP_LABEL[x]} –
                <Button kind="ghost" className="px-2" onClick={() => setGroup(x)}>
                  Visa
                </Button>
              </span>
            ))}
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Seg
          ariaLabel="Visa ärenden"
          value={group}
          onValueChange={(v) => {
            setGroup(v);
            setLimit(12);
          }}
          options={[
            { value: "pagaende", label: `Pågående (${g.pagaende.length})` },
            { value: "start", label: `Väntar på start (${g.start.length})` },
            { value: "avslutade", label: `Avslutade (${g.avslutade.length})` },
          ]}
        />
        <span className="text-small text-text-muted">Sorterat efter nästa moment eller praktikdag</span>
      </div>
      {list.length === 0 ? (
        <Card>
          <Empty icon={filtering ? "search" : "users"} title={filtering ? "Inga ärenden matchar sökningen här" : "Inga ärenden här"}>
            {filtering ? "Ändra sökningen eller välj en annan flik." : group === "pagaende" ? "Du är inte tilldelad något pågående ärende just nu." : "Inga ärenden i den här gruppen."}
          </Empty>
        </Card>
      ) : (
        <Grid data-testid="handledare-arenden">
          {list.slice(0, limit).map((c) => (
            <HandCard key={c.id} c={c} today={m.today} open={open} />
          ))}
        </Grid>
      )}
      {list.length > limit && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-small text-text-muted">
            Visar {limit} av {list.length}
          </span>
          <Button icon="chevron-down" onClick={() => setLimit(limit + 12)}>
            Visa fler
          </Button>
        </div>
      )}
      <DemoNote>
        I testdatan är Petra yrkesspecifik handledare för lager, logistik, transport och industri och finns därför i teamet för de ärendena. Kommunen ser inte den här vyn – de ser
        närvaron i veckorapporten.
      </DemoNote>
    </>
  );
}

function HandCard({ c, today, open }: { c: SupervisorCase; today: string; open: (caseId: string, flik?: string) => void }) {
  const pl = c.placement;
  return (
    <Card
      title={c.caseNumber}
      icon="user"
      actions={<CaseStatusBadge status={c.status} />}
      foot={
        <>
          {c.status === "active" && (
            <Button icon="check-square" to={`/narvaro?arende=${encodeURIComponent(c.id)}`}>
              Närvaro
            </Button>
          )}
          <Spacer />
          <Button kind="ghost" iconRight="arrow-right" onClick={() => open(c.id)}>
            Öppna
          </Button>
        </>
      }
    >
      <Stack gap="sm">
        <button
          type="button"
          onClick={() => open(c.id)}
          className="inline-flex min-h-11 max-w-full cursor-pointer items-center border-0 bg-transparent p-0 text-left text-h3 font-extrabold text-antracit underline underline-offset-3 [overflow-wrap:anywhere] [font-family:inherit]"
        >
          {c.displayName}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="bluetone" icon="user">
            Din roll: {c.myRoleLabel}
          </Badge>
        </div>
        <div className="flex flex-col gap-1.5">
          <PhaseBar phase={c.phase} />
          <div className="text-small text-text-muted">
            Fas {c.phase} · {c.phaseName}
            {c.vocationalTrack ? ` · ${c.vocationalTrack}` : ""}
          </div>
        </div>
        <div>
          <Label className="mt-1.5">Kommande moment och praktik</Label>
          <ActList short acts={c.upcoming} empty="Inga planerade moment eller praktikdagar." />
        </div>
        <div>
          <Label className="mt-1.5">Praktikplats</Label>
          {pl ? (
            <Stack gap="sm" className="gap-1.5">
              <div>
                <span className="font-bold">{pl.employerName ?? "Arbetsgivare"}</span>{" "}
                <span className="text-small text-text-muted">
                  · {fd(pl.startsOn, today)} – {fd(pl.endsOn, today)}
                </span>
              </div>
              <FourBadges rights={pl.fourRights} />
              {pl.contactName && (
                <div className="text-small">
                  Kontakt: {pl.contactName} · {pl.phone}
                </div>
              )}
            </Stack>
          ) : (
            <p className="text-small text-text-muted">{c.phase >= 3 ? "Ingen praktik planerad ännu." : "Praktik planeras senare i insatsen."}</p>
          )}
        </div>
        <div>
          <Label className="mt-1.5">Arbetsgivarkontakter</Label>
          {c.lastContact ? (
            <p className="text-small">
              <b>{plural(c.contacts, "kontakt", "kontakter")}.</b> Senast {fd(c.lastContact.occurredOn, today)}: {c.lastContact.label}
              {c.lastContact.actor ? ` – ${c.lastContact.actor}` : ""}.
            </p>
          ) : (
            <p className="text-small text-text-muted">Inga registrerade ännu.</p>
          )}
        </div>
      </Stack>
    </Card>
  );
}
