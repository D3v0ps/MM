"use client";
// Prototypens startsida (/om) – port av den gamla prototypens vy om.start (prototyp/src/90-feedback.js).
import { useNav } from "@/shell/nav";
import { START_PATH } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Section, Card } from "@/ui/page";
import { Divider, Eyebrow, Grid, Split } from "@/ui/layout";
import { Icon } from "@/ui/icons";
import { useGoAs, useScenarioActions } from "../demo-nav";
import { openFeedback, useFeedback } from "../feedback-store";
import { DEMO_ROLES, type DemoRoleDef } from "../roles";
import { SCENARIOS, scenarioPerspectives, TOTAL_STEPS } from "../scenarios";

const PAGE = "mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-8 pt-7 pb-24 max-[900px]:px-4 max-[900px]:pt-5";
const ROLE_GRID = "grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] [&>*]:min-w-0";
const PERSP_LABEL = { leverantor: "Leverantör", kund: "Kund", deltagare: "Deltagare" } as const;

function RoleCard({ r }: { r: DemoRoleDef }) {
  const goAs = useGoAs();
  const session = useSession();
  const name = r.personaId ? session.personas?.find((p) => p.userId === r.personaId)?.name : undefined;
  return (
    <button
      type="button"
      onClick={() => goAs(r.key, START_PATH[r.key])}
      className="flex min-h-full cursor-pointer flex-col gap-2 rounded-card border-[1.5px] border-ljusgra bg-vit p-4 text-left text-antracit [font:inherit] hover:border-antracit"
    >
      <span className="flex items-center gap-2 font-extrabold">
        <Icon name={r.icon} />
        {r.label}
      </span>
      <span className="text-small text-text-muted">
        {name ? `${name} · ` : ""}
        {r.desc}
      </span>
    </button>
  );
}

function ScenarioList() {
  const f = useFeedback();
  const { start } = useScenarioActions();
  return (
    <Grid>
      {SCENARIOS.map((s, i) => {
        const done = s.steps.filter((_, j) => f.progress[`${s.id}:${j}`]).length;
        return (
          <Card key={s.id} bodyClassName="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Eyebrow>
                Scenario {i + 1} · {s.steps.length} steg
              </Eyebrow>
              {done > 0 && (
                <Badge tone={done === s.steps.length ? "blue" : "outline"} icon="check">
                  {done}/{s.steps.length} testade
                </Badge>
              )}
            </div>
            <h3 className="text-h3 font-bold">{s.title}</h3>
            <p className="text-small text-text-muted">{s.lead}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {scenarioPerspectives(s).map((p) => (
                <Badge key={p} tone={p === "kund" ? "bluetone" : p === "deltagare" ? "grey" : "outline"}>
                  {PERSP_LABEL[p]}
                </Badge>
              ))}
            </div>
            <div>
              <Button kind="primary" icon="play" ariaLabel={`Starta scenario ${i + 1}: ${s.title}`} onClick={() => start(s.id)}>
                Starta
              </Button>
            </div>
          </Card>
        );
      })}
    </Grid>
  );
}

const PHASES: [string, string, string][] = [
  ["1", "Leverera avtalet", "Inloggning och roller, mejlavrop och portal, ärendenummer, närvaro och veckorapport, möten, månadsbedömning, rapporter, fakturaunderlag, deadlines, revisionslogg."],
  ["2", "AI och automatisk fakturering", "Inspelning med samtycke, AI-förslag med belägg, Fortnox-API, pulsmätning, resultatflaggor, register för avtalsavvikelser."],
  ["3", "Mervärde", "Bonusanspråk, yrkeskompetensbevis, arbetsgivarregister och praktik med de fyra rätten, statistik och dataexport."],
  ["4", "Fler kommunavtal", "Nästa kommunavtal som konfiguration, kapacitetsvy, exportmallar per avtal, deltagarinloggning."],
];

