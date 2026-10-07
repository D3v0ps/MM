# AI och röstinspelning – hur det fungerar

*Version 2026-09-30. Bygger på SPEC §8 och beslutet i `docs/PLAN-ROST.md`: Gemini Flash via Google Cloud Vertex AI, EU multi-region-endpoint. Tills kontot i Google Cloud finns kör testmiljön en simulerad leverantör. Driftsättningen (Google Cloud, nycklar, Vercel) står i `docs/DRIFT.md` avsnitt 10.*

## Kort

- **AI föreslår – människan bedömer.** AI transkriberar, föreslår text med belägg (citat + tidpunkt) och skriver utkast. AI sätter aldrig progressionsnivå, samlad status, avslutsorsak eller resultat – de fälten finns inte i något AI-schema, och ett svar som innehåller dem underkänns.
- **Aldrig för skyddade personuppgifter, aldrig coachens inspelning utan samtycke.** Kontrolleras när inspelningen startar, när jobbet läggs och igen när jobbet körs (samtycket kan ha återkallats under tiden).
- **Ljud raderas direkt efter lyckad transkribering** – senast efter 24 timmar om något gick fel. **Råtranskript raderas när avstämningen godkänts**, senast efter 30 dagar. Kommunens dikterade text finns kvar högst 24 timmar i systemet (tills handläggaren skickat sin text).
- **Rapporter byggs bara av godkända uppgifter.** Månadens AI-utkast skrivs bara från godkända avstämningar och registrerad närvaro.
- **Bara EU.** Adaptern vägrar allt utom `aiplatform.eu.rep.googleapis.com` med location `eu`. Aldrig AI Studio-nyckel (Gemini API) och aldrig global endpoint.
- **Allt syns:** varje körning i `ai_runs` (leverantör, modell, tid, token, kostnad), varje beslut i `ai_field_decisions`, varje radering och körning i revisionsloggen. Utkast märks "AI-förslag"/"AI-utkast" tills de godkänts.

## De tre flödena

| | Vem | Vad händer | Vad sparas |
|---|---|---|---|
| **1. Veckoavstämningen** | Coachen (huvudcoach i ärendet) | Spelar in samtalet eller laddar upp en ljudfil → jobbet `transcribe_recording`: transkribering → **ljudet raderas** → förslag till avstämningsformuläret med belägg → coachen ändrar och godkänner | Förslagen och transkriptet i `ai_runs.output` (och i avstämningsutkastet `check_ins.ai`). Transkriptet raderas när avstämningen godkänts, senast efter 30 dagar. Kvar blir det godkända |
| **1b. Månadsbedömningen** | Coachen | "Skapa AI-utkast från godkända avstämningar" → jobbet `draft_monthly`: ett utkast per progressionsområde, sammanfattning och plan, med källor ("Avstämning 22 jan", "Närvaroregistrering") | Utkasten i `monthly_assessments` (`areas[..].aiObservationDraft`, `aiSummaryDraft`) och i `ai_runs.output`. Nivåerna väljer coachen själv |
| **2. "Tala in"** | Kommunens handläggare | Talar in beställningens bakgrund eller ett meddelande → jobbet `transcribe_dictation`: transkribering → **ljudet raderas** → texten tillbaka i fältet → handläggaren läser, rättar och skickar | Bara texten handläggaren skickar. Den transkriberade texten ligger i `ai_runs.output` högst 24 timmar |
| **3. Deltagarens röstmeddelande** | Deltagaren via länken `/rost/:token` (ingen inloggning) | Samtycke i länken → inspelning på sitt språk → jobbet `transcribe_participant`: transkribering → **ljudet raderas** → översättning till svenska → coachen granskar texten som underlag | Texten i `participant_voice_notes` (svenska + originalspråket), samtyckestextens version och tid. Inget ljud |

Varje del kan slås av per avtal: `contracts.config.ai.recording` (`coach`, `customer`, `participant`), med kommunens godkännande (`approvedByCustomerOn`), längsta inspelning (`maxMinutes`), språk (`languages`) och länkens giltighet (`participantLinkValidDays`). Botkyrka: allt på (godkänt 2026-09-30). Ett avtal utan avsnittet `ai` har allt avstängt.

## Tekniken

```
Webbläsaren ── startAudioUpload (kommando eller POST /api/audio/upload-url) ──► audio_uploads (pending) + signerad adress
     │
     └── PUT ljudfilen direkt till Supabase Storage, bucketen "ljud" (privat, Stockholm) – inte via Vercel (max 4,5 MB)
     │
     └── confirmOwnUpload + enqueueVoiceJob (kommando) ──► ai_runs (running) + jobs (queued)
                                                              │
               after() direkt efter svaret, annars cron varje minut (POST /api/jobs/run)
                                                              ▼
            runVoiceJob (service role): ljudet läses → ctx.ai.transcribe → ljudet raderas → extract/translate → resultatet sparas
```

