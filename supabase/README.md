# Databasen – migrationer, RLS och seed (Supabase/Postgres)

Allt här verifieras lokalt i PGlite (Postgres i processen) med `npx vitest run src/data/supabase/rls-parity.test.ts`.
Supabase-projekten (staging och produktion, båda i **eu-north-1 Stockholm**) skapas av samordnaren.

## Filer

| Fil | Innehåll |
|---|---|
| `migrations/0001_grund.sql` | Tidszon, schemat `mm`, `holidays`, `organizations`, `contracts`, `contract_areas`, `price_items` |
| `migrations/0002_anvandare.sql` | `profiles`, `memberships`, `app_settings`, `tester_sessions`, `login_attempts`; `mm.current_profile_id()`, `mm.current_role()`, `mm.my_contract_ids()` …; vyn `contracts_public`; `public.current_actor()` |
| `migrations/0003_arenden.sql` | `buyer_references`, `persons`, `cases`, `case_status_history`, `case_counters`, `case_team`; `mm.case_access(case_id)` (port av `caseAccess`), `mm.next_case_number()` |
| `migrations/0004_avrop.sql` | `inbound_emails` + privat bucket `inbound-emails` |
| `migrations/0005_coachning.sql` | Kartläggning, aktiviteter, närvaro, avstämningar, månadsbedömningar och -planer, händelser, avvikelser, samtycken, arbetsgivare, praktik |
| `migrations/0006_rapporter.sql` | `reports` (+ privat bucket `reports`), `messages`, `user_notifications`, `notification_reads`, `tasks`, `outbound_messages`, `case_seen` |
| `migrations/0007_uppfoljning.sql` | `contract_deviations`, `alerts`, `alert_acks`, `deadlines`, `kpi_snapshots`, `pulse_invites`, `pulse_responses`, `bonus_claims` |
| `migrations/0008_fakturering.sql` | `billing_runs`, `invoice_drafts`, `invoice_lines`, `billing_week_approvals`, `invoice_credits`, `fortnox_runs`, `integrations` |
| `migrations/0009_drift.sql` | `jobs` + `mm.claim_jobs()`, `ai_runs`, `ai_field_decisions`, `audit_log` (append-only), `org_settings`, `template_versions`, `log_checks`, `demo_tags` |
| `seed.sql` | **Genererad** testdata (samma som prototypen) + testarna + testmiljöns inställningar. Ändra aldrig för hand. |
| `../scripts/db/columns.ts` | Facit för kolumnerna (kontrolleras mot `src/data/schema.ts` vid kompilering och mot databasen i testet) |
| `../scripts/db/seed-sql.ts`, `generate-seed.ts` | Bygger `seed.sql` |

Generera seeden efter ändringar i testdatat eller i `schema.ts`:

```bash
npx tsx scripts/db/generate-seed.ts
npx vitest run src/data/supabase/rls-parity.test.ts
```

## Så läggs databasen upp i ett Supabase-projekt

### 1. Migrationerna (staging och produktion)

Kör filerna i nummerordning, en i taget. Tre sätt – välj ett:

- **Supabase CLI:** `supabase link --project-ref <ref>` och sedan `supabase db push`. CLI:t läser `supabase/migrations/` och sparar vilka som körts.
- **MCP (Supabase-kopplingen):** `apply_migration` med namnet utan `.sql` (t.ex. `0001_grund`) och filens innehåll, i ordning 0001 → 0009.
- **SQL-editorn:** klistra in och kör varje fil i ordning.

Kontrollera efteråt i en **ny** anslutning: `show timezone;` ska ge `Europe/Stockholm`. (Inställningen gäller nya anslutningar – starta om projektet eller vänta tills anslutningspoolen förnyats innan appen skriver tider.)

### 2. Testmiljön (staging): seeden

Seeden är 2,8 MB – kör den med `psql` mot projektets **session pooler** (fungerar med IPv4), inte i SQL-editorn. Kopiera anslutningssträngen under Connect → Session pooler i Supabase:

