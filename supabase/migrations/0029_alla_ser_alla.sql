-- 0029 Alla på Miljonbemanning ser och arbetar i alla ärenden i avtalet (beslut 2026-10-09, Karim).
--
-- "Alla på Miljonbemanning ska kunna se varandras deltagare och göra saker i varandras ärenden – men kommunen ser bara
-- sina egna. Vi ska fortfarande kunna tilldela deltagare, så att den som är tilldelad får notiser, mejl och påminnelser."
--
-- Ändringen: mm.case_access_level (0003, search_path satt i 0011) ger coach och handledare nivån 'full' för alla ärenden
-- i avtal de är medlemmar i – som samordnaren – i stället för 'team' bara i teamets ärenden. Allt annat är oförändrat:
--   * Huvudcoachen har 'full' även i ett skyddat ärende (som förut).
--   * Den vilande spärren för skyddade personuppgifter (persons.protected_identity, alltid false sedan 2026-10-07) ligger
--     kvar: en annan coach eller en handledare får 'restricted' (bara ärendenummer och status) som samordnaren.
--   * Ekonom ('billing'), kommunens handläggare ('customer', bara egna beställningar), avtalsansvarig, samordnare, chef
--     och admin ändras inte. Grenen för den borttagna rollen kommun_chef behålls (0026) – den är onåbar.
--   * Signaturen är densamma: l_in_team tas fortfarande emot (teamet slås upp av mm.case_access_of och mm.my_case_access)
--     men används inte längre i beräkningen, så policyerna och funktionerna som anropar den behöver inte ändras.
-- Skrivreglerna följer med automatiskt: mm.work_on (närvaro, avstämningar, bedömningar, händelser, anteckningar,
-- meddelanden …) kräver 'full' eller 'team', mm.case_write_check ger coachen skrivrätt vid 'full'. Byte av huvudcoach
-- och Ändra team är fortfarande samordnare/avtalsansvarig (rollkontroll i hanterarna). Tilldelningen (case_team) finns
-- kvar och styr notiser, påminnelser, Mina ärenden och handledarens Mina tilldelade ärenden.
-- Speglas i src/core/access.ts (caseAccess) och prövas i src/data/supabase/rls-parity.test.ts.
-- Idempotent (create or replace), inga destruktiva satser – kan köras i SQL Editor.

create or replace function mm.case_access_level(
  p_role text, p_profile_id text, p_contract_ids text[], p_unit text,
  c_contract_id text, c_lead_coach_id text, c_referrer_id text,
  l_protected boolean, l_in_team boolean, l_referrer_unit text, l_scope text
) returns text
language sql immutable set search_path = public, mm
as $$
  select case
    when c_contract_id is null then 'none'
    when p_role is distinct from 'admin' and not coalesce(c_contract_id = any (p_contract_ids), false) then 'none'
    when p_role = 'avtalsansvarig' then 'full'
    when p_role in ('samordnare', 'chef', 'admin') then case when l_protected then 'restricted' else 'full' end
    -- Beslut 2026-10-09: coach och handledare ser alla ärenden i avtalet. Huvudcoachen ser även skyddade; övriga bara ärendet.
    when p_role = 'coach' then case
      when c_lead_coach_id = p_profile_id then 'full'
      when l_protected then 'restricted'
      else 'full' end
    when p_role = 'handledare' then case when l_protected then 'restricted' else 'full' end
    when p_role = 'ekonom' then 'billing'
    when p_role = 'kommun_handlaggare' then case
      -- Handläggaren som beställde ser alltid sitt ärende (även skyddade – hon lämnade uppgifterna).
      when nullif(c_referrer_id, '') is not null and c_referrer_id = p_profile_id then 'customer'
      when l_protected then 'none'
      when coalesce(l_scope, 'own') = 'all' then 'customer'
      when l_scope = 'unit' and nullif(p_unit, '') is not null and l_referrer_unit = p_unit then 'customer'
      else 'none' end
    when p_role = 'kommun_chef' then case
      when not mm.unit_covers(p_unit, l_referrer_unit) then 'none'
      when l_protected then 'restricted'
      else 'customer' end
    else 'none'
  end
$$;
