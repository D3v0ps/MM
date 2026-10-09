// Inläsningen av avrop@ (beslut 4c, 2026-10-08, SPEC §7.1): hämtar olästa mejl via Graph, tolkar dem med samma tolkning som
// inkorgen visar (src/features/inkorg/parse.ts), sparar dem som inbound_emails och flyttar dem till mappen Inläst.
//   Idempotent  samma mejl (internetMessageId) sparas aldrig två gånger – finns raden flyttas mejlet bara.
//   Beställning deltagarens namn och personnummer finns → person, ärende och ordererkännande (createOrder, systemaktören);
//               annars (eller när personen redan har en insats) ligger mejlet kvar som "received" och samordnaren
//               registrerar det för hand i inkorgen (Registrera beställning).
//   Svar        ärendenumret i ämnet/texten → komplettering (öppet ärende, status linked) eller Övrigt (kopplat till ärendet).
//   Bilagor     filbilagor av tillåten typ sparas som ärendets bilagor (porten, uppladdade av systemet) – kopplas till ärendet
//               när det skapas (nu eller vid registreringen). Word-bilagor läses för tolkningen.
// Körs med en Ctx för systemsteg (service role, crypto, bilagor, utskickskön). Felorsaker innehåller aldrig adresser,
// ämnesrader eller innehåll. Testas med en fejkad Graph mot minnesläget (import.test.ts).
import type { Ctx } from "@/api/server";
import { isOperational, requireOperational } from "@/core/config";
import { emailDomainOf } from "@/core/self-registration";
import type { LocalDateTime } from "@/core/time";
import { buyerRefValid, pnrFormatValid } from "@/core/validation";
import type { Case, Contract, EmailAttachment, InboundEmail, OrderExtract, PreferredContact } from "@/data/schema";
import { fromTimestamptz } from "@/data/supabase/columns";
import { attachmentMime, cleanFileName } from "@/core/attachments";
import { createOrder } from "@/features/arenden/order";
import { canCreateCase, parseInboundMail, priorFromExtract } from "@/features/inkorg/parse";
import { JobError } from "../jobs/errors";
import { MAX_ATTACHMENT_BYTES, type GraphMail, type GraphMessage } from "./graph";

export type ImportSummary = {
  /** Olästa mejl i brevlådan vid körningen. */
  seen: number;
  /** Nya rader i inbound_emails. */
  imported: number;
  /** Ärenden som skapades automatiskt (ordererkännande skickat). */
  cases: number;
  /** Beställningar som väntar på registrering för hand. */
  toRegister: number;
  supplements: number;
  other: number;
  /** Mejl som redan var inlästa (bara flyttade). */
  skipped: number;
  moved: number;
  /** Mejl som inte kunde flyttas (försöks igen nästa körning). */
  moveErrors: number;
};

export type ImportDeps = {
  graph: GraphMail;
  /** Systemsteg: repo = service role, attachments, crypto och notify (utskickskön). */
  ctx: Ctx;
  now: LocalDateTime;
  /** Text ur en Word-bilaga (servern: docxText). Saknas den läses bara brödtexten. */
  docxText?: (file: Uint8Array) => string;
};

/** Längsta mejltext som sparas (resten klipps – originalet ligger kvar i Inläst). */
export const BODY_MAX = 20_000;
const OPEN: readonly Case["status"][] = ["received", "acknowledged"];
const CONTACTS: readonly PreferredContact[] = ["sms", "phone", "email", "letter"];

