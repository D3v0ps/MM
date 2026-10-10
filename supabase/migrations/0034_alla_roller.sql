-- 0034 Alla roller samtidigt, utan rollbyte (Karims beslut 7, coachmötet 2026-10-09).
--
-- "Den som har flera roller ska ha alla sina behörigheter samtidigt utan att byta roll. Belopp i kronor syns bara för den som
-- har rollen ekonom (då alltid). Ingen får fler rättigheter än summan av sina roller."
--
-- Före: varje policy och funktion läste EN roll – mm.current_role() (0002/0027: testpersonens roll, den valda rollen i
-- role_choices eller medlemskapet med lägst id). 111 policyer läste den direkt (364 ställen) och 13 funktioner
-- (case_access_of, case_write_check, current_actor, current_unit, is_kom, is_mb, my_case_access, my_contract_ids,
-- person_write, protect_message_columns, protect_person_admin_columns, role_in, visible_contracts). Ytterligare policyer
-- byggde på dem (is_mb, role_in, case_ids, case_access, work_on …) – 169 av 191 policyer berodde på rollen.
--
-- Efter: unionen. En rad syns eller får skrivas om NÅGON av aktörens roller ger rätt – precis summan av rollerna:
--   * Rollerna gäller per avtal (memberships är unik per användare, avtal och roll). En roll ger bara rätt i de avtal där
--     personen har just den rollen – den som är coach i ett avtal och ekonom i ett annat är inte ekonom i det första.
--     mm.contracts_as(roller) = avtalen där aktören har någon av rollerna ('*' = alla avtal, rollen admin).
--   * Åtkomsten per ärende räknas per roll (mm.my_case_role_access: en rad per ärende och roll, samma regler som förut i
--     mm.case_access_level). Policyerna frågar "har någon av rollerna R nivån L?" (mm.case_ids_as, mm.case_access_as).
--     Den samlade nivån (mm.case_access, mm.my_case_access, mm.case_access_of) är den högsta över rollerna i ordningen
--     full > team > customer > billing > restricted > none (mm.access_rank).
--   * Anteckningar (mm.notes_case_ids): full eller team genom en roll som inte är ekonom. Den som är coach och ekonom ser
--     anteckningarna genom coachrollen; den som bara är ekonom ser dem aldrig.
--   * Belopp i kronor: raderna har samma läsare som förut (nu per roll), men beloppskolumnerna lämnas bara till den som har
--     rollen ekonom (mm.has_role('ekonom')) – via vyerna <tabell>_public, och direkt i tabellerna får inloggade inte läsa
--     beloppen alls (sista avsnittet nedan). Servern tar dessutom bort beloppen i svaren som förut (hidesMoney,
--     src/api/tester-access.ts) – nu "har rollen ekonom" i stället för "har valt rollen ekonom".
--   * Den vilande spärren för skyddade personuppgifter (persons.protected_identity, alltid false) gäller per roll som förut.
--   * Testarens testperson (tester_sessions, bara testmiljön): testpersonens alla roller.
--
-- Nya funktioner: mm.current_roles(), mm.has_role(text), mm.contracts_as(text[]), mm.in_contracts(text, text[]),
-- mm.member_as(text, text[]), mm.customer_ids_as(text[]), mm.access_rank(text), mm.my_case_role_access(),
-- mm.case_role_access_of(…), mm.case_ids_as(text[], text[]), mm.notes_case_ids(), mm.case_access_as(text, text[]),
-- mm.invoice_draft_ids_as(text[]), mm.person_write_as(text, text[]) och en beloppsfunktion per beloppskolumn
-- (mm.price_item_price_ore(text) …). Nya vyer: price_items_public, invoice_drafts_public, invoice_lines_public,
-- bonus_claims_public, contract_deviations_public, ai_runs_public.
-- Omskrivna (samma signatur, create or replace): mm.role_in, mm.is_mb, mm.is_kom, mm.my_contract_ids, mm.current_unit,
-- mm.my_case_access, mm.case_ids, mm.case_access_of, mm.case_access, mm.work_on, mm.case_write_check, mm.person_write,
-- mm.visible_person_ids, mm.customer_employer_ids, mm.customer_voice_note_case_ids, mm.visible_contracts,
-- mm.protect_message_columns, mm.protect_report_columns, mm.protect_person_admin_columns, public.current_actor.
-- Policyerna skrivs om med alter policy (using/with check) – inga drop policy. Ingen policy och ingen funktion läser längre
-- mm.current_role(). Den ligger kvar som kompatibilitetsfunktion: public.current_actor() svarar fortfarande med 'role' (den
-- tidigare valda rollen) bredvid 'roles', så att en server med den gamla koden fungerar tills den nya är driftsatt (DRIFT.md:
-- migrationen före koden). role_choices (0027) ligger kvar oanvänd.
--
-- Samma regler i src/data/policy.ts (varje regel prövas per roll och unionen tas, roleActors i src/api/roles.ts) och
-- src/core/access.ts (caseAccess = högsta nivån över rollerna). Pariteten prövas i src/data/supabase/rls-parity.test.ts – också
-- för testpersoner med flera roller (coach och ekonom, samordnare och coach, admin och avtalsansvarig, roller i olika avtal).
-- Idempotent (create or replace, alter policy, revoke/grant), inga drop och inga ändrade data – kan köras i SQL Editor.

-- ================================================================ Rollerna
-- Aktörens roller: testpersonens alla roller (testaren i testmiljön, tester_sessions – deltagaren har bara 'deltagare'),
-- annars den inloggades alla roller (memberships). Sorterade, utan dubbletter. Tom = ingen roll.
create or replace function mm.current_roles() returns text[]
language sql stable security definer set search_path = public, mm
as $$
  select case
    when exists (select 1 from mm.tester_session()) then (
      select coalesce(array_agg(distinct x.role order by x.role), '{}')
      from (
        select s.role from mm.tester_session() s where s.profile_id = 'deltagare'
        union
        select m.role from mm.tester_session() s join public.memberships m on m.user_id = s.profile_id
      ) x)
    else (
      select coalesce(array_agg(distinct m.role order by m.role), '{}')
      from public.memberships m where m.user_id = mm.auth_profile_id())
  end
$$;

create or replace function mm.has_role(p_role text) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce(p_role = any (mm.current_roles()), false) $$;

-- policy.ts: has(roles, a) – någon av rollerna.
create or replace function mm.role_in(roles text[]) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce(mm.current_roles() && roles, false) $$;
-- policy.ts: isMB / isKom – någon av rollerna är Miljonbemannings respektive kommunens.
create or replace function mm.is_mb() returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce(mm.current_roles() && mm.supplier_roles(), false) $$;
create or replace function mm.is_kom() returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce(mm.current_roles() && mm.customer_roles(), false) $$;

-- ================================================================ Avtalen per roll
-- Avtalen där aktören har någon av rollerna (medlemskapen med rollen). '*' = alla avtal: rollen admin (policy.ts member).
-- Anropas som (select mm.contracts_as('{…}')) så att mängden räknas en gång per fråga.
create or replace function mm.contracts_as(p_roles text[]) returns text[]
language sql stable security definer set search_path = public, mm
as $$
  select (case when 'admin' = any (p_roles) and mm.has_role('admin') then array['*'] else '{}'::text[] end)
      || coalesce((
           select array_agg(distinct m.contract_id order by m.contract_id)
           from public.memberships m
           where m.user_id = mm.current_profile_id() and m.role = any (p_roles) and m.role = any (mm.current_roles())), '{}')
$$;

-- policy.ts member(a, contractId) för en mängd från mm.contracts_as: '*' = alla avtal (också utan avtal, som förut för admin).
create or replace function mm.in_contracts(p_contract_id text, p_contract_ids text[]) returns boolean
language sql immutable set search_path = public, mm
as $$ select coalesce('*' = any (p_contract_ids) or (nullif(p_contract_id, '') is not null and p_contract_id = any (p_contract_ids)), false) $$;

-- Har aktören någon av rollerna i avtalet? (För policyer där rollerna står i raden, t.ex. flaggornas mottagare.)
create or replace function mm.member_as(p_contract_id text, p_roles text[]) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select mm.in_contracts(p_contract_id, mm.contracts_as(p_roles)) $$;