```bash
psql "postgresql://postgres.<ref>:<lösenord>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

(Med CLI går även `supabase db push --include-seed`.)

Seeden:
- tömmer först alla appens tabeller (`truncate … cascade`, aldrig `auth.*`) – den kan köras om,
- stoppar sig själv om `app_settings.environment` finns och inte är `staging`, eller om databasen redan har ärenden utan inställningen,
- lägger in testarna **Karim Khalil** (`karim.khalil@miljonbemanning.se`) och **Ali Khalil** (`ali.khalil@miljonbemanning.se`) som admin i båda avtalen med `is_tester = true`,
- sätter `app_settings`: `environment = staging`, `clock_demo_epoch = 2027-02-01T09:12`, `clock_real_epoch = now()` – **testklockan startar om på 1 februari 2027 kl. 09.12 varje gång seeden körs**,
- kopplar testarnas profiler till deras konton i `auth.users` via e-postadressen om kontona redan finns (så att inloggningen överlever en omseedning).

### 3. Produktion

- Kör bara migrationerna. **Kör aldrig `seed.sql`.**
- Lägg in miljön en gång: `insert into public.app_settings (key, value) values ('environment', 'production');` Då är testarfunktionen avstängd och seeden vägrar köra. Inga klockepoker = riktig tid.

### 4. Inställningar i Supabase

- **Data API:** exponera bara schemat `public` (standard). Schemat `mm` ska inte exponeras – policyerna anropar funktionerna där direkt.
- **Auth:** stäng självregistrering. Servern skapar kontot (service role) när en inbjuden profil loggar in första gången och sätter `profiles.auth_user_id` (se `docs/DRIFT.md`).
- **Storage:** bucketarna `inbound-emails` och `reports` skapas privata av migrationerna. Inga policyer på `storage.objects` – bara servern (service role) läser och skriver.
- Advisors kan varna för att några rena hjälpfunktioner saknar fast `search_path` (`mm.member_in`, `mm.case_access_level`, `mm.unit_covers`, `mm.customer_scope`, `mm.customer_safe_config`, rollistorna). Det är avsiktligt: de läser inga tabeller och måste kunna bakas in i frågan av planeraren (en `set search_path` stoppar det och gör RLS långsamt). Alla funktioner som läser tabeller är `security definer` med `set search_path = public, mm` och schemakvalificerade tabellnamn. "RLS enabled, no policy" för `app_settings` och `login_attempts` är också avsiktligt (bara service role).

## Namn och typer

Tabellnamnen = nycklarna i `Tables` (`src/data/schema.ts`). Kolumnnamn = fältnamnet med versaler omskrivna till `_` + gemen (`caseNumber` → `case_number`, `personnummerLast4` → `personnummer_last4`, `goal1` → `goal1`). Reserverade ord skrivs med citattecken i SQL: `outbound_messages."to"`, `kpi_snapshots."window"` (PostgREST hanterar det själv).

| TypeScript | Postgres |
|---|---|
| `LocalDate` | `date` |
| `LocalDateTime` | `timestamptz` (tolkas och visas som Europe/Stockholm) |
| belopp i öre (`…Ore`) | `bigint` |
| andelar, momssats, antal (`value`, `vatRate`, `quantity`) | `numeric` |
| övriga tal | `integer` |
| strängar, nycklar, `MonthKey`, `WeekKey`, statusar | `text` |
| `string[]` | `text[]` (datumlistor `date[]`) |
| objekt, records, listor av objekt, `unknown` | `jsonb` |

Nullbara fält är nullbara kolumner; valfria fält (`x?:`) är nullbara kolumner. Primärnycklar är `text` (seedens id:n behålls, nya id:n `${prefix}-${crypto.randomUUID()}`). Inga `default now()` för affärstider.

Extra kolumner som bara finns i databasen (`EXTRA_COLUMNS` i `scripts/db/columns.ts`):

| Kolumn | Varför |
|---|---|
| `profiles.auth_user_id uuid unique` | Kopplingen till `auth.users`. Seedens påhittade profiler får deterministiska värden (uuid v5 av profil-id, `authUserIdFor()`), utan konto i `auth.users` – ingen kan logga in som dem. Ingen främmande nyckel mot `auth.users` av det skälet. |
| `profiles.is_tester boolean` | Testare i testmiljön. |
| `outbound_messages.status_reason`, `provider_message_id` | Orsak när ett utskick stoppats (`suppressed`, t.ex. spärren i testmiljön) och leverantörens id. `status` är fri text: `queued`, `sent`, `failed`, `suppressed`, `manual`. |
| `jobs.started_at` | När `claim_jobs` senast hämtade jobbet – för att hitta jobb som fastnat. |

`profiles.email` lagras alltid med gemener (triggern `profiles_protect_columns` gör om) och är unik när den inte är tom.

## Behörighet (RLS)

### Aktören

| Funktion | Motsvarar | Regel |
|---|---|---|
| `mm.current_profile_id()` | `Actor.userId` | Testpersonen i `tester_sessions` om testmiljö + testare, annars den aktiva profilen med `auth_user_id = auth.uid()` |
| `mm.current_role()` | `Actor.role` | Testpersonens valda roll, annars rollen i användarens medlemskap (flera roller: medlemskapet med lägst id – `actorFor` tar det första) |
| `mm.my_contract_ids()` | `Actor.contractIds` | Avtalen där profilen har rollen |
| `mm.current_unit()` | `Actor.customerUnit` | Medlemskapets enhet, annars profilens |
| `mm.case_access(case_id)` | `caseAccess` | `full` · `team` · `restricted` · `billing` · `customer` · `none` – exakt port av `src/core/access.ts` |
| `public.current_actor()` | – | Allt ovan som JSON: `{ userId, role, contractIds, customerUnit, authProfileId, isTester, environment, impersonating }`. **Servern ska bygga `Actor` från detta anrop** så att hanterarnas rollkontroll och RLS alltid ser samma aktör. |

Inaktiva profiler (`active = false`) har ingen aktör alls – de ser ingenting.

### Testare i testmiljön

En testare väljer testperson genom att skriva en rad i `tester_sessions (auth_user_id, profile_id, role)` – själv via RLS eller via servern med service role. Den gäller bara när `app_settings.environment = 'staging'`, profilen har `is_tester = true` och personen faktiskt har rollen (i `memberships`), eller `profile_id = 'deltagare'` med rollen `deltagare` (pulslänkens deltagare har ingen profil). Annars agerar testaren som sig själv. I produktion gör raden ingenting och testaren kan inte skriva den. `is_tester` och `auth_user_id` kan bara ändras av servern (service role) – triggern `profiles_protect_columns` stoppar alla andra, även admin.

### Policyerna

En policy per tabell och operation, **samma regler som `src/data/policy.ts`** – kommentaren ovanför varje policy anger regeln. Gemensamt:

- **Läsning** (`select … using`): läsregeln.
- **Ny rad** (`insert … with check`): skrivregeln med raden som ny (policy.ts `exists` = falskt).
- **Ändring** (`update … using … with check`): läsregeln på den befintliga raden (MemoryRepo kräver läsrätt) och skrivregeln på den nya raden (`exists` = sant).
- **Borttagning:** bara `case_team` (coachbyte – den enda tabell hanterarna tar bort rader i). Alla andra tabeller nekar borttagning för `authenticated`, fast policy.ts `remove` skulle tillåta den som får skriva. Neka som standard; lägg till en policy den dag en hanterare behöver ta bort.
- Tabeller där policy.ts säger `write: never` har ingen skrivpolicy och ingen skrivrättighet (`case_counters`, `kpi_snapshots`, `deadlines`, `audit_log`, `outbound_messages`, `user_notifications`, `demo_tags`). `alerts` kan bara ändras (kvitteras), inte skapas.
- Rättigheter: `anon` har ingenting (inte ens på nya tabeller – standardrättigheterna i `public` tas bort i 0001). `authenticated` får bara de operationer som har policyer. `service_role` går förbi RLS (`ctx.system`: löpnummer, revisionslogg, utskick, notiser till andra, bakgrundsjobb).
- Prestanda: åtkomsten till alla ärenden räknas en gång per fråga (`case_id in (select mm.case_ids('{full,team}'))`, `(select mm.current_role())`), inte per rad.

### Beslut: avtalets interna mål (`contracts_public`)

RLS döljer rader, inte kolumner. `contracts.config` innehåller interna mål (`kpis[].internalTarget`, t.ex. 35 %) och interna notisregler (`kpis[].notify`). Kommunen får enligt policy.ts läsa avtalsraden – men inte de interna delarna. Lösning:

- Tabellen `contracts` läses direkt bara av MB-roller i sina avtal (och admin). Kommunen får inga rader ur tabellen.
- Vyn **`contracts_public`** ger exakt raderna i policy.ts (MB och kommunen i sina avtal). Kommunen får `config` utan `internalTarget` och `notify` i `kpis`; MB får hela `config`. Den rensade konfigurationen klarar fortfarande `requireOperational()` (testat), och `src/core/customer-summary.ts` tar redan bort det interna målet ur kommunens vy – så hanterarna beter sig likadant.
- **SupabaseRepo läser tabellen `contracts` via `contracts_public`** (`get`, `list`, `first`, `count`); skrivningar (bara admin) går till `contracts`.

Varför inte neka kommunen och läsa via `ctx.system`: då skulle hanterare som `contractOf()` och beställningen i `src/features/*` behöva ändras.

### Kända kolumnfrågor (att lösa med vyer senare)

Samma sak som ovan gäller andra kolumner, men där är beteendet redan identiskt med prototypen och inget internt mål exponeras. De bör ses över innan riktiga personuppgifter läggs in:

- Ekonomen (`billing`) läser hela ärenderaden, t.ex. `cases.background_info` och beställarens kontaktuppgifter.
- Kommunen och ekonomen läser `activities.note` (tom i testdatat).
- Den som får ändra en rad får ändra alla kolumner i den (t.ex. kommunen som kvitterar en rapport, `opened_at`). Hanterarna ändrar bara rätt kolumner; ett direktanrop mot API:t skulle kunna ändra fler. Lösning: triggers som begränsar kolumnerna per roll.

### Övriga beslut

- **Främmande nycklar** bara där värdet alltid är en befintlig rad: ärende, avtal, person, organisation, fakturautkast, aktivitet, pulslänk, arbetsgivare, samt `memberships.user_id`, `case_team.user_id`, `cases.lead_coach_id`, `cases.referrer_id`, `case_seen`. Inga nycklar på användar-id som kan vara `system` (`changed_by`, `created_by`, `from_id`, `actor_id` …) eller på valfria korslänkar (`ai_run_id`, `source_email_id`, `check_in_id` …).
- **Unika:** `cases.case_number`, `contract_areas (contract_id, code)`, `case_counters (contract_id, year)`, `memberships (user_id, contract_id, role)`, `profiles.email` (icke tom), `profiles.auth_user_id`, `pulse_invites.token_hash`, `invoice_drafts.fortnox_idempotency_key`, `holidays.date`.
- **Inga avtalsvärden i databasen** (CLAUDE.md punkt 4): format på beställarreferens och inköpsordernummer valideras i appen mot `contracts.config`.
- **Revisionsloggen** är append-only: triggern `audit_log_append_only` stoppar `update` och `delete` för alla roller, även service role. `insert` bara för service role. Bara seeden tömmer den (`truncate`, som `postgres`).
- **Bakgrundsjobb:** `mm.claim_jobs(n, p_now, p_max_attempts = 5, p_stale_after = '10 minutes')` – och samma funktion som `public.claim_jobs` för `.rpc("claim_jobs", { n })` – hämtar köade jobb vars `run_after` passerats (och jobb som fastnat i `running`), med `FOR UPDATE SKIP LOCKED`, sätter `running`, ökar `attempts` och sätter `started_at`. Tiden är `p_now` eller `mm.app_now()` (testtid i testmiljön, riktig tid i produktion) – jobb får `run_after` från `ctx.now()`, som är testtid i testmiljön. Bara service role får anropa.
- **Löpnummer:** `public.next_case_number(contract_id, year)` (service role) räknar upp `case_counters` med radlås. Hanterarna använder i dag `ctx.system` + `case_counters`; `cases.case_number` är unik så att en krock ger fel i stället för dubbletter.
- **Tidszon:** `alter database … set timezone to 'Europe/Stockholm'` i 0001 och `set timezone` överst i `seed.sql`. Seeden skriver tider som `'2027-02-01T09:12'` (Stockholmstid). Testet visar att alla tider läses tillbaka som samma lokala tid, både vintertid (+01) och sommartid (+02).
- `holidays` fylls av seeden (2026–2027). Hanterarna räknar helgdagar i `src/core/holidays.ts` och läser inte tabellen.

## Till SupabaseRepo (serverdelen)

- Läs `contracts` via vyn `contracts_public`.
- Bygg `Actor` från `rpc("current_actor")` med användarens session.
- Skriv utan `RETURNING` (`Prefer: return=minimal`, alltså ingen `.select()` efter `insert`/`update`). En ny rad är inte alltid läsbar direkt (en ny person syns först när ärendet finns, en coach som lämnar över ett ärende ser det inte längre). Med `.select()` blir det då fel. `insert` returnerar indataraden, precis som MemoryRepo.
- `update`: använd `{ count: "exact" }`. 0 rader betyder att raden inte finns eller inte är synlig (MemoryRepo kastar då `PolicyError`). Fel med kod `42501` (behörighet saknas eller raden bryter mot en policy) är också `PolicyError`.
- Tider kommer tillbaka som `'2027-02-01T09:12:00+01:00'` → `toStockholmLocal()`.

## Tester (`src/data/supabase/rls-parity.test.ts`)

PGlite med en minimal Supabase-stubbe (`src/data/supabase/pglite.ts`: rollerna, `auth.users`, `auth.uid()` från `request.jwt.claims`, Supabases standardrättigheter), alla migrationer och `seed.sql`, plus extra rader för tabeller som testdatat lämnar tomma (flaggor, deadlines, bonus, fakturarader, AI-beslut, skyddade ärenden). Testet visar:

- `seed.sql` är genererad från nuvarande testdata; kolumnerna (namn, typ, nullbarhet) är exakt `scripts/db/columns.ts`; varje tabell har RLS; `anon` har inga rättigheter.
- **Läsning:** för varje testperson i `listPersonas()` (alla roller, alla användare, deltagaren och testarna) och varje tabell är antalet synliga rader lika med `MemoryRepo` + `POLICIES`. Id-mängderna för `cases`, `reports`, `messages` och `check_ins` är lika, och `current_actor()` är samma aktör som `actorFor()`. `mm.case_access` är lika med `caseAccess` för varje ärende.
- **Skrivning:** för varje testperson och tabell, ändring av rader den får och inte får läsa, och en ny rad: databasen tillåter exakt det som policy.ts tillåter.
- Särskilda fall: kommunen kan inte ändra ärenden den inte beställt (chefen inga alls). Kommunen kan skapa meddelanden bara i egna ärenden och i eget namn. Ingen kan ändra revisionsloggen, inte ens service role. Testaren kan agera som testperson bara i testmiljön. Inloggningskolumnerna skyddas. `claim_jobs`, `next_case_number` och testklockan fungerar.

Testet tar ca 45 sekunder.
