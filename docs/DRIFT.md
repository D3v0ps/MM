# Drift – skarp drift sedan 2026-10-08 (och hur en testmiljö sätts upp)

*Version 2026-10-08. Miljön på www.miljonmatch.se är produktion sedan 2026-10-08 (avsnittet "Skarp drift" nedan). Avsnitten om testmiljön längre ned beskriver hur den sattes upp och hur en ny testmiljö (test.miljonmatch.se) sätts upp senare – de rörs inte i den här versionen.*

## Skarp drift sedan 2026-10-08

**Beslut (Karim 2026-10-08):** samma Supabase-projekt (`blxupsebzzhmjitaywev`, eu-north-1) och samma Vercel-projekt blir skarp drift – inget nytt projekt. Testdatat är borttaget, kollegorna är vanliga användare och riktiga deltagare registreras som ärenden. En ny testmiljö på `test.miljonmatch.se` sätts upp senare (`docs/MILJOER.md`).

### Vad som gäller nu

- **Miljön är produktion:** `app_settings.environment = production` (`scratchpad/skarp-drift.sql`, körd av Karim). Då finns ingen testarfunktion: inget "Agera som", inget "Läs in testdata", ingen "Lämna synpunkt", ingen testmärkning i mejlen, riktig tid (`MM_CLOCK=real`). Testkoden ligger kvar i repot men är avstängd och tas bort i en senare omgång tillsammans med den nya testmiljön.
- **Tomt är normalt:** appen fungerar utan ett enda ärende – Min vecka för alla roller, listorna, ledningsvyn, fakturakörningen, rapporterna och portalen visar tomma tillstånd i klarspråk. Samma läge går att köra lokalt med `MM_BACKEND=memory MM_SEED=empty npm run dev` (bara avtalet, konfigurationen och de sju kollegorna, riktig tid) och prövas av e2e-projektet `tom` (`tests/e2e/tom.spec.ts`).
- **AI är av** tills Google Cloud är kopplat (`MM_AI_PROVIDER` tom = av i produktion, avsnitt 10). Inspelning, diktering ("Tala in"), AI-förslag och AI-utkast visar "Tal till text är inte kopplat ännu – skriv själv så länge." Inspelningslänkar kan inte skickas. Ingen simulerad text visas någonsin i produktion. Integrationskortet AI på `/admin/integrationer` säger "Inte kopplad".
- **Prislistan** har exempelpriser (`exampleOnly`) tills Karim lämnar de riktiga.
- **Mejl:** `MM_EMAIL_ALLOWLIST=@miljonbemanning.se` så länge bara kollegorna är inne – inget mejl lämnar bolaget. Kodmejl och notiser går bara till adresser på den domänen.

### Vercel → Settings → Environment Variables (Production), sedan Deployments → Redeploy

| Variabel | Värde |
|---|---|
| `MM_CLOCK` | `real` |
| `MM_EMAIL_ALLOWLIST` | `@miljonbemanning.se` – ingen adress utanför domänen får mejl, inte ens kodmejl. När Botkyrka ska börja: `@miljonbemanning.se,@botkyrka.se`, eller tom lista (då stoppas inte längre något mejl) |
| `MM_EMAIL_REDIRECT_TO` | *(tom)* |
| `MM_EMAIL_REPLY_TO` | `avrop@miljonbemanning.se` |
| `MM_AI_PROVIDER` | *(tom)* = AI av. `vertex` när Google Cloud är kopplat (avsnitt 10) |
| `MM_STAFF_EMAIL_DOMAINS` | `miljonbemanning.se` (standard) – domänen kollegornas adresser måste ha i "Lägg till kollega" och vid inloggning |
| `MM_SMS_PROVIDER`, `ELKS_API_USERNAME`, `ELKS_API_PASSWORD`, `MM_CALL_FROM`, `MM_CALL_AUDIO_URL` | *(tomma)* = inga SMS eller samtal till deltagare tills biträdesavtalet med 46elks finns och Botkyrka godkänt underbiträdet (avsnitt 13) |

Ta bort Supabase-variablerna för *Preview*, så att förhandsversioner av kod aldrig når den skarpa databasen (de kör då i minnesläget med påhittade data).

### Migration 0027 (rollväxling) – körs av Karim

`supabase/migrations/0027_rollval.sql` i *SQL Editor* (hela filen, en gång – den tål att köras igen): tabellen `role_choices` (den valda rollen för den som har flera), `mm.current_role()` följer valet, och administratören får ta bort medlemskap ("Ändra roller"). Kontroll: `select * from public.role_choices;` fungerar och `select public.current_actor();` svarar som inloggad. Utan 0027 fungerar allt som förut, utom rollväljaren (kommandot `session.vaxlaRoll` ger då ett fel i sidopanelen) och "Ändra roller" när en roll ska tas bort.

### Migration 0030 (gruppaktiviteter och automatisk närvaro) – körs FÖRE koden

`supabase/migrations/0030_gruppaktiviteter.sql` i *SQL Editor* (hela filen – den tål att köras igen, t.ex. om en körning avbröts): tabellen `group_activities`, `activities.group_activity_id` med en unik nyckel per deltagare och gruppaktivitet, borttagning av tillfällen utan närvaro (`activities_delete`) och `attendance.source` (`manual`/`auto`).

**Driftordning:** 0030 ska vara applicerad **innan** koden med gruppaktiviteterna (spår A, coachmötet 2026-10-09) driftsätts. Koden skriver `attendance.source` vid varje närvaroregistrering och `activities.group_activity_id` vid varje nytt tillfälle (Starta insatsen, Lägg till tillfälle, Ny praktik, ändrad veckoplan). Utan kolumnerna avvisar databasen skrivningen, och då slutar närvaroregistreringen och tillfällena att fungera.

Kontroll efteråt (som inloggad eller i SQL Editor): `select source from public.attendance limit 1;` och `select group_activity_id from public.activities limit 1;` fungerar, `select count(*) from public.group_activities;` svarar 0, och `select indexname from pg_indexes where indexname = 'activities_group_activity_case_key';` ger en rad.

### Så läggs kollegor till (ingen SQL)

1. Logga in som systemadministratör (Karim eller Ali) → **Användare och roller** (`/admin/anvandare`) → **Lägg till kollega**.
2. Namn, e-postadress på jobbet (domänen i `MM_STAFF_EMAIL_DOMAINS` – inte en privat adress), en eller flera roller (systemadministratör, avtalsansvarig, samordnare, huvudcoach, handledare, chef och controller, ekonom), titel valfritt.
3. Kollegan får ett mejl utan personuppgifter med knappen "Logga in i Miljonmatch" och loggar in med e-post och engångskod (`/logga-in`). Rollerna ändras när som helst med **Ändra roller**; **Spärra** stänger inloggningen (aktivera igen med **Aktivera**). Den egna adminrollen kan inte tas bort och man kan inte spärra sig själv.
4. Den som har flera roller väljer roll i sidopanelen under sitt namn (**Roll**). Valet sparas (`role_choices`) och gäller tills det ändras. Revisionsloggen får `staff_user.added`, `staff_user.roles_changed`, `staff_user.blocked`, `staff_user.reactivated` och `role.switched` – bara id:n och roller.
5. **Avtalsansvarig** för Botkyrkaavtalet är Ali (`contracts.contract_manager_id`). Systemadministratören kan byta på avtalssidan (`/admin/avtal`, Avtalsfakta → Avtalsansvarig → Ändra) bland kollegor som har rollen avtalsansvarig.

De sju första kontona (Karim, Ali, Sara, Adam, Shafik, Moda, Yacine) finns redan – alla är systemadministratörer tills rollerna ändras i appen; Ali är också avtalsansvarig.

### Så släpps Botkyrka in

1. Botkyrkas handläggare skapar sina konton själva med en adress på `@botkyrka.se` (`contracts.config.selfRegistration`, `/portal/logga-in`) – eller bjuds in under Användare och roller → Bjud in kommunanvändare. Kodmejlet når dem inte förrän domänen finns i `MM_EMAIL_ALLOWLIST`: sätt `@miljonbemanning.se,@botkyrka.se` i Vercel (eller töm listan – då stoppas inte längre något mejl) och driftsätt igen. Kallelsen med e-post till deltagarnas egna adresser går först när listan är tom (avsnitt 13) – tills dess räknas e-posten inte som kanal och samordnaren får en uppgift i Min vecka att ringa deltagaren.
2. **Innan riktiga personuppgifter:** personuppgiftsbiträdesavtal (DPA) med underbiträdena – Supabase, Vercel, Resend (och Google Cloud när AI kopplas, Microsoft för avrop@, 46elks när SMS och utringning kopplas – avsnitt 13) – ska vara tecknade och stå i PUB-avtalets förteckning (SPEC §3.1, `/admin/integrationer`). Bara administratörer i Resend (kodmejlen syns där, avsnitt 4.1).
3. Kontrollera att MFA och minst två administratörer finns i Vercel, Supabase och Resend, och att bucketarna `ljud` och `bilagor` är privata.

## Översikt

```
Webbläsaren ──► Vercel (Next.js, funktioner i Stockholm, arn1) ──► Supabase (Postgres + inloggning, Stockholm, eu-north-1)
                        │
                        └──► Resend (e-post, EU): appens notiser OCH inloggningskoden. Appen tar fram koden hos Supabase Auth
                             (generateLink) och skickar mejlet själv – Supabase Auth skickar inga mejl (beslut 2026-10-02)

Appens adress:  https://www.miljonmatch.se (testmiljön just nu – miljonmatch.se skickas vidare dit). När produktionen
                startar: produktionen på miljonmatch.se, testmiljön på test.miljonmatch.se (SPEC §11, beslut 2026-10-01).
                DNS för miljonmatch.se hos one.com (A-post och www-CNAME mot Vercel).
E-post från:    notis@miljonmatch.se ("Miljonmatch") via Resend (EU). DNS för miljonmatch.se hos one.com (beslut 2026-10-01).
                Svarsadress i produktion: avrop@miljonbemanning.se (MM_EMAIL_REPLY_TO).
```

- Webbläsaren pratar **bara** med Vercel. Supabase-nycklarna och nycklarna för personnummer finns bara på servern.
- Inloggning: e-post + sexsiffrig kod (SPEC §4). Koden gäller 10 minuter och får prövas 5 gånger. Man loggas ut efter 60 minuter utan aktivitet och alltid efter 12 timmar. Microsoft-inloggning för personalen kommer senare.
- Testmiljön kör på **testtid**: klockan börjar på måndag 1 februari 2027 kl. 09.12 när testdatat läses in och går sedan i vanlig takt.
- I testmiljön får **bara** adresserna i `MM_EMAIL_ALLOWLIST` (testarna) mejl – även inloggningskoder. Testdatat innehåller adresser på riktiga domäner (t.ex. botkyrka.se) som aldrig får få mejl. Med `MM_EMAIL_REDIRECT_TO` går testpersonernas mejl i stället till en testare, märkta med vem de skulle ha gått till.
- Testarna (sju personer på Miljonbemanning, avsnitt 11) loggar in som sig själva och väljer sedan vilken testperson de agerar som i raden överst ("Agera som"). Där finns också **Lämna synpunkt** och **Alla synpunkter**. Det fungerar bara i testmiljön.

## Läget 2026-10-01