-- Aktörens avtal (Actor.contractIds): alla avtal där aktören har någon roll.
create or replace function mm.my_contract_ids() returns text[]
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(array_agg(distinct m.contract_id order by m.contract_id), '{}')
  from public.memberships m
  where m.user_id = mm.current_profile_id() and m.role = any (mm.current_roles())
$$;

-- policy.ts customersOf(a) för vissa roller: kunderna i avtalen där aktören har någon av rollerna ('*' räknas inte – admin
-- har en egen regel i policyerna).
create or replace function mm.customer_ids_as(p_roles text[]) returns text[]
language sql stable security definer set search_path = public, mm
as $$ select coalesce(array_agg(distinct c.customer_id), '{}') from public.contracts c where c.id = any (mm.contracts_as(p_roles)) $$;

-- Aktörens enhet (Actor.customerUnit, synligheten "unit"): enheten i kommunens medlemskap (lägst id). Bara kommunens roller
-- använder den; Miljonbemannings roller har ingen enhet.
create or replace function mm.current_unit() returns text
language sql stable security definer set search_path = public, mm
as $$
  select m.customer_unit from public.memberships m
  where m.user_id = mm.current_profile_id() and m.role = any (mm.customer_roles()) and m.role = any (mm.current_roles())
  order by m.id limit 1
$$;

-- ================================================================ Åtkomsten per ärende och roll
-- Ordningen för "högsta nivån" (src/core/access.ts ACCESS_RANK).
create or replace function mm.access_rank(p_access text) returns integer
language sql immutable set search_path = public, mm
as $$
  select case p_access when 'full' then 5 when 'team' then 4 when 'customer' then 3 when 'billing' then 2 when 'restricted' then 1 else 0 end
$$;

-- Åtkomsten till alla ärenden, en rad per ärende och roll (mm.case_access_level per roll, med rollens avtal).
create or replace function mm.my_case_role_access() returns table (case_id text, role text, access text)
language sql stable security definer set search_path = public, mm
as $$
  with me as materialized (
    select mm.current_profile_id() as uid, mm.current_unit() as unit
  ), g as materialized (
    select r.role,
           coalesce((select array_agg(distinct m.contract_id) from public.memberships m, me where m.user_id = me.uid and m.role = r.role), '{}') as cids
    from unnest(mm.current_roles()) as r (role)
  )
  select c.id, g.role,
         mm.case_access_level(
           g.role, me.uid, g.cids, me.unit,
           c.contract_id, c.lead_coach_id, c.referrer_id,
           coalesce(p.protected_identity, false),
           t.in_team,
           coalesce(case when nullif(c.referrer_id, '') is not null then r.customer_unit end, c.referrer_unit),
           mm.customer_scope(k.config))
  from me
  cross join public.cases c
  cross join lateral (select exists (select 1 from public.case_team t where t.case_id = c.id and t.user_id = me.uid) as in_team) t
  left join public.persons p on p.id = c.person_id
  left join public.profiles r on r.id = c.referrer_id
  left join public.contracts k on k.id = c.contract_id
  cross join g
$$;

-- Åtkomst per roll för ett ärende med de här fälten (även en ny rad som inte sparats än – policy.ts accessOfCase).
create or replace function mm.case_role_access_of(
  p_case_id text, p_contract_id text, p_person_id text, p_lead_coach_id text, p_referrer_id text, p_referrer_unit text
) returns table (role text, access text)
language sql stable security definer set search_path = public, mm
as $$
  with me as materialized (
    select mm.current_profile_id() as uid, mm.current_unit() as unit
  ), l as materialized (
    select coalesce((select p.protected_identity from public.persons p where p.id = p_person_id), false) as prot,
           exists (select 1 from public.case_team t, me where t.case_id = p_case_id and t.user_id = me.uid) as in_team,
           coalesce(case when nullif(p_referrer_id, '') is not null then (select r.customer_unit from public.profiles r where r.id = p_referrer_id) end, p_referrer_unit) as runit,
           mm.customer_scope((select k.config from public.contracts k where k.id = p_contract_id)) as scope
  )
  select g.role,
         mm.case_access_level(
           g.role, me.uid,
           coalesce((select array_agg(distinct m.contract_id) from public.memberships m where m.user_id = me.uid and m.role = g.role), '{}'),
           me.unit, p_contract_id, p_lead_coach_id, p_referrer_id, l.prot, l.in_team, l.runit, l.scope)
  from me, l, unnest(mm.current_roles()) as g (role)
$$;

-- Den högsta nivån över rollerna för en rad (caseAccess i src/core/access.ts).
create or replace function mm.case_access_of(
  p_case_id text, p_contract_id text, p_person_id text, p_lead_coach_id text, p_referrer_id text, p_referrer_unit text
) returns text
language sql stable security definer set search_path = public, mm
as $$
  select coalesce((
    select a.access from mm.case_role_access_of(p_case_id, p_contract_id, p_person_id, p_lead_coach_id, p_referrer_id, p_referrer_unit) a
    order by mm.access_rank(a.access) desc limit 1), 'none')
$$;

-- Den högsta nivån bland de angivna rollerna (de roller aktören har) för ärendet med id:t. 'none' om det inte finns.
create or replace function mm.case_access_as(p_case_id text, p_roles text[]) returns text
language sql stable security definer set search_path = public, mm
as $$
  select coalesce((
    select a.access
    from public.cases c
    cross join lateral mm.case_role_access_of(c.id, c.contract_id, c.person_id, c.lead_coach_id, c.referrer_id, c.referrer_unit) a
    where c.id = p_case_id and a.role = any (p_roles)
    order by mm.access_rank(a.access) desc limit 1), 'none')
$$;

-- mm.case_access(case_id): den högsta nivån över alla roller.
create or replace function mm.case_access(p_case_id text) returns text
language sql stable security definer set search_path = public, mm
as $$ select mm.case_access_as(p_case_id, mm.all_roles()) $$;

-- Åtkomst till alla ärenden, en rad per ärende: den högsta nivån över rollerna (vyn cases_public, mm.visible_cases).
create or replace function mm.my_case_access() returns table (case_id text, access text)
language sql stable security definer set search_path = public, mm
as $$
  select a.case_id, (array_agg(a.access order by mm.access_rank(a.access) desc))[1]
  from mm.my_case_role_access() a
  group by a.case_id
$$;

-- Ärenden där någon av rollerna har någon av nivåerna. Policyerna använder (select mm.case_ids(...)).
create or replace function mm.case_ids(levels text[]) returns setof text
language sql stable security definer set search_path = public, mm
as $$ select distinct a.case_id from mm.my_case_role_access() a where a.access = any (levels) $$;

-- Ärenden där någon av de angivna rollerna har någon av nivåerna.
create or replace function mm.case_ids_as(levels text[], p_roles text[]) returns setof text
language sql stable security definer set search_path = public, mm
as $$ select distinct a.case_id from mm.my_case_role_access() a where a.access = any (levels) and a.role = any (p_roles) $$;

-- policy.ts notesRead / canSeeNotes(access, role): anteckningar och bedömningar – full eller team genom en roll som inte är ekonom.
create or replace function mm.notes_case_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$ select distinct a.case_id from mm.my_case_role_access() a where a.access in ('full', 'team') and a.role <> 'ekonom' $$;

