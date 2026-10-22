"use client";
// Bjud in deltagare (coachmötet 2026-10-09: "grupper åt gången, nivå åt gången, individuell nivå"; Karims beslut 2026-10-22:
// grupperna är yrkesområdena). Tre flikar:
//   Yrkesområde  välj ett yrkesområde – det blir aktivitetens målgrupp
//   Nivå         välj en nivå – likaså
//   Enskilda     sök och välj deltagare en och en (som förut)
// Med en målgrupp bjuder servern in de aktiva deltagarna i den och håller listan aktuell fram till aktiviteten (de som tillkommer
// bjuds in automatiskt, de som byter nivå eller avslutas tas bort). Komponenten visar hur många och vilka som är med just nu och
// vilka som hoppas över den dagen (selectByGroupings i src/core/group-activities.ts – samma regel som servern), innan man
// bekräftar. Valet (InviteChoice) lämnas till skärmen, som räknar ut anropet med resolveChoice och skickar det till
// aktiviteter.skapa, aktiviteter.bjudIn eller aktiviteter.serieSkapa. Enskilt valda deltagare skickas alla: kan någon inte vara
// med den dagen nekar servern hela inbjudan och räknar upp vilka – ingen hoppas tyst över.
import { useId, useMemo, useState } from "react";
import {
  candidateBlockText, INVITE_MODE_LABEL, INVITE_MODES, selectByGroupings, skipSummary, type InviteMode, type InviteSkip, type SelectableCase,
} from "@/core/group-activities";
import { plural } from "@/core/format";
import type { LocalDate } from "@/core/time";
import { Button, Check, Field, Input, Notice, Row, Select, Stack, TabPanel, Tabs } from "@/ui";
import type { AudienceInput, GroupActivityForm, InviteCandidate } from "../api";

/** Valet i komponenten: fliken, målgruppen (nivåns id eller yrkesområdets kod) och de enskilt valda deltagarna. */
export type InviteChoice = { mode: InviteMode; audienceId: string | null; caseIds: string[] };
export const EMPTY_CHOICE: InviteChoice = { mode: "enskilda", audienceId: null, caseIds: [] };

/** Det kommandot får: enskilda (caseIds) eller målgruppen (audience) och hur deltagarna valdes (revisionsloggen). */
export type ResolvedChoice = {
  /** Enskilt valda (skickas som caseIds). Tomt med en målgrupp – servern räknar ut vilka. */
  caseIds: string[];
  /** Målgruppen, eller null (enskilda). */
  audience: AudienceInput | null;
  /** Antalet som bjuds in nu (visas i knappen). */
  count: number;
  /** Deltagare i målgruppen som inte kan vara med den dagen (redan inbjudna, insatsen pågår inte). */
  skipped: InviteSkip[];
  /** Vilka som bjuds in nu, med namn (visas innan man bekräftar). */
  invite: SelectableCase[];
  payload: { via: InviteMode };
};

type FormData = Pick<GroupActivityForm, "candidates" | "groupings" | "others">;
const kindOf = (mode: InviteMode): "area" | "level" | null => (mode === "omrade" ? "area" : mode === "niva" ? "level" : null);

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
    return { caseIds: sent.map((c) => c.caseId), audience: null, count: sent.length, skipped: [], invite, payload: { via: "enskilda" } };
  }
  const g = form.groupings.find((x) => x.kind === kind && x.id === choice.audienceId);
  if (!g) return { caseIds: [], audience: null, count: 0, skipped: [], invite: [], payload: { via: choice.mode } };
  const sel = selectByGroupings([g.id], [g], form.candidates, form.others, day, already);
  const audience: AudienceInput = kind === "level" ? { kind: "level", levelId: g.id } : { kind: "area", areaCode: g.id };
  return { caseIds: [], audience, count: sel.invite.length, skipped: sel.skipped, invite: sel.invite, payload: { via: choice.mode } };
}

export type InviteParticipantsProps = {
  form: FormData;
  /** Aktivitetens dag – avgör vem som kan väljas. null = ingen dag vald än (ingen kan väljas). */
  day: LocalDate | null;
  value: InviteChoice;
  onChange: (choice: InviteChoice) => void;
  /** Redan inbjudna (visas som inbjudna och kan inte väljas igen). */
  alreadyInvited?: readonly string[];
  /** Flikarna som visas (t.ex. bara Enskilda när aktiviteten redan har en målgrupp). Standard: alla tre. */
  modes?: readonly InviteMode[];
  /** Unikt prefix för fältens id (två komponenter på samma sida). */
  idPrefix?: string;
};