- **Samma kod i alla körlägen.** Logiken finns i `src/features/_shared/voice-upload.ts` (vem får spela in vad) och `src/features/_shared/voice-jobs.ts` (jobben). I minnesläget och prototypen körs jobbet direkt i kommandot (simulerad AI, ljud i minnet). I supabase-läget läggs det i tabellen `jobs` och körs av `src/server/jobs` (nya försök vid tillfälliga fel).
- **Portarna:** hanterare och jobb når AI bara via `ctx.ai` (`transcribe`, `extract`, `draft`, `translate` – `src/features/_shared/ai-port.ts`) och ljudet bara via `ctx.audio` (`createUpload`, `confirm`, `read`, `mark`, `remove` – `src/features/_shared/audio-port.ts`). På servern: `src/server/ai` (Vertex AI eller simulerad) och `src/server/audio` (Supabase Storage).
- **Leverantören** väljs med `MM_AI_PROVIDER`: `vertex`, `simulated` eller `off`. Tomt = `simulated` i testmiljön och `off` i produktion. Produktion kör **aldrig** den simulerade leverantören (påhittade transkript får aldrig bli dokumentation). Är AI avstängd eller fel inställd gäller den manuella vägen – inga filer tas emot.

### Vertex AI-adaptern (`src/server/ai/vertex.ts`)

- Adress: `https://aiplatform.eu.rep.googleapis.com/v1/projects/{GOOGLE_VERTEX_PROJECT}/locations/eu/publishers/google/models/{MM_AI_MODEL}:generateContent`. `config.ts` stoppar allt annat (AI Studio, global, regionala endpoints, fel location). `GOOGLE_VERTEX_LOCATION` får bara vara `eu`.
- Inloggning: tjänstekontots JSON-nyckel (`GOOGLE_SERVICE_ACCOUNT_KEY`, base64) → JWT signerat med RS256 → åtkomsttoken från `oauth2.googleapis.com` (fast adress, cachas tills fem minuter före utgången).
- `transcribe`: ljudet inline som base64 (hela anropet högst 20 MB, det vill säga cirka 15 MB ljud ≈ en timme i 32 kbit/s) och instruktionen att transkribera ordagrant med talare och tider. Svaret: språk + segment; hela texten byggs av segmenten.
- `extract`: transkriptet med tider (`[96] Deltagare: …`) + SPEC §8.3:s instruktioner (`AI_CORE_INSTRUCTIONS`, `EXTRACT_INSTRUCTIONS`) + formulärets regler och tillåtna värden (aktiviteter, hinder, typ av arbetsgivarkontakt).
- `draft`: bara godkända avstämningar och närvaro som JSON (inga namn). Modellen anger vilka avstämningar texten bygger på; källornas namn sätter appen. Utan underlag görs inget anrop ("Framgår inte").
- `translate`: deltagarens text till svenska – troget, utan tillägg.
- Svaren är JSON enligt ett svarsschema och **valideras sedan mot appens zod-scheman** (`TranscriptSchema`, `CheckInExtractSchema`, `DraftTextSchema`, `TranslationSchema`). Ogiltigt svar försöks en gång till; blir även det ogiltigt sparas körningen som misslyckad (`invalid_response`) och svaret visas aldrig.
- **Påhittade belägg:** ett citat som inte finns i transkriptet räknas som saknat belägg och visas som "Framgår inte" (`checkEvidence` i `voice-jobs.ts`, fälten noteras i `ai_runs.evidence.unverifiedQuotes`).
- Lägsta rimliga resonemangsnivå: Gemini 2.5 Flash `thinkingBudget: 0`, nyare modeller `thinkingLevel` MINIMAL (transkribering) och LOW (övrigt). Kan ändras med `MM_AI_THINKING`.
- Nya försök: 429, 5xx och nätverksfel försöks en gång direkt (efter 1,5 sekunder); sedan läggs jobbet tillbaka i kön (efter 1, 5, 15 och 60 minuter, högst fem försök). Fel inställning (400/403/404, fel nyckel) försöks inte igen.
- Kostnad: token från svaret (`usageMetadata`: ljud in, text in, ut inklusive resonemang) gånger prislistan i `MM_AI_PRICES` (öre per miljon token), avrundat uppåt till hela öre.

## Radering (gallring)

