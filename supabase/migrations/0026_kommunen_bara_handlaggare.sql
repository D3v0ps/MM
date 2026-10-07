-- 0026 Kommunen har bara rollen handläggare (beslut 2026-10-07, synpunkt #14 och beslut 1).
--
-- Rollen kommunens chef tas bort: beställarrapporten, resultatfilen och rapporterna som Miljonbemanning delade med kommunens
-- chef finns inte längre i portalen. Beställarrapporten och resultatfilen tas fram av Miljonbemanning internt och lämnas till
-- kommunen av avtalsansvarig – inte som bilaga i vanlig e-post (CLAUDE.md punkt 9, reportDelivery.emailAttachmentAllowed).
-- Alla med en adress på avtalets kommundomän kan skapa ett konto själva och blir handläggare (contracts.config.selfRegistration;
-- profilen och medlemskapet skrivs av servern med service role vid första inloggningen – ingen ändring av RLS behövs för det).
--   1. Befintliga chefsmedlemskap blir handläggarmedlemskap (alla i kommunen får samma behörighet).
--   2. mm.customer_roles() = bara 'kommun_handlaggare'. Kontrollen på memberships.role stoppar nya chefsmedlemskap.
--   3. Beställarrapporten skapas per avtal och månad, utan mottagare (src/core/report-schedule.ts, reportKey).
--   4. Sparade rapporter delas aldrig med kommunen: 'customer' blir 'mb' och kontrollen tillåter bara 'private' och 'mb'.
--   5. Synpunkt #11 och beslut 5 (inga belopp för kommunen): kommunen läser inte prislistan (price_items) – bara
--      Miljonbemanning – och inte avtalets viten i öre (contracts_public, mm.customer_safe_config) eller bonusanspråken
--      (bonus_claims har beloppet; fas 3 bygger kommunens beslut med en vy utan belopp).
--   6. Beställarrapporten och statistiken läses aldrig av kommunen (reports_select/reports_update) – inte heller av en
--      tidigare chef vars id står kvar i delivered_to.
--   7. Synligheten "unit": enheten tas bara från medlemskapet (satt av Miljonbemanning), aldrig från profilen som
--      handläggaren skriver själv (mm.current_unit, samma regel som actorFor i src/data/actors.ts).
-- Policyerna för reports (0006), contract_deviations (0007), kvittenserna (0014) och saved_reports (0021) som nämner
-- 'kommun_chef' blir onåbara (rollen kan inte finnas) och lämnas orörda – src/data/policy.ts har tagit bort grenarna och
-- pariteten håller eftersom ingen har rollen. mm.case_access_level behåller sin gren för 'kommun_chef' av samma skäl.
-- Skyddade personuppgifter (persons.protected_identity) är borttaget ur appen men spärren i RLS ligger kvar vilande
-- (beslut 2026-10-07) – ingen ändring här.
-- Migrationen skrivs men appliceras inte förrän omgångarna är sammanfogade (driftordning: 0023–0026 tillsammans).

-- ---------------------------------------------------------------- 1. Chefsmedlemskapen blir handläggare
-- Har personen redan ett handläggarmedlemskap i avtalet tas chefsmedlemskapet bort, annars byter det roll.
delete from public.memberships m
where m.role = 'kommun_chef'
  and exists (select 1 from public.memberships x where x.user_id = m.user_id and x.contract_id = m.contract_id and x.role = 'kommun_handlaggare');
update public.memberships set role = 'kommun_handlaggare' where role = 'kommun_chef';
-- Testare som valt att agera som kommunens chef agerar som handläggare (tester_sessions, 0002).
update public.tester_sessions set role = 'kommun_handlaggare' where role = 'kommun_chef';

-- ---------------------------------------------------------------- 2. Kommunens roller
create or replace function mm.customer_roles() returns text[]
language sql immutable set search_path = public, mm
as $$ select array['kommun_handlaggare'] $$;

-- ---------------------------------------------------------------- 3. Beställarrapporten per avtal och månad
-- Mottagaren tas bort. Fanns flera chefer samma månad behålls den mest framskridna raden (levererad före godkänd före utkast,
-- sedan äldst id); de andra markeras som ersatta av den och får previous_id, så att de inte räknas av det unika indexet.
with ranked as (
  select id, contract_id, month,
         row_number() over (
           partition by contract_id, month
           order by case when delivered_at is not null then 0 when approved_at is not null then 1 else 2 end, id
         ) as n
  from public.reports
  where kind = 'customer_summary' and previous_id is null
),
keep as (select id, contract_id, month from ranked where n = 1)
update public.reports r
set superseded = true, superseded_by = k.id, superseded_at = coalesce(r.superseded_at, r.approved_at, r.due_at), previous_id = k.id
from ranked x join keep k on k.contract_id = x.contract_id and k.month = x.month
where r.id = x.id and x.n > 1;
update public.reports set recipient_user_id = null where kind = 'customer_summary';

drop index public.reports_customer_summary_key;
create unique index reports_customer_summary_key on public.reports (contract_id, month)
  where kind = 'customer_summary' and previous_id is null;

-- ---------------------------------------------------------------- 4. Sparade rapporter delas aldrig med kommunen
-- shared_at och shared_by behålls (delningen inom Miljonbemanning gjordes av samma person). Triggern (0021) gäller bara inloggade.
update public.saved_reports set visibility = 'mb' where visibility = 'customer';
alter table public.saved_reports drop constraint saved_reports_visibility_check;
alter table public.saved_reports add constraint saved_reports_visibility_check check (visibility in ('private', 'mb'));

-- ---------------------------------------------------------------- 5. Prislistan bara för Miljonbemanning (#11)
-- policy.ts price_items.read: isMB && member(contractId). Skrivning som förut (admin).
drop policy price_items_select on public.price_items;
create policy price_items_select on public.price_items for select to authenticated using (
  (select mm.is_mb()) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
drop policy price_items_update on public.price_items;
create policy price_items_update on public.price_items for update to authenticated using (
  (select mm.is_mb()) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check ((select mm.current_role()) = 'admin');

-- ---------------------------------------------------------------- 5b. Inga viten eller bonusbelopp för kommunen (beslut 5)
-- Avtalets viten (penalties: belopp i öre) töms i kommunens version av avtalet. Avsnittet finns kvar (tomt), så att
-- requireOperational i appen fungerar för kommunen; ingen av kommunens hanterare läser vitena.
create or replace function mm.customer_safe_config(config jsonb) returns jsonb
language sql immutable set search_path = public, mm
as $$
  select case when jsonb_typeof(c.cfg -> 'penalties') = 'object' then jsonb_set(c.cfg, '{penalties}', '{}'::jsonb) else c.cfg end
  from (
    select case
      when jsonb_typeof(config -> 'kpis') = 'array' then jsonb_set(config, '{kpis}', (
        select coalesce(jsonb_agg(case when jsonb_typeof(e.k) = 'object' then e.k - 'internalTarget' - 'notify' else e.k end order by e.ord), '[]'::jsonb)
        from jsonb_array_elements(config -> 'kpis') with ordinality as e (k, ord)))
      else config
    end as cfg
  ) c
$$;

-- policy.ts bonus_claims.read: access in (full, team, billing) – inte kommunen ("customer").
drop policy bonus_claims_select on public.bonus_claims;
create policy bonus_claims_select on public.bonus_claims for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing}'))
);
drop policy bonus_claims_update on public.bonus_claims;
create policy bonus_claims_update on public.bonus_claims for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing}'))
) with check (
  mm.work_on(case_id)
  or ((select mm.current_role()) = 'ekonom' and mm.case_access(case_id) = 'billing')
);

