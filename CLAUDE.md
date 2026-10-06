# Miljonmatch

Plattform för arbetsmarknadsinsatser. Repo: `miljonmatch`. Ägare: Miljonbemanning AB. Avtal nr 1 (pilot): Botkyrka kommun, avtal 332026110 (dnr AVN/2026:00048). Miljonmatch är kommunernas plattform – fler kommunavtal kan läggas till som konfiguration. Kammarkollegiet får en egen plattform (beslut 2026-10-06) – blandas aldrig ihop med Miljonmatch. Hela kravspecen finns i `SPEC.md` (v0.2) – läs relevant avsnitt innan du bygger något nytt.

## Arbetssätt

- Planera innan du kodar. Föreslå plan (filer, migrationer, RLS, tester) och vänta på OK för allt som rör databas, behörigheter, AI, e-post/SMS eller fakturering.
- Små, avgränsade ändringar. En migration per ändring (Supabase CLI, `supabase/migrations/`). Uppdatera `SPEC.md` när ett beslut ändras.
- Bygg i fasordning enligt `SPEC.md` §12. AI-transkribering hör till fas 2: Botkyrka har godkänt inspelning, men varje deltagare måste ha ett registrerat samtycke innan något spelas in.
- Utveckling och staging använder bara påhittade testdata. Riktiga personuppgifter finns aldrig utanför produktion.

## Stack (låst)

- Next.js (App Router) + TypeScript strict, Tailwind, shadcn/ui med MB-tema, zod för all validering (formulär, API, AI-svar, avtalskonfiguration).
- Supabase (Postgres, Auth, Storage) i **eu-north-1 (Stockholm)**.
- Vercel: `vercel.json` ska innehålla `"regions": ["arn1"]`. Vercels standardregion är iad1 (USA) och får inte användas.
- All serverlogik som rör personuppgifter körs i Next.js på Vercel (arn1). Använd inte Supabase Edge Functions för persondata – de körs som standard i regionen närmast anroparen.
- Undvik Vercel-specifika lagringstjänster för persondata (t.ex. Blob och Edge Config). Appen ska kunna flyttas till annan drift utan omskrivning.
- PDF: `@react-pdf/renderer`. E-post och SMS: bara via `lib/notify/`. AI: bara via adaptern `lib/ai/` (SPEC §8) – anropa aldrig en AI-leverantör direkt från en feature. Aldrig Gemini via AI Studio-nyckel eller global endpoint.
- Bakgrundsjobb: tabellen `jobs` + route `/api/jobs/run` (skyddad med hemlig nyckel) som anropas av cron varje minut. Hämta jobb med `FOR UPDATE SKIP LOCKED`, idempotent, begränsat antal försök, felorsak sparas.

## Icke förhandlingsbart

1. **Row Level Security på varje tabell**, neka som standard. Behörighet = avtal + roll + tilldelning (SPEC §4). Service role används bara server-side och aldrig för att kringgå RLS i vanliga användarflöden.
2. **Inga personuppgifter i loggar, felmeddelanden, URL:er, analysverktyg eller commit-historik.** Logga id:n. Personnummer krypteras på applikationsnivå (AES-256-GCM, nyckel i miljövariabel) och söks via HMAC-hash. Visas maskerat; "visa" loggas.
3. **Revisionslogg** (`audit_log`, append-only) för visning av deltagarkort, rapport och transkript, alla ändringar, exporter och AI-körningar.
4. **Avtalet är konfiguration.** Hårdkoda aldrig avtalsvärden (32 %, 35 %, priser, prefix BOT, deadlines, rapport- och faktureringsregler). Läs dem från `contracts.config`, validerat med ett zod-schema.
5. **AI föreslår – människan bedömer.** AI sätter aldrig progressionsnivå (0–3), samlad status, avslutsorsak eller resultat. AI föreslår text med belägg (citat + tidpunkt). Bedömningsfält är tomma tills coachen gjort ett aktivt val.
6. **Rapporter byggs bara av godkända uppgifter** – aldrig direkt från råtranskript.
7. **Ljud raderas direkt efter lyckad transkribering** (senast efter 24 h vid fel). Råtranskript raderas när avstämningen godkänts, senast efter 30 dagar.
8. **Skyddade personuppgifter** (`protected_identity = true`): ingen adress lagras, inga SMS eller mejl till deltagaren, ingen AI, åtkomst bara för namngiven coach och avtalsansvarig.
9. **E-post och SMS innehåller aldrig personuppgifter** – bara ärendenummer och länk till portalen. Inga rapporter som bilaga i vanlig e-post om inte avtalskonfigurationen uttryckligen tillåter det.
10. **Mejl är kommunens formella beställningskanal.** Mejlavropet via avrop@ ska alltid fungera fullt ut, även för kommunanvändare som aldrig loggar in i portalen.
11. **Fakturor:** kommunens beställarreferens (8–10 siffror, bara siffror) krävs och valideras innan en faktura får skapas. Våra egna nummer (ärendenummer) läggs aldrig i fältet för kundens inköpsordernummer – det fältet används bara för kommunens egna ordernummer (nio siffror som börjar med 99). Inga namn eller personnummer på fakturor.
12. Tid: `Europe/Stockholm`. Veckor enligt ISO 8601. Arbetsdagar räknas med svenska helgdagar (tabellen `holidays`). Belopp i öre (heltal), priser exkl. moms, momssats per artikel.

## Språk och ton

