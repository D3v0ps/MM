// Rapportdokumenten som PDF (react-pdf) – samma avsnitt, ordning och texter som HTML-pappret i
// components/report-document.tsx, byggda av samma vy-modell (ReportDocView från frågan reportDocument). Levererade
// rapporter kommer från den frysta ögonblicksbilden, så en levererad rapport ger alltid samma innehåll.
// Ändras texterna i pappret ska de ändras här också – testet pdf.test.ts jämför rubrikerna och texterna i båda.
//
// Inga personnummer: modellen innehåller bara ärendenummer och id:n, och namnet är det läsaren får se (behörigheten).
import { Text, View } from "@react-pdf/renderer";
import { attLabel } from "@/core/labels";
import { TESTER_HIDDEN_TEXT } from "@/api/tester-access";
import { kr, num, pct } from "@/core/format";
import { fmtTime, monthName as monthText, weekday, WEEKDAYS } from "@/core/time";
import type { ReportDocView } from "../api";
import type { ActivityModel, AttRow, AttStats, DeviationModel, EventRow, ProgressionRow } from "../model";
import { dayMonth, dFull, dtFull, isDelivered, isDraftDoc, lcfirst, NO_PNR, PRINCIPLE, plain, reportTitle, smallN, ucfirst, weekRange, weekText } from "../report-helpers";
import { B, Check, CheckGrid, FixedText, H3, KEEP_TOGETHER_CHARS, Kv, Label, Meter, P, PdfDocument, Sec, Small, Stack2, Status, Table, Wait, type Col, type KvItem, type Rag } from "./primitives";
import { PDF_COLOR } from "./theme";

type Doc<K extends ReportDocView["kind"]> = Extract<ReportDocView, { kind: K }>;

// ---------------------------------------------------------------- Gemensamt
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
const Superseded = ({ doc }: { doc: ReportDocView }) => (doc.superseded ? <Label>Ersatt av en rättad version</Label> : null);

function AttendanceTable({ rows, total, firstCol }: { rows: AttRow[]; total: AttStats; firstCol: string }) {
  const showUnreg = total.unregistered > 0;
  const cols: Col[] = [
    { label: firstCol, width: showUnreg ? 22 : 26 }, { label: "Planerade tillfällen", width: 13, num: true }, { label: "Närvaro", width: 14, num: true },
    { label: "Giltig frånvaro", width: 13, num: true }, { label: "Ogiltig frånvaro", width: 13, num: true },
    ...(showUnreg ? [{ label: "Ej registrerade", width: 12, num: true }] : []), { label: "Närvarograd", width: showUnreg ? 13 : 21, num: true },
  ];
  const cells = (st: AttStats) => [
    String(st.planned), `${st.present + st.late}${st.late > 0 ? ` (${st.late} sen)` : ""}`, String(st.absentValid), String(st.absentInvalid),
    ...(showUnreg ? [String(st.unregistered)] : []), pct(st.rate, 0),
  ];
  return (
    <Table
      cols={cols}
      rows={rows.map((w) => ({ key: w.key, cells: [<Stack2 key="l" main={w.label} sub={w.sub} extra={w.paused ? "Uppehåll" : undefined} />, ...cells(w.st)] }))}
      foot={["Totalt", ...cells(total)]}
    />
  );
}

function ActivityChecklist({ a }: { a: ActivityModel }) {
  const done = new Set(a.done);
  return (
    <CheckGrid>
      {a.types.map((t) => (
        <Check key={t} checked={done.has(t)}>
          {plain(t)}
        </Check>
      ))}
    </CheckGrid>
  );
}

function EventsTable({ evs }: { evs: EventRow[] }) {
  if (evs.length === 0) return <P>Inga händelser registrerade under perioden.</P>;
  return (
    <Table
      cols={[{ label: "Datum", width: 20 }, { label: "Händelse", width: 28 }, { label: "Arbetsgivare eller anordnare", width: 26 }, { label: "Underlag", width: 26 }]}
      rows={evs.map((e) => ({ key: e.id, cells: [e.date, e.label, e.actor, e.basis] }))}
    />
  );
}

