"use client";
// Bjud in deltagare (coachmötet 2026-10-09: "Tre alternativ för att bjuda in till aktiviteter: grupper åt gången, nivå åt
// gången, individuell nivå"). Tre flikar:
//   Grupp     välj en eller flera grupper – alla deltagare i dem bjuds in
//   Nivå      välj en eller flera nivåer – likaså
//   Enskilda  sök och välj deltagare en och en (som förut)
// Komponenten visar hur många och vilka som bjuds in innan man bekräftar, och hoppar över de som redan är inbjudna och de vars
// insats inte pågår den dagen – med antal och orsak (selectByGroupings i src/core/group-activities.ts, samma regel som servern).
// Valet (InviteChoice) lämnas till skärmen, som räknar ut ärende-id:na med resolveChoice och skickar dem till aktiviteter.skapa
// eller aktiviteter.bjudIn. Servern prövar varje deltagare igen; per grupp eller nivå hoppar den över de som inte kan vara med
// (skipUninvitable) och säger vilka. Enskilt valda deltagare skickas alla: kan någon inte vara med den dagen (t.ex. uppehåll
// efter att datumet ändrats) nekar servern hela inbjudan och räknar upp vilka – ingen hoppas tyst över.
import { useId, useMemo, useState } from "react";
import {
  candidateBlockText, INVITE_MODE_LABEL, INVITE_MODES, selectByGroupings, skipSummary, type InviteMode, type InviteSkip, type SelectableCase,
} from "@/core/group-activities";
import { plural } from "@/core/format";
import type { LocalDate } from "@/core/time";
import { Button, Check, Field, Input, Notice, Row, Stack, TabPanel, Tabs } from "@/ui";
import type { GroupActivityForm, InviteCandidate } from "../api";

/** Valet i komponenten: fliken, de valda nivåerna eller grupperna och de enskilt valda deltagarna. */
export type InviteChoice = { mode: InviteMode; groupingIds: string[]; caseIds: string[] };
export const EMPTY_CHOICE: InviteChoice = { mode: "enskilda", groupingIds: [], caseIds: [] };

/** Det kommandot får: deltagarna och hur de valdes (revisionsloggen; per grupp eller nivå hoppar servern över de som inte kan vara med). */
export type ResolvedChoice = {
  caseIds: string[];
  /** Deltagare i de valda grupperna eller nivåerna som hoppas över (redan inbjudna, insatsen pågår inte den dagen). */
  skipped: InviteSkip[];
  /** Vilka som bjuds in, med namn (visas innan man bekräftar). */
  invite: SelectableCase[];
  payload: { via: InviteMode; groupingIds?: string[]; skipUninvitable?: boolean };
};

type FormData = Pick<GroupActivityForm, "candidates" | "groupings" | "others">;
const kindOf = (mode: InviteMode): "group" | "level" | null => (mode === "grupp" ? "group" : mode === "niva" ? "level" : null);

/** Vilka som bjuds in med valet den dagen (redan inbjudna räknas inte). */
export function resolveChoice(choice: InviteChoice, form: FormData, day: LocalDate | null, alreadyInvited: readonly string[] = []): ResolvedChoice {
  const already = new Set(alreadyInvited);
  const kind = kindOf(choice.mode);
  if (!kind) {
    // Enskilda: alla valda som inte redan är inbjudna – också de som inte kan vara med den dagen, så att servern nekar och säger
    // vilka (som förut). Komponenten visar dem med orsaken.
    const chosen = new Set(choice.caseIds);
    const sent = form.candidates.filter((c) => chosen.has(c.caseId) && !already.has(c.caseId));
    const invite = sent.filter((c) => !candidateBlockText(c, day, already));
    return { caseIds: sent.map((c) => c.caseId), skipped: [], invite, payload: { via: "enskilda" } };
  }
  const of = form.groupings.filter((g) => g.kind === kind);
  const ids = choice.groupingIds.filter((id) => of.some((g) => g.id === id));
  const sel = selectByGroupings(ids, of, form.candidates, form.others, day, already);
  return { caseIds: sel.invite.map((c) => c.caseId), skipped: sel.skipped, invite: sel.invite, payload: { via: choice.mode, groupingIds: ids, skipUninvitable: true } };
}

export type InviteParticipantsProps = {
  form: FormData;
  /** Aktivitetens dag – avgör vem som kan väljas. null = ingen dag vald än (ingen kan väljas). */
  day: LocalDate | null;
  value: InviteChoice;
  onChange: (choice: InviteChoice) => void;
  /** Redan inbjudna (visas som inbjudna och kan inte väljas igen). */
  alreadyInvited?: readonly string[];
  /** Unikt prefix för fältens id (två komponenter på samma sida). */
  idPrefix?: string;
};

/** Varför en deltagare inte kan väljas: redan inbjuden, ingen dag, eller insatsens läge den dagen. null = kan väljas. */
export const candidateBlock = (c: InviteCandidate, day: LocalDate | null, already: ReadonlySet<string>): string | null => candidateBlockText(c, day, already);

