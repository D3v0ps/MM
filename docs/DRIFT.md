# Drift – så sätter du upp testmiljön (och senare produktion)

*Version 2026-09-30. Testmiljön har bara påhittade testdata. Produktion byggs på samma sätt, men i ett eget Supabase-projekt och ett eget Vercel-projekt (se avsnitt 7).*

## Översikt

```
Webbläsaren ──► Vercel (Next.js, funktioner i Stockholm, arn1) ──► Supabase (Postgres + inloggning, Stockholm, eu-north-1)
                        │                                                  │
                        └──► Resend (e-post, EU) ◄── Supabase Auth skickar inloggningskoden via Resend (SMTP)

Appens adress:  test.miljonmatch.se (testmiljön, först Vercels egen adress *.vercel.app) · app.miljonmatch.se (produktion)
                DNS för miljonmatch.se hos one.com – en CNAME per underdomän. www.miljonmatch.se rörs inte.
E-post från:    notis@miljonbemanning.se via Resend (EU). DNS för miljonbemanning.se i Google Cloud DNS (Terraform).
```

- Webbläsaren pratar **bara** med Vercel. Supabase-nycklarna och nycklarna för personnummer finns bara på servern.
- Inloggning: e-post + sexsiffrig kod (SPEC §4). Koden gäller 10 minuter och får prövas 5 gånger. Man loggas ut efter 60 minuter utan aktivitet och alltid efter 12 timmar. Microsoft-inloggning för personalen kommer senare.
- Testmiljön kör på **testtid**: klockan börjar på måndag 1 februari 2027 kl. 09.12 när testdatat läses in och går sedan i vanlig takt.
- I testmiljön får **bara** adresserna i `MM_EMAIL_ALLOWLIST` (testarna) mejl – även inloggningskoder. Testdatat innehåller adresser på riktiga domäner (t.ex. botkyrka.se) som aldrig får få mejl. Med `MM_EMAIL_REDIRECT_TO` går testpersonernas mejl i stället till en testare, märkta med vem de skulle ha gått till.
- Testarna (Karim och Ali) loggar in som sig själva och väljer sedan vilken testperson de agerar som i raden överst ("Agera som"). Det fungerar bara i testmiljön.

## Läget 2026-09-30

| Del | Status |
|---|---|
| Supabase-projekt för testmiljön | Klart: `miljonmatch`, ref **`blxupsebzzhmjitaywev`**, eu-north-1 (Stockholm), `https://blxupsebzzhmjitaywev.supabase.co` |
| Migrationer 0001–0014 | Applicerade i testprojektet av samordnaren (steg 1 nedan). **0013 går live samtidigt som koden** |
| Startdata och testdata | Inte inlästa. Startdatat (`supabase/bootstrap-staging.sql`) körs av samordnaren, resten läser testaren in i appen |
| Supabase Auth | Inställt: självregistrering av, e-postkod med 6 siffror som gäller 10 minuter, egen SMTP via Resend. Kontrollera URL:erna (avsnitt 2.2) |
| Resend | Domänen `miljonbemanning.se` verifierad i EU. DNS-posterna ligger i Google Cloud DNS-zonen för miljonbemanning.se – de ska också in i Terraform-koden |
| Vercel | Inte uppsatt (avsnitt 3) |
| Domän `test.miljonmatch.se` | Inte uppsatt (avsnitt 3.4) |
| AI (Gemini via Vertex AI, EU) | Inte uppsatt – testmiljön kör den simulerade leverantören tills kontot finns (avsnitt 10). Bucketen `ljud` skapas av migration 0015 |

## Vem gör vad

