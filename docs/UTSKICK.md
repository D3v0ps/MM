# Utskick och bakgrundsjobb

*Version 2026-09-30. Gäller supabase-läget (testmiljön och senare produktion). Prototypen och minnesläget sparar utskicken direkt i minnet och skickar inget.*

## Översikt

```
Hanterare ── ctx.notify({ channel, to, template, body, caseId })
                │
                ▼
src/server/notify  enqueueMessage()
   1. sparar utskicket i outbound_messages (status queued) och lägger jobbet send_message i jobs
   2. after(): när svaret har skickats körs jobben direkt – mejlet går iväg inom några sekunder
                │
                ▼
src/server/jobs    runJobs()  ◄── POST /api/jobs/run  ◄── pg_cron i Supabase, varje minut (tar det som blev kvar)
   mm.claim_jobs(n) → spärrar → mall → Resend (EU) → status sent / suppressed / failed
```

- Texten i ett utskick kommer alltid från hanteraren och innehåller bara ärendenummer och "logga in" (CLAUDE.md punkt 9). Mallen ramar bara in texten och lägger till en knapp till portalen.
- All logik körs i Next.js på Vercel (arn1). Supabase anropar bara `/api/jobs/run` – utan personuppgifter.
- Loggarna innehåller aldrig adresser, texter eller personnummer – bara feltyper och antal.

## Statusar i `outbound_messages`

| Status | Betyder | `status_reason` (exempel) |
|---|---|---|
| `queued` | Väntar på att skickas | – |
| `sent` | Lämnat till Resend. `sent_at` och `provider_message_id` (Resends id) sätts | – · `redirected` = testmiljön skickade mejlet till testaren i stället (`MM_EMAIL_REDIRECT_TO`) |
| `suppressed` | Stoppat med avsikt | `Testmiljön: mottagaren finns inte i MM_EMAIL_ALLOWLIST` · `Mottagaren saknar giltig e-postadress` · `SMS-leverantör inte vald` · `Stoppat: texten ser ut att innehålla ett personnummer` |
| `manual` | Brev – skickas för hand | `Brev skickas manuellt` |
| `failed` | Gick inte att skicka efter alla försök, eller Resend avvisade det | `Resend svarade 422 (validation_error)` |

Kanaler:
- **E-post** skickas via Resend.
- **SMS**: ingen leverantör är vald ännu (SPEC §13 punkt 18). Sparas med status `suppressed`.
- **Brev** (kallelse när deltagaren vill ha post): status `manual`.

## Spärren för mottagare (testmiljön)

- Bara adresser i `MM_EMAIL_ALLOWLIST` får mejl. Posterna är hela adresser (`karim.khalil@miljonbemanning.se`) eller domäner (`@miljonbemanning.se`), med kommatecken emellan.
- Spärren gäller **alltid** utom när databasen uttryckligen är produktion (`app_settings.environment = 'production'`) **och** listan är tom. En saknad miljörad räknas alltså som testmiljö – hellre inga mejl än mejl till testdatats adresser på riktiga domäner (t.ex. botkyrka.se).
- Allt som stoppas sparas ändå i `outbound_messages` med status `suppressed` och orsak, så att flödet går att följa.
- Spärren kontrolleras precis innan mejlet skickas. Samma lista styr inloggningskoderna (`src/server/auth`).
- I testmiljön börjar ämnesraden med `[Testmiljö]` och mejlet har en blå rad överst: "TESTMILJÖ – påhittade testdata".

Obs: i testmiljön går de flesta utskick till testpersoner (t.ex. handläggare på botkyrka.se) och stoppas därför. De syns i `outbound_messages`. Testarna får bara mejl som går till deras egna adresser – om inte `MM_EMAIL_REDIRECT_TO` är satt (nästa avsnitt).

Etiketterna för statusarna i adminvyns utskickslogg finns i `src/core/labels.ts` (`OUTBOUND_STATUS_LABEL`, `outboundStatusLabel`, `outboundReasonLabel`).

## Testarna ser appens mejl (`MM_EMAIL_REDIRECT_TO`, bara testmiljön)

