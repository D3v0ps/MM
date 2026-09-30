# Drift – så sätter du upp testmiljön (och senare produktion)

*Version 2026-09-30. Testmiljön har bara påhittade testdata. Produktion byggs på samma sätt, men i ett eget Supabase-projekt och ett eget Vercel-projekt (se sist).*

## Översikt

```
Webbläsaren ──► Vercel (Next.js, funktioner i Stockholm, arn1) ──► Supabase (Postgres + inloggning, Stockholm, eu-north-1)
                        │                                                  │
                        └──► Resend (e-post, EU) ◄── Supabase Auth skickar inloggningskoden via Resend (SMTP)
DNS för miljonbemanning.se ligger kvar hos one.com (e-posten i Microsoft 365 hänger på den).
```

- Webbläsaren pratar **bara** med Vercel. Supabase-nycklarna finns bara på servern.
- Inloggning: e-post + sexsiffrig kod (SPEC §4). Koden gäller 10 minuter och får prövas 5 gånger. Man loggas ut efter 60 minuter utan aktivitet och alltid efter 12 timmar. Microsoft-inloggning för personalen kommer senare.
- Testmiljön kör på **testtid**: klockan började på måndag 1 februari 2027 kl. 09.12 när testdatat lästes in och går sedan i vanlig takt.
- I testmiljön får **bara** adresserna i `MM_EMAIL_ALLOWLIST` (testarna) mejl – även inloggningskoder. Testdatat innehåller adresser på riktiga domäner (t.ex. botkyrka.se) som aldrig får få mejl.
- Testarna (Karim och Ali) loggar in som sig själva och väljer sedan vilken testperson de agerar som i raden överst ("Agera som"). Det fungerar bara i testmiljön.

## Vem gör vad

| Steg | Vem | Varför |
|---|---|---|
| Konton hos Vercel, Resend (och Supabase-projektet i bolagets organisation) | Du | Kontona ska ägas av Miljonbemanning AB, med MFA och minst två administratörer |
| DNS-poster hos one.com | Du | Kräver inloggning hos one.com |
| Nycklar (Supabase secret key, Resend-nycklar) in i Vercel och Supabase | Du | Hemliga nycklar ska aldrig skrivas i chatten eller i repot |
| Migrationer, testdata och kontroller i databasen | Claude (via Supabase-kopplingen) eller du | Kan göras med Supabase CLI, SQL-editorn eller kopplingen |
| Inställningarna i Supabase Auth | Du (eller Claude där kopplingen räcker) | De flesta finns bara i Supabase-panelen |

---

## 1. Supabase (testmiljön)

Projektet finns redan: `miljonmatch` (se `docs/MILJOER.md`), region **eu-north-1 (Stockholm)**. Kontrollera regionen under *Project Settings → General*.

### 1.1 Databasen: migrationer och testdata

1. Migrationerna ligger i `supabase/migrations/` (0001–0009). Kör dem i ordning – med Supabase CLI:
   ```
   npx supabase login
   npx supabase link --project-ref <projektets ref>
   npx supabase db push
   ```
   eller klistra in filerna en i taget i *SQL Editor*. Mer om migrationerna och besluten: `supabase/README.md`.
2. Testdatat: `npx tsx scripts/db/generate-seed.ts` skriver `supabase/seed.sql`. Kör filen i *SQL Editor* (eller `psql`).
   Seeden sätter `app_settings` (`environment = staging`, testklockans start) och lägger in testarna Karim och Ali som administratörer.
   Den vägrar köra i en databas som inte är testmiljö. Kör den **aldrig** i produktion.
3. Kontrollera tidszonen i *SQL Editor*: `show timezone;` ska ge `Europe/Stockholm`. (Migrationen sätter den. Står det något annat:
   `alter database postgres set timezone to 'Europe/Stockholm';` och starta om projektet under *Project Settings → General → Restart project*.)
4. Kontrollera att testmiljön är markerad: `select * from app_settings;` ska visa `environment = staging` och två rader `clock_…`.

### 1.2 Inloggning (Authentication)

Under *Authentication* i Supabase-panelen:

| Var | Inställning | Värde |
|---|---|---|
| *Sign In / Providers → User Signups* | Allow new users to sign up | **Av** (ingen självregistrering – servern skapar konton för inbjudna profiler) |
| *Sign In / Providers → Email* | Enable Email provider | På |
| | Confirm email | På (kontona skapas redan bekräftade) |
| | Email OTP Length | **6** |
| | Email OTP Expiration | **600** sekunder (10 minuter) |
| *URL Configuration* | Site URL | Testmiljöns adress, t.ex. `https://miljonmatch-test.vercel.app` (byt när den egna domänen finns) |
| | Redirect URLs | Samma adress med `/**` på slutet, och `http://localhost:3000/**` |
| *Emails → Templates → Magic link* (och *Confirm signup*) | Ämne | `Din inloggningskod till Miljonmatch` |
| | Innehåll | Innehållet i `supabase/templates/otp.html`. Mallen ska innehålla `{{ .Token }}` (koden) och **ingen** länk – e-postskydd som Safe Links förbrukar länkar |
| *Emails → SMTP Settings* | Enable custom SMTP | På (den inbyggda e-posten är bara för test och når inte andra adresser) |
| | Sender email / name | `notis@miljonbemanning.se` / `Miljonmatch` |
| | Host / Port | `smtp.resend.com` / `465` |
| | Username / Password | `resend` / Resends API-nyckel för SMTP (steg 2.4) |
| *Rate Limits* | Rate limit for sending emails | Standard (30 per timme) räcker för test |

Supabase Auths egna gränser för sessioner behövs inte – appen loggar ut efter 60 minuters inaktivitet och 12 timmar (`src/proxy.ts`).

### 1.3 Nycklar

*Project Settings → API Keys*:
- **Publishable key** (`sb_publishable_…`) → `SUPABASE_PUBLISHABLE_KEY` i Vercel.
- **Secret key** (`sb_secret_…`) → `SUPABASE_SECRET_KEY` i Vercel. Hemlig – bara i Vercel, aldrig i repot, chatten eller med prefixet `NEXT_PUBLIC_`.
- *Project Settings → Data API*: bara schemat `public` exponerat (standard). **Max rows** ska vara minst 1000 (standard) – appen hämtar listor i sidor om 1000 rader.

### 1.4 Bakgrundsjobb

Schemaläggningen av `/api/jobs/run` (pg_cron + pg_net i Supabase, varje minut) beskrivs i `docs/UTSKICK.md`.

---

## 2. Resend (e-post)

### 2.1 Konto
Skapa kontot med bolagets funktionsadress, slå på MFA och bjud in en andra administratör (*Settings → Team*).

### 2.2 Domän i EU
*Domains → Add domain*: `miljonbemanning.se`, **region EU (Ireland, eu-west-1)**. Regionen väljs per domän och går inte att ändra i efterhand.

### 2.3 DNS-poster hos one.com
Resend visar exakt vilka poster som behövs. Lägg in dem hos one.com (*DNS-inställningar* för miljonbemanning.se) precis som de står – normalt:

| Typ | Namn | Värde (kopiera från Resend) |
|---|---|---|
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com`, prioritet 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | DKIM-nyckeln (`p=…`) |
| TXT | `_dmarc` | Bara om det **inte** redan finns en DMARC-post: `v=DMARC1; p=none;` |

- Ändra **inte** domänens befintliga MX-, SPF- eller DKIM-poster för Microsoft 365. Resends poster ligger på underdomänen `send` och på en egen DKIM-nyckel, så de krockar inte med e-posten i M365.
- Vänta tills Resend visar *Verified* (oftast några minuter, ibland upp till ett dygn).

### 2.4 API-nycklar
*API Keys → Create API key*, två nycklar med **Sending access** och domänen `miljonbemanning.se`:
1. `supabase-smtp` → lösenordet under *SMTP Settings* i Supabase (steg 1.2).
2. `miljonmatch-app` → `RESEND_API_KEY` i Vercel.

Avsändaren `notis@miljonbemanning.se` behöver ingen brevlåda för att skicka, men svar hamnar där – skapa en delad brevlåda i M365 om någon ska läsa dem.

---

## 3. Vercel (appen)

### 3.1 Projektet
1. Bolagets team i Vercel. Obs: Vercels gratisnivå (Hobby) får bara användas privat – bolaget behöver **Pro**.
2. *Add New → Project → Import* GitHub-repot `miljonmatch`. Ramverket känns igen som Next.js; bygg- och startkommandon ändras inte.
3. Region: `vercel.json` innehåller `"regions": ["arn1"]`. Kontrollera efter första driftsättningen under *Settings → Functions* att regionen är **Stockholm (arn1)** – aldrig iad1 (USA).
4. Slå **inte** på Vercel Analytics eller Speed Insights (inga analysverktyg med personuppgifter, CLAUDE.md).

### 3.2 Miljövariabler
*Settings → Environment Variables*. Så länge det bara finns en testmiljö: sätt dem för *Production* och *Preview*. Hela listan står i avsnitt 5.

| Namn | Testmiljön |
|---|---|
| `MM_BACKEND` | `supabase` |
| `MM_CLOCK` | tomt (testtid) |
| `MM_APP_URL` | testmiljöns adress, t.ex. `https://miljonmatch-test.vercel.app` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | från steg 1.3 |
| `SUPABASE_SECRET_KEY` | från steg 1.3 (hemlig) |
| `MM_LOGIN_HASH_SECRET` | ny slumpnyckel: `openssl rand -base64 32` (hemlig) |
| `MM_EMAIL_ALLOWLIST` | `karim.khalil@miljonbemanning.se,ali.khalil@miljonbemanning.se` |
| `RESEND_API_KEY` | från steg 2.4 (hemlig) |
| `MM_EMAIL_FROM` | `Miljonmatch <notis@miljonbemanning.se>` |
| `MM_JOBS_SECRET` | ny slumpnyckel: `openssl rand -base64 32` (hemlig) |