| Steg | Vem | Varför |
|---|---|---|
| Konton hos Vercel, Resend (och Supabase-projektet i bolagets organisation) | Du | Kontona ska ägas av Miljonbemanning AB, med MFA och minst två administratörer |
| DNS-poster: miljonmatch.se hos one.com, miljonbemanning.se i Google Cloud DNS (Terraform) | Du | Kräver inloggning hos one.com respektive Terraform |
| Nycklar (Supabase secret key, Resend-nyckel, nycklar för personnummer och jobb) in i Vercel | Du | Hemliga nycklar ska aldrig skrivas i chatten eller i repot |
| Migrationer och startdata i databasen | Samordnaren (Claude via Supabase-kopplingen) eller du | Kan göras med MCP, Supabase CLI eller SQL-editorn |
| Testdatat | Testaren i appen (`/admin/integrationer` → "Läs in testdata på nytt") | Filen med hela testdatat är för stor för MCP och SQL-editorn |
| Google Cloud-projekt, tjänstekonto och nyckel för AI (Vertex AI) | Du | Kontot ska ägas av Miljonbemanning AB; nyckeln är hemlig (avsnitt 10) |

---

## Så startar du testmiljön – exakt ordning

1. **Migrationerna 0001–0014** – samordnaren: redan applicerade i testprojektet (MCP `apply_migration` med namnet utan `.sql`, t.ex. `0014_kvittenser`, i nummerordning – eller `npx supabase db push`, eller SQL-editorn). Kontroll: MCP `list_migrations` visar 0001–0014.
   **0013 måste gå live samtidigt som koden.** Efter 0013 läser appen ärenden via vyn `cases_public`, och inloggade kan bara läsa kolumnen `id` direkt i `cases`. En version av appen från före 0013 kan då inte läsa ärenden, och den här versionen fungerar inte utan 0013. Driftsätt därför koden (steg 4) i samma veva som 0013 – aldrig en äldre version mot databasen.
2. **Vercel-import** – du: *Add New → Project → Import* GitHub-repot `miljonmatch` i bolagets team (Pro). Avsnitt 3.1.
3. **Miljövariabler** – du: lägg in alla variabler i tabellen i avsnitt 5 (för *Production* och *Preview*). Skapa de hemliga nycklarna enligt tabellen.
4. **Deploy** – du: *Deployments → Redeploy* (eller första driftsättningen efter importen). Kontrollera att funktionerna körs i **arn1**. Notera adressen, t.ex. `https://miljonmatch-test.vercel.app`.
5. **URL:erna i Supabase Auth** – du: *Site URL* och *Redirect URLs* för Vercel-adressen (avsnitt 2.2). Sätt `MM_APP_URL` till samma adress och driftsätt igen om du ändrade den.
6. **Startdata** – samordnaren: kör `supabase/bootstrap-staging.sql` (ca 16 kB) med MCP `execute_sql` (eller SQL-editorn). Den lägger in organisationer, avtal, avtalsområden, prislistor, helgdagar, testarna Karim och Ali (admin, testare) och `app_settings` (`environment = staging`, testklockan). Den kan köras igen och stoppar sig själv utanför testmiljön.
7. **Kontroll** – samordnaren: `select * from app_settings;` ska visa `environment = staging` och två rader `clock_…`; `show timezone;` ska ge `Europe/Stockholm`; `select id, email, is_tester from profiles;` ska visa de två testarna.
8. **Första inloggningen** – testaren: öppna `https://<adressen>/logga-in`, skriv `karim.khalil@miljonbemanning.se` → *Skicka kod* → skriv koden från mejlet → *Logga in*.
9. **Testdatat** – testaren (som sig själv, rollen admin): gå till **Underbiträden och integrationer** (`/admin/integrationer`) → **Läs in testdata på nytt** → bekräfta. Det tar 10–30 sekunder. Sidan laddas om, testklockan står på måndag 1 februari 2027 kl. 09.12 och alla testpersoner finns i "Agera som".
10. **Egen domän** – du, när ni vill: `test.miljonmatch.se` (avsnitt 3.4).

Knappen **Läs in testdata på nytt** kan användas när som helst för att börja om. Allt som testats nollställs för alla testare; revisionsloggen och testarnas inloggning finns kvar. Knappen syns bara för testare i testmiljön.

---

## 1. Supabase – databasen

Projektet finns redan (se `docs/MILJOER.md`): ref `blxupsebzzhmjitaywev`, region **eu-north-1 (Stockholm)**. Kontrollera regionen under *Project Settings → General*.

