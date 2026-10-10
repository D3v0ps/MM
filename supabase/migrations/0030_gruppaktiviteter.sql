-- 0030 Gruppaktiviteter och automatisk närvaro (coachmötet 2026-10-09, Karims beslut 1 och "Kör på alla önskemål").
--
-- 1. Gruppaktiviteter: ett tillfälle för flera deltagare ("CV-verkstad tisdag 13.00"). Tabellen group_activities har
--    namnet, typen, tiden, längden, platsen och ansvarig coach. Varje inbjuden deltagare får som förut en egen rad i
--    activities, nu med group_activity_id – veckorapporten, närvarograden och fakturan räknar raderna som tidigare. Tid,
--    längd, plats och typ ändras på gruppaktiviteten och deltagarnas rader samtidigt (hanteraren aktiviteter.andra).
--    Behörighet (samma regler som src/data/policy.ts group_activities):
--      * läsa: Miljonbemanning i avtalet utom ekonomen (samordnare, avtalsansvarig, coach, handledare, chef, admin) – "alla
--        ser alla" (beslut 2026-10-09). Kommunen och ekonomen läser inga gruppaktiviteter.
--      * skapa: de som arbetar i ärendena (samordnare, avtalsansvarig, coach, handledare), medlem i avtalet, i eget namn
--        (created_by = mm.current_profile_id()), varken ändrad eller inställd.
--      * ändra: samma roller, medlem, inte inställd. Triggern: något måste ändras; avtal, skapare och skapad-tid ändras
--        aldrig; ändrad och inställd sätts parvis och i eget namn.
--      * ingen raderar (ingen delete-policy och ingen delete-rättighet) – en aktivitet ställs in (cancelled_at).
--    Namnet är internt och kommer aldrig med i rapporter, resultatfil eller export (deltagarnas rader har ingen text).
-- 2. Deltagarens tillfälle kan tas bort (activities_delete): ta bort en deltagare ur gruppaktiviteten, ställ in
--    gruppaktiviteten, och ta bort ett enskilt tillfälle (arenden.activityRemove, caseScheduleChange) – samma regel som
--    skrivningen (mm.work_on). Ett tillfälle med registrerad närvaro kan inte tas bort: hanterarna nekar, och den främmande
--    nyckeln attendance.activity_id stoppar det i databasen. Tidigare saknades delete-rättigheten, så borttagningen av
--    enstaka tillfällen fungerade bara i minnesläget.
-- 3. Automatisk närvaro (Karims beslut 1): attendance.source = 'manual' (en människa registrerade) eller 'auto' (jobbet
--    auto_attendance registrerade Närvarande efter dagens slut för ett tillfälle som saknade närvaro – src/features/_shared/
--    auto-attendance.ts). Inloggade användare skriver bara 'manual' (insert och update): en automatisk rad som coachen ändrar
--    blir manuell, och ingen kan förfalska en automatisk rad. Jobbet skriver med service role. Befintliga rader blir 'manual'.
-- 4. En rad per deltagare och gruppaktivitet: unikt index (group_activity_id, case_id) för rader med group_activity_id. Två
--    samtidiga inbjudningar av samma deltagare ger då inte två tillfällen (hanteraren räknar dubbletten som redan inbjuden).
-- Speglas i src/data/policy.ts (och UNIQUE_KEYS i src/data/schema.ts) och prövas i src/data/supabase/rls-parity.test.ts.
-- Inga destruktiva satser. Idempotent (if not exists, or replace, drop … if exists) – tål att köras igen i SQL Editor, t.ex.
-- om en körning avbröts. Driftordning (docs/DRIFT.md): 0030 appliceras FÖRE koden från spår A – koden skriver
-- attendance.source och activities.group_activity_id vid varje närvaroregistrering och varje nytt tillfälle.

