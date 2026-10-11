"use client";
// Kortet "Nivå och grupp" (coachmötet 2026-10-09, Karims beslut 3): längst ned i kartläggningen och i deltagarkortets
// "Ändra". Den som kartlägger (Adam) eller coachen väljer nivå (1–5 med namn), grupper (flerval + Ny grupp) och taggen
// "Vill arbeta", och skriver en rad till coacherna (sparas som en vanlig anteckning). Valen sparas direkt (som
// kartläggningens fält sparas automatiskt) – ett anrop i taget, alltid det senaste läget. Misslyckas en sparning visas det
// senast sparade läget. Raden till coacherna sparas med "Spara raden" – osparad text skyddas (sidbyte, Klar i dialogen).
// Internt: syns aldrig för kommunen, i rapporter eller exporter och skickas aldrig till AI. AI placerar aldrig någon i en
// nivå eller grupp.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useUnsavedGuard } from "@/shell/guard";
import { Badge, Button, Card, ErrorNotice, Field, Icon, Input, Loading, Modal, Row, Seg, Stack, TextArea, toast, useModalClose, useModalDirty, type SegOption } from "@/ui";
import { caseNoteSave } from "@/features/arenden/api";
import { caseGroupingsSave, caseGroupingsView, groupingCreate, type CaseGroupings, type CaseGroupingsView, type GroupingOption } from "../api";

type State = { levelId: string | null; groupIds: string[]; tags: Record<string, string | null> };
const NONE = "";
const stateOf = (v: CaseGroupingsView): State => ({
  levelId: v.current.level?.id ?? null,
  groupIds: v.current.groups.map((g) => g.id),
  tags: Object.fromEntries(v.options.tags.map((t) => [t.category, v.current.tags.find((x) => x.category === t.category)?.id ?? null])),
});
const opts = (xs: GroupingOption[], none?: string): SegOption<string>[] => [
  ...(none ? [{ value: NONE, label: none }] : []),
  ...xs.map((g) => ({ value: g.id, label: g.archived ? `${g.name} (arkiverad)` : g.name })),
];

/** Kortet med valen. Utan skrivrätt (handledare, chef): bara texten. bare: utan kortets ram (i deltagarkortets dialog). */
export function GroupingCard({ caseId, title = "Nivå och grupp", bare }: { caseId: string; title?: string; bare?: boolean }) {
  const q = useQuery(caseGroupingsView, { caseId });
  const wrap = (children: ReactNode) => (bare ? <>{children}</> : <Card title={title} icon="layers">{children}</Card>);
  if (q.error) return wrap(<ErrorNotice error={q.error} onRetry={() => void q.refetch()} />);
  if (q.data === undefined) return wrap(<Loading />);
  if (q.data === null) return null;
  if (!q.data.canEdit) return wrap(<GroupingSummary g={q.data.current} />);
  return <Editor key={caseId} v={q.data} title={title} bare={bare} />;
}

/**
 * Raden i deltagarkortets huvud: nivå, grupper och taggar (text + ikon) och "Ändra", som öppnar samma val som i
 * kartläggningen. Visas inte för den som inte får se medlemskapen (frågan svarar null).
 */
export function CaseGroupingRow({ caseId, className }: { caseId: string; className?: string }) {
  const q = useQuery(caseGroupingsView, { caseId });
  const [open, setOpen] = useState(false);
  if (!q.data) return null;
  return (
    <div className={className} data-grouping-row="">
      <span className="text-text-muted">Nivå och grupp:</span>
      <GroupingSummary g={q.data.current} />
      {q.data.canEdit && (
        <Button kind="ghost" icon="edit" onClick={() => setOpen(true)}>
          Ändra<span className="sr-only"> nivå, grupper och taggar</span>
        </Button>
      )}
      {open && (
        <Modal title="Nivå och grupp" onClose={() => setOpen(false)} footer={<DoneButton />}>
          <GroupingCard caseId={caseId} bare />
        </Modal>
      )}
    </div>
  );
}

/** Klar stänger som krysset: finns en osparad rad till coacherna frågar dialogen först (useModalDirty i Editor). */
function DoneButton() {
  const close = useModalClose();
  return (
    <Button kind="primary" onClick={close}>
      Klar
    </Button>
  );
}