1. **Migrationerna** ligger i `supabase/migrations/` (0001–0014). I testprojektet är de redan applicerade av samordnaren. **0013 måste gå live samtidigt som koden** (se steg 1 i "exakt ordning" ovan). Kör dem i ordning: MCP `apply_migration`, eller
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

---

## 2. Supabase – inloggning (Authentication)

Redan inställt i testmiljön 2026-09-30. Tabellen är facit – kontrollera den, och gör likadant i produktion.

### 2.1 Inställningar

| Var | Inställning | Värde |
|---|---|---|
| *Sign In / Providers → User Signups* | Allow new users to sign up | **Av** (ingen självregistrering – servern skapar konton för inbjudna profiler) |
| *Sign In / Providers → Email* | Enable Email provider | På |
| | Confirm email | På (kontona skapas redan bekräftade) |
| | Email OTP Length | **6** |
| | Email OTP Expiration | **600** sekunder (10 minuter) |
| *Emails → Templates → Magic link* (och *Confirm signup*) | Ämne | `Din inloggningskod till Miljonmatch` |
| | Innehåll | Hela filen `supabase/templates/otp.html`. Mallen visar bara koden (`{{ .Token }}`), att den gäller 10 minuter och att man kan strunta i mejlet – **ingen** länk (e-postskydd som Safe Links förbrukar länkar) |
| *Emails → SMTP Settings* | Enable custom SMTP | På |
| | Sender email / name | `notis@miljonbemanning.se` / `Miljonmatch` |
| | Host / Port | `smtp.resend.com` / `465` |
| | Username / Password | `resend` / Resends API-nyckel för SMTP (avsnitt 4.3) |
| *Rate Limits* | Rate limit for sending emails | Standard (30 per timme) räcker för test |

Supabase Auths egna gränser för sessioner behövs inte – appen loggar ut efter 60 minuters inaktivitet och 12 timmar (`src/proxy.ts`).

Med Supabase CLI (lokalt) läggs mallen in i `supabase/config.toml`:
```toml
[auth.email.template.magic_link]
subject = "Din inloggningskod till Miljonmatch"
content_path = "./supabase/templates/otp.html"
```

### 2.2 URL:er (*Authentication → URL Configuration*)

| Inställning | Testmiljön | Produktion (senare) |
|---|---|---|
| Site URL | Först Vercels adress, t.ex. `https://miljonmatch-test.vercel.app`. När domänen finns: `https://test.miljonmatch.se` | `https://app.miljonmatch.se` |
| Redirect URLs | `https://*.vercel.app/**` (eller den exakta Vercel-adressen med `/**`), `https://test.miljonmatch.se/**`, `http://localhost:3000/**` | `https://app.miljonmatch.se/**` |

Inloggningen använder kod, inte länk, så URL:erna används bara av Supabase för säkerhetskontroller – men de ska ändå stämma.

---

## 3. Vercel (appen)

### 3.1 Projektet
1. Bolagets team i Vercel. **Vercels gratisnivå (Hobby) får inte användas kommersiellt** – bolaget behöver **Pro**.
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

### 3.4 Egen domän: `test.miljonmatch.se`
DNS för **miljonmatch.se** ligger hos **one.com**. Rör inte `www.miljonmatch.se` (befintlig webbplats) eller domänens namnservrar.
1. Vercel: *Settings → Domains → Add* `test.miljonmatch.se`. Vercel visar ett CNAME-värde (t.ex. `cname.vercel-dns.com` eller ett projektunikt värde).
2. one.com: *DNS-inställningar* för miljonmatch.se → lägg till en **CNAME**-post med namnet `test` och **exakt** värdet Vercel visar.
3. Vänta tills Vercel visar *Valid Configuration* (certifikatet skapas automatiskt).
4. Ändra `MM_APP_URL` i Vercel till `https://test.miljonmatch.se` och *Site URL* i Supabase Auth (avsnitt 2.2). Driftsätt igen.