export function OmStartScreen() {
  const f = useFeedback();
  const nav = useNav();
  const { start } = useScenarioActions();
  const byOrg = (org: DemoRoleDef["org"]) => DEMO_ROLES.filter((r) => r.org === org);
  const doneSteps = Object.values(f.progress).filter(Boolean).length;
  const roleGrid = (roles: DemoRoleDef[]) => (
    <div className={ROLE_GRID}>
      {roles.map((r) => (
        <RoleCard key={r.key} r={r} />
      ))}
    </div>
  );
  return (
    <div className={PAGE}>
      <section className="flex flex-col gap-3.5 rounded-card bg-antracit p-7 text-vit [--mm-focus:var(--color-vit)] max-[620px]:p-5">
        <Eyebrow className="text-vit/80">Klickbar prototyp · påhittade testdata</Eyebrow>
        <h1 tabIndex={-1} data-page-title="" className="flex items-center gap-2.5 text-[2rem] leading-[1.25] font-extrabold tracking-[0.04em] uppercase">
          <span aria-hidden="true" className="inline-block size-[0.5em] shrink-0 rounded-full bg-rod-logo" />
          Miljonmatch
        </h1>
        <p className="max-w-[68ch] text-vit/88">
          Plattform för arbetsmarknadsinsatser. Avtal nr 1 är Botkyrka kommun (yrkesförberedande och yrkesinriktade insatser). Prototypen visar samma ärenden från två håll:{" "}
          <b>leverantören Miljonbemanning</b> och <b>kunden Botkyrka kommun</b>.
        </p>
        <p className="max-w-[68ch] text-small text-vit/88">
          Demodatum: måndag 1 februari 2027 kl. 09.12 – fem månader in i piloten, så att det finns rapporter, fakturor och nyckeltal att titta på. Inga riktiga personer eller personnummer finns i prototypen.
        </p>
        <p className="max-w-[68ch] text-small text-vit/88">
          Prototypen är byggd av samma kod som den riktiga tjänsten: samma sidor, regler och behörigheter. Det som skiljer är att uppgifterna är påhittade och sparas i din webbläsare, och att du byter roll i fältet högst upp i stället för att logga in.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="primary" size="lg" icon="play" className="bg-vit text-antracit" onClick={() => start("s1")}>
            Starta första testscenariot
          </Button>
          <Button size="lg" icon="message-circle" className="border-vit bg-transparent text-vit hover:not-disabled:bg-vit/10" onClick={() => openFeedback()}>
            Lämna feedback
          </Button>
        </div>
      </section>

      <Split>
        <Card title="Leverantörens perspektiv – Miljonbemanning" icon="briefcase">
          <p className="mb-3 text-text-muted">Så arbetar vi: avrop, coachning, rapporter, uppföljning och fakturering.</p>
          {roleGrid(byOrg("mb"))}
        </Card>
        <Card title="Kundens perspektiv – Botkyrka kommun" icon="building">
          <p className="mb-3 text-text-muted">
            Så upplever kommunen tjänsten: beställning, rapporter, meddelanden och uppföljning. Portalen är skriven för ovana användare.
          </p>
          {roleGrid(byOrg("customer"))}
          <Divider className="my-4" />
          <Eyebrow className="mb-2">Deltagarens perspektiv</Eyebrow>
          {roleGrid(byOrg("participant"))}
        </Card>
      </Split>

      <Card title="Nytt sedan SPEC v0.2" icon="bell" tone="blue">
        <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
          <li>
            <b>Notis vid tilldelning:</b> coach och team får notis i appen och e-post (utan personuppgifter) när ett ärende tilldelas eller coach byts.
          </li>
          <li>
            <b>Automatisk påminnelse:</b> en vecka utan progression (veckomålet inte uppnått eller ingen godkänd mötesrapport) ger påminnelse till coachen.
          </li>
          <li>
            <b>Tidig eskalering:</b> två veckor i rad utan progression eskaleras till chef/controller.
          </li>
          <li>
            <b>Behörighet:</b> varje notis har en mottagare. Coachen ser inte att en eskalering gått till chefen.
          </li>
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button icon="play" onClick={() => start("s13")}>
            Testa scenariot
          </Button>
        </div>
      </Card>

      <Section title="Så lämnar du feedback">
        <Grid cols={3}>
          {[
            ["1", "Testa ett scenario eller klicka runt fritt", "Byt roll och perspektiv i fältet högst upp. Allt du gör sparas i din webbläsare och kan återställas."],
            ["2", "Klicka på Feedback", "Knappen finns alltid nere till höger. Vyn, rollen och perspektivet fylls i automatiskt."],
            ["3", "Vi går igenom listan tillsammans", "All feedback samlas på ett ställe med status: Ny, Att diskutera, Ska ändras, Klar eller Avfärdad."],
          ].map(([n, t, x]) => (
            <Card key={n} bodyClassName="flex flex-col gap-2">
              <Eyebrow>{n}</Eyebrow>
              <div className="font-bold">{t}</div>
              <div className="text-small text-text-muted">{x}</div>
            </Card>
          ))}
        </Grid>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-small text-text-muted">{f.mode === "shared" ? `${f.items.length} feedbackpunkter hittills` : "Feedbacken sparas lokalt i den här förhandsvisningen"}</span>
          <Button kind="ghost" icon="list" onClick={() => nav.push("/om/genomgang")}>
            Öppna genomgången av feedback
          </Button>
        </div>
      </Section>

      <Section title={`Testscenarier (${doneSteps} av ${TOTAL_STEPS} steg testade)`}>
        <p className="text-text-muted">Varje scenario guidar dig steg för steg och byter roll åt dig. Flera av dem följer samma ärende från leverantören till kunden och tillbaka.</p>
        <ScenarioList />
      </Section>

      <Section title="Vad byggs när (SPEC §12)">
        <Grid cols={4}>
          {PHASES.map(([n, t, x]) => (
            <Card key={n} bodyClassName="flex flex-col gap-2">
              <Badge tone={n === "1" ? "dark" : "plan"}>Fas {n}</Badge>
              <div className="font-bold">{t}</div>
              <div className="text-small text-text-muted">{x}</div>
            </Card>
          ))}
        </Grid>
        <p className="text-small text-text-muted">Funktioner som byggs efter fas 1 är märkta med en streckad etikett &quot;Byggs i fas 2&quot; osv. i prototypen.</p>
        <div>
          <Button icon="help" onClick={() => nav.push("/om/fragor")}>
            Öppna frågor till Botkyrka
          </Button>
        </div>
      </Section>
    </div>
  );
}
