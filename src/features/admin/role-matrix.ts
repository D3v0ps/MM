// Behörighetsmatrisen och rollbeskrivningarna på Användare och roller (UX-genomgången, paket 1, A1). Ren data utan I/O –
// skärmen (screens/anvandare.tsx) ritar den. Texterna ska stämma med verkligheten: hanterarnas roller (rolesOf), rutterna
// och policyn (src/data/policy.ts, src/core/access.ts). Testet role-matrix.test.ts låser varje rad mot de rollerna, så att
// matrisen inte kan visa något annat än det appen gör. Viktigt (CLAUDE.md):
//   * bara ekonomen ser fakturaunderlag och belopp (beslut 2026-10-07, spärrat på servern)
//   * coachen ser och arbetar i alla ärenden i avtalet – tilldelningen styr notiser och Mina ärenden (beslut 2026-10-09)
//   * chefen läser ärendena, kvitterar flaggor och signerar den månatliga loggkontrollen; systemadministratören läser ärendena
//   * nya beställningar tas emot av samordnaren och avtalsansvarig – och av coachen bara som avtalets intagsansvarige (Karims
//     beslut 2026-11-09); bara samordnaren och avtalsansvarig avböjer
import type { EscalationRole } from "@/core/config";

/** Kolumnerna: rollerna i appen (den vilande rollen handledare visas inte). */
export const MATRIX_ROLES = ["admin", "avtalsansvarig", "samordnare", "coach", "chef", "ekonom", "kommun_handlaggare"] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];
export const MATRIX_ROLE_LABEL: Record<MatrixRole, string> = {
  admin: "Admin", avtalsansvarig: "Avtals­ansvarig", samordnare: "Sam­ordnare", coach: "Coach", chef: "Chef och con­troller", ekonom: "Ekonom",
  kommun_handlaggare: "Kommunens hand­läggare",
};

/** Cellens värde (text och ikon på skärmen). */
export type MatrixCell = "ja" | "alla" | "nej" | "las" | "egna" | "nummer" | "mottagare" | "dold" | "ser";
export type MatrixRow = { key: string; label: string; cells: Record<MatrixRole, MatrixCell> };
export type MatrixGroup = { title: string; rows: MatrixRow[] };

/** En rad: de roller som har ett värde, övriga "nej". */
const row = (key: string, label: string, set: Partial<Record<MatrixRole, MatrixCell>>): MatrixRow => ({
  key, label, cells: Object.fromEntries(MATRIX_ROLES.map((r) => [r, set[r] ?? "nej"])) as Record<MatrixRole, MatrixCell>,
});
const all = (roles: readonly MatrixRole[], cell: MatrixCell = "ja"): Partial<Record<MatrixRole, MatrixCell>> => Object.fromEntries(roles.map((r) => [r, cell]));

/** "chef" -> "chef/controller" i eskaleringens rubrik. */
export type EscalationWord = (r: EscalationRole) => string;

export function roleMatrix(escalateTo: readonly EscalationRole[], escWord: EscalationWord): MatrixGroup[] {
  const esc = escalateTo as readonly string[];
  return [
    {
      title: "Ser",
      rows: [
        row("cases", "Ärenden i avtalet", { admin: "las", avtalsansvarig: "alla", samordnare: "alla", coach: "alla", chef: "las", ekonom: "nummer", kommun_handlaggare: "egna" }),
        row("notes", "Coachanteckningar", { admin: "las", avtalsansvarig: "ja", samordnare: "ja", coach: "ja", chef: "las" }),
        row("reports", "Rapporter", { avtalsansvarig: "ja", samordnare: "ja", coach: "ja", chef: "las", kommun_handlaggare: "egna" }),
        row("billing", "Fakturaunderlag och belopp", { ekonom: "ja" }),
        row("config", "Avtalskonfiguration", { admin: "ja" }),
        row("audit", "Revisionslogg", { admin: "ja", chef: "ja" }),
      ],
    },
    {
      title: "Gör",
      rows: [
        row("accept", "Ta emot nya beställningar – coachen bara som avtalets intagsansvarige", all(["avtalsansvarig", "samordnare", "coach"])),
        row("decline", "Avböja avrop", all(["avtalsansvarig", "samordnare"])),
        row("customers", "Bjuda in och spärra kommunanvändare", all(["admin", "avtalsansvarig"])),
        row("staff", "Lägga till kollegor och ändra roller", all(["admin"])),
        row("admin", "Ändra avtal och köra bakgrundsjobb", all(["admin"])),
        row("alerts", "Kvittera flaggor", all(["avtalsansvarig", "samordnare", "coach", "chef"])),
        row("deviations", "Registrera avtalsavvikelser och åtgärdsplaner", all(["avtalsansvarig", "samordnare", "chef"])),
        row("invoicing", "Fakturakörning och Fortnox", all(["ekonom"])),
        row("logcheck", "Signera den månatliga loggkontrollen", all(["chef"])),
      ],
    },
    {
      title: "Notiser",
      rows: [
        row("notify-assignment", "Notis vid tilldelning: huvudcoach och team", { coach: "mottagare" }),
        // Karims beslut 2026-11-09: bara i appen – aldrig e-post eller SMS.
        row("notify-new-order", "Notis om ny beställning att ta emot: avtalets intagsansvarige", { coach: "mottagare" }),
        row("notify-received", "Notis när en deltagare är mottagen: samordnare", { samordnare: "mottagare" }),
        row("notify-progress", "Påminnelser om utebliven progression: coach", { coach: "mottagare", chef: "ser" }),
        row(
          "notify-escalation",
          `Eskaleringar: ${escalateTo.map(escWord).join(", ")} – syns inte för coachen`,
          Object.fromEntries(MATRIX_ROLES.map((r) => [r, esc.includes(r) ? "mottagare" : r === "coach" ? "dold" : "nej"])),
        ),
      ],
    },
  ];
}