- All text som användare ser (UI, e-post, SMS, PDF) är på svenska och i klarspråk. Kommunens portal skrivs för ovana användare: korta meningar, inga förkortningar, hjälptext vid varje fält, en sak per skärm.
- Tabeller, kolumner, variabler och filnamn på engelska enligt ordlistan nedan. Kommentarer får vara på svenska.
- AI-genererad text är saklig, respektfull och funktionell. Inga diagnoser, inga spekulationer, inga omdömen om personlighet. Okänt skrivs "Framgår inte".

## Design – MB:s grafiska profil (inga andra färger)

- Färger: antracit `#1E252B`, röd `#FF0C01`, ljusgrå `#D1D3D3`, blå `#6BA2B9` samt vitt. Inget grönt. Logotypfilernas röda är `#ED2526`.
- Typsnitt: Montserrat (via `next/font`). Sidrubriker och sektionsetiketter i versaler, brödtext i normal skrift. Röd punkt som accent. Tahu (skript) används inte i appen.
- Kontrast (WCAG 2.1 AA): brödtext är alltid antracit på vitt (ca 15,5:1). Röd på vitt är ca 4,0:1 – bara stor/fet text, ikoner och knappytor. Blå på vitt är ca 2,8:1 – aldrig som text; använd blå som yta med antracit text (ca 5,5:1).
- Status visas alltid med text + ikon, aldrig bara färg. Mallarnas ord Grön/Gul/Röd skrivs ut som text; färgkodning: Grön → blå, Gul → ljusgrå, Röd → röd.
- Brödtext minst 16 px (kommunportalen 18 px). Klickytor minst 44 × 44 px. Allt ska fungera med tangentbord och skärmläsare.
- PDF-rapporter: logotyp överst, avtals- och ärendeinformation i högerställt block, rubriker i versaler.
- Förebild: coachens Min vecka (beslut 2026-10-06). Alla MB-roller börjar på en Min vecka i samma stil med sina egna uppgifter (kitet `src/ui/vecka.tsx`, reglerna i `src/ui/README.md`). Menyn: Min vardag för alla och högst en rollflik.

## Ordlista (UI på svenska → kod på engelska)

| UI | Kod |
|---|---|
| avtal | contract |
| beställare / leverantör | customer / supplier (`organizations.kind`) |
| avtalsområde A–L | contract_area |
| yrkesspår | vocational_track |
| avrop, beställning | referral / order (ett avrop blir ett ärende) |
| ordererkännande / orderbekräftelse | order_acknowledgement / order_confirmation |
| ärende, ärendenummer | case, case_number |
| beställarreferens | buyer_reference |
| inköpsordernummer (kommunens, 99…) | purchase_order_number |
| deltagare | participant (person + case) |
| huvudcoach | lead_coach |
| yrkesspecifik handledare | vocational_supervisor |
| arbetsgivarmatchare | employer_matcher |
| SYV/metodstöd | guidance_counselor |
| kartläggning | intake_assessment |
| avstämning (vecka) | check_in |
| månadsbedömning, progressionsområde | monthly_assessment, progress_area |
| närvaro / frånvaro | attendance |
| veckorapport (närvaro) | weekly_attendance_report |
| händelse, utfall | outcome_event |
| avslut, avslutsorsak | closure, end_reason |
| avvikelse (deltagarnivå) | deviation |
| avtalsavvikelse, varning, åtgärdsplan | contract_deviation, warning, action_plan |
| praktik/APL | placement |
| pulsmätning | pulse_survey |
| månadsrapport individ / slutrapport | monthly_report / final_report |
| beställarrapport (chef) | customer_summary_report |
| yrkeskompetensbevis | skills_certificate |
| bonusanspråk | bonus_claim |
| fakturaunderlag | billing_basis |
| samtycke | consent |
| skyddade personuppgifter | protected_identity |
| gallring | retention |

## Tester (krav innan merge)

- Enhetstester: resultatgrad och övriga KPI:er; debiterbara veckor (alla ISO-veckor med minst en inskriven dag, utom uppehåll) och veckans månadstillhörighet (torsdagsregeln); arbetsdagar/SLA-förfall; ärendenummer; validering av beställarreferens och inköpsordernummer.
- RLS-tester per roll: kommunanvändare ser bara sina ärenden, ekonom ser inga coachanteckningar, handledare ser bara tilldelade ärenden, skyddade ärenden syns bara för namngivna.
- E2E: mejlavrop → ordererkännande med ärendenummer → orderbekräftelse → närvaro → veckorapport → månadsbedömning → månadsrapport-PDF → fakturaunderlag.

## Arkitektur – prototypen speglar riktiga appen

Läs `docs/ARKITEKTUR.md` innan du bygger något. Kort: skärmar, rutter, API-hanterare och domänlogik är **samma kod** i riktiga appen och i prototypen. Bara datalagret skiljer: prototypen och utvecklingsläget kör `MemoryRepo` (påhittade testdata, behörighet via `src/data/policy.ts` som speglar RLS), produktion kör Supabase med RLS. Prototypen byggs till en HTML-fil med `npm run demo:build` och publiceras som artefakt.

## Kommandon

- `npm run dev` – riktiga appen i utvecklingsläge (minnesläge med testdata, välj testperson i verktygsfältet)
- `npm run check` – typkontroll + lint + enhetstester (körs före varje commit)
- `npm run test` – enhetstester (Vitest)
- `npm run demo:build` – bygg prototypen till `dist-demo/index.html`
- `npm run build && npm run e2e` – E2E mot både prototypen och appen (Playwright)
- Supabase (`supabase db reset` + seed) och deploy läggs till när databasplanen är godkänd.

@AGENTS.md