-- ---------------------------------------------------------------- 1. Gruppaktiviteter
create table if not exists public.group_activities (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  name                       text not null check (char_length(btrim(name)) between 1 and 120),
  kind                       text not null check (kind in ('yrkesmoment', 'arbetsgivarbesök', 'annat')),
  starts_at                  timestamptz not null,
  duration_min               integer not null check (duration_min between 1 and 720),
  location                   text not null check (char_length(location) <= 200),
  -- Ansvarig coach (valfri).
  responsible_id             text references public.profiles (id),
  created_by                 text not null references public.profiles (id),
  created_at                 timestamptz not null,
  updated_at                 timestamptz,
  updated_by                 text,
  cancelled_at               timestamptz,
  cancelled_by               text,
  constraint group_activities_updated_pair check ((updated_at is null) = (updated_by is null)),
  constraint group_activities_cancelled_pair check ((cancelled_at is null) = (cancelled_by is null))
);
create index if not exists group_activities_contract_id_idx on public.group_activities (contract_id);
create index if not exists group_activities_responsible_id_idx on public.group_activities (responsible_id);
create index if not exists group_activities_created_by_idx on public.group_activities (created_by);
create index if not exists group_activities_starts_at_idx on public.group_activities (starts_at);

alter table public.group_activities enable row level security;
revoke all on public.group_activities from anon, authenticated;
grant all on public.group_activities to service_role;
-- Ingen delete: en gruppaktivitet ställs in, den raderas inte.
grant select, insert, update on public.group_activities to authenticated;

-- policy.ts group_activities.read
drop policy if exists group_activities_select on public.group_activities;
create policy group_activities_select on public.group_activities for select to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
-- policy.ts groupActivityWrite (ny rad)
drop policy if exists group_activities_insert on public.group_activities;
create policy group_activities_insert on public.group_activities for insert to authenticated with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and created_by = (select mm.current_profile_id())
  and updated_at is null and updated_by is null and cancelled_at is null and cancelled_by is null
);
-- policy.ts groupActivityWrite (ändring). Vilka kolumner som får ändras styr triggern nedan.
drop policy if exists group_activities_update on public.group_activities;
create policy group_activities_update on public.group_activities for update to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and cancelled_at is null
) with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- Kolumnskydd (policy.ts groupActivityWrite). Gäller inloggade (authenticated, anon); service role påverkas inte.
create or replace function mm.protect_group_activity_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  me text := mm.current_profile_id();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if to_jsonb(new) = to_jsonb(old) then
    raise exception 'Ändringen ändrar ingenting' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.contract_id is distinct from old.contract_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Avtal, skapare och tid kan inte ändras' using errcode = '42501';
  end if;
  if (new.updated_at is distinct from old.updated_at or new.updated_by is distinct from old.updated_by)
     and (new.updated_at is null or new.updated_by is distinct from me) then
    raise exception 'En ändring görs i eget namn' using errcode = '42501';
  end if;
  if (new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by)
     and (new.cancelled_at is null or new.cancelled_by is distinct from me) then
    raise exception 'En aktivitet ställs in i eget namn' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists group_activities_protect_columns on public.group_activities;
create trigger group_activities_protect_columns before update on public.group_activities
for each row execute function mm.protect_group_activity_columns();

-- ---------------------------------------------------------------- Deltagarnas tillfällen hör till gruppaktiviteten
alter table public.activities add column if not exists group_activity_id text references public.group_activities (id);
create index if not exists activities_group_activity_id_idx on public.activities (group_activity_id);
-- 4. En rad per deltagare och gruppaktivitet (UNIQUE_KEYS i src/data/schema.ts). Deltagarens egna tillfällen (null) omfattas inte.
create unique index if not exists activities_group_activity_case_key on public.activities (group_activity_id, case_id) where group_activity_id is not null;

-- ---------------------------------------------------------------- 2. Ett tillfälle utan närvaro kan tas bort
-- policy.ts activities.write (samma regel för insert, update och delete).
grant delete on public.activities to authenticated;
drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities for delete to authenticated using (mm.work_on(case_id));

-- ---------------------------------------------------------------- 3. Närvarons källa
alter table public.attendance add column if not exists source text not null default 'manual' check (source in ('manual', 'auto'));

-- policy.ts attendance.write: den som arbetar i ärendet, och bara manuell närvaro (auto skrivs bara av jobbet).
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated with check (mm.work_on(case_id) and source = 'manual');
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing,customer}'))
) with check (mm.work_on(case_id) and source = 'manual');