Efter ändrade variabler: *Deployments → … → Redeploy*.

### 3.3 Första testet
1. Öppna `https://<projekt>.vercel.app/logga-in`. Överst står "Testmiljö – påhittade testdata · testdatum måndag 1 februari 2027".
2. Skriv `karim.khalil@miljonbemanning.se` → *Skicka kod* → skriv koden från mejlet → *Logga in*.
3. Välj testperson i "Agera som" (t.ex. Sara Lindqvist – samordnare, Maria Ekdahl – kommunens handläggare). Sidan laddas om som den personen.
4. Kommunens portal: `/portal/logga-in`. I testmiljön loggar testarna in som sig själva och väljer en kommunperson i "Agera som".

### 3.4 Egen domän (när ni vill)
Förslag: `portal-test.miljonbemanning.se` för testmiljön och `portal.miljonbemanning.se` för produktion (SPEC §11).
1. Vercel: *Settings → Domains → Add* `portal-test.miljonbemanning.se`. Vercel visar ett CNAME-värde.
2. one.com: lägg till en **CNAME**-post med namnet `portal-test` och värdet Vercel visar. Flytta **inte** domänens namnservrar – bara den här posten.
3. Vänta tills Vercel visar *Valid Configuration* (certifikatet skapas automatiskt).
4. Ändra `MM_APP_URL` i Vercel och *Site URL* + *Redirect URLs* i Supabase till den nya adressen. Driftsätt igen.

---

## 4. Så fungerar det i koden

| Del | Fil |
|---|---|
| Körläge (minnet eller Supabase), Ctx, klocka | `src/server/runtime.ts`, `src/server/live.ts`, `src/server/ctx.ts`, `src/server/clock.ts` |
| Datalagret mot Postgres (RLS) | `src/data/supabase/repo.ts` – samma `Repo` som minnesläget; hanterarna ändras inte |
| Aktören (roll, avtal) | databasens `public.current_actor()` – samma funktioner som RLS använder |
| Inloggning med kod | `src/app/api/auth/{code,verify,logout}`, `src/server/auth/*` |
| Session, testarens val | `src/app/api/session`, `src/app/api/session/impersonate`, `src/app/_shell/client-root.tsx` |
| Inaktivitet och maxtid, förnyelse av sessionen | `src/proxy.ts` (kakorna `mm_last_seen`, `mm_login_at`) |

- Svaret på "Skicka kod" är alltid detsamma, så att ingen kan pröva fram vilka adresser som finns. Koden skickas bara till en aktiv profil med roll och tillåten domän (kommunens domäner i `organizations.email_domains`, personalens i `MM_STAFF_EMAIL_DOMAINS`) – och i testmiljön bara till `MM_EMAIL_ALLOWLIST`.
- Hastighetsbegränsning per adress och IP i `login_attempts`, med hashade värden. Adresser, koder och IP-nummer loggas aldrig.
- Supabase-sessionen ligger i httpOnly-kakor. Inloggning, utloggning och byte av testperson laddar om sidan, så att inga data från förra användaren ligger kvar.
- Lokalt och i e2e körs appen som förut i minnesläget (`MM_BACKEND=memory`, välj testperson i verktygsfältet).

---

## 5. Alla miljövariabler

