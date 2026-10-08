// Tester för områdets hanterare (admin): samma siffror och texter som den gamla prototypen för testdatat
// 1 feb 2027 kl. 09.12 (prototyp/tools/test-admin.mjs och vyerna i prototyp/src/views/admin.js), behörighet och
// de kontroller som prototypens åtgärder gjorde (admin.setOrgRule, admin.inviteCustomer, admin.saveTemplate …).
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/server";
import { domainEnv } from "@/core/env";
import { notificationsFor, progressionWatch } from "@/core/progression";
import "./handlers";
import {
  adminAuditLog, adminContract, adminIntegrations, adminInviteCustomer, adminInviteStaff, adminLogCheck, adminOrgRules, adminRunJob, adminSaveTemplate,
  adminSetContractManager, adminSetCustomerActive, adminSetOrgRule, adminSetStaffActive, adminSetStaffRoles, adminTemplates, adminUsers,
} from "./api";
import { detailText, type AuditLookups } from "./audit-text";
import { findUnset } from "./contract-text";
import { fillExample, templateCheck } from "./templates";
import { linkMessageText } from "@/features/rost/texts";
import { testRuntime } from "./test-runtime";

let rt: ReturnType<typeof testRuntime>;
beforeEach(() => {
  rt = testRuntime();
});
const robin = () => rt.as("u-robin", "admin");
const johan = () => rt.as("u-johan", "avtalsansvarig");
const karin = () => rt.as("u-karin", "chef");
const sara = () => rt.as("u-sara", "samordnare");
const amira = () => rt.as("u-amira", "coach");
const forbidden = async (p: Promise<unknown>) => {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await expect(p).rejects.toMatchObject({ status: 403 });
};

describe("avtal och konfiguration", () => {
  it("Botkyrka: fakta, ej fastställda värden, fastnat, bonusunderlag och prislista", async () => {
    const d = await rt.query(adminContract, {}, robin());
    // Bara Botkyrkaavtalet i testdatat – då visar skärmen ingen avtalsväljare.
    expect(d.contracts.map((c) => [c.id, c.customerName, c.status])).toEqual([["c-bot", "Botkyrka kommun", "active"]]);
    expect(d.contract).toMatchObject({
      id: "c-bot", customerOrgNr: "212000-2882", supplierName: "Miljonbemanning AB", supplierOrgNr: "556959-9318", dnr: "AVN/2026:00048", endsOn: "2030-09-10",
      casePrefix: "BOT", emailDomains: ["botkyrka.se"], managerName: "Johan Berg",
      termination: "Uppsägning utan skäl tidigast två år efter start. Tre månaders uppsägningstid.",
      scope: "Minst 70 och upp till 100 årsplatser i tolv avtalsområden (A–L). Miljonbemanning är rangordnad 1 i alla områden.",
    });
    expect(d.yearShort).toBe("27");
    // Den gamla prototypen: "11 värden är inte fastställda", "Just nu flaggas 2 ärenden", "31 händelser markerade som möjligt bonusunderlag".
    // Avvikelse: AI-leverantören är fastställd (beslut 2026-09-30, Gemini Flash via Vertex AI EU) – nu 10 värden. Beslut
    // 2026-10-07: gallringen av bilagorna efter avslut är inte fastställd (retentionRules.attachmentsAfterCloseDays) – 11 värden.
    expect(findUnset(d.config).map((u) => u.path)).toEqual([
      "customerVisibility.scope", "result.definition", "result.excludedFromDenominator", "kpis.narvarograd.internalTarget", "kpis.nojdhet.internalTarget",
      "sla.manadsrapport.due", "sla.slutrapport.within", "attendance.sameDayNoticeOnInvalidAbsence", "bonus.model", "retention",
      "retentionRules.attachmentsAfterCloseDays",
    ]);
    expect(d.stuckCount).toBe(2);
    expect(d.bonusCandidates).toBe(31);
    // Belopp syns bara för rollen ekonom (beslut 5, 2026-10-07): ingen prislista och inga vitesbelopp för systemadministratören.
    // Prislistan finns under Ekonomi (ekonomi.priceList, src/features/ekonomi/ekonomi.test.ts).
    expect(d).not.toHaveProperty("priceItems");
    expect(d.config).not.toHaveProperty("penalties");
    expect(d.penaltiesHidden).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/priceOre|deviationOre|insufficientInformationOre/);
  });

  it("ett nytt kommunavtal i utkast (påhittat): avtalsväljaren, inga driftavsnitt, texterna ur konfigurationen", async () => {
    // Fler kommunavtal är en generell förmåga: ett avtal läggs till som en rad med konfiguration, utan kodändring.
    const bot = rt.rows("contracts").find((c) => c.id === "c-bot")!;
    rt.store.insertRow("contracts", {
      ...structuredClone(bot), id: "c-ny", name: "Nytt kommunavtal", contractNumber: "000000000", dnr: null, startsOn: "2027-06-01", endsOn: null, casePrefix: "NYK", status: "draft",
      config: { casePrefix: "NYK", dataRole: "processor", customerVisibility: { seesIndividualReports: true, seesCoachNotes: false }, texts: { termination: "Enligt avtalet.", scope: "Upp till 20 platser." } },
    });
    const d = await rt.query(adminContract, { contractId: "c-ny" }, robin());
    expect(d.contracts.map((c) => [c.id, c.status, c.operational])).toEqual([["c-bot", "active", true], ["c-ny", "draft", false]]);
    expect(d.contract).toMatchObject({ id: "c-ny", status: "draft", startsOn: "2027-06-01", operational: false, dataRole: "processor", casePrefix: "NYK" });
    // Avtalstexterna läses från konfigurationen (CLAUDE.md punkt 4), inte per avtalsnummer i koden.
    expect(d.contract).toMatchObject({ termination: "Enligt avtalet.", scope: "Upp till 20 platser." });
    expect(d.stuckCount).toBeNull();
    expect(findUnset(d.config)).toHaveLength(0);
    expect(d).not.toHaveProperty("priceItems");
    expect(d.penaltiesHidden).toBe(false); // utkastet har inga viten
    // Ett avtal utan texter i konfigurationen visar "–" (null), oavsett avtalsnummer.
    const noTexts = structuredClone(rt.rows("contracts").find((c) => c.id === "c-ny")!.config);
    delete noTexts.texts;
    rt.store.updateRow("contracts", "c-ny", { config: noTexts });
    expect((await rt.query(adminContract, { contractId: "c-ny" }, robin())).contract).toMatchObject({ termination: null, scope: null });
    // Ett okänt avtal ger huvudavtalet (gamla länkar med ?avtal=).
    expect((await rt.query(adminContract, { contractId: "c-finns-inte" }, robin())).contract.id).toBe("c-bot");
  });

  it("bara systemadmin", async () => {
    await forbidden(rt.query(adminContract, {}, johan()));
    await forbidden(rt.query(adminOrgRules, {}, karin()));
  });
});

