# Plan fas 1 – det som väntar på ert godkännande

*Enligt CLAUDE.md byggs inget som rör databas, behörigheter, AI, e-post/SMS eller fakturering mot riktiga system förrän planen är godkänd. Version 2026-09-30.*

## Läget nu

Riktiga appen finns i repot (Next.js 16, TypeScript strict, Tailwind med MB:s färger, zod). Skärmar, rutter, API-hanterare och domänlogik är byggda en gång och används av både appen och prototypen (se `docs/ARKITEKTUR.md`). Just nu kör båda mot **påhittade testdata i minnet**, med behörighetsregler (`src/data/policy.ts`) som är skrivna för att bli RLS-policyer i Postgres.

Det som återstår för drift är att byta datalagret och koppla in de riktiga tjänsterna. Hanterarna och skärmarna ändras inte – därför kommer prototypen fortsatt att spegla appen.

## 1. Konton och regioner (fas 0)

- Supabase: två projekt, **staging** och **produktion**, båda i **eu-north-1 (Stockholm)**. Staging har bara testdata.
- Vercel: ett projekt med `regions: ["arn1"]` (finns redan i `vercel.json`). Preview-deployer pekar aldrig mot produktionsdatabasen.
- GitHub: repot `miljonmatch` under Miljonbemannings organisation.
- Alla konton ägs av Miljonbemanning AB via funktionsadress, minst två administratörer, MFA överallt, fakturering på bolaget.

## 2. Databas – migrationer i ordning (`supabase/migrations/`)

| # | Innehåll |
|---|---|
| 0001 | Grund: `holidays` (genereras av `src/core/holidays.ts`), `organizations`, `contracts` (config som jsonb, valideras med zod i appen), `contract_areas`, `price_items` |
| 0002 | Användare: `profiles` (= auth.users), `memberships`; hjälpfunktioner `my_role(contract_id)`, `my_contracts()`, `is_supplier()` |
| 0003 | Ärenden: `persons` (personnummer krypterat + HMAC-hash), `cases`, `case_status_history`, `case_counters` med funktionen `next_case_number()` (radlås i samma transaktion), `case_team`, `buyer_references` |
| 0004 | Avrop: `inbound_emails` + privat bucket för mejl och bilagor |
| 0005 | Coachning: `intake_assessments`, `activities`, `attendance`, `check_ins`, `monthly_assessments`, `monthly_plans`, `outcome_events`, `deviations`, `consents`, `employers`, `placements` |
| 0006 | Rapporter och kommunikation: `reports` + privat bucket för PDF, `messages`, `user_notifications`, `tasks`, `outbound_messages` |
| 0007 | Uppföljning: `contract_deviations`, `alerts`, `alert_acks`, `deadlines`, `kpi_snapshots`, `pulse_invites`, `pulse_responses` |
| 0008 | Fakturering: `billing_runs`, `invoice_drafts`, `invoice_lines`, `billing_week_approvals`, `integrations` (hemligheter krypterade) |
| 0009 | Drift: `jobs`, `ai_runs`, `ai_field_decisions`, `audit_log` (append-only: ingen update/delete för någon roll), `org_settings` |

Seed för staging och lokal utveckling (`supabase/seed.sql`) genereras från samma testdata som prototypen.

## 3. Row Level Security – neka som standard

RLS på varje tabell. Reglerna är desamma som i `src/data/policy.ts` i dag:

| Roll | Ser |
|---|---|
| Systemadmin | Allt, inklusive konfiguration och revisionslogg |
| Avtalsansvarig, samordnare | Alla ärenden i sina avtal (skyddade: bara avtalsansvarig) |
| Huvudcoach | Egna ärenden och ärenden där coachen ingår i teamet |
| Handledare | Bara tilldelade ärenden |
| Chef/controller | Allt i läsläge, KPI:er, flaggor, revisionslogg (inte skyddade ärendens detaljer) |
| Ekonom | Ärendenummer, perioder, område, referenser, närvaro för debitering, fakturor – inga anteckningar eller rapporter |
| Kommunens handläggare | Ärenden hon beställt (eller enhetens, om avtalet säger det), levererade rapporter, meddelanden i sina ärenden |
| Kommunens chef | Enhetens ärenden (inte skyddade) och beställarrapporten |

Särskilt: RLS döljer rader, inte kolumner. Kommunen får därför inte läsa avtalsraden direkt (den innehåller det interna målet 35 %) – interna mål flyttas till `org_settings` eller exponeras via en vy utan interna delar, och kolumner som `activities.note` exponeras för kommunen bara via vyer. Coachen läser inga enskilda pulssvar (aggregat från 5 svar via en `security definer`-funktion), personliga notiser läses bara av mottagaren, revisionsloggen bara av admin och chef.