-- policy.ts workOn(caseId): en av rollerna i CASE_WORKERS har full- eller teamåtkomst.
create or replace function mm.work_on(p_case_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select mm.case_access_as(p_case_id, array['samordnare', 'avtalsansvarig', 'coach', 'handledare']) in ('full', 'team') $$;

-- policy.ts caseWrite(c): någon av rollerna får ändra ärendet. p_exists = raden finns redan (ändring, inte ny rad).
create or replace function mm.case_write_check(
  p_case_id text, p_contract_id text, p_person_id text, p_lead_coach_id text, p_referrer_id text, p_referrer_unit text, p_exists boolean
) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(bool_or(case a.role
    when 'samordnare' then a.access = 'full'
    when 'avtalsansvarig' then a.access = 'full'
    when 'coach' then a.access = 'full' and p_exists -- coachen skapar inga ärenden
    when 'ekonom' then a.access = 'billing' and p_exists -- beställarreferens
    when 'kommun_handlaggare' then a.access = 'customer' and nullif(p_referrer_id, '') is not null and p_referrer_id = mm.current_profile_id()
    else false
  end), false)
  from mm.case_role_access_of(p_case_id, p_contract_id, p_person_id, p_lead_coach_id, p_referrer_id, p_referrer_unit) a
$$;

-- policy.ts persons.read: personen syns via ett ärende där någon av rollerna får se personuppgifter.
create or replace function mm.visible_person_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$
  select distinct c.person_id from public.cases c
  join mm.my_case_role_access() a on a.case_id = c.id
  where mm.can_see_person(a.access)
$$;

-- policy.ts persons.write för vissa roller (en befintlig person): full åtkomst med CASE_EDITORS eller admin (admin bara
-- kontaktuppgifterna – triggern persons_admin_contact_only), eller beställande handläggare.
create or replace function mm.person_write_as(p_person_id text, p_roles text[]) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select exists (
    select 1 from public.cases c
    cross join lateral mm.case_role_access_of(c.id, c.contract_id, c.person_id, c.lead_coach_id, c.referrer_id, c.referrer_unit) a
    where c.person_id = p_person_id and a.role = any (p_roles)
      and ((a.access = 'full' and a.role in ('samordnare', 'avtalsansvarig', 'coach', 'admin'))
        or (a.access = 'customer' and a.role = 'kommun_handlaggare'
            and nullif(c.referrer_id, '') is not null and c.referrer_id = mm.current_profile_id())))
$$;

-- policy.ts persons.write: ny person (inga ärenden än) – ORDER_CREATORS; annars någon av rollerna enligt mm.person_write_as.
create or replace function mm.person_write(p_person_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select case
    when not exists (select 1 from public.cases c where c.person_id = p_person_id)
      then mm.role_in(array['samordnare', 'avtalsansvarig', 'kommun_handlaggare'])
    else mm.person_write_as(p_person_id, mm.all_roles())
  end
$$;

-- Kommunens arbetsgivare och röstmeddelanden: ärenden där kommunens roll har åtkomsten 'customer'.
create or replace function mm.customer_employer_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$
  select distinct p.employer_id from public.placements p
  where p.case_id in (select a.case_id from mm.my_case_role_access() a where a.access = 'customer')
$$;
create or replace function mm.customer_voice_note_case_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$
  select distinct a.case_id from mm.my_case_role_access() a
  join public.cases c on c.id = a.case_id
  join public.contracts k on k.id = c.contract_id
  where a.access = 'customer' and k.config #> '{customerVisibility,seesParticipantVoiceNotes}' = 'true'::jsonb
$$;

-- Fakturor i avtalen där aktören har någon av rollerna ('*' = alla).
create or replace function mm.invoice_draft_ids_as(p_roles text[]) returns setof text
language sql stable security definer set search_path = public, mm
as $$
  with k as materialized (select mm.contracts_as(p_roles) as ids)
  select d.id from public.invoice_drafts d, k where mm.in_contracts(d.contract_id, k.ids)
$$;

-- Avtal för läsning (vyn contracts_public): Miljonbemannings och kommunens roller i sina avtal. Hela konfigurationen bara
-- när aktören har en av Miljonbemannings roller i avtalet – annars utan interna delar (mm.customer_safe_config).
create or replace function mm.visible_contracts() returns setof public.contracts
language sql stable security definer set search_path = public, mm
as $$
  with k as materialized (
    select mm.contracts_as(mm.supplier_roles()) as mb, mm.contracts_as(mm.supplier_roles() || mm.customer_roles()) as any_role
  )
  select c.id, c.supplier_id, c.customer_id, c.name, c.contract_number, c.dnr, c.starts_on, c.ends_on, c.case_prefix, c.data_role,
         case when mm.in_contracts(c.id, k.mb) then c.config else mm.customer_safe_config(c.config) end,
         c.status, c.contract_manager_id
  from public.contracts c, k
  where mm.in_contracts(c.id, k.any_role)
$$;

grant execute on function
  mm.current_roles(), mm.has_role(text), mm.contracts_as(text[]), mm.in_contracts(text, text[]), mm.member_as(text, text[]),
  mm.customer_ids_as(text[]), mm.access_rank(text), mm.my_case_role_access(),
  mm.case_role_access_of(text, text, text, text, text, text), mm.case_access_as(text, text[]), mm.case_ids_as(text[], text[]),
  mm.notes_case_ids(), mm.person_write_as(text, text[]), mm.invoice_draft_ids_as(text[])
to authenticated, service_role;
revoke all on function
  mm.current_roles(), mm.has_role(text), mm.contracts_as(text[]), mm.member_as(text, text[]), mm.customer_ids_as(text[]),
  mm.my_case_role_access(), mm.case_role_access_of(text, text, text, text, text, text), mm.case_access_as(text, text[]),
  mm.case_ids_as(text[], text[]), mm.notes_case_ids(), mm.person_write_as(text, text[]), mm.invoice_draft_ids_as(text[])
from public, anon;

-- ================================================================ Aktören för servern
-- roles: alla roller. roleContracts: avtalen per roll ({"coach": ["c-bot"], …}). role: den tidigare valda rollen
-- (mm.current_role, 0027) – bara för en server med koden från före 0034; den nya koden läser roles.
create or replace function public.current_actor() returns jsonb
language sql stable security definer set search_path = public, mm
as $$
  select jsonb_build_object(
    'authProfileId', mm.auth_profile_id(),
    'isTester', mm.auth_is_tester(),
    'environment', mm.environment(),
    'impersonating', exists (select 1 from mm.tester_session()),
    'userId', mm.current_profile_id(),
    'role', mm.current_role(),
    'roles', to_jsonb(mm.current_roles()),
    'roleContracts', coalesce((
      select jsonb_object_agg(g.role, to_jsonb(coalesce((
        select array_agg(distinct m.contract_id order by m.contract_id) from public.memberships m
        where m.user_id = mm.current_profile_id() and m.role = g.role), '{}'::text[])))
      from unnest(mm.current_roles()) as g (role)), '{}'::jsonb),
    'contractIds', to_jsonb(mm.my_contract_ids()),
    'customerUnit', mm.current_unit()
  )
$$;

-- ================================================================ Triggrar
-- Läskvittot (0014): kommunens chef (borttagen roll, 0026 – kan inte finnas) ändrade inga meddelanden.
create or replace function mm.protect_message_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if mm.current_roles() = array['kommun_chef'] then
      raise exception 'Kommunens chef ändrar inga meddelanden' using errcode = '42501';
    end if;
    if (to_jsonb(new) - array['read_by', 'read_at']) is distinct from (to_jsonb(old) - array['read_by', 'read_at']) then
      raise exception 'Bara läskvittot får ändras' using errcode = '42501';
    end if;
    if new.read_by is distinct from old.read_by and (
      not (old.read_by <@ new.read_by)
      or exists (select 1 from unnest(new.read_by) as r (id) where r.id <> all (old.read_by) and r.id is distinct from mm.current_profile_id())
    ) then
      raise exception 'Bara läskvittot får ändras' using errcode = '42501';
    end if;
    if new.read_at is distinct from old.read_at and (old.read_at is not null or new.read_at is null) then
      raise exception 'Bara läskvittot får ändras' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

-- Kommunens kvittens (0014): bara för den som bara har kommunens roller – en av Miljonbemannings roller skriver som förut.
create or replace function mm.protect_report_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') and mm.is_kom() and not mm.is_mb() then
    if (to_jsonb(new) - array['opened_at', 'opened_by']) is distinct from (to_jsonb(old) - array['opened_at', 'opened_by']) then
      raise exception 'Kommunen får bara kvittera rapporten' using errcode = '42501';
    end if;
    if (new.opened_at is distinct from old.opened_at or new.opened_by is distinct from old.opened_by)
       and (old.opened_at is not null or new.opened_at is null or new.opened_by is distinct from mm.current_profile_id()) then
      raise exception 'Kommunen får bara kvittera rapporten' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

-- Systemadministratören ändrar bara deltagarens kontaktuppgifter (0032) – när ingen annan av rollerna får ändra personen.
create or replace function mm.protect_person_admin_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if not mm.has_role('admin') or mm.person_write_as(old.id, array['samordnare', 'avtalsansvarig', 'coach', 'kommun_handlaggare']) then
    return new;
  end if;
  if (to_jsonb(new) - array['preferred_contact', 'phone', 'email', 'address'])
     is distinct from (to_jsonb(old) - array['preferred_contact', 'phone', 'email', 'address']) then
    raise exception 'Systemadministratören ändrar bara deltagarens kontaktuppgifter' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ================================================================ Policyer
-- Rollgrupperna (src/data/policy.ts):
--   CASE_WORKERS    {samordnare,avtalsansvarig,coach,handledare}
--   CASE_EDITORS    {samordnare,avtalsansvarig,coach}
--   OVERSIGHT       {samordnare,avtalsansvarig,chef,admin}
--   BILLING_READERS {ekonom,chef,avtalsansvarig,admin}
--   GROUP_READERS   {samordnare,avtalsansvarig,coach,handledare,chef,admin} (gruppaktiviteter, gruppmål, grupperingar)
--   REPORT_BUILDERS {samordnare,avtalsansvarig,chef}
--   MB utom ekonom  {admin,avtalsansvarig,samordnare,coach,handledare,chef}

-- ---------------------------------------------------------------- Admin (0002, 0008, 0009)
alter policy holidays_insert on public.holidays with check ((select mm.has_role('admin')));
alter policy holidays_update on public.holidays using (true) with check ((select mm.has_role('admin')));
alter policy integrations_select on public.integrations using ((select mm.has_role('admin')));
alter policy integrations_insert on public.integrations with check ((select mm.has_role('admin')));
alter policy integrations_update on public.integrations using ((select mm.has_role('admin'))) with check ((select mm.has_role('admin')));
alter policy jobs_select on public.jobs using ((select mm.has_role('admin')));
alter policy jobs_insert on public.jobs with check ((select mm.has_role('admin')));
alter policy jobs_update on public.jobs using ((select mm.has_role('admin'))) with check ((select mm.has_role('admin')));
alter policy org_settings_insert on public.org_settings with check ((select mm.has_role('admin')));
alter policy org_settings_update on public.org_settings using ((select mm.is_mb())) with check ((select mm.has_role('admin')));
alter policy template_versions_insert on public.template_versions with check ((select mm.has_role('admin')));
alter policy template_versions_update on public.template_versions using ((select mm.role_in('{admin,samordnare}'))) with check ((select mm.has_role('admin')));

-- ---------------------------------------------------------------- Organisationer, avtal, prislista (0002)
alter policy organizations_select on public.organizations using (
  (select mm.has_role('admin'))
  or (((select mm.is_mb()) or (select mm.is_kom())) and id = any ((select mm.my_org_ids())::text[]))
);
alter policy organizations_insert on public.organizations with check ((select mm.has_role('admin')));
alter policy organizations_update on public.organizations using (
  (select mm.has_role('admin'))
  or (((select mm.is_mb()) or (select mm.is_kom())) and id = any ((select mm.my_org_ids())::text[]))
) with check ((select mm.has_role('admin')));

alter policy contracts_select on public.contracts using (mm.in_contracts(id, (select mm.contracts_as(mm.supplier_roles()))));
alter policy contracts_insert on public.contracts with check ((select mm.has_role('admin')));
alter policy contracts_update on public.contracts using (mm.in_contracts(id, (select mm.contracts_as(mm.supplier_roles()))))
  with check ((select mm.has_role('admin')));

alter policy contract_areas_select on public.contract_areas using (
  mm.in_contracts(contract_id, (select mm.contracts_as(mm.supplier_roles() || mm.customer_roles())))
);
alter policy contract_areas_insert on public.contract_areas with check ((select mm.has_role('admin')));
alter policy contract_areas_update on public.contract_areas using (
  mm.in_contracts(contract_id, (select mm.contracts_as(mm.supplier_roles() || mm.customer_roles())))
) with check ((select mm.has_role('admin')));

-- Prislistan: bara Miljonbemanning (0026).
alter policy price_items_select on public.price_items using (mm.in_contracts(contract_id, (select mm.contracts_as(mm.supplier_roles()))));
alter policy price_items_insert on public.price_items with check ((select mm.has_role('admin')));
alter policy price_items_update on public.price_items using (mm.in_contracts(contract_id, (select mm.contracts_as(mm.supplier_roles()))))
  with check ((select mm.has_role('admin')));

-- ---------------------------------------------------------------- Profiler och medlemskap (0002, 0027)
alter policy profiles_select on public.profiles using (
  id = (select mm.current_profile_id())
  or (select mm.has_role('admin'))
  or (((select mm.is_mb()) or (select mm.is_kom())) and organization_id = any ((select mm.my_org_ids())::text[]))
);
alter policy profiles_insert on public.profiles with check (
  (select mm.has_role('admin'))
  or organization_id = any ((select mm.customer_ids_as('{avtalsansvarig}'))::text[])
);
alter policy profiles_update on public.profiles using (
  id = (select mm.current_profile_id())
  or (select mm.has_role('admin'))
  or (((select mm.is_mb()) or (select mm.is_kom())) and organization_id = any ((select mm.my_org_ids())::text[]))
) with check (
  (select mm.has_role('admin'))
  or organization_id = any ((select mm.customer_ids_as('{avtalsansvarig}'))::text[])
  or id = (select mm.current_profile_id())
);

alter policy memberships_select on public.memberships using (
  user_id = (select mm.current_profile_id())
  or mm.in_contracts(contract_id, (select mm.contracts_as(mm.supplier_roles() || mm.customer_roles())))
);
alter policy memberships_insert on public.memberships with check (
  (select mm.has_role('admin'))
  or (mm.in_contracts(contract_id, (select mm.contracts_as('{avtalsansvarig}'))) and role = any (mm.customer_roles()))
);
alter policy memberships_update on public.memberships using (
  user_id = (select mm.current_profile_id())
  or mm.in_contracts(contract_id, (select mm.contracts_as(mm.supplier_roles() || mm.customer_roles())))
) with check (
  (select mm.has_role('admin'))
  or (mm.in_contracts(contract_id, (select mm.contracts_as('{avtalsansvarig}'))) and role = any (mm.customer_roles()))
);
alter policy memberships_delete on public.memberships using (
  (select mm.has_role('admin'))
  or (mm.in_contracts(contract_id, (select mm.contracts_as('{avtalsansvarig}'))) and role = any (mm.customer_roles()))
);

-- ---------------------------------------------------------------- Beställarreferenser och löpnummer (0003)
alter policy buyer_references_select on public.buyer_references using (
  (select mm.has_role('admin'))
  or (((select mm.is_mb()) or (select mm.is_kom())) and customer_id = any ((select mm.my_customer_ids())::text[]))
);
alter policy buyer_references_insert on public.buyer_references with check (
  (select mm.has_role('admin'))
  or customer_id = any ((select mm.customer_ids_as('{avtalsansvarig,ekonom}'))::text[])
);
alter policy buyer_references_update on public.buyer_references using (
  (select mm.has_role('admin'))
  or (((select mm.is_mb()) or (select mm.is_kom())) and customer_id = any ((select mm.my_customer_ids())::text[]))
) with check (
  (select mm.has_role('admin'))
  or customer_id = any ((select mm.customer_ids_as('{avtalsansvarig,ekonom}'))::text[])
);

alter policy case_counters_select on public.case_counters using (mm.in_contracts(contract_id, (select mm.contracts_as(mm.supplier_roles()))));

-- ---------------------------------------------------------------- Teamet (0003): CASE_EDITORS med full åtkomst
alter policy case_team_insert on public.case_team with check (mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full');
alter policy case_team_update on public.case_team using (case_id in (select mm.case_ids('{full,team,customer}')))
  with check (mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full');
alter policy case_team_delete on public.case_team using (mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full');

-- ---------------------------------------------------------------- Mejlavrop (0004)
alter policy inbound_emails_select on public.inbound_emails using (
  (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
  and (nullif(case_id, '') is null or classification = 'order_protected'
       or case_id in (select mm.case_ids_as('{full,team,billing,customer}', '{samordnare,avtalsansvarig,chef,admin}')))
);
alter policy inbound_emails_insert on public.inbound_emails with check (
  (select mm.role_in('{samordnare,avtalsansvarig}'))
  and (nullif(case_id, '') is null or mm.case_access_as(case_id, '{samordnare,avtalsansvarig}') = 'full')
);
alter policy inbound_emails_update on public.inbound_emails using (
  (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
  and (nullif(case_id, '') is null or classification = 'order_protected'
       or case_id in (select mm.case_ids_as('{full,team,billing,customer}', '{samordnare,avtalsansvarig,chef,admin}')))
) with check (
  (select mm.role_in('{samordnare,avtalsansvarig}'))
  and (nullif(case_id, '') is null or mm.case_access_as(case_id, '{samordnare,avtalsansvarig}') = 'full')
);

-- ---------------------------------------------------------------- Anteckningar och bedömningar (0005, 0015): notesRead
alter policy check_ins_select on public.check_ins using (case_id in (select mm.notes_case_ids()));
alter policy check_ins_update on public.check_ins using (case_id in (select mm.notes_case_ids())) with check (mm.work_on(case_id));
alter policy intake_assessments_select on public.intake_assessments using (case_id in (select mm.notes_case_ids()));
alter policy intake_assessments_update on public.intake_assessments using (case_id in (select mm.notes_case_ids())) with check (mm.work_on(case_id));
alter policy monthly_assessments_select on public.monthly_assessments using (case_id in (select mm.notes_case_ids()));
alter policy monthly_assessments_update on public.monthly_assessments using (case_id in (select mm.notes_case_ids())) with check (mm.work_on(case_id));
alter policy monthly_plans_select on public.monthly_plans using (case_id in (select mm.notes_case_ids()));
alter policy monthly_plans_update on public.monthly_plans using (case_id in (select mm.notes_case_ids())) with check (mm.work_on(case_id));
alter policy deviations_select on public.deviations using (case_id in (select mm.notes_case_ids()));
alter policy deviations_update on public.deviations using (case_id in (select mm.notes_case_ids())) with check (mm.work_on(case_id));
alter policy consents_select on public.consents using (case_id in (select mm.notes_case_ids()));
alter policy consents_update on public.consents using (case_id in (select mm.notes_case_ids())) with check (mm.work_on(case_id));
alter policy pulse_invites_select on public.pulse_invites using (case_id in (select mm.notes_case_ids()));
alter policy pulse_invites_update on public.pulse_invites using (case_id in (select mm.notes_case_ids())) with check (mm.work_on(case_id));
alter policy voice_links_select on public.voice_links using (case_id in (select mm.notes_case_ids()));
alter policy voice_links_update on public.voice_links using (case_id in (select mm.notes_case_ids()))
  with check (mm.work_on(case_id) and not mm.case_is_protected(case_id));

-- ---------------------------------------------------------------- Bonus (0005): den som arbetar i ärendet, eller ekonomen med debiteringsåtkomst
alter policy bonus_claims_update on public.bonus_claims using (case_id in (select mm.case_ids('{full,team,billing}')))
  with check (mm.work_on(case_id) or mm.case_access_as(case_id, '{ekonom}') = 'billing');

-- ---------------------------------------------------------------- Rapporter (0006, 0014, 0026)
-- Per roll: Miljonbemanning i sina avtal (inte ekonomen) – veckorapporterna alla, beställarrapporten och statistiken bara
-- OVERSIGHT, rapporter utan ärende bara OVERSIGHT, ärendets rapporter med full- eller teamåtkomst (inte den vilande rollen
-- handledare). Kommunen: levererade rapporter till en själv i egna ärenden – aldrig beställarrapporten eller statistiken.
alter policy reports_select on public.reports using (
  (kind = 'weekly_attendance'
   and mm.in_contracts(contract_id, (select mm.contracts_as('{admin,avtalsansvarig,samordnare,coach,handledare,chef}'))))
  or (kind in ('customer_summary', 'statistics')
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef,admin}'))))
  or (kind not in ('weekly_attendance', 'customer_summary', 'statistics') and nullif(case_id, '') is null
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef,admin}'))))
  or (kind not in ('weekly_attendance', 'customer_summary', 'statistics') and nullif(case_id, '') is not null
   and mm.in_contracts(contract_id, (select mm.contracts_as('{admin,avtalsansvarig,samordnare,coach,chef}')))
   and case_id in (select mm.case_ids_as('{full,team}', '{admin,avtalsansvarig,samordnare,coach,chef}')))
  or (mm.in_contracts(contract_id, (select mm.contracts_as(mm.customer_roles())))
   and delivered_at is not null and kind not in ('customer_summary', 'statistics')
   and coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
   and (nullif(case_id, '') is null or case_id in (select mm.case_ids_as('{customer}', mm.customer_roles()))))
);
alter policy reports_insert on public.reports with check (
  (kind = 'weekly_attendance'
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}'))))
  or (kind in ('customer_summary', 'statistics')
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig}'))))
  or (kind not in ('weekly_attendance', 'customer_summary', 'statistics') and nullif(case_id, '') is not null
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach}')))
   and mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full')
);
alter policy reports_update on public.reports using (
  (kind = 'weekly_attendance'
   and mm.in_contracts(contract_id, (select mm.contracts_as('{admin,avtalsansvarig,samordnare,coach,handledare,chef}'))))
  or (kind in ('customer_summary', 'statistics')
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef,admin}'))))
  or (kind not in ('weekly_attendance', 'customer_summary', 'statistics') and nullif(case_id, '') is null
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef,admin}'))))
  or (kind not in ('weekly_attendance', 'customer_summary', 'statistics') and nullif(case_id, '') is not null
   and mm.in_contracts(contract_id, (select mm.contracts_as('{admin,avtalsansvarig,samordnare,coach,chef}')))
   and case_id in (select mm.case_ids_as('{full,team}', '{admin,avtalsansvarig,samordnare,coach,chef}')))
  or (mm.in_contracts(contract_id, (select mm.contracts_as(mm.customer_roles())))
   and delivered_at is not null and kind not in ('customer_summary', 'statistics')
   and coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
   and (nullif(case_id, '') is null or case_id in (select mm.case_ids_as('{customer}', mm.customer_roles()))))
) with check (
  (mm.in_contracts(contract_id, (select mm.contracts_as(mm.customer_roles())))
   and delivered_at is not null and kind not in ('customer_summary', 'statistics')
   and coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
   and (nullif(case_id, '') is null or case_id in (select mm.case_ids_as('{customer}', mm.customer_roles()))))
  or (kind = 'weekly_attendance'
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}'))))
  or (kind in ('customer_summary', 'statistics')
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig}'))))
  or (kind not in ('weekly_attendance', 'customer_summary', 'statistics') and nullif(case_id, '') is not null
   and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach}')))
   and mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full')
);

-- ---------------------------------------------------------------- Puls (0007): coachen läser aldrig enskilda svar
alter policy pulse_responses_select on public.pulse_responses using (case_id in (select mm.case_ids_as('{full}', '{samordnare,avtalsansvarig,chef,admin}')));
alter policy pulse_responses_insert on public.pulse_responses with check ((select mm.has_role('deltagare')) and mm.pulse_invite_open(invite_id, case_id));

-- ---------------------------------------------------------------- KPI:er, flaggor, deadlines (0007): interna, aldrig kommunen eller ekonomen
alter policy kpi_snapshots_select on public.kpi_snapshots using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef,admin,coach}')))
);
-- Flaggan: en av mottagarrollerna (eller chef och admin) i flaggans avtal, och åtkomst till ärendet.
alter policy alerts_select on public.alerts using (
  mm.member_as(contract_id, array(
    select r from unnest(recipient_roles || '{chef,admin}'::text[]) as r
    where r = any ('{admin,avtalsansvarig,samordnare,coach,handledare,chef}'::text[])))
  and (nullif(case_id, '') is null
       or case_id in (select mm.case_ids_as('{full,team,restricted,billing,customer}', '{admin,avtalsansvarig,samordnare,coach,handledare,chef}')))
);
alter policy alerts_update on public.alerts using (
  mm.member_as(contract_id, array(
    select r from unnest(recipient_roles || '{chef,admin}'::text[]) as r
    where r = any ('{admin,avtalsansvarig,samordnare,coach,handledare,chef}'::text[])))
  and (nullif(case_id, '') is null
       or case_id in (select mm.case_ids_as('{full,team,restricted,billing,customer}', '{admin,avtalsansvarig,samordnare,coach,handledare,chef}')))
) with check (
  mm.member_as(contract_id, array(select r from unnest(recipient_roles) as r where r = any (mm.supplier_roles())))
);
alter policy deadlines_select on public.deadlines using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{admin,avtalsansvarig,samordnare,coach,handledare,chef}')))
  and (nullif(case_id, '') is null
       or case_id in (select mm.case_ids_as('{full,team,restricted,billing,customer}', '{admin,avtalsansvarig,samordnare,coach,handledare,chef}')))
);
alter policy contract_deviations_select on public.contract_deviations using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef,admin}')))
  and (nullif(case_id, '') is null
       or case_id in (select mm.case_ids_as('{full,team,restricted,billing,customer}', '{samordnare,avtalsansvarig,chef,admin}')))
);
alter policy contract_deviations_insert on public.contract_deviations with check (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef}')))
);
alter policy contract_deviations_update on public.contract_deviations using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef,admin}')))
  and (nullif(case_id, '') is null
       or case_id in (select mm.case_ids_as('{full,team,restricted,billing,customer}', '{samordnare,avtalsansvarig,chef,admin}')))
) with check (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef}')))
);

