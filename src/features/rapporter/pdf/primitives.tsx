// Byggstenarna i PDF:erna – samma utseende som HTML-pappret (src/ui/paper.tsx) i react-pdf: logotyp överst, avtals- och
// ärendeinformation i högerställt block, rubriker i versaler med linje under, antracit text på vitt, tabeller med ljusgrå
// linjer. Sidfot på varje sida ("Miljonbemanning AB · Miljonmatch", "Sida X av Y"). Rapporter som inte är levererade får
// vattenstämpeln "Utkast – inte levererad" på varje sida.
import type { ReactNode } from "react";
import { Circle, Document, Line, Page, Path, Svg, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { PdfBrand } from "./brand";
import { PDF_COLOR, PDF_FONT, PDF_SIZE } from "./theme";

const C = PDF_COLOR;
/**
 * Löptext med radavstånd. Sätts på textelementen tillsammans med storleken och inte på sidan: lineHeight på Page flyttar
 * sidfoten (fast och absolut placerad), och ett lineHeight utan fontSize på samma element räknas mot 18 pt i react-pdf 4.
 */
const BODY: Style = { fontSize: PDF_SIZE.body, lineHeight: 1.35 };
const SMALL: Style = { fontSize: PDF_SIZE.small, lineHeight: 1.35 };
/** Vattenstämpeln på rapporter som inte är levererade (samma text som pappret i appen). */
export const DRAFT_WATERMARK = "Utkast – inte levererad";

// ---------------------------------------------------------------- Dokumentet och sidan
export type PdfDocumentProps = {
  /** PDF:ens titel i metadata (t.ex. "Månadsrapport januari 2027 – BOT-26-0143"). Inga namn. */
  metaTitle: string;
  /** Dokumentets rubrik (versaler). */
  title: string;
  /** Högerställt informationsblock: [["Avtal", "332026110"], …]. */
  info: readonly (readonly [string, string])[];
  /** Etiketten överst som i pappret ("Utkast", "Väntar på närvaro"). */
  label?: string | null;
  /** Vattenstämpel på varje sida (rapporten är inte levererad). */
  watermark?: boolean;
  children?: ReactNode;
};

export function PdfDocument({ metaTitle, title, info, label, watermark, children }: PdfDocumentProps) {
  return (
    <Document title={metaTitle} author="Miljonbemanning AB" creator="Miljonmatch" producer="Miljonmatch" language="sv">
      <Page size="A4" style={{ fontFamily: PDF_FONT, fontSize: PDF_SIZE.body, color: C.antracit, backgroundColor: C.vit, paddingTop: 40, paddingBottom: 58, paddingHorizontal: 44 }}>
        {watermark && (
          <View fixed style={{ position: "absolute", top: 380, left: -80, right: -80, alignItems: "center", transform: "rotate(-32deg)" }}>
            <Text style={{ fontSize: 34, fontWeight: 800, color: C.ljusgra, letterSpacing: 1.5, textTransform: "uppercase" }}>{DRAFT_WATERMARK}</Text>
          </View>
        )}
        {/* Sidfoten först bland sidans barn: react-pdf upprepar fasta element på varje sida bara om de står före innehåll som bryts. */}
        <View fixed style={{ position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: C.ljusgra, paddingTop: 6 }}>
          <Text style={{ fontSize: PDF_SIZE.label, color: C.muted }}>Miljonbemanning AB · Miljonmatch</Text>
          <Text style={{ fontSize: PDF_SIZE.label, color: C.muted }} render={({ pageNumber, totalPages }) => `Sida ${pageNumber} av ${totalPages}`} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 14 }}>
          <PdfBrand />
          {info.length > 0 && (
            <View style={{ alignItems: "flex-end", maxWidth: 300 }}>
              {info.map(([k, v], i) => (
                <Text key={i} style={{ fontSize: PDF_SIZE.meta, textAlign: "right", lineHeight: 1.55 }}>
                  <Text style={{ fontWeight: 700 }}>{k}:</Text> {v}
                </Text>
              ))}
            </View>
          )}
        </View>
        {label && <Label>{label}</Label>}
        <Text style={{ fontSize: PDF_SIZE.h1, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 12 }}>{title}</Text>
        <View style={{ flexDirection: "column", gap: 12 }}>{children}</View>
      </Page>
    </Document>
  );
}

