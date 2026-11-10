-- 0041 Intagsansvarig tar emot nya beställningar (Karims beslut 2026-11-09).
--
-- En person per avtal gör den första kartläggningen och det första samtalet. Nya beställningar ska gå direkt till den personen
-- med en notis: hen väljer tiden för första mötet och trycker Ta emot – utan samordnarens OK. Samordnarna får en notis i appen
-- när en deltagare är mottagen. Systemadministratören byter person (till exempel vid semester).
--
-- 1. contracts.intake_coach_id: avtalets intagsansvarige (profiles.id), eller null = samordnaren tar emot, som förut. Ingen
--    intagsansvarig = exakt samma beteende som före migrationen.
--      * För alla roller, också service role (triggern contracts_intake_coach_check): personen har ett medlemskap med rollen
--        coach i avtalet när kolumnen sätts eller byts. Prövas inte när kolumnen lämnas orörd eller töms.
--      * Bara systemadministratören ändrar avtalet (policyn contracts_update från 0002 – oförändrad).
--      * Tas profilen bort töms kolumnen (on delete set null) – "Läs in testdata på nytt" i testmiljön (mm.reset_test_data) tar
--        bort testpersonernas profiler.
--      * Kommunen läser aldrig kolumnen: mm.visible_contracts() (vyn contracts_public) lämnar null till kommunens roller.
--        Funktionen returnerar setof public.contracts och vyn har en fast kolumnlista, så båda byggs om här (samma fallgrop som
--        i 0025) – kolumnen ligger sist i tabellen, i funktionens lista och i vyn. Kör hela filen på en gång.
-- 2. Ta emot en beställning (triggern cases_accept_guard på public.cases, för inloggade): en beställning som väntar på svar
--    (received, acknowledged) blir bekräftad, pågående eller pausad bara av samordnaren, avtalsansvarig eller avtalets
--    intagsansvarige (mm.is_intake_coach – rollen coach och contracts.intake_coach_id = den inloggade), och avböjd bara av
--    samordnaren eller avtalsansvarig. Före 0041 släppte databasen igenom vilken coach som helst med åtkomst till ärendet –
--    bara appens rollkontroll stoppade. Övriga ändringar av ärendet prövas som förut (cases_update, cases_area_guard,
--    cases_start_date_guard, cases_start_date_no_show_guard). Servern (service role) rörs inte.
--    Det intagsansvarige skriver i övrigt med de rättigheter coachen redan har (0003, 0006, 0029): ärendets team, statushistoriken
--    och orderbekräftelsen. Avropsinkorgens mejl (inbound_emails) läser och ändrar coachen aldrig – bokföringen av mejlet gör
--    servern. Notiserna (user_notifications) skriver bara servern, som förut.
--
-- Speglas i src/data/policy.ts (contracts.guard och contracts.project, caseAcceptGuard i caseWrite), src/data/schema.ts
-- (Contract.intakeCoachId) och scripts/db/columns.ts, och prövas i src/data/supabase/rls-parity.test.ts.
-- Inga destruktiva satser och inga befintliga rader ändras. Befintliga objekt som ersätts: funktionen mm.visible_contracts() och
-- vyn public.contracts_public (samma rader och kolumner som förut plus den nya kolumnen sist). Befintliga tabeller som får något
-- nytt: public.contracts (kolumnen, ett index och triggern contracts_intake_coach_check) och public.cases (triggern
-- cases_accept_guard, before update of status – ändrar inga rader). Idempotent (if not exists, or replace, drop … if exists) –
-- tål att köras igen i SQL Editor.
--
-- Lås: den nya kolumnen och de nya triggrarna tar starka lås på public.contracts och public.cases (het tabell) en kort stund,
-- och den främmande nyckeln ett kort lås på public.profiles.
-- Väntar en sats längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i stället för att alla andra frågor köar bakom
-- den – kör då filen igen, gärna utanför arbetstid. Inställningen gäller bara den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- 1. Avtalets intagsansvarige
-- Nullbar utan standardvärde: tabellen skrivs inte om och inga rader ändras. Främmande nyckeln skapas med kolumnen (alla rader
-- är null – inget att kontrollera).
alter table public.contracts
  add column if not exists intake_coach_id text references public.profiles (id) on delete set null;
create index if not exists contracts_intake_coach_id_idx on public.contracts (intake_coach_id);