-- ---------------------------------------------------------------- Fakturering (0008, 0023): läsare BILLING_READERS, skrivare ekonomen
alter policy billing_runs_select on public.billing_runs using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))));
alter policy billing_runs_insert on public.billing_runs with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy billing_runs_update on public.billing_runs using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))))
  with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy invoice_drafts_select on public.invoice_drafts using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))));
alter policy invoice_drafts_insert on public.invoice_drafts with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy invoice_drafts_update on public.invoice_drafts using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))))
  with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy billing_week_approvals_select on public.billing_week_approvals using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))));
alter policy billing_week_approvals_insert on public.billing_week_approvals with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy billing_week_approvals_update on public.billing_week_approvals using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))))
  with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy invoice_credits_select on public.invoice_credits using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))));
alter policy invoice_credits_insert on public.invoice_credits with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy invoice_credits_update on public.invoice_credits using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))))
  with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy fortnox_runs_select on public.fortnox_runs using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))));
alter policy fortnox_runs_insert on public.fortnox_runs with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy fortnox_runs_update on public.fortnox_runs using (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom,chef,avtalsansvarig,admin}'))))
  with check (mm.in_contracts(contract_id, (select mm.contracts_as('{ekonom}'))));
alter policy invoice_lines_select on public.invoice_lines using (
  invoice_draft_id in (select mm.invoice_draft_ids_as('{ekonom,chef,avtalsansvarig,admin}'))
);
alter policy invoice_lines_insert on public.invoice_lines with check (
  invoice_draft_id in (select mm.invoice_draft_ids_as('{ekonom}')) and mm.invoice_editable(invoice_draft_id)
);
alter policy invoice_lines_update on public.invoice_lines using (
  invoice_draft_id in (select mm.invoice_draft_ids_as('{ekonom,chef,avtalsansvarig,admin}')) and mm.invoice_editable(invoice_draft_id)
) with check (
  invoice_draft_id in (select mm.invoice_draft_ids_as('{ekonom}')) and mm.invoice_editable(invoice_draft_id)
);
alter policy invoice_lines_delete on public.invoice_lines using (
  invoice_draft_id in (select mm.invoice_draft_ids_as('{ekonom}')) and mm.invoice_editable(invoice_draft_id)
);

