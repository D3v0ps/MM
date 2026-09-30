-- 0013 Ärenden för läsning: vyn cases_public (samma mönster som contracts_public i 0002).
--
-- RLS döljer rader, inte kolumner. cases_select släpper igenom ärenden med åtkomsten 'restricted' (samordnare, chef,
-- admin och kommunens chef i ett ärende med skyddade personuppgifter) och 'billing' (ekonomen). Med direkt läsning av
-- tabellen fick de hela raden – även var och när deltagaren träffas och bakgrunden från beställningen. Därför:
--   * vyn cases_public ger samma rader som cases_select, men för 'restricted' och 'billing' döljs
--       background_info och location (tom text), meeting_day, meeting_time och pause_reason (null)
--       och first_meeting_at kortas till datumet (klockslaget döljs; att ett första möte är bokat syns fortfarande,
--       eftersom flaggor och listor för samordnaren bygger på det),
--   * inloggade användare får bara läsa kolumnen id direkt i tabellen (för where-villkor i ändringar) – allt annat
--     läses via vyn. Ändringar (update) och nya rader (insert) går som förut till tabellen, med samma policyer.
-- SupabaseRepo läser tabellen "cases" via cases_public (src/data/supabase/index.ts, USER_READ_VIEWS). Service role läser
-- tabellen direkt (systemsteg).
create function mm.visible_cases() returns setof public.cases
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
         c.source_email_id
  from public.cases c
  join mm.my_case_access() a on a.case_id = c.id
  cross join lateral (select a.access in ('restricted', 'billing') as hidden) h
  where a.access in ('full', 'team', 'restricted', 'billing', 'customer')
$$;
revoke all on function mm.visible_cases() from public, anon;
grant execute on function mm.visible_cases() to authenticated, service_role;

create view public.cases_public with (security_invoker = true) as select * from mm.visible_cases();
revoke all on public.cases_public from anon, authenticated;
grant select on public.cases_public to authenticated, service_role;

-- Direkt läsning av tabellen: bara id (where id = … i ändringar). Övriga kolumner läses via cases_public.
revoke select on public.cases from authenticated;
grant select (id) on public.cases to authenticated;
