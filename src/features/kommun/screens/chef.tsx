"use client";
// Beställarrapporten för kommunens chef (/portal/bestallarrapport) – prototypens kom.chef.
// Siffrorna är den levererade rapportens frysta innehåll. Det interna målet visas aldrig – bara avtalets mål. Grupper med
// färre än minN personer redovisas som "färre än 5" och andelen redovisas inte. Kommunens chef godkänner åtgärdsplaner här.
import { useState } from "react";
import { pct } from "@/core/format";
import { monthName } from "@/core/time";
import { reportOpen } from "@/features/rapporter/api";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { useQueryPatch } from "@/shell/url-state";
import {
  Badge, BuildPhase, Button, Card, DemoNote, ErrorNotice, focusSoon, Grid, Kpi, Kv, Loading, Meter, Notice, PerspectiveLink, Seg, Stack, TabPanel, Table, Tabs, useAuditView,
  useConfirm, useToast,
} from "@/ui";
import { kommunApproveActionPlan, kommunChef, type KomActionPlan, type KomChef, type KomRate } from "../api";
import { fD, fDT, fDTL, monthCap, small as smallN, ucfirst } from "../texts";
import { KOM_TABS, KomHead, KomPage, reportPath } from "./parts";

type Tab = "resultat" | "deltagare" | "progression" | "narvaro";
const SATISFACTION = "Andel som svarat 4 eller 5 på en skala 1–5";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function PortalChefScreen({ query }: ScreenProps) {
  // Månaden i adressen (?manad=2026-10, replace): Tillbaka från ett dokument och omladdning visar samma månad.
  const m0 = query.get("manad");
  const month = m0 && MONTH_RE.test(m0) ? m0 : null;
  const patch = useQueryPatch();
  const setMonth = (m: string) => patch({ manad: m });
  const q = useQuery(kommunChef, { month });
  // Vid byte av månad visas föregående siffror tills de nya är hämtade (ingen tom sida emellan).
  const [last, setLast] = useState<KomChef | undefined>(q.data);
  if (q.data && q.data !== last) setLast(q.data);
  const d = q.data ?? last;
  if (q.error && !d) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return <Loading />;
  return <Chef d={d} onMonth={setMonth} />;
}

