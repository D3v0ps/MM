// POST /api/staging/seed { confirm: true } – "Läs in testdata på nytt" (adminvyn). Bara testare, bara i testmiljön:
// tömmer appens tabeller (mm.reset_test_data, som själv vägrar utanför testmiljön), läser in hela prototypens testdata med
// service role och startar om testklockan på måndag 1 februari 2027 kl. 09.12. Allt som testats nollställs; revisionsloggen
// och testarnas inloggning finns kvar. Revisionslogg: staging.seed (bara id:n och antal). Inga personuppgifter i loggar.
import type { PnrCrypto } from "@/api/server";
import { DEMO_START } from "@/data/seed";
import { appRepo, type PgClient } from "@/data/supabase";
import { clockNow } from "@/server/clock";
import { PnrKeyError, serverCrypto } from "@/server/crypto";
import { liveSession, type LiveSession } from "@/server/live";
import { BACKEND } from "@/server/runtime";
import { clearAppSettingsCache, loadAppSettings } from "@/server/settings";
import { seedGuard } from "@/server/staging/guard";
import { loadTestData, SeedLoadError, type SeedClient } from "@/server/staging/load";

/** Inläsningen tar normalt 10–30 sekunder (ca 13 000 rader i ett 60-tal anrop). 60 sekunder är taket på alla
 *  Vercel-nivåer – en högre gräns stoppar hela driftsättningen på nivåer som inte tillåter den. */
export const maxDuration = 60;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  const early = seedGuard({ backend: BACKEND, confirm: body?.confirm, authenticated: true, isTester: true, environment: "staging" });
  if (early) return json(early.status, { code: early.code, message: early.message });

  let s: LiveSession;
  try {
    s = await liveSession();
  } catch (e) {
    console.error("testdata", "session", e instanceof Error ? e.name : "okänt");
    return json(500, { code: "server_error", message: "Inloggningen kunde inte hämtas. Försök igen." });
  }
  const id = s.identity;
  // Testaren själv (inte testpersonen hen agerar som) – och bara i testmiljön. Databasen kontrollerar miljön en gång till.
  const denied = seedGuard({ backend: BACKEND, confirm: body?.confirm, authenticated: !!id && !!s.authUserId, isTester: !!id?.isTester, environment: s.settings.environment });
  if (denied || !id) return json(denied?.status ?? 401, { code: denied?.code ?? "unauthenticated", message: denied?.message ?? "Du är inte inloggad." });

  const audit = async (action: string, details: Record<string, unknown>) => {
    clearAppSettingsCache();
    const nowMs = Date.now();
    const settings = await loadAppSettings(s.service as unknown as PgClient, nowMs);
    // ctx.system-motsvarighet (service role): revisionsloggen skrivs bara av servern.
    await appRepo(s.service).table("audit_log").insert({
      id: `log-${crypto.randomUUID()}`, occurredAt: clockNow(settings.clock, nowMs), actorId: id.self.id, action, entity: "test_data", entityId: null, contractId: null, details,
    });
  };

  let pnr: PnrCrypto;
  try {
    pnr = serverCrypto();
  } catch (e) {
    console.error("testdata", e instanceof PnrKeyError ? e.message : "nycklar");
    return json(503, { code: "not_configured", message: "Nycklarna för personnummer saknas i testmiljön (MM_PNR_KEY och MM_PNR_HMAC_KEY). Inget har ändrats." });
  }

  const started = Date.now();
  try {
    const summary = await loadTestData(s.service as unknown as SeedClient, { crypto: pnr, demoStart: DEMO_START });
    await audit("staging.seed", { rows: summary.rows, tables: summary.tables, seconds: Math.round((Date.now() - started) / 1000) });
    return json(200, { ok: true, rows: summary.rows });
  } catch (e) {
    const step = e instanceof SeedLoadError ? `${e.step} ${e.code}` : e instanceof Error ? e.name : "okänt";
    console.error("testdata-fel", step.replace(/[^\w .-]/g, ""));
    await audit("staging.seed_failed", { step: e instanceof SeedLoadError ? e.step : "okänt", code: e instanceof SeedLoadError ? e.code : "" }).catch(() => undefined);
    return json(500, { code: "server_error", message: "Testdatat kunde inte läsas in. Försök igen – inläsningen börjar alltid med att tömma." });
  }
}