describe("interna regler (org_settings)", () => {
  it("visar reglerna, mottagarna och hur de slår igenom (17 påminnelser, 3 eskaleringar)", async () => {
    const d = await rt.query(adminOrgRules, {}, robin());
    expect(d.saved).toEqual({ remind: 1, esc: 2, to: ["chef"], channels: ["app", "email"], assign: ["app", "email"] });
    expect(d.recipients.map((r) => [r.role, r.names])).toEqual([["chef", "Karin Wallin"], ["avtalsansvarig", "Johan Berg"], ["samordnare", "Sara Lindqvist"]]);
    expect(d.streaks.filter((s) => s >= 1)).toHaveLength(17);
    expect(d.streaks.filter((s) => s >= 2)).toHaveLength(3);
    expect(d.history).toEqual([]);
    expect(d.reminderSchedule).toBe("måndag 08.00 för föregående vecka");
  });

  it("ogiltiga regler stoppas och klockan står still", async () => {
    const t0 = rt.now();
    expect(await rt.command(adminSetOrgRule, { remindCoachAfterWeeks: 2, escalateAfterConsecutiveWeeks: 2, escalateTo: ["chef"], channels: ["app"], assignmentChannels: ["app"] }, robin())).toMatchObject({ ok: false, error: "weeks" });
    expect(await rt.command(adminSetOrgRule, { remindCoachAfterWeeks: 1, escalateAfterConsecutiveWeeks: 2, escalateTo: [], channels: ["app"], assignmentChannels: ["app"] }, robin())).toMatchObject({ ok: false, error: "recipients" });
    expect(await rt.command(adminSetOrgRule, { remindCoachAfterWeeks: 1, escalateAfterConsecutiveWeeks: 2, escalateTo: ["chef"], channels: [], assignmentChannels: ["app"] }, robin())).toMatchObject({ ok: false, error: "channels" });
    expect(rt.now()).toBe(t0);
    await forbidden(rt.command(adminSetOrgRule, { remindCoachAfterWeeks: 1, escalateAfterConsecutiveWeeks: 2, escalateTo: ["chef"], channels: ["app"], assignmentChannels: ["app"] }, karin()));
  });

  it("strängare regel: färre eskaleringar, avtalsansvarig får dem, coachen aldrig – och ändringen loggas", async () => {
    const all = () => ({ cases: rt.rows("cases"), check_ins: rt.rows("check_ins"), user_notifications: rt.rows("user_notifications"), notification_reads: rt.rows("notification_reads"), profiles: rt.rows("profiles") });
    const envOf = () => domainEnv(rt.rows("contracts")[0], rt.rows("org_settings")[0].settings, rt.now());
    const before = progressionWatch(all(), {}, envOf()).filter((w) => w.level === "escalated").length;
    const r = await rt.command(adminSetOrgRule, { remindCoachAfterWeeks: 2, escalateAfterConsecutiveWeeks: 3, escalateTo: ["chef", "avtalsansvarig"], channels: ["app", "email"], assignmentChannels: ["app", "email"] }, robin());
    expect(r).toEqual({ ok: true });
    const pw = rt.rows("org_settings")[0].settings.notifications.progressionWatch;
    expect([pw.remindCoachAfterWeeks, pw.escalateAfterConsecutiveWeeks, pw.escalateTo, pw.escalationVisibleToCoach]).toEqual([2, 3, ["chef", "avtalsansvarig"], false]);
    const esc = progressionWatch(all(), {}, envOf()).filter((w) => w.level === "escalated").length;
    expect(esc).toBeLessThanOrEqual(before);
    expect(notificationsFor(all(), "u-johan", "avtalsansvarig", envOf()).filter((n) => n.kind === "progress_escalation")).toHaveLength(esc);
    expect(notificationsFor(all(), "u-amira", "coach", envOf()).filter((n) => n.kind === "progress_escalation")).toHaveLength(0);
    const log = rt.rows("audit_log").filter((a) => a.action === "org_rule.updated");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: "u-robin", entity: "org_config", entityId: "notifications", occurredAt: "2027-02-01T09:13" });
    const d = await rt.query(adminOrgRules, {}, robin());
    expect(d.history[0].text).toBe("Påminnelse efter 1 vecka → 2 veckor; eskalering efter 2 veckor → 3 veckor i rad; mottagare chef/controller → chef/controller, avtalsansvarig");
    expect(d.history[0]).toMatchObject({ actorName: "Robin Åberg", byTester: true, at: "2027-02-01T09:13" });
  });
});

