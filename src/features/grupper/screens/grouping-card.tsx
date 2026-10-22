"use client";
// Kortet "Nivå och yrkesområde" (coachmötet 2026-10-09, Karims beslut 3; Karims beslut 2026-10-22): längst ned i kartläggningen
// och i deltagarkortets "Ändra". Den som kartlägger (Adam) eller coachen väljer nivå (1–5 med namn) och taggen "Vill arbeta" och
// skriver en rad till coacherna (sparas som en vanlig anteckning). Gruppen är deltagarens yrkesområde – den visas, men väljs inte
// här (den följer ärendets yrkesområde). Nivån krävs innan kartläggningen godkänns och tas sedan aldrig bort – den höjs (Höj nivå)
// eller byts. Valen sparas direkt (som kartläggningens fält sparas automatiskt) – ett anrop i taget, alltid det senaste läget.
// Misslyckas en sparning visas det senast sparade läget. Raden till coacherna sparas med "Spara raden" – osparad text skyddas
// (sidbyte, Klar i dialogen). Nivåhistoriken ("Nivå 1 från 9 okt (Amira), Nivå 2 från 22 okt (Sara)") visas under valen.
// Internt: syns aldrig för kommunen, i rapporter eller exporter och skickas aldrig till AI. AI placerar aldrig någon i en nivå.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { plural } from "@/core/format";
import { fmtDateShort, fmtTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useUnsavedGuard } from "@/shell/guard";
import { Badge, Button, Card, ErrorNotice, Field, Icon, Loading, Modal, Notice, Seg, Stack, TextArea, toast, useModalClose, useModalDirty, type SegOption } from "@/ui";
import { caseNoteSave } from "@/features/arenden/api";
import { caseGroupingsSave, caseGroupingsView, caseLevelRaise, type CaseGroupings, type CaseGroupingsView, type GroupingOption, type LevelChange } from "../api";

type State = { levelId: string | null; tags: Record<string, string | null> };
const NONE = "";
const stateOf = (v: CaseGroupingsView): State => ({
  levelId: v.current.level?.id ?? null,
  tags: Object.fromEntries(v.options.tags.map((t) => [t.category, v.current.tags.find((x) => x.category === t.category)?.id ?? null])),
});
const opts = (xs: GroupingOption[], none?: string): SegOption<string>[] => [
  ...(none ? [{ value: NONE, label: none }] : []),
  ...xs.map((g) => ({ value: g.id, label: g.archived ? `${g.name} (arkiverad)` : g.name })),
];
/** "Nivå 3" ur "Nivå 3 – På väg" (historiken). */
const shortLevel = (name: string) => name.split(" – ")[0] ?? name;

