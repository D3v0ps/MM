"use client";
// Yrkesområdet på deltagarkortet och Byt yrkesområde (Karims beslut 2026-10-22). Bara Miljonbemanning: kommunens vyer visar
// som förut bara nuvarande yrkesområde. Huvudcoachen (och samordnare, avtalsansvarig) byter med en kort motivering – den sparas
// som en anteckning i deltagarkortet. Grupp och inbjudningar ändras direkt; fakturan räknas på det nya yrkesområdet från och med
// månaden efter bytet. Knappen står i dialogen Nivå och yrkesområde (Ändra i kortets huvud – yrkesområdet är deltagarens grupp)
// och bytena listas under huvudets rad ("22 okt: A → C (vem som bytte) – fakturan från november").
import { useState } from "react";
import { AREA_MOTIVATION_MAX, AREA_MOTIVATION_MIN } from "@/core/area-changes";
import { plural } from "@/core/format";
import { fmtDateShort, monthName } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, cn, Field, Kv, Modal, Notice, Select, Stack, TextArea, toast } from "@/ui";
import { caseAreaView, caseChangeArea, type CaseAreaView } from "../api";

/**
 * Knappen Byt yrkesområde med dialogen – i dialogen Nivå och yrkesområde (Ändra i kortets huvud, CaseGroupingRow areaAction), vid
 * yrkesområdet. Bara för den som får byta (coach, samordnare, avtalsansvarig med full åtkomst) i ett ärende som kan byta.
 */
export function CaseAreaChange({ caseId }: { caseId: string }) {
  const q = useQuery(caseAreaView, { caseId });
  const [open, setOpen] = useState(false);
  const v = q.data;
  if (!v) return null;
  // Ärendet kan inte byta (avslutat, inte bekräftat, inget yrkesområde än): orsaken i stället för knappen.
  if (!v.canChange) return v.blockedText ? <p className="m-0 text-body" data-area-blocked="">{v.blockedText}</p> : null;
  return (
    <>
      <Button kind="ghost" icon="edit" onClick={() => setOpen(true)}>
        Byt yrkesområde
      </Button>
      {open && <AreaModal v={v} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Bytena hittills under raden ("27 jan: G → D (Amira Haddad) – fakturan från februari"). Inget när ärendet inte har bytt. */
export function CaseAreaHistory({ caseId, className }: { caseId: string; className?: string }) {
  const q = useQuery(caseAreaView, { caseId });
  const v = q.data;
  if (!v || v.history.length === 0) return null;
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-0.5 p-0 text-small text-text-muted", className)} aria-label="Byten av yrkesområde" data-area-history="">
      {v.history.map((h) => (
        <li key={h.id}>
          {fmtDateShort(h.changedAt)}: {h.fromArea} → {h.toArea} ({h.byName}) – fakturan från {monthName(h.effectiveMonth).replace(/ \d{4}$/, "")}
        </li>
      ))}
    </ul>
  );
}

/** Meningen om inbjudningarna efter bytet: det nya yrkesområdets kommande aktiviteter och det gamlas. */
export function areaGroupsText(g: { invited: number; removed: number } | null): string {
  if (!g) return "";
  return [
    g.invited ? `Deltagaren är inbjuden till ${plural(g.invited, "kommande aktivitet", "kommande aktiviteter")} för det nya yrkesområdet.` : "",
    g.removed ? `Deltagaren är borttagen ur ${plural(g.removed, "kommande aktivitet", "kommande aktiviteter")} för det förra yrkesområdet.` : "",
  ].filter(Boolean).join(" ");
}

function AreaModal({ v, onClose }: { v: CaseAreaView; onClose: () => void }) {
  const save = useCommand(caseChangeArea);
  const [toArea, setToArea] = useState("");
  const [motivation, setMotivation] = useState("");
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ area?: string; motivation?: string }>({});
  const len = motivation.trim().length;
  const areaErr = tried && !toArea ? "Välj det nya yrkesområdet." : (serverErr.area ?? null);
  const motErr = tried && (len < AREA_MOTIVATION_MIN || len > AREA_MOTIVATION_MAX)
    ? `Skriv en kort motivering, ${AREA_MOTIVATION_MIN}–${AREA_MOTIVATION_MAX} tecken.`
    : (serverErr.motivation ?? null);
  const dirty = !!toArea || motivation.trim() !== "";
  const month = monthName(v.effectiveMonth);
  const submit = async () => {
    setTried(true);
    if (!toArea || len < AREA_MOTIVATION_MIN || len > AREA_MOTIVATION_MAX) return;
    const res = await save.run({ caseId: v.caseId, toArea, motivation: motivation.trim(), ...(v.current ? { fromArea: v.current.code } : {}) }).catch(() => null);
    if (!res || !res.ok) {
      if (res && !res.ok && (res.error === "area" || res.error === "same")) setServerErr({ area: res.message });
      else if (res && !res.ok && (res.error === "motivation" || res.error === "pnr")) setServerErr({ motivation: res.message });
      else toast(res && !res.ok && res.message ? res.message : "Yrkesområdet kunde inte bytas.", "error");
      return;
    }
    toast([`Yrkesområdet är bytt. Fakturan räknas på det nya yrkesområdet från och med ${monthName(res.effectiveMonth)}.`, areaGroupsText(res.groups)].filter(Boolean).join(" "));
    onClose();
  };
  return (
    <Modal
      title="Byt yrkesområde"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>Byt yrkesområde</Button>
        </>
      }
    >
      <Stack>
        <Kv items={[["Nuvarande yrkesområde", v.current ? `${v.current.code} – ${v.current.name}` : "Inte valt"]]} />
        <Field id="arn-area-new" label="Nytt yrkesområde" required error={areaErr} help="Avtalets yrkesområden A–L.">
          <Select
            id="arn-area-new"
            value={toArea}
            placeholder="Välj yrkesområde"
            invalid={!!areaErr}
            onValueChange={(x) => {
              setToArea(x);
              setServerErr((e) => ({ ...e, area: undefined }));
            }}
            options={v.options.map((a) => ({ value: a.code, label: `${a.code} – ${a.name}` }))}
          />
        </Field>
        <Field
          id="arn-area-why"
          label="Motivering"
          required
          error={motErr}
          help="Kort varför, t.ex. vad som kom fram i kartläggningen. Skriv inga personnummer."
        >
          <TextArea
            rows={3}
            value={motivation}
            maxLength={AREA_MOTIVATION_MAX}
            invalid={!!motErr}
            onValueChange={(x) => {
              setMotivation(x);
              setServerErr((e) => ({ ...e, motivation: undefined }));
            }}
          />
        </Field>
        <Notice tone="info" title="Det här händer">
          Grupp och inbjudningar ändras direkt. Fakturan räknas på det nya yrkesområdet från och med {month}. Motiveringen sparas som en anteckning i
          deltagarkortet. Kommunen ser bara det nya yrkesområdet.
        </Notice>
      </Stack>
    </Modal>
  );
}
