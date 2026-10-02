// Hanterare: mallar och utskick (/admin/mallar) – mallkatalogen med versioner och utskicksloggen.
// Källa: prototyp/src/views/admin.js (admin.mallar, admin.saveTemplate). Grundtexterna ligger i ./templates.ts,
// sparade versioner i tabellen template_versions. En ny version stoppas om texten innehåller personuppgifter.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import { by } from "@/core/util";
import { adminSaveTemplate, adminTemplates, type SendLogItem, type TemplateView } from "./api";
import { isDemoCreated, mainContract, orgRow, userNames } from "./shared";
import { PNR_RE, TEMPLATES, templateCheck, templateDef, templateKeyOf, templateLabel, templateWhen } from "./templates";

/** Bara systemadmin sparar nya mallversioner (SPEC §9 "redigeras i adminvyn", policyn för template_versions). */
const TEMPLATE_EDITORS: readonly Role[] = ["admin"];
/** Grundtexternas författare i testdatat (prototypens updatedBy: 'u-robin'). Saknas användaren visas bara datumet. */
const BASE_AUTHOR = "u-robin";

handleQuery(adminTemplates, { roles: ["admin", "samordnare"] }, async (ctx) => {
  const main = await mainContract(ctx);
  const { settings } = await orgRow(ctx, main.supplierId);
  const env = { cfg: main.config, org: settings };
  const name = await userNames(ctx);
  const versions = await ctx.repo.table("template_versions").list();
  const templates: TemplateView[] = TEMPLATES.map((t) => {
    const hist = versions.filter((v) => v.templateKey === t.key).sort(by("version"));
    const last = hist[hist.length - 1];
    const baseAuthor = name(BASE_AUTHOR);
    return {
      key: t.key, name: t.name, channel: t.channel, alsoVia: t.alsoVia ?? [], from: t.from, to: t.to, when: templateWhen(t, env),
      subject: last ? last.subject : (t.subject ?? ""), body: last ? last.body : t.body, version: last ? last.version : t.version,
      updatedAt: last ? last.savedAt : t.updatedAt, updatedByName: last ? name(last.savedBy) : baseAuthor === "–" ? "" : baseAuthor,
      variantOf: t.variantOf ?? null,
      history: hist.slice().reverse().map((h) => ({ version: h.version, savedAt: h.savedAt, savedByName: name(h.savedBy) })),
      baseVersion: t.version, baseUpdatedAt: t.updatedAt,
    };
  });

  // Utskicksloggen, nyast först. ctx.system: texterna kontrolleras mot deltagarregistret (även skyddade personer) –
  // bara ja/nej per utskick lämnas ut, aldrig namnen.
  const [messages, persons, cases] = await Promise.all([
    ctx.repo.table("outbound_messages").list(),
    ctx.system.table("persons").list(),
    ctx.repo.table("cases").list(),
  ]);
  const names = persons.map((p) => `${p.firstName} ${p.lastName}`.toLowerCase());
  const leak = (body: string) => PNR_RE.test(String(body || "")) || names.some((n) => String(body || "").toLowerCase().includes(n));
  const caseNo = new Map(cases.map((c) => [c.id, c.caseNumber]));
  const sendLog: SendLogItem[] = messages
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((n) => ({
      id: n.id, at: n.createdAt, channel: n.channel, to: n.to, templateLabel: templateLabel(templateKeyOf(n)), caseNumber: n.caseId ? (caseNo.get(n.caseId) ?? null) : null,
      body: n.body, byTester: isDemoCreated(n.id), leak: leak(n.body),
    }));
  return { canEdit: TEMPLATE_EDITORS.includes(ctx.actor.role), templates, sendLog };
});

/** Ny version av en mall. Stoppas om texten innehåller personuppgifter. */
handleCommand(adminSaveTemplate, { roles: TEMPLATE_EDITORS }, async (ctx, p) => {
  const base = templateDef(p.key);
  if (!base) return fail("not_found", "Mallen finns inte.");
  const subject = String(p.subject || "");
  const body = String(p.body || "");
  if (!body.trim()) return fail("empty", "Texten får inte vara tom.");
  const chk = templateCheck(`${subject}\n${body}`);
  if (!chk.ok) return fail("personal_data", `Mallen innehåller personuppgifter${chk.pii.length ? `: ${chk.pii.join(", ")}` : ""}.`);
  const hist = (await ctx.repo.table("template_versions").list({ templateKey: p.key })).sort(by("version"));
  const version = (hist.length ? hist[hist.length - 1].version : base.version) + 1;
  await ctx.repo.table("template_versions").insert({ id: ctx.newId("tv"), templateKey: p.key, version, subject, body, savedAt: ctx.now(), savedBy: ctx.actor.userId, note: String(p.note ?? "") });
  await ctx.audit({ action: "template.saved", entity: "template", entityId: p.key, contractId: null, details: { version } });
  return ok({ version });
});