-- policy.ts contracts.guard (gäller alla, också service role): intagsansvarig har rollen coach i avtalet. Security definer:
-- medlemskapen läses oavsett vem som ändrar avtalet.
create or replace function mm.check_contract_intake_coach() returns trigger
language plpgsql security definer set search_path = public, mm
as $$
begin
  if new.intake_coach_id is null or (tg_op = 'UPDATE' and new.intake_coach_id is not distinct from old.intake_coach_id) then
    return new;
  end if;
  if not exists (
    select 1 from public.memberships m where m.user_id = new.intake_coach_id and m.contract_id = new.id and m.role = 'coach'
  ) then
    raise exception 'Intagsansvarig ska ha rollen coach i avtalet' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function mm.check_contract_intake_coach() from public, anon;
drop trigger if exists contracts_intake_coach_check on public.contracts;
create trigger contracts_intake_coach_check before insert or update of intake_coach_id on public.contracts
for each row execute function mm.check_contract_intake_coach();

-- Avtal för läsning (0002): samma rader som förut. Kommunen får config utan interna delar (mm.customer_safe_config) och aldrig
-- den intagsansvarige (policy.ts contracts.project). Kolumnerna i tabellens ordning – den nya sist.
create or replace function mm.visible_contracts() returns setof public.contracts
language sql stable security definer set search_path = public, mm
as $$
  -- policy.ts contracts.read: (isMB(a) || isKom(a)) && member(a, c.id)
  select c.id, c.supplier_id, c.customer_id, c.name, c.contract_number, c.dnr, c.starts_on, c.ends_on, c.case_prefix, c.data_role,
         case when mm.is_kom() then mm.customer_safe_config(c.config) else c.config end,
         c.status, c.contract_manager_id,
         case when mm.is_kom() then null else c.intake_coach_id end
  from public.contracts c
  where (mm.is_mb() or mm.is_kom()) and mm.member_in(c.id, mm.current_role(), mm.my_contract_ids())
$$;
revoke all on function mm.visible_contracts() from public, anon;
grant execute on function mm.visible_contracts() to authenticated, service_role;

-- Vyns kolumnlista bestäms när den skapas: den byggs om med den nya kolumnen sist (or replace får lägga till kolumner sist –
-- vyn tas aldrig bort, så rättigheterna ligger kvar; de sätts ändå om för en körning i en databas där de saknas).
create or replace view public.contracts_public with (security_invoker = true) as select * from mm.visible_contracts();
revoke all on public.contracts_public from anon, authenticated;
grant select on public.contracts_public to authenticated, service_role;

-- ---------------------------------------------------------------- 2. Ta emot en beställning
-- policy.ts isIntakeCoach: den inloggade agerar som coach och är avtalets intagsansvarige. Security definer: avtalet läses
-- oavsett den inloggades läsrätt (svaret är bara ja eller nej).
create or replace function mm.is_intake_coach(p_contract_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(mm.current_role() = 'coach' and exists (
    select 1 from public.contracts c where c.id = p_contract_id and c.intake_coach_id = mm.current_profile_id()
  ), false)
$$;
revoke all on function mm.is_intake_coach(text) from public, anon;
grant execute on function mm.is_intake_coach(text) to authenticated, service_role;

-- policy.ts caseAcceptGuard (i caseWrite): en beställning som väntar på svar tas emot (bekräftad – eller pågående eller pausad,
-- så att spärren inte går runt genom att hoppa över bekräftelsen) bara av samordnaren, avtalsansvarig eller avtalets
-- intagsansvarige, och avböjs bara av samordnaren eller avtalsansvarig. Coachens avslut av en beställning som aldrig togs emot
-- (closed) och ändringar som inte rör statusen prövas som förut. Servern (service role) rörs inte.
create or replace function mm.guard_case_accept() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.status in ('received', 'acknowledged') and new.status is distinct from old.status then
    if new.status in ('confirmed', 'active', 'paused')
       and coalesce(mm.current_role(), '') not in ('samordnare', 'avtalsansvarig')
       and not mm.is_intake_coach(new.contract_id) then
      raise exception 'Beställningen tas emot av samordnaren, avtalsansvarig eller avtalets intagsansvarige' using errcode = '42501';
    end if;
    if new.status = 'declined' and coalesce(mm.current_role(), '') not in ('samordnare', 'avtalsansvarig') then
      raise exception 'Beställningen avböjs av samordnaren eller avtalsansvarig' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function mm.guard_case_accept() from public, anon;
drop trigger if exists cases_accept_guard on public.cases;
create trigger cases_accept_guard before update of status on public.cases
for each row execute function mm.guard_case_accept();

reset lock_timeout;
reset statement_timeout;
