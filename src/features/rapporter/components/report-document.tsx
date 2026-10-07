"use client";
// Rapportdokumentet som PDF-förhandsvisning i MB:s profil (prototypens ReportDocument i views/rapporter.js).
// Samma komponent i Miljonbemannings rapportsida och i kommunportalen.
//
// API (stabilt – kommunportalen använder det):
//   <ReportDocument doc={doc} />            doc = ReportDocView från frågan reportDocument ("rapporter.dokument")
//   <ReportDocumentById reportId={id} />     hämtar själv (Loading/ErrorNotice) och visar dokumentet eller varför det inte visas
// Komponenten har ingen dataåtkomst utöver ReportDocumentById och loggar inte – visningen loggas av sidan (se api.ts).
// Levererade rapporter visas frysta: det är hanteraren som väljer ögonblicksbilden.
import type { ReactNode } from "react";
import { attLabel } from "@/core/labels";
import { num, pct } from "@/core/format";
import { fmtTime, monthName as monthText, weekday, WEEKDAYS } from "@/core/time";
import { useQuery } from "@/shell/backend";
import { Empty, ErrorNotice, Kv, Loading, Meter, Paper, PaperFixedText, Status, XBox } from "@/ui";
import { reportDocument, type ReportDocView } from "../api";
import type { ActivityModel, AttRow, AttStats, DeviationModel, EventRow, ProgressionRow } from "../model";
import { ATTENDANCE_RATE_RULE, BUYER_REFERENCE_LATER, dayMonth, DENIED, dFull, dtFull, isDraftDoc, lcfirst, monthRangeText, NO_PNR, PRINCIPLE, plain, smallN, ucfirst, weekRange, weekText } from "../report-helpers";

// ---------------------------------------------------------------- Byggstenar
function Sec({ n, title, children }: { n?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2>
        {n ? `${n}. ` : ""}
        {title}
      </h2>
      {children}
    </section>
  );
}
const Wait = ({ children }: { children: ReactNode }) => <p className="text-text-muted italic">{children}</p>;
function TWrap({ min = 520, children }: { min?: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table style={{ minWidth: min }}>{children}</table>
    </div>
  );
}
const Small = ({ children, muted, className }: { children: ReactNode; muted?: boolean; className?: string }) => (
  <p className={`text-small ${muted ? "text-text-muted" : ""} ${className ?? ""}`}>{children}</p>
);
const Watermark = ({ children }: { children: ReactNode }) => (
  <div className="self-start border-2 border-dashed border-antracit px-2.5 py-[3px] text-label font-extrabold tracking-[0.1em] uppercase">{children}</div>
);
const Superseded = ({ doc }: { doc: ReportDocView }) => (doc.superseded ? <Watermark>Ersatt av en rättad version</Watermark> : null);
const NUM = "tabular-nums";

function baseInfo(doc: ReportDocView, caseNumber: string | null, extra: [string, string][] = []): [string, string][] {
  return [
    ["Beställare", doc.contract.customerName],
    ["Avtal", `${doc.contract.contractNumber} (diarienummer ${doc.contract.dnr})`],
    ...(caseNumber ? ([["Ärende", caseNumber]] as [string, string][]) : []),
    ...extra,
    ["Version", String(doc.version)],
    ["Upprättad", doc.approvedAt ? dFull(doc.approvedAt) : "Utkast – ej godkänd"],
  ];
}

