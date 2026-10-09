// Hanterare: avtal och konfiguration (/admin/avtal) – avtalsfakta, konfigurationen, prislistan och Miljonbemannings
// interna regler (org_settings). Källa: prototyp/src/views/admin.js (admin.avtal, admin.setOrgRule).
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { hidesMoney } from "@/api/tester-access";
import { stuck } from "@/core/cases";
import { ESCALATION_ROLES, isOperational, parseOrgSettings, requireOperational, type EscalationRole, type OrgSettings } from "@/core/config";
import { areaName } from "@/core/labels";
import { noProgressStreak } from "@/core/progression";
import { dayOf } from "@/core/time";
import { by } from "@/core/util";
import type { Contract } from "@/data/schema";
import { ruleDiffText, type RuleSnapshot } from "./audit-text";
import { adminContract, adminOrgRules, adminSetContractManager, adminSetOrgRule, type ContractFacts, type ContractSummary, type PriceRow, type RecipientOption } from "./api";
import { isDemoCreated, mainContract, orgRow, userNames } from "./shared";

const summaryOf = (c: Contract, customerName: string): ContractSummary => ({
  id: c.id, customerName, name: c.name, contractNumber: c.contractNumber, status: c.status, startsOn: c.startsOn, operational: isOperational(c.config),
});

/** Kollegorna som kan vara avtalsansvariga: aktiva i leverantörsorganisationen med rollen avtalsansvarig i avtalet. */
async function managerOptions(ctx: Ctx, c: Contract): Promise<{ id: string; name: string }[]> {
  const [ms, staff] = await Promise.all([ctx.repo.table("memberships").list({ contractId: c.id, role: "avtalsansvarig" }), ctx.repo.table("profiles").list({ organizationId: c.supplierId })]);
  const ids = new Set(ms.map((m) => m.userId));
  return staff.filter((p) => p.active && ids.has(p.id)).sort(by((p) => p.fullName)).map((p) => ({ id: p.id, name: p.fullName }));
}

async function factsOf(ctx: Ctx, c: Contract): Promise<ContractFacts> {
  const [customer, supplier] = await Promise.all([ctx.repo.table("organizations").get(c.customerId), ctx.repo.table("organizations").get(c.supplierId)]);
  const name = await userNames(ctx);
  // Avtalstexterna (uppsägning, omfattning) läses från avtalskonfigurationen – CLAUDE.md punkt 4.
  const texts = c.config.texts;
  return {
    ...summaryOf(c, customer?.name ?? ""),
    customerOrgNr: customer?.orgNr ?? "",
    supplierName: supplier?.name ?? "",
    supplierOrgNr: supplier?.orgNr ?? "",
    dnr: c.dnr,
    endsOn: c.endsOn,
    dataRole: c.dataRole,
    casePrefix: c.casePrefix,
    emailDomains: customer?.emailDomains ?? [],
    managerName: name(c.contractManagerId),
    managerId: c.contractManagerId ?? null,
    managerOptions: await managerOptions(ctx, c),
    termination: texts?.termination ?? null,
    scope: texts?.scope ?? null,
  };
}

async function contractList(ctx: Ctx): Promise<Contract[]> {
  const rows = await ctx.repo.table("contracts").list();
  return ctx.actor.role === "admin" ? rows : rows.filter((c) => ctx.actor.contractIds.includes(c.id));
}

async function priceRows(ctx: Ctx, c: Contract): Promise<PriceRow[]> {
  const [items, areas] = await Promise.all([ctx.repo.table("price_items").list({ contractId: c.id }), ctx.repo.table("contract_areas").list({ contractId: c.id })]);
  return items
    .slice()
    .sort(by((p) => p.areaCode ?? ""))
    .map((p) => ({ id: p.id, areaName: areaName(areas, p.areaCode), fortnoxArticleNo: p.fortnoxArticleNo, unit: p.unit, priceOre: p.priceOre, vatRate: p.vatRate, validFrom: p.validFrom, validTo: p.validTo }));
}

