// Hanterare: Registrera beställning i avropsinkorgen (beslut 4a, 2026-10-08) – ett avrop som kom med mejl, telefon eller på
// annat sätt. Registreras via ./handlers.ts. Samma fält och regler som kommunens formulär (arenden.caseCreate) via
// createOrder (src/features/arenden/order.ts); dessutom hur och när avropet kom och kommunens handläggare.
//   Handläggaren: en profil med adressen kopplas direkt (referrerId); annars sparas namn, e-post, enhet och telefon på
//   ärendet tills hen skapar konto själv (då kopplas ärendet via adressen – src/features/session/self-register.ts).
//   Mejlet: ett inläst mejl utan ärende (emailId) uppdateras (caseId, status, registered_by/at); annars skapas en rad i
//   inbound_emails med parse_method manual. Personnumret ur mejlet lämnas aldrig ut – det används när fältet lämnas tomt.
//   Revisionslogg: email.registered (id:n och kanal) och case.created. Inga personuppgifter i svar, loggar eller adresser.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import { buyerRefLengthText } from "@/core/config";
import { emailDomainOf } from "@/core/self-registration";
import { dayOf, fmtDateTimeLong } from "@/core/time";
import { emailValid, pnrFormatValid } from "@/core/validation";
import type { CaseAttachment, InboundEmail, OrderExtract, Profile } from "@/data/schema";
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, ATTACHMENT_TYPES_TEXT, requireAttachments } from "../_shared/attachment-port";
import { hasRoleIn } from "../_shared/context";
import { createOrder } from "../arenden/order";
import { inboxRegister, inboxRegisterForm, type RegisterForm, type RegisterHandler, type RegisterPrefill } from "./api";
import { answerDays, inboxEnv, maskedPnr } from "./model";
import { priorFromExtract } from "./parse";
import { workingDaysText } from "./texts";

const ROLES: readonly Role[] = ["samordnare", "avtalsansvarig"];
const EMAIL_NOT_FOUND = "Mejlet finns inte, eller så har du inte behörighet att se det.";