- Sätt `MM_EMAIL_REDIRECT_TO` till en testares adress (t.ex. `karim.khalil@miljonbemanning.se`). Adressen måste också finnas i `MM_EMAIL_ALLOWLIST`.
- Mejl som spärrlistan annars skulle ha stoppat (till testpersoner) skickas i stället till den adressen. Status `sent`, orsak `redirected`. `to` i `outbound_messages` är fortfarande testpersonens adress.
- Överst i mejlet står en tydlig rad: "Testmiljö – det här mejlet skulle ha gått till kommunens handläggare på Botkyrka kommun." Raden visar roll och organisation (eller "deltagaren i ärende BOT-27-0049") – aldrig testpersonens adress eller namn. Knappen i mejlet är den mottagaren skulle ha fått (portalen för kommunen, appen för personalen).
- Kontrollen av personnummer och adressformat gäller som vanligt – sådana utskick stoppas, de skickas inte om.
- **Aldrig i produktion:** omdirigeringen gäller bara när `app_settings.environment = 'staging'`. I produktion, och i en databas utan miljörad, ignoreras variabeln. Lämna den tom i produktion.
- Inloggningskoderna påverkas inte (de skickas av Supabase Auth och bara till adresserna i `MM_EMAIL_ALLOWLIST`).

## Svarsadress (`MM_EMAIL_REPLY_TO`)

- Produktion: `avrop@miljonbemanning.se`. Då hamnar svar på ordererkännandet (och andra mejl) i avropsflödet – mejl är kommunens formella beställningskanal (CLAUDE.md punkt 10).
- Testmiljön: tom. Svar går då till avsändaren `notis@miljonbemanning.se`.
- Skickas till Resend som `reply_to`.

## Kontroller före varje mejl

1. Kanal: SMS → `suppressed`, brev → `manual`.
2. Texten och ämnesraden får inte innehålla något som ser ut som ett personnummer eller samordningsnummer (med eller utan sekel och bindestreck, rimligt datum). Annars `suppressed`. Ett tiosiffrigt nummer som ser ut som ett datum stoppas också – hellre ett stoppat utskick än ett personnummer i ett mejl.
3. Mottagaren måste vara en giltig e-postadress (hanterarna skriver ibland "kommunens chef" eller "deltagare (e-post)" när adressen saknas). Annars `suppressed`.
4. Spärrlistan (ovan).

## Mallar

### Appens mejl (`src/server/notify/render.ts`, `templates.ts`)
- Enkel HTML (tabeller, inbäddade stilar) och ren text. Inga bilder, inga spårningspixlar, inga externa typsnitt.
- MB:s profil: antracit sidhuvud med ordmärket MILJONMATCH och röd punkt, rubrik i versaler (ämnesraden), texten i antracit på vitt (16 px), knapp i antracit med vit text, fot på ljusgrått.
- Knappen: Miljonbemannings personal (domänerna i `MM_STAFF_EMAIL_DOMAINS`) → `MM_APP_URL/`, alla andra → `MM_APP_URL/portal`. Deltagaren får ingen länk. Utan `MM_APP_URL` blir det ingen knapp.
- Ämnesraderna kommer från prototypens mallkatalog och innehåller högst ärendenumret:

| Mall | Ämnesrad |
|---|---|
| `ordererkannande` | Vi har tagit emot er beställning – {ärendenummer} |
| `generisk_mottagningsbekraftelse` | Vi har tagit emot ditt mejl · portalvarianten: Vi har tagit emot er beställning |
| `orderbekraftelse` | Orderbekräftelse – {ärendenummer} |
| `ny_rapport` | Ny rapport i portalen |
| `nytt_meddelande` | Nytt meddelande om {ärendenummer} |
| `tilldelning_coach` | Nytt ärende i Miljonmatch |
| `avbojt` | Besked om beställning {ärendenummer} |
| `coachbyte` | Ny huvudcoach för {ärendenummer} |
| `beslut_behovs` | Ärende {ärendenummer} behöver ert beslut |
| `atgardsplan_godkannande` | Åtgärdsplan väntar på ert godkännande |
| `atgardsplan_godkand` | Åtgärdsplan godkänd |
| `paminnelse_progression` | Påminnelse från Miljonmatch |
| `eskalering_chef` | Eskalering i Miljonmatch |
| `inbjudan_kommun` | Inbjudan till Miljonbemannings portal |
| `kallelse` | Kallelse till första möte |
| okänd mall eller saknat ärende | Meddelande från Miljonmatch |

