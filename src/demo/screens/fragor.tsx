"use client";
// Öppna frågor (/om/fragor, SPEC §13) – port av den gamla prototypens vy om.fragor (prototyp/src/90-feedback.js).
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card, Page } from "@/ui/page";
import { Table, type Column } from "@/ui/table";
import { openFeedback } from "../feedback-store";

type QStatus = "done" | "blocking" | "open";
type Question = { id: number; q: string; who: string; status: string; kind: QStatus };

/** [nummer, fråga, svarar, status, typ] – samma lista som den gamla prototypens MM.OPEN_QUESTIONS. */
export const OPEN_QUESTIONS: [number, string, string, string, QStatus][] = [
  [1, "Inspelning och underbiträden", "Botkyrka", "Godkänt 2026-09-29 – ska in skriftligt i PUB-avtalet, inklusive eventuell åtkomst från tredje land", "done"],
  [2, "Inköpsordersystem", "Botkyrka", "Besvarad: kommunen har inget – Miljonmatch är beställningssystemet", "done"],
  [3, "Vilken beställarreferens ska stå på fakturorna – per handläggare, per enhet eller en för hela avtalet? Bekräfta skriftligt att mejlbeställning + beställarreferens + Peppol uppfyller e-handelsbilagan.", "Botkyrka (e-handel)", "Öppen – blockerar fakturering", "blocking"],
  [4, "Debiterbar vecka", "Botkyrka", "Besvarad: alla veckor deltagaren är inskriven. Delvisa start- och slutveckor räknas, pausade veckor räknas inte", "done"],
  [5, "En faktura per deltagare och månad, eller skriftligt godkänd samlingsfaktura per beställarreferens?", "Botkyrka", "Öppen", "open"],
  [6, "Resultatdefinition: vilka anställningar och studier räknas, när mäts det, vilka avslut exkluderas?", "Botkyrka", "Öppen – blockerar resultatflaggor", "blocking"],
  [7, "Vill kommunen ha frånvaronotis samma dag, utöver veckorapporten?", "Botkyrka", "Öppen", "open"],
  [8, "Deadline för månads- och slutrapport; räcker portalen som kanal eller krävs e-post?", "Botkyrka", "Öppen", "open"],
  [9, "Räcker e-postkod som inloggning för kommunens personal? Ska handläggare se hela enhetens ärenden?", "Botkyrka (IT)", "Öppen", "open"],
  [10, "Säker rutin för personer med skydd", "Botkyrka", "Stängd: hanteras utanför Miljonmatch (beslut 2026-10-07)", "done"],
  [11, "Gallring under avtalstiden", "Botkyrka", "Öppen", "open"],
  [12, "Progressionsområden: räcker tillägget språk, eller vill kommunen också följa hälsa och livskvalitet?", "Botkyrka + MB", "Öppen", "open"],
  [13, "Incitamentsmodell: vilken modell gäller och när kan bonus begäras?", "Botkyrka + MB", "Öppen", "open"],
  [14, "Beställarrapportens innehåll och frekvens", "Botkyrka", "Öppen", "open"],
  [15, "Ingår Fortnox Integration och e-faktura i vårt paket? Vem godkänner API-kopplingen?", "MB ekonomi", "Öppen", "open"],
  [16, "Vem är systemägare och vem administrerar DNS hos one.com?", "MB", "Öppen", "open"],
  [17, "Ska SLA-statistik visas för kommunen?", "MB ledning", "Öppen", "open"],
  [18, "Val av SMS- och e-postleverantör", "MB", "Öppen", "open"],
];

const COLUMNS: Column<Question>[] = [
  { key: "id", label: "#", width: "48px", render: (r) => <span className="font-bold">{r.id}</span> },
  { key: "q", label: "Fråga" },
  { key: "who", label: "Svarar", render: (r) => <span className="whitespace-nowrap">{r.who}</span> },
  {
    key: "status",
    label: "Status",
    render: (r) => (
      <Badge tone={r.kind === "done" ? "blue" : r.kind === "blocking" ? "red" : "outline"} icon={r.kind === "done" ? "check" : r.kind === "blocking" ? "alert" : "help"}>
        {r.status}
      </Badge>
    ),
  },
  {
    key: "fb",
    label: "",
    render: (r) => <Button kind="ghost" icon="message-circle" ariaLabel={`Feedback på fråga ${r.id}`} onClick={() => openFeedback()} />,
  },
];

export function FragorScreen() {
  const rows = OPEN_QUESTIONS.map(([id, q, who, status, kind]) => ({ id, q, who, status, kind }));
  return (
    <Page title="Öppna frågor" eyebrow="SPEC §13" lead="Frågor som måste besvaras av Botkyrka eller Miljonbemanning. Där prototypen har gjort ett antagande står det i vyn.">
      <Card flush>
        <Table caption="Öppna frågor" columns={COLUMNS} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </Page>
  );
}