/** Varför en deltagare inte kan väljas: redan inbjuden, ingen dag, eller insatsens läge den dagen. null = kan väljas. */
export const candidateBlock = (c: InviteCandidate, day: LocalDate | null, already: ReadonlySet<string>): string | null => candidateBlockText(c, day, already);

const norm = (s: string) => s.toLocaleLowerCase("sv").replace(/\s+/g, " ").trim();
const who = (x: { name: string | null; caseNumber: string }) => (x.name ? `${x.name} (${x.caseNumber})` : x.caseNumber);
const ICON: Record<InviteMode, "users" | "layers" | "user"> = { omrade: "users", niva: "layers", enskilda: "user" };

export function InviteParticipants({ form, day, value, onChange, alreadyInvited = [], modes = INVITE_MODES, idPrefix }: InviteParticipantsProps) {
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const prefix = idPrefix ?? `bjud-${auto}`;
  const resolved = resolveChoice(value, form, day, alreadyInvited);
  const setMode = (mode: InviteMode) => onChange({ ...value, mode, audienceId: mode === value.mode ? value.audienceId : null });
  const active = modes.includes(value.mode) ? value.mode : modes[0];
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-ui font-bold">Bjud in deltagare</legend>
      {modes.length > 1 && (
        <Tabs
          id={`${prefix}-satt`}
          ariaLabel="Hur vill du bjuda in?"
          tabs={modes.map((m) => ({ id: m, label: INVITE_MODE_LABEL[m], icon: ICON[m] }))}
          active={active}
          onChange={setMode}
        />
      )}
      <TabPanel tabsId={`${prefix}-satt`} active={active}>
        {active === "enskilda" ? (
          <Individuals form={form} day={day} value={value} onChange={onChange} alreadyInvited={alreadyInvited} prefix={prefix} />
        ) : (
          <AudiencePicker form={form} mode={active} value={value} onChange={onChange} prefix={prefix} resolved={resolved} day={day} />
        )}
      </TabPanel>
    </fieldset>
  );
}

/** Yrkesområde eller Nivå: ett val, sedan vilka som är med just nu och vilka som hoppas över. */
function AudiencePicker({
  form, mode, value, onChange, prefix, resolved, day,
}: { form: FormData; mode: "omrade" | "niva"; value: InviteChoice; onChange: (c: InviteChoice) => void; prefix: string; resolved: ResolvedChoice; day: LocalDate | null }) {
  const kind = kindOf(mode)!;
  const list = form.groupings.filter((g) => g.kind === kind);
  const word = mode === "omrade" ? { label: "Yrkesområde", pick: "Välj yrkesområde", help: "Alla aktiva deltagare med yrkesområdet bjuds in." } : { label: "Nivå", pick: "Välj nivå", help: "Alla aktiva deltagare på nivån bjuds in." };
  const chosen = list.find((g) => g.id === value.audienceId) ?? null;
  if (!list.length) {
    return <p className="m-0 text-body text-text-muted">{mode === "omrade" ? "Avtalet har inga yrkesområden." : "Avtalet har inga nivåer än."}</p>;
  }
  return (
    <Stack gap="sm">
      <Field label={word.label} id={`${prefix}-${mode}`} help={`${word.help} De som tillkommer bjuds in automatiskt fram till aktiviteten.`}>
        <Select
          value={chosen?.id ?? ""}
          placeholder={word.pick}
          onValueChange={(x) => onChange({ ...value, mode, audienceId: x || null })}
          options={list.map((g) => ({ value: g.id, label: `${g.name} (${plural(g.caseIds.length, "deltagare", "deltagare")})` }))}
        />
      </Field>
      {/* Antalet läses upp när det ändras. */}
      <p role="status" aria-live="polite" className="m-0 text-body font-bold">
        {!chosen
          ? `${word.pick}.`
          : !day
            ? "Välj datum först."
            : `${plural(resolved.invite.length, "deltagare", "deltagare")} just nu. De som tillkommer bjuds in automatiskt fram till aktiviteten.`}
      </p>
      {chosen && resolved.invite.length > 0 && (
        <p className="m-0 text-body" data-testid="bjud-in-lista">
          Bjuds in: {resolved.invite.map(who).join(", ")}
        </p>
      )}
      {chosen && resolved.skipped.length > 0 && (
        <div className="flex flex-col gap-1 text-body" data-testid="bjud-in-hoppas-over">
          <p className="m-0">Hoppas över: {skipSummary(resolved.skipped)}.</p>
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