| Del | Status |
|---|---|
| Supabase-projekt för testmiljön | Klart: `miljonmatch`, ref **`blxupsebzzhmjitaywev`**, eu-north-1 (Stockholm), `https://blxupsebzzhmjitaywev.supabase.co` |
| Migrationer 0001–0017 | 0001–0016 applicerade i testprojektet av samordnaren (i 0016 görs `drop index` för hand). **0017 (synpunkter i testmiljön) appliceras av samordnaren samtidigt som koden med "Lämna synpunkt" går live** (steg 1 nedan) |
| Migrationer 0023–0026 (beslut 2026-10-07) | **Skrivna, inte applicerade.** De appliceras tillsammans, i nummerordning, när båda omgångarna med synpunkterna från 2026-10-06 är sammanfogade – och i samma veva som koden (avsnitt 1.4) |
| Migration 0030 (coachmötet 2026-10-09) | **Skriven, inte applicerad.** Gruppaktiviteter och automatisk närvaro. Appliceras i SQL Editor **före** koden från spår A (se "Migration 0030" ovan) – koden skriver de nya kolumnerna vid varje närvaroregistrering och varje nytt tillfälle |
| Migration 0028 (beslut 4c, 2026-10-08) | **Skriven, inte applicerad.** `case_attachments.uploaded_by` får vara `system` (bilagor ur inlästa mejl). Appliceras i SQL Editor tillsammans med 0027 före koden med mejlinläsningen (avsnitt 12) |
| Startdata och testdata | Inte inlästa. Startdatat (`supabase/bootstrap-staging.sql`) körs av samordnaren, resten läser testaren in i appen |
| Supabase Auth | Inställt: självregistrering av, e-postkod med 6 siffror som gäller 10 minuter. **Supabase Auth skickar inga mejl längre** – appen tar fram koden och skickar den via Resend (beslut 2026-10-02, avsnitt 2.1). SMTP-inställningen ligger kvar som reserv. **Kontrollera URL:erna** (avsnitt 2.2): *Site URL* `https://www.miljonmatch.se` |
| Resend | Domänen **`miljonmatch.se`** verifierad i EU (beslut 2026-10-01), DNS-posterna hos one.com. Avsändare `notis@miljonmatch.se`. Resend skickar inte längre från `miljonbemanning.se` (avsnitt 4.2) |
| Vercel | Projektet `miljonmatch` (avsnitt 3). Bolaget behöver **Pro** (Hobby får inte användas kommersiellt) – koden driftsätts ändå på båda nivåerna (`maxDuration` högst 60 sekunder) |
| Domän `miljonmatch.se` | Pekar mot Vercel. `miljonmatch.se` skickas vidare till `www.miljonmatch.se`, som är appens adress (`MM_APP_URL`, avsnitt 3.4) |
| AI (Gemini via Vertex AI, EU) | Inte uppsatt – testmiljön kör den simulerade leverantören tills kontot finns (avsnitt 10). Bucketen `ljud` skapas av migration 0015 |

## Vem gör vad

| Steg | Vem | Varför |
|---|---|---|
| Konton hos Vercel, Resend (och Supabase-projektet i bolagets organisation) | Du | Kontona ska ägas av Miljonbemanning AB, med MFA och minst två administratörer |
| DNS-poster för miljonmatch.se hos one.com (Vercel och Resend) | Du | Kräver inloggning hos one.com |
| Nycklar (Supabase secret key, Resend-nyckel, nycklar för personnummer och jobb) in i Vercel | Du | Hemliga nycklar ska aldrig skrivas i chatten eller i repot |
| Migrationer och startdata i databasen | Samordnaren (Claude via Supabase-kopplingen) eller du | Kan göras med MCP, Supabase CLI eller SQL-editorn |
| Testdatat | Testaren i appen (`/admin/integrationer` → "Läs in testdata på nytt") | Filen med hela testdatat är för stor för MCP och SQL-editorn |
| Google Cloud-projekt, tjänstekonto och nyckel för AI (Vertex AI) | Du | Kontot ska ägas av Miljonbemanning AB; nyckeln är hemlig (avsnitt 10) |

---

## Så startar du testmiljön – exakt ordning

1. **Migrationerna 0001–0017** – samordnaren: 0001–0016 är redan applicerade i testprojektet; **0017_synpunkter** appliceras i samma veva som koden med "Lämna synpunkt" går live (MCP `apply_migration` med namnet utan `.sql`, `0017_synpunkter` – eller `npx supabase db push`, eller SQL-editorn). Kontroll: MCP `list_migrations` visar 0001–0017, och `select count(*) from public.feedback;` fungerar. (Ny testmiljö: 0001–0017 i nummerordning. Före 0016: `select invite_id, count(*) from public.pulse_responses group by invite_id having count(*) > 1;` ska ge noll rader.)
   **0013 måste gå live samtidigt som koden.** Efter 0013 läser appen ärenden via vyn `cases_public`, och inloggade kan bara läsa kolumnen `id` direkt i `cases`. En version av appen från före 0013 kan då inte läsa ärenden, och den här versionen fungerar inte utan 0013. Driftsätt därför koden (steg 4) i samma veva som 0013 – aldrig en äldre version mot databasen.
2. **Vercel-import** – du: *Add New → Project → Import* GitHub-repot `miljonmatch` i bolagets team (Pro). Avsnitt 3.1.
3. **Miljövariabler** – du: lägg in alla variabler i tabellen i avsnitt 5 (för *Production* och *Preview*). Skapa de hemliga nycklarna enligt tabellen.
4. **Deploy** – du: *Deployments → Redeploy* (eller första driftsättningen efter importen). Kontrollera att funktionerna körs i **arn1**.
5. **URL:erna i Supabase Auth** – du: *Site URL* = `https://www.miljonmatch.se` (adressen som inte skickas vidare) och *Redirect URLs* enligt avsnitt 2.2. Sätt `MM_APP_URL` till samma adress (`https://www.miljonmatch.se`) och driftsätt igen om du ändrade den.
6. **Startdata** – samordnaren: kör `supabase/bootstrap-staging.sql` (ca 18 kB) med MCP `execute_sql` (eller SQL-editorn). Den lägger in organisationer, avtal, avtalsområden, prislistor, helgdagar, de sju testarna (admin, testare – avsnitt 11) och `app_settings` (`environment = staging`, testklockan). Den kan köras igen (även i en testmiljö som redan används – den tömmer ingenting och behåller inloggningarna) och stoppar sig själv utanför testmiljön.
7. **Kontroll** – samordnaren: `select * from app_settings;` ska visa `environment = staging` och två rader `clock_…`; `show timezone;` ska ge `Europe/Stockholm`; `select id, email, is_tester from profiles where is_tester;` ska visa de sju testarna.
8. **Första inloggningen** – testaren: öppna `https://<adressen>/logga-in`, skriv `karim.khalil@miljonbemanning.se` → *Skicka kod* → skriv koden från mejlet → *Logga in*.
9. **Testdatat** – testaren (som sig själv, rollen admin): gå till **Underbiträden och integrationer** (`/admin/integrationer`) → **Läs in testdata på nytt** → bekräfta. Det tar 10–30 sekunder. Sidan laddas om, testklockan står på måndag 1 februari 2027 kl. 09.12 och alla testpersoner finns i "Agera som".
10. **Domänen** – du: `miljonmatch.se` och `www.miljonmatch.se` i Vercel (avsnitt 3.4). Ändras vilken adress som skickas vidare: ändra `MM_APP_URL` och *Site URL* till den som inte skickas vidare.

Knappen **Läs in testdata på nytt** kan användas när som helst för att börja om. Allt som testats nollställs för alla testare; revisionsloggen, testarnas inloggning och synpunkterna finns kvar. Knappen syns bara för testare i testmiljön.

---

## 1. Supabase – databasen

Projektet finns redan (se `docs/MILJOER.md`): ref `blxupsebzzhmjitaywev`, region **eu-north-1 (Stockholm)**. Kontrollera regionen under *Project Settings → General*.

1. **Migrationerna** ligger i `supabase/migrations/` (0001–0017). I testprojektet har samordnaren applicerat 0001–0016; 0017 (synpunkter) appliceras när koden med "Lämna synpunkt" går live. **0013 måste gå live samtidigt som koden** (se steg 1 i "exakt ordning" ovan). Kör dem i ordning: MCP `apply_migration`, eller
   ```
   npx supabase login
   npx supabase link --project-ref blxupsebzzhmjitaywev
   npx supabase db push
   ```
   eller klistra in filerna en i taget i *SQL Editor*. Mer om migrationerna och besluten: `supabase/README.md`.
2. **Startdatat:** `supabase/bootstrap-staging.sql` (genereras med `npx tsx scripts/db/generate-bootstrap.ts`). Se "exakt ordning" ovan.
3. **Testdatat:** läses in av testaren i appen (`POST /api/staging/seed`). Servern tömmer först appens tabeller med `mm.reset_test_data()` – som bara fungerar när `app_settings.environment = 'staging'` och bara för service role – och läser sedan in hela prototypens testdata (ca 13 000 rader) i batchar. Testpersonernas påhittade personnummer krypteras med testmiljöns nycklar. Revisionsloggen får raden `staging.seed`.
   *Alternativ för lokal Postgres:* `supabase/seed.sql` (2,9 MB, `npx tsx scripts/db/generate-seed.ts`) med `psql`. Den har testdatats ersättning för personnummer, så "Visa personnummer" fungerar inte med den i supabase-läget.
4. **Tidszon:** `show timezone;` ska ge `Europe/Stockholm`. (Migrationen sätter den. Står det något annat: `alter database postgres set timezone to 'Europe/Stockholm';` och starta om projektet under *Project Settings → General → Restart project*.)
5. **Data API:** bara schemat `public` exponerat (standard). **Max rows** minst 1000 (standard) – appen hämtar listor i sidor om 1000 rader.

### 1.1 Nycklar
*Project Settings → API Keys*:
- **Publishable key** (`sb_publishable_…`) → `SUPABASE_PUBLISHABLE_KEY` i Vercel. Testmiljöns publika nyckel står i `docs/MILJOER.md`.
- **Secret key** (`sb_secret_…`) → `SUPABASE_SECRET_KEY` i Vercel. Hemlig – bara i Vercel, aldrig i repot, chatten eller med prefixet `NEXT_PUBLIC_`.

### 1.2 Bakgrundsjobb
Schemaläggningen av `/api/jobs/run` (pg_cron + pg_net i Supabase, varje minut) beskrivs i `docs/UTSKICK.md`. Nyckeln `MM_JOBS_SECRET` (minst 16 tecken) läggs både i Vercel och i Supabase Vault.
Samma körning tar röstinspelningens jobb (transkribering, översättning, månadens AI-utkast) och lägger själv gallringen av ljud och råtranskript en gång i timmen (`docs/AI.md`).

### 1.3 Ljudfilerna (Storage)
Migration 0015 skapar bucketen **`ljud`**: privat, högst 25 MB per fil, bara ljud. Kontrollera under *Storage* att den finns och **inte** är publik. Inga policyer på `storage.objects` – bara servern (service role) läser och raderar, och webbläsaren laddar upp med en signerad adress som gäller en gång. Ljudet raderas direkt efter transkriberingen, senast efter 24 timmar.