const norm = (s: string) => s.toLocaleLowerCase("sv").replace(/\s+/g, " ").trim();
const who = (x: { name: string | null; caseNumber: string }) => (x.name ? `${x.name} (${x.caseNumber})` : x.caseNumber);

export function InviteParticipants({ form, day, value, onChange, alreadyInvited = [], idPrefix }: InviteParticipantsProps) {
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const prefix = idPrefix ?? `bjud-${auto}`;
  const resolved = resolveChoice(value, form, day, alreadyInvited);
  const setMode = (mode: InviteMode) => onChange({ ...value, mode });
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-ui font-bold">Bjud in deltagare</legend>
      <Tabs
        id={`${prefix}-satt`}
        ariaLabel="Hur vill du bjuda in?"
        tabs={INVITE_MODES.map((m) => ({ id: m, label: INVITE_MODE_LABEL[m], icon: m === "enskilda" ? "user" : m === "niva" ? "layers" : "users" }))}
        active={value.mode}
        onChange={setMode}
      />
      <TabPanel tabsId={`${prefix}-satt`} active={value.mode}>
        {value.mode === "enskilda" ? (
          <Individuals form={form} day={day} value={value} onChange={onChange} alreadyInvited={alreadyInvited} prefix={prefix} />
        ) : (
          <Groupings form={form} mode={value.mode} value={value} onChange={onChange} prefix={prefix} resolved={resolved} day={day} />
        )}
      </TabPanel>
    </fieldset>
  );
}