function DeviationsBlock({ dv }: { dv: DeviationModel }) {
  return (
    <View style={{ flexDirection: "column", gap: 6 }}>
      {dv.items.length === 0 ? (
        <P>Inga avvikelser under perioden.</P>
      ) : (
        dv.items.map((x) => (
          // Ett kort block hålls ihop på en sida; ett långt (beskrivning, bedömning och åtgärd upp till 2000 tecken var) bryts.
          <View
            key={x.id}
            wrap={`${x.description}${x.assessment ?? ""}${x.action}${x.follow}`.length > KEEP_TOGETHER_CHARS}
            minPresenceAhead={40}
            style={{ flexDirection: "column", gap: 3, borderLeftWidth: 2.5, borderLeftColor: PDF_COLOR.antracit, paddingLeft: 7, paddingVertical: 1 }}
          >
            <P>
              <B>{x.description}</B>{" "}
              <Text style={{ fontSize: 8.5, color: PDF_COLOR.muted }}>
                ({x.date} · {x.status})
              </Text>
            </P>
            {x.assessment ? (
              <P>
                <B>Risk och bedömning:</B> {x.assessment}
              </P>
            ) : null}
            <P>
              <B>Åtgärd:</B> {x.action}
            </P>
            <Small>{x.follow}</Small>
          </View>
        ))
      )}
      {dv.repeated.hit && (
        <P>
          <B>Risk:</B> Upprepad ogiltig frånvaro ({dv.repeated.count} tillfällen, regel: minst {dv.repeated.absentInvalid} inom {dv.repeated.withinDays} dagar).
        </P>
      )}
      <P>
        <B>Behöver beslut eller stöd från kommunen?</B> {dv.decision}
      </P>
    </View>
  );
}

function ProgressionTable({ p }: { p: { scale: string; rows: ProgressionRow[] } }) {
  return (
    <View style={{ flexDirection: "column", gap: 5 }}>
      <Small muted>Skala: {p.scale}.</Small>
      <Table
        cols={[{ label: "Område", width: 26 }, { label: "Nivå", width: 16 }, { label: "Observation", width: 34 }, { label: "Nästa steg", width: 24 }]}
        rows={p.rows.map((a) => ({ key: a.key, cells: [a.label, a.level, a.observation, a.nextStep] }))}
      />
    </View>
  );
}

const assessmentKv = (a: { overallStatus: Rag | null; summary: string; coach: string; date: string }): KvItem[] => [
  ["Samlad status", <Status key="s" value={a.overallStatus} />],
  ["Sammanfattning", a.summary],
  ["Ansvarig coach", a.coach],
  ["Datum", a.date],
];

// ---------------------------------------------------------------- Månadsrapport individ (mall 02, avsnitt 1–8)
function MonthlyPdf({ doc }: { doc: Doc<"monthly"> }) {
  const m = doc.m;
  const draft = !m.approved || isDraftDoc(doc.status);
  const month = m.month ? monthText(m.month) : "";
  return (
    <PdfDocument metaTitle={metaTitle(doc)} title="Månadsrapport individ" label={draft ? "Utkast" : null} watermark={!isDelivered(doc)} info={baseInfo(doc, m.caseNumber, [["Period", month]])}>
      <Superseded doc={doc} />
      {!m.approved && (
        <Small>
          <B>Utkast.</B> Månadsbedömningen för {month} är inte godkänd. Avsnitt 4, 7 och 8 visas först när coachen har godkänt den.
        </Small>
      )}
      <Sec n="1" title="Grunduppgifter">
        <Kv items={[["Deltagare", doc.participant], ...m.basics]} />
        <Small muted>{NO_PNR}</Small>
      </Sec>
      <Sec n="2" title="Närvaro och frånvaro">
        <AttendanceTable rows={m.weeks} total={m.total} firstCol="Vecka" />
        <P>
          <B>Giltig frånvaro per orsak:</B> {m.reasons}.
        </P>
        <P>
          <B>Upprepad ogiltig frånvaro:</B> {m.repeated.hit ? `Ja – ${m.repeated.count} tillfällen. Åtgärdsplan: se avsnitt 6.` : "Nej."}
        </P>
      </Sec>
      <Sec n="3" title="Genomförda aktiviteter">
        <Small muted>Aktivitetstyperna är exempel – de stäms av mot mall 02. Kryss betyder minst en registrerad aktivitet av typen i en godkänd avstämning.</Small>
        <ActivityChecklist a={m.activities} />
        <P>
          <B>Dokumentation:</B> {m.docText}
        </P>
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
        {!m.approved ? <Wait>Visas när coachen har godkänt månadsbedömningen.</Wait> : m.plan ? <Kv items={m.plan} /> : <P>Framgår inte.</P>}
      </Sec>
      <Sec n="8" title="Coachens sammanfattande bedömning">
        {m.assessment ? <Kv items={assessmentKv(m.assessment)} /> : <Wait>Visas när coachen har godkänt månadsbedömningen.</Wait>}
        <FixedText>{PRINCIPLE}</FixedText>
      </Sec>
    </PdfDocument>
  );
}