/** Avtalet för avsändaren: beställaren vars domäner har adressens domän, annars det första aktiva avtalet med driftkonfiguration. */
export async function contractForSender(ctx: Ctx, fromAddress: string): Promise<Contract | null> {
  const [contracts, orgs] = await Promise.all([ctx.repo.table("contracts").list({ status: "active" }), ctx.repo.table("organizations").list({ kind: "customer" })]);
  const live = contracts.filter((c) => isOperational(c.config)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const domain = emailDomainOf(fromAddress);
  const byDomain = live.find((c) => (orgs.find((o) => o.id === c.customerId)?.emailDomains ?? []).map((d) => d.toLowerCase()).includes(domain));
  return byDomain ?? live[0] ?? null;
}

const str = (v: unknown): string => (v == null ? "" : String(v).trim());

export async function importInbox(d: ImportDeps): Promise<ImportSummary> {
  const { ctx, graph, now } = d;
  const sum: ImportSummary = { seen: 0, imported: 0, cases: 0, toRegister: 0, supplements: 0, other: 0, skipped: 0, moved: 0, moveErrors: 0 };
  const emails = ctx.repo.table("inbound_emails");
  const messages = await graph.listUnread();
  sum.seen = messages.length;
  const moveErrors: JobError[] = [];
  const move = async (m: GraphMessage) => {
    try {
      await graph.moveToDone(m.id);
      sum.moved++;
    } catch (e) {
      sum.moveErrors++;
      moveErrors.push(e instanceof JobError ? e : new JobError("Microsoft Graph: flytten misslyckades", { retryable: true }));
    }
  };

  for (const m of messages) {
    const gid = m.internetMessageId ?? `graph:${m.id}`;
    if (await emails.first({ graphMessageId: gid })) {
      // Redan inläst (t.ex. flytten misslyckades förra gången): bara flytta.
      sum.skipped++;
      await move(m);
      continue;
    }
    const contract = await contractForSender(ctx, m.fromAddress);
    if (!contract) throw new JobError("Inget aktivt avtal med driftkonfiguration – mejlen kan inte läsas in", { retryable: false });
    const cfg = requireOperational(contract.config);
    const receivedAt = receivedLocal(m.receivedDateTime, now);
    const emailId = ctx.newId("em");

    // Bilagorna: tolkningens text ur Word, och filerna som ärendets bilagor (utan ärende tills det finns).
    // Yrkesområdet tolkas mot avtalets aktiva avtalsområden (namn eller bokstav, beslut 2026-10-09).
    const areas = (await ctx.repo.table("contract_areas").list({ contractId: contract.id, active: true })).map((a) => ({ code: a.code, name: a.name }));
    const parseOpts = { casePrefix: cfg.casePrefix, areas };
    const first = parseInboundMail({ subject: m.subject, bodyText: m.bodyText }, parseOpts);
    const attachments: EmailAttachment[] = [];
    const attachmentIds: string[] = [];
    let attachmentText = "";
    if (m.hasAttachments && first.kind !== "reply") {
      for (const a of await graph.listAttachments(m.id)) {
        const fileName = cleanFileName(a.name);
        const mime = attachmentMime(fileName, a.contentType);
        const kind = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
        if (!mime || a.size <= 0 || a.size > MAX_ATTACHMENT_BYTES) {
          attachments.push({ name: fileName || "bilaga", kind, path: null });
          continue;
        }
        const bytes = await graph.attachmentBytes(m.id, a.id);
        if (mime.endsWith("wordprocessingml.document") && d.docxText) attachmentText += `\n${d.docxText(bytes)}`;
        const stored = ctx.attachments ? await ctx.attachments.store({ contractId: contract.id, caseId: null, ownerId: ctx.actor.userId, fileName, mimeType: mime, bytes: a.size }, bytes) : null;
        if (stored) attachmentIds.push(stored.id);
        attachments.push({ name: fileName, kind, path: stored?.storagePath ?? null });
      }
    }
    const parsed = attachmentText ? parseInboundMail({ subject: m.subject, bodyText: m.bodyText, attachmentText }, parseOpts) : first;

    const row: InboundEmail = {
      id: emailId, graphMessageId: gid, receivedAt, fromAddress: m.fromAddress, fromName: m.fromName || m.fromAddress, subject: m.subject || "(utan ämne)",
      bodyText: m.bodyText.slice(0, BODY_MAX), attachments, parseMethod: parsed.parseMethod, classification: "other", extracted: parsed.extracted, confidence: parsed.confidence,
      missingFields: parsed.missingFields, corrections: {}, status: "other", caseId: null, ackSentAt: null, ackKind: null, aiRunId: null, linkedBy: parsed.linkedBy,
      registeredBy: null, registeredAt: null, handledBy: null, handledAt: null,
    };

    if (parsed.kind === "reply" && parsed.caseNumber) {
      const c = await ctx.repo.table("cases").first({ caseNumber: parsed.caseNumber, contractId: contract.id });
      const supplement = !!c && OPEN.includes(c.status) && Object.keys(parsed.extracted).length > 0;
      row.caseId = c?.id ?? null;
      row.classification = supplement ? "supplement" : "other";
      row.status = supplement ? "linked" : "other";
      if (supplement) sum.supplements++;
      else sum.other++;
      await emails.insert(row);
    } else if (parsed.kind === "order") {
      row.classification = "order";
      row.status = "received";
      await emails.insert(row);
      const created = canCreateCase(parsed.extracted) ? await createCase(ctx, contract, cfg.orderPeriods, row, parsed.extracted, attachmentIds, receivedAt) : null;
      if (created) {
        await emails.update(row.id, { caseId: created.caseId, status: "acknowledged", ackSentAt: ctx.now() });
        row.caseId = created.caseId;
        sum.cases++;
      } else sum.toRegister++;
    } else {
      sum.other++;
      await emails.insert(row);
    }
    sum.imported++;
    await ctx.audit({
      action: "email.received", entity: "inbound_email", entityId: row.id, contractId: contract.id,
      details: { parseMethod: row.parseMethod, classification: row.classification, caseId: row.caseId, attachments: attachments.length, missing: row.missingFields },
    });
    await move(m);
  }
  // Mejl som inte kunde flyttas är ändå sparade: nästa körning hoppar över raderna och flyttar bara. Jobbet försöks igen.
  const firstMoveError = moveErrors[0];
  if (firstMoveError && sum.moveErrors === sum.seen) throw firstMoveError;
  if (firstMoveError) throw new JobError(`${firstMoveError.message} (${sum.moveErrors} av ${sum.seen} mejl kunde inte flyttas – försöks igen)`, { retryable: true });
  return sum;
}

/** Mottagningstiden i Stockholm ur Graphs UTC-tid; nu om tiden saknas eller är trasig. */
export function receivedLocal(iso: string, now: LocalDateTime): LocalDateTime {
  try {
    const t = fromTimestamptz(iso);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t) && !t.includes("NaN") ? t : now;
  } catch {
    return now;
  }
}

