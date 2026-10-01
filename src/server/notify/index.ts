// Utskick i supabase-läget (ctx.notify -> enqueueMessage). Bara på servern.
//   1. queueMessage sparar utskicket i outbound_messages (status queued) och lägger jobbet send_message
//   2. after() kör jobben direkt när svaret skickats, så att mejlet går iväg utan att vänta på cron
//   3. cron (pg_cron -> POST /api/jobs/run varje minut) tar det som blev kvar, t.ex. nya försök efter fel
// Mejl skickas via Resend (resend.ts). I testmiljön får bara adresserna i MM_EMAIL_ALLOWLIST mejl (decision.ts).
// Texten innehåller aldrig personuppgifter (CLAUDE.md punkt 9) – hanterarna skickar bara ärendenummer och "logga in".
// Minnesläget (prototypen) använder inte den här filen – där sparas utskicken direkt i minnet (src/data/memory-runtime.ts).
import "server-only";
import { after } from "next/server";
import type { OutgoingMessage } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo } from "@/data/schema";
import { randomId } from "../ctx";
import { safeErrorText } from "../jobs/errors";
import { runDueJobs } from "../jobs/live";
import { notifyEnv } from "./config";
import { queueMessage } from "./queue";
import type { NotifyRepo } from "./types";

/** Så många jobb körs direkt efter en förfrågan (resten tar cron). */
const RUN_AFTER_REQUEST = 5;

/** Lägg ett utskick i kön. Returnerar utskickets id. */
export async function enqueueMessage(system: AppRepo, msg: OutgoingMessage, now: LocalDateTime): Promise<string> {
  // ctx.system (service role): utskicksloggen och jobben skrivs bara av systemet.
  // MM_APP_URL: engångslänkar (deltagarens inspelningslänk) blir fullständiga adresser.
  const r = await queueMessage(system as unknown as NotifyRepo, msg, now, randomId, { appUrl: notifyEnv().appUrl });
  if (r.jobId) sendSoon();
  return r.messageId;
}

/** Kör jobben när svaret har skickats. Utanför en förfrågan (t.ex. i ett skript) skickar cron i stället inom en minut. */
function sendSoon(): void {
  try {
    after(async () => {
      try {
        await runDueJobs({ limit: RUN_AFTER_REQUEST });
      } catch (e) {
        // Bara feltypen – aldrig adresser eller texter. Jobbet ligger kvar och cron försöker igen.
        console.error("utskick: direktkörningen misslyckades", safeErrorText(e));
      }
    });
  } catch {
    // after() finns bara under en förfrågan.
  }
}
