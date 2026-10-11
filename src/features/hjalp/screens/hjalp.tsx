"use client";
// Hjälpsidorna: lathunden för kollegor med rutinen för deltagarna från början till slutet (/hjalp, MB:s arbetsyta) och
// lathunden för kommunens handläggare med mallen för mejlavrop (/portal/hjalp, portalen). Texten kommer från
// docs/lathund/*.md via content.generated.ts (npm run lathund:build).
// Inga behörigheter utöver rollens område: MB-roller når /hjalp, kommunens handläggare /portal/hjalp. Listan med yrkesområden
// i mallen byggs från avtalets aktiva avtalsområden – samma lista som formuläret Beställ ny insats (kommun.bestallning).
import { useMemo } from "react";
import { Button, Dot, Page, useCopy } from "@/ui";
import { useQuery } from "@/shell/backend";
import { kommunOrderForm } from "@/features/kommun/api";
import { KomHead, KomPage } from "@/features/kommun/screens/parts";
import { withAreaList } from "../areas";
import { LATHUND_KOLLEGA, LATHUND_KOMMUN, LATHUND_MALL, LATHUND_RUTIN } from "../content.generated";
import { headingId, Markdown, markdownTitle } from "../markdown";

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

/** Rubriken för rutinen (docs/lathund/rutin-deltagare.md) – den står längst ner på /hjalp. */
export const RUTIN_TITLE = markdownTitle(LATHUND_RUTIN) ?? "Rutin för deltagarna från början till slutet";

export function HjalpScreen() {
  return (
    <Page
      eyebrow="Hjälp"
      title={markdownTitle(LATHUND_KOLLEGA) ?? HJALP_TITLE}
      lead="Så loggar du in, vad rollerna gör och hur du arbetar i Miljonmatch. Längst ner finns rutinen för deltagarna från början till slutet."
    >
      <Markdown md={LATHUND_KOLLEGA} skipTitle />
      {/* Rutinen: titeln som avsnittsrubrik (som mallen i portalen), stegen som underrubriker. */}
      <h2 id={headingId(RUTIN_TITLE)} className="mt-6 flex items-center gap-2.5 text-h2 font-extrabold tracking-[0.03em] uppercase">
        <Dot className="size-2 flex-none" />
        {RUTIN_TITLE}
      </h2>
      <Markdown md={LATHUND_RUTIN} skipTitle />
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
