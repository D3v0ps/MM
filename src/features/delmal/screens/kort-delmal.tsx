"use client";
// Kortet Delmål på deltagarkortet (egen flik Delmål sedan Karims beslut 2026-11-25; delmålen Karims beslut 2026-11-11): avtalets
// delmål per progressionsområde med läget som text och ikon (aldrig bara färg): Inte påbörjat, Tränar (automatiskt) eller Uppnått
// med datum. Markera uppnått (bara en människa – aldrig AI) med datum och frivilligt underlag, och Ångra (tillbaka till Tränar
// eller Inte påbörjat). Bara Miljonbemanning – kommunen ser aldrig delmålen.
import { useEffect, useState } from "react";
import { useCommand, useQuery, useQueryRunner } from "@/shell/backend";
import {
  Badge, Button, Card, DateInput, ErrorNotice, Field, FormGrid, List, ListItem, Loading, Modal, ModalCancelButton, Notice, Seg, Select, Stack, toast, type BadgeTone,
} from "@/ui";
import { achievedOnProblem } from "@/core/progress-goals";
import { caseGoals, goalAchieve, goalEvidence, goalUndo, type CaseGoalRowView, type CaseGoalsView, type EvidenceInput } from "../api";

const TONE: Record<CaseGoalRowView["state"], BadgeTone> = { none: "outline", training: "grey", achieved: "blue" };

export function GoalStateBadge({ g }: { g: Pick<CaseGoalRowView, "state" | "stateText" | "icon"> }) {
  return (
    <Badge tone={TONE[g.state]} icon={g.icon}>
      {g.stateText}
    </Badge>
  );
}

export function DelmalCard({ caseId }: { caseId: string }) {
  const q = useQuery(caseGoals, { caseId });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  if (!q.data.on || !q.data.areas.length) return null;
  return <DelmalContent v={q.data} />;
}

type View = Extract<CaseGoalsView, { on: true }>;

function DelmalContent({ v }: { v: View }) {
  const [achieving, setAchieving] = useState<CaseGoalRowView | null>(null);
  const [undoing, setUndoing] = useState<CaseGoalRowView | null>(null);
  return (
    <Card title="Delmål" icon="target" flush>
      <Stack gap="sm">
        {v.areas.map((a) => (
          <section key={a.key} aria-labelledby={`delmal-${a.key}`} className="flex flex-col">
            <h3 id={`delmal-${a.key}`} className="m-0 px-[18px] pt-3 text-small font-extrabold tracking-[0.08em] text-text-muted uppercase">
              {a.label}
            </h3>
            <List>
              {a.goals.map((g) => (
                <ListItem key={g.goalId} title={g.label} data-delmal={g.goalId}>
                  <span className="flex flex-wrap items-center gap-2">
                    <GoalStateBadge g={g} />
                    {g.evidenceLabel && <span className="text-small" data-delmal-underlag>{g.evidenceLabel}</span>}
                    {v.canEdit && g.state !== "achieved" && !(g.inactive && g.state === "none") && (
                      <Button kind="secondary" icon="check" onClick={() => setAchieving(g)}>
                        Markera uppnått<span className="sr-only"> – {g.label}</span>
                      </Button>
                    )}
                    {v.canEdit && g.state === "achieved" && (
                      <Button kind="ghost" icon="reset" onClick={() => setUndoing(g)}>
                        Ångra<span className="sr-only"> – {g.label}</span>
                      </Button>
                    )}
                  </span>
                </ListItem>
              ))}
            </List>
          </section>
        ))}
      </Stack>
      {achieving && <AchieveModal v={v} g={achieving} onClose={() => setAchieving(null)} />}
      {undoing && <UndoModal v={v} g={undoing} onClose={() => setUndoing(null)} />}
    </Card>
  );
}

const NO_EVIDENCE = "inget";
/** Valt underlag ("activity:<id>", "check_in:<id>", "case_note:<id>" eller inget) som kommandots evidence. */
export function evidenceOf(value: string): EvidenceInput | null {
  if (value === NO_EVIDENCE) return null;
  const [kind, ...rest] = value.split(":");
  return kind ? ({ kind, id: rest.join(":") } as EvidenceInput) : null;
}

/** Underlaget att välja vid Uppnått – hämtas färskt när dialogen öppnas (ingen cache): ärendets senaste tillfällen, mötesrapporter och anteckningar. */
function useGoalEvidence(caseId: string): { value: string; label: string }[] {
  const runQuery = useQueryRunner();
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    runQuery(goalEvidence, { caseId }).then((x) => alive && setOptions(x)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runQuery, caseId]);
  return options;
}