/** Kommunens handläggare med konto i avtalet (namn, adress, enhet, telefon) – att välja i formuläret. */
async function customerHandlers(ctx: Parameters<typeof inboxEnv>[0], customerId: string, contractId: string): Promise<{ profiles: Profile[]; rows: RegisterHandler[] }> {
  const [profiles, memberships] = await Promise.all([ctx.repo.table("profiles").list({ organizationId: customerId }), ctx.repo.table("memberships").list({ contractId, role: "kommun_handlaggare" })]);
  const ids = new Set(memberships.map((m) => m.userId));
  const rows = profiles
    .filter((p) => ids.has(p.id) && p.active !== false)
    .map((p): RegisterHandler => ({ id: p.id, name: p.fullName, email: p.email, unit: p.customerUnit ?? "", phone: p.phone }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
  return { profiles, rows };
}

/** Förifyllningen ur mejlets tolkning (samma nycklar som OrderExtract). Personnumret bara maskerat. */
function prefillOf(ex: OrderExtract): RegisterPrefill {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    referrerName: s(ex.referrerName), referrerEmail: s(ex.referrerEmail).toLowerCase(), referrerUnit: s(ex.referrerUnit), referrerPhone: s(ex.referrerPhone),
    desiredStart: s(ex.desiredStart), orderPeriod: s(ex.orderPeriod), plannedEnd: s(ex.plannedEnd), orderPeriodReason: s(ex.orderPeriodReason), buyerReference: s(ex.buyerReference),
    firstName: s(ex.firstName), lastName: s(ex.lastName), phone: s(ex.phone), email: s(ex.email), city: s(ex.city), preferredContact: s(ex.preferredContact),
    priorAssessment: priorFromExtract(ex.priorAssessment) ?? "", background: s(ex.background),
    pnrMasked: pnrFormatValid(ex.pnr) ? maskedPnr({ personnummerLast4: String(ex.pnr).replace(/\D/g, "").slice(-4) }) : null,
  };
}

/** Ett inläst avrop som kan registreras: en beställning som väntar och inte har något ärende. */
const registrable = (m: InboundEmail): boolean => m.classification === "order" && !m.caseId && (m.status === "received" || m.status === "acknowledged");

// ---------------------------------------------------------------- inkorg.registerForm
handleQuery(inboxRegisterForm, { roles: ROLES }, async (ctx, p) => {
  const e = await inboxEnv(ctx);
  const customer = await ctx.repo.table("organizations").get(e.contract.customerId);
  const { rows } = await customerHandlers(ctx, e.contract.customerId, e.contract.id);
  let email: RegisterForm["email"] = null;
  if (p.emailId) {
    const m = await ctx.repo.table("inbound_emails").get(p.emailId);
    if (m && registrable(m)) {
      // Avsändaren förifyller handläggaren när mallen inte hade uppgifterna.
      const ex = m.extracted as OrderExtract;
      const prefill = prefillOf(ex);
      if (!prefill.referrerEmail) prefill.referrerEmail = m.fromAddress.toLowerCase();
      if (!prefill.referrerName) prefill.referrerName = m.fromName;
      email = { id: m.id, subject: m.subject, from: m.fromName, fromAddress: m.fromAddress, receivedAt: m.receivedAt, receivedLong: fmtDateTimeLong(m.receivedAt), attachments: m.attachments.length, prefill };
    }
  }
  return {
    today: e.today, now: e.now,
    periods: { months: [...e.cfg.orderPeriods.months], allowOther: e.cfg.orderPeriods.allowOther },
    refPattern: e.cfg.billing.buyerReference.pattern, refLen: buyerRefLengthText(e.cfg),
    attachments: { maxBytes: ATTACHMENT_MAX_BYTES, maxFiles: ATTACHMENT_MAX_FILES, accept: ATTACHMENT_ACCEPT, typesText: ATTACHMENT_TYPES_TEXT },
    customerName: customer?.name ?? "Kommunen", customerDomains: (customer?.emailDomains ?? []).map((d) => d.toLowerCase()),
    handlers: rows, answerText: workingDaysText(answerDays(e.cfg)), email,
  };
});

// ---------------------------------------------------------------- inkorg.register
handleCommand(inboxRegister, { roles: ROLES }, async (ctx, p) => {
  const e = await inboxEnv(ctx);
  const contract = e.contract;
  const now = ctx.now();
  if (p.receivedAt > now) return fail("received_at", "Mottagen tid kan inte vara i framtiden.");

  // Det inlästa mejlet (kanalen är då mejl).
  let mail: InboundEmail | null = null;
  if (p.emailId) {
    mail = await ctx.repo.table("inbound_emails").get(p.emailId);
    if (!mail) return fail("not_found", EMAIL_NOT_FOUND);
    if (!registrable(mail)) return fail("email", "Mejlet är redan ett ärende, eller är inte en beställning.");
  }
  const channel = mail ? "email" : p.channel;

  // Handläggaren: ett konto i avtalet, eller uppgifter på ärendet (adressen måste vara kommunens).
  const customer = await ctx.repo.table("organizations").get(contract.customerId);
  const domains = (customer?.emailDomains ?? []).map((d) => d.toLowerCase());
  const { profiles } = await customerHandlers(ctx, contract.customerId, contract.id);
  let referrerId: string | null = null;
  let referrer = { name: p.referrerName.trim(), email: p.referrerEmail.trim().toLowerCase(), unit: p.referrerUnit.trim(), phone: p.referrerPhone.trim() };
  if (p.referrerId) {
    const u = profiles.find((x) => x.id === p.referrerId);
    if (!u || !(await hasRoleIn(ctx, u.id, contract.id, ["kommun_handlaggare"]))) return fail("referrer", "Välj en handläggare hos beställaren.");
    referrerId = u.id;
    referrer = { name: u.fullName, email: u.email.toLowerCase(), unit: referrer.unit || (u.customerUnit ?? ""), phone: referrer.phone || u.phone };
  } else {
    if (!referrer.name) return fail("referrer", "Skriv handläggarens namn.");
    if (!emailValid(referrer.email)) return fail("referrer", "Skriv handläggarens hela e-postadress.");
    if (!domains.includes(emailDomainOf(referrer.email))) return fail("referrer", `Handläggarens adress ska ha kommunens domän (${domains.map((d) => `@${d}`).join(", ") || "saknas i avtalet"}).`);
    // Finns redan ett konto med adressen kopplas ärendet direkt (beslut 4a).
    const existing = profiles.find((x) => x.email.toLowerCase() === referrer.email);
    if (existing) referrerId = existing.id;
  }

  // Personnumret: det ifyllda, annars det ur mejlet (lämnas aldrig ut till skärmen).
  const pnr = p.pnr.trim() || String((mail?.extracted as OrderExtract | undefined)?.pnr ?? "").trim();
  if (!pnrFormatValid(pnr)) return fail("pnr", mail ? "Personnumret saknas eller har fel format. Skriv det så här: ÅÅÅÅMMDD-NNNN." : "Skriv personnumret så här: ÅÅÅÅMMDD-NNNN.");

  // Bilagorna: egna uppladdningar i avtalet som inte är kopplade (läses via behörigheten).
  const attachmentIds = [...new Set(p.attachmentIds)];
  if (attachmentIds.length) {
    const rows = await ctx.repo.table("case_attachments").list({ id: { in: attachmentIds } });
    const allOk = attachmentIds.every((id) => {
      const a = rows.find((x) => x.id === id);
      return !!a && a.uploadedBy === ctx.actor.userId && !a.caseId && a.contractId === contract.id && a.status === "uploaded";
    });
    if (!allOk) return fail("attachments", "En bilaga kunde inte kopplas till beställningen. Ta bort den och bifoga den igen.");
  }
  // Mejlets egna bilagor (lagrade av inläsningen, utan ärende) kopplas också. ctx.system: raderna är systemets (uppladdade av inläsningen).
  let mailAttachmentIds: string[] = [];
  if (mail && mail.attachments.some((a) => a.path)) {
    const paths = new Set(mail.attachments.map((a) => a.path).filter((x): x is string => !!x));
    const stored: CaseAttachment[] = await ctx.system.table("case_attachments").list({ contractId: contract.id, caseId: { isNull: true }, status: "uploaded" });
    mailAttachmentIds = stored.filter((a) => paths.has(a.storagePath)).map((a) => a.id);
  }

  const emailId = mail?.id ?? ctx.newId("em");
  const res = await createOrder(ctx, {
    contract, source: channel, referrerId, referrerName: referrer.name, referrerEmail: referrer.email, referrerUnit: referrer.unit, referrerPhone: referrer.phone,
    firstName: p.firstName, lastName: p.lastName, pnr, phone: p.phone, email: p.email, city: p.city, address: p.address ?? null, preferredContact: p.preferredContact,
    buyerReference: p.buyerReference, desiredStart: p.desiredStart, orderPeriodMonths: p.orderPeriodMonths, plannedEnd: p.plannedEnd, orderPeriodReason: p.orderPeriodReason,
    priorAssessment: p.priorAssessment, background: p.background, attachmentIds: [...attachmentIds, ...mailAttachmentIds], sourceEmailId: emailId, referredAt: p.receivedAt,
  });
  if (!res.ok) return fail(res.error === "po_number" ? "buyer_ref" : res.error, res.message);

  if (mail) {
    await ctx.repo.table("inbound_emails").update(mail.id, {
      caseId: res.caseId, status: "acknowledged", ackSentAt: now, missingFields: [], registeredBy: ctx.actor.userId, registeredAt: now,
    });
  } else {
    const subject = channel === "phone" ? "Beställning per telefon" : "Beställning registrerad av Miljonbemanning";
    await ctx.repo.table("inbound_emails").insert({
      id: emailId, graphMessageId: `manual:${emailId}`, receivedAt: p.receivedAt, fromAddress: referrer.email, fromName: referrer.name, subject, bodyText: "",
      attachments: [], parseMethod: "manual", classification: "order", extracted: {}, confidence: {}, missingFields: [], corrections: {}, status: "acknowledged",
      caseId: res.caseId, ackSentAt: now, ackKind: null, aiRunId: null, linkedBy: null, registeredBy: ctx.actor.userId, registeredAt: now, handledBy: null, handledAt: null,
    });
  }
  if (mailAttachmentIds.length) {
    // Mejlets bilagor hör nu till ärendet (porten, service role). Bara id:n i loggen.
    await requireAttachments(ctx).link(mailAttachmentIds, res.caseId);
  }
  await ctx.audit({
    action: "email.registered", entity: "inbound_email", entityId: emailId, contractId: contract.id,
    details: { caseId: res.caseId, number: res.caseNumber, channel, linkedProfile: !!referrerId, receivedOn: dayOf(p.receivedAt) },
  });
  return ok({ caseId: res.caseId, caseNumber: res.caseNumber, emailId });
});
