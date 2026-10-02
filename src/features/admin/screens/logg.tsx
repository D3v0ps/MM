"use client";
// Revisionslogg (/admin/logg, prototypens admin.logg) för systemadmin och chef/controller, med chefens månatliga
// loggkontroll (stickprov, SPEC §10). Loggen kan inte ändras eller raderas och innehåller id:n – aldrig namn eller
// personnummer på deltagare. Exporten loggas som en egen post innan filen skapas.
import { useState } from "react";
import { num, plural } from "@/core/format";
import { fmtDateTime, monthName } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { DemoOnly, useRuntime } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import {
  Badge, Button, Card, CaseLink, Check, DemoNote, Field, Grid, Icon, Input, Kpi, Notice, Page, PerspectiveLink, QueryView, Row, Seg, Select, Stack, TextArea, toast, useDownload,
} from "@/ui";
import { auditView } from "@/features/session/api";
import { adminAuditDetail, adminAuditLog, adminLogCheck, type AuditLogView, type AuditRow, type LogCheckView } from "../api";
import { StackTable } from "./parts";

export function LoggScreen() {
  const { actor } = useSession();
  // Nyckel per roll: loggkontrollen och filtret beror på rollen.
  return <LogPage key={actor.role} isChef={actor.role === "chef"} />;
}

type Filter = { actor: string; action: string; q: string; mine: boolean };
const NO_FILTER: Filter = { actor: "", action: "", q: "", mine: false };
const applyFilter = (rows: AuditRow[], f: Filter) =>
  rows.filter((a) => (!f.actor || a.actorKey === f.actor) && (!f.action || a.action === f.action) && (!f.q.trim() || a.caseNumber.toLowerCase().includes(f.q.trim().toLowerCase())) && (!f.mine || a.byTester));

function filterDesc(d: AuditLogView, f: Filter): string {
  const actorLabel = d.actors.find((x) => x.value === f.actor)?.label ?? f.actor;
  const actionLabel = d.actions.find((x) => x.value === f.action)?.label ?? f.action;
  return [f.actor && `aktör ${f.actor === "__null" ? "deltagare" : actorLabel}`, f.action && `åtgärd ${actionLabel}`, f.q.trim() && `ärende ${f.q.trim()}`, f.mine && "bara prototypen"].filter(Boolean).join(", ");
}

function LogPage({ isChef }: { isChef: boolean }) {
  const q = useQuery(adminAuditLog, {});
  const [f, setF] = useState<Filter>(NO_FILTER);
  const [limit, setLimit] = useState(50);
  const set = (patch: Partial<Filter>, resetLimit = true) => {
    setF((x) => ({ ...x, ...patch }));
    if (resetLimit) setLimit(50);
  };
  return (
    <Page
      title="Revisionslogg"
      eyebrow={isChef ? "Chef och controller" : "Systemadmin"}
      lead="Loggen kan inte ändras eller raderas. Visning av deltagarkort, rapporter och transkript loggas, liksom alla ändringar, exporter och AI-körningar. Loggen innehåller id:n – aldrig namn eller personnummer på deltagare."
      actions={q.data ? <ExportButton d={q.data} f={f} /> : undefined}
    >
      <QueryView query={q}>{(d) => <LogContent d={d} f={f} set={set} limit={limit} setLimit={setLimit} />}</QueryView>
    </Page>
  );
}

function ExportButton({ d, f }: { d: AuditLogView; f: Filter }) {
  // Kolumnen "Gjort i prototypen" finns bara i prototypen.
  const demo = useRuntime() === "demo";
  // Loggkommandet räknar normalt inte om något – här visar sidan själva loggen, så den hämtas på nytt efter exporten.
  const log = useCommand(auditView, { invalidate: ["admin."] });
  const download = useDownload();
  const exportCsv = async () => {
    const rows = applyFilter(d.rows, f);
    // Exporten loggas i revisionsloggen innan filen skapas (CLAUDE.md punkt 3).
    await log.run({ action: "export.audit_log", entity: "audit_log", entityId: d.contractId, details: { rows: rows.length, filter: filterDesc(d, f) || "inget" } }).catch(() => null);
    const esc = (s: unknown) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const head = ["Tidpunkt", "Aktör", "Åtgärd", "Åtgärdskod", "Objekt", "Objekt-id", "Ärendenummer", "Detaljer", ...(demo ? ["Gjort i prototypen"] : [])];
    const lines = rows.map((a) =>
      [a.at.replace("T", " "), a.actorName, a.actionLabel, a.action, a.entity, a.entityId, a.caseNumber, a.detailText, ...(demo ? [a.byTester ? "Ja" : "Nej"] : [])].map(esc).join(";"),
    );
    await download(`revisionslogg-${d.today}.csv`, [head.map(esc).join(";"), ...lines].join("\n"), "text/csv");
  };
  return (
    <Button kind="secondary" icon="download" pending={log.pending} onClick={() => void exportCsv()}>
      Exportera (CSV)
    </Button>
  );
}