Foten: "Det här mejlet skickades automatiskt från Miljonmatch, Miljonbemanning AB. Skriv inte personnummer eller andra personuppgifter i e-post. Använd ärendenumret."

### Inloggningskoden (`supabase/templates/otp.html`)
Supabase Auth skickar koden själv via Resend (SMTP, se `docs/DRIFT.md` steg 1.2).
- *Authentication → Emails → Templates → Magic link* (och *Confirm signup*): ämne `Din inloggningskod till Miljonmatch`, innehåll = hela filen `supabase/templates/otp.html`.
- Mallen visar bara koden (`{{ .Token }}`), att den gäller i 10 minuter och att man kan strunta i mejlet om man inte bett om en kod. Ingen länk (Safe Links förbrukar länkar).
- Lokalt med Supabase CLI: i `supabase/config.toml`
  ```toml
  [auth.email.template.magic_link]
  subject = "Din inloggningskod till Miljonmatch"
  content_path = "./supabase/templates/otp.html"
  ```

## Miljövariabler

| Namn | Hemlig | Förklaring |
|---|---|---|
| `RESEND_API_KEY` | **ja** | Resends API-nyckel med bara sändrätt för domänen. Saknas den (eller `MM_EMAIL_FROM`) står mejlen kvar i kön och jobbet försöker igen |
| `MM_EMAIL_FROM` | | Avsändare, t.ex. `Miljonmatch <notis@miljonbemanning.se>`. Domänen måste vara verifierad i Resend |
| `MM_APP_URL` | | Appens adress utan `/` på slutet – knappen i mejlen |
| `MM_EMAIL_ALLOWLIST` | | Testmiljön: adresser eller `@domäner` som får mejl. Tom i produktion |
| `MM_EMAIL_REDIRECT_TO` | | Bara testmiljön: testarens adress som får mejlen till testpersoner (måste finnas i `MM_EMAIL_ALLOWLIST`). Ignoreras i produktion |
| `MM_EMAIL_REPLY_TO` | | Svarsadress. Produktion: `avrop@miljonbemanning.se`. Tom i testmiljön |
| `MM_STAFF_EMAIL_DOMAINS` | | Personalens domäner (länk till appen i stället för portalen). Standard `miljonbemanning.se` |
| `MM_JOBS_SECRET` | **ja** | Nyckeln för `/api/jobs/run`, minst 16 tecken. Skapa med `openssl rand -base64 32`. Samma värde läggs i Supabase Vault (nedan) |

## Resend

Konto, domän och DNS: se `docs/DRIFT.md` avsnitt 2. Dessutom:
- *Domains → miljonbemanning.se → Configuration*: stäng av **Click tracking** och **Open tracking**. Spårning skriver om länkarna och lägger in en pixel – det är ett analysverktyg och ska inte användas (CLAUDE.md).
- API-nyckeln för appen: *Sending access*, bara domänen `miljonbemanning.se`.
- Resend hanterar mottagarnas e-postadresser (personuppgifter om kommunens och Miljonbemannings personal). Teckna Resends personuppgiftsbiträdesavtal (DPA) innan produktion.
- Varje mejl skickas med huvudet `Idempotency-Key` = utskickets id. Ett nytt försök med samma utskick inom 24 timmar blir aldrig ett andra mejl.
- Appen pausar 0,5 sekunder mellan mejlen för att hålla sig under Resends gräns för anrop per sekund. Svar 429 (för många anrop eller kvoten slut) försöks igen senare.

## Bakgrundsjobb

