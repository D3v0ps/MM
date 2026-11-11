-- Intagsansvarig i Botkyrkaavtalet (Karims beslut 2026-11-09, SPEC §4 och §7.2).
--
-- KÖRS EN GÅNG FÖR HAND i produktionen efter Karims ja – aldrig automatiskt. Ingen migration: filen ändrar data i ett
-- befintligt avtal (vem som är avtalets intagsansvarige), inte schemat. Därefter byter systemadministratören person i appen
-- (sidan Avtal och konfiguration, fältet Intagsansvarig), till exempel vid semester – filen behöver inte köras igen.
--
-- Ordning (docs/DRIFT.md, "Intagsansvarig"):
--   1. Migration 0041 (supabase/migrations/0041_intagsansvarig.sql) är applicerad.
--   2. Koden med intagsansvarig är driftsatt (den äldre koden låter bara samordnaren ta emot – kolumnen gör då ingenting).
--   3. Den här filen, med profilens id ifyllt på raden som är märkt FYLL I HÄR nedan.
--
-- Profilens id är coachens rad i public.profiles (kolumnen id). Slå upp det i SQL Editor – skriv aldrig namnet eller id:t i
-- den här filen i repot, bara i kopian du kör:
--   select p.id, p.full_name from public.profiles p join public.memberships m on m.user_id = p.id
--     join public.contracts c on c.id = m.contract_id
--    where c.contract_number = '332026110' and m.role = 'coach' and p.active;
--
-- Vad filen gör, i en transaktion:
--   - Sätter contracts.intake_coach_id till profilen i avtalet med avtalsnummer 332026110.
--   - Vägrar (ingenting ändras) om migration 0041 saknas, om id:t inte är ifyllt, om avtalet eller profilen inte finns, om
--     profilen är spärrad eller om profilen inte har rollen coach i avtalet.
--   - Skriver en rad i revisionsloggen (contract.intake_coach_changed) – bara id:n, inga namn och inga personuppgifter.
-- Filen tål att köras igen: har avtalet redan den personen ändras ingenting och ingen ny rad skrivs i revisionsloggen.
--
-- Kontroll efteråt:
--   select id, contract_number, intake_coach_id from public.contracts where contract_number = '332026110';
--   select action, entity_id, details from public.audit_log where action = 'contract.intake_coach_changed' order by occurred_at desc limit 3;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  -- ====================================================================================================================
  -- FYLL I HÄR: byt ut ERSÄTT_MED_PROFILENS_ID mot profilens id (public.profiles.id). Ändra inget annat i filen.
  v_profile_id constant text := 'ERSÄTT_MED_PROFILENS_ID';
  -- ====================================================================================================================
  v_contract_number constant text := '332026110';
  v_contract_id text;
  v_previous text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contracts' and column_name = 'intake_coach_id'
  ) then
    raise exception 'Migration 0041 (intagsansvarig) är inte applicerad – kör den först.';
  end if;
  if v_profile_id is null or btrim(v_profile_id) = '' or v_profile_id like 'ERSÄTT%' then
    raise exception 'Fyll i profilens id på raden FYLL I HÄR överst i filen innan den körs.';
  end if;
  if (select count(*) from public.contracts where contract_number = v_contract_number) <> 1 then
    raise exception 'Hittar inte exakt ett avtal med avtalsnummer %.', v_contract_number;
  end if;
  select id, intake_coach_id into v_contract_id, v_previous from public.contracts where contract_number = v_contract_number;

  if not exists (select 1 from public.profiles p where p.id = v_profile_id) then
    raise exception 'Hittar ingen profil med det ifyllda id:t.';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_profile_id and not p.active) then
    raise exception 'Profilen är spärrad – välj en aktiv coach.';
  end if;
  if not exists (
    select 1 from public.memberships m where m.user_id = v_profile_id and m.contract_id = v_contract_id and m.role = 'coach'
  ) then
    raise exception 'Profilen har inte rollen coach i avtalet – ge personen rollen coach i appen först (Användare och roller).';
  end if;

  if v_previous is not distinct from v_profile_id then
    raise notice 'Avtalet har redan den här personen som intagsansvarig – ingenting ändras.';
    return;
  end if;

  update public.contracts set intake_coach_id = v_profile_id where id = v_contract_id;
  -- Revisionsloggen: samma händelse och samma detaljer som när systemadministratören byter person i appen – bara id:n.
  insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details)
  values ('log-intagsansvarig-' || gen_random_uuid()::text, now(), 'system', 'contract.intake_coach_changed', 'contract', v_contract_id, v_contract_id,
          jsonb_build_object('from', v_previous, 'to', v_profile_id, 'source', 'manual'));
end
$$;

commit;