// ---------------------------------------------------------------- admin.contract
handleQuery(adminContract, { roles: ["admin"], commercial: true }, async (ctx, p) => {
  const all = await contractList(ctx);
  const main = await mainContract(ctx);
  const c = (p.contractId && all.find((x) => x.id === p.contractId)) || main;
  const orgs = await ctx.repo.table("organizations").list();
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "";
  let stuckCount: number | null = null;
  let bonusCandidates = 0;
  if (isOperational(c.config)) {
    // ctx.system: antal ärenden som flaggas och antal möjliga bonusunderlag i avtalet – bara summor lämnas ut.
    // Ärenden med skyddade personuppgifter (som admin bara ser som ärendenummer) ska räknas med, som i prototypen.
    const cases = await ctx.system.table("cases").list({ contractId: c.id });
    const ids = cases.map((x) => x.id);
    const db = await loadDb(ctx.system, ["check_ins", "placements", "outcome_events"], {
      check_ins: { caseId: { in: ids } }, placements: { caseId: { in: ids } }, outcome_events: { caseId: { in: ids } },
    });
    const env = { now: ctx.now(), cfg: requireOperational(c.config) };
    stuckCount = cases.filter((k) => k.status === "active" && stuck(k, db, env)).length;
    bonusCandidates = db.outcome_events.filter((e) => e.possibleBonus).length;
  }
  // Belopp syns bara för rollen ekonom (beslut 5, 2026-10-07): prislistan och vitenas belopp lämnas inte ut här.
  // Prislistan finns i stället under Ekonomi (/ekonomi/prislista). Att avtalet har viten visas, utan belopp.
  const hideMoney = hidesMoney(ctx.actor);
  const { penalties, ...withoutPenalties } = c.config;
  return {
    contracts: all.map((x) => summaryOf(x, orgName(x.customerId))),
    contract: await factsOf(ctx, c),
    config: hideMoney ? withoutPenalties : c.config,
    penaltiesHidden: hideMoney && !!penalties,
    yearShort: dayOf(ctx.now()).slice(2, 4),
    stuckCount,
    bonusCandidates,
    ...(hideMoney ? {} : { priceItems: await priceRows(ctx, c) }),
  };
});

// ---------------------------------------------------------------- Avtalsansvarig (beslut 2026-10-08, valfritt steg 3)
// Administratören väljer avtalsansvarig bland kollegorna med rollen avtalsansvarig i avtalet. Rollen ges under Användare och
// roller; här pekas bara avtalet om. Loggen har bara id:n.
handleCommand(adminSetContractManager, { roles: ["admin"], commercial: true }, async (ctx, p) => {
  const c = await ctx.repo.table("contracts").get(p.contractId);
  if (!c) return fail("not_found", "Avtalet finns inte.");
  const options = await managerOptions(ctx, c);
  if (!options.some((o) => o.id === p.userId)) return fail("not_manager", "Kollegan måste ha rollen avtalsansvarig i avtalet. Ge rollen under Användare och roller först.");
  if (c.contractManagerId === p.userId) return fail("unchanged", "Kollegan är redan avtalsansvarig.");
  await ctx.repo.table("contracts").update(c.id, { contractManagerId: p.userId });
  await ctx.audit({ action: "contract.manager_changed", entity: "contract", entityId: c.id, contractId: c.id, details: { from: c.contractManagerId ?? null, to: p.userId } });
  return ok({});
});

// ---------------------------------------------------------------- Interna regler (org_settings)
const RECIPIENTS: [EscalationRole, string][] = [["chef", "Chef och controller"], ["avtalsansvarig", "Avtalsansvarig"], ["samordnare", "Samordnare"]];
const CHANNELS = ["app", "email"] as const;

export const ruleSnapshot = (n: OrgSettings["notifications"]): RuleSnapshot => ({
  remind: n.progressionWatch.remindCoachAfterWeeks,
  esc: n.progressionWatch.escalateAfterConsecutiveWeeks,
  to: [...n.progressionWatch.escalateTo],
  channels: [...n.progressionWatch.channels],
  assign: [...n.onAssignment.channels],
});