describe("användare och roller", () => {
  it("systemadmin ser personalen och kommunens användare (prototypens siffror utan kommunens chef)", async () => {
    const d = await rt.query(adminUsers, {}, robin());
    // Kommunens chef (Eva Bergström, enheten Arbetsmarknadsenheten) är borttagen (beslut 2026-10-07): 4 användare i 3 enheter.
    expect(d.kpis).toEqual({ mbActive: 13, customerActive: 4, unitCount: 3, loggedIn30: 1, invited: 0 });
    expect(d.mb?.map((u) => u.name)).toEqual([
      "Robin Åberg", "Johan Berg", "Sara Lindqvist", "Amira Haddad", "Erik Sjöberg", "Leila Nouri", "Mats Holm", "Sofia Grahn", "David Olsson", "Hanna Strand", "Petra Ek",
      "Karin Wallin", "Lars Nyström",
    ]);
    expect(d.mb?.find((u) => u.id === "u-petra")).toMatchObject({ roleLabel: "Handledare", teamRoleLabel: "Yrkesspecifik handledare" });
    // Bara handläggare – ingen rollkolumn och ingen beställarreferens i listan.
    expect(d.customers.map((u) => [u.name, u.unit, u.selfRegistered])).toEqual([
      ["Ahmed Yusuf", "Arbetsmarknadsenheten Tumba", false],
      ["Linda Karlsson", "Arbetsmarknadsenheten Hallunda–Fittja", false],
      ["Maria Ekdahl", "Arbetsmarknadsenheten Alby", false],
      ["Omar Farah", "Arbetsmarknadsenheten Alby", false],
    ]);
    for (const key of ["role", "buyerReference"]) expect(d.customers[0]).not.toHaveProperty(key);
    expect(d.domains).toEqual(["botkyrka.se"]);
    expect(d.selfRegistrationDomains).toEqual(["botkyrka.se"]);
    expect(d.escalateTo).toEqual(["chef"]);
  });

  it("avtalsansvarig ser bara kommunanvändarna", async () => {
    const d = await rt.query(adminUsers, {}, johan());
    expect(d.isAdmin).toBe(false);
    expect(d.mb).toBeNull();
    expect(d.customers).toHaveLength(4);
    await forbidden(rt.query(adminUsers, {}, sara()));
  });

  it("inbjudan: bara tillåten domän, unik adress och enhet – alltid handläggare, mejlet utan personuppgifter", async () => {
    const base = { name: "Kim Andersson", email: "kim.andersson@gmail.com", unit: "Arbetsmarknadsenheten Tumba" };
    expect(await rt.command(adminInviteCustomer, base, johan())).toMatchObject({ ok: false, error: "domain" });
    expect(await rt.command(adminInviteCustomer, { ...base, name: " " }, johan())).toMatchObject({ ok: false, error: "name" });
    expect(await rt.command(adminInviteCustomer, { ...base, email: "Maria.Ekdahl@botkyrka.se" }, johan())).toMatchObject({ ok: false, error: "exists" });
    expect(await rt.command(adminInviteCustomer, { ...base, email: "kim.andersson@botkyrka.se", unit: "" }, johan())).toMatchObject({ ok: false, error: "unit" });
    const n = rt.rows("profiles").length;
    // En roll i anropet ignoreras (zod tar bort okända fält) – kommunen har bara rollen handläggare.
    const r = await rt.command(adminInviteCustomer, { ...base, email: "Kim.Andersson@botkyrka.se", role: "chef" } as never, johan());
    expect(r.ok).toBe(true);
    const id = r.ok ? r.userId : "";
    expect(rt.rows("profiles")).toHaveLength(n + 1);
    expect(rt.rows("profiles").find((p) => p.id === id)).toMatchObject({
      email: "kim.andersson@botkyrka.se", fullName: "Kim Andersson", organizationId: "org-botkyrka", customerUnit: "Arbetsmarknadsenheten Tumba", buyerReferenceId: "br-tumba",
      title: "Handläggare", active: true, invitedAt: "2027-02-01T09:13", invitedBy: "u-johan",
    });
    expect(rt.rows("memberships").find((m) => m.userId === id)).toMatchObject({ contractId: "c-bot", role: "kommun_handlaggare", customerUnit: "Arbetsmarknadsenheten Tumba" });
    const mail = rt.rows("outbound_messages").find((m) => m.template === "inbjudan_kommun");
    expect(mail).toMatchObject({ to: "kim.andersson@botkyrka.se", caseId: null });
    expect(mail?.body).not.toMatch(/Kim|Andersson/);
    expect(rt.rows("audit_log").find((a) => a.action === "customer_user.invited")).toMatchObject({ entity: "profile", entityId: id, details: { role: "kommun_handlaggare", domain: "botkyrka.se" } });
    // Enheten är fritext (synpunkt #3) och hamnar inte i loggen.
    expect(rt.rows("audit_log").find((a) => a.action === "customer_user.invited")!.details).not.toHaveProperty("unit");
    const d = await rt.query(adminUsers, {}, johan());
    expect(d.customers[0]).toMatchObject({ name: "Kim Andersson", invitedAt: "2027-02-01T09:13", selfRegistered: false });
    expect(d.kpis.invited).toBe(1);
    // Spärra och aktivera igen
    expect(await rt.command(adminSetCustomerActive, { userId: id, active: false }, johan())).toEqual({ ok: true });
    expect(rt.rows("profiles").find((p) => p.id === id)?.active).toBe(false);
    expect(rt.rows("audit_log").some((a) => a.action === "customer_user.blocked" && a.entityId === id)).toBe(true);
    expect(await rt.command(adminSetCustomerActive, { userId: "u-sara", active: false }, robin())).toMatchObject({ ok: false, error: "not_found" });
  });
});