/** Rollbeskrivningarna (SPEC §4): roll, organisation, ser, gör, inloggning. */
export type RoleDescription = { key: MatrixRole | "deltagare"; role: string; org: string; sees: string; does: string; login: string };
export const ROLE_DESCRIPTIONS: readonly RoleDescription[] = [
  {
    key: "admin", role: "Systemadmin", org: "Miljonbemanning", sees: "Användare, avtal, integrationer, mallar och revisionsloggen. Ärenden och anteckningar i läsläge – inga belopp",
    does: "Användare och roller, avtal och konfiguration, integrationer och bakgrundsjobb", login: "E-post och engångskod",
  },
  {
    key: "avtalsansvarig", role: "Avtalsansvarig och kundansvarig", org: "Miljonbemanning", sees: "Alla ärenden i sina avtal – inga belopp",
    does: "Accepterar och avböjer avrop, kvitterar flaggor, hanterar avtalsavvikelser, godkänner beställarrapporten, bjuder in kommunanvändare", login: "E-post och engångskod",
  },
  {
    key: "samordnare", role: "Operativ samordnare", org: "Miljonbemanning", sees: "Alla ärenden i avtalet – inga belopp",
    does: "Avropsinkorg, tar emot och avböjer avrop, tilldelar coach, bokar start, kvitterar flaggor, registrerar avtalsavvikelser", login: "E-post och engångskod",
  },
  {
    key: "coach", role: "Huvudcoach", org: "Miljonbemanning", sees: "Alla ärenden i avtalet – tilldelningen styr notiser och Mina ärenden. Inga belopp",
    does: "Kartläggning, möten, närvaro, bedömningar, utfall, rapporter, kvitterar flaggor. Avtalets intagsansvarige tar emot nya beställningar", login: "E-post och engångskod",
  },
  {
    key: "chef", role: "Chef och controller", org: "Miljonbemanning", sees: "Alla ärenden i läsläge, nyckeltal, flaggor och revisionsloggen – inga belopp",
    does: "Kvitterar flaggor, registrerar avtalsavvikelser och åtgärdsplaner, signerar den månatliga loggkontrollen", login: "E-post och engångskod",
  },
  {
    key: "ekonom", role: "Ekonom", org: "Miljonbemanning",
    sees: "Ärendenummer, perioder, avtalsområde, referenser, fakturaunderlag och belopp – inga namn, anteckningar eller rapporter. Den enda rollen som ser belopp",
    does: "Fakturakörning, Fortnox, export och prislista", login: "E-post och engångskod",
  },
  {
    key: "kommun_handlaggare", role: "Kommunens handläggare", org: "Botkyrka kommun", sees: "Egna beställda ärenden",
    does: "Beställer, läser rapporter, skickar meddelanden, kvitterar. Skapar sitt konto själv med en adress på kommunens domän", login: "E-post och engångskod",
  },
  { key: "deltagare", role: "Deltagare", org: "Utan inloggning i piloten", sees: "Egen plan och bokningar (utvecklingsfas 4)", does: "Svarar på pulsmätningen via engångslänk", login: "Ingen – BankID senare" },
];
