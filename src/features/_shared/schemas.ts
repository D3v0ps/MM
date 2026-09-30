// Gemensamma zod-byggstenar för kontrakten i src/features/*/api.ts. Isomorf och liten – importeras av skärmar via api.ts.
// Scheman har inga transformationer och inga standardvärden, så att typen som skärmen skickar är densamma som
// hanteraren får (command() typar indata som schemats utdata). Standardvärden sätts i hanterarna.
import { z } from "zod";

/** Id för en rad (ärende, rapport, aktivitet …). Aldrig personuppgifter. */
export const IdSchema = z.string().min(1).max(120);
/** 'YYYY-MM-DD' (Stockholm). */
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** 'YYYY-MM-DDTHH:mm' (Stockholm). */
export const LocalDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
/** 'YYYY-MM' */
export const MonthKeySchema = z.string().regex(/^\d{4}-\d{2}$/);
/** 'YYYY-Www' (ISO-vecka) */
export const WeekKeySchema = z.string().regex(/^\d{4}-W\d{2}$/);
/** Kort fritext (namn, orsak, referens). */
export const ShortText = z.string().max(300);
/** Längre fritext (anteckning, beskrivning, meddelande). */
export const LongText = z.string().max(5000);