-- ---------------------------------------------------------------- AI (0009): anteckningar i ärendet, annars OVERSIGHT
alter policy ai_runs_select on public.ai_runs using (
  case when nullif(case_id, '') is not null then case_id in (select mm.notes_case_ids())
       else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}')) end
);
alter policy ai_runs_update on public.ai_runs using (
  case when nullif(case_id, '') is not null then case_id in (select mm.notes_case_ids())
       else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}')) end
) with check (
  case when nullif(case_id, '') is not null then mm.work_on(case_id) else (select mm.role_in('{samordnare,avtalsansvarig}')) end
);
alter policy ai_field_decisions_select on public.ai_field_decisions using (
  case when mm.ai_run_exists(ai_run_id) then
    case when nullif(mm.ai_run_case_id(ai_run_id), '') is not null then mm.ai_run_case_id(ai_run_id) in (select mm.notes_case_ids())
         else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}')) end
  else coalesce(decided_by = (select mm.current_profile_id()), false) or (select mm.role_in('{chef,admin}')) end
);
alter policy ai_field_decisions_update on public.ai_field_decisions using (
  case when mm.ai_run_exists(ai_run_id) then
    case when nullif(mm.ai_run_case_id(ai_run_id), '') is not null then mm.ai_run_case_id(ai_run_id) in (select mm.notes_case_ids())
         else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}')) end
  else coalesce(decided_by = (select mm.current_profile_id()), false) or (select mm.role_in('{chef,admin}')) end
) with check (
  (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}')) and decided_by = (select mm.current_profile_id())
  and (not mm.ai_run_exists(ai_run_id) or nullif(mm.ai_run_case_id(ai_run_id), '') is null or mm.work_on(mm.ai_run_case_id(ai_run_id)))
);