- Tabellen `jobs` (supabase/migrations/0009). `mm.claim_jobs(n)` hämtar jobb med `FOR UPDATE SKIP LOCKED`, sätter status `running`, ökar `attempts` och sätter `started_at`. Två körningar tar aldrig samma jobb. Ett jobb som fastnat i `running` i mer än tio minuter (avbruten körning) hämtas igen.
- Lyckat jobb → `done`. Fel som är värda att försöka igen (nätverk, 429, 5xx, saknad konfiguration) → `queued` igen efter 1, 5, 15 och 60 minuter. Efter fem försök, eller vid fel som inte hjälper att försöka igen (t.ex. 422), → `failed`. Felorsaken sparas i `last_error` (och för utskick i `outbound_messages.status_reason`) – bara fasta texter, aldrig Resends feltext eller adresser.
- Jobben är idempotenta: `send_message` skickar bara utskick med status `queued`.
- `POST /api/jobs/run` (skyddad med `Authorization: Bearer <MM_JOBS_SECRET>`) kör högst 20 jobb (`?limit=` 1–50) och slutar hämta nya efter cirka 20 sekunder. Svaret innehåller bara antal:
  ```json
  { "ok": true, "claimed": 2, "done": 2, "retried": 0, "failed": 0, "errors": 0, "outcomes": { "send_message:sent": 1, "send_message:suppressed": 1 } }
  ```
  Svarskoder: 401 fel nyckel · 503 `MM_JOBS_SECRET` saknas · 404 minnesläget.
- Tiden är appens tid: testtid i testmiljön (`app_settings`), riktig Stockholmstid i produktion.

Kör jobben för hand (t.ex. för att testa):
```
curl -X POST -H "Authorization: Bearer $MM_JOBS_SECRET" https://test.miljonmatch.se/api/jobs/run
```

## Schemaläggning: pg_cron + pg_net i Supabase

Vercels gratisnivå (Hobby) kan bara köra cron en gång per dygn. Därför anropar databasen `/api/jobs/run` varje minut med `pg_cron` och `pg_net`. Anropet innehåller inga personuppgifter – bara nyckeln. Allt arbete görs i appen på Vercel (arn1).

Gör så här i *SQL Editor* i Supabase (testmiljön). Hemligheterna skrivs bara in i Supabase – aldrig i repot eller i chatten.

**1. Slå på tilläggen** (*Database → Extensions*: `pg_cron` och `pg_net`), eller:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

**2. Spara adressen och nyckeln i Vault** (byt ut värdena):
```sql
select vault.create_secret('https://test.miljonmatch.se', 'mm_app_url', 'Appens adress för /api/jobs/run');
select vault.create_secret('<samma värde som MM_JOBS_SECRET i Vercel>', 'mm_jobs_secret', 'Nyckel för /api/jobs/run');
```

**3. Schemalägg anropet varje minut:**
```sql
select cron.schedule(
  'mm-jobs-run',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mm_app_url') || '/api/jobs/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mm_jobs_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);
```

**4. Rensa körhistoriken** (pg_cron sparar en rad per körning, 1 440 per dygn):
```sql
select cron.schedule(
  'mm-cron-cleanup',
  '17 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);
```

**5. Kontrollera** efter ett par minuter:
```sql
-- Körningarna i databasen
select status, return_message, start_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'mm-jobs-run') order by start_time desc limit 5;
-- Svaren från appen (sparas i 6 timmar): status_code ska vara 200
select status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5;
```

**Byta adress** (t.ex. när den egna domänen är på plats):
```sql
select vault.update_secret((select id from vault.secrets where name = 'mm_app_url'), 'https://test.miljonmatch.se');
```
Byta nyckel: `vault.update_secret` för `mm_jobs_secret` och samma värde i Vercel (`MM_JOBS_SECRET`), sedan *Redeploy*.

**Stänga av:** `select cron.unschedule('mm-jobs-run');`

Att tänka på:
- pg_cron räknar i UTC. Det spelar ingen roll här – anropet sker varje minut och appen avgör själv vad klockan är (testtid eller Stockholmstid).
- Adressen måste vara Vercels produktionsadress eller den egna domänen. Förhandsversioner (Preview) skyddas av Vercel Authentication och svarar 401 till databasen.
- Produktion får ett eget schema i sitt eget Supabase-projekt, med produktionens adress och en egen nyckel.

