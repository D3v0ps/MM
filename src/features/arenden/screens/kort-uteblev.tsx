"use client";
// Deltagaren kom inte till första mötet (Karims beslut 2026-11-09): dialogen "Deltagaren kom inte" och rutan på deltagarkortets
// Översikt ("Kom inte till första mötet … – uteblev utan att meddela."), med Boka nytt första möte och Avsluta – deltagaren kom
// aldrig. Internt: kommunen får inget besked och ser det aldrig. Det räknas inte som närvaro och faktureras inte.
import { useRef, useState } from "react";
import { useCommand } from "@/shell/backend";
import { NO_SHOW_KIND_LABEL, NO_SHOW_REASON_HELP, NO_SHOW_REASON_MAX } from "@/core/first-meeting";
import { fmtDateTimeLong } from "@/core/time";
import { FIRST_MEETING_NO_SHOW_KINDS, type FirstMeetingNoShowKind } from "@/data/schema";
import { Button, Card, cn, Field, focusFirstError, Icon, Kv, Modal, Notice, Stack, TextArea, toast } from "@/ui";
import { caseFirstMeetingNoShow, type CaseCard } from "../api";
import { caseLink, Label, MiniList } from "./common";

/** "Deltagaren kom inte": vad som gäller (radioknappar), orsaken (krävs vid giltig frånvaro) och vad som händer. */
export function NoShowModal({ card, onClose }: { card: CaseCard; onClose: () => void }) {
  const save = useCommand(caseFirstMeetingNoShow);
  const [kind, setKind] = useState<FirstMeetingNoShowKind | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<{ kind?: string | null; reason?: string | null }>({});
  const body = useRef<HTMLDivElement>(null);
  const meetingAt = card.firstMeetingAt;
  if (!meetingAt) return null;
  const chars = [...reason.trim()].length;
  const submit = async () => {
    const e: { kind?: string; reason?: string } = {};
    if (!kind) e.kind = "Välj vad som gäller.";
    if (kind === "giltig" && !reason.trim()) e.reason = "Skriv orsaken till den giltiga frånvaron.";
    if (chars > NO_SHOW_REASON_MAX) e.reason = `Orsaken får vara högst ${NO_SHOW_REASON_MAX} tecken.`;
    setErr(e);
    if (Object.keys(e).length || !kind) {
      focusFirstError(body.current);
      return;
    }
    const res = await save.run({ caseId: card.caseId, meetingAt, kind, reason: reason.trim() || undefined }).catch(() => null);
    if (!res || !res.ok) {
      if (res && !res.ok && (res.error === "reason" || res.error === "pnr")) {
        setErr({ reason: res.message ?? "Orsaken kunde inte sparas." });
        focusFirstError(body.current);
        return;
      }
      toast(res && !res.ok && res.message ? res.message : "Det gick inte att spara. Försök igen.", "error");
      return;
    }
    toast(`Sparat: deltagaren kom inte till första mötet (${NO_SHOW_KIND_LABEL[kind].toLowerCase()}). Boka ett nytt första möte eller avsluta insatsen.`);
    onClose();
  };
  return (
    <Modal
      title="Deltagaren kom inte"
      onClose={onClose}
      dirty={!!kind || !!reason.trim()}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>Spara</Button>
        </>
      }
    >
      <div ref={body} className="flex flex-col gap-4">
        <Kv
          items={[
            ["Ärende", <span key="n" className="font-bold tabular-nums">{card.caseNumber}</span>],
            ["Första mötet", fmtDateTimeLong(meetingAt)],
          ]}
        />
        <fieldset
          className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
          aria-describedby={err.kind ? "arn-noshow-kind-err" : undefined}
          data-invalid={err.kind ? "" : undefined}
        >
          <legend className="mb-0.5 p-0 text-ui font-bold">Vad gäller? <span className="font-normal text-text-muted">(krävs)</span></legend>
          {FIRST_MEETING_NO_SHOW_KINDS.map((k) => (
            <label
              key={k}
              htmlFor={`arn-noshow-${k}`}
              className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-mb border-[1.5px] border-line-strong px-3 py-2", kind === k && "border-2 border-antracit bg-bla-ton")}
            >
              <input
                type="radio"
                name="arn-noshow-kind"
                id={`arn-noshow-${k}`}
                value={k}
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setErr({ ...err, kind: null });
                }}
                className="m-0 size-5 flex-none accent-antracit"
              />
              <span>{NO_SHOW_KIND_LABEL[k]}</span>
            </label>
          ))}
          {err.kind && (
            <div id="arn-noshow-kind-err" role="alert" className="flex items-start gap-1.5 text-small font-bold">
              <Icon name="alert-circle" className="mt-px text-rod" />
              {err.kind}
            </div>
          )}
        </fieldset>
        <Field
          label={kind === "giltig" ? "Orsak" : "Orsak (frivillig vid uteblev)"}
          id="arn-noshow-reason"
          required={kind === "giltig"}
          error={err.reason}
          help={`${NO_SHOW_REASON_HELP} ${chars} av ${NO_SHOW_REASON_MAX} tecken.`}
        >
          <TextArea
            value={reason}
            onValueChange={(v) => {
              setReason(v);
              if (err.reason) setErr({ ...err, reason: null });
            }}
            rows={3}
          />
        </Field>
        <Card tone="sub">
          <Stack gap="sm">
            <Label className="m-0">Det här händer när du sparar</Label>
            <MiniList
              items={[
                { key: "kommun", icon: "lock", children: "Kommunen får inget besked och ser det inte. Det är bara för Miljonbemanning." },
                { key: "narvaro", icon: "minus-circle", children: "Det räknas inte som närvaro och faktureras inte. Inga tillfällen skapas och insatsen startar inte." },
                { key: "nasta", icon: "calendar", children: "Sedan bokar ni ett nytt första möte eller avslutar insatsen om deltagaren aldrig kom. Det syns i tidslinjen." },
              ]}
            />
          </Stack>
        </Card>
      </div>
    </Modal>
  );
}

/**
 * Rutan på Översikt när det är registrerat för ärendets nuvarande första möte – i stället för "Första mötet har hållits – starta
 * insatsen". Boka nytt första möte (samordnare, avtalsansvarig och coachen) och Avsluta – deltagaren kom aldrig (coachen).
 */
export function NoShowNotice({ card, onRebook }: { card: CaseCard; onRebook: () => void }) {
  const ns = card.noShow;
  const cur = ns?.current;
  if (!ns || !cur) return null;
  const readOnly = card.readOnly || !card.edit;
  return (
    <Notice tone="warn" icon="x-circle" title={cur.text}>
      <Stack gap="sm">
        {cur.reason && <div>Orsak: {cur.reason}</div>}
        <div>
          {readOnly
            ? "Ett nytt första möte bokas, eller så avslutas insatsen om deltagaren aldrig kom."
            : "Boka ett nytt första möte, eller avsluta insatsen om deltagaren aldrig kom. Kommunen har inte fått något besked."}
        </div>
        {(ns.canRebook || ns.canClose) && (
          <div className="flex flex-wrap gap-2">
            {ns.canRebook && (
              <Button kind="primary" icon="calendar" onClick={onRebook}>
                Boka nytt första möte
              </Button>
            )}
            {ns.canClose && (
              <Button icon="check-square" to={caseLink("/handelse", card.caseId, { lage: "avslut" })}>
                Avsluta – deltagaren kom aldrig
              </Button>
            )}
          </div>
        )}
      </Stack>
    </Notice>
  );
}
