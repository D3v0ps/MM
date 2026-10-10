// Prototypens roller och perspektiv – port av den gamla prototypens MM.ROLES och MM.PERSPECTIVES (prototyp/src/02-store.js).
// Bara prototypen: rollväljaren i prototypfältet, rollkorten på startsidan och scenarierna. Riktiga appen har inloggning.
// Etiketterna är prototypens (t.ex. "Samordnare", "Systemadmin"); appens rolletiketter finns i src/api/roles.ts.
import { perspectiveOf, type Perspective, type Role } from "@/api/roles";
import type { IconName } from "@/ui/icons";

/** Visas i feedbacken (fältet prototypeVersion). v1 var den gamla Preact-prototypen. */
export const DEMO_VERSION = "v2 · 2026-09-30";

export type DemoRoleDef = {
  key: Role;
  label: string;
  org: "mb" | "customer" | "participant";
  /** Testpersonen som rollen visas som (profiles.id). Deltagaren har ingen användare. */
  personaId: string | null;
  desc: string;
  icon: IconName;
};

export const DEMO_ROLES: readonly DemoRoleDef[] = [
  { key: "samordnare", label: "Samordnare", org: "mb", personaId: "u-sara", desc: "Avropsinkorg med SLA-klocka, tilldelar coach, bokar start.", icon: "inbox" },
  { key: "avtalsansvarig", label: "Avtalsansvarig", org: "mb", personaId: "u-johan", desc: "Accepterar och avböjer avrop, avtalsavvikelser, godkänner beställarrapport.", icon: "briefcase" },
  { key: "coach", label: "Huvudcoach", org: "mb", personaId: "u-amira", desc: "Min vecka: närvaro, möten, månadsbedömningar och rapporter.", icon: "calendar" },
  { key: "chef", label: "Chef och controller", org: "mb", personaId: "u-karin", desc: "KPI:er mot mål, flaggor, prognos, avvikelser och revisionslogg.", icon: "chart" },
  { key: "ekonom", label: "Ekonom", org: "mb", personaId: "u-lars", desc: "Fakturaunderlag per ärende och månad – inga anteckningar eller rapporter.", icon: "card" },
  { key: "admin", label: "Systemadmin", org: "mb", personaId: "u-robin", desc: "Avtalskonfiguration, användare, underbiträden och logg.", icon: "settings" },
  { key: "kommun_handlaggare", label: "Kommunens handläggare", org: "customer", personaId: "k-maria", desc: "Beställer, läser rapporter och skickar meddelanden.", icon: "building" },
  { key: "deltagare", label: "Deltagare (pulslänk)", org: "participant", personaId: null, desc: "Svarar på pulsmätningen via engångslänk – ingen inloggning.", icon: "smile" },
];

export const demoRole = (key: Role): DemoRoleDef => DEMO_ROLES.find((r) => r.key === key) ?? DEMO_ROLES[0];

export type PerspectiveDef = { key: Perspective; label: string; long: string; roles: Role[]; defaultRole: Role; icon: IconName };

/** Perspektiv: leverantören (Miljonbemanning) eller kunden (Botkyrka kommun). Deltagaren visas separat. */
export const PERSPECTIVES: readonly PerspectiveDef[] = [
  {
    key: "leverantor",
    label: "Leverantör",
    long: "Leverantörens perspektiv – Miljonbemanning",
    // Rollen handledare är borttagen (Karims beslut 2026-10-09, vilande i databasen).
    roles: ["samordnare", "avtalsansvarig", "coach", "chef", "ekonom", "admin"],
    defaultRole: "samordnare",
    icon: "briefcase",
  },
  { key: "kund", label: "Kund", long: "Kundens perspektiv – Botkyrka kommun", roles: ["kommun_handlaggare"], defaultRole: "kommun_handlaggare", icon: "building" },
  { key: "deltagare", label: "Deltagare", long: "Deltagarens perspektiv", roles: ["deltagare"], defaultRole: "deltagare", icon: "smile" },
];

export const perspectiveDef = (role: Role): PerspectiveDef => PERSPECTIVES.find((p) => p.key === perspectiveOf(role)) ?? PERSPECTIVES[0];

/** "leverantörens perspektiv" – i kvittensen när man byter perspektiv. */
export const PERSPECTIVE_PHRASE: Record<Perspective, string> = {
  leverantor: "leverantörens perspektiv",
  kund: "kundens perspektiv",
  deltagare: "deltagarens perspektiv",
};