-- ---------------------------------------------------------------- Revisionslogg (0009): admin, och chefen i sina avtal
alter policy audit_log_select on public.audit_log using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{admin,chef}')))
  or (nullif(contract_id, '') is null and (select mm.has_role('chef')))
);

-- ---------------------------------------------------------------- Meddelanden (0009, 0014)
alter policy messages_select on public.messages using (
  case_id in (select mm.notes_case_ids()) or case_id in (select mm.case_ids_as('{customer}', mm.customer_roles()))
);
alter policy messages_insert on public.messages with check (
  sender_id = (select mm.current_profile_id())
  and (case_id in (select mm.case_ids_as('{full,team}', '{samordnare,avtalsansvarig,coach,handledare}'))
       or case_id in (select mm.case_ids_as('{customer}', '{kommun_handlaggare}')))
);
alter policy messages_update on public.messages using (
  case_id in (select mm.notes_case_ids()) or case_id in (select mm.case_ids_as('{customer}', mm.customer_roles()))
) with check (
  case_id in (select mm.case_ids_as('{full,team}', '{samordnare,avtalsansvarig,coach,handledare}'))
  or case_id in (select mm.case_ids_as('{customer}', mm.customer_roles()))
);

-- ---------------------------------------------------------------- Uppgifter (0009): avsändaren, mottagaren (person eller en av rollerna), admin och den som arbetar i ärendet
alter policy tasks_select on public.tasks using (
  from_id = (select mm.current_profile_id())
  or (select mm.has_role('admin'))
  or case when nullif(to_id, '') is not null then to_id = (select mm.current_profile_id()) else to_role = any ((select mm.current_roles())::text[]) end
  or case_ids && array(select mm.case_ids_as('{full,team}', '{admin,avtalsansvarig,samordnare,coach,handledare,chef}'))
);
alter policy tasks_update on public.tasks using (
  from_id = (select mm.current_profile_id())
  or (select mm.has_role('admin'))
  or case when nullif(to_id, '') is not null then to_id = (select mm.current_profile_id()) else to_role = any ((select mm.current_roles())::text[]) end
  or case_ids && array(select mm.case_ids_as('{full,team}', '{admin,avtalsansvarig,samordnare,coach,handledare,chef}'))
) with check (
  from_id = (select mm.current_profile_id())
  or case when nullif(to_id, '') is not null then to_id = (select mm.current_profile_id()) else to_role = any ((select mm.current_roles())::text[]) end
);

