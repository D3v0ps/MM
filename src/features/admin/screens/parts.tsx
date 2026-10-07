"use client";
// Små delar som adminvyerna och arbetsgivarregistret delar (prototypens KV, Masonry, Group, Details, Pre, YesNo och Unset).
import { useId, useState, type ReactNode } from "react";
import { isUnset, unsetHint } from "@/core/config";
import { Badge, Icon, cn } from "@/ui";
import type { JobStatusView } from "../api";

export const UNSET_TEXT = "Ej fastställt – regeln aktiveras inte";

/** Bakgrundsjobbets status som märke med text och ikon (Underbiträden och integrationer och systemadministratörens Min vecka). */
export const JOB_STATUS: Record<JobStatusView, ReactNode> = {
  ok: <Badge tone="blue" icon="check">Klar</Badge>,
  waiting: <Badge tone="grey" icon="clock">Väntar</Badge>,
  disabled: <Badge tone="outline" icon="minus-circle">Inte aktiverad</Badge>,
  failed: <Badge tone="red" icon="alert">Fel</Badge>,
};

/** Etikett och värde på samma rad när det finns plats, annars under varandra (fungerar i smala kort och på 400 px). */
export function KV({ items, label = 170 }: { items: readonly (readonly [ReactNode, ReactNode] | null | false | undefined)[]; label?: number }) {
  const rows = items.filter((x): x is readonly [ReactNode, ReactNode] => !!x);
  return (
    <dl className="m-0">
      {rows.map(([k, v], i) => (
        <div key={i} className={cn("flex flex-wrap gap-x-4 gap-y-0.5 pb-[9px]", i > 0 && "border-t border-ljusgra pt-[9px]")}>
          <dt className="text-[0.9375rem] font-semibold text-text-muted" style={{ flex: `1 1 ${label}px`, maxWidth: `${label + 70}px` }}>
            {k}
          </dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]" style={{ flex: "999 1 200px" }}>
            {v == null || v === "" ? "–" : v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Kort i två spalter som fyller på uppifrån (kolumner, minst 380 px breda). */
export function Masonry({ items }: { items: readonly ReactNode[] }) {
  return (
    <div style={{ columns: "2 380px", columnGap: 16 }}>
      {items.filter(Boolean).map((x, i) => (
        <div key={i} className="mb-4 break-inside-avoid">
          {x}
        </div>
      ))}
    </div>
  );
}

/** Grupp av kryssrutor med rubrik (legend), hjälptext och felmeddelande. */
export function Group({ legend, help, error, children, id }: { legend: ReactNode; help?: ReactNode; error?: ReactNode; children?: ReactNode; id?: string }) {
  const auto = useId();
  const base = id ?? `g${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const describedBy = [help ? `${base}-help` : null, error ? `${base}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
      <legend className="mb-1.5 p-0 text-ui font-bold">{legend}</legend>
      {help && (
        <div id={`${base}-help`} className="-mt-1 mb-1 text-small leading-[1.45] text-text-muted">
          {help}
        </div>
      )}
      <div>{children}</div>
      {error && (
        <div id={`${base}-error`} role="alert" className="flex items-start gap-1.5 text-small font-bold text-antracit">
          <Icon name="alert-circle" className="mt-px text-rod" />
          <span>{error}</span>
        </div>
      )}
    </fieldset>
  );
}

/** Utfällbart kort. Pilen vänds när det är öppet och texten är understruken, så att det syns att det går att klicka. */
export function Details({ summary, children }: { summary: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-card border border-ljusgra bg-vit" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-[18px] py-2.5 font-bold [&::-webkit-details-marker]:hidden">
        <span className="inline-flex transition-transform duration-150" style={{ transform: `rotate(${open ? 180 : 0}deg)` }}>
          <Icon name="chevron-down" />
        </span>
        <span className="underline underline-offset-3">
          {open ? "Dölj" : "Visa"} {summary}
        </span>
      </summary>
      <div className="border-t border-ljusgra px-[18px] py-4">{children}</div>
    </details>
  );
}

/** Förformaterad text (JSON). */
export function Pre({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-[480px] overflow-auto rounded-mb bg-ljusgra-ton px-3.5 py-3 text-meta leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere]">
      {text}
    </pre>
  );
}

/** Ja/Nej med ikon (status visas aldrig bara med färg). */
export function YesNo({ v, yes = "Ja", no = "Nej" }: { v: boolean; yes?: string; no?: string }) {
  return (
    <span className="inline-flex flex-nowrap items-center gap-1.5">
      <Icon name={v ? "check-circle" : "x-circle"} />
      {v ? yes : no}
    </span>
  );
}

/** Värde som inte är fastställt: märke och förklaring ("Förslag: 5 arbetsdagar"). */
export function Unset({ v }: { v: unknown }) {
  const h = unsetHint(v);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Badge tone="red" icon="alert">
        {UNSET_TEXT}
      </Badge>
      {h && <span className="text-small text-text-muted">{h}</span>}
    </span>
  );
}

/** Ett konfigurationsvärde: ej fastställt, ja/nej, eget innehåll eller texten. */
export function Val({ v, children }: { v: unknown; children?: ReactNode }) {
  if (isUnset(v)) return <Unset v={v} />;
  if (typeof v === "boolean") return <YesNo v={v} />;
  if (children != null) return <>{children}</>;
  return <>{v == null || v === "" ? "–" : String(v)}</>;
}

/** Dämpad förklarande mening (16 px – meningar är aldrig mindre än brödtexten, Min veckas stil). */
export const Small = ({ children, className }: { children?: ReactNode; className?: string }) => <p className={cn("text-text-muted", className)}>{children}</p>;

export type StackColumn = { label: string; width?: string; /** Radrubrik (th scope=row) i stället för cell. */ rowHeader?: boolean; /** Etiketten visas ovanför värdet på mobil. */ mobileLabel?: boolean; nowrap?: boolean };
export type StackRow = { key: string; cells: ReactNode[]; selected?: boolean };

const TH = "border-b-2 border-antracit bg-vit px-3 py-2.5 text-left text-label font-extrabold tracking-[0.08em] whitespace-nowrap text-text-muted uppercase";
const TD = "border-b border-ljusgra px-3 py-2.5 align-top max-[720px]:border-0 max-[720px]:px-4 max-[720px]:py-[3px]";
const MOBILE_LABEL =
  "max-[720px]:before:mt-1 max-[720px]:before:mb-0.5 max-[720px]:before:block max-[720px]:before:text-label max-[720px]:before:font-extrabold max-[720px]:before:tracking-[0.08em] max-[720px]:before:text-text-muted max-[720px]:before:uppercase max-[720px]:before:content-[attr(data-label)]";

/** Tabell som på bred skärm har kolumner och på mobil visar en rad i taget med etikett per värde (ingen sidledsscroll). */
export function StackTable({ caption, columns, rows, empty }: { caption: string; columns: StackColumn[]; rows: StackRow[]; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card max-[720px]:overflow-visible">
      <table className="w-full border-collapse text-ui max-[720px]:block">
        <caption className="sr-only">{caption}</caption>
        <thead className="max-[720px]:sr-only">
          <tr>
            {columns.map((c) => (
              <th key={c.label} scope="col" className={TH} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-[720px]:block">
          {rows.length === 0 && (
            <tr className="max-[720px]:block">
              <td colSpan={columns.length} className={cn(TD, "text-text-muted max-[720px]:block max-[720px]:py-2.5")}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key} className={cn("max-[720px]:block max-[720px]:border-b max-[720px]:border-ljusgra max-[720px]:py-2", r.selected && "[&>td]:bg-bla-ton [&>th]:bg-bla-ton max-[720px]:bg-bla-ton")}>
              {r.cells.map((cell, i) => {
                const c = columns[i];
                if (c.rowHeader) {
                  return (
                    <th key={i} scope="row" className={cn(TD, "text-left align-top text-[0.9375rem] font-bold whitespace-normal text-antracit max-[720px]:block")}>
                      {cell}
                    </th>
                  );
                }
                return (
                  <td key={i} data-label={c.mobileLabel ? c.label : undefined} className={cn(TD, "max-[720px]:block", c.nowrap && "whitespace-nowrap", c.mobileLabel && MOBILE_LABEL)}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
