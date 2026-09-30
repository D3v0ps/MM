// POST /api/jobs/run – kör bakgrundsjobben (tabellen jobs). Anropas varje minut av pg_cron i Supabase (docs/UTSKICK.md).
// Skyddad med MM_JOBS_SECRET: "Authorization: Bearer <nyckel>". proxy.ts släpper igenom /api/jobs/ utan sessionskontroll.
// Svaret innehåller bara antal (inga id:n, adresser eller texter). Bara i supabase-läget.
import { backend } from "@/server/config";
import { safeErrorText } from "@/server/jobs/errors";
import { bearerMatches, jobsSecret } from "@/server/jobs/auth";
import { runDueJobs } from "@/server/jobs/live";

/** Körningen slutar hämta nya jobb efter ca 20 sekunder (runner.ts). */
export const maxDuration = 60;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  if (backend() !== "supabase") return json(404, { code: "not_available", message: "Bakgrundsjobb körs bara i supabase-läget." });
  const secret = jobsSecret();
  if (!secret) return json(503, { code: "not_configured", message: "MM_JOBS_SECRET saknas eller är för kort." });
  if (!bearerMatches(request.headers.get("authorization"), secret)) return json(401, { code: "unauthorized", message: "Fel eller saknad nyckel." });

  const n = Number(new URL(request.url).searchParams.get("limit") ?? "");
  const limit = Number.isInteger(n) && n >= 1 && n <= 50 ? n : 20;
  try {
    const summary = await runDueJobs({ limit });
    return json(200, { ok: true, ...summary });
  } catch (e) {
    console.error("jobs-fel", safeErrorText(e));
    return json(500, { code: "server_error", message: "Jobben kunde inte köras." });
  }
}