-- ---------------------------------------------------------------- Röstinspelning (0015)
alter policy participant_voice_notes_select on public.participant_voice_notes using (
  case_id in (select mm.notes_case_ids())
  or (status = 'reviewed' and case_id in (select mm.customer_voice_note_case_ids()))
);
alter policy participant_voice_notes_update on public.participant_voice_notes using (
  case_id in (select mm.notes_case_ids())
  or (status = 'reviewed' and case_id in (select mm.customer_voice_note_case_ids()))
) with check (mm.work_on(case_id) and not mm.case_is_protected(case_id));
alter policy audio_uploads_select on public.audio_uploads using (
  ((select mm.role_in(mm.supplier_roles() || mm.customer_roles())) and owner_id = (select mm.current_profile_id()))
  or (nullif(case_id, '') is not null and purpose <> 'dictation' and case_id in (select mm.notes_case_ids()))
);

-- ---------------------------------------------------------------- Fria anteckningar (0019)
-- Läsa: anteckningar "team" som notesRead, "full" bara med full åtkomst genom en roll som inte är ekonom. Skriva: den som
-- arbetar i ärendet i eget namn ("full"-anteckningar bara med full åtkomst genom CASE_WORKERS). Dölja: författaren eller
-- samordnare/avtalsansvarig med full åtkomst.
alter policy case_notes_select on public.case_notes using (
  (audience = 'team' and case_id in (select mm.notes_case_ids()))
  or case_id in (select mm.case_ids_as('{full}', array_remove(mm.all_roles(), 'ekonom')))
);
alter policy case_notes_insert on public.case_notes with check (
  author_id = (select mm.current_profile_id())
  and ((audience = 'team' and mm.work_on(case_id)) or mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach,handledare}') = 'full')
);
alter policy case_notes_update on public.case_notes using (
  (author_id = (select mm.current_profile_id()) and mm.work_on(case_id))
  or mm.case_access_as(case_id, '{samordnare,avtalsansvarig}') = 'full'
) with check (
  (author_id = (select mm.current_profile_id())
   and ((audience = 'team' and mm.work_on(case_id)) or mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach,handledare}') = 'full'))
  or mm.case_access_as(case_id, '{samordnare,avtalsansvarig}') = 'full'
);

-- ---------------------------------------------------------------- Sparade rapporter (0021, 0026)
-- Per roll: REPORT_BUILDERS i avtalet läser egna och delade. Ägaren ändrar sin rapport (aldrig delad med kommunen);
-- avtalsansvarig ändrar också andras delade rapporter (delningen och arkiveringen – triggern).
alter policy saved_reports_select on public.saved_reports using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef}')))
  and (owner_id = (select mm.current_profile_id()) or visibility <> 'private')
);
alter policy saved_reports_insert on public.saved_reports with check (
  owner_id = (select mm.current_profile_id())
  and ((mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef}'))) and visibility <> 'customer')
    or (mm.in_contracts(contract_id, (select mm.contracts_as('{avtalsansvarig}')))
        and contract_id = any ((select mm.individual_report_contract_ids())::text[])))
);
alter policy saved_reports_update on public.saved_reports using (
  archived_at is null
  and ((mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef}')))
        and owner_id = (select mm.current_profile_id()) and visibility <> 'customer')
    or (mm.in_contracts(contract_id, (select mm.contracts_as('{avtalsansvarig}')))
        and (owner_id = (select mm.current_profile_id()) or visibility <> 'private')))
) with check (
  (mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,chef}')))
   and owner_id = (select mm.current_profile_id()) and visibility <> 'customer')
  or (mm.in_contracts(contract_id, (select mm.contracts_as('{avtalsansvarig}')))
      and (owner_id = (select mm.current_profile_id()) or visibility <> 'private')
      and (visibility <> 'customer' or contract_id = any ((select mm.individual_report_contract_ids())::text[])))
);

-- ---------------------------------------------------------------- Bilagor (0024)
alter policy case_attachments_select on public.case_attachments using (
  deleted_at is null and (
    (case_id is null and (select mm.role_in(mm.supplier_roles() || mm.customer_roles())) and uploaded_by = (select mm.current_profile_id()))
    or (case_id is not null and (
      case_id in (select mm.case_ids_as('{full}', '{samordnare,avtalsansvarig,coach}'))
      or (case_id in (select mm.case_ids_as('{customer}', '{kommun_handlaggare}'))
          and mm.case_referrer_id(case_id) = (select mm.current_profile_id()))))
  )
);

-- ---------------------------------------------------------------- Gruppaktiviteter och gruppmål (0030, 0033)
alter policy group_activities_select on public.group_activities using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare,chef,admin}')))
);
alter policy group_activities_insert on public.group_activities with check (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}')))
  and created_by = (select mm.current_profile_id())
  and updated_at is null and updated_by is null and cancelled_at is null and cancelled_by is null
);
alter policy group_activities_update on public.group_activities using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}'))) and cancelled_at is null
) with check (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}')))
);
alter policy group_goal_results_select on public.group_goal_results using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare,chef,admin}')))
  and case_id in (select mm.case_ids_as('{full,team}', '{samordnare,avtalsansvarig,coach,handledare,chef,admin}'))
);
alter policy group_goal_results_insert on public.group_goal_results with check (
  mm.work_on(case_id)
  and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}')))
  and set_by = (select mm.current_profile_id())
);
alter policy group_goal_results_update on public.group_goal_results using (
  mm.work_on(case_id) and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}')))
) with check (
  mm.work_on(case_id)
  and mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare}')))
  and set_by = (select mm.current_profile_id())
);

-- ---------------------------------------------------------------- Grupper, nivåer och taggar (0031)
alter policy groupings_select on public.groupings using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,handledare,chef,admin}')))
);
alter policy groupings_insert on public.groupings with check (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,admin}')))
  and created_by = (select mm.current_profile_id())
);
alter policy groupings_update on public.groupings using (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,admin}')))
) with check (
  mm.in_contracts(contract_id, (select mm.contracts_as('{samordnare,avtalsansvarig,coach,admin}')))
);
alter policy grouping_members_select on public.grouping_members using (case_id in (select mm.notes_case_ids()));
alter policy grouping_members_insert on public.grouping_members with check (
  mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full' and added_by = (select mm.current_profile_id())
);
alter policy grouping_members_update on public.grouping_members using (
  mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full'
) with check (
  mm.case_access_as(case_id, '{samordnare,avtalsansvarig,coach}') = 'full'
);

