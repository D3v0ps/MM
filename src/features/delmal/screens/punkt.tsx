"use client";
// Dialogen för en punkt i steg 1–2 under Progression och resultat (Karims beslut 2026-11-25: "istället för att skapa underlag så
// kan vi checka i boxarna som syns på skärmen direkt"). Rubriken är punkten. Delmålen som räknas mot punkten står med sitt läge
// (text och ikon, aldrig bara färg); de uppnådda är ikryssade. Coachen kryssar i det som är uppnått, med datum och frivilligt
// underlag – samma fält och samma kommando som Markera uppnått på kortet Delmål (delmal.uppnatt, ett per delmål). Ett kryss som tas
// bort är Ångra (delmal.angra) med samma val som där: Tränar eller Inte påbörjat. Bara en människa sätter Uppnått – aldrig AI eller
// systemet (CLAUDE.md punkt 5). Bara för den som får markera delmål; kommunen ser aldrig delmålen.
import { useState } from "react";
import { useCommand } from "@/shell/backend";
import { achievedOnProblem } from "@/core/progress-goals";
import { Button, Check, Modal, ModalCancelButton, Notice, Stack, toast } from "@/ui";
import type { StepItemGoalView } from "@/features/bonus/api";
import { goalAchieve, goalUndo } from "../api";
import { AchieveFields, evidenceOf, GoalStateBadge, NO_EVIDENCE_VALUE, UndoTargetField } from "./kort-delmal";

export type StepItemModalProps = {
  caseId: string;
  /** Punkten, till exempel "Förbättrade ansökningshandlingar" – dialogens rubrik. */
  label: string;
  /** Delmålen med dagens läge – från den senaste frågan, så att dialogen följer med när kortet räknas om under sparningen. */
  options: readonly StepItemGoalView[];
  today: string;
  minDate: string | null;
  /** Förvald dag: i dag, eller slutdatumet i en avslutad insats (den senaste dagen som räknas mot punkterna). */
  defaultDate: string;
  onClose: () => void;
};

export function StepItemModal({ caseId, label, options, today, minDate, defaultDate, onClose }: StepItemModalProps) {
  const achieve = useCommand(goalAchieve);
  const undo = useCommand(goalUndo);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(options.filter((g) => g.state === "achieved").map((g) => g.goalId)));
  const [on, setOn] = useState(defaultDate);
  const [evidence, setEvidence] = useState(NO_EVIDENCE_VALUE);
  const [to, setTo] = useState<"training" | "none">("training");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toAchieve = options.filter((g) => checked.has(g.goalId) && g.state !== "achieved");
  const toUndo = options.filter((g) => !checked.has(g.goalId) && g.state === "achieved");
  const toggle = (goalId: string, yes: boolean) => {
    const next = new Set(checked);
    if (yes) next.add(goalId);
    else next.delete(goalId);
    setChecked(next);
  };
  const submit = async () => {
    if (saving) return;
    setError(null);
    if (!toAchieve.length && !toUndo.length) return onClose();
    // Dagen prövas innan något sparas (samma regel som servern), så att ett fel datum aldrig sparar en del av valen.
    const problem = toAchieve.length ? achievedOnProblem(on, minDate, today) : null;
    if (problem) return setError(problem);
    setSaving(true);
    let suggested = 0;
    try {
      // Först Uppnått, sedan Ångra. "Redan uppnått" och "inte uppnått" betyder att någon hann före – läget är redan det valda.
      for (const g of toAchieve) {
        const res = await achieve.run({ caseId, goalId: g.goalId, achievedOn: on, evidence: evidenceOf(evidence) }).catch(() => null);
        if (!res) return setError("Det gick inte att spara. Försök igen.");
        if (!res.ok && res.error !== "already") return setError(res.message || "Det gick inte att spara.");
        if (res.ok) suggested += res.suggested;
      }
      for (const g of toUndo) {
        const res = await undo.run({ caseId, goalId: g.goalId, to }).catch(() => null);
        if (!res) return setError("Det gick inte att spara. Försök igen.");
        if (!res.ok && res.error !== "not_achieved") return setError(res.message || "Det gick inte att spara.");
      }
    } finally {
      setSaving(false);
    }
    toast(`${label}: sparat.${suggested ? " Ett nytt förslag finns att granska." : ""}`);
    onClose();
  };
  return (
    <Modal
      title={label}
      onClose={onClose}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={saving || achieve.pending || undo.pending} onClick={() => void submit()}>
            Spara
          </Button>
        </>
      }
    >
      <Stack gap="sm">
        <fieldset className="m-0 min-w-0 border-0 p-0" data-testid="punkt-delmal">
          <legend className="mb-1 p-0 text-ui font-bold">Delmål</legend>
          <ul className="m-0 flex list-none flex-col p-0">
            {options.map((g) => (
              <li key={g.goalId} className="flex flex-wrap items-center justify-between gap-x-3 border-b border-ljusgra last:border-b-0" data-punkt-delmal={g.goalId}>
                <Check id={`punkt-delmal-${g.goalId}`} checked={checked.has(g.goalId)} onCheckedChange={(yes) => toggle(g.goalId, yes)} className="min-w-0 flex-1">
                  {g.label}
                </Check>
                <GoalStateBadge g={g} />
              </li>
            ))}
          </ul>
        </fieldset>
        <AchieveFields caseId={caseId} on={on} onOnChange={setOn} evidence={evidence} onEvidenceChange={setEvidence} idPrefix="punkt" />
        {toUndo.length > 0 && <UndoTargetField id="punkt-angra" label="Ångra uppnått – ändra till" value={to} onChange={setTo} />}
        {error && <Notice tone="critical" title="Det gick inte">{error}</Notice>}
      </Stack>
    </Modal>
  );
}
