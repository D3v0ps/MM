// Det domänfunktionerna behöver utöver datat: avtalets konfiguration, Miljonbemannings interna regler och klockan.
// Funktionerna i src/core tar aldrig tiden från systemklockan – hanterarna skickar in ctx.now().
import type { Contract } from "@/data/schema";
import { requireOperational, type KpiWindow, type OperationalConfig, type OrgSettings } from "./config";
import { addMonths, dayOf, monthKey, type LocalDate, type LocalDateTime } from "./time";

export type DomainEnv = {
  /** Avtalets driftkonfiguration (contracts.config, validerad). */
  cfg: OperationalConfig;
  contractId: string;
  /** Avtalets startdatum (contracts.startsOn) – början på fönstret "sedan start". */
  contractStart: LocalDate;
  /** Miljonbemannings interna regler (org_settings). */
  org: OrgSettings;
  /** Stockholms lokala tid, t.ex. ctx.now(). */
  now: LocalDateTime;
};

/** Bygg miljön för ett avtal. Kastar om avtalet saknar driftavsnitt (t.ex. ett avtal i utkast). */
export function domainEnv(contract: Pick<Contract, "id" | "startsOn" | "config">, org: OrgSettings, now: LocalDateTime): DomainEnv {
  return { cfg: requireOperational(contract.config), contractId: contract.id, contractStart: contract.startsOn, org, now };
}

/** Dagens datum enligt miljöns klocka. */
export const todayOf = (env: Pick<DomainEnv, "now">): LocalDate => dayOf(env.now);

/**
 * Första dagen i ett KPI-fönster: rullande 6 eller 3 månader räknas från första dagen i månaden
 * sex (tre) månader före innevarande månad. Övriga fönster (sedan start, månad) börjar vid avtalets start.
 */
export function windowStart(win: KpiWindow, env: Pick<DomainEnv, "now" | "contractStart">): LocalDate {
  const mk = monthKey(env.now);
  if (win === "rolling_6m") return `${addMonths(mk, -6)}-01`;
  if (win === "rolling_3m") return `${addMonths(mk, -3)}-01`;
  return env.contractStart;
}
