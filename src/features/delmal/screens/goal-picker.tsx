"use client";
// Valet "Tränar delmål" (Karims beslut 2026-11-11) i formulären för gruppaktiviteter, återkommande aktiviteter och egna tillfällen:
// avtalets delmål per progressionsområde som kryssrutor. Ett inaktiverat delmål visas bara när det redan står på tillfället (det
// kan tas bort men inte väljas igen). Internt – syns bara för Miljonbemanning.
import { Check, Disclosure } from "@/ui";
import type { GoalPickerArea } from "../api";

export function GoalPicker({ areas, value, onChange, idPrefix }: { areas: readonly GoalPickerArea[]; value: readonly string[]; onChange: (ids: string[]) => void; idPrefix: string }) {
  const shown = areas
    .map((a) => ({ ...a, goals: a.goals.filter((g) => g.active || value.includes(g.id)) }))
    .filter((a) => a.goals.length);
  if (!shown.length) return null;
  const toggle = (id: string, on: boolean) => {
    // Ordningen följer katalogen, så att samma val alltid blir samma lista.
    const order = shown.flatMap((a) => a.goals.map((g) => g.id));
    const next = new Set(value);
    if (on) next.add(id);
    else next.delete(id);
    onChange([...order.filter((x) => next.has(x)), ...value.filter((x) => next.has(x) && !order.includes(x))]);
  };
  return (
    <fieldset className="col-span-full m-0 min-w-0 border-0 p-0" data-testid="tranar-delmal">
      <legend className="mb-1 p-0 text-ui font-bold">Tränar delmål{value.length ? ` (${value.length})` : ""}</legend>
      <Disclosure label="Välj delmål" openLabel="Dölj delmålen" kind="secondary">
        <div className="flex flex-col gap-3">
          {shown.map((a) => (
            <fieldset key={a.key} className="m-0 min-w-0 border-0 p-0">
              <legend className="p-0 text-small font-extrabold tracking-[0.08em] text-text-muted uppercase">{a.label}</legend>
              <div className="flex flex-col">
                {a.goals.map((g) => (
                  <Check key={g.id} id={`${idPrefix}-delmal-${g.id}`} checked={value.includes(g.id)} onCheckedChange={(on) => toggle(g.id, on)}>
                    {g.active ? g.label : `${g.label} (inaktiverat)`}
                  </Check>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Disclosure>
    </fieldset>
  );
}