/**
 * Datum och underlag för Uppnått – samma fält i Markera uppnått (kortet Delmål) och i dialogen för en punkt i steg 1–2 under
 * Progression och resultat (Karims beslut 2026-11-25). Datumet är förvalt i dag; underlaget är frivilligt.
 */
export function AchieveFields({ caseId, on, onOnChange, evidence, onEvidenceChange, idPrefix = "delmal" }: {
  caseId: string;
  on: string;
  onOnChange: (v: string) => void;
  evidence: string;
  onEvidenceChange: (v: string) => void;
  idPrefix?: string;
}) {
  const options = useGoalEvidence(caseId);
  return (
    <FormGrid>
      <Field id={`${idPrefix}-datum`} label="Datum" required>
        <DateInput value={on} onValueChange={onOnChange} />
      </Field>
      <Field id={`${idPrefix}-underlag`} label="Underlag">
        <Select value={evidence} onValueChange={onEvidenceChange} options={[{ value: NO_EVIDENCE, label: "Inget underlag" }, ...options]} />
      </Field>
    </FormGrid>
  );
}
/** Förvalt underlag: inget. */
export const NO_EVIDENCE_VALUE = NO_EVIDENCE;

/** Ångra Uppnått: tillbaka till Tränar eller Inte påbörjat – samma val i Ångra (kortet Delmål) och i dialogen för en punkt. */
export function UndoTargetField({ value, onChange, id = "delmal-angra", label = "Ändra till" }: { value: "training" | "none"; onChange: (v: "training" | "none") => void; id?: string; label?: string }) {
  return (
    <Field id={id} label={label}>
      <Seg
        value={value}
        onValueChange={(x) => onChange(x)}
        options={[{ value: "training", label: "Tränar", icon: "activity" }, { value: "none", label: "Inte påbörjat", icon: "circle" }]}
      />
    </Field>
  );
}

function AchieveModal({ v, g, onClose }: { v: View; g: CaseGoalRowView; onClose: () => void }) {
  const cmd = useCommand(goalAchieve);
  const [on, setOn] = useState(v.today);
  const [evidence, setEvidence] = useState(NO_EVIDENCE);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    const problem = achievedOnProblem(on, v.minDate, v.today);
    if (problem) return setError(problem);
    const res = await cmd.run({ caseId: v.caseId, goalId: g.goalId, achievedOn: on, evidence: evidenceOf(evidence) }).catch(() => null);
    if (!res) return setError("Det gick inte att spara. Försök igen.");
    if (!res.ok) return setError(res.message || "Det gick inte att spara.");
    toast(`${g.label}: uppnått.${res.suggested ? " Ett nytt förslag finns under Progression och resultat." : ""}`);
    onClose();
  };
  return (
    <Modal
      title="Markera uppnått"
      onClose={onClose}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={cmd.pending} onClick={() => void submit()}>
            Markera uppnått
          </Button>
        </>
      }
    >
      <Stack gap="sm">
        <p className="m-0 font-bold">{g.label}</p>
        <AchieveFields caseId={v.caseId} on={on} onOnChange={setOn} evidence={evidence} onEvidenceChange={setEvidence} />
        {error && <Notice tone="critical" title="Det gick inte">{error}</Notice>}
      </Stack>
    </Modal>
  );
}

function UndoModal({ v, g, onClose }: { v: View; g: CaseGoalRowView; onClose: () => void }) {
  const cmd = useCommand(goalUndo);
  const [to, setTo] = useState<"training" | "none">("training");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    const res = await cmd.run({ caseId: v.caseId, goalId: g.goalId, to }).catch(() => null);
    if (!res) return setError("Det gick inte att spara. Försök igen.");
    if (!res.ok) return setError(res.message || "Det gick inte att spara.");
    toast(`${g.label}: ${to === "training" ? "tränar" : "inte påbörjat"}.`);
    onClose();
  };
  return (
    <Modal
      title="Ångra uppnått"
      onClose={onClose}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="reset" pending={cmd.pending} onClick={() => void submit()}>
            Ångra
          </Button>
        </>
      }
    >
      <Stack gap="sm">
        <p className="m-0 font-bold">{g.label}</p>
        <UndoTargetField value={to} onChange={setTo} />
        {error && <Notice tone="critical" title="Det gick inte">{error}</Notice>}
      </Stack>
    </Modal>
  );
}
