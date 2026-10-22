-- 0035 Yrkesområden, fem nivåer och återkommande nivåaktiviteter (Karims beslut 2026-10-22).
--
-- "Grupperna ändras om till yrkesområdena, dem delas upp automatiskt i grupperna när dem blir anvisade inom sin kategori."
-- "Grupperna (yrkesområdena) bjuds in till större gruppaktiviteter en gång i månaden." "Nivå aktiviteterna sker 1-3 gånger i
-- veckan." "Fria grupper ska tas bort." "Fem nivåer, deltagare är i exakt en nivå åt gången."
--
-- 1. Fria grupper bort. Deltagarens grupp är ärendets yrkesområde (cases.primary_area_code, ett av avtalets avtalsområden A–L)
--    – ingen placering för hand. Gruppernas rader (groupings.kind = 'group') och medlemskap ligger kvar som historik (inget
--    raderas och kontrollen av kind ändras inte), men:
--      * alla aktiva grupper arkiveras och alla aktiva medlemskap i grupper avslutas av systemet (archived_by/removed_by =
--        'system', now()). Triggrarna från 0031 släpper igenom det: kolumnskyddet gäller bara inloggade, och kontrollen av
--        medlemskapet (avtal, typ och plats) stämmer för raderna. Körs migrationen igen finns inget aktivt kvar att ändra.
--      * triggrarna groupings_no_free_groups och grouping_members_no_free_groups nekar en ny aktiv grupp (också att återställa en
--        arkiverad) och ett nytt aktivt medlemskap i en grupp – för alla, också service role. Arkiverade grupper och avslutade
--        medlemskap (historik) kan fortfarande läsas in av systemet.
-- 2. Målgrupp på gruppaktiviteten. group_activities.audience: manual (inbjudna för hand), level (en nivå, audience_level_id)
--    eller area (ett yrkesområde, audience_area_code). Med en målgrupp bjuder servern in de aktiva deltagarna i målgruppen och
--    håller listan aktuell fram till aktiviteten (src/features/aktiviteter/audience-sync.ts). notify: deltagare som tillkommer
--    eller faller bort efter att aktiviteten skapats får meddelande (aktivitetsinbjudan, aktivitet_installd). series_id: tillfället
--    hör till en återkommande aktivitet (punkt 3) – unikt (series_id, starts_at), skapas bara av servern (inloggade skapar bara
--    rader utan series_id, och series_id ändras aldrig). Målgruppen kontrolleras för alla (triggern group_activities_audience):
--    nivån är en nivå i aktivitetens avtal, yrkesområdet ett avtalsområde i avtalet, serien hör till samma avtal.
--    activities.invite_source: manual (bjuden för hand – och alla tillfällen utanför gruppaktiviteter) eller audience (bjuden av
--    målgruppen). Den automatiska synkningen tar bara bort audience-rader – manuellt inbjudna rörs aldrig. Inloggade skapar bara
--    manual och ändrar aldrig källan (triggern activities_invite_source); audience skrivs bara av servern. Befintliga rader blir
--    manual.
-- 3. Återkommande aktivitet (group_activity_series): namn, typ, målgrupp (nivå eller yrkesområde – krävs), veckodagar (ISO 1–5,
--    minst en, stigande utan dubbletter), starttid (HH:MM), längd, plats, ansvarig coach, gruppmål, första och sista dag och om
--    deltagarna får meddelande. Tillfällena är vanliga gruppaktiviteter (series_id) som servern skapar från i dag och 14 dagar
--    framåt – aldrig på helgdagar och aldrig ett inställt tillfälle igen.
--    Behörighet (samma regler som src/data/policy.ts group_activity_series, och som group_activities i 0030):
--      * läsa: Miljonbemanning i avtalet utom ekonomen (samordnare, avtalsansvarig, coach, handledare, chef, admin). Kommunen och
--        ekonomen läser aldrig.
--      * skapa: de som arbetar i ärendena (samordnare, avtalsansvarig, coach, handledare), medlem i avtalet, i eget namn, varken
--        ändrad eller avslutad.
--      * ändra: samma roller, medlem, inte avslutad. Triggern: något måste ändras; avtal, skapare, typ, målgrupp, veckodagar,
--        tid, längd och första dag ändras aldrig (ny tid = avsluta serien och skapa en ny); ändrad och avslutad sätts parvis i
--        eget namn; sista dagen ändras bara när serien avslutas.
--      * ingen raderar (ingen delete-policy och ingen delete-rättighet) – en serie avslutas.
-- Allt är internt (som gruppaktiviteterna, nivåerna och gruppmålet): aldrig synligt för kommunen, i rapporter, resultatfil,
-- export eller faktura. Speglas i src/data/policy.ts (och UNIQUE_KEYS i src/data/schema.ts) och prövas i
-- src/data/supabase/rls-parity.test.ts och src/data/supabase/migration-0035.test.ts.
-- Inga destruktiva satser. Idempotent (if not exists, create or replace, drop … if exists) – tål att köras igen i SQL Editor.
-- Driftordning (docs/DRIFT.md): 0035 appliceras FÖRE koden – koden skriver de nya kolumnerna vid varje ny gruppaktivitet och
-- varje nytt tillfälle.
-- Befintliga objekt i produktionen som ersätts eller skrivs om: policyn group_activities_insert (0030:s villkor plus
-- series_id is null), funktionen mm.protect_group_activity_columns() (0030:s version plus series_id), och raderna i groupings
-- och grouping_members (fria grupper arkiveras, se 1). Inget raderas.
--
-- Lås: alter table och de nya triggrarna tar starka lås på heta tabeller (activities, group_activities, groupings,
-- grouping_members). Väntar en sats längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i stället för att alla
-- andra frågor (Min vecka, närvaron, jobben) köar bakom den – kör då filen igen, gärna utanför arbetstid. Inställningen gäller
-- bara den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- 1. Fria grupper bort
-- Medlemskapen först (historiken visar när de avslutades), sedan grupperna.
update public.grouping_members set removed_at = now(), removed_by = 'system' where kind = 'group' and removed_at is null;
update public.groupings set archived_at = now(), archived_by = 'system' where kind = 'group' and archived_at is null;

