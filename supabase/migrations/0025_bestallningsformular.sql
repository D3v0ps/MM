-- 0025 Beställningsformuläret (beslut 2026-10-07, synpunkt #3, #5 och #7).
--
-- Omfattningen är 6 eller 12 månader (avtalets orderPeriods.months) eller "Annan tidsperiod" med slutdatum och en
-- obligatorisk motivering. Vid 6 eller 12 månader räknar servern fram planerat slutdatum från startdatumet. Under
-- "Bakgrundsinformation om deltagaren" svarar handläggaren om en kartläggning har genomförts (ja, nej, vet inte).
--   order_period_months   antal månader (null = annan tidsperiod eller en äldre beställning i veckor)
--   order_period_reason   motiveringen vid annan tidsperiod
--   prior_assessment      'yes' | 'no' | 'unknown' (null = äldre beställning)
-- Bakgrundsinformationen (fritext) ligger som förut i background_info.
--
-- Fallgrop: mm.visible_cases() returnerar setof public.cases och vyn cases_public (0013) har en fast kolumnlista. När
-- tabellen får nya kolumner måste funktionen och vyn byggas om – annars stämmer inte funktionens resultat med radtypen och
-- läsningen av ärenden slutar fungera för inloggade (SupabaseRepo läser cases via cases_public). De nya kolumnerna läggs
-- sist i tabellen och sist i funktionens lista. Motiveringen och kartläggningssvaret döljs för 'restricted' och 'billing'
-- (som bakgrunden). RLS-policyerna för tabellen är oförändrade (kolumnerna skrivs med samma insert- och update-policyer).
-- Migrationen skrivs men appliceras inte förrän omgångarna är sammanfogade (driftordning: 0023–0026 tillsammans).

alter table public.cases
  add column order_period_months integer check (order_period_months is null or order_period_months > 0),
  add column order_period_reason text check (order_period_reason is null or char_length(order_period_reason) between 1 and 500),
  add column prior_assessment text check (prior_assessment is null or prior_assessment in ('yes', 'no', 'unknown'));

create or replace function mm.visible_cases() returns setof public.cases
language sql stable security definer set search_path = public, mm
as $$
  -- policy.ts cases.read: accessOfCase !== "none" (samma nivåer som policyn cases_select)
  select c.id, c.case_number, c.contract_id, c.person_id, c.status, c.source, c.referred_at, c.referrer_id, c.referrer_name,
         c.referrer_unit, c.referrer_phone, c.referrer_email, c.buyer_reference, c.purchase_order_number, c.primary_area_code,
         c.secondary_area_code, c.vocational_track, c.desired_start, c.planned_start, c.planned_weeks, c.planned_end,
         c.order_value_weeks, c.acknowledged_at, c.confirmed_at, c.declined_at, c.decline_reason,
         case when h.hidden then date_trunc('day', c.first_meeting_at, 'Europe/Stockholm') else c.first_meeting_at end,
         c.start_date, c.end_date, c.closed_at, c.end_reason, c.result_class, c.result_verified_at, c.phase, c.phase_since,
         c.lead_coach_id,
         case when h.hidden then '' else c.background_info end,
         c.ai_consent_status,
         case when h.hidden then null else c.meeting_day end,
         case when h.hidden then null else c.meeting_time end,
         case when h.hidden then '' else c.location end,
         c.paused_weeks,
         case when h.hidden then null else c.pause_reason end,
         c.source_email_id,
         c.order_period_months,
         case when h.hidden then null else c.order_period_reason end,
         case when h.hidden then null else c.prior_assessment end
  from public.cases c
  join mm.my_case_access() a on a.case_id = c.id
  cross join lateral (select a.access in ('restricted', 'billing') as hidden) h
  where a.access in ('full', 'team', 'restricted', 'billing', 'customer')
$$;
revoke all on function mm.visible_cases() from public, anon;
grant execute on function mm.visible_cases() to authenticated, service_role;

-- Vyns kolumnlista bestäms när den skapas – därför byggs den om (inga andra objekt beror på vyn).
drop view public.cases_public;
create view public.cases_public with (security_invoker = true) as select * from mm.visible_cases();
revoke all on public.cases_public from anon, authenticated;
grant select on public.cases_public to authenticated, service_role;