### 1.4 Bilagor, självregistrering och kommunens roller (migration 0023–0026, beslut 2026-10-07)
- **Driftordning:** 0023–0026 appliceras **tillsammans och i nummerordning** efter att båda omgångarna (A: kommunens portal, B: fakturering) är sammanfogade – 0023 (fakturan per avtal och månad) byggs sist men har lägst nummer. Driftsätt koden i samma veva: koden läser de nya kolumnerna i `cases_public` (0025) och tabellen `case_attachments` (0024), och 0026 gör kommunens chefer till handläggare. Kontroll efteråt: `select role, count(*) from memberships group by role;` (ingen `kommun_chef`), `select count(*) from case_attachments;` fungerar, och `select order_period_months, prior_assessment from cases_public limit 1;` fungerar som inloggad.
- **Bucketen `bilagor`** (0024): privat, högst 10 MB per fil, bara PDF, Word och bild. Kontrollera under *Storage* att den finns och **inte** är publik. Inga policyer på `storage.objects` – bara servern läser, kontrollerar och raderar; webbläsaren laddar upp med en signerad adress. Sökvägen är `<avtal>/<id>.<ändelse>` – aldrig filnamnet. "Läs in testdata på nytt" tömmer bucketen i testmiljön.
- **Jobben** `attachments_retention` och `auth_cleanup` läggs själv en gång i timmen av `/api/jobs/run` (samma cron som övriga jobb, avsnitt 1.2): städningen av bilagor (uppladdningar som aldrig kopplades efter 24 timmar, och filer i bucketen utan levande bilaga, eftersom en signerad uppladdningsadress gäller i två timmar och kan användas igen efter "Ta bort"; bilagor i ett ärende gallras aldrig automatiskt – Miljonbemanning tar bort dem för hand tidigast när ärendet är avslutat, beslut 5 2026-10-08) och borttagning av Auth-användare som skapades för en ny adress men där koden aldrig prövades (efter 24 timmar). Kontroll: `select kind, status, last_error from jobs where kind in ('attachments_retention','auth_cleanup') order by created_at desc limit 5;`.
- **Fakturan per avtal och månad** (0023, omgång B): migrationen gör om de gamla fakturorna per ärende till fakturor per avtal och månad som den gamla modellen räknade: varje ärende med debiterbara veckor fick sin egen fakturas status, annars körningens standardstatus, annars underlag. Varje skapad status i månaden blir en faktura (`inv-<avtal>-<månad>-avtal` för körningens standardstatus eller den högsta statusen, sedan `-avtal-tillagg-2` …) med en rad per ärende (utan veckor – täcker ärendets alla veckor i månaden). De gamla Fortnox- och fakturanumren sparas i radens anmärkning (`invoice_lines.note`). Ofakturerade ärenden får ingen rad och räknas som ofakturerade (varningen för preskription finns kvar). Krediteringarna kopplas till fakturan som har ärendets rad, och de gamla fakturorna tas bort. I testmiljön: **läs in testdatat på nytt** efter migrationen (seed.sql har fakturorna i den nya formen, med decembers tilläggsfaktura). Kontroll efteråt: `select month, grouping_key, status, buyer_reference from invoice_drafts order by month;` (en rad per månad och grupp) och `select count(*) from invoice_lines;`. Botkyrka ska godkänna samlingsfakturan skriftligt innan den används skarpt (SPEC §13 fråga 5) – annars ställs avtalet om till `invoicePer: "case_and_month"` i konfigurationen.
- **Självregistrering:** inställningen i Supabase Auth ("Allow new users to sign up") ska **fortsatt vara av** – appen skapar Auth-användaren själv med service role för en adress på avtalets kommundomän (`contracts.config.selfRegistration`, bara när synligheten är "own", inga plusadresser). Taket räknas på unika adresser i `login_attempts` (kind `self_registration`, hashat): högst 20 nya adresser per timme i hela appen och högst 3 per IP. I testmiljön gäller `MM_EMAIL_ALLOWLIST` som förut: en ny adress utanför listan får ingen kod och inget konto.

---

## 2. Supabase – inloggning (Authentication)

Redan inställt i testmiljön 2026-09-30. Tabellen är facit – kontrollera den, och gör likadant i produktion.

### 2.1 Inställningar

**Appen skickar inloggningskoden själv (beslut 2026-10-02).** Servern ber Supabase Auth ta fram koden med
`auth.admin.generateLink({ type: "magiclink", email })` (service role). Då skickar Supabase **inget** mejl – svaret innehåller
den sexsiffriga koden (`properties.email_otp`), som appen skickar direkt via Resend (`RESEND_API_KEY`, avsändare
`MM_EMAIL_FROM`) i MB:s profil, utan länk. Koden prövas som tidigare med `verifyOtp({ email, token, type: "email" })`.
Länken i svaret (`action_link`) används aldrig. Koden sparas aldrig i appens databas, jobbkö, loggar eller revisionslogg – utskicksloggen
(`outbound_messages`) får en rad med mallen `inloggningskod` och texten "Inloggningskod skickad (••••••)" (`docs/UTSKICK.md`). Koden
finns bara i mottagarens brevlåda och i Resends sändlogg (avsnitt 4.1). Därför behövs **inga e-postmallar i Supabase**,
och mejlet kan inte längre komma med Supabases engelska standardmall eller en länk som e-postskydd förbrukar.

| Var | Inställning | Värde |
|---|---|---|
| *Sign In / Providers → User Signups* | Allow new users to sign up | **Av** (ingen självregistrering – servern skapar konton för inbjudna profiler) |
| *Sign In / Providers → Email* | Enable Email provider | På |
| | Confirm email | På (kontona skapas redan bekräftade) |
| | Email OTP Length | **6** (appen tar bara emot sex siffror – med en annan längd skickas ingen kod, och utskicksloggen visar orsaken) |
| | Email OTP Expiration | **600** sekunder (10 minuter – samma som `CODE_VALID_MINUTES` i `src/server/auth/email.ts`, som texterna läser) |
| *Emails → Templates* | Magic link, Confirm signup | **Behövs inte längre** – Supabase skickar inga mejl. Reserv om någon återgår till Supabases utskick: hela filen `supabase/templates/otp.html` (genererad från appens kodmejl, ser likadan ut) i både *Magic link* och *Confirm signup*, ämne `Din inloggningskod till Miljonmatch` |
| *Emails → SMTP Settings* | Enable custom SMTP | Får ligga kvar **som reserv** (`smtp.resend.com` / `465`, användare `resend`, avsändare `notis@miljonmatch.se` / `Miljonmatch`). Används inte av appen |
| *Rate Limits* | Rate limit for sending emails | Påverkar inte inloggningen längre: Supabase skickar inga mejl, och `generateLink` har ingen egen spärr (Supabase begränsar bara prövningen av koden). **Appens spärrar är de enda för kodmejlen:** 5 koder per adress och 20 per IP på 15 minuter (`LIMITS`) och ett tak för hela appen på 30 kodmejl per timme (`CODE_MAILS_PER_HOUR` i `src/server/auth/rate-limit.ts` – samma som Supabase-standarden förut). Över taket skickas ingen kod, och utskicksloggen får en rad `suppressed` |

Supabase Auths egna gränser för sessioner behövs inte – appen loggar ut efter 60 minuters inaktivitet och 12 timmar (`src/proxy.ts`).

Med Supabase CLI (lokalt) kan reservmallen läggas in i `supabase/config.toml`:
```toml
[auth.email.template.magic_link]
subject = "Din inloggningskod till Miljonmatch"
content_path = "./supabase/templates/otp.html"
```

### 2.2 URL:er (*Authentication → URL Configuration*)

| Inställning | Testmiljön | Produktion (senare) |
|---|---|---|
| Site URL | `https://www.miljonmatch.se` – den adress som **inte** skickas vidare (just nu skickas `miljonmatch.se` till `www`). Samma som `MM_APP_URL` | Produktionens adress som inte skickas vidare (SPEC §11: `miljonmatch.se` när produktionen startar) |
| Redirect URLs | `https://www.miljonmatch.se/**`, `https://miljonmatch.se/**`, förhandsadresserna `https://*-ai-projekts-projects.vercel.app/**`, `http://localhost:3000/**` | Produktionens båda adresser (med och utan `www`) med `/**` – inga förhandsadresser |

Inloggningen använder kod, inte länk, och appen skickar koden själv – så URL:erna används bara av Supabase för säkerhetskontroller (och i länken som `generateLink` också skapar men som appen aldrig använder). De ska ändå stämma.

---

## 3. Vercel (appen)

### 3.1 Projektet
1. Bolagets team i Vercel. **Vercels gratisnivå (Hobby) får inte användas kommersiellt** – bolaget behöver **Pro**. Koden fungerar ändå på båda nivåerna: alla rutter har `maxDuration` högst 60 sekunder (en högre gräns stoppar hela driftsättningen på Hobby). Långa inspelningar (över cirka 10 minuter) kan behöva Pro med `maxDuration` 300 för `/api/rpc` och `/api/jobs/run` – se avsnitt 10, "Tidsgränser".
2. *Add New → Project → Import* GitHub-repot `miljonmatch`. Ramverket känns igen som Next.js; bygg- och startkommandon ändras inte. Bygget kräver inga hemligheter.
3. Region: `vercel.json` innehåller `"regions": ["arn1"]`. Kontrollera efter första driftsättningen under *Settings → Functions* att regionen är **Stockholm (arn1)** – aldrig iad1 (USA).
4. Slå **inte** på Vercel Analytics eller Speed Insights (inga analysverktyg med personuppgifter, CLAUDE.md).

### 3.2 Miljövariabler
*Settings → Environment Variables*. Så länge det bara finns en testmiljö: sätt dem för *Production* och *Preview*. Hela listan med exempel och var värdena finns står i **avsnitt 5**. Efter ändrade variabler: *Deployments → … → Redeploy*.

### 3.3 Första testet
1. Öppna `https://<adressen>/logga-in`. Överst står "Testmiljö – påhittade testdata · testdatum måndag 1 februari 2027".
2. Logga in med `karim.khalil@miljonbemanning.se` och koden från mejlet.
3. Läs in testdatat (`/admin/integrationer` → **Läs in testdata på nytt**), om det inte redan är gjort.
4. Välj testperson i "Agera som" (t.ex. Sara Lindqvist – samordnare, Maria Ekdahl – kommunens handläggare). Sidan laddas om som den personen.
5. Kommunens portal: `/portal/logga-in`. I testmiljön loggar testarna in som sig själva och väljer en kommunperson i "Agera som".

### 3.4 Domänen: `miljonmatch.se` (beslut 2026-10-01, SPEC §11)
DNS för **miljonmatch.se** ligger hos **one.com** (A-post och `www`-CNAME mot Vercel). Den gamla webbsidan ersätts av appen. Rör inte domänens namnservrar.
1. Vercel: *Settings → Domains*: `miljonmatch.se` och `www.miljonmatch.se`. Just nu skickas `miljonmatch.se` vidare till **`www.miljonmatch.se`** – det är appens adress.
2. Vänta tills Vercel visar *Valid Configuration* för båda (certifikaten skapas automatiskt).
3. `MM_APP_URL` i Vercel = `https://www.miljonmatch.se` och *Site URL* i Supabase Auth = samma adress – alltid den adress som **inte** skickas vidare. Båda adresserna och förhandsadresserna (`https://*-ai-projekts-projects.vercel.app/**`) finns bland *Redirect URLs* (avsnitt 2.2). Driftsätt igen efter ändrade variabler.
4. Kontroll: länken i ett testmejl (t.ex. "Logga in i portalen") ska gå till `https://www.miljonmatch.se/portal`, och deltagarens inspelningslänk till `https://www.miljonmatch.se/rost/…`.

När produktionen startar tar den över `miljonmatch.se` i sitt eget Vercel-projekt, och testmiljön flyttar till `test.miljonmatch.se` (CNAME `test` hos one.com) – då ändras `MM_APP_URL` och *Site URL* i båda miljöerna.

---

## 4. Resend (e-post)

### 4.1 Konto
Bolagets funktionsadress, MFA och en andra administratör (*Settings → Team*). **Teckna Resends personuppgiftsbiträdesavtal (DPA) före produktion** – Resend hanterar mottagarnas e-postadresser.