-- Nya aktiva grupper och medlemskap nekas för alla (också service role). Arkiverade och avslutade rader (historik) släpps igenom.
create or replace function mm.refuse_free_group() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if new.kind = 'group' and new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null) then
    raise exception 'Fria grupper finns inte längre – grupperna är yrkesområdena' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists groupings_no_free_groups on public.groupings;
create trigger groupings_no_free_groups before insert or update on public.groupings
for each row execute function mm.refuse_free_group();

create or replace function mm.refuse_free_group_member() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if new.kind = 'group' and new.removed_at is null and (tg_op = 'INSERT' or old.removed_at is not null) then
    raise exception 'Fria grupper finns inte längre – grupperna är yrkesområdena' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists grouping_members_no_free_groups on public.grouping_members;
create trigger grouping_members_no_free_groups before insert or update on public.grouping_members
for each row execute function mm.refuse_free_group_member();

-- ---------------------------------------------------------------- 3. Återkommande aktivitet (före kolumnerna som pekar på den)
-- Veckodagarna: ISO 1–5 (måndag–fredag), minst en, stigande utan dubbletter (src/core/group-series.ts seriesWeekdaysError).
create or replace function mm.series_weekdays_ok(p_days integer[]) returns boolean
language sql immutable set search_path = public, mm
as $$
  select p_days is not null
     and coalesce(cardinality(p_days), 0) between 1 and 5
     and not exists (select 1 from unnest(p_days) as d where d is null or d < 1 or d > 5)
     and p_days = array(select distinct d from unnest(p_days) as d order by d)
$$;
grant execute on function mm.series_weekdays_ok(integer[]) to authenticated, service_role;

