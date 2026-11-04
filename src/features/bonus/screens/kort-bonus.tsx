"use client";
// Kortet Bonus på deltagarkortet (fliken Händelser och utfall, SPEC §7.17, beslut 2026-11-04): bonussteg 1–5 med läget som text
// och ikon (aldrig bara färg), länk till Granska och skicka och knappen Skapa bonusanspråk. Inga belopp – bara ekonomen ser belopp.
// Visas inte när bonus är avstängd i avtalet eller för den som inte får se bonus (begränsade testare, teamet).
import { useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { fmtDate } from "@/core/time";
import { Badge, Button, Card, Disclosure, ErrorNotice, List, ListItem, Loading, Modal, ModalCancelButton, Notice, Select, Field, toast, type BadgeTone } from "@/ui";
import { bonusCard, bonusCreate, type BonusCardView, type BonusStepRow } from "../api";

/** Märkets ton per läge – texten och ikonen bär informationen (blå som yta med antracit text, aldrig grönt). */
export const BONUS_BADGE_TONE: Record<BonusStepRow["status"], BadgeTone> = {
  none: "outline", suggested: "plan", submitted: "grey", approved: "blue", rejected: "red", withdrawn: "outline",
};

/** Läget med ikon och text. */
export function BonusStatusBadge({ status, text, icon }: { status: BonusStepRow["status"]; text: string; icon: BonusStepRow["icon"] }) {
  return (
    <Badge tone={BONUS_BADGE_TONE[status]} icon={icon}>
      {text}
    </Badge>
  );
}

export const bonusPath = (claimId: string) => `/bonus/${encodeURIComponent(claimId)}`;

export function BonusCard({ caseId }: { caseId: string }) {
  const q = useQuery(bonusCard, { caseId });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  const v = q.data;
  if (!v.on) return null;
  return <BonusCardContent v={v} />;
}

function BonusCardContent({ v }: { v: Extract<BonusCardView, { on: true }> }) {
  const [create, setCreate] = useState(false);
  const creatable = v.steps.filter((s) => s.canCreate);
  return (
    <Card
      title="Bonus"
      icon="award"
      flush
      actions={v.canAct && creatable.length > 0 ? <Button icon="plus" onClick={() => setCreate(true)}>Skapa bonusanspråk</Button> : undefined}
      foot={
        <Disclosure label="Så fungerar bonusstegen">
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-small">
            {v.rules.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <p className="mt-2 text-small text-text-muted">
            Ett förslag skapas av reglerna eller av dig. Du granskar och skickar – kommunen beslutar i portalen. Kommunen ser bara det du har skickat, aldrig förslag eller
            återtagna anspråk. Inga intyg laddas upp här: de skickas till kommunen på annat sätt.
          </p>
        </Disclosure>
      }
    >
      <List>
        {v.steps.map((s) => (
          <ListItem
            key={s.step}
            lead={<span className="inline-flex size-9 items-center justify-center rounded-full border-[1.5px] border-antracit font-extrabold" aria-hidden="true">{s.step}</span>}
            title={`Bonussteg ${s.step} · ${s.label}`}
            sub={
              s.status === "none"
                ? s.createProblem && v.canAct ? s.createProblem : "Inget anspråk än."
                : [
                  s.reachedOn ? `Resultatdatum ${fmtDate(s.reachedOn)}` : null,
                  s.submittedAt ? `skickat ${fmtDate(s.submittedAt)}` : null,
                  s.decidedAt ? `beslut ${fmtDate(s.decidedAt)}` : null,
                  s.source === "auto" ? "förslag från reglerna" : s.source === "manual" ? "skapat av Miljonbemanning" : null,
                ].filter(Boolean).join(" · ")
            }
          >
            <span className="flex flex-wrap items-center gap-2">
              <BonusStatusBadge status={s.status} text={s.statusText} icon={s.icon} />
              {s.claimId && (
                <Button kind={s.status === "suggested" && v.canAct ? "secondary" : "ghost"} iconRight="arrow-right" to={bonusPath(s.claimId)}>
                  {s.status === "suggested" && v.canAct ? "Granska och skicka" : "Visa"}
                  <span className="sr-only"> bonussteg {s.step}</span>
                </Button>
              )}
            </span>
            {s.history.length > 0 && (
              <span className="text-small text-text-muted">
                Tidigare: {s.history.map((h) => `${h.statusText.toLowerCase()}${h.at ? ` ${fmtDate(h.at)}` : ""}`).join(", ")}
              </span>
            )}
          </ListItem>
        ))}
      </List>
      {create && <CreateModal caseId={v.caseId} steps={creatable} onClose={() => setCreate(false)} />}
    </Card>
  );
}

function CreateModal({ caseId, steps, onClose }: { caseId: string; steps: BonusStepRow[]; onClose: () => void }) {
  const cmd = useCommand(bonusCreate);
  const nav = useNav();
  const [step, setStep] = useState(String(steps[0]?.step ?? ""));
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    const res = await cmd.run({ caseId, step: Number(step) }).catch(() => null);
    if (!res) return setError("Anspråket kunde inte skapas. Försök igen.");
    if (!res.ok) return setError(res.message || "Anspråket kunde inte skapas.");
    toast(`Anspråket för bonussteg ${step} är skapat. Granska och skicka när underlaget är klart.`);
    onClose();
    nav.push(bonusPath(res.claimId));
  };
  return (
    <Modal
      title="Skapa bonusanspråk"
      onClose={onClose}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" pending={cmd.pending} onClick={() => void submit()}>
            Skapa
          </Button>
        </>
      }
    >
      <p className="m-0">Välj bonussteget. Anspråket blir ett förslag som du granskar innan det skickas till kommunen.</p>
      <Field label="Bonussteg" help="Bara steg som inte redan har ett anspråk. Bonussteg 4 och 5 bygger på bonussteg 3." id="bonus-skapa-steg">
        <Select value={step} onValueChange={setStep} options={steps.map((s) => ({ value: String(s.step), label: `Bonussteg ${s.step} · ${s.label}` }))} />
      </Field>
      {error && <Notice tone="critical" title="Det gick inte">{error}</Notice>}
    </Modal>
  );
}
