// POST /api/audio/upload-url – signerad uppladdningsadress för en ljudfil (röstinspelningen, docs/AI.md).
// Bara för inloggade med rätt roll i rätt ärende (coachen: veckoavstämningen, kommunens handläggare: "Tala in") och för en
// giltig röstlänk (deltagaren: { purpose: "participant", token }). Samma kontroller som kommandona i appen:
// startAudioUpload (src/features/_shared/voice-upload.ts) – avtalet, samtycket, aldrig skyddade personuppgifter.
// Webbläsaren laddar sedan upp filen direkt till Supabase Storage (PUT till uploadUrl) – Vercels funktioner tar högst 4,5 MB.
// Svaret har samma form som ett kommando: { ok: true, ticket, maxMinutes, languages } eller { ok: false, error, message }.
// Inga personuppgifter i adressen, svaret eller loggen (bara id:n). Bara i supabase-läget – minnesläget har inga filer
// (prototypen och utvecklingsläget använder kommandot, där ticket.uploadUrl är null).
import { ApiError } from "@/api/server";
import { AudioUploadRequestSchema, startAudioUpload } from "@/features/_shared/voice-upload";
import { backend } from "@/server/config";
import { ctxFor, liveSession } from "@/server/live";

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const STATUS: Record<string, number> = { not_found: 404, forbidden: 403, protected: 403, no_consent: 403, disabled: 403, ai_unavailable: 503 };

export async function POST(request: Request) {
  if (backend() !== "supabase") {
    return json(404, { ok: false, error: "not_available", message: "Uppladdningsadresser finns bara i supabase-läget. I minnesläget sparas ljudet i minnet." });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json", message: "Ogiltig begäran." });
  }
  const parsed = AudioUploadRequestSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, error: "invalid_input", message: "Ogiltiga uppgifter." });
  const req = parsed.data;
  try {
    const s = await liveSession();
    if (s.authUserId && !s.identity) return json(403, { ok: false, error: "no_access", message: "Ditt konto har inte tillgång till Miljonmatch. Kontakta den som bjöd in dig." });
    // Coachens och kommunens inspelning kräver inloggning. Deltagarens länk är behörigheten i sig.
    if (req.purpose !== "participant" && !s.identity) return json(401, { ok: false, error: "unauthenticated", message: "Du är inte inloggad." });
    const r = await startAudioUpload(ctxFor(s), req);
    if (!r.ok) return json(STATUS[r.error] ?? 400, r);
    return json(200, r);
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, { ok: false, error: e.code, message: e.message });
    // Bara feltypen – aldrig indata.
    console.error("audio-upload-url-fel", e instanceof Error ? e.name : "okänt");
    return json(500, { ok: false, error: "server_error", message: "Något gick fel. Försök igen." });
  }
}