**Bara administratörer i Resend.** Resend sparar varje skickat mejl (HTML och ren text) och visar det under *Emails* – även inloggningskoderna, i klartext, så länge Resend sparar mejlen. Den som kan öppna Resends instrumentpanel kan alltså se en giltig kod (den gäller 10 minuter) till någon annans konto. Ge därför bara administratörer åtkomst till Resend-kontot (*Settings → Team*), med MFA, och öppna inte de senaste kodmejlen i onödan vid felsökning – utskicksloggen i appen (avsnitt 9) räcker oftast.

### 4.2 Domän och DNS (beslut 2026-10-01)
- Domänen i Resend är **`miljonmatch.se`**. Avsändaren är **`notis@miljonmatch.se`** med visningsnamnet **Miljonmatch** (`MM_EMAIL_FROM=Miljonmatch <notis@miljonmatch.se>`).
- **Regionen är EU: Irland (`eu-west-1`)** – uppgiften i Karims beslut 2026-10-02 om underbiträdeslistan (SPEC §3.1 och §11). Regionen syns inte i DNS-posterna utan i Resend under *Domains → miljonmatch.se*, och den går inte att ändra i efterhand. Obs: SPF-posten som CNAME:n pekar på godkände 2026-10-01 också sändservrarna `mta1.forge.rmta.net` och `mta2.forge.rmta.net`, som ligger i AWS-regionen us-east-1 (USA). SPF-posten säger bara vilka servrar som får skicka i domänens namn. Visar Resend en annan region än `eu-west-1`, eller visar det sig att utskicken går via USA: säg till innan fler utskick görs.
- DNS för miljonmatch.se ligger hos **one.com** (samma ställe som posterna för Vercel). Resends poster, så som de ser ut i DNS (kontrollerat 2026-10-01):
  - **CNAME `send` → `send.forge.rmta.net`**. SPF (`v=spf1 … ~all`) och MX för studsar (`feedback.forge.rmta.net`) följer med CNAME:n – de ligger hos Resend och uppdateras där.
  - **TXT `resend._domainkey`** – DKIM-nyckeln (`p=MIGf…`).
  - Null-MX på huvuddomänen (`MX 0 .`) – miljonmatch.se tar inte emot e-post.
  - **Lägg aldrig till MX- eller TXT-poster på `send`.** Ett namn med en CNAME får inte ha andra poster: one.com avvisar ändringen, eller så ersätts CNAME:n – då slutar domänen vara verifierad i Resend och inga inloggningskoder kommer fram.
  - Ändra inte domänens övriga poster (A och `www` mot Vercel).
- Varför miljonmatch.se: DNS för miljonbemanning.se styrs av Terraform (Google Cloud DNS), och Resends poster där skulle försvinna vid nästa `terraform apply` om de inte fanns i Terraform-koden. Med miljonmatch.se finns den risken inte. Resends poster i miljonbemanning.se-zonen behövs inte längre av appen (de kan tas bort, eller läggas in i Terraform om domänen ska användas för annat).
- *Domains → miljonmatch.se → Configuration*: stäng av **Click tracking** och **Open tracking** (spårning skriver om länkar och lägger in en pixel – ett analysverktyg, CLAUDE.md).
- **Nästa steg – DMARC** (saknas 2026-10-01): lägg in en DMARC-post hos one.com, `_dmarc.miljonmatch.se` TXT `v=DMARC1; p=none; rua=mailto:<adress som du väljer>` (t.ex. en funktionsadress på Miljonbemanning). Börja med `p=none` (bara rapporter) och skärp till `quarantine` när rapporterna visar att bara Resend skickar i domänens namn.
- miljonmatch.se tar inte emot e-post (null-MX på huvuddomänen). Svar till `notis@miljonmatch.se` kommer alltså inte fram – därför sätts `MM_EMAIL_REPLY_TO=avrop@miljonbemanning.se` i produktion. I testmiljön kan den också sättas till en testares adress om ni vill se svar.

### 4.3 API-nycklar
*API Keys → Create API key*, två nycklar med **Sending access** och bara domänen **`miljonmatch.se`**:
1. `miljonmatch-app` → `RESEND_API_KEY` i Vercel. **Både appens notiser och inloggningskoderna skickas med den** (beslut 2026-10-02) – saknas den, eller saknar den sändrätt för miljonmatch.se, kommer inga koder fram och ingen kan logga in.
2. `supabase-smtp` → lösenordet under *SMTP Settings* i Supabase (avsnitt 2.1). Behövs bara som reserv om någon återgår till att låta Supabase Auth skicka koden – den används inte av appen.

Har ni nycklar som bara har sändrätt för miljonbemanning.se: skapa nya för miljonmatch.se, byt dem i Supabase och Vercel och ta sedan bort de gamla.

Avsändaren `notis@miljonmatch.se` behöver ingen brevlåda för att skicka. Svar går till `MM_EMAIL_REPLY_TO` – i produktion `avrop@miljonbemanning.se`, så att svar på ordererkännandet hamnar i avropsflödet.

---

## 5. Alla miljövariabler (Vercel)

Inga hemligheter i tabellen – exempelvärdena är påhittade eller publika. **Hemliga** värden sätts bara i Vercel (aldrig med prefixet `NEXT_PUBLIC_`, aldrig i repot eller chatten). Samma lista med förklaringar finns i `.env.example`.

| Namn | Hemlig | Förklaring | Exempel (testmiljön) | Var värdet finns |
|---|---|---|---|---|
| `MM_BACKEND` | | Körläge: `memory` (påhittade testdata i minnet – lokalt och e2e) eller `supabase` (testmiljön och produktion) | `supabase` | Fast värde |
| `MM_CLOCK` | | Tomt = testtid när `app_settings` har testklockans epoker. `real` = riktig tid | produktion `real` · testmiljön *(tomt)* | Fast värde |
| `MM_APP_URL` | | Appens adress utan `/` på slutet – den som **inte** skickas vidare. Länkarna i mejlen och deltagarens inspelningslänk (`/rost/…`) | `https://www.miljonmatch.se` | Vercel → *Domains* |
| `SUPABASE_URL` | | Supabase-projektets adress (`NEXT_PUBLIC_SUPABASE_URL` från Vercels Supabase-integration fungerar också) | `https://blxupsebzzhmjitaywev.supabase.co` | Supabase → *Project Settings → API* · `docs/MILJOER.md` |
| `SUPABASE_PUBLISHABLE_KEY` | | Publik nyckel, används bara på servern (`SUPABASE_ANON_KEY` fungerar också) | `sb_publishable_…` | Supabase → *Project Settings → API Keys* · `docs/MILJOER.md` |
| `SUPABASE_SECRET_KEY` | **ja** | Service role – bara systemsteg på servern: revisionslogg, inloggningens uppslag, utskick, bakgrundsjobb, inläsning av testdata (`SUPABASE_SERVICE_ROLE_KEY` fungerar också) | `sb_secret_…` | Supabase → *Project Settings → API Keys* |
| `MM_LOGIN_HASH_SECRET` | **ja** | Nyckel för att hasha e-post och IP i `login_attempts` | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_SESSION_SECRET` | **ja** | Valfri. Nyckel för att signera sessionskakan `mm_last_seen` (60 minuters inaktivitet). Tom = samma nyckel som `MM_LOGIN_HASH_SECRET`. Byts nyckeln loggas alla ut en gång | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_PNR_KEY` | **ja** | Kryptering av personnummer, AES-256-GCM: exakt 32 byte som base64 | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_PNR_HMAC_KEY` | **ja** | Sökhash för personnummer (dubblettkontrollen), HMAC-SHA256: minst 32 byte som base64, **en annan nyckel** än `MM_PNR_KEY` | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_STAFF_EMAIL_DOMAINS` | | Tillåtna domäner för Miljonbemannings personal – vid inloggning och i "Lägg till kollega" (kommunernas domäner står i databasen) | `miljonbemanning.se` (standard) | Fast värde |
| `MM_EMAIL_ALLOWLIST` | | Adresser eller `@domäner` som får mejl och inloggningskoder, kommatecken emellan. **Produktion:** `@miljonbemanning.se` tills Botkyrka släpps in, sedan `@miljonbemanning.se,@botkyrka.se` eller tom (alla). **Testmiljön:** hela adresser, aldrig `@miljonbemanning.se` – testdatat har påhittade adresser på den domänen; tom = ingen får mejl | `karim.khalil@miljonbemanning.se,ali.khalil@miljonbemanning.se,sara.salah@miljonbemanning.se,adam.abdalla@miljonbemanning.se,shafik.muwanga@miljonbemanning.se,moda.habib@miljonbemanning.se,yacine.laghmari@miljonbemanning.se` | Testarnas adresser (avsnitt 11) |
| `MM_EMAIL_REDIRECT_TO` | | **Bara testmiljön:** testarens adress som får mejlen till testpersoner, med raden "Testmiljö – det här mejlet skulle ha gått till …" (roll och organisation). Måste finnas i `MM_EMAIL_ALLOWLIST`. Gäller aldrig inloggningskoder – koden går bara till den som loggar in. Ignoreras i produktion – lämna tom där | `karim.khalil@miljonbemanning.se` | En testares adress |
| `RESEND_API_KEY` | **ja** | Resends API-nyckel (bara sändrätt) för appens mejl **och inloggningskoderna** (appen skickar koden själv, avsnitt 2.1). Saknas den kan ingen logga in | `re_…` | Resend → *API Keys* (`miljonmatch-app`) |
| `MM_EMAIL_FROM` | | Avsändare för notiserna och inloggningskoderna. Domänen måste vara verifierad i Resend | `Miljonmatch <notis@miljonmatch.se>` | Fast värde (beslut 2026-10-01) |
| `MM_EMAIL_REPLY_TO` | | Svarsadress för notiserna – foten säger då vart svar går. Produktion: `avrop@miljonbemanning.se` (svar på ordererkännandet hamnar i avropsflödet). Tom i testmiljön. Kodmejlet har aldrig någon svarsadress | *(tomt)* · produktion `avrop@miljonbemanning.se` | Fast värde |
| `MM_JOBS_SECRET` | **ja** | Nyckel för `/api/jobs/run` (`Authorization: Bearer …`), **minst 16 tecken**. Samma värde i Supabase Vault (`docs/UTSKICK.md`) | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_AI_PROVIDER` | | AI-stödet (avsnitt 10): `vertex` (Gemini via Vertex AI, EU), `simulated` (påhittade svar – bara testmiljön) eller `off`. Tomt = `simulated` i testmiljön och `off` i produktion. Produktion kör aldrig `simulated` | *(tomt)* · när kontot finns `vertex` | Fast värde |
| `MM_AI_MODEL` | | Gemini-modellen i Vertex AI (en Flash-modell). Kontrolleras inte mot nätet – stavas exakt som i Vertex AI | *(modellens id)* | Google Cloud → *Vertex AI → Model Garden* |
| `GOOGLE_VERTEX_PROJECT` | | Google Cloud-projektets id (annars `project_id` ur nyckeln) | `miljonmatch-ai-test` | Google Cloud → projektväljaren |
| `GOOGLE_VERTEX_LOCATION` | | Valfri. Får bara vara `eu` (EU multi-region). Allt annat stoppas | `eu` | Fast värde |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | **ja** | Tjänstekontots JSON-nyckel som base64 (rollen *Vertex AI User*) | *(base64)* | Avsnitt 10, steg 4 |
| `MM_AI_PRICES` | | Prislista för kostnaden i `ai_runs`, i öre per miljon token: `{"audioIn":…,"textIn":…,"output":…}`. Tom = kostnad 0 | *(från Googles prislista)* | Avsnitt 10, steg 6 |
| `MM_AI_THINKING` | | Valfri resonemangsnivå: `minimal`, `low`, `medium`, `high`. Tom = lägsta rimliga (`docs/AI.md`) | *(tomt)* | Fast värde |
| `MS_GRAPH_TENANT_ID` | | Mejlinläsningen från avrop@ (avsnitt 12): katalog-id (tenant) i Microsoft Entra | *(GUID)* | Entra → *Appregistreringar → appen → Översikt* |
| `MS_GRAPH_CLIENT_ID` | | Appregistreringens klient-id (applikations-id) | *(GUID)* | Samma sida |
| `MS_GRAPH_CLIENT_SECRET` | **ja** | Klienthemligheten. Byt den innan den går ut | *(hemlighet)* | Entra → *Certifikat och hemligheter* |
| `MM_INBOX_MAILBOX` | | Brevlådan som läses. Appen får bara nå den (ApplicationAccessPolicy) | `avrop@miljonbemanning.se` | Fast värde |
| `MM_INBOX_DONE_FOLDER` | | Mappen dit inlästa mejl flyttas (skapas om den saknas). Tom = `Inläst` | `Inläst` | Fast värde |
| `MM_SMS_PROVIDER` | | SMS till deltagare (avsnitt 13): `46elks`. Tom = inga SMS (stoppas med orsaken "SMS-leverantör inte vald") | *(tomt)* · när avtalet finns `46elks` | Fast värde |
| `ELKS_API_USERNAME` | | 46elks API-användarnamn (börjar med `u`) – för SMS och utringning | `u…` | 46elks → *Dashboard → Account* |
| `ELKS_API_PASSWORD` | **ja** | 46elks API-lösenord | *(hemligt)* | 46elks → *Dashboard → Account* |
| `MM_SMS_FROM` | | Avsändarnamnet i SMS:et: 3–11 bokstäver eller siffror, börjar med en bokstav. Tom = `Miljonbem` | `Miljonbem` | Fast värde |
| `MM_CALL_FROM` | | Numret som ringer vid utringning – ett nummer med röst hos 46elks | `+46766…` | 46elks → *Numbers* |
| `MM_CALL_AUDIO_URL` | | Inspelningen som spelas upp (https, nås utan inloggning) – `public/ljud/README.md` | `https://www.miljonmatch.se/ljud/kallelse.mp3` | Appens adress + `/ljud/kallelse.mp3` |
| `MM_SMS_ALLOWLIST` | | Telefonnummer som får SMS och samtal, kommatecken emellan (`070-…` eller `+46…`). Tom i produktion = alla. Testmiljön: testarnas nummer; tom = inga. I produktion kan listan användas för ett första prov med eget nummer | *(tomt)* | Testarnas nummer |
| `MM_SMS_REDIRECT_TO` | | **Bara testmiljön:** testarens nummer som får SMS och samtal till testpersoner (måste stå i `MM_SMS_ALLOWLIST`). Ignoreras i produktion | *(tomt)* | En testares nummer |

