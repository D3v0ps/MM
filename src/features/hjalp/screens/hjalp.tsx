"use client";
// Hjälpsidorna: lathunden för kollegor (/hjalp, MB:s arbetsyta) och lathunden för kommunens handläggare med mallen för
// mejlavrop (/portal/hjalp, portalen). Texten kommer från docs/lathund/*.md via content.generated.ts (npm run lathund:build).
// Inga behörigheter utöver rollens område: MB-roller når /hjalp, kommunens handläggare /portal/hjalp. Listan med yrkesområden
// i mallen byggs från avtalets aktiva avtalsområden – samma lista som formuläret Beställ ny insats (kommun.bestallning).
import { useMemo } from "react";
import { Button, Page, useCopy } from "@/ui";
import { useQuery } from "@/shell/backend";
import { kommunOrderForm } from "@/features/kommun/api";
import { KomHead, KomPage } from "@/features/kommun/screens/parts";
import { withAreaList } from "../areas";
import { LATHUND_KOLLEGA, LATHUND_KOMMUN, LATHUND_MALL } from "../content.generated";
import { Markdown, markdownTitle } from "../markdown";

export const HJALP_TITLE = "Hjälp";

/** Knappen under ett kodblock: kopierar mallen som den är. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const copy = useCopy();
  return (
    <div className="flex">
      <Button icon="copy" onClick={() => void copy(text)}>
        {label}
      </Button>
    </div>
  );
}

export function HjalpScreen() {
  return (
    <Page eyebrow="Hjälp" title={markdownTitle(LATHUND_KOLLEGA) ?? HJALP_TITLE} lead="Så loggar du in, vad rollerna gör och hur du arbetar i Miljonmatch.">
      <Markdown md={LATHUND_KOLLEGA} skipTitle />
    </Page>
  );
}

export function PortalHjalpScreen() {
  // Avtalets yrkesområden (samma fråga som beställningsformuläret). Går den inte att hämta står en text i stället för listan.
  const q = useQuery(kommunOrderForm, {});
  const mall = useMemo(
    () => withAreaList(LATHUND_MALL, q.data ? q.data.areas.map((a) => ({ code: a.value, name: a.label })) : q.error ? [] : null, q.data?.otherAreaName ?? null),
    [q.data, q.error],
  );
  return (
    <KomPage>
      <KomHead eyebrow="Hjälp" title={markdownTitle(LATHUND_KOMMUN) ?? HJALP_TITLE} lead="Så skapar du ett konto, loggar in och beställer insatser. Längst ner finns mallen för beställning via mejl." />
      <Markdown md={LATHUND_KOMMUN} skipTitle />
      <h2 id="mall-for-bestallning-via-mejl" className="mt-6 flex items-center gap-2.5 text-h2 font-extrabold tracking-[0.03em] uppercase portal:text-[1.25rem]">
        {markdownTitle(LATHUND_MALL) ?? "Mall för beställning via mejl"}
      </h2>
      <Markdown
        md={mall}
        skipTitle
        renderCode={(text, index) => <CopyButton text={text} label={index === 0 ? "Kopiera mallen" : "Kopiera exemplet"} />}
      />
    </KomPage>
  );
}
