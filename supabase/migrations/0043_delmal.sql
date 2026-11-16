-- 0043 Delmål för progressionerna (Karims beslut 2026-11-11, SPEC §7.7 och §7.17).
--
-- Delmålen är konkreta steg inom progressionsområdena ("Har ett uppdaterat CV" under Beredskap för praktik, arbete eller studier).
-- Coacherna ser vad deltagaren tränar och har uppnått, och punkterna i incitamentsmodellens steg 1–2 räknas fram av de uppnådda
-- delmålen i stället för coachens checklista. Besluten:
--   * Katalogen per avtal ligger i databasen (inte i avtalskonfigurationen) – avtalsansvarig och systemadministratören ändrar listan
--     i appen: lägga till, byta namn, ordna, inaktivera och välja punkter i steg 1–2. Ett delmål tas aldrig bort.
--   * Tränar sätts AUTOMATISKT när närvaro (närvarande eller sen) registreras på ett tillfälle som tränar delmålet – märkt
--     automatiskt, idempotent, aldrig över Uppnått, loggat. Uppnått sätts BARA av en människa (coach, samordnare, avtalsansvarig) –
--     aldrig AI. Ångra: tillbaka till Tränar eller bort.
--   * Kommunen ser aldrig delmålen eller taggarna – inte i portalen, rapporter, resultatfil, export eller PDF. Redovisningsunderlaget
--     säger bara vilka punkter i modellen som är uppfyllda. Ekonomen läser dem inte heller.
--
-- 1. public.progress_goals – katalogen: avtalet, progressionsområdet (en av avtalets progression.areas, prövas när raden skapas),
--    namnet (1–120 tecken), ordningen, aktiv och punkterna i steg 1–2 (step_items, bara kända nycklar). Ändras aldrig: id, avtal,
--    område, skapare och skapad-tid. Ingen delete-rättighet för någon – ett delmål inaktiveras (active false) och står kvar där det
--    redan använts.
--      läsa:   Miljonbemanning i avtalet utom ekonomen (samordnare, avtalsansvarig, coach, handledare – vilande –, chef, admin).
--      skriva: avtalsansvarig och systemadministratören i avtalet, i eget namn (created_by, updated_by).
-- 2. public.case_progress_goals – läget per ärende och delmål (en rad, unik): training eller achieved, källan (auto eller manual),
--    dagen delmålet uppnåddes (bara achieved), underlaget (ett tillfälle, en mötesrapport eller en anteckning i ärendet – frivilligt),
--    vem och när. Ingen rad = Inte påbörjat.
--      läsa:   Miljonbemanning med åtkomst full eller team till ärendet (mm.case_ids('{full,team}')) – aldrig kommunen (customer)
--              eller ekonomen (billing).
--      skriva: den som arbetar i ärendet (mm.work_on), i eget namn och med källan manual. Tränar automatiskt skrivs bara av servern
--              (service role, källan auto, set_by 'system'). Ta bort (Ångra till Inte påbörjat): den som arbetar i ärendet.
--      för alla roller (triggern case_progress_goals_check): raden hör till ärendets avtal, delmålet till samma avtal, ett nytt läge
--              gäller ett aktivt delmål, och underlaget hör till ärendet.
-- 3. progress_goal_ids text[] not null default '{}' på public.activities (deltagarens egna tillfällen), public.group_activities och
--    public.group_activity_series (kopieras till tillfällena som jobbet skapar). För alla roller (triggrarna *_progress_goal_tags):
--    delmålen finns i avtalet (tillfällets ärendes avtal), inga dubbletter, och de som läggs till är aktiva – ett delmål som
--    inaktiverats får ligga kvar där det redan stod. Högst 20. Ett tillfälle i en gruppaktivitet har inga egna delmål (de står på
--    aktiviteten). Läs- och skrivreglerna för tabellerna är oförändrade (0005, 0030, 0035).
--
-- Speglas i src/data/policy.ts (progress_goals, case_progress_goals och guard på activities, group_activities och
-- group_activity_series), src/data/schema.ts (TABLE_NAMES, UNIQUE_KEYS) och scripts/db/columns.ts. Reglerna för hanterarna i
-- src/core/progress-goals.ts. Prövas i src/data/supabase/rls-parity.test.ts. Startlistan för Botkyrka läggs in för hand efter
-- migrationen: supabase/manual/2026-11-delmal-botkyrka.sql.
--
-- Inga destruktiva satser och inga befintliga rader, policyer eller rättigheter ändras – två nya tabeller med sina triggrar och
-- policyer, en ny kolumn på tre tabeller (standardvärdet '{}' – ingen omskrivning av tabellen) med kontroller och triggrar, och nya
-- funktioner i schemat mm. Idempotent (if not exists, or replace, drop … if exists) – tål att köras igen i SQL Editor.
--
-- Lås: kolumnerna, kontrollerna och triggrarna tar ett starkt lås en kort stund på public.activities (het tabell),
-- public.group_activities och public.group_activity_series. Kontrollerna läggs till som not valid och valideras sedan (svagare lås,
-- alla befintliga rader har den tomma listan). Väntar en sats längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i
-- stället för att alla andra frågor köar bakom den – kör då filen igen, gärna utanför arbetstid. Inställningen gäller bara den här
-- körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ================================================================ 1. Katalogen
create table if not exists public.progress_goals (
  id          text primary key,
  contract_id text not null references public.contracts (id),
  area_key    text not null,
  label       text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  step_items  text[] not null default '{}',
  created_by  text not null,
  created_at  timestamptz not null,
  updated_by  text,
  updated_at  timestamptz
);
alter table public.progress_goals drop constraint if exists progress_goals_label_length;
alter table public.progress_goals add constraint progress_goals_label_length check (char_length(btrim(label)) between 1 and 120);
alter table public.progress_goals drop constraint if exists progress_goals_area_key_format;
alter table public.progress_goals add constraint progress_goals_area_key_format check (area_key ~ '^[a-z][a-z_]*$');
alter table public.progress_goals drop constraint if exists progress_goals_sort_order_check;
alter table public.progress_goals add constraint progress_goals_sort_order_check check (sort_order >= 0);
-- Punkterna i steg 1–2 (STEP_ITEMS i src/data/schema.ts).
alter table public.progress_goals drop constraint if exists progress_goals_step_items_check;
alter table public.progress_goals add constraint progress_goals_step_items_check check (
  step_items <@ array['individuell_plan', 'ansokningshandlingar', 'branschintroduktion', 'arbetsgivarnara',
                      'praktik', 'validering', 'branschintyg', 'arbetsintervju', 'jobbspar', 'utbildning']::text[]
);
alter table public.progress_goals drop constraint if exists progress_goals_updated_pair;
alter table public.progress_goals add constraint progress_goals_updated_pair check ((updated_at is null) = (updated_by is null));
create index if not exists progress_goals_contract_id_idx on public.progress_goals (contract_id, area_key, sort_order);