// ---------------------------------------------------------------- Slutrapport (hela perioden)
function FinalPdf({ doc }: { doc: Doc<"final"> }) {
  const m = doc.m;
  return (
    <PdfDocument metaTitle={metaTitle(doc)} title="Slutrapport" label={isDraftDoc(doc.status) ? "Utkast" : null} watermark={!isDelivered(doc)} info={baseInfo(doc, m.caseNumber, [["Period", m.period]])}>
      <Superseded doc={doc} />
      <Sec n="1" title="Grunduppgifter">
        <Kv items={[["Deltagare", doc.participant], ...m.basics]} />
        <Small muted>{NO_PNR}</Small>
      </Sec>
      <Sec n="2" title="Närvaro och frånvaro under hela perioden">
        <AttendanceTable rows={m.months} total={m.total} firstCol="Månad" />
        <P>
          <B>Giltig frånvaro per orsak:</B> {m.reasons}.
        </P>
        <P>
          <B>Upprepad ogiltig frånvaro:</B> {m.repeated.hit ? `Ja – ${m.repeated.count} tillfällen under perioden. Se avsnitt 6.` : "Nej."}
        </P>
      </Sec>
      <Sec n="3" title="Genomförda aktiviteter">
        <Small muted>Aktivitetstyperna är exempel – de stäms av mot mall 02.</Small>
        <ActivityChecklist a={m.activities} />
        <P>
          <B>Dokumentation:</B> {m.docText}
        </P>
      </Sec>
      <Sec n="4" title="Progression">
        {!m.progression ? (
          <P>Ingen godkänd månadsbedömning finns för perioden.</P>
        ) : (
          <View style={{ flexDirection: "column", gap: 5 }}>
            <Small muted>
              Jämförelse mellan första ({m.progression.firstMonth}) och senaste ({m.progression.lastMonth}) godkända månadsbedömning. Skala 0–3.
            </Small>
            <Table
              cols={[{ label: "Område", width: 30 }, { label: "Första", width: 12, num: true }, { label: "Senaste", width: 12, num: true }, { label: "Senaste observation", width: 46 }]}
              rows={m.progression.rows.map((a) => ({ key: a.key, cells: [a.label, String(a.first), String(a.last), a.observation] }))}
            />
          </View>
        )}
      </Sec>
      <Sec n="5" title="Resultat och utfall">
        <P>
          <B>Resultat:</B> {m.resultText}
        </P>
        <EventsTable evs={m.events} />
      </Sec>
      <Sec n="6" title="Avvikelse, risk och åtgärd">
        <DeviationsBlock dv={m.deviations} />
      </Sec>
      <Sec n="7" title="Kvarstående hinder och rekommenderad fortsättning">
        <P>
          <B>Kvarstående hinder:</B> {m.obstacles}
        </P>
        {m.recommendation ? (
          <P>
            <B>Rekommenderad fortsättning:</B> {m.recommendation}
          </P>
        ) : (
          <Wait>Coachen skriver rekommenderad fortsättning innan rapporten godkänns.</Wait>
        )}
      </Sec>
      <Sec n="8" title="Coachens sammanfattande bedömning">
        {m.assessment ? <Kv items={assessmentKv(m.assessment)} /> : <Wait>Ingen godkänd bedömning finns ännu.</Wait>}
        <FixedText>{PRINCIPLE}</FixedText>
      </Sec>
    </PdfDocument>
  );
}