Saknas någon av de fyra första Graph-variablerna gör jobbet ingenting, och `/admin/integrationer` visar "Inte kopplad – så här kopplar du". SMS och utringning (46elks) kopplas enligt avsnitt 13 – utan variablerna stoppas SMS och samtal med orsak och kallelsen går med e-post (eller blir en uppgift till samordnaren). Kommer senare: Microsoft Entra-inloggning och Fortnox (tills dess saknas `ctx.fortnox` i supabase-läget: ekonomen ser "Fortnox är inte kopplat ännu" i fakturakörningen och på kortet Fortnox-synk, knapparna "Skapa i Fortnox" och "Hämta status" finns inte, och fakturan skapas i Fortnox för hand och markeras som manuellt fakturerad – den simulerade porten finns bara i minnesläget). AI-leverantören (Vertex AI) kopplas in enligt avsnitt 10 när kontot i Google Cloud finns – tills dess kör testmiljön den simulerade.

### 5.1 Nycklarna för personnummer (`MM_PNR_KEY`, `MM_PNR_HMAC_KEY`)
- Personnummer krypteras i appen (AES-256-GCM) innan de sparas och söks via en HMAC-hash av de tio sista siffrorna (CLAUDE.md punkt 2). Nycklarna finns bara på servern (`src/server/crypto.ts`, `import "server-only"`) och når aldrig webbläsaren.
- Skapa två **olika** nycklar: `openssl rand -base64 32` två gånger.
- Testmiljön och produktion har **egna** nycklar. Testdatat krypteras med testmiljöns nycklar när det läses in.
- **Nycklarna kan inte bytas utan omkryptering.** Med en ny `MM_PNR_KEY` går inga sparade personnummer att läsa, och med en ny `MM_PNR_HMAC_KEY` hittar dubblettkontrollen inga gamla personer. Byte kräver ett skript som dekrypterar med den gamla nyckeln, krypterar med den nya och räknar om alla hashar. I testmiljön räcker det att läsa in testdatat på nytt efter bytet.
- Saknas nycklarna fungerar appen, men allt som rör personnummer (beställning, "Visa", dubblettkontrollen) ger fel, och "Läs in testdata på nytt" stoppas innan något töms.

---

## 6. Så fungerar det i koden

| Del | Fil |
|---|---|
| Körläge (minnet eller Supabase), Ctx, klocka | `src/server/runtime.ts`, `src/server/live.ts`, `src/server/ctx.ts`, `src/server/clock.ts` |
| Datalagret mot Postgres (RLS) | `src/data/supabase/repo.ts` – samma `Repo` som minnesläget; hanterarna ändras inte |
| Aktören (roll, avtal) | databasens `public.current_actor()` – samma funktioner som RLS använder |
| Personnummer (`ctx.crypto`) | `src/server/crypto.ts` (servern) · `src/data/seed/pnr.ts` (`TEST_PNR_CRYPTO`, minnesläget) |
| Inloggning med kod | `src/app/api/auth/{code,verify,logout}`, `src/server/auth/*` – kodmejlet: `src/server/auth/code-mail.ts` (generateLink + Resend), layouten `src/server/notify/render.ts` |
| Session, testarens val | `src/app/api/session`, `src/app/api/session/impersonate`, `src/app/_shell/client-root.tsx` |
| Kollegor, roller, spärr (beslut 2026-10-08) | `src/features/admin/handlers-users.ts` (`admin.inviteStaff`, `admin.setStaffRoles`, `admin.setStaffActive`), skärmen `src/features/admin/screens/anvandare.tsx`, domänerna `src/core/staff.ts` |
| Rollväxling (beslut 2026-10-08) | `supabase/migrations/0027_rollval.sql` (`role_choices`, `mm.current_role()`), `src/features/session/handlers.ts` (`session.vaxlaRoll`), `src/data/actors.ts` (`defaultRoleFor`), rollväljaren i `src/shell/layouts.tsx` |
| Tomt testdata och riktig tid lokalt | `MM_SEED=empty` – `src/data/seed/empty.ts`, `src/data/seed/colleagues.ts`, `realClock` i `src/data/memory-runtime.ts`; e2e-projektet `tom` |
| Läs in testdata på nytt | `src/app/api/staging/seed/route.ts`, `src/server/staging/load.ts`, `supabase/migrations/0010_testdata.sql` (och 0017, som behåller synpunkterna), knappen `src/features/session/screens/test-data-reset.tsx` |
| Synpunkter (bara testmiljön) | `src/features/synpunkter/*` (kommandona `feedback.*`, knapparna i `panel.tsx`), `supabase/migrations/0017_synpunkter.sql` |
| Utskick och jobb | `src/server/notify/*`, `src/server/jobs/*`, `docs/UTSKICK.md` |
| Meddelanden till deltagare, SMS och utringning (beslut 2026-10-09) | `src/features/_shared/participant-notify.ts` (`notifyParticipant`: kanalvalet och uppgiften till samordnaren), `src/features/_shared/messaging-port.ts` (`ctx.messaging`), `src/server/notify/elks.ts` (46elks), `src/server/notify/config.ts` (`phoneEnv`), `src/core/phone.ts` (E.164) – avsnitt 13 |
| AI och röstinspelning | `src/server/ai/*` (Vertex AI EU eller simulerad), `src/server/audio/*` (bucketen `ljud`), `src/features/_shared/voice-upload.ts` och `voice-jobs.ts`, `POST /api/audio/upload-url` – `docs/AI.md` |
| Bilagor och självregistrering | `src/server/attachments/*` (bucketen `bilagor`), `src/features/_shared/attachment-port.ts`, `src/server/jobs/attachments.ts`, `src/server/auth/service.ts` (självregistreringen), `src/core/self-registration.ts` |
| Inaktivitet och maxtid, förnyelse av sessionen | `src/proxy.ts` (kakorna `mm_last_seen`, `mm_login_at`) |
| E2E i minnesläget | `POST /api/dev-session/reset` (bara minnesläget) nollställer testdatat före varje test |

- Svaret på "Skicka kod" är alltid detsamma, så att ingen kan pröva fram vilka adresser som finns. Koden skickas bara till en aktiv profil med roll och tillåten domän (kommunens domäner i `organizations.email_domains`, personalens i `MM_STAFF_EMAIL_DOMAINS`) – och i testmiljön bara till `MM_EMAIL_ALLOWLIST`.
- Hastighetsbegränsning per adress och IP i `login_attempts`, med hashade värden. Adresser, koder och IP-nummer loggas aldrig.
- Supabase-sessionen ligger i httpOnly-kakor. Inloggning, utloggning, byte av testperson och inläsning av testdata laddar om sidan, så att inga gamla data ligger kvar.
- Lokalt och i e2e körs appen i minnesläget (`MM_BACKEND=memory`, välj testperson i verktygsfältet).

---

## 7. Produktion (planen från 2026-10-02 – genomförd 2026-10-08 i samma projekt, se "Skarp drift" överst)

*Historik: planen var ett eget projekt. Beslutet 2026-10-08 blev att samma projekt blir produktion; det som står här gäller i stället för den nya testmiljön som sätts upp senare (eget projekt, egna nycklar, `environment = staging`).*

- Nytt Supabase-projekt i **eu-north-1** och ett **eget Vercel-projekt**, så att förhandsversioner (Preview) aldrig kan peka mot produktionsdatabasen.
- Samma migrationer (0001–0017, i nummerordning), **ingen seed och inget startdata**. Kör dem precis före den första driftsättningen – 0013 och koden hör ihop (steg 1 i "exakt ordning"). `app_settings` får `environment = production` och inga klockrader (`supabase/README.md`). Då gör `mm.reset_test_data()` ingenting, testarfunktionen är avstängd och knapparna för testdata och synpunkter syns inte (tabellerna för synpunkter finns men ingen kan läsa eller skriva i dem).
- `MM_CLOCK=real`, `MM_EMAIL_ALLOWLIST` tom, `MM_EMAIL_REDIRECT_TO` tom, `MM_EMAIL_REPLY_TO=avrop@miljonbemanning.se`, egna nycklar för personnummer, jobb och inloggning.
- Domän `miljonmatch.se` (SPEC §11 – testmiljön flyttar då till `test.miljonmatch.se`). *Site URL* och `MM_APP_URL` = den adress som inte skickas vidare; båda adresserna bland *Redirect URLs*, inga förhandsadresser.
- DPA med Resend (och övriga underbiträden) innan riktiga personuppgifter. Bara administratörer i Resend-kontot (kodmejlen syns där, avsnitt 4.1).
- Taket för kodmejl är 30 per timme för hela appen (`CODE_MAILS_PER_HOUR`, avsnitt 2.1). Räcker det inte när fler användare loggar in samtidigt (t.ex. på måndagsmorgonen): höj värdet i koden och driftsätt igen.
- AI: ett **eget Google Cloud-projekt** för produktion med eget tjänstekonto och egen nyckel (avsnitt 10). `MM_AI_PROVIDER=vertex` – utan den är AI avstängd i produktion (den simulerade körs aldrig där).

