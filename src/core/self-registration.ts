// Självregistrering i kommunens portal (beslut 2026-10-07, synpunkt #2) – rena funktioner utan I/O.
// Alla med en e-postadress på avtalets kommundomän kan själva skapa ett konto och blir kommunens handläggare. Domänen läses
// ur avtalets konfiguration (contracts.config.selfRegistration.emailDomains) – den hårdkodas aldrig (CLAUDE.md punkt 4).
// Dubbel nyckel: domänen måste också finnas bland beställarens tillåtna domäner (organizations.email_domains), och
// organisationen måste vara en beställare. En felskriven konfiguration kan därför aldrig öppna Miljonbemannings domän.
// Kontrollerna görs här i koden – inte bara i zod-schemats crossCheck – eftersom appen inte validerar contracts.config när
// avtalet läses (granskningen 2026-10-07):
//   * synligheten måste vara "own": en självregistrerad handläggare skriver sin enhet själv, så med "unit" eller "all" skulle
//     vem som helst på kommundomänen kunna se andras deltagare. Konfigurationen måste också klara ContractConfigSchema.
//   * adresser med plustecken (kim+1@…) godtas inte: de går ofta till samma brevlåda, och ett spärrat konto skulle annars
//     kunna kringgås med ett nytt konto.
import type { Contract, Organization } from "@/data/schema";
import { ContractConfigSchema, effectiveVisibilityScope, isOperational } from "./config";

/** Domänen i en e-postadress, med små bokstäver ("Maria@Botkyrka.se" -> "botkyrka.se"). Tom sträng om adressen saknar @. */
export function emailDomainOf(email: string | null | undefined): string {
  const s = String(email ?? "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  return at > 0 && at < s.length - 1 ? s.slice(at + 1) : "";
}

/** Delen före @ (gemener), tom sträng om adressen saknar @. */
export function emailLocalPartOf(email: string | null | undefined): string {
  const s = String(email ?? "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  return at > 0 ? s.slice(0, at) : "";
}

/**
 * Avtalen där adressen får skapa ett konto som kommunens handläggare: aktiva avtal med driftkonfiguration som klarar
 * ContractConfigSchema och där kommunens handläggare bara ser sina egna beställningar (synlighet "own"), och där adressens
 * domän (exakt – inte en underdomän) finns både i avtalets selfRegistration.emailDomains och bland beställarens tillåtna
 * domäner. Adresser med plustecken godtas inte. Tom lista = ingen självregistrering.
 */
export function selfRegistrationContracts(
  email: string | null | undefined,
  contracts: readonly Pick<Contract, "id" | "customerId" | "status" | "config">[],
  organizations: readonly Pick<Organization, "id" | "kind" | "emailDomains">[],
): string[] {
  const domain = emailDomainOf(email);
  if (!domain || emailLocalPartOf(email).includes("+")) return [];
  const orgs = new Map(organizations.map((o) => [o.id, o]));
  return contracts
    .filter((c) => {
      if (c.status !== "active" || !isOperational(c.config)) return false;
      const own = c.config.selfRegistration?.emailDomains ?? [];
      const org = orgs.get(c.customerId);
      if (!org || org.kind !== "customer") return false;
      if (!own.includes(domain) || !org.emailDomains.map((d) => d.toLowerCase()).includes(domain)) return false;
      // Enheten är fritext som handläggaren skriver själv – bara synligheten "own" är säker (kontrolleras här, inte bara i schemat).
      if (effectiveVisibilityScope(c.config) !== "own") return false;
      return ContractConfigSchema.safeParse(c.config).success;
    })
    .map((c) => c.id);
}

/**
 * Preliminärt namn ur e-postadressen tills handläggaren fyller i sitt namn under Mina uppgifter:
 * "maria.ekdahl@botkyrka.se" -> "Maria Ekdahl", "anna-karin.berg@…" -> "Anna-Karin Berg". Siffror tas bort.
 * Tom sträng om inget namn går att utläsa.
 */
export function nameFromEmail(email: string | null | undefined): string {
  const local = String(email ?? "").trim().split("@")[0] ?? "";
  const words = local
    .replace(/\d+/g, " ")
    .split(/[._\s]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !/^-+$/.test(w));
  const cap = (w: string) => w.split("-").filter(Boolean).map((p) => p.charAt(0).toLocaleUpperCase("sv-SE") + p.slice(1).toLocaleLowerCase("sv-SE")).join("-");
  return words.map(cap).filter(Boolean).join(" ").slice(0, 120);
}

/** Konstanten i profiles.invited_by för ett konto som användaren skapade själv. */
export const SELF_REGISTERED = "self";
