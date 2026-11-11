"use client";
// SMS att skicka på coachens Min vecka (Karims beslut 2026-11-11, SPEC §9): SMS till deltagare är inte kopplat, så coachen skickar
// SMS:et själv. En rad per SMS – veckans tider (från fredag för nästa vecka) och meddelanden som inte kunde skickas automatiskt.
// Raden har deltagaren, numret som markerbar text med Kopiera numret (aldrig en tel:- eller sms:-länk – inga personuppgifter i
// URL:er, CLAUDE.md punkt 2), texten med Kopiera texten och Markera som skickat. Inga nya hjälptexter.
import { useRef } from "react";
import { PhoneToCopy } from "@/features/inkorg/screens/min-vecka";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, CaseName, focusSoon, toast, TodoList, type TodoItem } from "@/ui";
import { smsAttSkicka, smsMarkSent, type SmsKind, type SmsToSendRow } from "../api";

/** Vad SMS:et gäller – radens anmärkning (samma ord som mallarna i adminvyn). */
const KIND_LABEL: Record<Exclude<SmsKind, "veckoschema">, string> = {
  kallelse: "Kallelse till första mötet",
  aktivitetsinbjudan: "Inbjudan till aktivitet",
  aktivitet_andrad: "Ändrad aktivitet",
  aktivitet_installd: "Inställd aktivitet",
};
const kindText = (r: SmsToSendRow): string => (r.kind === "veckoschema" ? `Veckans tider – vecka ${r.week ?? ""}`.trim() : KIND_LABEL[r.kind]);

export function SmsAttSkicka() {
  const q = useQuery(smsAttSkicka, {});
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  const items: TodoItem[] = rows.map((r) => ({
    key: r.key,
    testId: "sms-rad",
    icon: "message",
    title: <CaseName big caseId={r.caseId} name={r.name} caseNumber={r.caseNumber} />,
    notes: [r.leadCoach ? `${kindText(r)} · huvudcoach ${r.leadCoach}` : kindText(r)],
    children: (
      <div className="flex min-w-0 flex-col gap-1">
        <PhoneToCopy phone={r.phone} caseNumber={r.caseNumber} />
        <SmsText text={r.text} caseNumber={r.caseNumber} />
      </div>
    ),
    action: <MarkSent row={r} />,
  }));
  return <TodoList id="mv-sms" title={`SMS att skicka (${rows.length})`} icon="message" items={items} initial={5} />;
}

/**
 * Texten som markerbar text med Kopiera texten. navigator.clipboard.writeText anropas direkt i klickhändelsen; går det inte
 * markeras texten så att den kan kopieras med tangentbordet (som numret).
 */
function SmsText({ text, caseNumber }: { text: string; caseNumber: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Texten är kopierad.");
    } catch {
      const el = ref.current;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (el && sel) sel.selectAllChildren(el);
      toast("Texten kunde inte kopieras automatiskt. Den är markerad – kopiera den med Ctrl+C (Cmd+C på Mac).", "error");
    }
  };
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p ref={ref} data-sms-text="" className="m-0 max-w-prose rounded-mb border border-ljusgra bg-vit px-3 py-2 break-words text-antracit select-all">
        {text}
      </p>
      <Button kind="ghost" icon="copy" className="-ml-1.5 px-1.5" onClick={() => void copy()}>
        Kopiera texten <span className="sr-only">till deltagaren i {caseNumber}</span>
      </Button>
    </div>
  );
}

/** Markera som skickat: raden försvinner för alla. Har texten ändrats (nya tider) visas den nya raden i stället. */
function MarkSent({ row }: { row: SmsToSendRow }) {
  const mark = useCommand(smsMarkSent);
  const run = async () => {
    const res = await mark.run({ key: row.key, text: row.text }).catch(() => null);
    if (res && res.ok) {
      toast(res.already ? "SMS:et var redan markerat som skickat." : "SMS:et är markerat som skickat.");
      focusSoon("mv-sms-rubrik");
    } else toast((res && !res.ok && res.message) || "SMS:et kunde inte markeras som skickat.", "error");
  };
  return (
    <Button icon="check" pending={mark.pending} onClick={() => void run()}>
      Markera som skickat <span className="sr-only">– SMS till deltagaren i {row.caseNumber}</span>
    </Button>
  );
}
