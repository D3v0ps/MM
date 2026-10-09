"use client";
// Hjälpsidorna: lathunden för kollegor (/hjalp, MB:s arbetsyta) och lathunden för kommunens handläggare med mallen för
// mejlavrop (/portal/hjalp, portalen). Texten kommer från docs/lathund/*.md via content.generated.ts (npm run lathund:build).
// Inga data hämtas och inga behörigheter utöver rollens område: MB-roller når /hjalp, kommunens handläggare /portal/hjalp.
import { Button, Page, useCopy } from "@/ui";
import { KomHead, KomPage } from "@/features/kommun/screens/parts";
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
  return (
    <KomPage>
      <KomHead eyebrow="Hjälp" title={markdownTitle(LATHUND_KOMMUN) ?? HJALP_TITLE} lead="Så skapar du ett konto, loggar in och beställer insatser. Längst ner finns mallen för beställning via mejl." />
      <Markdown md={LATHUND_KOMMUN} skipTitle />
      <h2 id="mall-for-bestallning-via-mejl" className="mt-6 flex items-center gap-2.5 text-h2 font-extrabold tracking-[0.03em] uppercase portal:text-[1.25rem]">
        {markdownTitle(LATHUND_MALL) ?? "Mall för beställning via mejl"}
      </h2>
      <Markdown
        md={LATHUND_MALL}
        skipTitle
        renderCode={(text, index) => <CopyButton text={text} label={index === 0 ? "Kopiera mallen" : "Kopiera exemplet"} />}
      />
    </KomPage>
  );
}