-- ---------------------------------------------------------------- 6. Rapporterna: kommunen läser aldrig beställarrapporten
-- policy.ts reportRead/reportWrite: samma grenar som 0006 för Miljonbemanning; för kommunen bara levererade rapporter som inte
-- är beställarrapport eller statistik, till mig (utan ärende) eller i ärenden med åtkomst "customer" och till mig. Grenen för
-- kommunens chef (individrapporter) är borttagen – rollen finns inte längre.
drop policy reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated using (
  case
    when not mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids())) then false
    when (select mm.is_mb()) then case
      when (select mm.current_role()) = 'ekonom' then false
      when kind = 'weekly_attendance' then true
      when kind in ('customer_summary', 'statistics') then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      when (select mm.current_role()) = 'handledare' then false
      when nullif(case_id, '') is null then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      else case_id in (select mm.case_ids('{full,team}'))
    end
    when (select mm.is_kom()) then case
      when delivered_at is null then false
      when kind in ('customer_summary', 'statistics') then false
      when nullif(case_id, '') is null then coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
      when case_id not in (select mm.case_ids('{customer}')) then false
      else coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
    end
    else false
  end
);
drop policy reports_update on public.reports;
create policy reports_update on public.reports for update to authenticated using (
  case
    when not mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids())) then false
    when (select mm.is_mb()) then case
      when (select mm.current_role()) = 'ekonom' then false
      when kind = 'weekly_attendance' then true
      when kind in ('customer_summary', 'statistics') then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      when (select mm.current_role()) = 'handledare' then false
      when nullif(case_id, '') is null then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      else case_id in (select mm.case_ids('{full,team}'))
    end
    when (select mm.is_kom()) then case
      when delivered_at is null then false
      when kind in ('customer_summary', 'statistics') then false
      when nullif(case_id, '') is null then coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
      when case_id not in (select mm.case_ids('{customer}')) then false
      else coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
    end
    else false
  end
) with check (
  case
    when (select mm.is_kom()) then
      mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and case
        when delivered_at is null then false
        when kind in ('customer_summary', 'statistics') then false
        when nullif(case_id, '') is null then coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
        when case_id not in (select mm.case_ids('{customer}')) then false
        else coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
      end
    when (select mm.is_mb()) then
      mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and case
        when kind = 'weekly_attendance' then (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
        when kind in ('customer_summary', 'statistics') then (select mm.role_in('{samordnare,avtalsansvarig}'))
        when nullif(case_id, '') is not null then (select mm.role_in('{samordnare,avtalsansvarig,coach}')) and mm.case_access(case_id) = 'full'
        else false
      end
    else false
  end
);

-- ---------------------------------------------------------------- 7. Synligheten "unit": bara medlemskapets enhet
-- Profilens enhet skriver handläggaren själv (Mina uppgifter, självregistrering) – den ger aldrig åtkomst till enhetens ärenden.
create or replace function mm.current_unit() returns text
language sql stable security definer set search_path = public, mm
as $$
  select m.customer_unit from public.memberships m
  where m.user_id = mm.current_profile_id() and m.role = mm.current_role() order by m.id limit 1
$$;