function Chef({ d, onMonth }: { d: KomChef; onMonth: (m: string) => void }) {
  const { user } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const approve = useCommand(kommunApproveActionPlan);
  const open = useCommand(reportOpen);
  const [tab, setTab] = useState<Tab>("resultat");
  const [showApproved, setShowApproved] = useState(false);
  const rep = d.report;
  // Kvittens när chefen läser en levererad rapport (loggas alltid, en gång per sidvisning).
  useAuditView(rep ? `report.open:${rep.id}` : null, () => (rep ? open.run({ reportId: rep.id }) : null));

  const s = d.summary;
  const N = d.minN;
  const target = d.contractTarget;
  const small = (n: number) => smallN(n, N);
  const rr = s?.result.rolling ?? null;
  // Samma regel som i rapportdokumentet: antal 1–4 visas som "färre än 5" och andelen redovisas inte.
  const hiddenShare = (r: KomRate) => r.den > 0 && (r.den < N || (r.num > 0 && r.num < N));
  const shareTxt = (r: KomRate) => (r.den === 0 || r.value == null ? "–" : hiddenShare(r) ? "Redovisas inte" : pct(r.value));
  const enough = (r: KomRate | null) => !!r && r.den >= r.minN && !hiddenShare(r);
  const below = !!rr && enough(rr) && (rr.value ?? 0) < target;
  const resultBadge = (r: KomRate) =>
    hiddenShare(r) ? (
      <Badge tone="grey" icon="lock">
        Redovisas inte – små grupper
      </Badge>
    ) : !enough(r) ? (
      <Badge tone="grey" icon="info">
        För få avslut för att bedöma
      </Badge>
    ) : (r.value ?? 0) >= target ? (
      <Badge tone="blue" icon="check-circle">
        Når avtalsmålet
      </Badge>
    ) : (
      // Kontur med röd ikon: statusen står i en förklarande ruta – det röda ämnet på sidan är det som väntar på ditt godkännande.
      <Badge tone="outline" icon="alert" className="[&_svg]:text-rod">
        Under avtalsmålet
      </Badge>
    );
  const avslutText = (r: KomRate) => `${small(r.num)} av ${small(r.den)} avslut`;
  const pctOrHidden = (num: number, den: number) => (den === 0 ? "–" : den < N || (num > 0 && num < N) ? "Redovisas inte" : pct(num / den, 0));
  const attPct = (v: number | null) => (v == null ? "–" : pct(v));
  const drafts = d.months.filter((m) => !m.delivered);

  const approvePlan = async (cd: KomActionPlan) => {
    const yes = await confirm({
      title: "Godkänn åtgärdsplanen?",
      confirmLabel: "Godkänn åtgärdsplanen",
      body: (
        <Stack gap="sm">
          <p>
            <b>{cd.description}</b>
          </p>
          <p>Åtgärd: {cd.actionPlan}</p>
          <p className="text-text-muted">Miljonbemanning får besked direkt. Godkännandet sparas med datum och ditt namn.</p>
        </Stack>
      ),
    });
    if (!yes) return;
    // Knappen försvinner med planen: fokus till nästa plan som väntar, annars till månadsvalet.
    const i = d.pendingPlans.findIndex((x) => x.id === cd.id);
    const next = d.pendingPlans[i + 1] ?? d.pendingPlans[i - 1];
    const res = await approve.run({ id: cd.id }).catch(() => null);
    if (res && res.ok) {
      toast("Åtgärdsplanen är godkänd. Miljonbemanning har fått besked.");
      focusSoon(next ? `plan-${next.id}` : "kom-month-label");
    } else toast("Åtgärdsplanen kunde inte godkännas.", "error");
  };

  return (
    <KomPage>
      <KomHead
        eyebrow={`${d.customerName} · ${user.name}, ${(user.title || "").toLowerCase()}`}
        title="Beställarrapport"
        lead="Så går insatserna inom avtalet med Miljonbemanning. Rapporten kommer en gång i månaden och bygger bara på godkända uppgifter."
        actions={<BuildPhase fas={2} />}
      />

      {d.pendingPlans.length > 0 && (
        <Card title={`Väntar på ditt godkännande (${d.pendingPlans.length})`} icon="flag" tone="red" actions={<BuildPhase fas={2} />}>
          <Stack>
            {d.pendingPlans.map((cd) => (
              <div id={`plan-${cd.id}`} tabIndex={-1} className="flex flex-col gap-2.5" key={cd.id}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone="outline">{ucfirst(cd.type)}</Badge>
                  <Badge tone="grey">{cd.stepText}</Badge>
                  <span className="text-body text-text-muted">
                    Registrerad {fD(cd.raisedAt)} · källa: {cd.source}
                  </span>
                </div>
                <p className="font-bold">{cd.description}</p>
                <Kv
                  items={[
                    ["Åtgärdsplan", cd.actionPlan],
                    ["Klar senast", fD(cd.actionPlanDue)],
                  ]}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button kind="primary" size="lg" icon="check" pending={approve.pending} onClick={() => void approvePlan(cd)}>
                    Godkänn åtgärdsplanen
                  </Button>
                </div>
                <p className="text-body text-text-muted">Har du synpunkter på planen? Kontakta avtalsansvarig {d.managerName} på Miljonbemanning.</p>
              </div>
            ))}
          </Stack>
        </Card>
      )}

      <Stack gap="sm">
        <div className="text-body font-extrabold tracking-[0.09em] text-text-muted uppercase" id="kom-month-label">
          Välj månad
        </div>
        <Seg
          ariaLabel="Välj månad"
          value={d.month}
          onValueChange={onMonth}
          options={d.months.map((m) => ({ value: m.month, label: `${monthCap(m.month)}${m.delivered ? "" : " (utkast)"}`, icon: m.delivered ? undefined : "edit" }))}
        />
        {d.latestDelivered && d.month === d.latestDelivered && drafts.length > 0 && (
          <p className="text-text-muted">
            Du ser {monthName(d.latestDelivered)} eftersom det är den senaste rapporten som har levererats. Rapporten för {drafts.map((m) => monthName(m.month)).join(" och ")} är
            ett utkast hos Miljonbemanning tills avtalsansvarig har godkänt den.
          </p>
        )}
      </Stack>

      {d.pending && d.month && (
        <Notice tone="info" icon="clock" title={`Rapporten för ${monthName(d.month)} är inte klar än`}>
          Den är ett utkast hos Miljonbemanning. Avtalsansvarig {d.managerName} granskar och godkänner den innan den levereras till dig, senast {fDTL(d.pending.dueAt)}. Du ser
          inga siffror förrän rapporten är godkänd.
          <div className="mt-2.5">
            <Button icon="arrow-left" onClick={() => d.latestDelivered && onMonth(d.latestDelivered)}>
              Visa {d.latestDelivered ? monthName(d.latestDelivered) : "senaste"}
            </Button>
          </div>
        </Notice>
      )}

      {s && rep && rr && (
        <Stack gap="lg">
          <div className="grid grid-cols-4 gap-4 max-[760px]:grid-cols-2 max-[620px]:gap-2.5">
            <Kpi
              label="Resultat, 6 månader"
              value={shareTxt(rr)}
              // Ett rött ämne per sida: väntar en åtgärdsplan på godkännande är den det röda, och resultatet "Bevaka".
              tone={below ? (d.pendingPlans.length > 0 ? "watch" : "alert") : null}
              statusText={below ? "Under avtalsmålet" : undefined}
              sub={`${avslutText(rr)} · avtalsmål ${pct(target, 0)}`}
            />
            <Kpi label="Aktiva under månaden" value={small(s.active)} sub={`${small(s.started)} nya · ${small(s.closed)} avslutade`} />
            <Kpi label="Närvarograd" value={attPct(s.attendanceRate)} sub="Av alla planerade tillfällen" />
            <Kpi
              label="Nöjdhet"
              value={s.pulse.enough && s.pulse.satisfaction != null ? pct(s.pulse.satisfaction, 0) : "–"}
              sub={s.pulse.enough ? `${SATISFACTION} (${s.pulse.responses} svar)` : `Färre än ${N} svar`}
            />
          </div>
          <Card
            title={`Sammanfattning ${monthName(s.month)}`}
            icon="file"
            foot={
              <span className="text-body text-text-muted">
                Godkänd av {rep.approvedByName} {fDT(rep.approvedAt)} · levererad {fDT(rep.deliveredAt)}
              </span>
            }
          >
            <Stack gap="sm">
              <p>
                Under {monthName(s.month)} var {small(s.active)} deltagare aktiva. {ucfirst(small(s.started))} nya insatser startade och {small(s.closed)} avslutades.
              </p>
              <p>
                {hiddenShare(rr)
                  ? `Resultatgraden de senaste sex månaderna redovisas inte eftersom grupperna är mindre än ${N} personer.`
                  : enough(rr)
                    ? `Resultatgraden de senaste sex månaderna var ${pct(rr.value)} (${avslutText(rr)} gick till arbete eller studier). Avtalsmålet är ${pct(target, 0)}.`
                    : `Det finns för få avslut för att bedöma resultatgraden (minst ${rr.minN} behövs).`}
              </p>
              <p>
                Närvarograden var {s.attendanceRate == null ? "inte beräkningsbar" : attPct(s.attendanceRate)}.{" "}
                {s.deviations > 0 ? `${ucfirst(small(s.deviations))} avvikelser på deltagarnivå hanterades under månaden.` : "Inga avvikelser på deltagarnivå registrerades."}
              </p>
              <div>{resultBadge(rr)}</div>
            </Stack>
          </Card>
          <Tabs
            id="kom-chef"
            ariaLabel="Rapportens delar"
            className={KOM_TABS}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "resultat", label: "Resultat", icon: "target" },
              { id: "deltagare", label: "Deltagare", icon: "users" },
              { id: "progression", label: "Progression", icon: "trending-up" },
              { id: "narvaro", label: "Närvaro och nöjdhet", icon: "check-square" },
            ]}
          />
          <TabPanel tabsId="kom-chef" active={tab}>
            {tab === "resultat" && (
              <Stack>
                {(
                  [
                    ["Senaste sex månaderna", rr],
                    ["Sedan avtalet startade", s.result.sinceStart],
                    [`Under ${monthName(s.month)}`, s.result.month],
                  ] as const
                ).map(([label, r]) => (
                  <Card key={label} title={label}>
                    <Stack>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[2rem] leading-[1.1] font-extrabold tabular-nums">{shareTxt(r)}</div>
                        {resultBadge(r)}
                      </div>
                      {!hiddenShare(r) && r.den > 0 && (
                        <Meter
                          value={r.value || 0}
                          max={1}
                          tone={enough(r) && (r.value ?? 0) >= target ? "blue" : undefined}
                          label={`Resultatgrad ${pct(r.value || 0)}, avtalsmål ${pct(target, 0)}`}
                          markers={[{ value: target, label: `Avtalsmål ${pct(target, 0)}`, tone: "red" }]}
                        />
                      )}
                      <div className="text-text-muted">
                        {avslutText(r)} gick till arbete eller studier.
                        {r.prelim > 0 ? ` Ytterligare ${small(r.prelim)} väntar på verifiering och räknas inte än.` : ""}
                        {r.excluded > 0 ? ` Avslut som inte räknas, till exempel vid flytt: ${small(r.excluded)}.` : ""}
                      </div>
                    </Stack>
                  </Card>
                ))}
                <Notice tone="info" title="Hur resultatet räknas">
                  Resultat är avslut till arbete eller studier som är verifierade. Exakt vilka anställningar och studier som räknas är inte bestämt än mellan kommunen och
                  Miljonbemanning. När en grupp har färre än {N} personer redovisas inte andelen.
                </Notice>
              </Stack>
            )}
            {tab === "deltagare" && (
              <Stack>
                <Card title="Per avtalsområde" flush>
                  <Table
                    caption="Deltagare per avtalsområde"
                    rowKey="code"
                    rows={s.byArea}
                    columns={[
                      { key: "name", label: "Område" },
                      { key: "active", label: "Aktiva", num: true, render: (r) => small(r.active) },
                      { key: "started", label: "Nya", num: true, render: (r) => small(r.started) },
                      { key: "closed", label: "Avslutade", num: true, render: (r) => small(r.closed) },
                    ]}
                  />
                </Card>
                <Card title="Per yrkesspår" flush>
                  <Table
                    caption="Aktiva deltagare per yrkesspår"
                    rowKey="track"
                    rows={s.byTrack}
                    columns={[
                      { key: "track", label: "Yrkesspår", render: (r) => r.track || "Inte valt än" },
                      { key: "active", label: "Aktiva", num: true, render: (r) => small(r.active) },
                    ]}
                  />
                </Card>
                <p className="text-text-muted">
                  Grupper med färre än {N} personer visas som ”färre än {N}” så att ingen enskild deltagare kan pekas ut.
                </p>
              </Stack>
            )}
            {tab === "progression" && (
              <Stack>
                <Grid cols={2}>
                  <Kpi
                    label="Tydlig progression"
                    value={pctOrHidden(s.progression.clear, s.progression.assessed)}
                    sub={`${d.progressionRule.clear} · ${small(s.progression.assessed)} bedömda`}
                  />
                  <Kpi label="Någon progression" value={pctOrHidden(s.progression.any, s.progression.assessed)} sub={d.progressionRule.any} />
                </Grid>
                <Card title="Tydlig progression per område" flush>
                  <Table
                    caption="Tydlig progression per progressionsområde"
                    rowKey="key"
                    rows={s.progression.areaDist}
                    columns={[
                      { key: "label", label: "Område" },
                      { key: "clear", label: "Antal", num: true, render: (r) => small(r.clear) },
                      { key: "n", label: "Andel", num: true, render: (r) => pctOrHidden(r.clear, r.n) },
                    ]}
                  />
                </Card>
                <p className="text-text-muted">
                  Bygger bara på månadsbedömningar som coachen har godkänt.{d.progressionRule.excluded ? ` ${d.progressionRule.excluded}` : ""} Andelar redovisas inte när antalet är
                  färre än {N}.
                </p>
              </Stack>
            )}
            {tab === "narvaro" && (
              <Stack>
                <Card title="Närvaro" icon="check-square">
                  <Kv
                    items={[
                      ["Närvarograd", attPct(s.attendanceRate)],
                      ["Närvarande", small(s.attendance.present)],
                      ["Sen ankomst", small(s.attendance.late)],
                      ["Giltig frånvaro", small(s.attendance.absentValid)],
                      ["Ogiltig frånvaro", small(s.attendance.absentInvalid)],
                    ]}
                  />
                </Card>
                <Card title="Nöjdhet" icon="smile" actions={<BuildPhase fas={2} />}>
                  {s.pulse.enough ? (
                    <Kv
                      items={[
                        [SATISFACTION, s.pulse.satisfaction == null ? "–" : pct(s.pulse.satisfaction, 0)],
                        ["Känner sig närmare arbete eller studier", s.pulse.closer == null ? "–" : pct(s.pulse.closer, 0)],
                        ["Antal svar", small(s.pulse.responses)],
                      ]}
                    />
                  ) : (
                    <p>Resultatet visas när minst {s.pulse.minN || N} deltagare har svarat.</p>
                  )}
                  <p className="mt-2.5 text-body text-text-muted">
                    Deltagarna svarar anonymt efter två veckor och vid avslut. Svaren gäller de tre månaderna till och med {monthName(s.month)}.
                  </p>
                </Card>
                <Card title="Avvikelser" icon="flag">
                  <Kv
                    items={[
                      ["Avvikelser på deltagarnivå", small(s.deviations)],
                      ["Nya avtalsavvikelser", small(s.contractDeviations)],
                      ["Skriftliga varningar hittills", String(d.warnings)],
                    ]}
                  />
                </Card>
              </Stack>
            )}
          </TabPanel>
          <div className="flex flex-wrap items-center gap-3">
            <Button icon="file" to={reportPath(rep.id, "bestallarrapport", { manad: d.month })}>
              Öppna rapporten som dokument
            </Button>
            <Button icon="users" to="/portal/deltagare">
              Enhetens deltagare
            </Button>
          </div>
        </Stack>
      )}

      {d.approvedPlans.length > 0 && (
        <Card
          title="Godkända åtgärdsplaner"
          icon="check-circle"
          actions={
            <Button kind="ghost" icon={showApproved ? "chevron-up" : "chevron-down"} ariaPressed={showApproved} onClick={() => setShowApproved(!showApproved)}>
              {showApproved ? "Dölj" : `Visa (${d.approvedPlans.length})`}
            </Button>
          }
        >
          {showApproved ? (
            <Stack>
              {d.approvedPlans.map((cd) => (
                <Stack gap="sm" key={cd.id}>
                  <p className="font-bold">{cd.description}</p>
                  <div className="text-text-muted">{cd.actionPlan}</div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Badge tone="blue" icon="check">
                      Godkänd {fD(cd.approvedAt)}
                    </Badge>
                    {cd.closed && (
                      <Badge tone="dark" icon="check-square">
                        Avslutad
                      </Badge>
                    )}
                  </div>
                </Stack>
              ))}
            </Stack>
          ) : (
            <p className="text-text-muted">
              {d.approvedPlans.length} åtgärdsplaner är godkända. Senast {fD(d.approvedPlans[0].approvedAt)}.
            </p>
          )}
        </Card>
      )}

      <Card title="Statistik på begäran" icon="download" actions={<BuildPhase fas={3} />}>
        <Stack gap="sm">
          <p>Kommunen kan beställa statistik för valfri period, kostnadsfritt upp till {d.statisticsPerYear} gånger per år.</p>
          <span>
            <Button icon="download" disabled>
              Beställ statistik
            </Button>
          </span>
        </Stack>
      </Card>
      <DemoNote>Siffrorna räknas fram ur prototypens påhittade data. Vad beställarrapporten ska innehålla och hur ofta den kommer är en öppen fråga till kommunen.</DemoNote>
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="chef" to="/ledning" label="Se samma resultat i Miljonbemannings ledningsvy" />
      </div>
    </KomPage>
  );
}
