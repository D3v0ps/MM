-- 0033 Gruppmål (coachmötet 2026-10-09, Karims beslut 2).
--
-- På en gruppaktivitet kan coachen skriva ett mål för hela gruppen ("Alla skriver ett CV"). Alla deltagare klarar målet
-- automatiskt – coachen markerar den som inte klarade det (som frånvaro) och kan ändra tillbaka.
--
-- 1. group_activities.goal: gruppmålet (valfritt, 1–300 tecken). Ändras som aktivitetens övriga fält (policyerna och triggern
--    i 0030 gäller: de som arbetar i ärendena, inte en inställd aktivitet, ändrad i eget namn).
-- 2. group_goal_results: coachens val per deltagare. Ingen rad = Klarade automatiskt (visas så i aktivitetsvyn). achieved =
--    false är Klarade inte; true är Klarade efter att coachen ändrat tillbaka. En rad per deltagare och gruppaktivitet.
--    Behörighet (samma regler som src/data/policy.ts group_goal_results):
--      * läsa: Miljonbemanning i avtalet utom ekonomen (som gruppaktiviteterna) med full- eller teamåtkomst till ärendet –
--        den vilande spärren för skyddade personuppgifter gäller. Kommunen och ekonomen läser aldrig.
--      * skapa och ändra: den som arbetar i ärendet (mm.work_on), medlem i avtalet, i eget namn (set_by). Triggern: raden hör
--        till gruppaktivitetens och ärendets avtal, aktiviteten har ett mål och är inte inställd, deltagaren är inbjuden (har
--        ett tillfälle i aktiviteten); vid ändring ändras bara valet (achieved) och tiden – aldrig aktivitet, ärende eller avtal.
--      * ingen raderar (ingen delete-policy och ingen delete-rättighet) – historiken finns i revisionsloggen.
--
-- Gruppmålet är ett internt arbetsverktyg (Karims beslut 2): det blir aldrig deltagarens veckomål och påverkar aldrig
-- progression, samlad status, rapporter, resultatfil, export eller faktura. Ingen vy, rapport eller export läser tabellerna,
-- och kommunen kan inte läsa dem (RLS). Speglas i src/data/policy.ts (och UNIQUE_KEYS i src/data/schema.ts) och prövas i
-- src/data/supabase/rls-parity.test.ts.
-- Inga destruktiva satser. Idempotent (if not exists, or replace, drop … if exists) – tål att köras igen i SQL Editor.

-- ---------------------------------------------------------------- 1. Gruppmålet på gruppaktiviteten
alter table public.group_activities add column if not exists goal text;
alter table public.group_activities drop constraint if exists group_activities_goal_length;
alter table public.group_activities add constraint group_activities_goal_length check (goal is null or char_length(btrim(goal)) between 1 and 300);

-- ---------------------------------------------------------------- 2. Coachens val per deltagare
create table if not exists public.group_goal_results (
  id                text primary key,
  contract_id       text not null references public.contracts (id),
  group_activity_id text not null references public.group_activities (id),
  case_id           text not null references public.cases (id),
  -- false = Klarade inte, true = Klarade (coachen ändrade tillbaka). Ingen rad = Klarade automatiskt.
  achieved          boolean not null,
  set_by            text not null references public.profiles (id),
  set_at            timestamptz not null
);
-- En rad per deltagare och gruppaktivitet (UNIQUE_KEYS i src/data/schema.ts). Täcker också group_activity_id (främmande nyckel).
create unique index if not exists group_goal_results_activity_case_key on public.group_goal_results (group_activity_id, case_id);
create index if not exists group_goal_results_contract_id_idx on public.group_goal_results (contract_id);
create index if not exists group_goal_results_case_id_idx on public.group_goal_results (case_id);
create index if not exists group_goal_results_set_by_idx on public.group_goal_results (set_by);

alter table public.group_goal_results enable row level security;
revoke all on public.group_goal_results from anon, authenticated;
grant all on public.group_goal_results to service_role;
-- Ingen delete: ett val ändras, det raderas inte.
grant select, insert, update on public.group_goal_results to authenticated;

-- policy.ts group_goal_results.read
drop policy if exists group_goal_results_select on public.group_goal_results;
create policy group_goal_results_select on public.group_goal_results for select to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and case_id in (select mm.case_ids('{full,team}'))
);
-- policy.ts groupGoalWrite (ny rad)
drop policy if exists group_goal_results_insert on public.group_goal_results;
create policy group_goal_results_insert on public.group_goal_results for insert to authenticated with check (
  mm.work_on(case_id)
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and set_by = (select mm.current_profile_id())
);
-- policy.ts groupGoalWrite (ändring). Vilka kolumner som får ändras styr triggern nedan.
drop policy if exists group_goal_results_update on public.group_goal_results;
create policy group_goal_results_update on public.group_goal_results for update to authenticated using (
  mm.work_on(case_id)
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  mm.work_on(case_id)
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and set_by = (select mm.current_profile_id())
);

-- Raden hör till aktiviteten och deltagaren (policy.ts groupGoalConsistent – gäller alla, också service role), och för
-- inloggade kolumnskyddet (policy.ts groupGoalWrite): vid ändring ändras bara valet och tiden, och valet måste ändras.
-- Uppslagen görs med den inloggades rättigheter: den som får skriva (mm.work_on) läser aktiviteten och deltagarens tillfällen.
create or replace function mm.check_group_goal_result() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  g public.group_activities%rowtype;
begin
  select * into g from public.group_activities where id = new.group_activity_id;
  if not found or g.contract_id is distinct from new.contract_id or mm.case_contract_id(new.case_id) is distinct from new.contract_id then
    raise exception 'Resultatet ska höra till aktivitetens och ärendets avtal' using errcode = '23514';
  end if;
  if g.cancelled_at is not null or g.goal is null then
    raise exception 'Aktiviteten har inget gruppmål eller är inställd' using errcode = '23514';
  end if;
  if not exists (select 1 from public.activities a where a.group_activity_id = new.group_activity_id and a.case_id = new.case_id) then
    raise exception 'Deltagaren är inte inbjuden till aktiviteten' using errcode = '23514';
  end if;
  if current_user not in ('authenticated', 'anon') or tg_op = 'INSERT' then
    return new;
  end if;
  if new.id is distinct from old.id or new.contract_id is distinct from old.contract_id or new.group_activity_id is distinct from old.group_activity_id
     or new.case_id is distinct from old.case_id then
    raise exception 'Aktivitet, ärende och avtal ändras aldrig' using errcode = '42501';
  end if;
  if new.achieved is not distinct from old.achieved then
    raise exception 'Ändringen ändrar inte valet' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists group_goal_results_check on public.group_goal_results;
create trigger group_goal_results_check before insert or update on public.group_goal_results
for each row execute function mm.check_group_goal_result();