Produktion får på samma sätt `app.miljonmatch.se` (CNAME `app` hos one.com) i sitt eget Vercel-projekt.

---

## 4. Resend (e-post)

### 4.1 Konto
Bolagets funktionsadress, MFA och en andra administratör (*Settings → Team*). **Teckna Resends personuppgiftsbiträdesavtal (DPA) före produktion** – Resend hanterar mottagarnas e-postadresser.

### 4.2 Domän och DNS
- Domänen `miljonbemanning.se` är verifierad i Resend med region **EU (Ireland, eu-west-1)**. Regionen går inte att ändra i efterhand.
- DNS för **miljonbemanning.se** ligger i **Google Cloud DNS** och styrs av **Terraform** (inte one.com). Resends poster är redan inlagda i zonen: `MX send` (`feedback-smtp.eu-west-1.amazonses.com`, prioritet 10), `TXT send` (`v=spf1 include:amazonses.com ~all`) och `TXT resend._domainkey` (DKIM). **Lägg in samma poster i Terraform-koden**, annars tas de bort vid nästa `terraform apply`.
- Ändra inte domänens befintliga MX-, SPF- eller DKIM-poster för Microsoft 365. Resends poster ligger på underdomänen `send` och en egen DKIM-nyckel.
- *Domains → miljonbemanning.se → Configuration*: stäng av **Click tracking** och **Open tracking** (spårning skriver om länkar och lägger in en pixel – ett analysverktyg, CLAUDE.md).

### 4.3 API-nycklar
*API Keys → Create API key*, två nycklar med **Sending access** och bara domänen `miljonbemanning.se`:
1. `supabase-smtp` → lösenordet under *SMTP Settings* i Supabase (avsnitt 2.1).
2. `miljonmatch-app` → `RESEND_API_KEY` i Vercel.

Avsändaren `notis@miljonbemanning.se` behöver ingen brevlåda för att skicka. Svar går dit om inte `MM_EMAIL_REPLY_TO` är satt – i produktion sätts den till `avrop@miljonbemanning.se`, så att svar på ordererkännandet hamnar i avropsflödet.

---

## 5. Alla miljövariabler (Vercel)

Inga hemligheter i tabellen – exempelvärdena är påhittade eller publika. **Hemliga** värden sätts bara i Vercel (aldrig med prefixet `NEXT_PUBLIC_`, aldrig i repot eller chatten). Samma lista med förklaringar finns i `.env.example`.

