-- 0044 Kommunen läser inte deltagarnas närvaro, tillfällen eller möten (Karims beslut 2026-11-25, SPEC §4 och §7.0).
--
-- "Botkyrka kommuns handläggare kan fortfarande se deltagarnas närvaro och möten etc. Dem ska inte kunna se det." Beslutet:
-- närvaron och mötena tas bort från deltagarens sida i portalen, och databasen låser kommunen ute från tillfällena, närvaron och
-- mötesrapporterna. Veckorapporterna om närvaro står kvar som avtalets formella rapport: de är frysta rapporter i public.reports
-- som levereras till handläggaren under Rapporter (policyn reports_select är oförändrad), och de byggs i ett systemsteg (service
-- role) – inte med handläggarens behörighet. Närvarograden i beställarrapporten påverkas inte (den lämnas av Miljonbemanning
-- utanför portalen).
--
-- 1. public.activities (deltagarnas tillfällen): policyerna activities_select och activities_update skrivs om utan åtkomsten
--    'customer' – läses med åtkomsten full, team eller billing (Miljonbemanning i avtalet och ekonomen för faktureringen), som förut
--    utom kommunen. Ändringens with check är oförändrad (mm.work_on(case_id)), likaså activities_insert och activities_delete.
-- 2. public.attendance (närvaron, med orsakskategori och orsak): policyerna attendance_select och attendance_update på samma sätt.
--    attendance_update behåller with check från 0030 (mm.work_on(case_id) and source = 'manual'); attendance_insert är oförändrad.
--    I ändringarnas using har 'customer' aldrig gett kommunen någon ändring (with check kräver mm.work_on), men utan läsrätt ska
--    raderna inte heller gå att träffa med en ändring – neka som standard.
-- 3. public.check_ins (mötesrapporterna) ändras inte: check_ins_select läser redan bara med åtkomsten full eller team och aldrig
--    ekonomen (0005) – kommunen har aldrig läst mötesrapporterna. Samma sak för det som hör till mötena och tillfällena: transkript
--    och AI-körningar (ai_runs, ai_field_decisions), ljudfilernas rader (audio_uploads – kommunen bara sin egen "Tala in"),
--    inspelningslänkarna (voice_links), avvikelserna (deviations), gruppaktiviteterna med tillfällen och gruppmål (group_activities,
--    group_activity_series, group_goal_results), delmålen på tillfällena (activity_progress_goals) och första mötet som deltagaren
--    inte kom till (first_meeting_no_shows) – ingen av dem läses av kommunen i dag. Prövas i rls-parity.test.ts.
--
-- Miljonbemannings roller och ekonomens läsning för faktureringen är exakt som förut. Speglas i src/data/policy.ts (activities.read
-- och attendance.read: full, team, billing) och prövas i src/data/supabase/rls-parity.test.ts. Portalens deltagarsida läser inte
-- längre tabellerna (src/features/kommun/handlers.ts); rapporterna läser sitt underlag i ett systemsteg (src/features/rapporter/load.ts).
--
-- Driftordning (docs/DRIFT.md): koden FÖRE eller samtidigt med 0044 – koden före 0044 läser närvaron med handläggarens behörighet
-- och skulle efter 0044 visa "Det har inte varit några tillfällen den senaste månaden" i stället för närvarograden.
--
-- Befintliga objekt i produktionen som ersätts: policyerna activities_select och activities_update (0005), attendance_select (0005)
-- och attendance_update (0030) – samma villkor som förut utan 'customer'. Inga rader, kolumner, rättigheter eller andra policyer
-- ändras och inget raderas. Idempotent (drop policy if exists före varje create policy) – tål att köras igen i SQL Editor. SQL
-- Editor kör filen som en transaktion: policyn byts i samma steg som den tas bort, så det finns aldrig ett ögonblick utan policy
-- (och utan policy nekar RLS ändå allt). Med psql alltid -1.
--
-- Lås: drop och create policy tar ett starkt lås (AccessExclusiveLock) på public.activities och public.attendance (heta tabeller –
-- närvaron registreras hela dagen) tills filen är klar. Väntar en sats längre än 5 sekunder på ett lås avbryts körningen (felkod
-- 55P03) i stället för att alla andra frågor köar bakom den – kör då filen igen, gärna utanför arbetstid. Inställningen gäller bara
-- den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- 1. Tillfällena
-- policy.ts activities.read: access in (full, team, billing). write: workOn(caseId) och inbjudningens källa (0035) – oförändrad.
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing}'))
);
drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing}'))
) with check (mm.work_on(case_id));

-- ---------------------------------------------------------------- 2. Närvaron
-- policy.ts attendance.read: access in (full, team, billing). write: workOn(caseId) och bara manuell närvaro (0030) – oförändrad.
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing}'))
);
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing}'))
) with check (mm.work_on(case_id) and source = 'manual');

reset lock_timeout;
reset statement_timeout;