function LogContent({ d, f, set, limit, setLimit }: { d: AuditLogView; f: Filter; set: (p: Partial<Filter>, resetLimit?: boolean) => void; limit: number; setLimit: (n: number) => void }) {
  // Det testaren gjort markeras bara i prototypen.
  const demo = useRuntime() === "demo";
  const rows = applyFilter(d.rows, f);
  return (
    <>
      <Grid cols={4}>
        <Kpi label="Poster i loggen" value={num(d.rows.length)} sub={demo ? "urval från demodatat" : "nyast först"} />
        <Kpi label="Visningar" value={d.views} sub="deltagarkort, personnummer och rapporter" />
        <Kpi label="Exporter" value={d.exports} sub="loggas alltid" />
        <DemoOnly>
          <Kpi label="Gjort av dig" value={d.byTester} sub="i prototypen" />
        </DemoOnly>
      </Grid>
      <LogCheck c={d.logCheck} />
      <Card title="Filter" icon="filter">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] items-end gap-4">
          <Field id="log-actor" label="Aktör">
            <Select value={f.actor} onValueChange={(v) => set({ actor: v })} placeholder="Alla aktörer" options={d.actors} />
          </Field>
          <Field id="log-action" label="Åtgärd">
            <Select value={f.action} onValueChange={(v) => set({ action: v })} placeholder="Alla åtgärder" options={d.actions} />
          </Field>
          <Field id="log-case" label="Ärende" help="Skriv hela eller en del av ärendenumret.">
            <Input type="search" value={f.q} onValueChange={(v) => set({ q: v })} placeholder="Till exempel BOT-26-0143" />
          </Field>
          <DemoOnly>
            <Check id="log-mine-only" checked={f.mine} onCheckedChange={(v) => set({ mine: v }, false)}>
              Bara det du gjort i prototypen
            </Check>
          </DemoOnly>
        </div>
      </Card>
      <Card
        title={`Poster (${rows.length})`}
        icon="book"
        flush
        foot={
          rows.length > limit ? (
            <>
              <Button kind="secondary" icon="chevron-down" onClick={() => setLimit(limit + 50)}>
                Visa 50 till
              </Button>
              <span className="text-small text-text-muted">
                Visar {limit} av {rows.length}
              </span>
            </>
          ) : undefined
        }
      >
        <StackTable
          caption="Revisionslogg, nyast först"
          columns={[
            { label: "Tidpunkt", nowrap: true },
            { label: "Aktör", mobileLabel: true },
            { label: "Åtgärd" },
            { label: "Objekt", mobileLabel: true },
            { label: "Detaljer", mobileLabel: true },
          ]}
          empty="Inga poster matchar filtret."
          rows={rows.slice(0, limit).map((a) => ({
            key: a.id,
            selected: demo && a.byTester,
            cells: [
              <span key="t">{fmtDateTime(a.at)}</span>,
              <span key="a">
                <span>{a.actorName}</span>
                {a.byTester && (
                  <DemoOnly>
                    <div className="mt-1">
                      <Badge tone="dark" icon="user">Gjort av dig i prototypen</Badge>
                    </div>
                  </DemoOnly>
                )}
              </span>,
              <span key="c" className="font-bold" title={`Åtgärdskod: ${a.action}`}>
                {a.actionLabel}
              </span>,
              <span key="o">
                <span>{a.entityLabel}</span>
                <div className="text-small text-text-muted">{a.caseId ? <CaseLink caseId={a.caseId} caseNumber={a.caseNumber} /> : a.entityText}</div>
              </span>,
              <span key="d" className="text-small">
                {a.detailText || "–"}
                {a.hasFull && <FullDetail id={a.id} />}
              </span>,
            ],
          }))}
        />
      </Card>
      <DemoNote>Loggen innehåller ett urval från demodatat plus allt du gör i prototypen. Exporten loggas som en egen post innan filen skapas.</DemoNote>
    </>
  );
}