/** Ärendet ur ett tolkat avrop. Null om det inte kunde skapas (t.ex. personen har redan en insats) – samordnaren registrerar. */
async function createCase(
  ctx: Ctx, contract: Contract, periods: { months: readonly number[]; allowOther: boolean }, row: InboundEmail, ex: OrderExtract, attachmentIds: string[], receivedAt: LocalDateTime,
): Promise<{ caseId: string } | null> {
  const cfg = requireOperational(contract.config);
  // Handläggaren: ett konto med avsändarens (eller mallens) adress kopplas direkt, annars uppgifterna på ärendet.
  const refEmail = (str(ex.referrerEmail) || row.fromAddress).toLowerCase();
  const profiles = await ctx.repo.table("profiles").list({ organizationId: contract.customerId });
  const known = profiles.find((p) => p.email.toLowerCase() === refEmail && p.active !== false) ?? null;
  const months = Number(str(ex.orderPeriod));
  const other = str(ex.orderPeriod) === "annan";
  const desiredStart = /^\d{4}-\d{2}-\d{2}$/.test(str(ex.desiredStart)) ? str(ex.desiredStart) : null;
  const plannedEnd = other && /^\d{4}-\d{2}-\d{2}$/.test(str(ex.plannedEnd)) && desiredStart && str(ex.plannedEnd) > desiredStart ? str(ex.plannedEnd) : null;
  // Kontaktvägen frågas inte längre efter (beslut 2026-10-09). Ett äldre mejl med raden behåller sitt val; annars väljer
  // createOrder SMS, e-post eller telefon efter uppgifterna.
  const contact = CONTACTS.includes(ex.preferredContact as PreferredContact) ? (ex.preferredContact as PreferredContact) : null;
  const buyerReference = buyerRefValid(str(ex.buyerReference), cfg) ? str(ex.buyerReference) : "";
  const res = await createOrder(ctx, {
    contract, source: "email", referrerId: known?.id ?? null, referrerName: known?.fullName ?? str(ex.referrerName) ?? row.fromName, referrerEmail: refEmail,
    referrerUnit: str(ex.referrerUnit) || known?.customerUnit || null, referrerPhone: str(ex.referrerPhone) || known?.phone || null,
    firstName: str(ex.firstName), lastName: str(ex.lastName), pnr: pnrFormatValid(ex.pnr) ? str(ex.pnr) : "", phone: str(ex.phone), email: str(ex.email), city: str(ex.city),
    preferredContact: contact, buyerReference, primaryArea: str(ex.primaryArea) || null, secondaryArea: str(ex.secondaryArea) || null, vocationalTrack: str(ex.vocationalTrack),
    desiredStart, orderPeriodMonths: desiredStart && Number.isInteger(months) && periods.months.includes(months) ? months : null,
    plannedEnd: periods.allowOther ? plannedEnd : null, orderPeriodReason: plannedEnd ? str(ex.orderPeriodReason) || "Enligt beställningen i mejlet." : null,
    priorAssessment: priorFromExtract(ex.priorAssessment), background: str(ex.background), attachmentIds, sourceEmailId: row.id, missingFields: row.missingFields, referredAt: receivedAt,
  });
  return res.ok ? { caseId: res.caseId } : null;
}