## Jobb som kommer senare

Alla körs av samma anrop varje minut. Appen lägger jobben när appens klocka passerar tiden (testtiden i testmiljön), med ett id per period (t.ex. `weekly_report:2027-W05`) så att de aldrig körs två gånger. Tider och regler läses från avtalskonfigurationen och de interna reglerna – de hårdkodas inte.

| Jobb | När | Vad |
|---|---|---|
| Påminnelse om närvaro | Måndag 08.00 (föregående vecka) och fredag (innevarande vecka) | Coacher som inte registrerat all närvaro får en påminnelse |
| Eskalering av närvaro | Måndag 10.00 | Förfallotiden för registrering (`veckorapport_registrering`) – samordnaren får en flagga |
| Veckorapport | Måndag 16.00 | Publicera veckorapporterna till kommunen (`veckorapport_publicering`) och skicka "Ny rapport" |
| Progressionsbevakning | Enligt interna regler (`reminderSchedule`, i dag måndag 08.00) | Påminnelse till coachen (`paminnelse_progression`), eskalering till chef efter två veckor i rad (`eskalering_chef`) |
| Mejlinläsning från avrop@ | Var 2–5 minut | Hämta nya avrop via Microsoft Graph, ordererkännande inom 5 minuter |
| Mötespåminnelse och pulslänk | Dagen före kl. 18.00 · enligt avtalets pulsmätning | SMS – när en SMS-leverantör är vald |
| Gallring | Varje natt | Ljud (senast 24 timmar), råtranskript (30 dagar), gamla `login_attempts`, avslutade jobb, utskickslogg enligt gallringsreglerna |

## Kontrollera utskicken

```sql
-- Senaste utskicken (status och orsak)
select created_at, channel, template, status, status_reason, sent_at from outbound_messages order by created_at desc limit 20;
-- Jobben
select kind, status, attempts, run_after, last_error from jobs order by created_at desc limit 20;
```
I Resend: *Emails* visar varje mejl som skickats och om det levererats.

## Felsökning

| Problem | Kontrollera |
|---|---|
| Inga mejl alls, utskicken står som `queued` | `RESEND_API_KEY` och `MM_EMAIL_FROM` i Vercel, `jobs.last_error`, att pg_cron-jobbet körs (`net._http_response`) |
| Status `suppressed` med "finns inte i MM_EMAIL_ALLOWLIST" | Så ska det vara i testmiljön för alla utom testarna |
| `failed` med "Resend svarade 403 (validation_error)" | Domänen i `MM_EMAIL_FROM` är inte verifierad i Resend |
| `failed` med "Resend svarade 401 …" | Fel eller spärrad API-nyckel |
| `net._http_response` visar 401 | Nyckeln i Vault och `MM_JOBS_SECRET` i Vercel är olika – eller adressen pekar på en skyddad förhandsversion |
| `net._http_response` visar 503 | `MM_JOBS_SECRET` saknas i Vercel eller är kortare än 16 tecken |
| Mejlet hamnar i skräpposten | SPF, DKIM och DMARC för `send.miljonbemanning.se` (Resend → *Domains* ska visa *Verified*) |

## Kod

| Del | Fil |
|---|---|
| Lägga i kön (`ctx.notify`) och köra direkt med `after()` | `src/server/notify/index.ts`, `queue.ts` |
| Spärrar och personnummerkontroll | `src/server/notify/decision.ts`, `personnummer.ts` |
| Mallen och ämnesraderna | `src/server/notify/render.ts`, `templates.ts` |
| Resend | `src/server/notify/resend.ts` |
| Sändningen (jobbet `send_message`) | `src/server/notify/sender.ts` |
| Jobbkörningen, försök och väntetider | `src/server/jobs/runner.ts`, `registry.ts`, `store.ts`, `live.ts` |
| `POST /api/jobs/run` | `src/app/api/jobs/run/route.ts`, `src/server/jobs/auth.ts` |
| Tester | `src/server/notify/notify.test.ts`, `src/server/jobs/jobs.test.ts`, `src/server/jobs/db.test.ts` (mot migrationerna i PGlite) |
