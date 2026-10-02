// Tester för områdets hanterare (admin): samma siffror och texter som den gamla prototypen för testdatat
// 1 feb 2027 kl. 09.12 (prototyp/tools/test-admin.mjs och vyerna i prototyp/src/views/admin.js), behörighet och
// de kontroller som prototypens åtgärder gjorde (admin.setOrgRule, admin.inviteCustomer, admin.saveTemplate …).
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/server";
import { domainEnv } from "@/core/env";
import { notificationsFor, progressionWatch } from "@/core/progression";
import "./handlers";
import {
  adminAuditLog, adminCompare, adminContract, adminIntegrations, adminInviteCustomer, adminLogCheck, adminOrgRules, adminRunJob, adminSaveTemplate,
  adminSetCustomerActive, adminSetOrgRule, adminTemplates, adminUsers,
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
    expect(d.contracts.map((c) => [c.id, c.customerName, c.status])).toEqual([["c-bot", "Botkyrka kommun", "active"], ["c-kk", "Kammarkollegiet", "draft"]]);
    expect(d.contract).toMatchObject({
      id: "c-bot", customerOrgNr: "212000-2882", supplierName: "Miljonbemanning AB", supplierOrgNr: "556959-9318", dnr: "AVN/2026:00048", endsOn: "2030-09-10",
      casePrefix: "BOT", emailDomains: ["botkyrka.se"], managerName: "Johan Berg",
      termination: "Uppsägning utan skäl tidigast två år efter start. Tre månaders uppsägningstid.",
      scope: "Minst 70 och upp till 100 årsplatser i tolv avtalsområden (A–L). Miljonbemanning är rangordnad 1 i alla områden.",
    });
    expect(d.yearShort).toBe("27");
    // Den gamla prototypen: "11 värden är inte fastställda", "Just nu flaggas 2 ärenden", "31 händelser markerade som möjligt bonusunderlag".
    // Avvikelse: AI-leverantören är fastställd (beslut 2026-09-30, Gemini Flash via Vertex AI EU) – nu 10 värden.
    expect(findUnset(d.config).map((u) => u.path)).toEqual([
      "customerVisibility.scope", "result.definition", "result.excludedFromDenominator", "kpis.narvarograd.internalTarget", "kpis.nojdhet.internalTarget",
      "sla.manadsrapport.due", "sla.slutrapport.within", "attendance.sameDayNoticeOnInvalidAbsence", "bonus.model", "retention",
    ]);
    expect(d.stuckCount).toBe(2);
    expect(d.bonusCandidates).toBe(31);
    expect(d.priceItems).toHaveLength(12);
    expect(Math.min(...d.priceItems.map((p) => p.priceOre))).toBe(132300);
    expect(Math.max(...d.priceItems.map((p) => p.priceOre))).toBe(166800);
    expect(d.priceItems[0]).toMatchObject({ areaName: "A Administration", fortnoxArticleNo: "BOT-A", unit: "participant_week", vatRate: 25 });
  });

  it("Kammarkollegiet: skiss utan driftavsnitt, priser i konfigurationen (öre)", async () => {
    const d = await rt.query(adminContract, { contractId: "c-kk" }, robin());
    expect(d.contract).toMatchObject({ id: "c-kk", status: "draft", startsOn: "2027-03-13", operational: false, dataRole: "controller", emailDomains: [] });
    // Avtalstexterna läses från konfigurationen (CLAUDE.md punkt 4), inte per avtalsnummer i koden.
    expect(d.contract).toMatchObject({ termination: "Enligt KK-avtalet – kontrolleras före start.", scope: "Rang 1 av 5 i kaskad. Beställningar som inte tas går vidare till nästa leverantör." });
    // Ett avtal utan texter i konfigurationen visar "–" (null), oavsett avtalsnummer.
    const noTexts = structuredClone(rt.rows("contracts").find((c) => c.id === "c-kk")!.config);
    delete noTexts.texts;
    rt.store.updateRow("contracts", "c-kk", { config: noTexts });
    expect((await rt.query(adminContract, { contractId: "c-kk" }, robin())).contract).toMatchObject({ termination: null, scope: null });
    expect(d.stuckCount).toBeNull();
    expect(findUnset(d.config)).toHaveLength(0);
    expect(d.config.priceItems?.map((p) => p.priceOre)).toEqual([412000, 120000, 135000, 408000, 69900]);
  });

  it("jämförelsen: Botkyrka först, sedan Kammarkollegiet", async () => {
    const d = await rt.query(adminCompare, {}, robin());
    expect(d.contracts.map((c) => c.facts.customerName)).toEqual(["Botkyrka kommun", "Kammarkollegiet"]);
    expect(d.contracts[0].priceOres).toHaveLength(12);
    expect(d.contracts[1].priceOres).toHaveLength(0);
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
  it("systemadmin ser personalen och kommunens användare med samma siffror som prototypen", async () => {
    const d = await rt.query(adminUsers, {}, robin());
    expect(d.kpis).toEqual({ mbActive: 13, customerActive: 5, unitCount: 4, loggedIn30: 1, invited: 0 });
    expect(d.mb?.map((u) => u.name)).toEqual([
      "Robin Åberg", "Johan Berg", "Sara Lindqvist", "Amira Haddad", "Erik Sjöberg", "Leila Nouri", "Mats Holm", "Sofia Grahn", "David Olsson", "Hanna Strand", "Petra Ek",
      "Karin Wallin", "Lars Nyström",
    ]);
    expect(d.mb?.find((u) => u.id === "u-petra")).toMatchObject({ roleLabel: "Handledare", teamRoleLabel: "Yrkesspecifik handledare", kkRoleLabel: null });
    expect(d.customers.map((u) => [u.name, u.role, u.unit, u.buyerReference])).toEqual([
      ["Ahmed Yusuf", "handlaggare", "Arbetsmarknadsenheten Tumba", "55102938"],
      ["Eva Bergström", "chef", "Arbetsmarknadsenheten", null],
      ["Linda Karlsson", "handlaggare", "Arbetsmarknadsenheten Hallunda–Fittja", "7730045120"],
      ["Maria Ekdahl", "handlaggare", "Arbetsmarknadsenheten Alby", "4410023817"],
      ["Omar Farah", "handlaggare", "Arbetsmarknadsenheten Alby", "4410023817"],
    ]);
    expect(d.domains).toEqual(["botkyrka.se"]);
    expect(d.escalateTo).toEqual(["chef"]);
  });

  it("avtalsansvarig ser bara kommunanvändarna", async () => {
    const d = await rt.query(adminUsers, {}, johan());
    expect(d.isAdmin).toBe(false);
    expect(d.mb).toBeNull();
    expect(d.customers).toHaveLength(5);
    await forbidden(rt.query(adminUsers, {}, sara()));
  });

  it("inbjudan: bara tillåten domän, unik adress, roll och enhet – mejlet utan personuppgifter", async () => {
    const base = { name: "Kim Andersson", email: "kim.andersson@gmail.com", role: "handlaggare", unit: "Arbetsmarknadsenheten Tumba" };
    expect(await rt.command(adminInviteCustomer, base, johan())).toMatchObject({ ok: false, error: "domain" });
    expect(await rt.command(adminInviteCustomer, { ...base, name: " " }, johan())).toMatchObject({ ok: false, error: "name" });
    expect(await rt.command(adminInviteCustomer, { ...base, email: "Maria.Ekdahl@botkyrka.se" }, johan())).toMatchObject({ ok: false, error: "exists" });
    expect(await rt.command(adminInviteCustomer, { ...base, email: "kim.andersson@botkyrka.se", unit: "" }, johan())).toMatchObject({ ok: false, error: "unit" });
    const n = rt.rows("profiles").length;
    const r = await rt.command(adminInviteCustomer, { ...base, email: "Kim.Andersson@botkyrka.se", role: "chef" }, johan());
    expect(r.ok).toBe(true);
    const id = r.ok ? r.userId : "";
    expect(rt.rows("profiles")).toHaveLength(n + 1);
    expect(rt.rows("profiles").find((p) => p.id === id)).toMatchObject({
      email: "kim.andersson@botkyrka.se", fullName: "Kim Andersson", organizationId: "org-botkyrka", customerUnit: "Arbetsmarknadsenheten Tumba", buyerReferenceId: "br-tumba",
      title: "Chef", active: true, invitedAt: "2027-02-01T09:13", invitedBy: "u-johan",
    });
    expect(rt.rows("memberships").find((m) => m.userId === id)).toMatchObject({ contractId: "c-bot", role: "kommun_chef", customerUnit: "Arbetsmarknadsenheten Tumba" });
    const mail = rt.rows("outbound_messages").find((m) => m.template === "inbjudan_kommun");
    expect(mail).toMatchObject({ to: "kim.andersson@botkyrka.se", caseId: null });
    expect(mail?.body).not.toMatch(/Kim|Andersson/);
    expect(rt.rows("audit_log").find((a) => a.action === "customer_user.invited")).toMatchObject({ entity: "profile", entityId: id, details: { role: "chef", unit: "Arbetsmarknadsenheten Tumba", domain: "botkyrka.se" } });
    const d = await rt.query(adminUsers, {}, johan());
    expect(d.customers[0]).toMatchObject({ name: "Kim Andersson", role: "chef", invitedAt: "2027-02-01T09:13" });
    expect(d.kpis.invited).toBe(1);
    // Spärra och aktivera igen
    expect(await rt.command(adminSetCustomerActive, { userId: id, active: false }, johan())).toEqual({ ok: true });
    expect(rt.rows("profiles").find((p) => p.id === id)?.active).toBe(false);
    expect(rt.rows("audit_log").some((a) => a.action === "customer_user.blocked" && a.entityId === id)).toBe(true);
    expect(await rt.command(adminSetCustomerActive, { userId: "u-sara", active: false }, robin())).toMatchObject({ ok: false, error: "not_found" });
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
    expect(d.templates).toHaveLength(20);
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
    // Mejlvarianten har exakt samma text som testdatats utskick; portalvarianten samma som beställningen i portalen skickar
    const sent = rt.rows("outbound_messages").find((m) => m.template === "generisk_mottagningsbekraftelse");
    expect(t("generisk_mottagningsbekraftelse").body).toBe(sent?.body);
    expect(t("generisk_mottagningsbekraftelse_portal").body).toBe("Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.");
    expect(d.sendLog.map((n) => n.templateLabel)).toEqual([
      "Ordererkännande", "Pulslänk", "Generisk mottagningsbekräftelse – mejl", "Ny rapport", "Mötespåminnelse", "Ordererkännande", "Nytt meddelande", "Ordererkännande",
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
      body: "Inloggningskod skickad (••••••). Koden sparas aldrig.", byTester: false, leak: false,
    });
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
    expect(d.rows).toHaveLength(20);
    expect([d.views, d.exports, d.byTester]).toEqual([2, 0, 0]);
    const details = d.rows.map((r) => r.detailText).join("\n");
    for (const s of ["Tolkning: Word-mall", "Tolkning: AI", "Period: rullande 6 månader", "Typ: tolka mejl", "Typ: transkribering och utkast", "Mall: Generisk mottagningsbekräftelse – mejl"]) {
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
