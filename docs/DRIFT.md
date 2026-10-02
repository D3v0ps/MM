# Drift – så sätter du upp testmiljön (och senare produktion)

*Version 2026-10-02. Testmiljön har bara påhittade testdata. Produktion byggs på samma sätt, men i ett eget Supabase-projekt och ett eget Vercel-projekt (se avsnitt 7).*

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
| `MM_CLOCK` | | Tomt = testtid när `app_settings` har testklockans epoker. `real` = riktig tid | *(tomt)* · produktion `real` | Fast värde |
| `MM_APP_URL` | | Appens adress utan `/` på slutet – den som **inte** skickas vidare. Länkarna i mejlen och deltagarens inspelningslänk (`/rost/…`) | `https://www.miljonmatch.se` | Vercel → *Domains* |
| `SUPABASE_URL` | | Supabase-projektets adress (`NEXT_PUBLIC_SUPABASE_URL` från Vercels Supabase-integration fungerar också) | `https://blxupsebzzhmjitaywev.supabase.co` | Supabase → *Project Settings → API* · `docs/MILJOER.md` |
| `SUPABASE_PUBLISHABLE_KEY` | | Publik nyckel, används bara på servern (`SUPABASE_ANON_KEY` fungerar också) | `sb_publishable_…` | Supabase → *Project Settings → API Keys* · `docs/MILJOER.md` |
| `SUPABASE_SECRET_KEY` | **ja** | Service role – bara systemsteg på servern: revisionslogg, inloggningens uppslag, utskick, bakgrundsjobb, inläsning av testdata (`SUPABASE_SERVICE_ROLE_KEY` fungerar också) | `sb_secret_…` | Supabase → *Project Settings → API Keys* |
| `MM_LOGIN_HASH_SECRET` | **ja** | Nyckel för att hasha e-post och IP i `login_attempts` | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_SESSION_SECRET` | **ja** | Valfri. Nyckel för att signera sessionskakan `mm_last_seen` (60 minuters inaktivitet). Tom = samma nyckel som `MM_LOGIN_HASH_SECRET`. Byts nyckeln loggas alla ut en gång | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_PNR_KEY` | **ja** | Kryptering av personnummer, AES-256-GCM: exakt 32 byte som base64 | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_PNR_HMAC_KEY` | **ja** | Sökhash för personnummer (dubblettkontrollen), HMAC-SHA256: minst 32 byte som base64, **en annan nyckel** än `MM_PNR_KEY` | *(32 slumpbyte)* | Skapa: `openssl rand -base64 32` |
| `MM_STAFF_EMAIL_DOMAINS` | | Tillåtna domäner för Miljonbemannings personal (kommunernas domäner står i databasen) | `miljonbemanning.se` (standard) | Fast värde |
| `MM_EMAIL_ALLOWLIST` | | **Testmiljön:** de adresser som får mejl och inloggningskoder, kommatecken emellan. **Hela adresser, aldrig `@miljonbemanning.se`** – testdatat har påhittade adresser på den domänen. Tom i testmiljön = ingen får mejl. **Tom i produktion** | `karim.khalil@miljonbemanning.se,ali.khalil@miljonbemanning.se,sara.salah@miljonbemanning.se,adam.abdalla@miljonbemanning.se,shafik.muwanga@miljonbemanning.se,moda.habib@miljonbemanning.se,yacine.laghmari@miljonbemanning.se` | Testarnas adresser (avsnitt 11) |
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
| Inloggning med kod | `src/app/api/auth/{code,verify,logout}`, `src/server/auth/*` – kodmejlet: `src/server/auth/code-mail.ts` (generateLink + Resend), layouten `src/server/notify/render.ts` |
| Session, testarens val | `src/app/api/session`, `src/app/api/session/impersonate`, `src/app/_shell/client-root.tsx` |
| Läs in testdata på nytt | `src/app/api/staging/seed/route.ts`, `src/server/staging/load.ts`, `supabase/migrations/0010_testdata.sql` (och 0017, som behåller synpunkterna), knappen `src/features/session/screens/test-data-reset.tsx` |
| Synpunkter (bara testmiljön) | `src/features/synpunkter/*` (kommandona `feedback.*`, knapparna i `panel.tsx`), `supabase/migrations/0017_synpunkter.sql` |
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


## 11. Testarna och synpunkter (beslut 2026-10-01)

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

Alla är systemadministratörer i båda avtalen och testare (`is_tester = true`, `TESTERS` i `src/data/supabase/seed-rows.ts`). De loggar in som sig själva och väljer testperson i "Agera som".

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