/** Meningen efter en ny nivå: inbjudningarna till nivåns kommande aktiviteter. */
export function levelChangeText(r: LevelChange): string {
  const parts = [
    r.invited ? `Deltagaren är inbjuden till ${plural(r.invited, "kommande aktivitet", "kommande aktiviteter")} för nivån.` : "",
    r.removed ? `${plural(r.removed, "aktivitet", "aktiviteter")} för den förra nivån är borttagna.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Kortet med valen. Utan skrivrätt (chef, systemadministratör): bara texten. bare: utan kortets ram (i deltagarkortets dialog).
 * requiredForApproval: kartläggningen – nivån krävs innan den godkänns (texten vid fältet).
 */
export function GroupingCard({
  caseId, title = "Nivå och yrkesområde", bare, requiredForApproval, areaAction,
}: { caseId: string; title?: string; bare?: boolean; requiredForApproval?: boolean; areaAction?: ReactNode }) {
  const q = useQuery(caseGroupingsView, { caseId });
  const wrap = (children: ReactNode) => (bare ? <>{children}</> : <Card title={title} icon="layers">{children}</Card>);
  if (q.error) return wrap(<ErrorNotice error={q.error} onRetry={() => void q.refetch()} />);
  if (q.data === undefined) return wrap(<Loading />);
  if (q.data === null) return null;
  if (!q.data.canEdit) {
    return wrap(
      <Stack gap="sm">
        <GroupingSummary g={q.data.current} area={q.data.area} />
        <LevelHistory v={q.data} />
      </Stack>,
    );
  }
  return <Editor key={caseId} v={q.data} title={title} bare={bare} requiredForApproval={requiredForApproval} areaAction={areaAction} />;
}

/**
 * Raden i deltagarkortets huvud: nivå, yrkesområde och taggar (text + ikon), "Höj nivå" (ett klick till nästa nivå – inte på
 * nivå 5) och "Ändra", som öppnar samma val som i kartläggningen (Byt nivå, taggar, historiken). areaAction: deltagarkortet lägger
 * Byt yrkesområde i dialogen, vid yrkesområdet (src/features/arenden/screens/kort-yrkesomrade.tsx). Raden ryms på en rad (etiketten
 * bara för skärmläsare), så att flikraden syns utan att skrolla. Visas inte för den som inte får se medlemskapen (frågan svarar null).
 */
export function CaseGroupingRow({ caseId, className, areaAction }: { caseId: string; className?: string; areaAction?: ReactNode }) {
  const q = useQuery(caseGroupingsView, { caseId });
  const raise = useCommand(caseLevelRaise);
  const [open, setOpen] = useState(false);
  if (!q.data) return null;
  const v = q.data;
  const doRaise = async () => {
    if (!v.current.level || raise.pending) return;
    const res = await raise.run({ caseId, fromLevelId: v.current.level.id }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Nivån kunde inte höjas.", "error");
      return;
    }
    toast(`Nivån är höjd till ${res.levelName}. ${levelChangeText(res)}`.trim());
  };
  return (
    <div className={className} data-grouping-row="">
      <span className="sr-only">Nivå och yrkesområde:</span>
      <GroupingSummary g={v.current} area={v.area} />
      {v.canEdit && v.current.level && v.nextLevel && (
        <Button kind="ghost" icon="trending-up" pending={raise.pending} onClick={() => void doRaise()}>
          Höj nivå<span className="sr-only"> till {v.nextLevel.name}</span>
        </Button>
      )}
      {v.canEdit && (
        <Button kind="ghost" icon="edit" onClick={() => setOpen(true)}>
          Ändra<span className="sr-only"> nivå, taggar och yrkesområde</span>
        </Button>
      )}
      {open && (
        <Modal title="Nivå och yrkesområde" onClose={() => setOpen(false)} footer={<DoneButton />}>
          <GroupingCard caseId={caseId} bare areaAction={areaAction} />
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

/** Nivåhistoriken: "Nivå 1 från 9 okt (Amira), Nivå 2 från 22 okt (Sara)". */
function LevelHistory({ v }: { v: CaseGroupingsView }) {
  if (v.levelHistory.length < 1) return null;
  return (
    <p className="m-0 text-small text-text-muted" data-testid="nivahistorik">
      <span className="font-bold">Nivåhistorik: </span>
      {v.levelHistory.map((h) => `${shortLevel(h.name)} från ${fmtDateShort(h.from)}${h.byName ? ` (${h.byName})` : ""}`).join(", ")}
    </p>
  );
}

function Editor({
  v, title, bare, requiredForApproval, areaAction,
}: { v: CaseGroupingsView; title: string; bare?: boolean; requiredForApproval?: boolean; areaAction?: ReactNode }) {
  const save = useCommand(caseGroupingsSave);
  const raise = useCommand(caseLevelRaise);
  const note = useCommand(caseNoteSave);
  const [state, setState] = useState<State>(() => stateOf(v));
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "failed"; at?: string; text?: string }>({ kind: "idle" });
  const pending = useRef<State | null>(null);
  const running = useRef(false);
  // Senast sparade läget (serverns) – visas när en sparning misslyckas – och senast valda läget (ändringarna bygger på det).
  const saved = useRef<State>(state);
  const latest = useRef<State>(state);
  const [line, setLine] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);
  // Osparad rad till coacherna: frågar innan sidan byts och innan dialogen stängs (Klar, krysset, Esc).
  const lineDirty = line.trim() !== "";
  useUnsavedGuard(lineDirty && !note.pending);
  useModalDirty(lineDirty);

  useEffect(() => {
    saved.current = stateOf(v);
    // Läget ändrades någon annanstans (en annan flik, Höj nivå) och inget sparas härifrån just nu: visa serverns läge.
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
      const res = await save.run({ caseId: v.caseId, levelId: s.levelId, tags: s.tags }).catch(() => null);
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

  const doRaise = async () => {
    if (!v.current.level || raise.pending || running.current) return;
    const res = await raise.run({ caseId: v.caseId, fromLevelId: v.current.level.id }).catch(() => null);
    if (!res || !res.ok) {
      setStatus({ kind: "failed", text: res && !res.ok && res.message ? res.message : "Nivån kunde inte höjas." });
      return;
    }
    setStatus({ kind: "saved", at: res.savedAt });
    toast(`Nivån är höjd till ${res.levelName}. ${levelChangeText(res)}`.trim());
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

  const hasLevel = !!v.current.level;
  const statusText =
    status.kind === "saving" ? "Sparar…" : status.kind === "saved" && status.at ? `Sparat ${fmtTime(status.at)}` : status.kind === "failed" ? (status.text ?? "") : "";
  const levelHelp = hasLevel
    ? "Hur nära arbete deltagaren är just nu. Byt nivå genom att välja en annan. Inte samma sak som fas eller progressionsnivå 0–3 i månadsbedömningen."
    : "Hur nära arbete deltagaren är just nu. Inte samma sak som fas eller progressionsnivå 0–3 i månadsbedömningen.";
  const body = (
    <Stack>
      <p className="text-small text-text-muted">
        Sätts av den som kartlägger. Valen sparas direkt. Kommunen ser dem aldrig, och de kommer aldrig med i rapporter.
      </p>
      {requiredForApproval && !hasLevel && (
        <Notice tone="info" icon="layers" title="Välj nivå innan du godkänner kartläggningen">
          Deltagaren bjuds sedan in automatiskt till nivåns aktiviteter.
        </Notice>
      )}
      <Field label="Nivå" id={`gr-niva-${v.caseId}`} required={requiredForApproval} help={levelHelp}>
        <Seg
          id={`gr-niva-${v.caseId}`}
          ariaLabel="Nivå"
          value={state.levelId ?? NONE}
          onValueChange={(x) => x && change((prev) => ({ ...prev, levelId: x }))}
          // "Ingen nivå än" bara innan nivån är satt – sedan byts den, den tas inte bort.
          options={opts(v.options.levels, hasLevel ? undefined : "Ingen nivå än")}
        />
      </Field>
      {hasLevel && v.nextLevel && (
        <div>
          <Button kind="secondary" icon="trending-up" pending={raise.pending} onClick={() => void doRaise()}>
            Höj nivå<span className="sr-only"> till {v.nextLevel.name}</span>
          </Button>
        </div>
      )}
      <LevelHistory v={v} />
      <div className="flex flex-col gap-1">
        <span className="text-ui font-bold">Yrkesområde (gruppen)</span>
        <span className="text-body">{v.area ?? "Yrkesområde saknas"}</span>
        <span className="text-small text-text-muted">
          {areaAction
            ? "Gruppen följer deltagarens yrkesområde. Byter du yrkesområde bjuds deltagaren in till det nya yrkesområdets träffar direkt."
            : "Gruppen följer deltagarens yrkesområde och väljs inte här. Deltagaren bjuds in till yrkesområdets träffar."}
        </span>
        {areaAction && <div>{areaAction}</div>}
      </div>
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

/** Nivå, yrkesområde och taggar som text + ikon (deltagarkortets huvud och läsläget). */
export function GroupingSummary({ g, area, empty = "Ingen nivå eller tagg ännu." }: { g: CaseGroupings; area?: string | null; empty?: string }) {
  if (!g.level && !g.tags.length && !area) return <span className="text-small text-text-muted">{empty}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {g.level ? (
        <Badge tone="blue" icon="layers">
          {g.level.name}
        </Badge>
      ) : (
        <Badge tone="outline" icon="layers">
          Ingen nivå än
        </Badge>
      )}
      {area && (
        <Badge tone="outline" icon="users">
          <span className="sr-only">Yrkesområde: </span>
          {area}
        </Badge>
      )}
      {g.tags.map((x) => (
        <Badge key={x.id} tone="grey" icon="hash">
          {x.category}: {x.name}
        </Badge>
      ))}
    </span>
  );
}
