// Hjälpare för områdets hanterare (admin, puls, praktik). Bara för hanterare – importeras aldrig av skärmar.
import { ApiError, type Ctx } from "@/api/server";
import { DEFAULT_ORG_SETTINGS, isOperational, requireOperational, type OperationalConfig, type OrgSettings } from "@/core/config";
import type { Contract, OrgSettingsRow } from "@/data/schema";

/**
 * Rader som skapats i prototypen känns igen på id:t från ctx.newId i minnesläget ("log-n00012").
 * I riktiga appen är id:n UUID:er – då är svaret alltid nej (märkningen "Gjort av dig i prototypen" visas bara i prototypen).
 */
export const isDemoCreated = (id: string | null | undefined): boolean => !!id && /-n\d{5}$/.test(id);

/** Den som svarat via pulslänken har ingen användare (prototypens actorId null). */
export const isParticipantActor = (id: string | null | undefined): boolean => id == null || id === "" || id === "deltagare";

/**
 * Avtalet som adminvyerna utgår från: det avtal användaren är medlem i där ärenden hanteras (Botkyrka),
 * annars det första. Prototypens MM.contract() utan argument.
 */
export async function mainContract(ctx: Ctx): Promise<Contract> {
  const rows = await ctx.repo.table("contracts").list();
  const mine = ctx.actor.role === "admin" ? rows : rows.filter((c) => ctx.actor.contractIds.includes(c.id));
  const c = mine.find((x) => x.status === "active" && isOperational(x.config)) ?? mine[0];
  if (!c) throw new ApiError(404, "no_contract", "Det finns inget avtal att visa.");
  return c;
}

/** Driftkonfigurationen för avtalet (kastar om avtalet är ett utkast utan alla avsnitt). */
export const operationalCfg = (c: Contract): OperationalConfig => requireOperational(c.config);

/**
 * Miljonbemannings interna regler (org_settings) för leverantören.
 * ctx.system: reglerna styr systemsteg (påminnelser, eskaleringar, notiser) och ska läsas lika för alla roller.
 */
export async function orgRow(ctx: Ctx, supplierId: string): Promise<{ row: OrgSettingsRow | null; settings: OrgSettings }> {
  const row = await ctx.system.table("org_settings").first({ organizationId: supplierId });
  return { row, settings: row?.settings ?? DEFAULT_ORG_SETTINGS };
}

/**
 * Namn på användare (MB-personal och kommunanvändare) som prototypens MM.personName.
 * ctx.system: bara namnet på användare som förekommer i loggar och historik – aldrig uppgifter om deltagare.
 */
export async function userNames(ctx: Ctx): Promise<(id: string | null | undefined) => string> {
  const profiles = await ctx.system.table("profiles").list();
  const m = new Map(profiles.map((p) => [p.id, p.fullName]));
  return (id) => {
    if (!id) return "–";
    if (id === "system") return "Miljonmatch (automatiskt)";
    return m.get(id) ?? "–";
  };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export { cap };
