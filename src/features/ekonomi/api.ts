// Kontrakt för området ekonomi (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, type Result } from "@/api/contract";
import { IdSchema, MonthKeySchema, WeekKeySchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende som prototypens MM.defineAction. Nyckeln är "ekonomi.<prototypens namn>". Bara ekonomen ändrar.
// Fakturor per ärende och månad identifieras med ärendets id och månaden – inga namn eller personnummer.

/** Godkänn en debiterbar vecka utan närvaro för fakturering (prototypens billing.approveZeroWeek). */
export const billingApproveZeroWeek = command("ekonomi.billingApproveZeroWeek", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
  weekKey: WeekKeySchema,
  note: z.string().max(1000).optional(),
})).returns<Result<object, "not_found">>();

/** Godkänn fakturor (ett eller flera ärenden) för månaden (prototypens billing.approveInvoice). */
export const billingApproveInvoice = command("ekonomi.billingApproveInvoice", z.object({
  month: MonthKeySchema,
  caseIds: z.array(IdSchema).min(1).max(1000),
})).returns<Result<{ approved: number }, "not_found">>();

/**
 * Skapa fakturor i Fortnox (simulerat) – prototypens billing.sendFortnox. Idempotent: en faktura som redan skapats
 * (eller fakturerats manuellt) skapas inte igen – nyckeln är månad:ärende. Beställarreferensen kontrolleras innan en
 * faktura skapas (CLAUDE.md punkt 11): ärenden med saknad, felaktig eller spärrad referens hamnar i blocked.
 */
export const billingSendFortnox = command("ekonomi.billingSendFortnox", z.object({
  month: MonthKeySchema,
  caseIds: z.array(IdSchema).min(1).max(1000),
})).returns<Result<{ created: string[]; skipped: string[]; blocked: string[] }, "not_found">>();

/** Markera fakturan som manuellt fakturerad med fakturanummer (prototypens billing.markManual). */
export const billingMarkManual = command("ekonomi.billingMarkManual", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
  invoiceNo: z.string().trim().min(1).max(60),
})).returns<Result<object, "not_found">>();

/** Logga en export av fakturaunderlaget (prototypens billing.export). Själva filen byggs av skärmen med useDownload(). */
export const billingExport = command("ekonomi.billingExport", z.object({
  month: MonthKeySchema,
  format: z.enum(["csv", "xlsx", "pdf"]),
})).returns<Result<object>>();