/** Etikett med streckad ram (pappret: "Utkast", "Ersatt av en rättad version"). */
export function Label({ children }: { children: ReactNode }) {
  return (
    <View style={{ alignSelf: "flex-start", borderWidth: 1.5, borderStyle: "dashed", borderColor: C.antracit, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 10 }}>
      <Text style={{ fontSize: PDF_SIZE.label, fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase" }}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- Text
/**
 * Luft före en rubrik. Den behövs också för att rubriken inte ska hamna ensam sist på en sida: react-pdf flyttar bara ett
 * element med minPresenceAhead till nästa sida om något står före det i samma behållare.
 */
const Before = ({ h }: { h: number }) => <View style={{ height: h }} />;

/** Avsnitt med rubrik i versaler och linje under ("1. Grunduppgifter"). Rubriken hamnar aldrig ensam sist på en sida. */
export function Sec({ n, title, children }: { n?: string; title: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: "column", gap: 6 }}>
      <Before h={0} />
      <Text minPresenceAhead={70} style={{ fontSize: PDF_SIZE.h2, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", borderBottomWidth: 1.5, borderBottomColor: C.antracit, paddingBottom: 3, marginTop: -2 }}>
        {n ? `${n}. ` : ""}
        {title}
      </Text>
      {children}
    </View>
  );
}
/** Underrubrik (veckorapportens deltagare) – hamnar aldrig ensam sist på en sida. */
export const H3 = ({ children }: { children: ReactNode }) => (
  <>
    <Before h={0} />
    <Text minPresenceAhead={60} style={{ fontSize: PDF_SIZE.h3, fontWeight: 800 }}>
      {children}
    </Text>
  </>
);
export const P = ({ children, style }: { children: ReactNode; style?: Style }) => <Text style={{ ...BODY, ...style }}>{children}</Text>;
/** Fet text inuti ett stycke. */
export const B = ({ children }: { children: ReactNode }) => <Text style={{ fontWeight: 700 }}>{children}</Text>;
export const Small = ({ children, muted }: { children: ReactNode; muted?: boolean }) => <Text style={{ ...SMALL, color: muted ? C.muted : C.antracit }}>{children}</Text>;
/** Väntar på något (kursiv i pappret – Montserrat finns bara upprätt här, så den visas i dämpad färg). */
export const Wait = ({ children }: { children: ReactNode }) => <Text style={{ ...BODY, color: C.muted }}>{children}</Text>;
/** Mallens fasta text längst ned. */
export const FixedText = ({ children }: { children: ReactNode }) => (
  <View style={{ borderTopWidth: 0.75, borderTopColor: C.ljusgra, paddingTop: 7 }}>
    <Text style={{ fontSize: PDF_SIZE.meta, lineHeight: 1.35, color: C.muted }}>{children}</Text>
  </View>
);

// ---------------------------------------------------------------- Nyckel–värde och tabeller
export type KvItem = readonly [string, ReactNode] | null | false | undefined;
/** Nyckel–värde-lista (pappret: Kv). */
export function Kv({ items }: { items: readonly KvItem[] }) {
  return (
    <View style={{ flexDirection: "column", gap: 3 }}>
      {items
        .filter((x): x is readonly [string, ReactNode] => !!x)
        .map(([k, v], i) => (
          <View key={i} wrap={false} style={{ flexDirection: "row", gap: 10 }}>
            <Text style={{ ...BODY, width: "32%", fontWeight: 700, color: C.muted }}>{k}</Text>
            <View style={{ flex: 1 }}>{typeof v === "string" || typeof v === "number" ? <Text style={BODY}>{v === "" ? "–" : v}</Text> : (v ?? <Text>–</Text>)}</View>
          </View>
        ))}
    </View>
  );
}

export type Col = { label: string; width: number; num?: boolean };
export type Cell = ReactNode;
const cellStyle = (c: Col, head = false): Style => ({
  width: `${c.width}%`, paddingHorizontal: 4, paddingVertical: 3, borderRightWidth: 0.75, borderRightColor: C.ljusgra, fontSize: PDF_SIZE.small,
  ...(head ? { fontWeight: 700, backgroundColor: C.ljusgraTon } : {}), ...(c.num ? { textAlign: "right" as const } : {}),
});
const cell = (v: Cell) => (typeof v === "string" || typeof v === "number" ? <Text style={{ ...SMALL, lineHeight: 1.3 }}>{v}</Text> : v);
/** Tabell med ljusgrå linjer och huvud (pappret: table). Bredderna i procent. En rad delas aldrig mellan sidor. */
export function Table({ cols, rows, foot }: { cols: readonly Col[]; rows: readonly { key: string; cells: readonly Cell[] }[]; foot?: readonly Cell[] }) {
  const row = (cells: readonly Cell[], key: string, opts: { head?: boolean; bold?: boolean } = {}) => (
    <View key={key} wrap={false} style={{ flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.ljusgra, ...(opts.bold ? { fontWeight: 700 } : {}) }}>
      {cols.map((c, i) => (
        <View key={i} style={cellStyle(c, opts.head)}>
          {cell(cells[i] ?? "")}
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ borderTopWidth: 0.75, borderLeftWidth: 0.75, borderColor: C.ljusgra }}>
      {row(cols.map((c) => c.label), "head", { head: true })}
      {rows.map((r) => row(r.cells, r.key))}
      {foot && row(foot, "foot", { bold: true })}
    </View>
  );
}
/** Två rader i en cell: huvudtext och dämpad undertext (veckans datum, ärendenumret). */
export const Stack2 = ({ main, sub, extra }: { main: ReactNode; sub?: ReactNode; extra?: ReactNode }) => (
  <View>
    <Text>{main}</Text>
    {sub ? <Text style={{ fontSize: PDF_SIZE.label, color: C.muted }}>{sub}</Text> : null}
    {extra ? <Text style={{ fontSize: PDF_SIZE.label, color: C.muted }}>{extra}</Text> : null}
  </View>
);

// ---------------------------------------------------------------- Kryssruta, status och mätare
/** Kryssruta (pappret: XBox) med texten bredvid – "Genomförd"/"Inte genomförd" syns som kryss + text. */
export function Check({ checked, children }: { checked: boolean; children: ReactNode }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", alignItems: "flex-start", gap: 5, width: "48%" }}>
      <View style={{ width: 9, height: 9, borderWidth: 1.2, borderColor: C.antracit, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
        {checked ? <Text style={{ fontSize: 7, fontWeight: 800, lineHeight: 1 }}>X</Text> : null}
      </View>
      <Text style={{ ...BODY, flex: 1 }}>{children}</Text>
    </View>
  );
}
export const CheckGrid = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 3 }}>{children}</View>;

export type Rag = "green" | "yellow" | "red";
/** Samma texter som appens Status (src/ui/badge.tsx). */
const RAG_TEXT: Record<Rag, string> = { green: "Grön – enligt plan", yellow: "Gul – risk eller extra åtgärd", red: "Röd – kräver omplanering eller dialog" };
/** Samlad status: alltid text + symbol. Grön → blå yta, Gul → ljusgrå yta, Röd → röd ram och röd symbol, antracit text. */
export function Status({ value }: { value: Rag | null | undefined }) {
  const look: Record<Rag | "none", Style> = {
    green: { backgroundColor: C.bla },
    yellow: { backgroundColor: C.ljusgra },
    red: { borderWidth: 1.5, borderColor: C.rod, backgroundColor: C.vit },
    none: { borderWidth: 1, borderStyle: "dashed", borderColor: C.muted, backgroundColor: C.vit },
  };
  const key = value ?? "none";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, borderRadius: 9, paddingVertical: 2, paddingLeft: 4, paddingRight: 8, ...look[key] }}>
      <StatusIcon value={value ?? null} />
      <Text style={{ fontSize: PDF_SIZE.small, fontWeight: 700, color: value ? C.antracit : C.muted }}>{value ? RAG_TEXT[value] : "Ej bedömd"}</Text>
    </View>
  );
}
function StatusIcon({ value }: { value: Rag | null }) {
  const stroke = value === "red" ? C.rod : value ? C.antracit : C.muted;
  if (value === "red") {
    return (
      <Svg width={10} height={10} viewBox="0 0 24 24">
        <Path d="M12 3 L22 20 L2 20 Z" stroke={stroke} strokeWidth={2.4} fill="none" />
        <Line x1={12} y1={9} x2={12} y2={14} stroke={stroke} strokeWidth={2.4} />
        <Circle cx={12} cy={17} r={1.3} fill={stroke} />
      </Svg>
    );
  }
  return (
    <Svg width={10} height={10} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9.5} stroke={stroke} strokeWidth={2.4} fill="none" />
      {value === "green" && <Path d="M7.5 12.5 L10.5 15.5 L16.5 9" stroke={stroke} strokeWidth={2.4} fill="none" />}
      {value === "yellow" && <Line x1={12} y1={7} x2={12} y2={13} stroke={stroke} strokeWidth={2.4} />}
      {value === "yellow" && <Circle cx={12} cy={16.5} r={1.3} fill={stroke} />}
      {!value && <Line x1={7.5} y1={12} x2={16.5} y2={12} stroke={stroke} strokeWidth={2.4} />}
    </Svg>
  );
}

/** Mätare med markeringar (pappret: Meter) – stapeln blå, avtalsmålet som röd markering, förklaring som text. */
export function Meter({ value, max, label, markers }: { value: number; max: number; label: string; markers: { value: number; label: string }[] }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <View wrap={false} style={{ flexDirection: "column", gap: 4 }}>
      <Text style={{ fontSize: PDF_SIZE.small }}>{label}</Text>
      <View style={{ position: "relative", height: 8, borderRadius: 4, backgroundColor: C.ljusgraTon, borderWidth: 0.5, borderColor: C.ljusgra }}>
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: pct(value), borderRadius: 4, backgroundColor: C.bla }} />
        {markers.map((m) => (
          <View key={m.label} style={{ position: "absolute", top: -3, bottom: -3, left: pct(m.value), width: 1.5, backgroundColor: C.rod }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {markers.map((m) => (
          <View key={m.label} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 8, height: 2, backgroundColor: C.rod }} />
            <Text style={{ fontSize: PDF_SIZE.label, color: C.muted }}>{m.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
