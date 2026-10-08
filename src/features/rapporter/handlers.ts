// Hanterare för området rapporter (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { handleCommand, type Ctx } from "@/api/server";
import { reportKindLabel } from "@/core/labels";
import type { Case, Report, WeekKey } from "@/data/schema";
import { userEmail } from "../_shared/context";
import { weeklyComplete } from "../_shared/weekly";
import { reportApprove, reportCorrect, reportDeliver, reportOpen } from "./api";
import { freezeReport } from "./freeze";
// Frågorna och områdets egna kommandon (prototypens rapporter.lista, rapport.visa och rap.*).
import "./view-handlers";
// Rapportbyggaren (rapporter steg 4): sparade och delade rapporter och resultatfilen för hela avtalet.
import "./builder-handlers";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

const NOT_FOUND = "Rapporten finns inte, eller så har du inte behörighet att se den.";
const REPORT_ROLES: readonly Role[] = ["coach", "samordnare", "avtalsansvarig"];

async function loadReport(ctx: Ctx, id: string): Promise<{ r: Report; c: Case | null } | null> {
  const r = await ctx.repo.table("reports").get(id);
  if (!r) return null;
  const c = r.caseId ? await ctx.repo.table("cases").get(r.caseId) : null;
  if (r.caseId && !c) return null;
  return { r, c };
}

/** Är aktören huvudcoach i rapportens ärende? */
const isLeadCoach = (a: Actor, c: Case | null) => a.role === "coach" && !!c && c.leadCoachId === a.userId;

/** Vem godkänner rapporten (prototypens canApprove). */
function mayApprove(a: Actor, r: Report, c: Case | null): boolean {
  if (r.kind === "monthly" || r.kind === "final") return isLeadCoach(a, c);
  if (r.kind === "customer_summary") return a.role === "avtalsansvarig";
  return a.role === "samordnare" || a.role === "avtalsansvarig";
}

/** Vem levererar och rättar rapporten (prototypens deliverRoles). Coachen bara i egna ärenden. */
function mayDeliver(a: Actor, r: Report, c: Case | null): boolean {
  if (a.role === "samordnare" || a.role === "avtalsansvarig") return true;
  return r.kind !== "customer_summary" && isLeadCoach(a, c);
}

// ---------------------------------------------------------------- report.approve
handleCommand(reportApprove, { roles: REPORT_ROLES }, async (ctx, p) => {
  const found = await loadReport(ctx, p.reportId);
  if (!found) return fail("not_found", NOT_FOUND);
  const { r, c } = found;
  if (!mayApprove(ctx.actor, r, c)) return fail("forbidden", "Din roll godkänner inte den här rapporten.");
  if ((r.status !== "draft" && r.status !== "reviewed") || r.superseded) return fail("wrong_status", "Rapporten kan inte godkännas i det här läget.");
  await ctx.repo.table("reports").update(r.id, { status: "approved", approvedBy: ctx.actor.userId, approvedAt: ctx.now() });
  await ctx.audit({ action: "report.approved", entity: "report", entityId: r.id, contractId: r.contractId, details: { kind: r.kind } });
  return ok({});
});