**Tester:** samma fall som `src/data/policy.test.ts` körs mot en lokal Supabase (`supabase db reset` + tester) i CI – kommunanvändare ser bara sina ärenden, ekonom ser inga coachanteckningar, handledare bara tilldelade, skyddade bara namngivna.

## 4. Inloggning

- **Miljonbemanning:** Microsoft Entra ID via Supabase Auth (Azure-leverantören). Bara inbjudna konton, MFA styrs av M365.
- **Kommunen:** e-post + sexsiffrig kod (inte länk – Safe Links förbrukar länkar). Koden gäller 10 minuter, max 5 försök, hastighetsbegränsning per adress och IP, tillåtna domäner per beställare. Utloggning efter 60 minuters inaktivitet, max 12 timmar. (Beslut 2026-10-02: appen tar fram koden med Supabase Auth och skickar mejlet själv via Resend – ingen SMTP i Supabase Auth behövs, `docs/UTSKICK.md`.)
- Next.js `proxy.ts` kräver inloggning för allt utom portalens inloggning och pulslänken. Utvecklingslägets testpersonväljare stängs av i produktion.

## 5. Personnummer

AES-256-GCM i appen (nyckel i miljövariabel), sökning via HMAC-SHA256. Visas maskerat; "Visa" loggas i revisionsloggen. Dubblettkontroll på hashen inom avtalet.

## 6. Mejlavrop via avrop@

- Egen appregistrering i Entra med rätt att läsa **bara** avrop@-brevlådan (applikationsbehörighet begränsad med Exchange Online RBAC för applikationer).
- Bakgrundsjobb var 2–5 minut: hämta nya mejl, spara i privat bucket, tolka Word-mallen 01 deterministiskt, fritext med AI-adaptern (samma zod-schema som portalen), skapa ärende med ärendenummer.
- Ordererkännande från avrop@ via Graph inom 5 minuter, utan personuppgifter, med saknade uppgifter listade. Kompletteringar kopplas via ärendenumret i ämnesraden.

## 7. E-post och SMS (`lib/notify`)

EU-baserad transaktionell e-post (behövs också för Supabase Auth) och svensk SMS-leverantör. SPF: lägg till leverantörens include i den befintliga M365-posten (en domän får bara ha en SPF-post), DKIM och DMARC. Mallarna versioneras i adminvyn och innehåller aldrig personuppgifter.

## 8. Bakgrundsjobb

Tabellen `jobs` + `/api/jobs/run` skyddad med hemlig nyckel, anropas av cron varje minut. `FOR UPDATE SKIP LOCKED`, idempotent, begränsat antal försök, felorsak sparas. Jobb: mejlinläsning, påminnelser (närvaro måndag 10.00, rapporter), publicering av veckorapport, eskaleringar, gallring.

## 9. Fas 2 (planeras i detalj senare)

- **AI** via `lib/ai` (Berget AI i Sverige eller Vertex AI EU-endpoint): bara med registrerat samtycke, aldrig skyddade ärenden, ljud raderas direkt efter transkribering. A/B-test av leverantörerna.
- **Fortnox**: OAuth 2.0, fakturor som ej bokförda utkast, idempotensnyckel, hastighetsgräns 25 anrop per 5 sekunder. Testfakturan verifieras med Botkyrkas e-handel innan skarp drift.

## 10. Ordning

1. Konton och regioner. Migrationer 0001–0003, RLS och RLS-tester, `SupabaseRepo`, inloggning för båda grupperna.
2. Mejlavrop, ordererkännande, ärendenummer, portalbeställning, orderbekräftelse.
3. Närvaro och veckorapport (publicering måndag 16.00, eskalering 10.00), veckoavstämning.
4. Månadsbedömning, månads- och slutrapport som PDF, fakturaunderlag med Excel/PDF-export, deadline-vyn, revisionsloggen.

Prototypen publiceras från samma kod efter varje steg, så att det ni testar alltid är det som byggs.

## 11. Det som blockerar eller behöver beslut

- Godkännande av den här planen.
- Konton: Supabase och Vercel på bolaget (Supabase-kopplingen finns i den här sessionen – efter ert godkännande kan projekten skapas direkt i Stockholm).
- SPEC §13: beställarreferensen (3), resultatdefinitionen (6), inloggning för kommunen (9), Fortnox (15), systemägare och DNS (16), SMS- och e-postleverantör (18). Incitamentsmodellen (13) behövs för bonusflödet.
