"use client";
// SMS att skicka på coachens Min vecka (Karims beslut 2026-11-11, SPEC §9): SMS till deltagare är inte kopplat, så coachen skickar
// SMS:et själv. Två listor (granskningen 2026-11-11): Veckans tider att skicka (från fredag för nästa vecka, tills veckans första
// tillfälle börjar) och SMS att skicka (meddelanden som inte kunde skickas automatiskt). Först coachens egna deltagare (huvudcoach
// eller i teamet) – Visa alla visar alla i avtalet med huvudcoachens förnamn. Raden har deltagaren, numret som markerbar text med
// Kopiera numret, texten med Kopiera texten och Markera som skickat. Efter Kopiera numret: Öppna SMS – en sms:-länk med bara texten
// (tid, plats och Miljonbemannings telefonnummer); numret står aldrig i en länk (CLAUDE.md punkt 2). Inga nya hjälptexter.
import { useRef, useState } from "react";
import { PhoneToCopy } from "@/features/inkorg/screens/min-vecka";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, buttonVariants, CaseName, Check, cn, DoneLine, focusSoon, Icon, toast, TodoList, type TodoItem } from "@/ui";
import { smsAttSkicka, smsMarkSent, type SmsKind, type SmsToSendRow } from "../api";

/** Vad SMS:et gäller – radens anmärkning (samma ord som mallarna i adminvyn). */
const KIND_LABEL: Record<Exclude<SmsKind, "veckoschema">, string> = {
  kallelse: "Kallelse till första mötet",
  aktivitetsinbjudan: "Inbjudan till aktivitet",
  aktivitet_andrad: "Ändrad aktivitet",
  aktivitet_installd: "Inställd aktivitet",
};
const kindText = (r: SmsToSendRow): string => (r.kind === "veckoschema" ? `Veckans tider – vecka ${r.week ?? ""}`.trim() : KIND_LABEL[r.kind]);
/** Radens id (fokus efter Markera som skickat). */
const rowId = (key: string): string => `sms-${key.replace(/[^A-Za-z0-9-]/g, "-")}`;

export function SmsAttSkicka() {
  const q = useQuery(smsAttSkicka, {});
  const [all, setAll] = useState(false);
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  const shown = all ? rows : rows.filter((r) => r.mine);
  const weekly = shown.filter((r) => r.kind === "veckoschema");
  const other = shown.filter((r) => r.kind !== "veckoschema");
  const toggle = rows.some((r) => !r.mine) ? (
    <Check id="mv-sms-alla" checked={all} onCheckedChange={setAll}>
      Visa alla
    </Check>
  ) : null;
  // Efter Markera som skickat: nästa rad i samma lista, annars den andra listans rubrik, annars Att göra i dag (listan försvinner).
  const focusAfter = (list: readonly SmsToSendRow[], key: string) => {
    const i = list.findIndex((r) => r.key === key);
    const next = list[i + 1] ?? list[i - 1];
    const otherList = list === weekly ? other : weekly;
    focusSoon(next ? rowId(next.key) : otherList.length ? (otherList === weekly ? "mv-sms-vecka-rubrik" : "mv-sms-rubrik") : "mv-att-gora-rubrik");
  };
  const items = (list: readonly SmsToSendRow[]): TodoItem[] =>
    list.map((r) => ({
      key: r.key,
      id: rowId(r.key),
      testId: "sms-rad",
      icon: "message",
      title: <CaseName big caseId={r.caseId} name={r.name} caseNumber={r.caseNumber} />,
      notes: [all && r.leadCoach ? `${kindText(r)} · huvudcoach ${r.leadCoach}` : kindText(r)],
      children: <SmsBody row={r} />,
      action: <MarkSent row={r} onDone={() => focusAfter(list, r.key)} />,
    }));
  if (!weekly.length && !other.length) {
    return (
      <DoneLine id="mv-sms" title="SMS att skicka" icon="message">
        <span className="inline-flex flex-wrap items-center gap-x-3">Inget att göra just nu. {toggle}</span>
      </DoneLine>
    );
  }
  return (
    <>
      {weekly.length > 0 && (
        <TodoList id="mv-sms-vecka" title={`Veckans tider att skicka (${weekly.length})`} icon="message" summary={toggle} items={items(weekly)} initial={5} />
      )}
      {other.length > 0 && (
        <TodoList id="mv-sms" title={`SMS att skicka (${other.length})`} icon="message" summary={weekly.length ? undefined : toggle} items={items(other)} initial={5} />
      )}
    </>
  );
}

/** Numret, texten och – efter Kopiera numret – Öppna SMS. */
function SmsBody({ row }: { row: SmsToSendRow }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <PhoneToCopy phone={row.phone} caseNumber={row.caseNumber} onCopied={() => setCopied(true)} />
      <SmsText text={row.text} caseNumber={row.caseNumber} />
      {copied && (
        <a href={smsHref(row.text)} className={cn(buttonVariants({ kind: "ghost" }), "-ml-1.5 self-start px-1.5")}>
          <Icon name="send" />
          Öppna SMS <span className="sr-only">till deltagaren i {row.caseNumber}</span>
        </a>
      )}
    </div>
  );
}

/**
 * Länken som öppnar telefonens SMS-app med texten ifylld – mottagaren klistrar coachen in (numret står aldrig i länken, CLAUDE.md
 * punkt 2). iPhone och iPad vill ha "sms:&body=", andra "sms:?body=".
 */
export function smsHref(text: string, userAgent: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  return `sms:${ios ? "&" : "?"}body=${encodeURIComponent(text)}`;
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

/**
 * Markera som skickat: raden försvinner för alla. Kommandot har det coachen såg – veckans tillfällen eller meddelandets id – så att
 * markeringen går också när tiden har gått. Har tiderna ändrats visas den nya raden i stället.
 */
function MarkSent({ row, onDone }: { row: SmsToSendRow; onDone: () => void }) {
  const mark = useCommand(smsMarkSent);
  const run = async () => {
    const input = { key: row.key, text: row.text, ...(row.slots ? { slots: row.slots } : {}), ...(row.messageId ? { messageId: row.messageId } : {}) };
    const res = await mark.run(input).catch(() => null);
    if (res && res.ok) {
      toast(res.already ? "SMS:et var redan markerat som skickat." : "SMS:et är markerat som skickat.");
      onDone();
    } else toast((res && !res.ok && res.message) || "SMS:et kunde inte markeras som skickat.", "error");
  };
  return (
    <Button icon="check" pending={mark.pending} onClick={() => void run()}>
      Markera som skickat <span className="sr-only">– SMS till deltagaren i {row.caseNumber}</span>
    </Button>
  );
}
