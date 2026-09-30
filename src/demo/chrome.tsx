"use client";
// Prototypfältet – port av den gamla prototypens ProtoBar (prototyp/src/99-shell.js) och ScenarioBar
// (prototyp/src/90-feedback.js), plus feedbackknappen och feedbacklådan. Finns bara i prototypen: riktiga appen
// har inloggning i stället för rollväljare, och ingen feedback eller demoklocka.
import { useState } from "react";
import { perspectiveOf, type Perspective, type Role } from "@/api/roles";
import { sessionPing } from "@/features/session/api";
import { fmtTime, fmtWeek, fmtWeekday } from "@/core/time";
import { useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { START_PATH, type RouteDef } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Seg } from "@/ui/form";
import { Icon } from "@/ui/icons";
import { Dot } from "@/ui/layout";
import { toast } from "@/ui/toast";
import { useGoAs, useScenarioActions } from "./demo-nav";
import { FeedbackDrawer, FeedbackFab } from "./feedback";
import { markStep, openFeedback, useFeedback } from "./feedback-store";
import { demoRole, PERSPECTIVE_PHRASE, PERSPECTIVES, perspectiveDef } from "./roles";
import { scenarioById, scenarioNumber } from "./scenarios";
import { useScenarioState } from "./scenario-store";

/** Knappar i prototypfältet: lite mindre text och utfyllnad, men minst 44 px höga (CLAUDE.md). */
const BAR_BTN = "px-3 py-1.5 text-small";