| Namn | Hemlig | Förklaring | Exempel (testmiljön) | Var värdet finns |
|---|---|---|---|---|
| `MM_BACKEND` | | Körläge: `memory` (påhittade testdata i minnet – lokalt och e2e) eller `supabase` (testmiljön och produktion) | `supabase` | Fast värde |
| `MM_CLOCK` | | Tomt = testtid när `app_settings` har testklockans epoker. `real` = riktig tid | *(tomt)* · produktion `real` | Fast värde |
| `MM_APP_URL` | | Appens adress utan `/` på slutet – länkarna i mejlen | `https://test.miljonmatch.se` (först `https://miljonmatch-test.vercel.app`) | Vercel → *Domains* |
| `SUPABASE_URL` | | Supabase-projektets adress (`NEXT_PUBLIC_SUPABASE_URL` från Vercels Supabase-integration fungerar också) | `https://blxupsebzzhmjitaywev.supabase.co` | Supabase → *Project Settings → API* · `docs/MILJOER.md` |
| `SUPABASE_PUBLISHABLE_KEY` | | Publik nyckel, används bara på servern (`SUPABASE_ANON_KEY` fungerar också) | `sb_publishable_…` | Supabase → *Project Settings → API Keys* · `docs/MILJOER.md` |
| `SUPABASE_SECRET_KEY` | **ja** | Service role – bara systemsteg på servern: revisionslogg, inloggningens uppslag, utskick, bakgrundsjobb, inläsning av testdata (`SUPABASE_SERVICE_ROLE_KEY` fungerar också) | `sb_secret_…` | Supabase → *Project Settings → API Keys* |
| `MM_LOGIN_HASH_SECRET` | **ja** | Nyckel för att hasha e-post och IP i `login_attempts` | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_SESSION_SECRET` | **ja** | Valfri. Nyckel för att signera sessionskakan `mm_last_seen` (60 minuters inaktivitet). Tom = samma nyckel som `MM_LOGIN_HASH_SECRET`. Byts nyckeln loggas alla ut en gång | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_PNR_KEY` | **ja** | Kryptering av personnummer, AES-256-GCM: exakt 32 byte som base64 | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_PNR_HMAC_KEY` | **ja** | Sökhash för personnummer (dubblettkontrollen), HMAC-SHA256: minst 32 byte som base64, **en annan nyckel** än `MM_PNR_KEY` | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_STAFF_EMAIL_DOMAINS` | | Tillåtna domäner för Miljonbemannings personal (kommunernas domäner står i databasen) | `miljonbemanning.se` (standard) | Fast värde |
| `MM_EMAIL_ALLOWLIST` | | **Testmiljön:** adresser eller `@domäner` som får mejl och inloggningskoder, kommatecken emellan. Tom i testmiljön = ingen får mejl. **Tom i produktion** | `karim.khalil@miljonbemanning.se,ali.khalil@miljonbemanning.se` | Testarnas adresser |
| `MM_EMAIL_REDIRECT_TO` | | **Bara testmiljön:** testarens adress som får mejlen till testpersoner, med raden "Testmiljö – det här mejlet skulle ha gått till …" (roll och organisation). Måste finnas i `MM_EMAIL_ALLOWLIST`. Ignoreras i produktion – lämna tom där | `karim.khalil@miljonbemanning.se` | En testares adress |
| `RESEND_API_KEY` | **ja** | Resends API-nyckel (bara sändrätt) för appens mejl | `re_…` | Resend → *API Keys* (`miljonmatch-app`) |
| `MM_EMAIL_FROM` | | Avsändare. Domänen måste vara verifierad i Resend | `Miljonmatch <notis@miljonbemanning.se>` | Fast värde |
| `MM_EMAIL_REPLY_TO` | | Svarsadress. Produktion: `avrop@miljonbemanning.se` (svar på ordererkännandet hamnar i avropsflödet). Tom i testmiljön | *(tomt)* · produktion `avrop@miljonbemanning.se` | Fast värde |
| `MM_JOBS_SECRET` | **ja** | Nyckel för `/api/jobs/run` (`Authorization: Bearer …`), **minst 16 tecken**. Samma värde i Supabase Vault (`docs/UTSKICK.md`) | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_AI_PROVIDER` | | AI-stödet (avsnitt 10): `vertex` (Gemini via Vertex AI, EU), `simulated` (påhittade svar – bara testmiljön) eller `off`. Tomt = `simulated` i testmiljön och `off` i produktion. Produktion kör aldrig `simulated` | *(tomt)* · när kontot finns `vertex` | Fast värde |
| `MM_AI_MODEL` | | Gemini-modellen i Vertex AI (en Flash-modell). Kontrolleras inte mot nätet – stavas exakt som i Vertex AI | *(modellens id)* | Google Cloud → *Vertex AI → Model Garden* |
| `GOOGLE_VERTEX_PROJECT` | | Google Cloud-projektets id (annars `project_id` ur nyckeln) | `miljonmatch-ai-test` | Google Cloud → projektväljaren |
| `GOOGLE_VERTEX_LOCATION` | | Valfri. Får bara vara `eu` (EU multi-region). Allt annat stoppas | `eu` | Fast värde |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | **ja** | Tjänstekontots JSON-nyckel som base64 (rollen *Vertex AI User*) | *(base64)* | Avsnitt 10, steg 4 |
| `MM_AI_PRICES` | | Prislista för kostnaden i `ai_runs`, i öre per miljon token: `{"audioIn":…,"textIn":…,"output":…}`. Tom = kostnad 0 | *(från Googles prislista)* | Avsnitt 10, steg 6 |
| `MM_AI_THINKING` | | Valfri resonemangsnivå: `minimal`, `low`, `medium`, `high`. Tom = lägsta rimliga (`docs/AI.md`) | *(tomt)* | Fast värde |

Kommer senare: Microsoft Entra, SMS-leverantör och Fortnox. AI-leverantören (Vertex AI) kopplas in enligt avsnitt 10 när kontot i Google Cloud finns – tills dess kör testmiljön den simulerade.

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
| Inloggning med kod | `src/app/api/auth/{code,verify,logout}`, `src/server/auth/*` |
| Session, testarens val | `src/app/api/session`, `src/app/api/session/impersonate`, `src/app/_shell/client-root.tsx` |
| Läs in testdata på nytt | `src/app/api/staging/seed/route.ts`, `src/server/staging/load.ts`, `supabase/migrations/0010_testdata.sql`, knappen `src/features/session/screens/test-data-reset.tsx` |
| Utskick och jobb | `src/server/notify/*`, `src/server/jobs/*`, `docs/UTSKICK.md` |
| AI och röstinspelning | `src/server/ai/*` (Vertex AI EU eller simulerad), `src/server/audio/*` (bucketen `ljud`), `src/features/_shared/voice-upload.ts` och `voice-jobs.ts`, `POST /api/audio/upload-url` – `docs/AI.md` |
| Inaktivitet och maxtid, förnyelse av sessionen | `src/proxy.ts` (kakorna `mm_last_seen`, `mm_login_at`) |
| E2E i minnesläget | `POST /api/dev-session/reset` (bara minnesläget) nollställer testdatat före varje test |

- Svaret på "Skicka kod" är alltid detsamma, så att ingen kan pröva fram vilka adresser som finns. Koden skickas bara till en aktiv profil med roll och tillåten domän (kommunens domäner i `organizations.email_domains`, personalens i `MM_STAFF_EMAIL_DOMAINS`) – och i testmiljön bara till `MM_EMAIL_ALLOWLIST`.
- Hastighetsbegränsning per adress och IP i `login_attempts`, med hashade värden. Adresser, koder och IP-nummer loggas aldrig.
- Supabase-sessionen ligger i httpOnly-kakor. Inloggning, utloggning, byte av testperson och inläsning av testdata laddar om sidan, så att inga gamla data ligger kvar.
- Lokalt och i e2e körs appen i minnesläget (`MM_BACKEND=memory`, välj testperson i verktygsfältet).

---

## 7. Produktion (senare)

- Nytt Supabase-projekt i **eu-north-1** och ett **eget Vercel-projekt**, så att förhandsversioner (Preview) aldrig kan peka mot produktionsdatabasen.
- Samma migrationer (0001–0014, i nummerordning), **ingen seed och inget startdata**. Kör dem precis före den första driftsättningen – 0013 och koden hör ihop (steg 1 i "exakt ordning"). `app_settings` får `environment = production` och inga klockrader (`supabase/README.md`). Då gör `mm.reset_test_data()` ingenting, testarfunktionen är avstängd och knappen för testdata syns inte.
- `MM_CLOCK=real`, `MM_EMAIL_ALLOWLIST` tom, `MM_EMAIL_REDIRECT_TO` tom, `MM_EMAIL_REPLY_TO=avrop@miljonbemanning.se`, egna nycklar för personnummer, jobb och inloggning.
- Domän `app.miljonmatch.se` (CNAME `app` hos one.com), Site URL och `MM_APP_URL` därefter.
- DPA med Resend (och övriga underbiträden) innan riktiga personuppgifter.
- AI: ett **eget Google Cloud-projekt** för produktion med eget tjänstekonto och egen nyckel (avsnitt 10). `MM_AI_PROVIDER=vertex` – utan den är AI avstängd i produktion (den simulerade körs aldrig där).

## 8. Säkerhetskontroll

- [ ] Hemliga nycklar finns bara i Vercel (och SMTP-lösenordet i Supabase, jobbnyckeln i Supabase Vault) – aldrig i repot, chatten eller loggar.
- [ ] Inga variabler med hemligheter har prefixet `NEXT_PUBLIC_`.
- [ ] Funktionerna körs i arn1 (Stockholm), databasen i eu-north-1.
- [ ] Vercel Pro (inte Hobby).
- [ ] Självregistrering är avstängd i Supabase Auth, e-postmallen visar bara koden.
- [ ] Testmiljön har bara påhittade testdata och `MM_EMAIL_ALLOWLIST` är satt.
- [ ] Click och open tracking är avstängda i Resend.
- [ ] Resends DNS-poster finns i Terraform-koden för miljonbemanning.se.
- [ ] MFA och minst två administratörer i Vercel, Supabase och Resend.
- [ ] AI: bara `MM_AI_PROVIDER=vertex` med `aiplatform.eu.rep.googleapis.com` (location `eu`) – ingen Gemini API-nyckel (AI Studio) någonstans. Tjänstekontot har bara rollen *Vertex AI User*. Googles personuppgiftsbiträdesvillkor (CDPA) är godkända och Vertex AI:s cachning av indata avstängd (avsnitt 10).
- [ ] Bucketen `ljud` är privat.

## 9. Felsökning

| Problem | Kontrollera |
|---|---|
| "Inloggningen kunde inte hämtas" | Miljövariablerna i Vercel, att migrationerna är körda (`select public.current_actor();`) och Vercels loggar (bara felkoder, inga personuppgifter) |
| Ingen kod kommer | Att adressen finns i `MM_EMAIL_ALLOWLIST` (testmiljön) och som aktiv profil med roll (`bootstrap-staging.sql` körd?); *Logs → Auth* i Supabase; *Emails* i Resend; SMTP-inställningarna; skräpposten |
| Mejlet innehåller en länk i stället för en kod | Mallen *Magic link* ska använda `{{ .Token }}` (avsnitt 2.1) |
| "Du har försökt för många gånger" | Vänta 15 minuter (5 koder per adress, 20 per IP) eller be om en ny kod efter 5 felaktiga försök |
| "Läs in testdata på nytt" syns inte | Knappen finns på `/admin/integrationer`, som bara rollen admin når – välj dig själv i "Agera som". Bara testare (`profiles.is_tester`) i testmiljön (`app_settings.environment = staging`) ser den |
| "Nycklarna för personnummer saknas" | `MM_PNR_KEY` och `MM_PNR_HMAC_KEY` i Vercel (avsnitt 5.1), driftsätt igen |
| Inläsningen avbröts | Kör den igen – den börjar alltid med att tömma. Vercels loggar visar tabell och felkod (`testdata-fel`) |
| Fel tid i appen | `show timezone;` och raderna `clock_…` i `app_settings`. `MM_CLOCK=real` ger riktig tid |
| Utloggad oväntat | 60 minuter utan aktivitet eller 12 timmar sedan inloggningen – så ska det vara |
| "AI-stödet är inte tillgängligt just nu" / inspelning går inte att starta | `MM_AI_PROVIDER` och övriga AI-variabler (avsnitt 10). Vercels logg visar `ai: AI-stödet är avstängt – …` med orsaken (utan hemligheter). I produktion är AI av tills `MM_AI_PROVIDER=vertex` |
| Transkriberingen blir aldrig klar | `jobs` (`select kind, status, attempts, last_error from jobs order by created_at desc limit 20;`). 403/404 från Vertex AI: fel projekt, modell eller roll. "AI-tjänsten svarar inte": tillfälligt – jobbet försöks igen upp till fem gånger |

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

**Tidsgränser:** en transkribering av en timmes ljud kan ta någon minut. Jobbet körs direkt efter svaret (after()) och annars av `/api/jobs/run`; funktionerna behöver få köra upp till 300 sekunder (Vercel Pro). Längsta inspelning styrs av avtalet (`ai.maxMinutes`, Botkyrka: coachen 60, kommunen och deltagaren 5 minuter). Ljud över cirka 15 MB (ungefär en timme i 32 kbit/s) transkriberas inte.