/** Hela listan (t.ex. alla kolumner och rapporter i en export) – hämtas först när den öppnas. */
function FullDetail({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery(adminAuditDetail, open ? { id } : null);
  return (
    <details className="mt-1" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold underline">Visa hela listan</summary>
      <span className="block [overflow-wrap:anywhere]" aria-live="polite">
        {q.data ? (q.data.text ?? "–") : q.error ? "Listan kunde inte hämtas. Försök igen." : open ? "Hämtar listan …" : null}
      </span>
    </details>
  );
}

// ================================================================ Månatlig loggkontroll
function LogCheck({ c }: { c: LogCheckView }) {
  const sign = useCommand(adminLogCheck);
  const [verdicts, setVerdicts] = useState<Record<string, "ok" | "avvikelse">>({});
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const month = monthName(c.month);
  if (c.done) {
    return (
      <Notice tone={c.done.deviations ? "warn" : "ok"} title={`Loggkontrollen för ${month} är signerad`}>
        {c.done.signedByName} signerade {fmtDateTime(c.done.signedAt)}. {plural(c.done.items, "post", "poster")} kontrollerade, {plural(c.done.deviations, "avvikelse", "avvikelser")}.
        {c.done.note ? ` Anteckning: ${c.done.note}` : ""}
      </Notice>
    );
  }
  if (!c.canSign) {
    return (
      <Card title={`Månatlig loggkontroll – ${month}`} icon="check-square" tone="sub">
        <Row between>
          <span className="inline-flex items-start gap-1.5">
            <Icon name="clock" className="mt-0.5" /> Inte gjord ännu. Chef och controller gör ett stickprov i loggen varje månad.
          </span>
          <DemoOnly>
            <PerspectiveLink role="chef" to="/admin/logg" label="Gör kontrollen som chef" />
          </DemoOnly>
        </Row>
      </Card>
    );
  }
  const allSet = c.sample.length > 0 && c.sample.every((a) => verdicts[a.id]);
  const anyDev = Object.values(verdicts).includes("avvikelse");
  const noteErr = tried && anyDev && !note.trim() ? "Beskriv avvikelsen och vad som ska göras." : undefined;
  const onSign = async () => {
    setTried(true);
    if (!allSet || (anyDev && !note.trim())) return;
    const r = await sign.run({ month: c.month, items: c.sample.map((a) => ({ logId: a.id, verdict: verdicts[a.id] })), note }).catch(() => null);
    if (!r || !r.ok) toast("Loggkontrollen kunde inte signeras.", "error");
    else toast(`Loggkontrollen för ${month} är signerad.`);
  };
  return (
    <Card
      title={`Månatlig loggkontroll – ${month}`}
      icon="check-square"
      tone="blue"
      foot={
        <>
          <Button kind="primary" icon="check" disabled={!allSet} pending={sign.pending} onClick={() => void onSign()}>
            Signera loggkontrollen
          </Button>
          <span className="text-small text-text-muted">
            {Object.keys(verdicts).length} av {c.sample.length} poster bedömda
          </span>
        </>
      }
    >
      <Stack>
        <p>Stickprov med {plural(c.sample.length, "post", "poster")} från förra månaden, i första hand visningar och exporter. Bedöm om åtkomsten var motiverad av arbetet.</p>
        {c.sample.length === 0 ? (
          <p className="text-text-muted">Inga poster förra månaden.</p>
        ) : (
          <Stack gap="sm">
            {c.sample.map((a) => (
              <Row between key={a.id} className="border-b border-ljusgra py-2">
                <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                  <span className="font-bold">{a.actionLabel}</span>
                  <span className="text-small text-text-muted">
                    {fmtDateTime(a.at)} · {a.actorName} · {a.entityLabel}
                    {a.caseNumber ? ` ${a.caseNumber}` : ""}
                  </span>
                </div>
                <Seg
                  ariaLabel={`Bedömning av ${a.actionLabel} ${fmtDateTime(a.at)}`}
                  value={verdicts[a.id] ?? null}
                  onValueChange={(v) => setVerdicts((x) => ({ ...x, [a.id]: v }))}
                  options={[
                    { value: "ok", label: "Motiverad", icon: "check", tone: "green" },
                    { value: "avvikelse", label: "Avvikelse", icon: "alert", tone: "red" },
                  ]}
                />
              </Row>
            ))}
          </Stack>
        )}
        <Field id="logcheck-note" label="Anteckning" help="Krävs om du markerat en avvikelse. Skriv vad som hände och vad som ska göras." error={noteErr}>
          <TextArea rows={2} value={note} onValueChange={setNote} />
        </Field>
      </Stack>
    </Card>
  );
}