create table if not exists public.group_activity_series (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  name                       text not null check (char_length(btrim(name)) between 1 and 120),
  kind                       text not null check (kind in ('yrkesmoment', 'arbetsgivarbesök', 'annat')),
  -- Målgruppen: en nivå eller ett yrkesområde (en återkommande aktivitet har alltid en målgrupp).
  audience                   text not null check (audience in ('level', 'area')),
  audience_level_id          text references public.groupings (id),
  audience_area_code         text,
  weekdays                   integer[] not null check (mm.series_weekdays_ok(weekdays)),
  start_time                 text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_min               integer not null check (duration_min between 1 and 720),
  location                   text not null check (char_length(location) <= 200),
  responsible_id             text references public.profiles (id),
  goal                       text check (goal is null or char_length(btrim(goal)) between 1 and 300),
  starts_on                  date not null,
  ends_on                    date,
  notify                     boolean not null default false,
  created_by                 text not null references public.profiles (id),
  created_at                 timestamptz not null,
  updated_at                 timestamptz,
  updated_by                 text,
  ended_at                   timestamptz,
  ended_by                   text,
  constraint group_activity_series_audience_shape check (
    (audience = 'level' and audience_level_id is not null and audience_area_code is null)
    or (audience = 'area' and audience_area_code is not null and audience_level_id is null)
  ),
  constraint group_activity_series_ends_after_start check (ends_on is null or ends_on >= starts_on),
  constraint group_activity_series_updated_pair check ((updated_at is null) = (updated_by is null)),
  constraint group_activity_series_ended_pair check ((ended_at is null) = (ended_by is null))
);
create index if not exists group_activity_series_contract_id_idx on public.group_activity_series (contract_id);
create index if not exists group_activity_series_audience_level_id_idx on public.group_activity_series (audience_level_id);
create index if not exists group_activity_series_responsible_id_idx on public.group_activity_series (responsible_id);
create index if not exists group_activity_series_created_by_idx on public.group_activity_series (created_by);

alter table public.group_activity_series enable row level security;
revoke all on public.group_activity_series from anon, authenticated;
grant all on public.group_activity_series to service_role;
-- Ingen delete: en återkommande aktivitet avslutas, den raderas inte.
grant select, insert, update on public.group_activity_series to authenticated;

-- policy.ts group_activity_series.read (samma som group_activities)
drop policy if exists group_activity_series_select on public.group_activity_series;
create policy group_activity_series_select on public.group_activity_series for select to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
-- policy.ts seriesWrite (ny rad)
drop policy if exists group_activity_series_insert on public.group_activity_series;
create policy group_activity_series_insert on public.group_activity_series for insert to authenticated with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and created_by = (select mm.current_profile_id())
  and updated_at is null and updated_by is null and ended_at is null and ended_by is null
);
-- policy.ts seriesWrite (ändring). Vilka kolumner som får ändras styr triggern nedan.
drop policy if exists group_activity_series_update on public.group_activity_series;
create policy group_activity_series_update on public.group_activity_series for update to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and ended_at is null
) with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- Kolumnskydd (policy.ts seriesWrite). Gäller inloggade (authenticated, anon); service role påverkas inte.
create or replace function mm.protect_group_activity_series_columns() returns trigger
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
     or new.created_at is distinct from old.created_at or new.kind is distinct from old.kind or new.audience is distinct from old.audience
     or new.audience_level_id is distinct from old.audience_level_id or new.audience_area_code is distinct from old.audience_area_code
     or new.weekdays is distinct from old.weekdays or new.start_time is distinct from old.start_time or new.duration_min is distinct from old.duration_min
     or new.starts_on is distinct from old.starts_on then
    raise exception 'Avtal, skapare, typ, målgrupp, dagar och tid ändras inte – avsluta serien och skapa en ny' using errcode = '42501';
  end if;
  if (new.updated_at is distinct from old.updated_at or new.updated_by is distinct from old.updated_by)
     and (new.updated_at is null or new.updated_by is distinct from me) then
    raise exception 'En ändring görs i eget namn' using errcode = '42501';
  end if;
  if (new.ended_at is distinct from old.ended_at or new.ended_by is distinct from old.ended_by)
     and (new.ended_at is null or new.ended_by is distinct from me) then
    raise exception 'En serie avslutas i eget namn' using errcode = '42501';
  end if;
  if new.ends_on is distinct from old.ends_on and new.ended_at is not distinct from old.ended_at then
    raise exception 'Sista dagen ändras bara när serien avslutas' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists group_activity_series_protect_columns on public.group_activity_series;
create trigger group_activity_series_protect_columns before update on public.group_activity_series
for each row execute function mm.protect_group_activity_series_columns();