| Namn | Hemlig | Behövs | Förklaring |
|---|---|---|---|
| `MM_BACKEND` | | alltid | `memory` (standard: påhittade testdata i minnet) eller `supabase` (testmiljön och produktion) |
| `MM_CLOCK` | | supabase | Tomt = testtid när `app_settings` har testklockans epoker. `real` = riktig tid (**produktion**) |
| `MM_APP_URL` | | supabase | Appens adress utan `/` på slutet – länkar i mejl |
| `SUPABASE_URL` | | supabase | Projektets adress. (`NEXT_PUBLIC_SUPABASE_URL` från Vercels Supabase-integration fungerar också) |
| `SUPABASE_PUBLISHABLE_KEY` | | supabase | Publik nyckel, används bara på servern. (Äldre namn som `SUPABASE_ANON_KEY` fungerar också) |
| `SUPABASE_SECRET_KEY` | **ja** | supabase | Service role – bara systemsteg på servern (revisionslogg, inloggningens uppslag, bakgrundsjobb). (`SUPABASE_SERVICE_ROLE_KEY` fungerar också) |
| `MM_LOGIN_HASH_SECRET` | **ja** | supabase | Nyckel för att hasha e-post och IP i `login_attempts` |
| `MM_STAFF_EMAIL_DOMAINS` | | valfri | Tillåtna domäner för Miljonbemannings personal. Standard `miljonbemanning.se` |
| `MM_EMAIL_ALLOWLIST` | | **testmiljön** | Adresser eller `@domäner` som får mejl och inloggningskoder, med kommatecken emellan. Tom i testmiljön = ingen får mejl. Tom i produktion |
| `RESEND_API_KEY` | **ja** | supabase | Resends API-nyckel (bara sändrätt) för appens mejl |
| `MM_EMAIL_FROM` | | supabase | Avsändare, t.ex. `Miljonmatch <notis@miljonbemanning.se>` |
| `MM_JOBS_SECRET` | **ja** | supabase | Nyckel för `/api/jobs/run` (`Authorization: Bearer …`) |

Kommer senare: nycklar för personnummer (AES-256-GCM och HMAC), Microsoft Entra, SMS-leverantör, AI-leverantör och Fortnox.

---

## 6. Produktion (senare)

- Nytt Supabase-projekt i **eu-north-1** och ett **eget Vercel-projekt**, så att förhandsversioner (Preview) aldrig kan peka mot produktionsdatabasen.
- Samma migrationer, **ingen seed**. `app_settings` får `environment = production` och inga klockrader. `MM_CLOCK=real`. `MM_EMAIL_ALLOWLIST` tom.
- Inga testare: `is_tester` är falskt för alla, och testarfunktionen gör ingenting utanför testmiljön.
- Domän `portal.miljonbemanning.se` (CNAME hos one.com), Site URL och `MM_APP_URL` därefter.

## 7. Säkerhetskontroll

- [ ] Hemliga nycklar finns bara i Vercel (och SMTP-lösenordet i Supabase) – aldrig i repot, chatten eller loggar.
- [ ] Inga variabler med hemligheter har prefixet `NEXT_PUBLIC_`.
- [ ] Funktionerna körs i arn1 (Stockholm), databasen i eu-north-1.
- [ ] Självregistrering är avstängd i Supabase Auth, e-postmallen visar bara koden.
- [ ] Testmiljön har bara påhittade testdata och `MM_EMAIL_ALLOWLIST` är satt.
- [ ] MFA och minst två administratörer i Vercel, Supabase och Resend.

## 8. Felsökning

| Problem | Kontrollera |
|---|---|
| "Inloggningen kunde inte hämtas" | Miljövariablerna i Vercel, att migrationerna är körda (`select public.current_actor();`) och Vercels loggar (bara felkoder, inga personuppgifter) |
| Ingen kod kommer | Att adressen finns i `MM_EMAIL_ALLOWLIST` (testmiljön) och som aktiv profil med roll; *Logs → Auth* i Supabase; *Emails* i Resend; SMTP-inställningarna; skräpposten |
| Mejlet innehåller en länk i stället för en kod | Mallen *Magic link* ska använda `{{ .Token }}` (steg 1.2) |
| "Du har försökt för många gånger" | Vänta 15 minuter (5 koder per adress, 20 per IP) eller be om en ny kod efter 5 felaktiga försök |
| Fel tid i appen | `show timezone;` och raderna `clock_…` i `app_settings`. `MM_CLOCK=real` ger riktig tid |
| Utloggad oväntat | 60 minuter utan aktivitet eller 12 timmar sedan inloggningen – så ska det vara |