handleQuery(adminOrgRules, { roles: ["admin"], commercial: true }, async (ctx) => {
  const main = await mainContract(ctx);
  const { settings } = await orgRow(ctx, main.supplierId);
  const n = settings.notifications;
  // Vem som har rollen (namnen visas bredvid mottagarna).
  const [memberships, profiles] = await Promise.all([ctx.repo.table("memberships").list(), ctx.repo.table("profiles").list({ organizationId: main.supplierId })]);
  const recipients: RecipientOption[] = RECIPIENTS.map(([role, label]) => {
    const ids = new Set(memberships.filter((m) => m.role === role).map((m) => m.userId));
    return { role, label, names: profiles.filter((p) => ids.has(p.id) && p.active).map((p) => p.fullName).join(", ") };
  });
  // ctx.system: veckor i rad utan progression per pågående ärende, för att visa hur många påminnelser och eskaleringar
  // reglerna ger. Bara antal lämnas ut – inga ärenden, inga anteckningar. Skyddade ärenden räknas med som i prototypen.
  const cases = (await ctx.system.table("cases").list({ status: "active" }));
  const db = await loadDb(ctx.system, ["check_ins"], { check_ins: { caseId: { in: cases.map((c) => c.id) } } });
  const streaks = cases.map((c) => noProgressStreak(c, db, { now: ctx.now() }).streak);
  const name = await userNames(ctx);
  const log = await ctx.repo.table("audit_log").list({ action: "org_rule.updated" });
  const history = log
    .slice()
    .reverse()
    .map((a) => {
      const d = a.details as { from?: RuleSnapshot; to?: RuleSnapshot };
      return { id: a.id, at: a.occurredAt, actorName: name(a.actorId), byTester: isDemoCreated(a.id), text: d.from && d.to ? ruleDiffText(d.from, d.to) : "Reglerna ändrades" };
    });
  return { saved: ruleSnapshot(n), reminderSchedule: n.progressionWatch.reminderSchedule, recipients, streaks, history, notifications: n };
});

handleCommand(adminSetOrgRule, { roles: ["admin"], commercial: true }, async (ctx, p) => {
  const main = await mainContract(ctx);
  const { row, settings } = await orgRow(ctx, main.supplierId);
  const n = settings.notifications;
  const pw = n.progressionWatch;
  const remind = p.remindCoachAfterWeeks;
  const esc = p.escalateAfterConsecutiveWeeks;
  if (!Number.isInteger(remind) || remind < 1 || !Number.isInteger(esc) || esc <= remind) return fail("weeks", "Eskaleringen måste komma efter påminnelsen.");
  const to = ESCALATION_ROLES.filter((r) => p.escalateTo.includes(r));
  if (!to.length) return fail("recipients", "Välj minst en mottagare.");
  const channels = CHANNELS.filter((c) => p.channels.includes(c));
  const assign = CHANNELS.filter((c) => p.assignmentChannels.includes(c));
  if (!channels.length || !assign.length) return fail("channels", "Välj minst en kanal.");
  const before = ruleSnapshot(n);
  // Eskaleringen syns aldrig för coachen – låst, styrs av behörigheten och inte av en inställning.
  const next: OrgSettings = parseOrgSettings({
    ...settings,
    notifications: {
      ...n,
      onAssignment: { ...n.onAssignment, channels: assign },
      progressionWatch: { ...pw, remindCoachAfterWeeks: remind, escalateAfterConsecutiveWeeks: esc, escalateTo: to, channels, escalationVisibleToCoach: false },
    },
  });
  if (row) await ctx.repo.table("org_settings").update(row.id, { settings: next, updatedAt: ctx.now(), updatedBy: ctx.actor.userId });
  else await ctx.repo.table("org_settings").insert({ id: main.supplierId, organizationId: main.supplierId, settings: next, updatedAt: ctx.now(), updatedBy: ctx.actor.userId });
  await ctx.audit({ action: "org_rule.updated", entity: "org_config", entityId: "notifications", contractId: null, details: { from: before, to: ruleSnapshot(next.notifications) } });
  return ok({});
});