-- ---------------------------------------------------------------- 2. Målgrupp och serie på gruppaktiviteten
alter table public.group_activities add column if not exists audience text not null default 'manual';
alter table public.group_activities add column if not exists audience_level_id text references public.groupings (id);
alter table public.group_activities add column if not exists audience_area_code text;
alter table public.group_activities add column if not exists series_id text references public.group_activity_series (id);
alter table public.group_activities add column if not exists notify boolean not null default false;
alter table public.group_activities drop constraint if exists group_activities_audience_shape;
alter table public.group_activities add constraint group_activities_audience_shape check (
  (audience = 'manual' and audience_level_id is null and audience_area_code is null)
  or (audience = 'level' and audience_level_id is not null and audience_area_code is null)
  or (audience = 'area' and audience_area_code is not null and audience_level_id is null)
);
create index if not exists group_activities_audience_level_id_idx on public.group_activities (audience_level_id);
-- Ett tillfälle per serie och starttid (UNIQUE_KEYS i src/data/schema.ts). Täcker också series_id (främmande nyckel).
create unique index if not exists group_activities_series_starts_key on public.group_activities (series_id, starts_at) where series_id is not null;

-- Målgruppen och serien hör till aktivitetens avtal (policy.ts audienceConsistent – gäller alla, också service role). Uppslagen görs
-- med den inloggades rättigheter: de som skriver gruppaktiviteter läser avtalets nivåer och avtalsområden.
create or replace function mm.check_group_audience() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if new.audience = 'level' and not exists (
    select 1 from public.groupings g where g.id = new.audience_level_id and g.kind = 'level' and g.contract_id = new.contract_id
  ) then
    raise exception 'Nivån ska vara en nivå i avtalet' using errcode = '23514';
  end if;
  if new.audience = 'area' and not exists (
    select 1 from public.contract_areas a where a.contract_id = new.contract_id and a.code = new.audience_area_code
  ) then
    raise exception 'Yrkesområdet ska vara ett avtalsområde i avtalet' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists group_activities_audience on public.group_activities;
create trigger group_activities_audience before insert or update on public.group_activities
for each row execute function mm.check_group_audience();
drop trigger if exists group_activity_series_audience on public.group_activity_series;
create trigger group_activity_series_audience before insert or update on public.group_activity_series
for each row execute function mm.check_group_audience();

-- Tillfället hör till seriens avtal (för alla).
create or replace function mm.check_group_activity_series() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if new.series_id is not null and not exists (
    select 1 from public.group_activity_series s where s.id = new.series_id and s.contract_id = new.contract_id
  ) then
    raise exception 'Tillfället ska höra till seriens avtal' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists group_activities_series on public.group_activities;
create trigger group_activities_series before insert or update on public.group_activities
for each row execute function mm.check_group_activity_series();

-- policy.ts groupActivityWrite (ny rad): som i 0030, och utan serie – tillfällena skapas bara av servern.
drop policy if exists group_activities_insert on public.group_activities;
create policy group_activities_insert on public.group_activities for insert to authenticated with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and created_by = (select mm.current_profile_id())
  and updated_at is null and updated_by is null and cancelled_at is null and cancelled_by is null
  and series_id is null
);

-- Kolumnskyddet från 0030, och serien ändras aldrig.
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
     or new.created_at is distinct from old.created_at or new.series_id is distinct from old.series_id then
    raise exception 'Avtal, skapare, tid och serie kan inte ändras' using errcode = '42501';
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

-- ---------------------------------------------------------------- 2b. Hur deltagaren bjöds in
alter table public.activities add column if not exists invite_source text not null default 'manual';
alter table public.activities drop constraint if exists activities_invite_source_check;
alter table public.activities add constraint activities_invite_source_check check (invite_source in ('manual', 'audience'));

-- policy.ts activities.write: inloggade skapar bara manual och ändrar aldrig källan. Service role (synkningen) påverkas inte.
create or replace function mm.protect_activity_invite_source() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' and new.invite_source is distinct from 'manual' then
    raise exception 'Bara servern bjuder in via målgruppen' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.invite_source is distinct from old.invite_source then
    raise exception 'Hur deltagaren bjöds in ändras inte' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists activities_invite_source on public.activities;
create trigger activities_invite_source before insert or update on public.activities
for each row execute function mm.protect_activity_invite_source();

reset lock_timeout;
reset statement_timeout;