-- ================================================================ Belopp i kronor: bara rollen ekonom
-- "Belopp i kronor syns bara för den som har rollen ekonom (då alltid)." Före: tabellerna med belopp lämnade ut beloppen till
-- alla som fick läsa raden, och servern tog bort dem i svaren (hidesMoney, src/api/tester-access.ts). Nu spärrar också
-- databasen beloppskolumnerna:
--   price_items.price_ore, invoice_drafts.accrued_ore och remaining_ore, invoice_lines.unit_price_ore,
--   bonus_claims.amount_ore, contract_deviations.penalty_ore och ai_runs.cost_ore.
-- * Inloggade läser tabellerna via vyerna <tabell>_public (security_invoker: samma rader som tabellens RLS). Beloppet lämnas
--   bara när aktören har rollen ekonom (mm.has_role('ekonom'), i något avtal – samma regel som hidesMoney); annars 0 (null i
--   kolumnerna som får vara null). Beloppet hämtas av en funktion med definer-rättighet som själv kräver rollen ekonom.
-- * Direkt i tabellen får inloggade läsa alla kolumner utom beloppen (kolumnrättigheter) – ingen inloggad läser ett belopp
--   förbi vyn. Ändringar och nya rader går som förut till tabellen, med samma policyer. Service role läser tabellerna direkt.
-- * SupabaseRepo läser tabellerna via vyerna (USER_READ_VIEWS i src/data/supabase/index.ts, samma mönster som cases_public i
--   0013). Minnesläget: samma mask i src/data/policy.ts (MONEY_MASK), som MemoryRepo lägger på varje läsning.
-- Avtalets konfiguration (contracts.config, bl.a. vitenas belopp) är ingen beloppskolumn: servern behöver den för att räkna
-- vitet och tar bort beloppen i svaren (hidesMoney) som förut.
create or replace function mm.price_item_price_ore(p_id text) returns bigint
language sql stable security definer set search_path = public, mm
as $$ select x.price_ore from public.price_items x where x.id = p_id and mm.has_role('ekonom') $$;
create or replace function mm.invoice_draft_accrued_ore(p_id text) returns bigint
language sql stable security definer set search_path = public, mm
as $$ select x.accrued_ore from public.invoice_drafts x where x.id = p_id and mm.has_role('ekonom') $$;
create or replace function mm.invoice_draft_remaining_ore(p_id text) returns bigint
language sql stable security definer set search_path = public, mm
as $$ select x.remaining_ore from public.invoice_drafts x where x.id = p_id and mm.has_role('ekonom') $$;
create or replace function mm.invoice_line_unit_price_ore(p_id text) returns bigint
language sql stable security definer set search_path = public, mm
as $$ select x.unit_price_ore from public.invoice_lines x where x.id = p_id and mm.has_role('ekonom') $$;
create or replace function mm.bonus_claim_amount_ore(p_id text) returns bigint
language sql stable security definer set search_path = public, mm
as $$ select x.amount_ore from public.bonus_claims x where x.id = p_id and mm.has_role('ekonom') $$;
create or replace function mm.contract_deviation_penalty_ore(p_id text) returns bigint
language sql stable security definer set search_path = public, mm
as $$ select x.penalty_ore from public.contract_deviations x where x.id = p_id and mm.has_role('ekonom') $$;
create or replace function mm.ai_run_cost_ore(p_id text) returns bigint
language sql stable security definer set search_path = public, mm
as $$ select x.cost_ore from public.ai_runs x where x.id = p_id and mm.has_role('ekonom') $$;
revoke all on function
  mm.price_item_price_ore(text), mm.invoice_draft_accrued_ore(text), mm.invoice_draft_remaining_ore(text),
  mm.invoice_line_unit_price_ore(text), mm.bonus_claim_amount_ore(text), mm.contract_deviation_penalty_ore(text),
  mm.ai_run_cost_ore(text)
from public, anon;
grant execute on function
  mm.price_item_price_ore(text), mm.invoice_draft_accrued_ore(text), mm.invoice_draft_remaining_ore(text),
  mm.invoice_line_unit_price_ore(text), mm.bonus_claim_amount_ore(text), mm.contract_deviation_penalty_ore(text),
  mm.ai_run_cost_ore(text)
to authenticated, service_role;

-- Vyerna: tabellens kolumner i samma ordning; (select mm.has_role('ekonom')) räknas en gång per fråga.
create or replace view public.price_items_public with (security_invoker = true) as
  select x.id, x.contract_id, x.area_code, x.code, x.unit, x.package_months,
         case when (select mm.has_role('ekonom')) then coalesce(mm.price_item_price_ore(x.id), 0) else 0 end::bigint as price_ore,
         x.vat_rate, x.valid_from, x.valid_to, x.fortnox_article_no, x.example_only
  from public.price_items x;
create or replace view public.invoice_drafts_public with (security_invoker = true) as
  select x.id, x.billing_run_id, x.contract_id, x.month, x.kind, x.case_id, x.grouping_key, x.buyer_reference,
         x.purchase_order_number, x.invoiced_object,
         case when (select mm.has_role('ekonom')) then mm.invoice_draft_accrued_ore(x.id) end::bigint as accrued_ore,
         case when (select mm.has_role('ekonom')) then mm.invoice_draft_remaining_ore(x.id) end::bigint as remaining_ore,
         x.status, x.approved_by, x.approved_at, x.manual_invoice_no, x.fortnox_document_number, x.fortnox_idempotency_key,
         x.fortnox_created_at, x.synced_at
  from public.invoice_drafts x;
create or replace view public.invoice_lines_public with (security_invoker = true) as
  select x.id, x.invoice_draft_id, x.case_id, x.price_item_id, x.quantity,
         case when (select mm.has_role('ekonom')) then coalesce(mm.invoice_line_unit_price_ore(x.id), 0) else 0 end::bigint as unit_price_ore,
         x.vat_rate, x.description, x.iso_weeks, x.zero_attendance_weeks, x.note
  from public.invoice_lines x;
create or replace view public.bonus_claims_public with (security_invoker = true) as
  select x.id, x.case_id, x.kind, x.basis, x.evidence_paths, x.submitted_at, x.customer_decision, x.decided_by, x.decided_at,
         case when (select mm.has_role('ekonom')) then mm.bonus_claim_amount_ore(x.id) end::bigint as amount_ore,
         x.invoice_draft_id
  from public.bonus_claims x;
create or replace view public.contract_deviations_public with (security_invoker = true) as
  select x.id, x.contract_id, x.case_id, x.source, x.type, x.level, x.escalation_step, x.description, x.raised_at,
         x.registered_by, x.action_plan, x.action_plan_due, x.owner_id, x.plan_submitted_at, x.customer_approved_at,
         x.customer_approved_by, x.warning_issued, x.warning_issued_at, x.penalty_kind,
         case when (select mm.has_role('ekonom')) then coalesce(mm.contract_deviation_penalty_ore(x.id), 0) else 0 end::bigint as penalty_ore,
         x.penalty_offset_month, x.order_stop, x.status, x.lessons, x.closed_at, x.closed_by
  from public.contract_deviations x;
create or replace view public.ai_runs_public with (security_invoker = true) as
  select x.id, x.case_id, x.kind, x.provider, x.model, x.input_ref, x.status, x.created_at, x.audio_seconds, x.tokens_in,
         x.tokens_out,
         case when (select mm.has_role('ekonom')) then coalesce(mm.ai_run_cost_ore(x.id), 0) else 0 end::bigint as cost_ore,
         x.latency_ms, x.output, x.evidence, x.input_deleted_at
  from public.ai_runs x;
revoke all on public.price_items_public, public.invoice_drafts_public, public.invoice_lines_public, public.bonus_claims_public,
  public.contract_deviations_public, public.ai_runs_public
from public, anon, authenticated;
grant select on public.price_items_public, public.invoice_drafts_public, public.invoice_lines_public, public.bonus_claims_public,
  public.contract_deviations_public, public.ai_runs_public
to authenticated, service_role;

-- Direkt i tabellerna: alla kolumner utom beloppen (en återkallad tabellrättighet tar också kolumnrättigheterna – därför
-- återkallas först och ges sedan per kolumn; kan köras igen).
revoke select on public.price_items, public.invoice_drafts, public.invoice_lines, public.bonus_claims,
  public.contract_deviations, public.ai_runs
from authenticated;
grant select (id, contract_id, area_code, code, unit, package_months, vat_rate, valid_from, valid_to, fortnox_article_no,
  example_only) on public.price_items to authenticated;
grant select (id, billing_run_id, contract_id, month, kind, case_id, grouping_key, buyer_reference, purchase_order_number,
  invoiced_object, status, approved_by, approved_at, manual_invoice_no, fortnox_document_number, fortnox_idempotency_key,
  fortnox_created_at, synced_at) on public.invoice_drafts to authenticated;
grant select (id, invoice_draft_id, case_id, price_item_id, quantity, vat_rate, description, iso_weeks, zero_attendance_weeks,
  note) on public.invoice_lines to authenticated;
grant select (id, case_id, kind, basis, evidence_paths, submitted_at, customer_decision, decided_by, decided_at,
  invoice_draft_id) on public.bonus_claims to authenticated;
grant select (id, contract_id, case_id, source, type, level, escalation_step, description, raised_at, registered_by,
  action_plan, action_plan_due, owner_id, plan_submitted_at, customer_approved_at, customer_approved_by, warning_issued,
  warning_issued_at, penalty_kind, penalty_offset_month, order_stop, status, lessons, closed_at, closed_by)
  on public.contract_deviations to authenticated;
grant select (id, case_id, kind, provider, model, input_ref, status, created_at, audio_seconds, tokens_in, tokens_out,
  latency_ms, output, evidence, input_deleted_at) on public.ai_runs to authenticated;
