"use client";
// Bjud in deltagare (coachmötet 2026-10-09): sök och flerval över avtalets ärenden. Komponenten tar emot och lämnar en lista
// med ärende-id:n (value/onChange) – skärmen skickar den till aktiviteter.skapa eller aktiviteter.bjudIn. Den som inte kan
// bjudas in den valda dagen (avslutad, pausad, före start, uppehåll – inviteBlock i src/core/group-activities.ts, samma regel
// som servern) visas med orsaken och kan inte väljas.
//
// Utbyggnad: ett senare spår lägger till "per grupp" och "per nivå" i samma komponent via `sources` – varje källa är en
// knapp eller lista som lägger till ärende-id:n i samma val (onChange med de sammanslagna id:na). Valet är alltid en lista
// med ärende-id:n, och servern prövar varje deltagare igen.
import { useId, useMemo, useState, type ReactNode } from "react";
import { INVITE_BLOCK_TEXT, inviteBlock } from "@/core/group-activities";
import { plural } from "@/core/format";
import type { LocalDate } from "@/core/time";
import { Button, Check, Field, Input, Row, Stack } from "@/ui";
import type { InviteCandidate } from "../api";

export type InviteParticipantsProps = {
  candidates: readonly InviteCandidate[];
  /** Aktivitetens dag – avgör vem som kan väljas. null = ingen dag vald än (ingen kan väljas). */
  day: LocalDate | null;
  /** Valda ärende-id:n. */
  value: readonly string[];
  onChange: (caseIds: string[]) => void;
  /** Redan inbjudna (visas som inbjudna och kan inte väljas igen). */
  alreadyInvited?: readonly string[];
  /** Fler sätt att välja deltagare (per grupp, per nivå – senare spår). Lägger till ärende-id:n i samma val. */
  sources?: ReactNode;
  /** Unikt prefix för fältens id (två komponenter på samma sida). */
  idPrefix?: string;
};

/** Varför en deltagare inte kan väljas: redan inbjuden, ingen dag, eller insatsens läge den dagen. null = kan väljas. */
export function candidateBlock(c: InviteCandidate, day: LocalDate | null, already: ReadonlySet<string>): string | null {
  if (already.has(c.caseId)) return "Redan inbjuden";
  if (!day) return "Välj datum först";
  const b = inviteBlock(c, day);
  return b ? INVITE_BLOCK_TEXT[b] : null;
}

const norm = (s: string) => s.toLocaleLowerCase("sv").replace(/\s+/g, " ").trim();

export function InviteParticipants({ candidates, day, value, onChange, alreadyInvited = [], sources, idPrefix }: InviteParticipantsProps) {
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const prefix = idPrefix ?? `bjud-${auto}`;
  // Söktexten kan vara ett namn: bara i komponentens minne, aldrig i adressen eller webblagring.
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const already = useMemo(() => new Set(alreadyInvited), [alreadyInvited]);
  const selected = new Set(value);
  const q = norm(search);
  const matches = candidates.filter((c) => !q || norm(`${c.name} ${c.caseNumber}`).includes(q));
  const LIMIT = 40;
  const shown = showAll || q ? matches : matches.slice(0, LIMIT);
  const selectable = shown.filter((c) => !candidateBlock(c, day, already));
  const toggle = (caseId: string, on: boolean) => onChange(on ? [...value.filter((x) => x !== caseId), caseId] : value.filter((x) => x !== caseId));
  const chosen = candidates.filter((c) => selected.has(c.caseId));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-ui font-bold">Bjud in deltagare</legend>
      {sources}
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
            <Button kind="ghost" icon="check-square" onClick={() => onChange([...new Set([...value, ...selectable.map((c) => c.caseId)])])}>
              Välj alla som visas ({selectable.filter((c) => !selected.has(c.caseId)).length})
            </Button>
          )}
          {chosen.length > 0 && (
            <Button kind="ghost" icon="x" onClick={() => onChange([])}>
              Rensa valet
            </Button>
          )}
        </Row>
      </Row>
      {chosen.length > 0 && (
        <p className="m-0 text-small text-text-muted">
          Valda: {chosen.map((c) => `${c.name} (${c.caseNumber})`).join(", ")}
        </p>
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
                  disabled={!!block}
                  onCheckedChange={(on) => toggle(c.caseId, on)}
                  aria-describedby={descId}
                >
                  <span className="font-bold">{c.name}</span> <span className="tabular-nums text-text-muted">{c.caseNumber}</span>
                  <span id={descId} className="block text-small text-text-muted">
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
    </fieldset>
  );
}
