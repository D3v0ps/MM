# Miljöer

| Miljö | Supabase-projekt | Region | Data | App |
|---|---|---|---|---|
| Testmiljö (staging) | `miljonmatch` (ref `blxupsebzzhmjitaywev`), org "D3v0ps's Org" | eu-north-1 (Stockholm) | Bara påhittade testdata | Vercel, adress `*.vercel.app` först – egen domän senare |
| Produktion | Skapas senare, eget projekt i Stockholm | eu-north-1 | Riktiga personuppgifter | `portal.miljonbemanning.se` (SPEC §11) |
| Prototyp | – (data i webbläsaren) | – | Påhittade testdata | Artefakten på claude.ai, byggd med `npm run demo:build` |

## Testmiljön

- API-adress: `https://blxupsebzzhmjitaywev.supabase.co`
- Publik nyckel (får finnas i webbläsaren, skyddas av RLS): `sb_publishable_6gWujM1P_blTRgFvPTMiGQ_cYDPcmGO`
- Hemliga nycklar (service role, Resend, krypteringsnycklar) läggs **bara** i Vercels miljövariabler – aldrig i repot eller i chatten. Se `docs/DRIFT.md`.
- Projektet ska flyttas till Miljonbemanning AB:s organisation när den finns (SPEC §11: konton ägs av bolaget via funktionsadress, minst två administratörer, MFA).
