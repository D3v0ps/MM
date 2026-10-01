# Miljöer

| Miljö | Supabase-projekt | Region | Data | App |
|---|---|---|---|---|
| Testmiljö (staging) | `miljonmatch` (ref `blxupsebzzhmjitaywev`), org "D3v0ps's Org" | eu-north-1 (Stockholm) | Bara påhittade testdata | Vercel-projektet `miljonmatch`: **`https://www.miljonmatch.se`** (`miljonmatch.se` skickas vidare dit) tills produktionen startar – sedan `test.miljonmatch.se` |
| Produktion | Skapas senare, eget projekt i Stockholm | eu-north-1 | Riktiga personuppgifter | `miljonmatch.se` i eget Vercel-projekt (SPEC §11) |
| Prototyp | – (data i webbläsaren) | – | Påhittade testdata | Artefakten på claude.ai, byggd med `npm run demo:build` |

## Testmiljön

- API-adress: `https://blxupsebzzhmjitaywev.supabase.co`
- Publik nyckel (får finnas i webbläsaren, skyddas av RLS): `sb_publishable_6gWujM1P_blTRgFvPTMiGQ_cYDPcmGO`
- Hemliga nycklar (service role, Resend, krypteringsnycklar) läggs **bara** i Vercels miljövariabler – aldrig i repot eller i chatten. Se `docs/DRIFT.md`.
- Databasen: migrationerna `supabase/migrations/0001–0016` (0001–0014 redan applicerade i testprojektet av samordnaren; **0015 (röstinspelning, bucketen `ljud`) och 0016 (ett svar per pulslänk) appliceras av samordnaren** när koden med röstinspelningen går live – se `docs/DRIFT.md`), startdatat `supabase/bootstrap-staging.sql` (samordnaren kör det), testdatat läser testaren in i appen (`/admin/integrationer` → "Läs in testdata på nytt"). Ordningen steg för steg: `docs/DRIFT.md`, "Så startar du testmiljön".
- Projektet ska flyttas till Miljonbemanning AB:s organisation när den finns (SPEC §11: konton ägs av bolaget via funktionsadress, minst två administratörer, MFA).

## Domäner och e-post

- Appen: `miljonmatch.se` (beslut 2026-10-01 – den gamla webbsidan ersätts). Just nu skickar Vercel `miljonmatch.se` vidare till **`https://www.miljonmatch.se`** – det är appens adress: `MM_APP_URL` och *Site URL* i Supabase Auth ska vara den adress som **inte** skickas vidare. *Redirect URLs* i Supabase Auth: `https://www.miljonmatch.se/**`, `https://miljonmatch.se/**` och förhandsadresserna `https://*-ai-projekts-projects.vercel.app/**` (se `docs/DRIFT.md` avsnitt 2.2). Testmiljön ligger där tills produktionen startar och flyttar då till `test.miljonmatch.se`. DNS för miljonmatch.se ligger hos one.com och pekar redan mot Vercel (A-post och www-CNAME).
- E-post: från `notis@miljonbemanning.se` via Resend (region EU, Irland). Resends DNS-poster ligger i Google Cloud DNS-zonen för miljonbemanning.se, som styrs av Terraform – posterna ska också in i Terraform-koden.
