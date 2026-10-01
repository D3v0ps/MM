// Kör köade bakgrundsjobb direkt när svaret skickats (after()), så att t.ex. transkriberingen börjar utan att vänta på cron.
// Utanför en förfrågan (skript) finns inget after() – då tar cron jobbet inom en minut. Bara på servern.
import "server-only";
import { after } from "next/server";
import { safeErrorText } from "./errors";
import { runDueJobs } from "./live";

/** Så många jobb körs direkt efter en förfrågan (resten tar cron). */
const RUN_AFTER_REQUEST = 5;

export function scheduleJobsAfterResponse(): void {
  try {
    after(async () => {
      try {
        await runDueJobs({ limit: RUN_AFTER_REQUEST });
      } catch (e) {
        // Bara feltypen – aldrig innehåll. Jobbet ligger kvar och cron försöker igen.
        console.error("jobb: direktkörningen misslyckades", safeErrorText(e));
      }
    });
  } catch {
    // after() finns bara under en förfrågan.
  }
}
