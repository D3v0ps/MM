// Tabell (prototypens Table). Klickbara rader går att nå med tangentbordet (Tab + Enter/mellanslag).
// rowHref: raden leder till en sida. En cell (linkKey, standard första kolumnen) blir en riktig länk – den är tabbstoppet,
// högerklick ger länkmenyn och ctrl/cmd-klick eller mittenklick öppnar en ny flik. Klick på resten av raden gör samma sak.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Link, useNavOptional, type Nav } from "@/shell/nav";
import { cn } from "./cn";

export type Column<R> = {
  /** Fältnamn i raden (används om render saknas). */
  key: string;
  label: ReactNode;
  render?: (row: R) => ReactNode;
  /** Högerställd siffra med tabellsiffror. */
  num?: boolean;
  /** CSS-bredd, t.ex. "140px" eller "20%". */
  width?: string;
  nowrap?: boolean;
};

export type RowTone = "alert" | "muted" | "selected";

export type TableProps<R> = {
  columns: Column<R>[];
  rows: R[];
  /** Nyckel per rad: fältnamn (standard "id") eller funktion. */
  rowKey?: keyof R | ((row: R) => string);
  onRowClick?: (row: R) => void;
  /** Markering per rad: alert (röd vänsterkant), muted (dämpad text), selected (blå ton). */
  rowTone?: (row: R) => RowTone | null | undefined;
  /** Text när rows är tom. */
  empty?: ReactNode;
  /** Rader i <tfoot> (summeringar). Skicka <tr><td>…</td></tr>. */
  footer?: ReactNode;
  /** Tabellens namn för skärmläsare (visas inte). */
  caption?: string;
  /** Extra attribut per rad, t.ex. { "data-mal": "att:2027-W04" } (målet när man öppnar raden från tidslinjen). */
  rowAttrs?: (row: R) => Record<string, string>;
  /** Raden leder till en sida (null = raden är inte klickbar). Går före onRowClick. */
  rowHref?: (row: R) => string | null;
  /**
   * Kolumnen vars innehåll blir länken (standard: första kolumnen). Välj en kolumn utan egna länkar eller knappar.
   * false = skärmen ritar själv en länk i raden (t.ex. bara rubriken i en cell med rubrik och underrad).
   */
  linkKey?: string | false;
  className?: string;
};

/** Klick någonstans i en rad som leder till en sida (inte på länkar, knappar eller fält i raden). */
export function rowNavigate(nav: Nav, to: string, e: MouseEvent<HTMLElement>): void {
  if (e.defaultPrevented) return;
  const t = e.target as Element | null;
  if (t?.closest("a, button, input, select, textarea, label, summary")) return;
  // Markerad text: användaren kopierar – ingen navigering.
  if (typeof window !== "undefined" && (window.getSelection()?.toString() ?? "") !== "") return;
  if (e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey) {
    e.preventDefault();
    window.open(nav.href(to), "_blank", "noopener");
    return;
  }
  if (e.button === 0) nav.push(to);
}

const TONE: Record<RowTone, string> = {
  alert: "[&>td:first-child]:shadow-[inset_4px_0_0_var(--color-rod)]",
  muted: "[&>td]:text-text-muted",
  selected: "[&>td]:bg-bla-ton",
};

export function Table<R>({ columns, rows, rowKey = "id" as keyof R, onRowClick, rowTone, empty = "Inget att visa.", footer, caption, rowAttrs, rowHref, linkKey, className }: TableProps<R>) {
  const nav = useNavOptional();
  const linkCol = linkKey === false ? null : (linkKey ?? columns[0]?.key);
  const keyOf = (r: R, i: number): string => {
    if (typeof rowKey === "function") return rowKey(r);
    const v = (r as Record<string, unknown>)[rowKey as string];
    return v === undefined || v === null ? String(i) : String(v);
  };
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, r: R) => {
    if (e.target !== e.currentTarget) return; // knappar och länkar i raden sköter sig själva
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(r);
    }
  };
  return (
    <div className={cn("overflow-x-auto rounded-card", className)}>
      <table className="w-full border-collapse text-body portal:text-portal [&_tfoot_td]:border-t-2 [&_tfoot_td]:border-b-0 [&_tfoot_td]:border-antracit [&_tfoot_td]:px-3 [&_tfoot_td]:py-2.5 [&_tfoot_td]:font-bold">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  "border-b-2 border-antracit bg-vit px-3 py-2.5 text-left text-label font-extrabold tracking-[0.08em] whitespace-nowrap text-text-muted uppercase portal:text-body",
                  c.num && "text-right tabular-nums",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="border-b border-ljusgra px-3 py-2.5 align-top text-text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => {
            const tone = rowTone?.(r);
            const href = nav ? (rowHref?.(r) ?? null) : null;
            const clickable = !!href || !!onRowClick;
            return (
              <tr
                {...rowAttrs?.(r)}
                key={keyOf(r, i)}
                className={cn(clickable && "cursor-pointer hover:[&>td]:bg-ljusgra-ton", tone && TONE[tone])}
                onClick={href && nav ? (e) => rowNavigate(nav, href, e) : onRowClick ? () => onRowClick(r) : undefined}
                onAuxClick={href && nav ? (e) => rowNavigate(nav, href, e) : undefined}
                // Med rowHref är länken i raden tabbstoppet – raden behöver inget eget.
                tabIndex={!href && onRowClick ? 0 : undefined}
                onKeyDown={!href && onRowClick ? (e) => onKey(e, r) : undefined}
              >
                {columns.map((c) => {
                  const content = c.render ? c.render(r) : ((r as Record<string, unknown>)[c.key] as ReactNode);
                  return (
                    <td key={c.key} className={cn("border-b border-ljusgra px-3 py-2.5 align-top", c.num && "text-right tabular-nums", c.nowrap && "whitespace-nowrap")}>
                      {href && c.key === linkCol ? (
                        <Link to={href} className="inline-flex min-h-11 flex-col justify-center font-bold text-antracit underline underline-offset-3">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

/** Liten dämpad underrad i en tabellcell (prototypens cell-sub). */
export function CellSub({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("text-small text-text-muted portal:text-portal", className)}>{children}</div>;
}
