"use client";
// Anteckningar (/anteckningar) – massanteckningar i Workbuster-stil (coachmötet 2026-10-09, Karims beslut 4): välj Mina
// ärenden, en nivå, en grupp eller en tagg och skriv en rad per deltagare. Datumet är i dag (går att ändra), ingen tid,
// typen är förvald. "Spara N anteckningar" sparar en vanlig anteckning i deltagarkortet per ifylld rad – tomma rader hoppas
// över. Allt eller inget: ett personnummer eller ett fel på någon rad stoppar sparningen, och felet visas vid raden.
// Urvalet ligger i adressen (bara id:n), texterna bara i minnet (useDraft) – aldrig i adressen eller webblagring.
import { useState } from "react";
import { CASE_NOTE_KIND_LABEL } from "@/core/labels";
import { massNotePnrRows, massNoteRowsToSave } from "@/core/mass-notes";
import { useCommand, useQuery } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import type { ScreenProps } from "@/shell/routes";
import { pick, useQueryPatch } from "@/shell/url-state";
import { Badge, Button, Card, CaseStatusBadge, DateInput, Empty, ErrorNotice, Field, FormGrid, Loading, Notice, Page, Row, Select, Spacer, Stack, TextArea, toast } from "@/ui";
import { CASE_NOTE_KINDS, type CaseNoteKind } from "@/data/schema";
import { massNotePage, massNoteSave, MASS_NOTE_SCOPES, type GroupingCatalog, type MassNotePage, type MassNoteScope } from "../api";

const SCOPE_LABEL: Record<MassNoteScope, string> = { mina: "Mina ärenden", niva: "En nivå", grupp: "En grupp", tagg: "En tagg" };

export function AnteckningarScreen({ query }: ScreenProps) {
  const patch = useQueryPatch();
  const urval = pick(query, "urval", MASS_NOTE_SCOPES, "mina");
  const id = query.get("id") ?? undefined;
  const q = useQuery(massNotePage, { urval, id: urval === "mina" ? undefined : id }, { keepPrevious: true });
  const actions = (
    <Button kind="ghost" icon="layers" to="/grupper">
      Grupper och nivåer
    </Button>
  );
  if (q.error) return <Page title="Anteckningar" actions={actions}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page title="Anteckningar" actions={actions}><Loading /></Page>;
  const choices = choicesFor(urval, q.data.catalog);
  const chosenId = choices.some((c) => c.value === id) ? (id as string) : "";
  return (
    <Page
      title="Anteckningar"
      lead="Skriv en rad per deltagare, till exempel efter en gruppträff. Varje rad sparas som en anteckning i deltagarens kort."
      actions={actions}
    >
      <Card title="Välj deltagare" icon="filter">
        <FormGrid>
          <Field label="Visa" id="mn-urval">
            <Select value={urval} onValueChange={(v) => patch({ urval: v === "mina" ? null : v, id: null })} options={MASS_NOTE_SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} />
          </Field>
          {urval !== "mina" && (
            <Field label={urval === "niva" ? "Nivå" : urval === "grupp" ? "Grupp" : "Tagg"} id="mn-id">
              <Select value={chosenId} placeholder={urval === "niva" ? "Välj nivå" : urval === "grupp" ? "Välj grupp" : "Välj tagg"} onValueChange={(v) => patch({ id: v || null })} options={choices} />
            </Field>
          )}
        </FormGrid>
      </Card>
      {urval !== "mina" && !chosenId ? (
        <Card>
          <Empty icon="users" title={urval === "niva" ? "Välj en nivå" : urval === "grupp" ? "Välj en grupp" : "Välj en tagg"}>
            Deltagarna visas när du har valt.
          </Empty>
        </Card>
      ) : (
        <Rows key={`${urval}|${chosenId}`} draftKey={`anteckningar|${urval}|${chosenId}`} data={q.data} />
      )}
    </Page>
  );
}

function choicesFor(urval: MassNoteScope, cat: GroupingCatalog | null): { value: string; label: string }[] {
  if (!cat) return [];
  if (urval === "niva") return cat.levels.map((g) => ({ value: g.id, label: `${g.name} (${g.members})` }));
  if (urval === "grupp") return cat.groups.map((g) => ({ value: g.id, label: `${g.name} (${g.members})` }));
  if (urval === "tagg") return cat.tags.flatMap((t) => t.values.map((g) => ({ value: g.id, label: `${t.category}: ${g.name} (${g.members})` })));
  return [];
}

type Draft = { kind: CaseNoteKind; date: string; texts: Record<string, string> };

