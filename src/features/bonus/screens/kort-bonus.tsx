"use client";
// Kortet Progression och resultat på deltagarkortet (fliken Progression och resultat, ?flik=handelser, SPEC §7.17, beslut 2026-11-04):
// steg 1–5 med läget som text och ikon (aldrig bara färg) och länken Granska och skicka. Inga belopp – bara ekonomen ser belopp.
// Karims beslut 2026-11-25: punkterna i steg 1–2 kryssas i direkt på kortet – en punkt öppnar en dialog med delmålen som räknas mot
// den (src/features/delmal/screens/punkt.tsx), och reglerna skapar förslaget när punkterna är uppfyllda. Ingen knapp i kortets huvud
// och ingen förklaring av stegen: Skapa underlag står bara på stegets rad där reglerna inte täcker det själva (manualCreateSteps).
// Visas inte när bonus är avstängd i avtalet eller för den som inte får se bonus (begränsade testare, teamet).
import { useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { fmtDate } from "@/core/time";
import { Badge, Button, Card, ErrorNotice, Icon, List, ListItem, Loading, toast, type BadgeTone } from "@/ui";
import { StepItemModal } from "@/features/delmal/screens/punkt";
import type { StepItem } from "@/data/schema";
import { bonusCard, bonusCreate, type BonusCardView, type BonusStepRow, type StepItemView } from "../api";

/** Punktens text: "Förbättrade ansökningshandlingar: Inte uppfyllt (1 av 2) – Har ett uppdaterat CV". */
const itemText = (it: StepItemView) =>
  `${it.fulfilled ? "Uppfyllt" : "Inte uppfyllt"}${!it.fulfilled && it.need > 1 ? ` (${it.goals.length} av ${it.need})` : ""}${it.goals.length ? ` – ${it.goals.join(", ")}` : ""}`;

/**
 * Punkterna i steg 1–2 ur de uppnådda delmålen (Karims beslut 2026-11-11): uppfylld eller inte, och delmålen som uppfyller den.
 * Med onPick (Karims beslut 2026-11-25) är varje levande punkt en knapp som öppnar dialogen med punktens delmål.
 */
export function StepItemList({ items, onPick }: { items: readonly StepItemView[]; onPick?: (item: StepItemView) => void }) {
  if (!items.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small" data-testid="steg-punkter">
      {items.map((it) => {
        const content = (
          <>
            <Icon name={it.fulfilled ? "check-circle" : "circle"} size="sm" className="mt-0.5 flex-none" />
            <span>
              <b className="font-bold">{it.label}</b>
              {`: ${itemText(it)}`}
            </span>
          </>
        );
        return (
          <li key={it.label}>
            {onPick && it.key && it.options ? (
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onPick(it)}
                data-punkt={it.key}
                className="flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-mb border-[1.5px] border-line-strong bg-vit px-3 py-2.5 text-left text-ui text-antracit hover:bg-antracit-ton"
              >
                {content}
              </button>
            ) : (
              <span className="flex items-start gap-1.5">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

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
  const [picking, setPicking] = useState<StepItem | null>(null);
  // Dialogen läser punkten ur den senaste frågan – kortet räknas om efter varje delmål som sparas.
  const picked = picking ? v.steps.flatMap((s) => s.items).find((it) => it.key === picking && it.options) ?? null : null;
  return (
    <Card title="Progression och resultat" icon="award" flush>
      <List>
        {v.steps.map((s) => (
          <ListItem
            key={s.step}
            lead={<span className="inline-flex size-9 items-center justify-center rounded-full border-[1.5px] border-antracit font-extrabold" aria-hidden="true">{s.step}</span>}
            title={`Steg ${s.step} · ${s.label}`}
            sub={
              s.status === "none"
                ? undefined
                : [
                  s.reachedOn ? `${s.step >= 3 ? "Resultatdatum" : "Datum"} ${fmtDate(s.reachedOn)}` : null,
                  s.submittedAt ? `skickat ${fmtDate(s.submittedAt)}` : null,
                  s.decidedAt ? `beslut ${fmtDate(s.decidedAt)}` : null,
                  s.source === "auto" ? "förslag från reglerna" : s.source === "manual" ? "skapat av Miljonbemanning" : null,
                ].filter(Boolean).join(" · ") || undefined
            }
          >
            <span className="flex flex-wrap items-center gap-2">
              <BonusStatusBadge status={s.status} text={s.statusText} icon={s.icon} />
              {s.claimId && (
                <Button kind={s.status === "suggested" && v.canAct ? "secondary" : "ghost"} iconRight="arrow-right" to={bonusPath(s.claimId)}>
                  {s.status === "suggested" && v.canAct ? "Granska och skicka" : "Visa"}
                  <span className="sr-only"> steg {s.step}</span>
                </Button>
              )}
              {s.canCreate && <CreateButton caseId={v.caseId} step={s.step} />}
            </span>
            <StepItemList items={s.items} onPick={v.canTick ? (it) => it.key && setPicking(it.key) : undefined} />
            {s.history.length > 0 && (
              <span className="text-small text-text-muted">
                Tidigare: {s.history.map((h) => `${h.statusText.toLowerCase()}${h.at ? ` ${fmtDate(h.at)}` : ""}`).join(", ")}
              </span>
            )}
          </ListItem>
        ))}
      </List>
      {v.canTick && picked?.options && (
        <StepItemModal key={picking} caseId={v.caseId} label={picked.label} options={picked.options} today={v.today} minDate={v.minDate} onClose={() => setPicking(null)} />
      )}
    </Card>
  );
}

/** Skapa underlag på stegets rad: anspråket blir ett förslag som granskas på sidan Granska och skicka. */
function CreateButton({ caseId, step }: { caseId: string; step: number }) {
  const cmd = useCommand(bonusCreate);
  const nav = useNav();
  const create = async () => {
    const res = await cmd.run({ caseId, step }).catch(() => null);
    if (!res) return toast("Underlaget kunde inte skapas. Försök igen.", "error");
    if (!res.ok) return toast(res.message || "Underlaget kunde inte skapas.", "error");
    toast(`Steg ${step}: underlaget är skapat.`);
    nav.push(bonusPath(res.claimId));
  };
  return (
    <Button icon="plus" pending={cmd.pending} onClick={() => void create()}>
      Skapa underlag<span className="sr-only"> för steg {step}</span>
    </Button>
  );
}