// ---------------------------------------------------------------- report.deliver
handleCommand(reportDeliver, { roles: REPORT_ROLES }, async (ctx, p) => {
  const found = await loadReport(ctx, p.reportId);
  if (!found) return fail("not_found", NOT_FOUND);
  const { r, c } = found;
  if (!mayDeliver(ctx.actor, r, c)) return fail("forbidden", "Din roll levererar inte den här rapporten.");
  if (r.superseded || r.status === "delivered" || r.status === "opened") return fail("wrong_status", "Rapporten är redan levererad.");
  if (r.status !== "approved" && r.status !== "reviewed" && r.kind !== "weekly_attendance") return fail("not_approved", "Rapporten måste vara godkänd innan den levereras.");
  // Beställarrapporten lämnas till kommunen utanför Miljonmatch av avtalsansvarig (beslut 2026-10-07: kommunens chef finns inte
  // i portalen). Leveransen registreras – ingen mottagare, inget mejl och ingen bilaga i vanlig e-post (CLAUDE.md punkt 9).
  const outside = r.kind === "customer_summary";
  const to = outside ? null : r.recipientUserId || c?.referrerId || null;
  if (r.kind === "weekly_attendance" && r.status === "waiting" && (!to || !r.week || !(await weeklyComplete(ctx, r.contractId, to, r.week as WeekKey)))) {
    return fail("incomplete", "All närvaro för veckan är inte registrerad ännu.");
  }
  if (r.kind === "final" && !r.finalText?.recommendation?.trim()) return fail("final_text", "Huvudcoachen skriver kvarstående hinder och rekommenderad fortsättning innan slutrapporten levereras.");
  const now = ctx.now();
  const patch: Partial<Report> = { status: "delivered", deliveredAt: now, deliveredTo: to ? [to] : [] };
  if (!r.approvedAt) {
    patch.approvedAt = now;
    patch.approvedBy = ctx.actor.userId;
  }
  await ctx.repo.table("reports").update(r.id, patch);
  // Alla tidigare versioner i kedjan som inte redan är ersatta ersätts av den här. Inte bara den närmast föregående: en
  // rättelse av en rättelse som aldrig levererades (v1 levererad → v2 godkänd → v3) lämnar annars version 1 levererad.
  const seen = new Set<string>([r.id]);
  for (let prevId = r.previousId; prevId && !seen.has(prevId); ) {
    seen.add(prevId);
    const prev = await ctx.repo.table("reports").get(prevId);
    if (!prev) break;
    if (!prev.superseded) await ctx.repo.table("reports").update(prev.id, { superseded: true, supersededAt: now, supersededBy: r.id });
    prevId = prev.previousId;
  }
  // Loggen skrivs innan rapporten fryses: leveransen är gjord, och en frysning som misslyckas får inte lämna den ologgad.
  await ctx.audit({ action: "report.delivered", entity: "report", entityId: r.id, contractId: r.contractId, details: { kind: r.kind, channel: outside ? "outside_portal" : "portal", version: r.version } });
  // Frys innehållet direkt vid leveransen (modellen och, för månads- och slutrapporter, fakta för kommunens resultatfil).
  // Systemsteg (freeze.ts): samma innehåll som kommunen ser, oavsett när någon öppnar rapporten. Misslyckas frysningen
  // (tillfälligt fel) fryses rapporten i stället när den öppnas första gången eller vid kommunens export – med samma
  // underlag (det som fanns vid leveransen).
  try {
    await freezeReport(ctx, r.id);
  } catch (e) {
    console.error("rapport: frysningen vid leveransen misslyckades", r.id, e instanceof Error ? e.name : typeof e);
  }
  if (outside) return ok({});
  // Mejlet innehåller bara en notis – aldrig rapporten eller personuppgifter (CLAUDE.md punkt 9).
  await ctx.notify({
    channel: "email", to: (await userEmail(ctx, to)) || c?.referrerEmail || "", template: "ny_rapport",
    body: `${reportKindLabel(r.kind)}${c ? ` för ärende ${c.caseNumber}` : ""} finns i portalen – logga in för att läsa.`, caseId: r.caseId,
  });
  return ok({});
});

// ---------------------------------------------------------------- report.correct
handleCommand(reportCorrect, { roles: REPORT_ROLES }, async (ctx, p) => {
  const found = await loadReport(ctx, p.reportId);
  if (!found) return fail("not_found", NOT_FOUND);
  const { r, c } = found;
  if (!mayDeliver(ctx.actor, r, c)) return fail("forbidden", "Din roll rättar inte den här rapporten.");
  if (r.superseded || !["approved", "delivered", "opened"].includes(r.status)) return fail("wrong_status", "Bara godkända eller levererade rapporter rättas.");
  if (r.correctionPending) {
    const pending = await ctx.repo.table("reports").get(r.correctionPending);
    if (pending && pending.status !== "delivered" && !pending.superseded) return fail("wrong_status", `Version ${pending.version} är redan ett utkast till rättelse.`);
  }
  // Ny version som utkast. Den gamla sparas och syns för kommunen tills rättelsen är levererad.
  const nr: Report = {
    ...r, id: ctx.newId("rep"), version: r.version + 1, status: "draft", deliveredAt: null, openedAt: null, openedBy: null, approvedAt: null, approvedBy: null,
    previousId: r.id, correctionPending: null, snapshot: null,
  };
  await ctx.repo.table("reports").insert(nr);
  await ctx.repo.table("reports").update(r.id, { correctionPending: nr.id });
  await ctx.audit({ action: "report.corrected", entity: "report", entityId: nr.id, contractId: r.contractId, details: { previous: r.id } });
  return ok({ reportId: nr.id, version: nr.version });
});

// ---------------------------------------------------------------- report.open (tyst)
handleCommand(reportOpen, { roles: ["kommun_handlaggare"], silent: true }, async (ctx, p) => {
  const r = await ctx.repo.table("reports").get(p.reportId);
  if (!r) return fail("not_found", NOT_FOUND);
  // Kvittens bara när en mottagare själv öppnar en levererad rapport.
  const acknowledged = r.deliveredTo.includes(ctx.actor.userId);
  if (acknowledged && !r.openedAt && r.status === "delivered") await ctx.repo.table("reports").update(r.id, { openedAt: ctx.now(), openedBy: ctx.actor.userId });
  await ctx.audit({ action: "report.view", entity: "report", entityId: r.id, contractId: r.contractId, details: { by: "customer", acknowledged } });
  return ok({ acknowledged });
});