export function PrototypeChrome({ routes, onReset }: { routes: readonly RouteDef[]; onReset: () => void }) {
  return (
    <>
      <a
        href="#main"
        className="absolute -top-20 left-3 z-100 rounded-mb bg-antracit px-4 py-3 font-bold text-vit no-underline focus:top-[calc(env(safe-area-inset-top,0px)+8px)] focus:outline-3 focus:outline-rod"
        onClick={(e) => {
          // Hash-navigeringen får inte ändras – flytta bara fokus.
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Hoppa förbi prototypfältet
      </a>
      <div data-print="hide" className="sticky top-[env(safe-area-inset-top,0px)] z-40 max-[900px]:static">
        <ProtoBar onReset={onReset} />
        <ScenarioBar />
      </div>
      <FeedbackFab />
      <FeedbackDrawer routes={routes} />
    </>
  );
}

// ---------------------------------------------------------------- Prototypfältet
function ProtoBar({ onReset }: { onReset: () => void }) {
  const session = useSession();
  const nav = useNav();
  const goAs = useGoAs();
  const f = useFeedback();
  const [confirmReset, setConfirmReset] = useState(false);
  const role = session.actor.role;
  const pDef = perspectiveDef(role);
  const now = useQuery(sessionPing, {}).data?.now;
  const open = f.items.filter((x) => x.status === "ny").length;
  const personName = (personaId: string | null) => (personaId ? session.personas?.find((p) => p.userId === personaId)?.name : undefined);

  const switchPerspective = (key: Perspective) => {
    if (key === pDef.key) return;
    const next = PERSPECTIVES.find((p) => p.key === key)!.defaultRole;
    goAs(next, START_PATH[next]);
    toast(`Du ser nu prototypen som ${demoRole(next).label.toLowerCase()} (${PERSPECTIVE_PHRASE[perspectiveOf(next)]}).`);
  };

  return (
    <header
      aria-label="Prototypens verktyg"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-dashed border-line-strong bg-vit px-4 py-2 text-small max-[900px]:gap-x-2 max-[900px]:gap-y-1.5 max-[900px]:px-3 max-[900px]:py-1.5"
    >
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border-2 border-antracit px-2 py-1 text-label font-extrabold tracking-[0.1em] uppercase">
        <Dot />
        Prototyp
      </span>
      <Seg<Perspective>
        ariaLabel="Perspektiv"
        value={pDef.key}
        onValueChange={switchPerspective}
        options={PERSPECTIVES.map((p) => ({ value: p.key, label: p.label, icon: p.icon }))}
      />
      {pDef.roles.length > 1 && (
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="role-select" className="font-bold">
            Roll
          </label>
          <select
            id="role-select"
            value={role}
            onChange={(e) => {
              const r = e.target.value as Role;
              goAs(r, START_PATH[r]);
            }}
            className="w-auto max-w-full text-[0.9375rem] font-semibold"
          >
            {pDef.roles.map((r) => {
              const def = demoRole(r);
              const name = personName(def.personaId);
              return (
                <option key={r} value={r}>
                  {def.label}
                  {name ? ` – ${name}` : ""}
                </option>
              );
            })}
          </select>
        </div>
      )}
      {now && (
        <span className="inline-flex items-center gap-1 text-text-muted max-[720px]:hidden">
          <Icon name="clock" /> Demodatum {fmtWeekday(now)} {now.slice(0, 4)} kl. {fmtTime(now)} · {fmtWeek(now)}
        </span>
      )}
      <span className="flex-1" />
      <Button kind="ghost" icon="home" ariaLabel="Start och scenarier" className={BAR_BTN} onClick={() => nav.push("/om")}>
        <span className="max-[720px]:hidden">Start och scenarier</span>
      </Button>
      <Button icon="message-circle" className={BAR_BTN} onClick={() => nav.push("/om/genomgang")}>
        Genomgång{open ? ` (${open} nya)` : ""}
      </Button>
      {confirmReset ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold">Ta bort allt du gjort?</span>
          <Button
            kind="danger"
            icon="reset"
            className={BAR_BTN}
            onClick={() => {
              setConfirmReset(false);
              onReset();
            }}
          >
            Ja, återställ
          </Button>
          <Button kind="ghost" className={BAR_BTN} onClick={() => setConfirmReset(false)}>
            Avbryt
          </Button>
        </span>
      ) : (
        <Button kind="ghost" icon="reset" title="Återställ demodata" ariaLabel="Återställ demodata" className={BAR_BTN} onClick={() => setConfirmReset(true)}>
          <span className="max-[720px]:hidden">Återställ</span>
        </Button>
      )}
    </header>
  );
}

// ---------------------------------------------------------------- Scenariofältet (under prototypfältet)
const ON_DARK = "min-h-11 border-transparent bg-vit text-antracit hover:not-disabled:bg-vit/90";

function ScenarioBar() {
  const s = useScenarioState();
  const f = useFeedback();
  const { gotoStep, stop } = useScenarioActions();
  const def = scenarioById(s.active);
  if (!s.active || !def) return null;
  const step = Math.max(0, Math.min(def.steps.length - 1, s.step));
  const st = def.steps[step];
  const done = !!f.progress[`${def.id}:${step}`];
  const persp = perspectiveOf(st.role);
  const perspLabel = PERSPECTIVES.find((p) => p.key === persp)!.label;
  return (
    <div role="region" aria-label="Pågående testscenario" className="bg-antracit px-4 py-2.5 text-vit [--mm-focus:var(--color-vit)]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-0.5">
          <div className="text-small font-bold tracking-[0.06em] text-vit/80 uppercase">
            Scenario {scenarioNumber(def.id)}: {def.title} · steg {step + 1} av {def.steps.length} ·{" "}
            <Badge tone={persp === "kund" ? "blue" : persp === "deltagare" ? "grey" : "dark"} className="border-vit">
              {perspLabel}: {demoRole(st.role).label}
            </Badge>
          </div>
          <div className="text-[0.9375rem]">{st.text}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button icon="chevron-left" className="border-vit bg-transparent text-vit hover:not-disabled:bg-vit/10" disabled={step === 0} onClick={() => gotoStep(def.id, step - 1)}>
            Föregående
          </Button>
          <Button icon={done ? "check-square" : "square"} ariaPressed={done} className={cn(ON_DARK, done && "bg-bla hover:not-disabled:bg-bla")} onClick={() => void markStep(def.id, step, !done)}>
            Testat
          </Button>
          {step < def.steps.length - 1 ? (
            <Button iconRight="chevron-right" className={ON_DARK} onClick={() => gotoStep(def.id, step + 1)}>
              Nästa steg
            </Button>
          ) : (
            <Button icon="message-circle" className={ON_DARK} onClick={() => openFeedback({ scenarioId: def.id })}>
              Feedback på scenariot
            </Button>
          )}
          <Button kind="ghost" icon="x" title="Avsluta scenariot" ariaLabel="Avsluta scenariot" className="text-vit hover:not-disabled:bg-vit/10" onClick={stop} />
        </div>
      </div>
    </div>
  );
}
