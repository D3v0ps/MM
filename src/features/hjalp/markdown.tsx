// Minimal markdown-till-React för lathundarna (docs/lathund/*.md): rubriker (# ## ###), stycken, punktlistor, numrerade
// listor, kodblock (```), fet text (**…**), kod i text (`…`) och länkar [text](adress). Inget annat – lathundarna skrivs
// med bara de delarna. Inget bibliotek: markdown-rendering finns inte bland beroendena och texten är vår egen.
// Inga next/*-importer (koden körs även i prototypen). Länkar inom appen (börjar med /) går via Link från @/shell/nav.
import { Fragment, type ReactNode } from "react";
import { Link } from "@/shell/nav";
import { cn, Dot } from "@/ui";

export type MdBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

/** Markdown-texten som block. Tomma rader skiljer block; en lista slutar vid första rad som inte är en listrad. */
export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++; // avslutande ```
      blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, text: h[2] });
      i++;
      continue;
    }
    const li = /^\s*(?:[-*]|\d+[.)])\s+/.test(line);
    if (li) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""));
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^#{1,3}\s/.test(lines[i]) && !/^\s*(?:[-*]|\d+[.)])\s+/.test(lines[i])) buf.push(lines[i++].trim());
    blocks.push({ kind: "paragraph", text: buf.join(" ") });
  }
  return blocks;
}

/** Rubriken på nivå 1 (dokumentets titel), om den finns. */
export const markdownTitle = (md: string): string | null => parseMarkdown(md).find((b): b is Extract<MdBlock, { kind: "heading" }> => b.kind === "heading" && b.level === 1)?.text ?? null;

/** Fet text, kod i text och länkar inuti en rad. */
export function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] != null) parts.push(<b key={k++} className="font-bold">{m[1]}</b>);
    else if (m[2] != null) parts.push(<code key={k++} className="rounded-mb bg-ljusgra-ton px-1 tabular-nums tracking-[0.01em]">{m[2]}</code>);
    else if (m[4].startsWith("/")) parts.push(<Link key={k++} to={m[4]} className="underline">{m[3]}</Link>);
    else parts.push(<a key={k++} href={m[4]} className="underline" rel="noreferrer">{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts.map((p, idx) => <Fragment key={idx}>{p}</Fragment>);
}

/** Id för ett avsnitt ("Logga in" -> "logga-in") – för länkar inom sidan. */
export const headingId = (text: string): string =>
  text.toLowerCase().replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type MarkdownProps = {
  md: string;
  /** Rubriken på nivå 1 visas inte (sidan har redan sin sidrubrik). */
  skipTitle?: boolean;
  /** Kodblock får en knapp "Kopiera" (anroparen kopierar – src/ui/download useCopy). */
  renderCode?: (text: string, index: number) => ReactNode;
  className?: string;
};

/**
 * Lathunden som sida: rubriker i versaler med röd punkt (nivå 2) och fet text (nivå 3), brödtext i antracit, listor med
 * punkter eller siffror, kodblock i en tonad ruta. Storleken kommer från området (16 px i appen, 18 px i portalen).
 */
export function Markdown({ md, skipTitle, renderCode, className }: MarkdownProps) {
  const blocks = parseMarkdown(md);
  let codeIndex = 0;
  return (
    <div className={cn("flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            if (b.level === 1) return skipTitle ? null : <p key={i} className="m-0 max-w-[70ch] text-text-muted">{inline(b.text)}</p>;
            if (b.level === 2)
              return (
                <h2 key={i} id={headingId(b.text)} className="mt-5 flex items-center gap-2.5 text-h2 font-extrabold tracking-[0.03em] uppercase portal:text-[1.25rem]">
                  <Dot className="size-2 flex-none" />
                  {inline(b.text)}
                </h2>
              );
            return (
              <h3 key={i} id={headingId(b.text)} className="mt-2 text-h3 font-bold portal:text-portal">
                {inline(b.text)}
              </h3>
            );
          case "paragraph":
            return (
              <p key={i} className="m-0 max-w-[70ch]">
                {inline(b.text)}
              </p>
            );
          case "list": {
            const L = b.ordered ? "ol" : "ul";
            return (
              <L key={i} className={cn("m-0 flex max-w-[70ch] flex-col gap-2 pl-6", b.ordered ? "list-decimal" : "list-disc")}>
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    {inline(it)}
                  </li>
                ))}
              </L>
            );
          }
          case "code": {
            const idx = codeIndex++;
            return (
              <div key={i} className="flex flex-col gap-2">
                <pre className="m-0 overflow-x-auto rounded-card border border-ljusgra bg-ljusgra-ton2 p-4 text-small leading-[1.6] whitespace-pre-wrap portal:text-body">
                  <code>{b.text}</code>
                </pre>
                {renderCode?.(b.text, idx)}
              </div>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
