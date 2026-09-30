// PDF-förhandsvisning i MB:s profil (prototypens Paper): logotyp överst, avtals- och ärendeinformation i högerställt block,
// rubriker i versaler. Skriv innehållet med vanliga <h2>, <p>, <table> – de får rätt utseende här.
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Brand } from "./layout";

const PAPER_CONTENT = [
  "[&_h2]:mt-1.5 [&_h2]:flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:border-b-2 [&_h2]:border-antracit [&_h2]:pb-[5px] [&_h2]:text-small [&_h2]:font-extrabold [&_h2]:tracking-[0.08em] [&_h2]:uppercase",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-small",
  "[&_td]:border [&_td]:border-ljusgra [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-left [&_td]:align-top",
  "[&_th]:border [&_th]:border-ljusgra [&_th]:bg-ljusgra-ton [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:align-top [&_th]:font-bold",
].join(" ");

export type PaperProps = {
  /** Dokumentets rubrik (versaler). */
  title: ReactNode;
  /** Högerställt informationsblock: [["Avtal", "332026110"], ["Ärende", "BOT-26-0143"]]. */
  info?: readonly (readonly [ReactNode, ReactNode])[];
  /** Vattenstämpel, t.ex. "Utkast – inte levererad". */
  draft?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function Paper({ title, info = [], draft, children, className }: PaperProps) {
  return (
    <div data-print="paper-wrap" className="overflow-x-auto rounded-card bg-ljusgra-ton2 p-6 max-[620px]:p-2">
      <article
        data-print="paper"
        className={cn(
          "mx-auto flex max-w-[820px] min-w-0 flex-col gap-5 bg-vit px-[52px] py-11 text-ui text-antracit shadow-card max-[620px]:px-[18px] max-[620px]:py-6",
          PAPER_CONTENT,
          className,
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-0.5">
            <Brand name="Miljonbemanning" size="lg" />
            <div className="text-small text-text-muted">Miljonmatch</div>
          </div>
          {info.length > 0 && (
            <div className="text-right text-meta leading-[1.55] max-[620px]:text-left">
              {info.map(([k, v], i) => (
                <div key={i}>
                  <b className="font-bold">{k}:</b> {v}
                </div>
              ))}
            </div>
          )}
        </div>
        {draft && <div className="self-start border-2 border-dashed border-antracit px-2.5 py-[3px] text-label font-extrabold tracking-[0.1em] uppercase">{draft}</div>}
        <h1 className="text-[1.25rem] font-extrabold tracking-[0.05em] uppercase">{title}</h1>
        {children}
      </article>
    </div>
  );
}

/** Fast text längst ned i ett dokument (mallens standardtext). */
export function PaperFixedText({ children }: { children?: ReactNode }) {
  return <div className="border-t border-ljusgra pt-2.5 text-meta text-text-muted">{children}</div>;
}

/** Kryssruta i ett dokument (ifylld när checked). */
export function XBox({ checked }: { checked?: boolean }) {
  return (
    <span aria-hidden="true" className="mr-1.5 inline-grid size-4 place-items-center border-[1.5px] border-antracit align-[-2px] text-[12px] leading-none font-extrabold">
      {checked ? "X" : ""}
    </span>
  );
}