// Beslut 2026-10-08 (skarp drift): administratören lägger till kollegor, ändrar roller (en eller flera) och spärrar i appen.
describe("kollegorna: lägg till, ändra roller, spärra (beslut 2026-10-08)", () => {
  it("personalen listas med alla sina roller i avtalet; bara adressens domän från src/core/staff.ts tillåts", async () => {
    const d = await rt.query(adminUsers, {}, robin());
    expect(d.staffDomains).toEqual(["miljonbemanning.se"]);
    const robinRow = d.mb!.find((u) => u.id === "u-robin")!;
    expect(robinRow).toMatchObject({ roles: ["admin"], roleLabel: "Systemadmin", isAdmin: true, self: true, active: true });
    expect(d.mb!.find((u) => u.id === "u-johan")).toMatchObject({ roles: ["avtalsansvarig"], self: false });
  });

  it("lägg till kollega: namn, adress på personalens domän, unik adress, minst en roll – mejlet utan personuppgifter, loggen med roller och domän", async () => {
    const base = { name: "Nour Testsson", email: "nour.testsson@miljonbemanning.se", roles: ["coach" as const, "handledare" as const], title: "Jobbcoach" };
    expect(await rt.command(adminInviteStaff, { ...base, name: "  " }, robin())).toMatchObject({ ok: false, error: "name" });
    expect(await rt.command(adminInviteStaff, { ...base, email: "nour" }, robin())).toMatchObject({ ok: false, error: "email" });
    expect(await rt.command(adminInviteStaff, { ...base, email: "nour.testsson@gmail.com" }, robin())).toMatchObject({ ok: false, error: "domain" });
    expect(await rt.command(adminInviteStaff, { ...base, email: "Sara.Lindqvist@miljonbemanning.se" }, robin())).toMatchObject({ ok: false, error: "exists" });
    // zod stoppar en tom rollista (min 1) och okända roller.
    await expect(rt.command(adminInviteStaff, { ...base, roles: [] }, robin())).rejects.toMatchObject({ status: 400 });
    await expect(rt.command(adminInviteStaff, { ...base, roles: ["kommun_handlaggare"] } as never, robin())).rejects.toMatchObject({ status: 400 });
    // Bara systemadministratören.
    await forbidden(rt.command(adminInviteStaff, base, johan()));
    const n = rt.rows("profiles").length;
    const r = await rt.command(adminInviteStaff, { ...base, email: "Nour.Testsson@miljonbemanning.se " }, robin());
    expect(r.ok).toBe(true);
    const id = r.ok ? r.userId : "";
    expect(rt.rows("profiles")).toHaveLength(n + 1);
    expect(rt.rows("profiles").find((p) => p.id === id)).toMatchObject({
      email: "nour.testsson@miljonbemanning.se", fullName: "Nour Testsson", organizationId: "org-mb", title: "Jobbcoach", active: true, customerUnit: null,
      invitedAt: "2027-02-01T09:13", invitedBy: "u-robin",
    });
    expect(rt.rows("memberships").filter((m) => m.userId === id).map((m) => [m.id, m.role, m.contractId])).toEqual([
      [`${id}:c-bot:coach`, "coach", "c-bot"], [`${id}:c-bot:handledare`, "handledare", "c-bot"],
    ]);
    const mail = rt.rows("outbound_messages").find((m) => m.template === "inbjudan_personal");
    expect(mail).toMatchObject({ to: "nour.testsson@miljonbemanning.se", caseId: null });
    expect(mail?.body).not.toMatch(/Nour|Testsson|Jobbcoach/);
    expect(rt.rows("audit_log").find((a) => a.action === "staff_user.added")).toMatchObject({ entity: "profile", entityId: id, contractId: "c-bot", details: { roles: ["coach", "handledare"], domain: "miljonbemanning.se" } });
    expect(JSON.stringify(rt.rows("audit_log").find((a) => a.action === "staff_user.added")!.details)).not.toMatch(/Nour|nour\./);
    const d = await rt.query(adminUsers, {}, robin());
    expect(d.mb!.find((u) => u.id === id)).toMatchObject({ roles: ["coach", "handledare"], roleLabel: "Huvudcoach, Handledare", isAdmin: false, title: "Jobbcoach" });
    // Titeln är valfri.
    const r2 = await rt.command(adminInviteStaff, { name: "Ali Testsson", email: "ali.testsson@miljonbemanning.se", roles: ["ekonom"] }, robin());
    expect(r2.ok).toBe(true);
    expect(rt.rows("profiles").find((p) => p.id === (r2.ok ? r2.userId : ""))?.title).toBe("");
  });

  it("ändra roller: medlemskapen görs lika med listan, loggen får från och till, den egna adminrollen kan inte tas bort", async () => {
    // Johan: avtalsansvarig -> avtalsansvarig + samordnare -> samordnare
    expect(await rt.command(adminSetStaffRoles, { userId: "u-johan", roles: ["samordnare", "avtalsansvarig"] }, robin())).toEqual({ ok: true, changed: true });
    expect(rt.rows("memberships").filter((m) => m.userId === "u-johan").map((m) => m.role).sort()).toEqual(["avtalsansvarig", "samordnare"]);
    // Oförändrat = ingen loggrad.
    expect(await rt.command(adminSetStaffRoles, { userId: "u-johan", roles: ["avtalsansvarig", "samordnare"] }, robin())).toEqual({ ok: true, changed: false });
    expect(rt.rows("audit_log").filter((a) => a.action === "staff_user.roles_changed")).toHaveLength(1);
    expect(rt.rows("audit_log").find((a) => a.action === "staff_user.roles_changed")).toMatchObject({ entityId: "u-johan", details: { from: ["avtalsansvarig"], to: ["avtalsansvarig", "samordnare"] } });
    expect(await rt.command(adminSetStaffRoles, { userId: "u-johan", roles: ["samordnare"] }, robin())).toEqual({ ok: true, changed: true });
    expect(rt.rows("memberships").filter((m) => m.userId === "u-johan").map((m) => m.role)).toEqual(["samordnare"]);
    // Den inloggade kan inte ta bort sin egen adminroll – men lägga till en.
    expect(await rt.command(adminSetStaffRoles, { userId: "u-robin", roles: ["chef"] }, robin())).toMatchObject({ ok: false, error: "self" });
    expect(await rt.command(adminSetStaffRoles, { userId: "u-robin", roles: ["chef", "admin"] }, robin())).toEqual({ ok: true, changed: true });
    // Kommunens användare och okända id:n nås inte här.
    expect(await rt.command(adminSetStaffRoles, { userId: "k-maria", roles: ["coach"] }, robin())).toMatchObject({ ok: false, error: "not_found" });
    await forbidden(rt.command(adminSetStaffRoles, { userId: "u-amira", roles: ["coach"] }, karin()));
  });

  it("spärra och aktivera kollega: aldrig sig själv, loggas", async () => {
    expect(await rt.command(adminSetStaffActive, { userId: "u-amira", active: false }, robin())).toEqual({ ok: true });
    expect(rt.rows("profiles").find((p) => p.id === "u-amira")?.active).toBe(false);
    expect(rt.rows("audit_log").some((a) => a.action === "staff_user.blocked" && a.entityId === "u-amira")).toBe(true);
    const d = await rt.query(adminUsers, {}, robin());
    expect(d.mb!.find((u) => u.id === "u-amira")?.active).toBe(false);
    expect(await rt.command(adminSetStaffActive, { userId: "u-amira", active: true }, robin())).toEqual({ ok: true });
    expect(rt.rows("audit_log").some((a) => a.action === "staff_user.reactivated" && a.entityId === "u-amira")).toBe(true);
    expect(await rt.command(adminSetStaffActive, { userId: "u-robin", active: false }, robin())).toMatchObject({ ok: false, error: "self" });
    expect(await rt.command(adminSetStaffActive, { userId: "k-maria", active: false }, robin())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("avtalsansvarig väljs bland kollegorna med rollen avtalsansvarig i avtalet (beslut 3)", async () => {
    const before = await rt.query(adminContract, {}, robin());
    expect(before.contract).toMatchObject({ managerId: "u-johan", managerOptions: [{ id: "u-johan", name: "Johan Berg" }] });
    expect(await rt.command(adminSetContractManager, { contractId: "c-bot", userId: "u-sara" }, robin())).toMatchObject({ ok: false, error: "not_manager" });
    expect(await rt.command(adminSetContractManager, { contractId: "c-bot", userId: "u-johan" }, robin())).toMatchObject({ ok: false, error: "unchanged" });
    expect(await rt.command(adminSetStaffRoles, { userId: "u-sara", roles: ["samordnare", "avtalsansvarig"] }, robin())).toEqual({ ok: true, changed: true });
    expect(await rt.command(adminSetContractManager, { contractId: "c-bot", userId: "u-sara" }, robin())).toEqual({ ok: true });
    expect(rt.rows("contracts").find((c) => c.id === "c-bot")?.contractManagerId).toBe("u-sara");
    expect(rt.rows("audit_log").find((a) => a.action === "contract.manager_changed")).toMatchObject({ entity: "contract", entityId: "c-bot", details: { from: "u-johan", to: "u-sara" } });
    const after = await rt.query(adminContract, {}, robin());
    expect(after.contract.managerName).toBe("Sara Lindqvist");
    expect(after.contract.managerOptions.map((o) => o.id)).toEqual(["u-johan", "u-sara"]);
    await forbidden(rt.command(adminSetContractManager, { contractId: "c-bot", userId: "u-johan" }, johan()));
  });
});

describe("underbiträden, integrationer och bakgrundsjobb", () => {
  it("jobbens resultat är den gamla prototypens", async () => {
    const d = await rt.query(adminIntegrations, {}, robin());
    expect(d).toMatchObject({ latestMail: "2027-02-01T08:41", aiRunCount: 2, dataProtection: { thirdCountryForbidden: true, returnDataWithinDays: 31, approvedOn: "2026-09-29" } });
    expect(d.jobs.map((j) => [j.key, j.last, j.status, j.result])).toEqual([
      ["inbox", "2027-02-01T09:10", "ok", "Senaste mejl kom 1 feb kl. 08.41"],
      ["weekly", "2027-02-01T07:00", "waiting", "2 publicerade, 2 väntar på närvaro (v. 4 2027)"],
      ["att_remind", "2027-02-01T08:00", "ok", "1 coach påmind om förra veckan"],
      ["progress", "2027-02-01T08:00", "ok", "17 påminnelser till coacher, 3 eskaleringar till chef"],
      ["audio", "2027-01-29T14:01", "ok", "1 ljudfil raderade"],
      ["transcripts", "2027-02-01T02:00", "ok", "1 råtranskript väntar på granskning"],
      ["kpi", "2027-02-01T06:00", "ok", "Resultatgrad 33,9 % (rullande 6 månader, 43 av 127)"],
      ["retention", null, "disabled", "Regeln är inte fastställd (fråga 11) – jobbet raderar ingenting"],
    ]);
    expect(d.jobs[1].schedule).toBe("Måndag, när närvaron är komplett – senast 16.00 enligt avtalet");
  });

  it("\"Kör nu\" sparas i jobs och loggas; gallringen kan inte köras", async () => {
    expect(await rt.command(adminRunJob, { key: "inbox" }, robin())).toEqual({ ok: true });
    expect(rt.rows("jobs")).toMatchObject([{ kind: "inbox", status: "done", payload: { manual: true }, createdBy: "u-robin", createdAt: "2027-02-01T09:13" }]);
    expect(rt.rows("audit_log").find((a) => a.action === "job.run_manual")).toMatchObject({ entity: "job", entityId: "inbox" });
    const d = await rt.query(adminIntegrations, {}, robin());
    expect(d.jobs[0]).toMatchObject({ last: "2027-02-01T09:13", manual: true, manualBy: "dig" });
    expect(await rt.command(adminRunJob, { key: "retention" }, robin())).toMatchObject({ ok: false, error: "disabled" });
  });
});

describe("mallar och utskick", () => {
  it("mallkatalogen med texterna som skickas och tidsgränser från avtalet", async () => {
    const d = await rt.query(adminTemplates, {}, robin());
    expect(d.canEdit).toBe(true);
    expect(d.templates).toHaveLength(21);
    const t = (key: string) => d.templates.find((x) => x.key === key)!;
    // Inloggningskoden (beslut 2026-10-02): e-post från appen, fast text, ingen länk – bara {kod} (fylls i av servern).
    expect(t("inloggningskod")).toMatchObject({ name: "Inloggningskod", channel: "email", alsoVia: [], from: "notis@miljonmatch.se", subject: "Din inloggningskod till Miljonmatch", fixed: true, version: 1 });
    expect(t("inloggningskod").to).toMatch(/personal.*kommunens användare/);
    expect(t("inloggningskod").body).not.toMatch(/\{lank\}|https?:/);
    expect(templateCheck(t("inloggningskod").body)).toMatchObject({ ok: true, unknown: ["{kod}"] });
    expect(fillExample(t("inloggningskod").body)).toContain("\n418302\n");
    expect(d.templates.filter((x) => x.fixed).map((x) => x.key)).toEqual(["inloggningskod"]);
    // Deltagarens inspelningslänk: samma text som rost.linkSend skickar, och mallen klarar kontrollen av personuppgifter.
    expect(t("rostlank")).toMatchObject({ name: "Inspelningslänk till deltagaren", channel: "sms", alsoVia: ["email"], subject: "Spela in ett meddelande till din coach" });
    expect(t("rostlank").body.replace("{antal_dagar}", "7").replace("{lank}", "/rost/x")).toBe(`${linkMessageText(7)} /rost/x`);
    expect(templateCheck(t("rostlank").body)).toMatchObject({ ok: true, unknown: [] });
    expect(t("ordererkannande")).toMatchObject({ when: "Automatiskt inom 5 minuter när ett avrop kommit in", version: 3, updatedByName: "Robin Åberg", updatedAt: "2026-12-02T10:14" });
    expect(t("pulslank").when).toBe("Vecka 2, vid avslut och var 30:e dag vid långa insatser");
    expect(t("paminnelse_progression").when).toBe("Enligt interna regler: måndag 08.00 för föregående vecka");
    expect(t("eskalering_chef").when).toBe("När ett ärende saknar progression 2 veckor i rad");
    // Den generiska mottagningsbekräftelsen används inte sedan 2026-10-07 (skyddet borttaget) – mallarna finns kvar för gamla utskick.
    expect(t("generisk_mottagningsbekraftelse").when).toBe("Används inte sedan 2026-10-07");
    expect(t("generisk_mottagningsbekraftelse_portal").when).toBe("Används inte sedan 2026-10-07");
    expect(rt.rows("outbound_messages").some((m) => m.template === "generisk_mottagningsbekraftelse")).toBe(false);
    for (const k of ["kallelse", "pulslank"]) expect(`${t(k).to} ${t(k).when}`, k).not.toMatch(/skyddade personuppgifter/i);
    expect(d.sendLog.map((n) => n.templateLabel)).toEqual([
      "Ordererkännande", "Pulslänk", "Ny rapport", "Mötespåminnelse", "Ordererkännande", "Nytt meddelande", "Ordererkännande",
    ]);
    expect(d.sendLog.every((n) => !n.leak && !n.byTester)).toBe(true);
    expect(d.sendLog[1]).toMatchObject({ channel: "sms", to: "070-*** ** 12", caseNumber: "BOT-26-0143" });
  });

  it("utskicksloggen visar inloggningskoden rimligt: mallens namn, mottagaren och texten utan koden", async () => {
    // Samma rad som src/server/auth/code-mail.ts skriver i supabase-läget (minnesläget skickar inga koder).
    rt.store.insertRow("outbound_messages", {
      id: "out-kod-1", createdAt: "2027-02-01T09:20", channel: "email", to: "karim.khalil@miljonbemanning.se", template: "inloggningskod",
      subject: "Din inloggningskod till Miljonmatch", body: "Inloggningskod skickad (••••••). Koden sparas aldrig.", caseId: null, status: "sent", sentAt: "2027-02-01T09:20",
      statusReason: null, providerMessageId: "re-1",
    });
    const d = await rt.query(adminTemplates, {}, robin());
    expect(d.sendLog[0]).toEqual({
      id: "out-kod-1", at: "2027-02-01T09:20", channel: "email", to: "karim.khalil@miljonbemanning.se", templateLabel: "Inloggningskod", caseNumber: null,
      body: "Inloggningskod skickad (••••••). Koden sparas aldrig.", byTester: false, leak: false, status: "sent",
    });
  });

  it("utskickets läge: ett utskick som inte gick iväg är failed (systemadministratörens Min vecka, beslut 2026-10-06)", async () => {
    expect((await rt.query(adminTemplates, {}, robin())).sendLog.every((n) => n.status === "sent")).toBe(true);
    rt.store.insertRow("outbound_messages", {
      id: "out-fel-1", createdAt: "2027-02-01T09:20", channel: "email", to: "maria.ekdahl@botkyrka.se", template: "ny_rapport",
      subject: null, body: "Det finns en ny rapport för ärende BOT-26-0143 – logga in för att läsa.", caseId: "case-260143", status: "failed", sentAt: null,
      statusReason: "provider_error", providerMessageId: null,
    });
    const d = await rt.query(adminTemplates, {}, robin());
    expect(d.sendLog.filter((n) => n.status === "failed").map((n) => [n.id, n.caseNumber, n.channel])).toEqual([["out-fel-1", "BOT-26-0143", "email"]]);
    // Samordnaren läser utskicksloggen som förut och ser samma läge.
    expect((await rt.query(adminTemplates, {}, sara())).sendLog.find((n) => n.id === "out-fel-1")?.status).toBe("failed");
  });

  it("personuppgiftskontrollen stoppar mallar med namn, personnummer eller adress", async () => {
    expect(templateCheck("Hej {namn}! Svara: {lank}")).toMatchObject({ ok: false, pii: ["{namn}"], unknown: [] });
    expect(templateCheck("Ditt personnummer 19900101-1234")).toMatchObject({ ok: false, pnr: true });
    expect(templateCheck("Hej {okand} {arendenummer}")).toMatchObject({ ok: true, unknown: ["{okand}"] });
    expect(fillExample("Ärende {arendenummer}, svar senast {svar_senast}")).toBe("Ärende BOT-27-0049, svar senast tisdag 2 feb 2027 kl. 08.41");
    expect(await rt.command(adminSaveTemplate, { key: "pulslank", subject: "", body: "Hej {personnummer}" }, robin())).toMatchObject({ ok: false, error: "personal_data" });
    expect(await rt.command(adminSaveTemplate, { key: "pulslank", subject: "", body: "  " }, robin())).toMatchObject({ ok: false, error: "empty" });
    expect(await rt.command(adminSaveTemplate, { key: "finns_inte", subject: "", body: "x" }, robin())).toMatchObject({ ok: false, error: "not_found" });
    // Inloggningskodens text är fast (mejlet byggs av servern) – en ny version sparas inte.
    expect(await rt.command(adminSaveTemplate, { key: "inloggningskod", subject: "Din kod", body: "Koden: {kod}" }, robin())).toMatchObject({ ok: false, error: "fixed" });
    expect(rt.rows("template_versions")).toEqual([]);
  });

  it("ny version sparas (version 3) och syns i vyn; samordnaren läser men sparar inte", async () => {
    const body = "Hej! Hur går det hos oss? Svara på fem korta frågor: {lank} Länken gäller i 7 dagar. Det är frivilligt och påverkar inte din insats.";
    expect(await rt.command(adminSaveTemplate, { key: "pulslank", subject: "", body }, robin())).toEqual({ ok: true, version: 3 });
    expect(rt.rows("template_versions")).toMatchObject([{ templateKey: "pulslank", version: 3, body, savedBy: "u-robin", savedAt: "2027-02-01T09:13" }]);
    expect(rt.rows("audit_log").find((a) => a.action === "template.saved")).toMatchObject({ entity: "template", entityId: "pulslank", details: { version: 3 } });
    const d = await rt.query(adminTemplates, {}, sara());
    expect(d.canEdit).toBe(false);
    expect(d.templates.find((t) => t.key === "pulslank")).toMatchObject({ version: 3, body, updatedByName: "Robin Åberg", history: [{ version: 3, savedByName: "Robin Åberg" }] });
    await forbidden(rt.command(adminSaveTemplate, { key: "pulslank", subject: "", body }, sara()));
    await forbidden(rt.query(adminTemplates, {}, karin()));
  });
});

describe("revisionslogg och loggkontroll", () => {
  it("loggen i klarspråk – inga kodvärden i detaljerna", async () => {
    const d = await rt.query(adminAuditLog, {}, robin());
    // 19: utskicket av den generiska mottagningsbekräftelsen till em-104 finns inte längre (beslut 2026-10-07).
    expect(d.rows).toHaveLength(19);
    expect([d.views, d.exports, d.byTester]).toEqual([2, 0, 0]);
    const details = d.rows.map((r) => r.detailText).join("\n");
    for (const s of ["Tolkning: Word-mall", "Tolkning: AI", "Period: rullande 6 månader", "Typ: tolka mejl", "Typ: transkribering och utkast"]) {
      expect(details).toContain(s);
    }
    expect(details).not.toMatch(/Tolkning: template|Kanal: email|Typ: parse_email|rolling_6m|Mall: generisk_/);
    expect(d.rows[0]).toMatchObject({ at: "2027-02-01T09:05", actorName: "Lars Nyström", actionLabel: "Visade fakturaunderlag", entityLabel: "Fakturakörning", entityText: "Januari 2027" });
    expect(d.rows.find((r) => r.action === "email.linked")).toMatchObject({ entityLabel: "Mejl", caseNumber: "BOT-27-0049", caseId: "case-270049", detailText: "Via: ärendenummer i ämnesraden" });
    expect(d.actors.map((a) => a.label)).toEqual(["Karin Wallin", "Lars Nyström", "Maria Ekdahl", "Miljonmatch (automatiskt)", "Sara Lindqvist"]);
    expect(d.logCheck).toMatchObject({ month: "2027-01", canSign: false, done: null });
    await forbidden(rt.query(adminAuditLog, {}, sara()));
  });

  it("synpunkter i testmiljön: typ, hur viktigt och status med samma svenska etiketter som dialogen", () => {
    const l: AuditLookups = { userName: () => null, caseNumber: () => null, kpiLabel: () => null, templateLabel: (k) => k };
    expect(detailText({ action: "feedback.created", entity: "feedback", entityId: "fb-1", details: { type: "forbattring", priority: "maste" } }, l)).toBe(
      "Typ: Förbättring · Hur viktigt: Måste ändras",
    );
    expect(detailText({ action: "feedback.created", entity: "feedback", entityId: "fb-2", details: { type: "bra", priority: "kan" } }, l)).toBe("Typ: Bra som det är · Hur viktigt: Kan vänta");
    expect(detailText({ action: "feedback.status_changed", entity: "feedback", entityId: "fb-1", details: { from: "ny", to: "avfardad" } }, l)).toBe("Från: Ny · Till: Avfärdad");
    expect(detailText({ action: "feedback.status_changed", entity: "feedback", entityId: "fb-1", details: { from: "diskutera", to: "andras" } }, l)).toBe(
      "Från: Att diskutera · Till: Ska ändras",
    );
    expect(detailText({ action: "feedback.replied", entity: "feedback", entityId: "fb-1", details: { replyId: "fbr-1" } }, l)).toBe("Svar: fbr-1");
  });

  it("chefens stickprov är samma poster som i den gamla prototypen och kräver anteckning vid avvikelse", async () => {
    const d = await rt.query(adminAuditLog, {}, karin());
    expect(d.logCheck.canSign).toBe(true);
    expect(d.logCheck.sample.map((s) => [s.actionLabel, s.at, s.actorName, s.entityLabel, s.caseNumber])).toEqual([
      ["Visade rapport", "2027-01-29T16:10", "Karin Wallin", "Rapport", ""],
      ["Tog emot mejl", "2027-01-29T10:05", "Miljonmatch (automatiskt)", "Mejl", ""],
      ["Skapade ärende", "2027-01-29T10:07", "Miljonmatch (automatiskt)", "Ärende", "BOT-27-0048"],
      ["Skickade e-post", "2027-01-29T10:07", "Miljonmatch (automatiskt)", "Ärende", "BOT-27-0048"],
      ["Raderade ljudfil", "2027-01-29T14:01", "Miljonmatch (automatiskt)", "AI-körning", ""],
    ]);
    const items = d.logCheck.sample.map((s, i) => ({ logId: s.id, verdict: i === 0 ? "avvikelse" : "ok" }));
    expect(await rt.command(adminLogCheck, { month: "2027-01", items, note: " " }, karin())).toMatchObject({ ok: false, error: "note" });
    const r = await rt.command(adminLogCheck, { month: "2027-01", items, note: "Visningen saknar koppling till ett pågående ärende. Följs upp med samordnaren." }, karin());
    expect(r.ok).toBe(true);
    expect(rt.rows("log_checks")).toMatchObject([{ month: "2027-01", signedBy: "u-karin", items }]);
    expect(rt.rows("audit_log").find((a) => a.action === "audit.log_check")).toMatchObject({ entityId: "2027-01", details: { checked: 5, deviations: 1 } });
    const after = await rt.query(adminAuditLog, {}, karin());
    expect(after.logCheck.done).toMatchObject({ signedByName: "Karin Wallin", items: 5, deviations: 1 });
    await forbidden(rt.command(adminLogCheck, { month: "2027-01", items, note: "x" }, robin()));
  });

  it("gjort av dig i prototypen: nya poster känns igen på id:t", async () => {
    await rt.command(adminRunJob, { key: "inbox" }, robin());
    const d = await rt.query(adminAuditLog, {}, robin());
    expect(d.byTester).toBe(1);
    expect(d.rows[0]).toMatchObject({ actionLabel: "Körde bakgrundsjobb manuellt", entityLabel: "Bakgrundsjobb", entityText: "Läs avrop@-inkorgen", byTester: true, actorName: "Robin Åberg" });
    await forbidden(rt.query(adminAuditLog, {}, amira()));
  });
});