/** Grupp eller Nivå: kryssrutor för grupperingarna, sedan vilka som bjuds in och vilka som hoppas över. */
function Groupings({
  form, mode, value, onChange, prefix, resolved, day,
}: { form: FormData; mode: "grupp" | "niva"; value: InviteChoice; onChange: (c: InviteChoice) => void; prefix: string; resolved: ResolvedChoice; day: LocalDate | null }) {
  const kind = kindOf(mode)!;
  const list = form.groupings.filter((g) => g.kind === kind);
  const word = mode === "grupp" ? { one: "grupp", many: "grupper" } : { one: "nivå", many: "nivåer" };
  const chosen = new Set(value.groupingIds);
  const toggle = (id: string, on: boolean) => onChange({ ...value, groupingIds: on ? [...value.groupingIds.filter((x) => x !== id), id] : value.groupingIds.filter((x) => x !== id) });
  const anyChosen = list.some((g) => chosen.has(g.id));
  if (!list.length) {
    return (
      <p className="m-0 text-body text-text-muted">
        {mode === "grupp" ? "Det finns inga grupper i avtalet än. Grupper skapas under Grupper och nivåer eller i deltagarens kartläggning." : "Avtalet har inga nivåer än."}
      </p>
    );
  }
  return (
    <Stack gap="sm">
      <div role="group" aria-label={`Välj ${word.many}`} className="flex flex-col rounded-mb border border-ljusgra px-3 py-1">
        {list.map((g) => (
          <Check key={g.id} id={`${prefix}-${g.id}`} checked={chosen.has(g.id)} onCheckedChange={(on) => toggle(g.id, on)}>
            <span className="font-bold">{g.name}</span>{" "}
            <span className="text-text-muted">({plural(g.caseIds.length, "deltagare", "deltagare")})</span>
          </Check>
        ))}
      </div>
      {/* Antalet läses upp när det ändras. */}
      <p role="status" aria-live="polite" className="m-0 text-body font-bold">
        {!anyChosen
          ? `Välj en eller flera ${word.many}.`
          : !day
            ? "Välj datum först."
            : resolved.invite.length
              ? `${plural(resolved.invite.length, "deltagare bjuds in", "deltagare bjuds in")}${resolved.skipped.length ? `, ${plural(resolved.skipped.length, "hoppas över", "hoppas över")}` : ""}.`
              : `Ingen deltagare kan bjudas in${resolved.skipped.length ? ` – ${plural(resolved.skipped.length, "hoppas över", "hoppas över")}` : ""}.`}
      </p>
      {anyChosen && resolved.invite.length > 0 && (
        <p className="m-0 text-body" data-testid="bjud-in-lista">
          Bjuds in: {resolved.invite.map(who).join(", ")}
        </p>
      )}
      {anyChosen && resolved.skipped.length > 0 && (
        <div className="flex flex-col gap-1 text-body" data-testid="bjud-in-hoppas-over">
          <p className="m-0">
            Hoppas över: {skipSummary(resolved.skipped)}.
          </p>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-text-muted">
            {resolved.skipped.map((s) => (
              <li key={s.caseId}>
                {who(s)}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Stack>
  );
}

/** Enskilda: sök och flerval över avtalets pågående ärenden (som förut). */
function Individuals({
  form, day, value, onChange, alreadyInvited, prefix,
}: { form: FormData; day: LocalDate | null; value: InviteChoice; onChange: (c: InviteChoice) => void; alreadyInvited: readonly string[]; prefix: string }) {
  const candidates = form.candidates;
  // Söktexten kan vara ett namn: bara i komponentens minne, aldrig i adressen eller webblagring.
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const already = useMemo(() => new Set(alreadyInvited), [alreadyInvited]);
  const selected = new Set(value.caseIds);
  const q = norm(search);
  const matches = candidates.filter((c) => !q || norm(`${c.name} ${c.caseNumber}`).includes(q));
  const LIMIT = 40;
  const shown = showAll || q ? matches : matches.slice(0, LIMIT);
  const selectable = shown.filter((c) => !candidateBlock(c, day, already));
  const set = (caseIds: string[]) => onChange({ ...value, caseIds });
  const toggle = (caseId: string, on: boolean) => set(on ? [...value.caseIds.filter((x) => x !== caseId), caseId] : value.caseIds.filter((x) => x !== caseId));
  const chosen = candidates.filter((c) => selected.has(c.caseId));
  // Valda som inte kan vara med den dagen (t.ex. efter att datumet ändrats): de stoppar inbjudan tills de kryssas ur. Utan datum
  // visas ingen ruta – formuläret säger då "Välj datum" vid fältet.
  const blocked = !day ? [] : chosen.flatMap((c) => {
    const reason = already.has(c.caseId) ? null : candidateBlock(c, day, already);
    return reason ? [{ c, reason }] : [];
  });
  return (
    <Stack gap="sm">
      <Field id={`${prefix}-sok`} label="Sök deltagare" help="Skriv namn eller ärendenummer.">
        <Input type="search" value={search} onValueChange={setSearch} maxLength={60} />
      </Field>
      <Row between>
        {/* Antalet valda läses upp när det ändras. */}
        <p role="status" aria-live="polite" className="m-0 text-body font-bold">
          {chosen.length ? `${plural(chosen.length, "deltagare vald", "deltagare valda")}` : "Ingen deltagare vald"}
        </p>
        <Row gap="sm">
          {q && selectable.some((c) => !selected.has(c.caseId)) && (
            <Button kind="ghost" icon="check-square" onClick={() => set([...new Set([...value.caseIds, ...selectable.map((c) => c.caseId)])])}>
              Välj alla som visas ({selectable.filter((c) => !selected.has(c.caseId)).length})
            </Button>
          )}
          {chosen.length > 0 && (
            <Button kind="ghost" icon="x" onClick={() => set([])}>
              Rensa valet
            </Button>
          )}
        </Row>
      </Row>
      {chosen.length > 0 && <p className="m-0 text-body text-text-muted">Valda: {chosen.map((c) => `${c.name} (${c.caseNumber})`).join(", ")}</p>}
      {blocked.length > 0 && (
        <Notice tone="warn" title={blocked.length === 1 ? "En vald deltagare kan inte bjudas in den dagen" : `${blocked.length} valda deltagare kan inte bjudas in den dagen`}>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5" data-testid="bjud-in-sparrade">
            {blocked.map(({ c, reason }) => (
              <li key={c.caseId}>
                {c.name} ({c.caseNumber}): {reason}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-1">Kryssa ur {blocked.length === 1 ? "deltagaren" : "dem"} eller välj en annan dag.</p>
        </Notice>
      )}
      {candidates.length === 0 ? (
        <p className="m-0 text-body text-text-muted">Det finns inga pågående insatser att bjuda in.</p>
      ) : shown.length === 0 ? (
        <p className="m-0 text-body text-text-muted">Ingen deltagare matchar sökningen.</p>
      ) : (
        <Stack gap="xs" className="max-h-[420px] overflow-y-auto rounded-mb border border-ljusgra px-3 py-1">
          {shown.map((c) => {
            const block = candidateBlock(c, day, already);
            const descId = `${prefix}-${c.caseId}-info`;
            return (
              <div key={c.caseId} className="border-b border-ljusgra last:border-b-0">
                <Check
                  id={`${prefix}-${c.caseId}`}
                  checked={selected.has(c.caseId) || already.has(c.caseId)}
                  // En vald deltagare som inte längre kan väljas (t.ex. efter att datumet ändrats) går att kryssa ur.
                  disabled={!!block && !selected.has(c.caseId)}
                  onCheckedChange={(on) => toggle(c.caseId, on)}
                  aria-describedby={descId}
                >
                  <span className="font-bold">{c.name}</span> <span className="tabular-nums text-text-muted">{c.caseNumber}</span>
                  <span id={descId} className="block text-body text-text-muted">
                    {block ?? (c.leadCoachName ? `Huvudcoach ${c.leadCoachName}` : "Ingen huvudcoach")}
                  </span>
                </Check>
              </div>
            );
          })}
        </Stack>
      )}
      {!q && !showAll && matches.length > LIMIT && (
        <div>
          <Button kind="ghost" onClick={() => setShowAll(true)}>
            Visa alla {matches.length}
          </Button>
        </div>
      )}
    </Stack>
  );
}