function AttendanceTable({ rows, total, firstCol }: { rows: AttRow[]; total: AttStats; firstCol: string }) {
  const showUnreg = total.unregistered > 0;
  const cells = (st: AttStats) => (
    <>
      <td className={NUM}>{st.planned}</td>
      <td className={NUM}>
        {st.present + st.late}
        {st.late > 0 ? ` (${st.late} sen)` : ""}
      </td>
      <td className={NUM}>{st.absentValid}</td>
      <td className={NUM}>{st.absentInvalid}</td>
      {showUnreg && <td className={NUM}>{st.unregistered}</td>}
      <td className={NUM}>{pct(st.rate, 0)}</td>
    </>
  );
  return (
    <TWrap min={560}>
      <thead>
        <tr>
          <th>{firstCol}</th>
          <th>Planerade tillfällen</th>
          <th>Närvaro</th>
          <th>Giltig frånvaro</th>
          <th>Ogiltig frånvaro</th>
          {showUnreg && <th>Ej registrerade</th>}
          <th>Närvarograd</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => (
          <tr key={w.key}>
            <td className="whitespace-nowrap">
              {w.label}
              {w.sub && <div className="text-small text-text-muted">{w.sub}</div>}
              {w.paused && <div className="text-small text-text-muted">Uppehåll</div>}
            </td>
            {cells(w.st)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>
            <b>Totalt</b>
          </td>
          {cells(total)}
        </tr>
      </tfoot>
    </TWrap>
  );
}

function ActivityChecklist({ a }: { a: ActivityModel }) {
  const done = new Set(a.done);
  return (
    <ul className="m-0 grid list-none gap-x-[18px] gap-y-1.5 p-0" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))" }}>
      {a.types.map((t) => (
        <li key={t} className="flex items-start gap-0.5">
          <XBox checked={done.has(t)} />
          <span>
            <span className="sr-only">{done.has(t) ? "Genomförd: " : "Inte genomförd: "}</span>
            {plain(t)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EventsTable({ evs }: { evs: EventRow[] }) {
  if (evs.length === 0) return <p>Inga händelser registrerade under perioden.</p>;
  return (
    <TWrap min={520}>
      <thead>
        <tr>
          <th>Datum</th>
          <th>Händelse</th>
          <th>Arbetsgivare eller anordnare</th>
          <th>Underlag</th>
        </tr>
      </thead>
      <tbody>
        {evs.map((e) => (
          <tr key={e.id}>
            <td className="whitespace-nowrap">{e.date}</td>
            <td>{e.label}</td>
            <td>{e.actor}</td>
            <td>{e.basis}</td>
          </tr>
        ))}
      </tbody>
    </TWrap>
  );
}

function DeviationsBlock({ dv }: { dv: DeviationModel }) {
  return (
    <div className="flex flex-col gap-2">
      {dv.items.length === 0 ? (
        <p>Inga avvikelser under perioden.</p>
      ) : (
        dv.items.map((x) => (
          <div key={x.id} className="flex flex-col gap-2 border-l-[3px] border-antracit py-0.5 pl-2.5">
            <div>
              <b>{x.description}</b>{" "}
              <span className="text-small text-text-muted">
                ({x.date} · {x.status})
              </span>
            </div>
            {x.assessment && (
              <div>
                <b>Risk och bedömning:</b> {x.assessment}
              </div>
            )}
            <div>
              <b>Åtgärd:</b> {x.action}
            </div>
            <div className="text-small">{x.follow}</div>
          </div>
        ))
      )}
      {dv.repeated.hit && (
        <p>
          <b>Risk:</b> Upprepad ogiltig frånvaro ({dv.repeated.count} tillfällen, regel: minst {dv.repeated.absentInvalid} inom {dv.repeated.withinDays} dagar).
        </p>
      )}
      <p>
        <b>Behöver beslut eller stöd från kommunen?</b> {dv.decision}
      </p>
    </div>
  );
}

function ProgressionTable({ p }: { p: { scale: string; rows: ProgressionRow[] } }) {
  return (
    <div className="flex flex-col gap-2">
      <Small muted>Skala: {p.scale}.</Small>
      <TWrap min={600}>
        <thead>
          <tr>
            <th style={{ width: "26%" }}>Område</th>
            <th style={{ width: "16%" }}>Nivå</th>
            <th>Observation</th>
            <th style={{ width: "24%" }}>Nästa steg</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((a) => (
            <tr key={a.key}>
              <td>{a.label}</td>
              <td>{a.level}</td>
              <td>{a.observation}</td>
              <td>{a.nextStep}</td>
            </tr>
          ))}
        </tbody>
      </TWrap>
    </div>
  );
}

const assessmentKv = (a: { overallStatus: Parameters<typeof Status>[0]["value"]; summary: string; coach: string; date: string }): [ReactNode, ReactNode][] => [
  ["Samlad status", <Status key="s" value={a.overallStatus} />],
  ["Sammanfattning", a.summary],
  ["Ansvarig coach", a.coach],
  ["Datum", a.date],
];

// ---------------------------------------------------------------- Månadsrapport individ (mall 02, avsnitt 1–8)
function MonthlyDoc({ doc }: { doc: Extract<ReportDocView, { kind: "monthly" }> }) {
  const m = doc.m;
  const draft = !m.approved || isDraftDoc(doc.status);
  const month = m.month ? monthText(m.month) : "";
  return (
    <Paper title="Månadsrapport individ" draft={draft ? "Utkast" : null} info={baseInfo(doc, m.caseNumber, [["Period", month]])}>
      <Superseded doc={doc} />
      {!m.approved && (
        <Small>
          <b>Utkast.</b> Månadsbedömningen för {month} är inte godkänd. Avsnitt 4, 7 och 8 visas först när coachen har godkänt den.
        </Small>
      )}
      <Sec n="1" title="Grunduppgifter">
        <Kv items={[["Deltagare", doc.participant], ...m.basics]} />
        <Small muted>{NO_PNR}</Small>
      </Sec>
      {/* Bara perioden och närvarograden (beslut 2026-10-07, synpunkt #12). Veckorna, orsakerna och upprepad frånvaro finns internt
          på deltagarkortets flik Närvaro. Modellen och frysta rapporter är oförändrade – bara visningen. */}
      <Sec n="2" title="Närvaro">
        <Kv items={[["Period", monthRangeText(m.month)], ["Närvarograd", pct(m.total.rate, 0)]]} />
        <Small muted>{ATTENDANCE_RATE_RULE}</Small>
      </Sec>
      <Sec n="3" title="Genomförda aktiviteter">
        <Small muted>Aktivitetstyperna är exempel – de stäms av mot mall 02. Kryss betyder minst en registrerad aktivitet av typen i en godkänd avstämning.</Small>
        <ActivityChecklist a={m.activities} />
        <p>
          <b>Dokumentation:</b> {m.docText}
        </p>
      </Sec>
      <Sec n="4" title="Progression">
        {m.progression ? <ProgressionTable p={m.progression} /> : <Wait>Visas när coachen har godkänt månadsbedömningen.</Wait>}
      </Sec>
      <Sec n="5" title="Resultat och utfall">
        <EventsTable evs={m.events} />
      </Sec>
      <Sec n="6" title="Avvikelse, risk och åtgärd">
        <DeviationsBlock dv={m.deviations} />
      </Sec>
      <Sec n="7" title={`Plan för nästa månad (${m.nextMonth})`}>
        {!m.approved ? <Wait>Visas när coachen har godkänt månadsbedömningen.</Wait> : m.plan ? <Kv items={m.plan} /> : <p>Framgår inte.</p>}
      </Sec>
      <Sec n="8" title="Coachens sammanfattande bedömning">
        {m.assessment ? <Kv items={assessmentKv(m.assessment)} /> : <Wait>Visas när coachen har godkänt månadsbedömningen.</Wait>}
        <PaperFixedText>{PRINCIPLE}</PaperFixedText>
      </Sec>
    </Paper>
  );
}

// ---------------------------------------------------------------- Slutrapport (hela perioden)
function FinalDoc({ doc }: { doc: Extract<ReportDocView, { kind: "final" }> }) {
  const m = doc.m;
  return (
    <Paper title="Slutrapport" draft={isDraftDoc(doc.status) ? "Utkast" : null} info={baseInfo(doc, m.caseNumber, [["Period", m.period]])}>
      <Superseded doc={doc} />
      <Sec n="1" title="Grunduppgifter">
        <Kv items={[["Deltagare", doc.participant], ...m.basics]} />
        <Small muted>{NO_PNR}</Small>
      </Sec>
      <Sec n="2" title="Närvaro och frånvaro under hela perioden">
        <AttendanceTable rows={m.months} total={m.total} firstCol="Månad" />
        <p>
          <b>Giltig frånvaro per orsak:</b> {m.reasons}.
        </p>
        <p>
          <b>Upprepad ogiltig frånvaro:</b> {m.repeated.hit ? `Ja – ${m.repeated.count} tillfällen under perioden. Se avsnitt 6.` : "Nej."}
        </p>
      </Sec>
      <Sec n="3" title="Genomförda aktiviteter">
        <Small muted>Aktivitetstyperna är exempel – de stäms av mot mall 02.</Small>
        <ActivityChecklist a={m.activities} />
        <p>
          <b>Dokumentation:</b> {m.docText}
        </p>
      </Sec>
      <Sec n="4" title="Progression">
        {!m.progression ? (
          <p>Ingen godkänd månadsbedömning finns för perioden.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Small muted>
              Jämförelse mellan första ({m.progression.firstMonth}) och senaste ({m.progression.lastMonth}) godkända månadsbedömning. Skala 0–3.
            </Small>
            <TWrap min={560}>
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Område</th>
                  <th>Första</th>
                  <th>Senaste</th>
                  <th>Senaste observation</th>
                </tr>
              </thead>
              <tbody>
                {m.progression.rows.map((a) => (
                  <tr key={a.key}>
                    <td>{a.label}</td>
                    <td className={NUM}>{a.first}</td>
                    <td className={NUM}>{a.last}</td>
                    <td>{a.observation}</td>
                  </tr>
                ))}
              </tbody>
            </TWrap>
          </div>
        )}
      </Sec>
      <Sec n="5" title="Resultat och utfall">
        <p>
          <b>Resultat:</b> {m.resultText}
        </p>
        <EventsTable evs={m.events} />
      </Sec>
      <Sec n="6" title="Avvikelse, risk och åtgärd">
        <DeviationsBlock dv={m.deviations} />
      </Sec>
      <Sec n="7" title="Kvarstående hinder och rekommenderad fortsättning">
        <p>
          <b>Kvarstående hinder:</b> {m.obstacles}
        </p>
        {m.recommendation ? (
          <p>
            <b>Rekommenderad fortsättning:</b> {m.recommendation}
          </p>
        ) : (
          <Wait>Coachen skriver rekommenderad fortsättning innan rapporten godkänns.</Wait>
        )}
      </Sec>
      <Sec n="8" title="Coachens sammanfattande bedömning">
        {m.assessment ? <Kv items={assessmentKv(m.assessment)} /> : <Wait>Ingen godkänd bedömning finns ännu.</Wait>}
        <PaperFixedText>{PRINCIPLE}</PaperFixedText>
      </Sec>
    </Paper>
  );
}

// ---------------------------------------------------------------- Veckorapport närvaro (en per handläggare och vecka)
function WeeklyDoc({ doc }: { doc: Extract<ReportDocView, { kind: "weekly_attendance" }> }) {
  const m = doc.m;
  const secs = doc.sections;
  const open = secs.filter((s): s is Extract<typeof s, { restricted: false }> => !s.restricted);
  const hiddenProt = secs.length - open.length;
  const total = (k: keyof Omit<AttStats, "reasons" | "rate">) => open.reduce((acc, s) => acc + s.stats[k], 0);
  const reg = total("planned") - total("unregistered");
  const rate = reg ? (total("present") + total("late")) / reg : null;
  const protText = doc.customer ? "Namn och närvaro visas bara för handläggaren som beställde insatsen." : "Visas bara för namngiven coach och avtalsansvarig.";
  return (
    <Paper
      title="Veckorapport närvaro"
      draft={doc.status === "waiting" ? "Väntar på närvaro" : isDraftDoc(doc.status) ? "Utkast" : null}
      info={[
        ["Beställare", doc.contract.customerName], ["Avtal", doc.contract.contractNumber], ["Mottagare", doc.recipient],
        ["Vecka", `${ucfirst(weekText(m.week))} (${weekRange(m.week)})`], ["Version", String(doc.version)], ["Publicerad", doc.deliveredAt ? dtFull(doc.deliveredAt) : "Inte publicerad"],
      ]}
    >
      <Superseded doc={doc} />
      {secs.length < doc.total && (
        <Small>
          <b>
            Du ser {secs.length} av {doc.total} deltagare
          </b>{" "}
          – bara de ärenden du är tilldelad.
        </Small>
      )}
      <Sec title="Sammanfattning">
        <Kv
          items={[
            ["Deltagare", String(secs.length)], ["Planerade tillfällen", String(total("planned"))], ["Närvarograd", pct(rate, 0)], ["Giltig frånvaro", String(total("absentValid"))],
            ["Ogiltig frånvaro", String(total("absentInvalid"))], total("unregistered") > 0 && ["Ej registrerade", String(total("unregistered"))],
          ]}
        />
        <Small muted>
          Närvarograd = närvarotillfällen delat med registrerade planerade tillfällen. Giltig frånvaro redovisas separat. Bara orsakskategori anges.
          {hiddenProt > 0 ? ` Siffrorna räknar inte med ${hiddenProt === 1 ? "en deltagare" : `${hiddenProt} deltagare`} vars uppgifter inte visas.` : ""}
        </Small>
        {open.length > 0 && (
          <TWrap min={480}>
            <thead>
              <tr>
                <th>Deltagare</th>
                <th>Närvaro</th>
                <th>Giltig frånvaro</th>
                <th>Ogiltig frånvaro</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {open.map((s) => (
                <tr key={s.caseId}>
                  <td>
                    {s.name}
                    <div className="text-small text-text-muted">{s.caseNumber}</div>
                  </td>
                  <td className={NUM}>
                    {s.paused ? "Uppehåll" : `${s.stats.present + s.stats.late} av ${s.stats.planned}`}
                    {s.stats.unregistered > 0 && (
                      <div className="text-small">
                        <b>{s.stats.unregistered} ej registrerade</b>
                      </div>
                    )}
                  </td>
                  <td className={NUM}>{s.stats.absentValid}</td>
                  <td className={NUM}>{s.stats.absentInvalid > 0 ? <b>{s.stats.absentInvalid}</b> : "0"}</td>
                  <td>{s.risk}</td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Sec>
      <Sec title="Deltagare – tillfällen och åtgärder">
        {secs.length === 0 ? (
          <p>Inga deltagare att visa för din roll.</p>
        ) : (
          secs.map((s) =>
            s.restricted ? (
              <div key={s.caseId} className="flex flex-col gap-2 border-t border-ljusgra pt-3">
                <h3 className="text-body font-extrabold">{s.caseNumber} · Uppgifterna visas inte</h3>
                <Small>{protText}</Small>
              </div>
            ) : (
              <div key={s.caseId} className="flex flex-col gap-2 border-t border-ljusgra pt-3">
                <h3 className="text-body font-extrabold">
                  {s.name} · {s.caseNumber}
                </h3>
                {s.paused ? (
                  <p>Uppehåll denna vecka. Ingen närvaro planerad.</p>
                ) : s.rows.length === 0 ? (
                  <p>Inga tillfällen planerade denna vecka.</p>
                ) : (
                  <TWrap min={440}>
                    <thead>
                      <tr>
                        <th>Tillfälle</th>
                        <th>Aktivitet</th>
                        <th>Närvaro</th>
                        <th>Orsak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((a) => (
                        <tr key={a.id}>
                          <td>
                            {ucfirst(WEEKDAYS[weekday(a.startsAt)])} {dayMonth(a.startsAt)} klockan {fmtTime(a.startsAt)}
                          </td>
                          <td>{ucfirst(a.kind)}</td>
                          <td>{a.status ? attLabel(a.status) : a.startsAt > m.now ? "Planerat" : <b>Ej registrerad</b>}</td>
                          <td>{a.status === "absent_valid" ? a.reason || "Giltigt skäl" : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </TWrap>
                )}
                <div className="text-small">
                  Planerade tillfällen {s.stats.planned} · närvaro {s.stats.present + s.stats.late} · giltig frånvaro {s.stats.absentValid} · ogiltig frånvaro {s.stats.absentInvalid}
                </div>
                {s.stats.absentInvalid > 0 && (
                  <p>
                    <b>Åtgärd vid ogiltig frånvaro:</b> {s.actions.length ? s.actions.join(" ") : "Coachen följer upp frånvaron med deltagaren i nästa veckoavstämning."}
                  </p>
                )}
                <p>
                  <b>Risk:</b> {s.risk}
                </p>
              </div>
            ),
          )
        )}
      </Sec>
      <PaperFixedText>
        Veckorapporten skapas automatiskt från coachernas närvaroregistrering. Den publiceras när alla deltagare är registrerade, senast {doc.pubDay} klockan{" "}
        {doc.pubTime.replace(":", ".")} för föregående vecka.
      </PaperFixedText>
    </Paper>
  );
}

// ---------------------------------------------------------------- Orderbekräftelse
// Inget pris och inget ordervärde (beslut 2026-10-07, synpunkt #10) – bara omfattningen. Beställarreferensen fyller Miljonbemanning i.
function OrderDoc({ doc }: { doc: Extract<ReportDocView, { kind: "order_confirmation" }> }) {
  const m = doc.m;
  return (
    <Paper title="Orderbekräftelse" draft={isDraftDoc(doc.status) ? "Utkast" : null} info={baseInfo(doc, m.caseNumber, [["Beställarreferens", m.buyerReference || BUYER_REFERENCE_LATER]])}>
      <Superseded doc={doc} />
      <p>
        Miljonbemanning bekräftar beställningen med ärendenummer <b>{m.caseNumber}</b>. Ärendenumret är också ordernummer och står på fakturorna. Använd det i stället för personnummer när ni
        kontaktar oss.
      </p>
      <Sec title="Insatsen">
        <Kv
          items={[
            ["Deltagare", doc.participant], ["Ärendenummer", m.caseNumber], ["Avtalsområde", m.area], ["Yrkesspår", m.track], ["Startdatum", m.start], ["Huvudcoach", m.coach],
            ["Första mötet", m.firstMeeting], ["Planerad omfattning", `${m.period}${m.plannedEnd ? ` (till och med ${m.plannedEnd})` : ""}`],
          ]}
        />
      </Sec>
      <Sec title="Fakturering">
        <Kv
          items={[
            ["Beställarreferens", m.buyerReference || BUYER_REFERENCE_LATER],
            ["Kommunens inköpsordernummer", m.purchaseOrderNumber || "Inget angivet"],
            ["Faktureringsobjekt", `Ärende ${m.caseNumber}`],
          ]}
        />
      </Sec>
      <PaperFixedText>Frågor om beställningen? Skicka ett meddelande i portalen och ange ärendenumret. Skriv inte personnummer i e-post.</PaperFixedText>
    </Paper>
  );
}

// ---------------------------------------------------------------- Beställarrapport (lämnas till kommunen av avtalsansvarig)
function CustomerSummaryDoc({ doc }: { doc: Extract<ReportDocView, { kind: "customer_summary" }> }) {
  const m = doc.m;
  const target = m.result.contractTarget;
  const small = (n: number) => smallN(m.minN, n);
  const numSmall = (x: { num: number }) => x.num > 0 && x.num < m.minN;
  const resRow = (label: string, x: { value: number | null; num: number; den: number }) => {
    const hidden = x.den > 0 && x.den < m.minN;
    const share = x.den === 0 ? "–" : hidden || numSmall(x) ? "Redovisas inte" : pct(x.value);
    const vs = x.den === 0 || hidden ? "–" : x.den < m.resultMinN ? "För få avslut för att bedöma" : (x.value ?? 0) >= target ? "I nivå med eller över avtalsmålet" : "Under avtalsmålet";
    return (
      <tr key={label}>
        <td>{label}</td>
        <td className={NUM}>{small(x.num)}</td>
        <td className={NUM}>{hidden ? `färre än ${m.minN}` : x.den}</td>
        <td className={NUM}>{share}</td>
        <td>{vs}</td>
      </tr>
    );
  };
  const roll = m.result.rolling;
  const tracks = m.byTrack.slice(0, 8);
  const restTracks = m.byTrack.slice(8);
  const month = monthText(m.month);
  return (
    <Paper title="Beställarrapport" draft={isDraftDoc(doc.status) ? "Utkast" : null} info={baseInfo(doc, null, [["Månad", month], ["Mottagare", doc.recipient]])}>
      <Superseded doc={doc} />
      <Small>
        Uppgifter per grupp med färre än {m.minN} personer redovisas som &quot;färre än {m.minN}&quot;. Rapporten innehåller inga namn.
      </Small>
      <Sec n="1" title="Deltagare">
        <Kv items={[["Aktiva under månaden", small(m.active)], ["Nya insatser", small(m.started)], ["Avslutade insatser", small(m.closed)]]} />
        <TWrap min={360}>
          <thead>
            <tr>
              <th>Avtalsområde</th>
              <th>Aktiva</th>
              <th>Nya</th>
              <th>Avslutade</th>
            </tr>
          </thead>
          <tbody>
            {m.byArea.map((a) => (
              <tr key={a.code}>
                <td>{a.name}</td>
                <td className={NUM}>{small(a.active)}</td>
                <td className={NUM}>{small(a.started)}</td>
                <td className={NUM}>{small(a.closed)}</td>
              </tr>
            ))}
          </tbody>
        </TWrap>
        <TWrap min={260}>
          <thead>
            <tr>
              <th>Yrkesspår</th>
              <th>Aktiva</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.track || "-"}>
                <td>{t.track || "Inte valt än"}</td>
                <td className={NUM}>{small(t.active)}</td>
              </tr>
            ))}
            {restTracks.length > 0 && (
              <tr>
                <td>Övriga {restTracks.length} yrkesspår</td>
                <td className={NUM}>{small(restTracks.reduce((s, t) => s + t.active, 0))}</td>
              </tr>
            )}
          </tbody>
        </TWrap>
      </Sec>
      <Sec n="2" title="Resultat – arbete eller studier">
        <TWrap min={560}>
          <thead>
            <tr>
              <th>Period</th>
              <th>Resultat</th>
              <th>Avslut som räknas</th>
              <th>Andel</th>
              <th>Jämfört med avtalsmålet {pct(target, 0)}</th>
            </tr>
          </thead>
          <tbody>
            {resRow(ucfirst(month), m.result.month)}
            {resRow("Rullande 6 månader", roll)}
            {resRow("Sedan avtalets start", m.result.sinceStart)}
          </tbody>
        </TWrap>
        {roll.den >= m.resultMinN && roll.value != null && !numSmall(roll) && (
          <Meter value={roll.value} max={0.6} tone="blue" label={`Resultatgrad rullande 6 månader ${pct(roll.value)}`} markers={[{ value: target, label: `Avtalsmål ${pct(target, 0)}`, tone: "red" }]} />
        )}
        <Small>
          {roll.prelim > 0 ? `${ucfirst(small(roll.prelim))} avslut till arbete eller studier väntar på verifiering och räknas inte ännu. ` : ""}Resultatdefinitionen är inte fastställd. {doc.resultNote}
        </Small>
      </Sec>
      <Sec n="3" title="Progression">
        <p>
          {m.progression.assessed >= m.minN ? (
            <>
              <b>{pct(m.progression.clear / m.progression.assessed, 0)}</b> av deltagarna med godkänd månadsbedömning visade tydlig progression ({lcfirst(doc.progressionRule.clear)}).{doc.progressionRule.excluded ? ` ${doc.progressionRule.excluded}` : ""} Underlag:{" "}
              {m.progression.assessed} bedömningar.
            </>
          ) : (
            `Färre än ${m.minN} godkända månadsbedömningar – andelen redovisas inte.`
          )}
        </p>
        {m.progression.assessed >= m.minN && (
          <TWrap min={420}>
            <thead>
              <tr>
                <th>Område</th>
                <th>Tydlig progression</th>
                <th>Andel</th>
              </tr>
            </thead>
            <tbody>
              {m.progression.areaDist.map((a) => (
                <tr key={a.key}>
                  <td>{a.label}</td>
                  <td className={NUM}>{small(a.clear)}</td>
                  <td className={NUM}>{a.clear > 0 && a.clear < m.minN ? "Redovisas inte" : pct(a.n ? a.clear / a.n : null, 0)}</td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Sec>
      <Sec n="4" title="Närvaro">
        <Kv
          items={[
            ["Närvarograd", pct(m.attendanceRate)], ["Planerade tillfällen", num(m.attendance.planned)], ["Giltig frånvaro", small(m.attendance.absentValid)],
            ["Ogiltig frånvaro", small(m.attendance.absentInvalid)],
          ]}
        />
      </Sec>
      <Sec n="5" title="Avvikelser">
        <Kv items={[["Avvikelser på deltagarnivå", small(m.deviations)], ["Avtalsavvikelser", small(m.contractDeviations)]]} />
      </Sec>
      <Sec n="6" title="Nöjdhet">
        <p>
          {m.pulse.enough ? (
            <>
              <b>{pct(m.pulse.satisfaction, 0)}</b> av deltagarna som svarade gav 4 eller 5 på en skala från 1 till 5 på frågan om hur nöjda de är ({m.pulse.responses} svar under {m.pulse.period}).
            </>
          ) : (
            `Färre än ${m.minN} svar under ${m.pulse.period} – resultatet redovisas inte.`
          )}
        </p>
      </Sec>
      {m.sla && (
        <Sec n="7" title="Svarstider">
          <Kv items={m.sla} />
        </Sec>
      )}
      <Sec n={m.sla ? "8" : "7"} title="Sammanfattning">
        {m.summary ? (
          <>
            <p>{m.summary}</p>
            <Small muted>
              Godkänd av {doc.approver}
              {doc.approvedAt ? `, ${dFull(doc.approvedAt)}` : ""}.
            </Small>
          </>
        ) : (
          <Wait>Sammanfattningen skrivs när avtalsansvarig godkänner rapporten.</Wait>
        )}
      </Sec>
    </Paper>
  );
}

// ---------------------------------------------------------------- Dokumentet
/** Rapportdokumentet för läsaren (vy-modellen från reportDocument). */
export function ReportDocument({ doc }: { doc: ReportDocView }) {
  // I kommunportalen är brödtexten 18 px även i papperet (stycken, tabellceller, listor) och liten text 16 px – som
  // prototypens portalregler. Papperets rubriker behåller sina storlekar.
  const body = (() => {
    switch (doc.kind) {
      case "monthly":
        return <MonthlyDoc doc={doc} />;
      case "final":
        return <FinalDoc doc={doc} />;
      case "weekly_attendance":
        return <WeeklyDoc doc={doc} />;
      case "order_confirmation":
        return <OrderDoc doc={doc} />;
      case "customer_summary":
        return <CustomerSummaryDoc doc={doc} />;
    }
  })();
  return (
    <div className="rap-doc [&_h3]:text-body [&_h3]:font-extrabold portal:[&_li]:text-portal portal:[&_p]:text-portal portal:[&_td]:text-portal portal:[&_.text-small]:text-body">
      {body}
    </div>
  );
}

/** Hämtar och visar rapportdokumentet (eller varför det inte visas). Loggar inte visningen. */
export function ReportDocumentById({ reportId }: { reportId: string }) {
  const q = useQuery(reportDocument, { reportId });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  const res = q.data;
  if (!res.ok) {
    const [t, b] = DENIED[res.reason] ?? DENIED.not_found;
    return (
      <Empty icon="file" title={t}>
        {b}
      </Empty>
    );
  }
  return <ReportDocument doc={res.doc} />;
}