## 8. Säkerhetskontroll

- [ ] Hemliga nycklar finns bara i Vercel (och SMTP-lösenordet i Supabase, jobbnyckeln i Supabase Vault) – aldrig i repot, chatten eller loggar.
- [ ] Inga variabler med hemligheter har prefixet `NEXT_PUBLIC_`.
- [ ] Funktionerna körs i arn1 (Stockholm), databasen i eu-north-1.
- [ ] Vercel Pro (inte Hobby) – kommersiell användning kräver Pro. `maxDuration` högst 60 sekunder tills ni bestämt annat (avsnitt 10, "Tidsgränser").
- [ ] Självregistrering är avstängd i Supabase Auth. Kodmejlet kommer från appen (`notis@miljonmatch.se`, svensk text i MB:s profil) och visar bara koden – ingen länk.
- [ ] Testmiljön har bara påhittade testdata och `MM_EMAIL_ALLOWLIST` är satt.
- [ ] Click och open tracking är avstängda i Resend.
- [ ] Bara administratörer (med MFA) har åtkomst till Resend-kontot – kodmejlen syns i klartext under *Emails* (avsnitt 4.1).
- [ ] Resends DNS-poster för miljonmatch.se finns hos one.com, nycklarna har bara sändrätt för miljonmatch.se och DMARC-posten är inlagd (avsnitt 4.2).
- [ ] MFA och minst två administratörer i Vercel, Supabase och Resend.
- [ ] AI: bara `MM_AI_PROVIDER=vertex` med `aiplatform.eu.rep.googleapis.com` (location `eu`) – ingen Gemini API-nyckel (AI Studio) någonstans. Tjänstekontot har bara rollen *Vertex AI User*. Googles personuppgiftsbiträdesvillkor (CDPA) är godkända och Vertex AI:s cachning av indata avstängd (avsnitt 10).
- [ ] Bucketen `ljud` är privat.

## 9. Felsökning

| Problem | Kontrollera |
|---|---|
| "Inloggningen kunde inte hämtas" | Miljövariablerna i Vercel, att migrationerna är körda (`select public.current_actor();`) och Vercels loggar (bara felkoder, inga personuppgifter) |
| Ingen kod kommer | Att adressen finns i `MM_EMAIL_ALLOWLIST` (testmiljön) och som aktiv profil med roll (`bootstrap-staging.sql` körd? avsnitt 11). Utskicksloggen: `select created_at, status, status_reason from outbound_messages where template = 'inloggningskod' order by created_at desc limit 5;` – `failed` visar orsaken (t.ex. "E-post är inte konfigurerad", "Resend svarade 403 (validation_error)", "Supabase Auth gav ingen kod (…)"), `suppressed` att taket för hela appen var nått (30 kodmejl per timme, avsnitt 2.1), `queued` att utskicket avbröts innan det var klart. **Ingen rad** betyder något av detta: spärren stoppade adressen (inte i `MM_EMAIL_ALLOWLIST`, ingen aktiv profil med roll, fel domän), kontot i Supabase Auth kunde inte skapas, utskicksloggen gick inte att skriva, något annat fel före utskicket – eller hastighetsspärren ("Du har försökt för många gånger" på inloggningssidan, raden nedan), som inte heller ger någon rad. Vercels logg (bara steg och felkod): `inloggning skapa-konto …` (kontot kunde inte skapas), `inloggning utskickslogg …`, `inloggning skicka-kod …` (`tak` = taket, `resend` = Resend avvisade, `resend-saknas`), `inloggning skapa-kod …` (Supabase Auth gav ingen kod). `RESEND_API_KEY` och `MM_EMAIL_FROM` i Vercel; *Emails* i Resend (bara administratörer – mejlen där visar koden, avsnitt 4.1); skräpposten |
| "Lämna synpunkt" syns inte | Bara testare (`profiles.is_tester`) i testmiljön ser knappen, i raden "Testmiljö" överst. Migration 0017 körd? (`select count(*) from public.feedback;`) |
| Mejlet innehåller en länk eller är på engelska | Det kommer från Supabase Auth, inte från appen – den driftsatta versionen är äldre än 2026-10-02 (då skickade Supabase koden). Appens kodmejl är på svenska, i MB:s profil och utan länk. Driftsätt den nya versionen (avsnitt 2.1) |
| "Du har försökt för många gånger" | Vänta 15 minuter (5 koder per adress, 20 per IP) eller be om en ny kod efter 5 felaktiga försök. Spärren skriver ingen rad i utskicksloggen |
| "Läs in testdata på nytt" syns inte | Knappen finns på `/admin/integrationer`, som bara rollen admin når – välj dig själv i "Agera som". Bara testare (`profiles.is_tester`) i testmiljön (`app_settings.environment = staging`) ser den |
| "Nycklarna för personnummer saknas" | `MM_PNR_KEY` och `MM_PNR_HMAC_KEY` i Vercel (avsnitt 5.1), driftsätt igen |
| Inläsningen avbröts | Kör den igen – den börjar alltid med att tömma. Vercels loggar visar tabell och felkod (`testdata-fel`) |
| Fel tid i appen | `show timezone;` och raderna `clock_…` i `app_settings`. `MM_CLOCK=real` ger riktig tid |
| Utloggad oväntat | 60 minuter utan aktivitet eller 12 timmar sedan inloggningen – så ska det vara |
| "AI-stödet är inte tillgängligt just nu" / inspelning går inte att starta | `MM_AI_PROVIDER` och övriga AI-variabler (avsnitt 10). Vercels logg visar `ai: AI-stödet är avstängt – …` med orsaken (utan hemligheter). I produktion är AI av tills `MM_AI_PROVIDER=vertex` |
| Transkriberingen blir aldrig klar | `jobs` (`select kind, status, attempts, started_at, last_error from jobs order by created_at desc limit 20;`). 403/404 från Vertex AI: fel projekt, modell eller roll. "AI-tjänsten svarar inte": tillfälligt – jobbet försöks igen upp till fem gånger. Ett jobb som står i `running` tas upp igen efter fem minuter. "Jobbet avbröts innan det blev klart (serverns tidsgräns)": inspelningen hann inte transkriberas inom 60 sekunder fem gånger – se "Tidsgränser" i avsnitt 10 |
| Rollväljaren syns inte | Bara den som har fler än en roll (medlemskap) ser den, under sitt namn i sidopanelen. Migration 0027 körd? (`select count(*) from public.role_choices;`) |
| "Tal till text är inte kopplat ännu" | Så ska det vara i produktion tills `MM_AI_PROVIDER=vertex` och Google Cloud finns (avsnitt 10). Ingen simulerad AI i produktion |
| Kollegan får ingen kod | Adressen måste finnas som aktiv profil med roll (Användare och roller), ha domänen i `MM_STAFF_EMAIL_DOMAINS` och – med en satt `MM_EMAIL_ALLOWLIST` – matcha listan (`@miljonbemanning.se`), annars skickas inte koden |

---

## 10. AI och röstinspelning – Google Cloud Vertex AI

Beslut 2026-09-30 (`docs/PLAN-ROST.md`): **Gemini Flash via Vertex AI, EU multi-region-endpoint** (`aiplatform.eu.rep.googleapis.com`, location `eu`). Tills kontot finns kör testmiljön den simulerade leverantören – hela flödet (inspelning, uppladdning, samtycke, radering) går att testa, men transkripten är påhittade. Hur flödena, raderingen och loggningen fungerar: `docs/AI.md`.

**Använd aldrig AI Studio eller en Gemini API-nyckel** (nycklar som börjar med `AIza`, adressen `generativelanguage.googleapis.com`) och aldrig den globala endpointen – de saknar garanti för var datan behandlas. Appen vägrar andra adresser än EU-endpointen.

