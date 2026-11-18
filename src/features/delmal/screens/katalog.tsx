"use client";
// Delmål (/avtal/delmal) – avtalets katalog med delmål för progressionerna (Karims beslut 2026-11-11). Avtalsansvarig och
// systemadministratören: per progressionsområde lägga till, byta namn, flytta upp och ned, inaktivera och aktivera, och välja
// punkterna i steg 1–2 som delmålet räknas mot. Ett delmål tas aldrig bort – ett inaktiverat delmål kan inte väljas på nya tillfällen
// eller i nya ärenden, men det som redan står ligger kvar. Bara Miljonbemanning.
import { useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { useQueryPatch } from "@/shell/url-state";
import { Badge, Button, Card, Check, Empty, ErrorNotice, Field, Input, List, ListItem, Loading, Modal, ModalCancelButton, Notice, Page, Select, Stack, toast } from "@/ui";
import { PROGRESS_GOAL_LABEL_MAX, type StepItem } from "@/data/schema";
import { goalCatalog, goalCreate, goalMove, goalSetActive, goalUpdate, type CatalogGoal, type GoalCatalogView } from "../api";

const TITLE = "Delmål";

export function DelmalKatalogScreen({ query }: ScreenProps) {
  const q = useQuery(goalCatalog, { contractId: query.get("avtal") ?? undefined }, { keepPrevious: true });
  if (q.error) return <Page title={TITLE}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (q.data === undefined) return <Page title={TITLE}><Loading /></Page>;
  if (q.data === null) {
    return (
      <Page title={TITLE}>
        <Card>
          <Empty icon="target" title="Inget aktivt avtal" />
        </Card>
      </Page>
    );
  }
  return <Catalog v={q.data} />;
}

type Dialog = { mode: "new"; areaKey: string; areaLabel: string } | { mode: "edit"; g: CatalogGoal; areaLabel: string };

function Catalog({ v }: { v: GoalCatalogView }) {
  const patch = useQueryPatch();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const move = useCommand(goalMove);
  const setActive = useCommand(goalSetActive);
  const [busy, setBusy] = useState<string | null>(null);
  const itemLabel = new Map(v.stepItems.map((x) => [x.key, `Steg ${x.step} · ${x.label}`]));
  const run = async (key: string, fn: () => Promise<{ ok: boolean; message?: string } | null>, done: string) => {
    if (busy) return;
    setBusy(key);
    const res = await fn().catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return toast(res && !res.ok && res.message ? res.message : "Det gick inte att spara.", "error");
    toast(done);
  };
  return (
    <Page title={TITLE}>
      <Stack>
        {v.contracts.length > 1 && (
          <Card>
            <Field label="Avtal" id="delmal-avtal">
              <Select value={v.contractId} onValueChange={(x) => patch({ avtal: x || null })} options={v.contracts.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
          </Card>
        )}
        {v.areas.map((a) => (
          <Card
            key={a.key}
            title={a.label}
            flush
            actions={v.canEdit ? <Button icon="plus" onClick={() => setDialog({ mode: "new", areaKey: a.key, areaLabel: a.label })}>Lägg till delmål<span className="sr-only"> – {a.label}</span></Button> : undefined}
          >
            {a.goals.length === 0 ? (
              <Empty icon="target" title="Inga delmål" />
            ) : (
              <List>
                {a.goals.map((g, i) => (
                  <ListItem key={g.id} title={g.label} data-delmal={g.id}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {!g.active && <Badge tone="grey" icon="minus-circle">Inaktiverat</Badge>}
                      {g.stepItems.map((it) => <Badge key={it} tone="outline" icon="award">{itemLabel.get(it) ?? it}</Badge>)}
                    </span>
                    {v.canEdit && (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Button kind="ghost" icon="edit" onClick={() => setDialog({ mode: "edit", g, areaLabel: a.label })}>
                          Ändra<span className="sr-only"> – {g.label}</span>
                        </Button>
                        <Button kind="ghost" icon="chevron-up" aria-disabled={i === 0 || undefined} pending={busy === `up:${g.id}`}
                          onClick={() => i > 0 && void run(`up:${g.id}`, () => move.run({ id: g.id, direction: "up" }), `${g.label} är flyttat upp.`)}>
                          Upp<span className="sr-only"> – {g.label}</span>
                        </Button>
                        <Button kind="ghost" icon="chevron-down" aria-disabled={i === a.goals.length - 1 || undefined} pending={busy === `down:${g.id}`}
                          onClick={() => i < a.goals.length - 1 && void run(`down:${g.id}`, () => move.run({ id: g.id, direction: "down" }), `${g.label} är flyttat ned.`)}>
                          Ned<span className="sr-only"> – {g.label}</span>
                        </Button>
                        <Button kind="ghost" icon={g.active ? "minus-circle" : "check-circle"} pending={busy === `act:${g.id}`}
                          onClick={() => void run(`act:${g.id}`, () => setActive.run({ id: g.id, active: !g.active }), g.active ? `${g.label} är inaktiverat.` : `${g.label} är aktiverat.`)}>
                          {g.active ? "Inaktivera" : "Aktivera"}<span className="sr-only"> – {g.label}</span>
                        </Button>
                      </span>
                    )}
                  </ListItem>
                ))}
              </List>
            )}
          </Card>
        ))}
      </Stack>
      {dialog && <GoalModal v={v} dialog={dialog} onClose={() => setDialog(null)} />}
    </Page>
  );
}

function GoalModal({ v, dialog, onClose }: { v: GoalCatalogView; dialog: Dialog; onClose: () => void }) {
  const create = useCommand(goalCreate);
  const update = useCommand(goalUpdate);
  const initial = dialog.mode === "edit" ? { label: dialog.g.label, items: [...dialog.g.stepItems] } : { label: "", items: [] as StepItem[] };
  const [label, setLabel] = useState(initial.label);
  const [items, setItems] = useState<StepItem[]>(initial.items);
  const [error, setError] = useState<string | null>(null);
  const dirty = label !== initial.label || JSON.stringify(items) !== JSON.stringify(initial.items);
  const toggle = (k: StepItem, on: boolean) => setItems(v.stepItems.map((x) => x.key).filter((x) => (x === k ? on : items.includes(x))));
  const submit = async () => {
    setError(null);
    if (!label.trim()) return setError("Skriv delmålet.");
    const res = dialog.mode === "new"
      ? await create.run({ contractId: v.contractId, areaKey: dialog.areaKey, label: label.trim(), stepItems: items }).catch(() => null)
      : await update.run({ id: dialog.g.id, label: label.trim(), stepItems: items }).catch(() => null);
    if (!res) return setError("Det gick inte att spara. Försök igen.");
    if (!res.ok) return setError(res.message || "Det gick inte att spara.");
    toast(dialog.mode === "new" ? `${label.trim()} är tillagt.` : "Ändringen är sparad.");
    onClose();
  };
  return (
    <Modal
      title={dialog.mode === "new" ? `Lägg till delmål – ${dialog.areaLabel}` : `Ändra delmål – ${dialog.areaLabel}`}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={create.pending || update.pending} onClick={() => void submit()}>
            {dialog.mode === "new" ? "Lägg till" : "Spara"}
          </Button>
        </>
      }
    >
      <Stack gap="sm">
        <Field id="delmal-namn" label="Delmål" required>
          <Input value={label} onValueChange={setLabel} maxLength={PROGRESS_GOAL_LABEL_MAX} />
        </Field>
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 text-ui font-bold">Räknas mot</legend>
          {[1, 2].map((step) => (
            <div key={step} className="flex flex-col">
              {v.stepItems.filter((x) => x.step === step).map((x) => (
                <Check key={x.key} id={`delmal-punkt-${x.key}`} checked={items.includes(x.key)} onCheckedChange={(on) => toggle(x.key, on)}>
                  {`Steg ${x.step} · ${x.label}`}
                </Check>
              ))}
            </div>
          ))}
        </fieldset>
        {error && <Notice tone="critical" title="Det gick inte">{error}</Notice>}
      </Stack>
    </Modal>
  );
}