// ---------------------------------------------------------------- Veckorapport närvaro (en per handläggare och vecka)
function WeeklyPdf({ doc }: { doc: Doc<"weekly_attendance"> }) {
  const m = doc.m;
  const secs = doc.sections;
  const open = secs.filter((s): s is Extract<typeof s, { restricted: false }> => !s.restricted);
  const hiddenProt = secs.length - open.length;
  const total = (k: keyof Omit<AttStats, "reasons" | "rate">) => open.reduce((acc, s) => acc + s.stats[k], 0);
  const reg = total("planned") - total("unregistered");
  const rate = reg ? (total("present") + total("late")) / reg : null;
  const protText = doc.customer ? "Namn och närvaro visas bara för handläggaren som beställde insatsen." : "Visas bara för namngiven coach och avtalsansvarig.";
  return (
    <PdfDocument
      metaTitle={metaTitle(doc)}
      title="Veckorapport närvaro"
      label={doc.status === "waiting" ? "Väntar på närvaro" : isDraftDoc(doc.status) ? "Utkast" : null}
      watermark={!isDelivered(doc)}
      info={[
        ["Beställare", doc.contract.customerName], ["Avtal", doc.contract.contractNumber], ["Mottagare", doc.recipient],
        ["Vecka", `${ucfirst(weekText(m.week))} (${weekRange(m.week)})`], ["Version", String(doc.version)], ["Publicerad", doc.deliveredAt ? dtFull(doc.deliveredAt) : "Inte publicerad"],
      ]}
    >
      <Superseded doc={doc} />
      {secs.length < doc.total && (
        <Small>
          <B>
            Du ser {secs.length} av {doc.total} deltagare
          </B>{" "}
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
          {hiddenProt > 0 ? ` Siffrorna räknar inte med ${hiddenProt === 1 ? "deltagaren" : "deltagarna"} med skyddade personuppgifter.` : ""}
        </Small>
        {open.length > 0 && (
          <Table
            cols={[{ label: "Deltagare", width: 30 }, { label: "Närvaro", width: 20, num: true }, { label: "Giltig frånvaro", width: 13, num: true }, { label: "Ogiltig frånvaro", width: 13, num: true }, { label: "Risk", width: 24 }]}
            rows={open.map((s) => ({
              key: s.caseId,
              cells: [
                <Stack2 key="n" main={s.name} sub={s.caseNumber} />,
                <Stack2 key="a" main={s.paused ? "Uppehåll" : `${s.stats.present + s.stats.late} av ${s.stats.planned}`} sub={s.stats.unregistered > 0 ? `${s.stats.unregistered} ej registrerade` : undefined} />,
                String(s.stats.absentValid), s.stats.absentInvalid > 0 ? <B key="i">{s.stats.absentInvalid}</B> : "0", s.risk,
              ],
            }))}
          />
        )}
      </Sec>
      <Sec title="Deltagare – tillfällen och åtgärder">
        {secs.length === 0 ? (
          <P>Inga deltagare att visa för din roll.</P>
        ) : (
          secs.map((s) =>
            s.restricted ? (
              <View key={s.caseId} wrap={false} style={{ flexDirection: "column", gap: 4, borderTopWidth: 0.75, borderTopColor: PDF_COLOR.ljusgra, paddingTop: 7 }}>
                <H3>{s.caseNumber} · Skyddade personuppgifter</H3>
                <Small>{protText}</Small>
              </View>
            ) : (
              <View key={s.caseId} style={{ flexDirection: "column", gap: 4, borderTopWidth: 0.75, borderTopColor: PDF_COLOR.ljusgra, paddingTop: 7 }}>
                <H3>
                  {s.name} · {s.caseNumber}
                </H3>
                {s.paused ? (
                  <P>Uppehåll denna vecka. Ingen närvaro planerad.</P>
                ) : s.rows.length === 0 ? (
                  <P>Inga tillfällen planerade denna vecka.</P>
                ) : (
                  <Table
                    cols={[{ label: "Tillfälle", width: 34 }, { label: "Aktivitet", width: 22 }, { label: "Närvaro", width: 22 }, { label: "Orsak", width: 22 }]}
                    rows={s.rows.map((a) => ({
                      key: a.id,
                      cells: [
                        `${ucfirst(WEEKDAYS[weekday(a.startsAt)])} ${dayMonth(a.startsAt)} klockan ${fmtTime(a.startsAt)}`, ucfirst(a.kind),
                        a.status ? attLabel(a.status) : a.startsAt > m.now ? "Planerat" : <B key="e">Ej registrerad</B>,
                        a.status === "absent_valid" ? a.reason || "Giltigt skäl" : "–",
                      ],
                    }))}
                  />
                )}
                <Small>
                  Planerade tillfällen {s.stats.planned} · närvaro {s.stats.present + s.stats.late} · giltig frånvaro {s.stats.absentValid} · ogiltig frånvaro {s.stats.absentInvalid}
                </Small>
                {s.stats.absentInvalid > 0 && (
                  <P>
                    <B>Åtgärd vid ogiltig frånvaro:</B> {s.actions.length ? s.actions.join(" ") : "Coachen följer upp frånvaron med deltagaren i nästa veckoavstämning."}
                  </P>
                )}
                <P>
                  <B>Risk:</B> {s.risk}
                </P>
              </View>
            ),
          )
        )}
      </Sec>
      <FixedText>
        Veckorapporten skapas automatiskt från coachernas närvaroregistrering. Den publiceras när alla deltagare är registrerade, senast {doc.pubDay} klockan {doc.pubTime.replace(":", ".")} för föregående vecka.
      </FixedText>
    </PdfDocument>
  );
}

// ---------------------------------------------------------------- Orderbekräftelse
function OrderPdf({ doc }: { doc: Doc<"order_confirmation"> }) {
  const m = doc.m;
  return (
    <PdfDocument metaTitle={metaTitle(doc)} title="Orderbekräftelse" label={isDraftDoc(doc.status) ? "Utkast" : null} watermark={!isDelivered(doc)} info={baseInfo(doc, m.caseNumber, [["Beställarreferens", m.buyerReference || "Saknas"]])}>
      <Superseded doc={doc} />
      <P>
        Miljonbemanning bekräftar beställningen med ärendenummer <B>{m.caseNumber}</B>. Ärendenumret är också ordernummer och står på fakturorna. Använd det i stället för personnummer när ni kontaktar oss.
      </P>
      <Sec title="Insatsen">
        <Kv
          items={[
            ["Deltagare", doc.participant], ["Ärendenummer", m.caseNumber], ["Avtalsområde", m.area], ["Yrkesspår", m.track], ["Startdatum", m.start], ["Huvudcoach", m.coach],
            ["Första mötet", m.firstMeeting], ["Planerad omfattning", m.weeks ? `${m.weeks} veckor${m.plannedEnd ? ` (till och med ${m.plannedEnd})` : ""}` : "Ej angiven"],
          ]}
        />
      </Sec>
      <Sec title="Beställningens värde">
        {m.weeks && m.price === undefined ? (
          <Kv
            items={[
              ["Planerad omfattning", `${m.weeks} veckor`],
              ["Veckopris exklusive moms", TESTER_HIDDEN_TEXT],
              ["Beställningens värde exklusive moms", TESTER_HIDDEN_TEXT],
            ]}
          />
        ) : m.weeks && m.price !== undefined ? (
          <Kv
            items={[
              ["Planerad omfattning", `${m.weeks} veckor`],
              ["Veckopris exklusive moms", `${kr(m.price)} (${m.area})`],
              [
                "Beställningens värde exklusive moms",
                <Text key="v" style={{ fontSize: 10, lineHeight: 1.35 }}>
                  <B>{kr(m.weeks * m.price)}</B>{" "}
                  <Text style={{ fontSize: 8.5, color: PDF_COLOR.muted }}>
                    ({m.weeks} × {kr(m.price)})
                  </Text>
                </Text>,
              ],
            ]}
          />
        ) : (
          <P>Värdet beräknas när omfattningen är bestämd.</P>
        )}
        <Small>
          Värdet är planerade veckor gånger veckopriset för avtalsområdet. Det används för att visa upparbetat och återstående belopp på varje faktura. Fakturering sker per deltagarvecka.
        </Small>
      </Sec>
      <Sec title="Fakturering">
        <Kv
          items={[
            ["Beställarreferens", m.buyerReference || "Saknas – måste kompletteras"],
            ["Kommunens inköpsordernummer", m.purchaseOrderNumber || "Inget angivet"],
            ["Faktureringsobjekt", `Ärende ${m.caseNumber}`],
          ]}
        />
      </Sec>
      <FixedText>Frågor om beställningen? Skicka ett meddelande i portalen och ange ärendenumret. Skriv inte personnummer i e-post.</FixedText>
    </PdfDocument>
  );
}

// ---------------------------------------------------------------- Beställarrapport (kommunens chef)
function CustomerSummaryPdf({ doc }: { doc: Doc<"customer_summary"> }) {
  const m = doc.m;
  const target = m.result.contractTarget;
  const small = (n: number) => smallN(m.minN, n);
  const numSmall = (x: { num: number }) => x.num > 0 && x.num < m.minN;
  const resRow = (label: string, x: { value: number | null; num: number; den: number }) => {
    const hidden = x.den > 0 && x.den < m.minN;
    const share = x.den === 0 ? "–" : hidden || numSmall(x) ? "Redovisas inte" : pct(x.value);
    const vs = x.den === 0 || hidden ? "–" : x.den < m.resultMinN ? "För få avslut för att bedöma" : (x.value ?? 0) >= target ? "I nivå med eller över avtalsmålet" : "Under avtalsmålet";
    return { key: label, cells: [label, small(x.num), hidden ? `färre än ${m.minN}` : String(x.den), share, vs] };
  };
  const roll = m.result.rolling;
  const tracks = m.byTrack.slice(0, 8);
  const restTracks = m.byTrack.slice(8);
  const month = monthText(m.month);
  return (
    <PdfDocument metaTitle={metaTitle(doc)} title="Beställarrapport" label={isDraftDoc(doc.status) ? "Utkast" : null} watermark={!isDelivered(doc)} info={baseInfo(doc, null, [["Månad", month], ["Mottagare", doc.recipient]])}>
      <Superseded doc={doc} />
      <Small>
        Uppgifter per grupp med färre än {m.minN} personer redovisas som &quot;färre än {m.minN}&quot;. Rapporten innehåller inga namn.
      </Small>
      <Sec n="1" title="Deltagare">
        <Kv items={[["Aktiva under månaden", small(m.active)], ["Nya insatser", small(m.started)], ["Avslutade insatser", small(m.closed)]]} />
        <Table
          cols={[{ label: "Avtalsområde", width: 46 }, { label: "Aktiva", width: 18, num: true }, { label: "Nya", width: 18, num: true }, { label: "Avslutade", width: 18, num: true }]}
          rows={m.byArea.map((a) => ({ key: a.code, cells: [a.name, small(a.active), small(a.started), small(a.closed)] }))}
        />
        <Table
          cols={[{ label: "Yrkesspår", width: 70 }, { label: "Aktiva", width: 30, num: true }]}
          rows={[
            ...tracks.map((t) => ({ key: t.track || "-", cells: [t.track || "Inte valt än", small(t.active)] })),
            ...(restTracks.length > 0 ? [{ key: "rest", cells: [`Övriga ${restTracks.length} yrkesspår`, small(restTracks.reduce((s, t) => s + t.active, 0))] }] : []),
          ]}
        />
      </Sec>
      <Sec n="2" title="Resultat – arbete eller studier">
        <Table
          cols={[{ label: "Period", width: 22 }, { label: "Resultat", width: 14, num: true }, { label: "Avslut som räknas", width: 18, num: true }, { label: "Andel", width: 16, num: true }, { label: `Jämfört med avtalsmålet ${pct(target, 0)}`, width: 30 }]}
          rows={[resRow(ucfirst(month), m.result.month), resRow("Rullande 6 månader", roll), resRow("Sedan avtalets start", m.result.sinceStart)]}
        />
        {roll.den >= m.resultMinN && roll.value != null && !numSmall(roll) && (
          <Meter value={roll.value} max={0.6} label={`Resultatgrad rullande 6 månader ${pct(roll.value)}`} markers={[{ value: target, label: `Avtalsmål ${pct(target, 0)}` }]} />
        )}
        <Small>
          {roll.prelim > 0 ? `${ucfirst(small(roll.prelim))} avslut till arbete eller studier väntar på verifiering och räknas inte ännu. ` : ""}Resultatdefinitionen är inte fastställd. {doc.resultNote}
        </Small>
      </Sec>
      <Sec n="3" title="Progression">
        {m.progression.assessed >= m.minN ? (
          <P>
            <B>{pct(m.progression.clear / m.progression.assessed, 0)}</B> av deltagarna med godkänd månadsbedömning visade tydlig progression ({lcfirst(doc.progressionRule.clear)}).{doc.progressionRule.excluded ? ` ${doc.progressionRule.excluded}` : ""} Underlag:{" "}
            {m.progression.assessed} bedömningar.
          </P>
        ) : (
          <P>{`Färre än ${m.minN} godkända månadsbedömningar – andelen redovisas inte.`}</P>
        )}
        {m.progression.assessed >= m.minN && (
          <Table
            cols={[{ label: "Område", width: 52 }, { label: "Tydlig progression", width: 24, num: true }, { label: "Andel", width: 24, num: true }]}
            rows={m.progression.areaDist.map((a) => ({ key: a.key, cells: [a.label, small(a.clear), a.clear > 0 && a.clear < m.minN ? "Redovisas inte" : pct(a.n ? a.clear / a.n : null, 0)] }))}
          />
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
        {m.pulse.enough ? (
          <P>
            <B>{pct(m.pulse.satisfaction, 0)}</B> av deltagarna som svarade gav 4 eller 5 på en skala från 1 till 5 på frågan om hur nöjda de är ({m.pulse.responses} svar under {m.pulse.period}).
          </P>
        ) : (
          <P>{`Färre än ${m.minN} svar under ${m.pulse.period} – resultatet redovisas inte.`}</P>
        )}
      </Sec>
      {m.sla && (
        <Sec n="7" title="Svarstider">
          <Kv items={m.sla} />
        </Sec>
      )}
      <Sec n={m.sla ? "8" : "7"} title="Sammanfattning">
        {m.summary ? (
          <>
            <P>{m.summary}</P>
            <Small muted>
              Godkänd av {doc.approver}
              {doc.approvedAt ? `, ${dFull(doc.approvedAt)}` : ""}.
            </Small>
          </>
        ) : (
          <Wait>Sammanfattningen skrivs när avtalsansvarig godkänner rapporten.</Wait>
        )}
      </Sec>
    </PdfDocument>
  );
}

// ---------------------------------------------------------------- Dokumentet
/** PDF:ens titel i metadata: rapportens rubrik och ärendenumret (inga namn). */
export function metaTitle(doc: ReportDocView): string {
  const head = {
    kind: doc.kind,
    month: doc.kind === "monthly" || doc.kind === "customer_summary" ? doc.m.month : null,
    week: doc.kind === "weekly_attendance" ? doc.m.week : null,
    periodStart: null,
  };
  const caseNumber = doc.kind === "monthly" || doc.kind === "final" || doc.kind === "order_confirmation" ? doc.m.caseNumber : null;
  return `${reportTitle(head)}${caseNumber ? ` – ${caseNumber}` : ""}`;
}

/** Rapportdokumentet som PDF för läsaren (samma vy-modell som HTML-pappret). */
export function ReportPdf({ doc }: { doc: ReportDocView }) {
  switch (doc.kind) {
    case "monthly":
      return <MonthlyPdf doc={doc} />;
    case "final":
      return <FinalPdf doc={doc} />;
    case "weekly_attendance":
      return <WeeklyPdf doc={doc} />;
    case "order_confirmation":
      return <OrderPdf doc={doc} />;
    case "customer_summary":
      return <CustomerSummaryPdf doc={doc} />;
  }
}