function Rows({ data, draftKey }: { data: MassNotePage; draftKey: string }) {
  const save = useCommand(massNoteSave);
  const d = useDraft<Draft>(draftKey, () => ({ kind: "conversation", date: data.today, texts: {} }));
  const { kind, date, texts } = d.value;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const filled = massNoteRowsToSave(data.rows, texts, date);
  const dirty = filled.length > 0;
  useUnsavedGuard(dirty && !save.pending);
  const setText = (caseId: string, v: string) => {
    d.set((x) => ({ ...x, texts: { ...x.texts, [caseId]: v } }));
    if (errors[caseId]) setErrors((e) => {
      const n = { ...e };
      delete n[caseId];
      return n;
    });
  };
  const submit = async () => {
    setFormError(null);
    if (!filled.length) return;
    if (date > data.today) {
      setFormError("Datumet kan inte vara senare än i dag.");
      return;
    }
    // Personnummer stoppas redan här, vid raden (servern kontrollerar igen).
    const pnr = massNotePnrRows(filled);
    if (pnr.length) {
      setErrors(Object.fromEntries(pnr.map((id) => [id, "Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker."])));
      setFormError(pnr.length === 1 ? "En rad behöver rättas. Inget är sparat." : `${pnr.length} rader behöver rättas. Inget är sparat.`);
      document.getElementById(`mn-rad-${pnr[0]}`)?.focus();
      return;
    }
    const res = await save.run({ kind, rows: filled }).catch(() => null);
    if (!res) {
      setFormError("Anteckningarna kunde inte sparas. Försök igen.");
      return;
    }
    if (!res.ok) {
      setErrors(res.fields ?? {});
      setFormError(res.message ?? "Något behöver rättas. Inget är sparat.");
      const first = Object.keys(res.fields ?? {})[0];
      if (first) document.getElementById(`mn-rad-${first}`)?.focus();
      return;
    }
    d.set((x) => ({ ...x, texts: {} }));
    d.clear();
    setErrors({});
    toast(res.saved === 1 ? "1 anteckning är sparad." : `${res.saved} anteckningar är sparade.`);
  };

  if (!data.rows.length) {
    return (
      <Card>
        <Empty icon="users" title="Inga deltagare">
          Det finns inga pågående ärenden i urvalet.
        </Empty>
      </Card>
    );
  }
  return (
    <>
      <Card title="Typ och datum" icon="calendar">
        <FormGrid>
          <Field label="Typ" id="mn-typ" help="Gäller alla rader.">
            <Select value={kind} onValueChange={(v) => d.set((x) => ({ ...x, kind: v as CaseNoteKind }))} options={CASE_NOTE_KINDS.map((k) => ({ value: k, label: CASE_NOTE_KIND_LABEL[k] }))} />
          </Field>
          <Field label="Datum" id="mn-datum" help="I dag är förvalt. Ändra om anteckningarna gäller en annan dag.">
            <DateInput value={date} max={data.today} onValueChange={(v) => d.set((x) => ({ ...x, date: v || data.today }))} />
          </Field>
        </FormGrid>
      </Card>
      {d.restored && dirty && (
        <Notice tone="info" icon="edit" title="Det du skrev senast finns kvar">
          Det är inte sparat ännu.
        </Notice>
      )}
      <Card
        flush
        title={`${data.rows.length} ${data.rows.length === 1 ? "deltagare" : "deltagare"}`}
        icon="users"
        foot={
          <>
            <span className="text-small text-text-muted">Tomma rader sparas inte.</span>
            <Spacer />
            <Button kind="primary" icon="check" disabled={!filled.length} pending={save.pending} onClick={() => void submit()}>
              {filled.length === 1 ? "Spara 1 anteckning" : `Spara ${filled.length} anteckningar`}
            </Button>
          </>
        }
      >
        {formError && (
          <div className="px-[18px] pt-3">
            <Notice tone="warn" title={formError} />
          </div>
        )}
        <ul className="flex flex-col" aria-label="Deltagare">
          {data.rows.map((r) => (
            <li key={r.caseId} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-ljusgra px-[18px] py-3 last:border-b-0" data-mass-note-row={r.caseId}>
              <Stack gap="sm" className="w-[min(100%,260px)] flex-none">
                <span className="font-bold">{r.name}</span>
                <Row gap="sm">
                  <span className="text-small tabular-nums text-text-muted">{r.caseNumber}</span>
                  <CaseStatusBadge status={r.status} />
                </Row>
                {r.levelName && (
                  <Badge tone="blue" icon="layers">
                    {r.levelName}
                  </Badge>
                )}
              </Stack>
              <div className="min-w-[min(100%,280px)] flex-1">
                <Field label={`Anteckning för ${r.name}`} id={`mn-rad-${r.caseId}`} error={errors[r.caseId]}>
                  <TextArea rows={2} maxLength={2000} value={texts[r.caseId] ?? ""} onValueChange={(v) => setText(r.caseId, v)} />
                </Field>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