1. **Google Cloud-projekt** – [console.cloud.google.com](https://console.cloud.google.com): *Välj projekt → Nytt projekt* i bolagets organisation, t.ex. `miljonmatch-ai-test` (produktion får ett eget, t.ex. `miljonmatch-ai`). Koppla bolagets faktureringskonto. Projektets **id** → `GOOGLE_VERTEX_PROJECT`.
2. **Aktivera Vertex AI API** – *APIs & Services → Library* → sök "Vertex AI API" → *Enable*.
3. **Tjänstekonto** – *IAM & Admin → Service Accounts → Create service account*, t.ex. `miljonmatch-ai`. Ge det **bara** rollen **Vertex AI User** (`roles/aiplatform.user`). Inga andra roller.
4. **Nyckel** – tjänstekontot → *Keys → Add key → Create new key → JSON*. Filen laddas ner. Gör om den till base64 på en rad:
   ```
   base64 -w0 nyckel.json      # Linux
   base64 -i nyckel.json       # macOS
   ```
   Lägg in resultatet i Vercel som **`GOOGLE_SERVICE_ACCOUNT_KEY`** (hemlig). **Radera filen** från datorn efteråt. Nyckeln skrivs aldrig i chatten eller i repot. (Stoppar organisationens policy `iam.disableServiceAccountKeyCreation` nycklar: gör ett undantag för projektet.)
5. **Personuppgiftsbiträdesvillkor** – Googles *Cloud Data Processing Addendum* (CDPA): granska och godkänn under *IAM & Admin → Privacy & Security* och fyll i kontaktuppgifterna (dataskyddsombud). Google och dess underbiträden ska in i underbiträdeslistan i PUB-avtalet med Botkyrka innan riktiga personuppgifter. Vertex AI tränar inte på kunddata.
6. **Modell och prislista** – välj Gemini Flash-modellens id i *Vertex AI → Model Garden* (samma stavning som där) → **`MM_AI_MODEL`**. Kostnaden i `ai_runs` räknas från **`MM_AI_PRICES`** i öre per miljon token enligt Googles prislista för EU-endpointen (inklusive EU-påslaget), till exempel `{"audioIn":1100,"textIn":330,"output":2750}` – kontrollera de aktuella priserna.
7. **Ingen lagring hos Google** – stäng av Vertex AI:s cachning av indata för projektet (Googles dokumentation "Vertex AI and zero data retention": `cacheConfig` med `disableCache: true`, görs av en administratör med `gcloud`/API) och kontrollera villkoren för missbruksövervakning i samma dokumentation.
8. **Budget** – *Billing → Budgets & alerts*: en månadsbudget (t.ex. 1 000 kr) med larm till bolagets funktionsadress. SPEC §8.6: cirka 1,70 kr per 30-minuterssamtal.
9. **Vercel** – sätt `MM_AI_PROVIDER=vertex`, `MM_AI_MODEL`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_SERVICE_ACCOUNT_KEY` och `MM_AI_PRICES` (avsnitt 5) och driftsätt igen.
10. **Kontroll** – spela in en kort testavstämning i testmiljön (agera som coachen Amira, ärendet BOT-26-0143 som har samtycke). Efter en stund: `select provider, model, status, audio_seconds, cost_ore, input_deleted_at from ai_runs order by created_at desc limit 1;` ska visa `vertex_eu`, status `succeeded` och en tid i `input_deleted_at` (ljudet raderat). `select status from audio_uploads order by created_at desc limit 1;` ska visa `deleted`. Vercels logg ska inte visa `ai: AI-stödet är avstängt`.

**Tidsgränser:** alla rutter har `maxDuration` **högst 60 sekunder** (`/api/rpc`, `/api/jobs/run`, `/api/staging/seed`) – teamet kan vara på Vercels Hobby-nivå, där en högre gräns stoppar hela driftsättningen. Transkriberingen körs direkt efter svaret (after(), inom `/api/rpc`:s 60 sekunder) och annars av `/api/jobs/run` (cron varje minut). Avbryts ett jobb vid tidsgränsen står det kvar i `running` och tas upp igen efter **fem minuter** (`STALE_MINUTES` i `src/server/jobs/runner.ts`); avbryts även femte försöket ges jobbet upp (`failed`, "Jobbet avbröts innan det blev klart …", coachen ser "Inspelningen är för lång för att transkriberas" och fyller i själv) – inget jobb blir hängande. Korta inspelningar (kommunen och deltagaren, högst 5 minuter) och de flesta avstämningar klarar sig inom 60 sekunder. **Långa inspelningar (över cirka 10 minuter) kan behöva Vercel Pro med `maxDuration` 300** för `/api/rpc` och `/api/jobs/run` – höj då också `STALE_MINUTES` till minst 10. Längsta inspelning styrs av avtalet (`ai.maxMinutes`, Botkyrka: coachen 60, kommunen och deltagaren 5 minuter). Ljud över cirka 15 MB (ungefär en timme i 32 kbit/s) transkriberas inte.


## 11. Testarna och synpunkter (beslut 2026-10-01 – historik, gäller testmiljön)

*Sedan 2026-10-08 är de sju kollegorna vanliga användare i produktion (`is_tester = false`, titel Systemadministratör) och nya kollegor läggs till i appen ("Skarp drift" överst). Testarfunktionen nedan används igen när testmiljön test.miljonmatch.se finns.*

Karim bjuder in kollegor på Miljonbemanning att testa testmiljön och ge synpunkter på processen och plattformen. **Testmiljön är inte färdig** – säg det när ni bjuder in, och be dem använda **Lämna synpunkt**.

### 11.1 Testarna

| Namn | Adress | Profil |
|---|---|---|
| Karim Khalil | `karim.khalil@miljonbemanning.se` | `tester-karim` |
| Ali Khalil | `ali.khalil@miljonbemanning.se` | `tester-ali` |
| Sara Salah | `sara.salah@miljonbemanning.se` | `tester-sara` |
| Adam Abdalla | `adam.abdalla@miljonbemanning.se` | `tester-adam` |
| Shafik Muwanga | `shafik.muwanga@miljonbemanning.se` | `tester-shafik` |
| Moda Habib | `moda.habib@miljonbemanning.se` | `tester-moda` |
| Yacine Laghmari | `yacine.laghmari@miljonbemanning.se` | `tester-yacine` |

Alla är systemadministratörer i Botkyrkaavtalet (det enda avtalet i testdatat) och testare (`is_tester = true`, `TESTERS` i `src/data/supabase/seed-rows.ts`). De loggar in som sig själva och väljer testperson i "Agera som".

**Testare utan priser (beslut 2026-10-02):** bara Karim och Ali (`FULL_ACCESS_TESTERS` i `src/api/tester-access.ts`) ser allt. Alla andra testare – också de som läggs till senare – ser inga priser, belopp i kronor, fakturaunderlag, viten i kronor, bonusunderlag eller Miljonbemannings interna mål, vilken testperson de än agerar som. Avtalssidan (`/admin/avtal`, alla flikar) och Ekonomi är stängda ("Den här sidan visas inte för testare."), rollen ekonom finns inte i "Agera som", och på andra sidor står "Visas inte för testare" där beloppet annars står. Internt mål betyder alla Miljonbemannings egna mål: resultatgraden (35 %), SLA-nyckeltalen, dokumentationstiden och pulsmätningens svarsfrekvens. På `/admin/integrationer` ser de bakgrundsjobben och integrationskorten, men inte underbiträdena, regionlåsningen, "Så ser kommunen det" eller leverantörernas namn och regioner i korten. I revisionsloggen ser de att någon arbetat med faktureringen, men inte detaljerna. Avtalsmålet (32 %) visas för alla. Spärren ligger i Next-servern (frågorna nekas eller saknar fälten) – inte i databasen: med sin egen inloggning direkt mot Supabase (PostgREST) har en testare testpersonens rättigheter enligt RLS. Ska en testare se allt: lägg till profilens id i `FULL_ACCESS_TESTERS`.

**Så här kommer de in (du och samordnaren):**
1. **Vercel → Settings → Environment Variables → `MM_EMAIL_ALLOWLIST`** (Production och Preview) – byt värdet till exakt (hela adresser, kommatecken emellan, inga mellanslag):
   `karim.khalil@miljonbemanning.se,ali.khalil@miljonbemanning.se,sara.salah@miljonbemanning.se,adam.abdalla@miljonbemanning.se,shafik.muwanga@miljonbemanning.se,moda.habib@miljonbemanning.se,yacine.laghmari@miljonbemanning.se`
   Använd **inte** `@miljonbemanning.se`: testdatat har påhittade adresser på den domänen (t.ex. `sara.lindqvist@miljonbemanning.se`), och de skulle då kunna få mejl och inloggningskoder.
2. **Vercel → `MM_EMAIL_FROM`** = `Miljonmatch <notis@miljonmatch.se>` och **`RESEND_API_KEY`** med sändrätt för miljonmatch.se (avsnitt 4) – appen skickar både notiserna och inloggningskoderna med dem (beslut 2026-10-02). SMTP-inställningen i Supabase används inte längre (reserv, avsnitt 2.1).
3. **Driftsätt igen** (*Deployments → Redeploy*) – variablerna läses när appen startar.
4. **Profilerna:** samordnaren kör `supabase/bootstrap-staging.sql` igen (idempotent – tömmer ingenting, behåller inloggningarna) – eller en testare väljer **Läs in testdata på nytt** (lägger också till testare som saknas, men nollställer allt som testats).
5. Kontroll: `select id, email, is_tester from public.profiles where is_tester order by id;` ska visa sju rader. Be en av kollegorna logga in på `https://www.miljonmatch.se/logga-in`.

**Så kontrolleras det i koden** (`src/server/auth/service.ts`, `eligibleForCode`, testat i `src/server/auth/eligible.test.ts`): en inloggningskod skickas bara när (1) adressen finns i `MM_EMAIL_ALLOWLIST` – i testmiljön får ingen kod om listan är tom – och (2) det finns en **aktiv profil** med den adressen, (3) med minst en roll och (4) på en tillåten domän (personalens `MM_STAFF_EMAIL_DOMAINS`, kommunens i databasen). Svaret på "Skicka kod" är alltid detsamma. Appens egna mejl går i testmiljön också bara till adresserna i listan (`src/server/notify`).

### 11.2 Lämna synpunkt

- I raden **Testmiljö** överst: **Lämna synpunkt** öppnar en dialog (Gäller: den här sidan eller hela Miljonmatch · Typ · Hur viktigt? · Vad tycker du?). Synpunkten sparas med rollen testaren agerar som och sidan (bara sökväg och id:n – aldrig namn, personnummer eller fritext; engångslänkarnas token maskeras). Bekräftelse: "Tack! Synpunkten är sparad."
- **Alla synpunkter** visar allas synpunkter, nyast först (filtrera på status och typ, svara, ändra status med **Spara status**) och **Ladda ner (CSV)** (semikolon, UTF-8, skydd mot formler – öppnas i Excel). I filen står hela namnet på den som skrev, **Tid** (riktig tid, sätts av databasen) och **Testdatum** (testklockan). **Gå till sidan** syns när testpersonen du agerar som får öppna sidan – annars står det vilken roll synpunkten lämnades som (byt i "Agera som").
- Bara testare i testmiljön: servern (`ctx.actor.testerId`, samma regel som "Agera som") och RLS (`mm.auth_is_tester()`) kontrollerar det. I produktion finns funktionen inte. Inga mejl om synpunkter. Revisionsloggen får `feedback.created`, `feedback.replied` och `feedback.status_changed` (bara id:n).
- **Synpunkterna finns kvar** när testdatat läses in på nytt (0017 ändrar `mm.reset_test_data()`), och seeden rör dem inte.
- Tiden på en synpunkt är testklockans (testtid, t.ex. 1 februari 2027), som allt annat i testmiljön.
- Prototypen (artefakten) har kvar sin egen feedback i claude.ai med samma fält och texter.

---

## 12. Mejlinläsning från avrop@ – Microsoft Graph (beslut 4c, 2026-10-08)

Appen läser brevlådan **avrop@miljonbemanning.se** varannan minut (jobbet `inbox_import`, `docs/UTSKICK.md`): olästa mejl i Inkorgen hämtas, tolkas, blir rader i avropsinkorgen (och ärenden med ordererkännande när avropet går att tolka) och flyttas till mappen **Inläst**, där de ligger kvar som reserv. Ingenting raderas i brevlådan. Tills brevlådan är kopplad säger kortet *avrop@-brevlådan* på `/admin/integrationer` "Inte kopplad – så här kopplar du", och samordnaren registrerar mejlavrop för hand (*Avropsinkorg → Registrera beställning*).

**Så kopplar du (en gång, ca 20 minuter). Du behöver vara global administratör i Miljonbemannings Microsoft 365.**

1. **Appregistrering.** [entra.microsoft.com](https://entra.microsoft.com) → *Identitet → Program → Appregistreringar → Ny registrering*. Namn `Miljonmatch avrop-inläsning`, *Endast konton i den här organisationskatalogen*, ingen omdirigerings-URI. Anteckna **Program-id (klient)** och **Katalog-id (klientorganisation)** från översikten.
2. **Behörighet.** *API-behörigheter → Lägg till en behörighet → Microsoft Graph → Programbehörigheter* → `Mail.ReadWrite` (appen läser och flyttar mejl – ingen delegerad behörighet, ingen användare loggar in). Klicka sedan **Bevilja administratörsmedgivande för Miljonbemanning**. Ta bort `User.Read` om den lades till automatiskt.
3. **Begränsa till brevlådan avrop@** (annars når appen alla brevlådor i tenanten). I Exchange Online PowerShell (`Install-Module ExchangeOnlineManagement`, `Connect-ExchangeOnline`):
   ```powershell
   New-DistributionGroup -Name "Miljonmatch avrop-inlasning" -Type Security -PrimarySmtpAddress miljonmatch-avrop@miljonbemanning.se
   Add-DistributionGroupMember -Identity "Miljonmatch avrop-inlasning" -Member avrop@miljonbemanning.se
   New-ApplicationAccessPolicy -AppId <Program-id> -PolicyScopeGroupId miljonmatch-avrop@miljonbemanning.se -AccessRight RestrictAccess -Description "Miljonmatch far bara lasa avrop@"
   Test-ApplicationAccessPolicy -Identity avrop@miljonbemanning.se -AppId <Program-id>   # AccessCheckResult: Granted
   Test-ApplicationAccessPolicy -Identity karim.khalil@miljonbemanning.se -AppId <Program-id>   # Denied
   ```
   Policyn slår igenom inom ungefär en halvtimme. (Är avrop@ en delad brevlåda fungerar samma kommandon.)
4. **Hemlighet.** *Certifikat och hemligheter → Ny klienthemlighet* (giltig högst 24 månader – lägg in ett datum i kalendern för bytet). Kopiera **värdet** direkt; det visas bara en gång.
5. **Vercel.** *Settings → Environment Variables* (Production): `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` (hemlig), `MM_INBOX_MAILBOX=avrop@miljonbemanning.se`, `MM_INBOX_DONE_FOLDER=Inläst` (avsnitt 5). Hemligheten skrivs aldrig i repot, chatten eller ett mejl. *Redeploy*.
6. **Kontroll.** Inom två minuter visar kortet *avrop@-brevlådan* **Kopplad** med "Senast läst". Skicka ett testmejl till avrop@ från en adress på botkyrka.se (eller från en kollega – då blir det "Övrigt"): det ska flyttas till Inläst och synas i avropsinkorgen. `select kind, status, last_error from jobs where kind = 'inbox_import' order by created_at desc limit 5;` ska visa `done`.

**Dataskydd.** Mejlen ligger kvar i Microsoft 365 (Miljonbemannings EU-tenant); appen läser dem från Vercels funktioner i Stockholm (arn1) och sparar text, tolkade uppgifter och bilagor i Supabase (eu-north-1). Microsoft är redan underbiträde (inloggning och brevlådan); behörigheten är begränsad till en brevlåda. Inga adresser, ämnesrader eller mejltexter hamnar i loggar, felorsaker eller i jobbtabellen – bara steg och HTTP-status.

**Felsökning**

| Kortet eller jobbet säger | Kontrollera |
|---|---|
| Inte kopplad | Någon av de fyra variablerna saknas i Vercel (Production), eller driftsättningen gjordes före ändringen |
| `inloggningen svarade 401/400` | Fel klient-id, hemlighet eller katalog-id; hemligheten har gått ut |
| `listningen svarade 403` | Administratörsmedgivandet saknas, eller ApplicationAccessPolicy nekar (kör `Test-ApplicationAccessPolicy`) |
| `listningen svarade 404` | `MM_INBOX_MAILBOX` stavad fel, eller brevlådan är inte en Exchange-brevlåda |
| `svarade 429` / `5xx` / `kunde inte nås` | Tillfälligt – jobbet försöker igen (1, 5, 15, 60 minuter) |
| Mejl ligger kvar olästa i Inkorgen | Jobbkörningen står still (pg_cron, `docs/UTSKICK.md`) eller flytten misslyckas (`moveErrors` i kortet) – raderna finns redan, bara flytten görs om |
| Ett avrop blev "att registrera för hand" | Mallens etiketter saknades eller personnumret hade fel format – samordnaren klickar *Registrera beställningen* i inkorgen |

## 13. SMS och utringning till deltagare – 46elks (beslut 2026-10-09)

Kallelsen till första mötet och inbjudan till en aktivitet går till deltagaren med **e-post** (om adressen finns), **SMS** (om SMS är kopplat och telefonnumret finns) och **utringning** med en kort inspelning (dessutom, om den är kopplad och telefonnumret finns). Deltagarens valda kontaktväg går först. En kanal räknas bara när utskicket når fram: e-post som `MM_EMAIL_ALLOWLIST` stoppar och nummer som inte går att tolka räknas inte (de sparas i utskicksloggen med orsak). Finns ingen kanal får samordnaren en uppgift i Min vecka: "Ring deltagaren och kalla till första mötet – ärende BOT-…, tid, plats. Kallelsen kunde inte skickas: …" (aldrig namnet, adressen eller numret). Stoppas eller misslyckas utskicket först när det skickas (t.ex. 46elks avvisar numret) och inget annat SMS eller mejl i samma utskick gick, skapar jobbet samma uppgift. Bokas mötet om och kallelsen går ut med någon kanal stängs en öppen uppgift med den gamla tiden. Den som bokar ser "Kallelsen skickas med e-post." – utskicket ligger i kön tills jobbet har skickat det. Koden: `src/features/_shared/participant-notify.ts` (`notifyParticipant`), `src/server/notify/elks.ts` (46elks), `src/server/notify/config.ts` (variablerna).

Texten innehåller bara tid, plats och Miljonbemannings telefonnummer – aldrig namn, personnummer, ärendenummer eller vad insatsen gäller. Inspelningen säger bara att det finns en inbjudan och att tid och plats står i SMS:et eller mejlet (`public/ljud/README.md`). Samtalet ringer därför först när SMS:et eller mejlet har gått iväg; gick inget av dem stoppas samtalet ("Inget SMS eller mejl gick iväg – samtalet ringdes inte").

**Tills variablerna finns** är SMS och utringning avstängda: utskicken sparas i utskicksloggen som *Stoppat* med orsaken "SMS-leverantör inte vald" eller "Utringning inte kopplad", och korten **SMS (46elks)** och **Utringning (46elks)** på `/admin/integrationer` säger *Inte kopplad* och vilka variabler som saknas (bara namnen). Kallelsen går då med e-post när adressen finns, annars får samordnaren uppgiften.

**Innan riktiga deltagare får SMS eller samtal**

1. **Personuppgiftsbiträdesavtal** med 46elks AB (svenskt bolag, data i EU) ska vara tecknat.
2. **Botkyrka ska godkänna underbiträdet** – 46elks står i PUB-avtalets förteckning (`/admin/integrationer`, *Underbiträden*: "46elks (SMS och utringning)", status *Vald*). 46elks får telefonnumret och texten (tid, plats, telefonnummer) – inga namn eller personnummer.
3. Kontrollera hur länge 46elks sparar sin logg över SMS och samtal, och skriv in det i förteckningen.

**Så kopplar du (ca 15 minuter)**

1. **Konto.** Skapa ett företagskonto på [46elks.se](https://46elks.se) för Miljonbemanning och fyll på krediter. Slå på tvåstegsinloggning och lägg till minst två administratörer.
2. **API-uppgifter.** I 46elks *Dashboard → Account* finns **API username** (börjar med `u`) och **API password**. Lösenordet är hemligt: bara i Vercel, aldrig i repot, chatten eller ett mejl.
3. **Avsändare för SMS.** `MM_SMS_FROM` = avsändarnamnet som visas i telefonen, 3–11 bokstäver eller siffror som börjar med en bokstav (standard `Miljonbem`). Deltagaren kan inte svara på ett avsändarnamn – texten säger därför "Frågor? Ring 08-…".
4. **Nummer för utringning.** Köp ett svenskt nummer med röst hos 46elks (*Numbers*) och skriv det som `MM_CALL_FROM` (`+46…`).
5. **Inspelningen.** Spela in meddelandet (`public/ljud/README.md`), lägg filen som `public/ljud/kallelse.mp3`, driftsätt, och kontrollera att `https://www.miljonmatch.se/ljud/kallelse.mp3` spelas upp utan inloggning (`/ljud/` är öppen i `src/proxy.ts`). Sätt `MM_CALL_AUDIO_URL` till adressen (måste börja med `https://`).
6. **Vercel.** *Settings → Environment Variables* (Production): `MM_SMS_PROVIDER=46elks`, `ELKS_API_USERNAME`, `ELKS_API_PASSWORD` (hemlig), `MM_SMS_FROM`, `MM_CALL_FROM`, `MM_CALL_AUDIO_URL`. Vill du först prova med ditt eget nummer: `MM_SMS_ALLOWLIST=+4670…` (då får bara numren i listan SMS och samtal, också i produktion). *Redeploy*.
7. **Kontroll.** Korten **SMS (46elks)** och **Utringning (46elks)** visar *Kopplad*. Boka ett första möte i ett ärende där ditt eget nummer står (med `MM_SMS_ALLOWLIST` satt): SMS:et kommer, samtalet spelar inspelningen, och utskicksloggen (`/admin/mallar` → *Utskickslogg*) visar *Skickat*. 46elks id sparas i `outbound_messages.provider_message_id`. Töm sedan `MM_SMS_ALLOWLIST` när deltagarna ska få SMS.

SMS kopplas med `MM_SMS_PROVIDER`, `ELKS_API_USERNAME` och `ELKS_API_PASSWORD`. Utringningen kräver dessutom `MM_CALL_FROM` och `MM_CALL_AUDIO_URL` – saknas någon av dem görs inga samtal, men SMS:en går.

**E-post till deltagare.** Kallelsens mejl går till deltagarens egen adress, som ofta är privat. `MM_EMAIL_ALLOWLIST` gäller också dem: med `@miljonbemanning.se,@botkyrka.se` stoppas kallelsens mejl till en privat adress ("Testmiljön: mottagaren finns inte i MM_EMAIL_ALLOWLIST"). Kanalvalet vet det redan när mötet bokas (`ctx.messaging.emailReaches`, samma regel som utskicket): e-posten räknas inte som kanal, och utan kopplat SMS får samordnaren en uppgift att ringa deltagaren – bekräftelsen i avropsinkorgen visar uppgiften. Deltagarna får kallelsen med e-post först när listan är tom.

**Testmiljön.** Samma regler som för e-posten (`docs/UTSKICK.md`): i testmiljön får bara numren i `MM_SMS_ALLOWLIST` SMS och samtal. Med `MM_SMS_REDIRECT_TO` (ett nummer som också står i listan, bara när `app_settings.environment = 'staging'`) går SMS och samtal till testpersoner i stället till testaren; SMS:et börjar med "[Testmiljö] Skulle ha gått till deltagaren i ärende …". Ignoreras i produktion.

**Säkerhet i koden.** Numret slås upp via ärendet precis innan utskicket skickas – utskicksloggen har bara "deltagare (SMS)". Numret normaliseras till `+46…`; ett nummer som inte går att tolka ger *Kunde inte skickas* med orsaken "Telefonnumret har fel format" (aldrig numret). 46elks felsvar tvättas från nummer, adresser och meddelandets text. 46elks har ingen nyckel mot dubbletter: utskicket markeras innan anropet, och ett försök som avbröts mitt i skickas aldrig igen automatiskt (hellre ett SMS för lite än samma SMS två gånger). Vilande spärr: skyddade personuppgifter får inga SMS, samtal eller mejl.

**Felsökning**

| Utskicksloggen säger | Kontrollera |
|---|---|
| Stoppat – SMS-leverantör inte vald / Utringning inte kopplad | Variablerna saknas eller har fel format i Vercel (Production) – kortet på `/admin/integrationer` säger vilka. Driftsätt igen efter ändringen |
| Kunde inte skickas – 46elks nekade inloggningen (401) | Fel `ELKS_API_USERNAME` eller `ELKS_API_PASSWORD` |
| Kunde inte skickas – 46elks svarade 402 | Slut på krediter – fyll på i 46elks. Utskicket försöker igen (1, 5, 15, 60 minuter) |
| Kunde inte skickas – 46elks svarade 400 (…) | 46elks avvisade numret eller avsändaren (`MM_SMS_FROM`, `MM_CALL_FROM`) |
| Kunde inte skickas – Telefonnumret har fel format | Deltagarens nummer går inte att tolka (t.ex. utan nolla först) – samordnaren har fått en uppgift att ringa; be handläggaren om rätt nummer. Portalen och registreringen godkänner bara nummer som går att skicka till |
| Stoppat – Inget SMS eller mejl gick iväg – samtalet ringdes inte | SMS:et och mejlet i samma utskick stoppades eller misslyckades – samordnaren har fått en uppgift att ringa |
| Stoppat – Mottagaren saknar telefonnummer | Deltagaren har inget nummer |
| Stoppat – Testmiljön: numret finns inte i MM_SMS_ALLOWLIST | Spärrlistan är satt (testmiljön, eller ett prov i produktion) |
| Kunde inte skickas – 46elks svarade inte i tid / Osäkert om utskicket gick iväg | Anropet kan ha kommit fram. Titta i 46elks logg innan du skickar igen eller ringer |
| Samtalet tystnar direkt | `MM_CALL_AUDIO_URL` går inte att nå utan inloggning, eller filen är inte MP3/WAV |
