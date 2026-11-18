"use client";
// Kortet Delmål på deltagarkortet (fliken Händelser och utfall, Progression och resultat – Karims beslut 2026-11-11): avtalets
// delmål per progressionsområde med läget som text och ikon (aldrig bara färg): Inte påbörjat, Tränar (automatiskt) eller Uppnått
// med datum. Markera uppnått (bara en människa – aldrig AI) med datum och frivilligt underlag, och Ångra (tillbaka till Tränar
// eller Inte påbörjat). Bara Miljonbemanning – kommunen ser aldrig delmålen.
import { useEffect, useState } from "react";
import { useCommand, useQuery, useQueryRunner } from "@/shell/backend";
import {
  Badge, Button, Card, DateInput, ErrorNotice, Field, FormGrid, List, ListItem, Loading, Modal, ModalCancelButton, Notice, Seg, Select, Stack, toast, type BadgeTone,
} from "@/ui";
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

function AchieveModal({ v, g, onClose }: { v: View; g: CaseGoalRowView; onClose: () => void }) {
  const cmd = useCommand(goalAchieve);
  const [on, setOn] = useState(v.today);
  const [evidence, setEvidence] = useState(NO_EVIDENCE);
  const [error, setError] = useState<string | null>(null);
  // Underlaget hämtas färskt när dialogen öppnas (ingen cache): ärendets senaste tillfällen, mötesrapporter och anteckningar.
  const runQuery = useQueryRunner();
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    runQuery(goalEvidence, { caseId: v.caseId }).then((x) => alive && setOptions(x)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runQuery, v.caseId]);
  const submit = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return setError("Välj datum.");
    const [kind, ...rest] = evidence === NO_EVIDENCE ? [] : evidence.split(":");
    const ev = kind ? ({ kind, id: rest.join(":") } as EvidenceInput) : null;
    const res = await cmd.run({ caseId: v.caseId, goalId: g.goalId, achievedOn: on, evidence: ev }).catch(() => null);
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
        <FormGrid>
          <Field id="delmal-datum" label="Datum" required>
            <DateInput value={on} onValueChange={setOn} />
          </Field>
          <Field id="delmal-underlag" label="Underlag">
            <Select value={evidence} onValueChange={setEvidence} options={[{ value: NO_EVIDENCE, label: "Inget underlag" }, ...options]} />
          </Field>
        </FormGrid>
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
        <Field id="delmal-angra" label="Ändra till">
          <Seg
            value={to}
            onValueChange={(x) => setTo(x)}
            options={[{ value: "training", label: "Tränar", icon: "activity" }, { value: "none", label: "Inte påbörjat", icon: "circle" }]}
          />
        </Field>
        {error && <Notice tone="critical" title="Det gick inte">{error}</Notice>}
      </Stack>
    </Modal>
  );
}