function Editor({ v, title, bare }: { v: CaseGroupingsView; title: string; bare?: boolean }) {
  const save = useCommand(caseGroupingsSave);
  const create = useCommand(groupingCreate);
  const note = useCommand(caseNoteSave);
  const [state, setState] = useState<State>(() => stateOf(v));
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "failed"; at?: string; text?: string }>({ kind: "idle" });
  const pending = useRef<State | null>(null);
  const running = useRef(false);
  // Senast sparade läget (serverns) – visas när en sparning misslyckas – och senast valda läget (ändringarna bygger på det,
  // också när en händelse kommer efter en await, t.ex. Ny grupp).
  const saved = useRef<State>(state);
  const latest = useRef<State>(state);
  const creating = useRef(false);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [newGroupError, setNewGroupError] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);
  // Osparad rad till coacherna: frågar innan sidan byts och innan dialogen stängs (Klar, krysset, Esc).
  const lineDirty = line.trim() !== "";
  useUnsavedGuard(lineDirty && !note.pending);
  useModalDirty(lineDirty);

  // Grupper som skapats här finns i frågan först efter omräkningen – valen läggs till lokalt tills dess.
  const [extraGroups, setExtraGroups] = useState<GroupingOption[]>([]);
  const groups = [...v.options.groups, ...extraGroups.filter((g) => !v.options.groups.some((x) => x.id === g.id))];
  useEffect(() => {
    saved.current = stateOf(v);
    // Läget ändrades någon annanstans (en annan flik) och inget sparas härifrån just nu: visa serverns läge.
    if (!running.current && !pending.current) {
      latest.current = saved.current;
      setState(saved.current);
    }
  }, [v]);

  const flush = async () => {
    if (running.current) return;
    running.current = true;
    while (pending.current) {
      const s = pending.current;
      pending.current = null;
      setStatus({ kind: "saving" });
      const res = await save.run({ caseId: v.caseId, levelId: s.levelId, groupIds: s.groupIds, tags: s.tags }).catch(() => null);
      if (!res || !res.ok) {
        pending.current = null;
        setStatus({ kind: "failed", text: res && !res.ok && res.message ? res.message : "Ändringen kunde inte sparas. Försök igen." });
        // Det senast sparade läget (inte läget när kortet visades) – det är det som finns i databasen.
        latest.current = saved.current;
        setState(saved.current);
        break;
      }
      saved.current = s;
      setStatus({ kind: "saved", at: res.savedAt });
    }
    running.current = false;
  };
  /** Ändra från det senast valda läget (aldrig ett läge som fångades när knappen ritades). */
  const change = (next: (prev: State) => State) => {
    const n = next(latest.current);
    latest.current = n;
    setState(n);
    pending.current = n;
    void flush();
  };

  const addGroup = async () => {
    // En gång i taget: dubbla Enter eller klick skapar inte två grupper.
    if (creating.current) return;
    const name = (newGroup ?? "").trim();
    if (!name) {
      setNewGroupError("Skriv ett namn på gruppen.");
      return;
    }
    creating.current = true;
    // Ärendets avtal (inte aktörens första) – servern kontrollerar att hen arbetar i ärendet.
    const res = await create.run({ kind: "group", caseId: v.caseId, name }).catch(() => null);
    creating.current = false;
    if (!res || !res.ok) {
      setNewGroupError(res && !res.ok && res.message ? res.message : "Gruppen kunde inte skapas.");
      return;
    }
    setExtraGroups((xs) => [...xs, { id: res.id, name, description: "", archived: false, members: 0 }]);
    setNewGroup(null);
    setNewGroupError(null);
    change((prev) => ({ ...prev, groupIds: prev.groupIds.includes(res.id) ? prev.groupIds : [...prev.groupIds, res.id] }));
    toast(`Gruppen ${name} är skapad och vald.`);
  };

  const saveLine = async () => {
    const body = line.trim();
    if (!body) {
      setLineError("Skriv något först.");
      return;
    }
    const res = await note.run({ caseId: v.caseId, occurredOn: v.today, kind: "other", audience: "full", body }).catch(() => null);
    if (!res || !res.ok) {
      setLineError(res && !res.ok && res.message ? res.message : "Raden kunde inte sparas.");
      return;
    }
    setLine("");
    setLineError(null);
    toast("Raden är sparad som en anteckning i deltagarkortet.");
  };

  const statusText =
    status.kind === "saving" ? "Sparar…" : status.kind === "saved" && status.at ? `Sparat ${fmtTime(status.at)}` : status.kind === "failed" ? (status.text ?? "") : "";
  const body = (
      <Stack>
        <p className="text-small text-text-muted">
          Sätts av den som kartlägger. Valen sparas direkt. Kommunen ser dem aldrig, och de kommer aldrig med i rapporter.
        </p>
        <Field label="Nivå" id={`gr-niva-${v.caseId}`} help="Hur nära arbete deltagaren är just nu. Inte samma sak som fas eller progressionsnivå i månadsbedömningen.">
          <Seg
            id={`gr-niva-${v.caseId}`}
            ariaLabel="Nivå"
            value={state.levelId ?? NONE}
            onValueChange={(x) => change((prev) => ({ ...prev, levelId: x || null }))}
            options={opts(v.options.levels, "Ingen nivå än")}
          />
        </Field>
        <Field label="Grupper" id={`gr-grupper-${v.caseId}`} help="Välj en eller flera. Finns inte gruppen? Skapa en ny.">
          {groups.length > 0 ? (
            <Seg
              multi
              id={`gr-grupper-${v.caseId}`}
              ariaLabel="Grupper"
              value={state.groupIds}
              onValueChange={(xs) => change((prev) => ({ ...prev, groupIds: xs }))}
              options={opts(groups)}
            />
          ) : (
            <p className="text-small text-text-muted">Det finns inga grupper ännu.</p>
          )}
        </Field>
        {newGroup === null ? (
          <div>
            <Button kind="ghost" icon="plus" onClick={() => setNewGroup("")}>
              Ny grupp
            </Button>
          </div>
        ) : (
          <Field label="Namn på den nya gruppen" id={`gr-ny-${v.caseId}`} error={newGroupError ?? undefined} help="Använd neutrala ord om stödet, till exempel ”Måndagsgruppen”. Aldrig omdömen om personer.">
            <Row gap="sm">
              <Input
                value={newGroup}
                maxLength={80}
                onValueChange={(x) => setNewGroup(x)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (!create.pending) void addGroup();
                }}
              />
              <Button kind="secondary" icon="plus" pending={create.pending} onClick={() => void addGroup()}>
                Skapa och välj
              </Button>
              <Button kind="ghost" onClick={() => { setNewGroup(null); setNewGroupError(null); }}>
                Avbryt
              </Button>
            </Row>
          </Field>
        )}
        {v.options.tags.map((t, i) => (
          <Field key={t.category} label={t.category} id={`gr-tagg-${v.caseId}-${i}`} help={t.category === "Vill arbeta" ? "Deltagarens eget svar." : undefined}>
            <Seg
              id={`gr-tagg-${v.caseId}-${i}`}
              ariaLabel={t.category}
              value={state.tags[t.category] ?? NONE}
              onValueChange={(x) => change((prev) => ({ ...prev, tags: { ...prev.tags, [t.category]: x || null } }))}
              options={opts(t.values, "Inte valt")}
            />
          </Field>
        ))}
        <div role="status" aria-live="polite" data-grouping-status={status.kind} className="flex min-h-6 items-center gap-1.5 text-small text-text-muted">
          {status.kind !== "idle" && <Icon name={status.kind === "failed" ? "alert" : status.kind === "saving" ? "clock" : "check"} className={status.kind === "failed" ? "text-rod" : undefined} />}
          <span className={status.kind === "failed" ? "font-bold text-antracit" : undefined}>{statusText}</span>
        </div>
        <Field label="En rad till coacherna (valfritt)" id={`gr-rad-${v.caseId}`} error={lineError ?? undefined} help="Sparas som en anteckning i deltagarkortet med dagens datum när du trycker Spara raden. Skriv aldrig personnummer.">
          <TextArea rows={2} value={line} maxLength={2000} onValueChange={(x) => { setLine(x); if (lineError) setLineError(null); }} />
        </Field>
        <div>
          <Button kind="secondary" icon="edit" pending={note.pending} onClick={() => void saveLine()}>
            Spara raden
          </Button>
        </div>
      </Stack>
  );
  if (bare) return body;
  return (
    <Card title={title} icon="layers" actions={<Badge tone="outline" icon="lock">Bara för Miljonbemanning</Badge>}>
      {body}
    </Card>
  );
}

/** Nivå, grupper och taggar som text + ikon (deltagarkortets huvud och läsläget). */
export function GroupingSummary({ g, empty = "Ingen nivå, grupp eller tagg ännu." }: { g: CaseGroupings; empty?: string }) {
  if (!g.level && !g.groups.length && !g.tags.length) return <span className="text-small text-text-muted">{empty}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {g.level && (
        <Badge tone="blue" icon="layers">
          {g.level.name}
        </Badge>
      )}
      {g.groups.map((x) => (
        <Badge key={x.id} tone="outline" icon="users">
          <span className="sr-only">Grupp: </span>
          {x.name}
        </Badge>
      ))}
      {g.tags.map((x) => (
        <Badge key={x.id} tone="grey" icon="hash">
          {x.category}: {x.name}
        </Badge>
      ))}
    </span>
  );
}
