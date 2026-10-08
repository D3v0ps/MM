# Miljöer

| Miljö | Supabase-projekt | Region | Data | App |
|---|---|---|---|---|
| **Produktion (skarp drift sedan 2026-10-08)** | `miljonmatch` (ref `blxupsebzzhmjitaywev`), org "D3v0ps's Org" – ska flyttas till Miljonbemanning AB:s organisation | eu-north-1 (Stockholm) | Riktiga uppgifter: testdatat togs bort 2026-10-08 (`scratchpad/skarp-drift.sql`), `environment = production` | Vercel-projektet `miljonmatch`: **`https://www.miljonmatch.se`** (`miljonmatch.se` skickas vidare dit) |
| Testmiljö (staging) | Sätts upp senare: eget projekt i Stockholm, `environment = staging`, testarna och "Agera som" | eu-north-1 | Bara påhittade testdata | `test.miljonmatch.se` i eget Vercel-projekt (SPEC §11) |
| Prototyp | – (data i webbläsaren) | – | Påhittade testdata | Artefakten på claude.ai, byggd med `npm run demo:build` |
| Lokalt, tomt | – (minnet) | – | `MM_SEED=empty`: bara avtalet, konfigurationen och de sju kollegorna, riktig tid | `npm run dev` |

## Produktionsmiljön (var testmiljön till 2026-10-08)

- Samma projekt och samma adress som testmiljön hade. Det som gäller nu: `docs/DRIFT.md`, avsnittet "Skarp drift sedan 2026-10-08" (Vercel-variablerna, hur kollegor läggs till i appen, hur Botkyrka släpps in, DPA före riktiga personuppgifter).
- Migrationerna 0001–0026 är applicerade; **0027 (rollväxling)** körs av Karim i SQL Editor. Kollegorna är vanliga användare (`is_tester = false`), alla systemadministratörer tills rollerna ändras i appen; Ali är avtalsansvarig.
- AI är av (`MM_AI_PROVIDER` tom) tills Google Cloud är kopplat – "Tal till text är inte kopplat ännu – skriv själv så länge." Ingen simulerad AI i produktion.
- `MM_EMAIL_ALLOWLIST=@miljonbemanning.se` tills Botkyrka släpps in.

## Testmiljön (historik – och mallen för den nya testmiljön)

- API-adress: `https://blxupsebzzhmjitaywev.supabase.co`
- Publik nyckel (får finnas i webbläsaren, skyddas av RLS): `sb_publishable_6gWujM1P_blTRgFvPTMiGQ_cYDPcmGO`
- Hemliga nycklar (service role, Resend, krypteringsnycklar) läggs **bara** i Vercels miljövariabler – aldrig i repot eller i chatten. Se `docs/DRIFT.md`.
- Databasen: migrationerna `supabase/migrations/0001–0017` (0001–0016 redan applicerade i testprojektet av samordnaren; **0017 (synpunkter i testmiljön) appliceras av samordnaren** när koden med "Lämna synpunkt" går live – se `docs/DRIFT.md`), startdatat `supabase/bootstrap-staging.sql` (samordnaren kör det – också för att lägga till nya testare), testdatat läser testaren in i appen (`/admin/integrationer` → "Läs in testdata på nytt"). Ordningen steg för steg: `docs/DRIFT.md`, "Så startar du testmiljön".
- Testarna (sju personer på Miljonbemanning, beslut 2026-10-01) och "Lämna synpunkt": `docs/DRIFT.md` avsnitt 11. `MM_EMAIL_ALLOWLIST` innehåller deras sju hela adresser. En ny adress på kommundomänen (självregistrering, beslut 2026-10-07) får bara en kod om den finns i listan.
- AI:n är **simulerad** i testmiljön tills Google Cloud är kopplat (`MM_AI_PROVIDER=simulated`): transkriberad text är påhittad och märks "Testmiljö: AI:n är simulerad – texten är påhittad …" (`docs/AI.md`). Det är svaret på synpunkten "Tal till text fungerar ej" (2026-10-06).
- Migrationerna 0023–0026 (beslut 2026-10-07) är skrivna men inte applicerade – de appliceras tillsammans (`docs/DRIFT.md` avsnitt 1.4).
- Projektet ska flyttas till Miljonbemanning AB:s organisation när den finns (SPEC §11: konton ägs av bolaget via funktionsadress, minst två administratörer, MFA).

## Domäner och e-post

- Appen: `miljonmatch.se` (beslut 2026-10-01 – den gamla webbsidan ersätts). Just nu skickar Vercel `miljonmatch.se` vidare till **`https://www.miljonmatch.se`** – det är appens adress: `MM_APP_URL` och *Site URL* i Supabase Auth ska vara den adress som **inte** skickas vidare. *Redirect URLs* i Supabase Auth: `https://www.miljonmatch.se/**`, `https://miljonmatch.se/**` och förhandsadresserna `https://*-ai-projekts-projects.vercel.app/**` (se `docs/DRIFT.md` avsnitt 2.2). Testmiljön ligger där tills produktionen startar och flyttar då till `test.miljonmatch.se`. DNS för miljonmatch.se ligger hos one.com och pekar redan mot Vercel (A-post och www-CNAME).
- E-post: från `notis@miljonmatch.se` ("Miljonmatch") via Resend (regionen ska vara EU – bekräftas i Resend, `docs/DRIFT.md` avsnitt 4.2), beslut 2026-10-01. Domänen miljonmatch.se är verifierad i Resend och DNS-posterna ligger hos one.com – inget i Terraform-zonen för miljonbemanning.se behövs längre för appen. Stäng av click/open tracking och lägg in en DMARC-post (`docs/DRIFT.md` avsnitt 4.2). Svar till notis@ kommer inte fram (null-MX) – svarsadressen i produktion är `avrop@miljonbemanning.se`.
