# Miljöer

| Miljö | Supabase-projekt | Region | Data | App |
|---|---|---|---|---|
| Testmiljö (staging) | `miljonmatch` (ref `blxupsebzzhmjitaywev`), org "D3v0ps's Org" | eu-north-1 (Stockholm) | Bara påhittade testdata | Vercel, `test.miljonmatch.se` (först Vercels egen adress `*.vercel.app`) |
| Produktion | Skapas senare, eget projekt i Stockholm | eu-north-1 | Riktiga personuppgifter | `app.miljonmatch.se` (SPEC §11) |
| Prototyp | – (data i webbläsaren) | – | Påhittade testdata | Artefakten på claude.ai, byggd med `npm run demo:build` |

## Testmiljön

- API-adress: `https://blxupsebzzhmjitaywev.supabase.co`
- Publik nyckel (får finnas i webbläsaren, skyddas av RLS): `sb_publishable_6gWujM1P_blTRgFvPTMiGQ_cYDPcmGO`
- Hemliga nycklar (service role, Resend, krypteringsnycklar) läggs **bara** i Vercels miljövariabler – aldrig i repot eller i chatten. Se `docs/DRIFT.md`.
- Projektet ska flyttas till Miljonbemanning AB:s organisation när den finns (SPEC §11: konton ägs av bolaget via funktionsadress, minst två administratörer, MFA).

## Domäner och e-post

- Appen: `test.miljonmatch.se` (testmiljön) och `app.miljonmatch.se` (produktion). DNS för miljonmatch.se ligger hos one.com – lägg en CNAME per underdomän mot värdet Vercel visar. `www.miljonmatch.se` är en befintlig webbplats och ska inte röras.
- E-post: från `notis@miljonbemanning.se` via Resend (region EU, Irland). Resends DNS-poster ligger i Google Cloud DNS-zonen för miljonbemanning.se, som styrs av Terraform – posterna ska också in i Terraform-koden.
