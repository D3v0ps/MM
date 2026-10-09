"use client";
// Mina tilldelade ärenden (/handledare, prototypens hand.start): handledarens lista med sökning och grupper. Översikten –
// närvaro att registrera, kommande sju dagar och praktikplatser att följa upp – ligger på handledarens Min vecka
// (screens/min-vecka-handledare.tsx, beslut 2026-10-06). Handledaren ser inte coachens anteckningar, bedömningar eller rapporter.
import { useState, type ReactNode } from "react";
import { useQuery } from "@/shell/backend";
import { Link, useNav } from "@/shell/nav";
import { useMemoryState, useQueryPatch } from "@/shell/url-state";
import { useSession } from "@/shell/session";
import {
  Button, Card, CaseStatusBadge, DemoNote, Empty, ErrorNotice, Field, Grid, Icon, Input, Loading, Page, PhaseBar, Seg, Select, Stack,
} from "@/ui";
import { supervisorStart, type SupervisorCase, type SupervisorStart } from "../api";
import { ActList, fd, FourBadges, Label, plural } from "./common";

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
  return (
    <>
      <p className="m-0 flex items-start gap-2 text-text-muted">
        <Icon name="shield" className="mt-1 flex-none" />
        <span>Du ser bara ärenden där du ingår i teamet. Saknar du ett? Be samordnaren lägga till dig.</span>
      </p>
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
        <span className="text-text-muted">Sorterat efter nästa moment eller praktikdag</span>
      </div>
      {list.length === 0 ? (
        <Card>
          <Empty icon={filtering ? "search" : "users"} title={filtering ? "Inga ärenden matchar sökningen här" : "Inga ärenden här"}>
            {filtering ? "Ändra sökningen eller välj en annan flik." : group === "pagaende" ? "Du är inte tilldelad något pågående ärende just nu." : "Inga ärenden i den här gruppen."}
          </Empty>
        </Card>
      ) : (
        // Högst tre kort per rad (minst 340 px breda) – luft som på Min vecka; två vid 1024 px, ett på mobil.
        <Grid data-testid="handledare-arenden" className="grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))]">
          {list.slice(0, limit).map((c) => (
            <HandCard key={c.id} c={c} today={m.today} />
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

function HandCard({ c, today }: { c: SupervisorCase; today: string }) {
  const pl = c.placement;
  return (
    <Card
      title={c.caseNumber}
      icon="user"
      actions={<CaseStatusBadge status={c.status} />}
      // Namnet är vägen till deltagarkortet (en riktig länk som på Min vecka – går att öppna i en ny flik); kortet har bara en
      // knapp, för åtgärden.
      foot={
        c.status === "active" ? (
          <Button icon="check-square" to={`/narvaro?arende=${encodeURIComponent(c.id)}`}>
            Närvaro
          </Button>
        ) : undefined
      }
    >
      <Stack gap="sm">
        <Link
          to={`/arenden/${encodeURIComponent(c.id)}`}
          className="-ml-1.5 inline-flex min-h-11 max-w-full items-center self-start rounded-mb px-1.5 text-h3 font-extrabold text-antracit underline underline-offset-3 [overflow-wrap:anywhere] hover:bg-antracit-ton"
        >
          {c.displayName}
        </Link>
        <div className="flex items-start gap-1 text-small text-text-muted">
          <Icon name="user" className="mt-0.5 flex-none" />
          Din roll: {c.myRoleLabel}
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
            <p className="text-text-muted">{c.phase >= 3 ? "Ingen praktik planerad ännu." : "Praktik planeras senare i insatsen."}</p>
          )}
        </div>
        <div>
          <Label className="mt-1.5">Arbetsgivarkontakter</Label>
          {c.lastContact ? (
            <p>
              <b>{plural(c.contacts, "kontakt", "kontakter")}.</b> Senast {fd(c.lastContact.occurredOn, today)}: {c.lastContact.label}
              {c.lastContact.actor ? ` – ${c.lastContact.actor}` : ""}.
            </p>
          ) : (
            <p className="text-text-muted">Inga registrerade ännu.</p>
          )}
        </div>
      </Stack>
    </Card>
  );
}
