"use client";
// Genomgång av feedback (/om/genomgang) – port av den gamla prototypens vy om.feedback (prototyp/src/90-feedback.js).
import { useState } from "react";
import { groupBy } from "@/core/util";
import { Button } from "@/ui/button";
import { Card, Page, Section } from "@/ui/page";
import { Kpi } from "@/ui/data";
import { useCopy } from "@/ui/download";
import { Empty, Notice } from "@/ui/feedback";
import { Field, Seg, Select } from "@/ui/form";
import { Grid, Stack } from "@/ui/layout";
import { FeedbackItemCard } from "../feedback";
import { asMarkdown, FB_STATUSES, nameOf, openFeedback, prioLabel, typeLabel, useFeedback, type FeedbackItem } from "../feedback-store";

type Persp = "alla" | "leverantor" | "kund" | "deltagare";
type Group = "vy" | "typ" | "prio" | "person";

export function GenomgangScreen() {
  const f = useFeedback();
  const copy = useCopy();
  const [persp, setPersp] = useState<Persp>("alla");
  const [status, setStatus] = useState("oppna");
  const [group, setGroup] = useState<Group>("vy");
  const items = f.items.filter(
    (x) => (persp === "alla" || x.perspective === persp) && (status === "alla" || (status === "oppna" && !["klar", "avfardad"].includes(x.status)) || x.status === status),
  );
  const byStatus = Object.fromEntries(FB_STATUSES.map((s) => [s.value, f.items.filter((x) => x.status === s.value).length])) as Record<string, number>;
  const keyOf = (x: FeedbackItem) =>
    group === "vy"
      ? `${x.perspectiveLabel || "–"} · ${x.viewTitle || "Hela prototypen"}`
      : group === "typ"
        ? typeLabel(x.type)
        : group === "prio"
          ? prioLabel(x.priority)
          : nameOf(f, x.authorId);
  const groups = Object.entries(groupBy(items, keyOf)).sort((a, b) => b[1].length - a[1].length);
  return (
    <Page
      title="Genomgång av feedback"
      eyebrow="För mötet"
      lead="All feedback som lämnats i prototypen, samlad för genomgång. Ändra status allteftersom ni går igenom punkterna – alla med länken ser samma lista."
      actions={
        <>
          <Button icon="copy" disabled={!items.length} onClick={() => void copy(asMarkdown(f, items))}>
            Kopiera som lista
          </Button>
          <Button kind="primary" icon="edit" onClick={() => openFeedback()}>
            Lämna feedback
          </Button>
        </>
      }
    >
      <Grid cols={4}>
        <Kpi
          label="Totalt"
          value={f.items.length}
          sub={`${f.items.filter((x) => x.perspective === "leverantor").length} leverantör · ${f.items.filter((x) => x.perspective === "kund").length} kund`}
        />
        <Kpi label="Nya" value={byStatus.ny || 0} sub="Inte gått igenom ännu" tone={byStatus.ny ? "watch" : null} />
        <Kpi label="Ska ändras" value={byStatus.andras || 0} sub={`${byStatus.diskutera || 0} att diskutera`} />
        <Kpi label="Klara" value={byStatus.klar || 0} sub={`${byStatus.avfardad || 0} avfärdade`} />
      </Grid>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Perspektiv" id="fbg-p">
          <Seg<Persp>
            id="fbg-p"
            value={persp}
            onValueChange={setPersp}
            options={[
              { value: "alla", label: "Alla" },
              { value: "leverantor", label: "Leverantör" },
              { value: "kund", label: "Kund" },
              { value: "deltagare", label: "Deltagare" },
            ]}
          />
        </Field>
        <Field label="Status" id="fbg-s">
          <Select value={status} onValueChange={setStatus} options={[{ value: "oppna", label: "Inte klara" }, { value: "alla", label: "Alla" }, ...FB_STATUSES]} />
        </Field>
        <Field label="Gruppera efter" id="fbg-g">
          <Select
            value={group}
            onValueChange={(v) => setGroup(v as Group)}
            options={[
              { value: "vy", label: "Perspektiv och vy" },
              { value: "typ", label: "Typ" },
              { value: "prio", label: "Hur viktigt" },
              { value: "person", label: "Person" },
            ]}
          />
        </Field>
      </div>
      {f.mode === "local" && (
        <Notice tone="warn" title="Visar bara feedback från den här webbläsaren">
          Öppna prototypen via länken i claude.ai för att se den delade listan.
        </Notice>
      )}
      {items.length === 0 ? (
        <Card>
          <Empty icon="message-circle" title="Ingen feedback att visa">
            Ändra filtret, eller lämna feedback med knappen Feedback nere till höger.
          </Empty>
        </Card>
      ) : (
        groups.map(([k, list]) => (
          <Section key={k} title={`${k} (${list.length})`}>
            <Stack gap="sm">
              {list.map((it) => (
                <FeedbackItemCard key={it.id} it={it} />
              ))}
            </Stack>
          </Section>
        ))
      )}
    </Page>
  );
}