| Vad | Var | Raderas | Hur |
|---|---|---|---|
| Ljudfilen | Bucketen `ljud` (spåret i `audio_uploads`: läge, storlek, tider – aldrig innehåll) | **Direkt** efter lyckad transkribering. Vid fel eller avbruten uppladdning senast efter 24 timmar | Jobbet (`deleteAudio`) · `retention_audio` varje timme raderar allt som är 23–24 timmar gammalt och inte raderat. En körning som fortfarande väntar avslutas som misslyckad (`audio_expired`) |
| Råtranskriptet (coachens samtal) | `check_ins.ai.transcript`, `ai_runs.output.transcript` | När avstämningen godkänts, senast efter 30 dagar | `checkinSave` vid godkännandet · `retention_transcripts` varje timme |
| Transkript för nya försök | `ai_runs.output.pending` | När körningen blir klar eller misslyckas, senast efter 24 timmar | Jobbet · `retention_transcripts` |
| Kommunens dikterade text | `ai_runs.output.text` | Efter 24 timmar | `retention_transcripts` |
| Deltagarens text | `participant_voice_notes` | Enligt avtalets gallringsregler (som övrig dokumentation) | – |
| Förslag och utkast | `ai_runs.output`, `check_ins.ai`, `monthly_assessments` | Förslagen ersätts av det godkända; körningens mätvärden finns kvar | – |

Gallringsjobben läggs automatiskt en gång per timme (`ensureRetentionJobs` i `src/server/jobs/voice.ts`, id `job-retention_audio-<datum>T<timme>`) av varje jobbkörning.

## Vad som loggas

- **`ai_runs`:** typ (`transcribe_extract`, `transcribe_dictation`, `transcribe_participant`, `monthly_draft`), leverantör (`vertex_eu` eller `simulated`), modell, underlaget (`input_ref` = ljudfilens id eller månaden), status, tid (ms), token in/ut, ljudets längd, kostnad i öre, när ljudet raderades. Vid fel bara felkoden (`output.error`).
- **Revisionsloggen (`audit_log`):** `audio.upload_started`, `audio.deleted` (med orsak), `ai.run`, `ai.run_failed` (felkod), `transcript.deleted`, `retention.transcripts` – bara id:n och fasta texter.
- **`jobs.last_error`:** fasta texter ("AI-tjänsten svarar inte just nu …"). Aldrig transkript, citat eller namn.
- **Serverns logg:** bara feltyp och steg (t.ex. `AiProviderError config (MM_AI_MODEL saknas)`). Aldrig ljud, text, token eller nycklar.
- **Adresser:** sökvägen i bucketen är bara syfte och id (`checkin/aud-….webm`). Inga personuppgifter i URL:er.

## För utvecklare

| Funktion | Fil | Används av |
|---|---|---|
| `startAudioUpload(ctx, req)` → `{ ticket, maxMinutes, languages }` | `src/features/_shared/voice-upload.ts` | kommandot för att börja en uppladdning, `POST /api/audio/upload-url` |
| `confirmOwnUpload(ctx, { uploadId, token?, durationSec? })` | samma | kommandot efter uppladdningen (bara den egna, deltagarens bara i länkens ärende) |
| `voiceLinkByToken(ctx, token)` | samma | deltagarens sida `/rost/:token` |
| `enqueueVoiceJob(ctx, req)` → `{ jobId, aiRunId, status, error }` | `src/features/_shared/voice-jobs.ts` | kommandona (minnesläget kör direkt, servern köar) |
| `voiceRunState(run)`, `aiRunError(run)`, `ownDictation(ctx, aiRunId)` | samma | frågorna som visar läget och dikteringens text |
| Jobben i kön, gallringen per timme | `src/server/jobs/voice.ts`, `registry.ts`, `live.ts`, `schedule.ts` | `runDueJobs` (cron och after()) |
| Adaptern, inställningar, inloggning mot Google | `src/server/ai/*` | `ctx.ai` på servern |
| Ljudlagringen | `src/server/audio/*` | `ctx.audio` på servern |

Uppladdningen från webbläsaren (appen): `fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": <grundtypen, t.ex. audio/webm>, "x-upsert": "false" }, body: blob })`. Minnesläget och prototypen har ingen adress (`uploadUrl: null`) – anropa bekräftelsen direkt.

Tester: `src/features/_shared/voice-jobs.test.ts`, `voice-upload.test.ts`, `src/server/ai/*.test.ts`, `src/server/audio/storage.test.ts`, `src/server/jobs/voice.test.ts`, `src/server/jobs/voice-db.test.ts` (mot migrationerna i PGlite), `src/app/api/audio/upload-url/route.test.ts`. Inga tester gör riktiga anrop till Google.