alter table public.progress_goals enable row level security;
-- Ingen delete för någon: ett delmål inaktiveras. "Läs in testdata på nytt" tömmer tabellen med mm.reset_test_data (security
-- definer, truncate).
revoke all on public.progress_goals from anon, authenticated, service_role;
grant select, insert, update on public.progress_goals to service_role;
grant select, insert, update on public.progress_goals to authenticated;

-- policy.ts progress_goals.read: Miljonbemanning i avtalet utom ekonomen – aldrig kommunen.
drop policy if exists progress_goals_select on public.progress_goals;
create policy progress_goals_select on public.progress_goals for select to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
-- policy.ts progressGoalWrite: avtalsansvarig och systemadministratören i avtalet. Kolumnerna styr triggern nedan.
drop policy if exists progress_goals_insert on public.progress_goals;
create policy progress_goals_insert on public.progress_goals for insert to authenticated with check (
  (select mm.role_in(array['avtalsansvarig', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
drop policy if exists progress_goals_update on public.progress_goals;
create policy progress_goals_update on public.progress_goals for update to authenticated using (
  (select mm.role_in(array['avtalsansvarig', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  (select mm.role_in(array['avtalsansvarig', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- Området finns i avtalets progressionsområden (policy.ts progressGoalGuard). Security definer: den inloggade läser avtalet via
-- vyn contracts_public; funktionen svarar bara ja eller nej och ligger i schemat mm, som inte nås via API:t.
create or replace function mm.contract_has_progress_area(p_contract_id text, p_area_key text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select exists (
    select 1 from public.contracts c
    cross join lateral jsonb_array_elements_text(coalesce(c.config -> 'progression' -> 'areas', '[]'::jsonb)) a (key)
    where c.id = p_contract_id and a.key = p_area_key
  )
$$;
revoke all on function mm.contract_has_progress_area(text, text) from public, anon;
grant execute on function mm.contract_has_progress_area(text, text) to authenticated, service_role;

-- För alla roller: ett nytt delmål hör till ett av avtalets progressionsområden. För inloggade dessutom (policy.ts
-- progressGoalWrite): en ny rad i eget namn och utan ändrad-uppgifter; id, avtal, område, skapare och skapad-tid ändras aldrig;
-- ändrad i eget namn.
create or replace function mm.check_progress_goal() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  me text := mm.current_profile_id();
begin
  if tg_op = 'INSERT' and not mm.contract_has_progress_area(new.contract_id, new.area_key) then
    raise exception 'Området finns inte bland avtalets progressionsområden' using errcode = '23514';
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from me or new.updated_at is not null or new.updated_by is not null then
      raise exception 'Ett delmål läggs till i eget namn' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.contract_id is distinct from old.contract_id or new.area_key is distinct from old.area_key
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Avtal, område och skapare ändras inte' using errcode = '42501';
  end if;
  if (new.updated_at is distinct from old.updated_at or new.updated_by is distinct from old.updated_by)
     and (new.updated_at is null or new.updated_by is distinct from me) then
    raise exception 'En ändring görs i eget namn' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists progress_goals_check on public.progress_goals;
create trigger progress_goals_check before insert or update on public.progress_goals
for each row execute function mm.check_progress_goal();

-- ================================================================ 2. Läget per ärende
create table if not exists public.case_progress_goals (
  id            text primary key,
  case_id       text not null references public.cases (id),
  contract_id   text not null references public.contracts (id),
  goal_id       text not null references public.progress_goals (id),
  status        text not null,
  source        text not null,
  achieved_on   date,
  evidence_kind text,
  evidence_id   text,
  set_by        text not null,
  set_at        timestamptz not null
);
alter table public.case_progress_goals drop constraint if exists case_progress_goals_status_check;
alter table public.case_progress_goals add constraint case_progress_goals_status_check check (status in ('training', 'achieved'));
alter table public.case_progress_goals drop constraint if exists case_progress_goals_source_check;
alter table public.case_progress_goals add constraint case_progress_goals_source_check check (source in ('auto', 'manual'));
-- Dagen finns precis när delmålet är uppnått.
alter table public.case_progress_goals drop constraint if exists case_progress_goals_achieved_on_check;
alter table public.case_progress_goals add constraint case_progress_goals_achieved_on_check check ((status = 'achieved') = (achieved_on is not null));
alter table public.case_progress_goals drop constraint if exists case_progress_goals_evidence_check;
alter table public.case_progress_goals add constraint case_progress_goals_evidence_check check (
  (evidence_kind is null) = (evidence_id is null) and (evidence_kind is null or evidence_kind in ('activity', 'check_in', 'case_note'))
);
-- Ett läge per ärende och delmål (UNIQUE_KEYS i src/data/schema.ts). Täcker också case_id (främmande nyckel).
create unique index if not exists case_progress_goals_case_goal_key on public.case_progress_goals (case_id, goal_id);
create index if not exists case_progress_goals_contract_id_idx on public.case_progress_goals (contract_id);
create index if not exists case_progress_goals_goal_id_idx on public.case_progress_goals (goal_id);

alter table public.case_progress_goals enable row level security;
revoke all on public.case_progress_goals from anon, authenticated, service_role;
grant select, insert, update, delete on public.case_progress_goals to service_role;
grant select, insert, update, delete on public.case_progress_goals to authenticated;

-- policy.ts case_progress_goals.read: Miljonbemanning med åtkomst full eller team – aldrig kommunen och aldrig ekonomen.
drop policy if exists case_progress_goals_select on public.case_progress_goals;
create policy case_progress_goals_select on public.case_progress_goals for select to authenticated using (
  case_id in (select mm.case_ids('{full,team}'))
);
-- policy.ts caseGoalWrite: den som arbetar i ärendet, i avtalet. I eget namn och med källan manual – triggern nedan.
drop policy if exists case_progress_goals_insert on public.case_progress_goals;
create policy case_progress_goals_insert on public.case_progress_goals for insert to authenticated with check (
  mm.work_on(case_id) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
drop policy if exists case_progress_goals_update on public.case_progress_goals;
create policy case_progress_goals_update on public.case_progress_goals for update to authenticated using (
  mm.work_on(case_id)
) with check (
  mm.work_on(case_id) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
-- Ångra till Inte påbörjat: raden tas bort av den som arbetar i ärendet (loggas av hanteraren).
drop policy if exists case_progress_goals_delete on public.case_progress_goals;
create policy case_progress_goals_delete on public.case_progress_goals for delete to authenticated using (
  mm.work_on(case_id)
);

-- Raden stämmer (policy.ts caseGoalGuard): null när ärendet hör till avtalet, delmålet till samma avtal (och är aktivt vid en ny
-- rad) och underlaget hör till ärendet – annars vad som inte stämmer. Security definer: den inloggade läser bara id direkt i
-- public.cases (0013) och kanske inte underlaget. Svarar bara med en kod.
create or replace function mm.case_progress_goal_problem(
  p_case_id text, p_contract_id text, p_goal_id text, p_evidence_kind text, p_evidence_id text, p_new boolean
) returns text
language sql stable security definer set search_path = public, mm
as $$
  select case
    when (select c.contract_id from public.cases c where c.id = p_case_id) is distinct from p_contract_id then 'contract'
    when g.id is null or g.contract_id is distinct from p_contract_id then 'goal'
    when p_new and not g.active then 'inactive'
    when p_evidence_kind = 'activity' and not exists (select 1 from public.activities a where a.id = p_evidence_id and a.case_id = p_case_id) then 'evidence'
    when p_evidence_kind = 'check_in' and not exists (select 1 from public.check_ins x where x.id = p_evidence_id and x.case_id = p_case_id) then 'evidence'
    when p_evidence_kind = 'case_note' and not exists (select 1 from public.case_notes n where n.id = p_evidence_id and n.case_id = p_case_id) then 'evidence'
    else null
  end
  from (select 1) as one
  left join public.progress_goals g on g.id = p_goal_id
$$;
revoke all on function mm.case_progress_goal_problem(text, text, text, text, text, boolean) from public, anon;
grant execute on function mm.case_progress_goal_problem(text, text, text, text, text, boolean) to authenticated, service_role;

-- För alla roller: raden stämmer (ovan). För inloggade dessutom (policy.ts caseGoalWrite): en ny eller ändrad rad i eget namn och
-- med källan manual – Tränar automatiskt skrivs bara av servern; ärende, avtal och delmål ändras aldrig. En ändring som inte ändrar
-- något släpps igenom (som en borttagning prövas den bara av policyerna).
create or replace function mm.check_case_progress_goal() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  problem text;
begin
  problem := mm.case_progress_goal_problem(new.case_id, new.contract_id, new.goal_id, new.evidence_kind, new.evidence_id, tg_op = 'INSERT');
  if problem = 'contract' or problem = 'goal' then
    raise exception 'Delmålet ska höra till ärendets avtal' using errcode = '23514';
  elsif problem = 'inactive' then
    raise exception 'Delmålet är inaktiverat' using errcode = '23514';
  elsif problem = 'evidence' then
    raise exception 'Underlaget ska höra till ärendet' using errcode = '23514';
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if to_jsonb(new) = to_jsonb(old) then
      return new;
    end if;
    if new.case_id is distinct from old.case_id or new.contract_id is distinct from old.contract_id or new.goal_id is distinct from old.goal_id then
      raise exception 'Ärende, avtal och delmål ändras inte' using errcode = '42501';
    end if;
  end if;
  if new.set_by is distinct from mm.current_profile_id() or new.source is distinct from 'manual' then
    raise exception 'Delmålets läge sätts i eget namn – det automatiska sätts bara av systemet' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists case_progress_goals_check on public.case_progress_goals;
create trigger case_progress_goals_check before insert or update on public.case_progress_goals
for each row execute function mm.check_case_progress_goal();

-- ================================================================ 3. Delmålen på tillfällena
alter table public.activities add column if not exists progress_goal_ids text[] not null default '{}';
alter table public.group_activities add column if not exists progress_goal_ids text[] not null default '{}';
alter table public.group_activity_series add column if not exists progress_goal_ids text[] not null default '{}';
comment on column public.activities.progress_goal_ids is
  'Delmålen (progress_goals.id) som deltagarens eget tillfälle tränar. Tom för ett tillfälle i en gruppaktivitet – delmålen står på aktiviteten. Internt.';
comment on column public.group_activities.progress_goal_ids is 'Delmålen (progress_goals.id) som aktiviteten tränar. Internt.';
comment on column public.group_activity_series.progress_goal_ids is 'Delmålen (progress_goals.id) som varje tillfälle tränar – kopieras till tillfällena. Internt.';

-- Högst 20, och ett tillfälle i en gruppaktivitet har inga egna delmål. Not valid + validate: svagare lås när raderna prövas.
alter table public.activities drop constraint if exists activities_progress_goal_ids_check;
alter table public.activities add constraint activities_progress_goal_ids_check check (
  cardinality(progress_goal_ids) <= 20 and (group_activity_id is null or cardinality(progress_goal_ids) = 0)
) not valid;
alter table public.activities validate constraint activities_progress_goal_ids_check;
alter table public.group_activities drop constraint if exists group_activities_progress_goal_ids_check;
alter table public.group_activities add constraint group_activities_progress_goal_ids_check check (cardinality(progress_goal_ids) <= 20) not valid;
alter table public.group_activities validate constraint group_activities_progress_goal_ids_check;
alter table public.group_activity_series drop constraint if exists group_activity_series_progress_goal_ids_check;
alter table public.group_activity_series add constraint group_activity_series_progress_goal_ids_check check (cardinality(progress_goal_ids) <= 20) not valid;
alter table public.group_activity_series validate constraint group_activity_series_progress_goal_ids_check;

-- Taggarna stämmer (policy.ts goalTagsOk): null när alla delmål finns i avtalet, ingen står två gånger och de som läggs till (inte
-- fanns i p_old) är aktiva – annars vad som inte stämmer. Security definer: katalogen läses oavsett vem som skriver.
create or replace function mm.progress_goal_tags_problem(p_contract_id text, p_new text[], p_old text[]) returns text
language sql stable security definer set search_path = public, mm
as $$
  select case
    when p_new is null then 'null'
    when cardinality(p_new) <> (select count(distinct x) from unnest(p_new) as u (x)) then 'duplicate'
    when exists (
      select 1 from unnest(p_new) as u (x)
      where not exists (select 1 from public.progress_goals g where g.id = u.x and g.contract_id = p_contract_id)
    ) then 'contract'
    when exists (
      select 1 from unnest(p_new) as u (x) join public.progress_goals g on g.id = u.x
      where not g.active and not (u.x = any (coalesce(p_old, '{}'::text[])))
    ) then 'inactive'
    else null
  end
$$;
revoke all on function mm.progress_goal_tags_problem(text, text[], text[]) from public, anon;
grant execute on function mm.progress_goal_tags_problem(text, text[], text[]) to authenticated, service_role;

create or replace function mm.raise_progress_goal_tags(problem text) returns void
language plpgsql set search_path = public, mm
as $$
begin
  if problem = 'duplicate' then
    raise exception 'Samma delmål står två gånger' using errcode = '23514';
  elsif problem = 'inactive' then
    raise exception 'Ett inaktiverat delmål kan inte väljas' using errcode = '23514';
  elsif problem is not null then
    raise exception 'Delmålen ska höra till avtalet' using errcode = '23514';
  end if;
end
$$;
revoke all on function mm.raise_progress_goal_tags(text) from public, anon;
grant execute on function mm.raise_progress_goal_tags(text) to authenticated, service_role;

-- Deltagarens tillfällen: avtalet är ärendets (mm.case_contract_id, 0019). För alla roller.
create or replace function mm.check_activity_progress_goal_tags() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if tg_op = 'UPDATE' and new.progress_goal_ids is not distinct from old.progress_goal_ids then
    return new;
  end if;
  if cardinality(coalesce(new.progress_goal_ids, '{}'::text[])) = 0 then
    return new;
  end if;
  perform mm.raise_progress_goal_tags(mm.progress_goal_tags_problem(
    mm.case_contract_id(new.case_id), new.progress_goal_ids, case when tg_op = 'UPDATE' then old.progress_goal_ids else '{}'::text[] end
  ));
  return new;
end
$$;
drop trigger if exists activities_progress_goal_tags on public.activities;
create trigger activities_progress_goal_tags before insert or update of progress_goal_ids on public.activities
for each row execute function mm.check_activity_progress_goal_tags();

-- Gruppaktiviteter och återkommande aktiviteter: avtalet står på raden. För alla roller.
create or replace function mm.check_group_progress_goal_tags() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if tg_op = 'UPDATE' and new.progress_goal_ids is not distinct from old.progress_goal_ids then
    return new;
  end if;
  if cardinality(coalesce(new.progress_goal_ids, '{}'::text[])) = 0 then
    return new;
  end if;
  perform mm.raise_progress_goal_tags(mm.progress_goal_tags_problem(
    new.contract_id, new.progress_goal_ids, case when tg_op = 'UPDATE' then old.progress_goal_ids else '{}'::text[] end
  ));
  return new;
end
$$;
drop trigger if exists group_activities_progress_goal_tags on public.group_activities;
create trigger group_activities_progress_goal_tags before insert or update of progress_goal_ids on public.group_activities
for each row execute function mm.check_group_progress_goal_tags();
drop trigger if exists group_activity_series_progress_goal_tags on public.group_activity_series;
create trigger group_activity_series_progress_goal_tags before insert or update of progress_goal_ids on public.group_activity_series
for each row execute function mm.check_group_progress_goal_tags();

reset lock_timeout;
reset statement_timeout;
