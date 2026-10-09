-- 0031 Grupper, nivåer och taggar (coachmötet 2026-10-09, Karims beslut 3).
--
-- "Adam kartlägger och lägger in dem i grupper." "Fem grupper efter nivå, kunna filtrera på det också." "Vi behöver taggar
-- som visar hur mycket de vill arbeta." Grupper, nivåer och taggar sätts av en människa – AI placerar aldrig någon i en
-- grupp eller nivå och bedömer aldrig motivation. Allt är internt: aldrig synligt för kommunen, i rapporter, resultatfilen,
-- exporter, fakturor eller i underlaget till AI (src/features/_shared/ai-port.ts har inga sådana fält).
--
-- Tabellerna:
--   groupings         en nivå, grupp eller tagg i ett avtal (kind 'level' | 'group' | 'tag'; taggar har en kategori, t.ex.
--                     "Vill arbeta"). Namn, beskrivning, sorteringsordning. Arkiveras – raderas aldrig.
--   grouping_members  ett ärendes plats på en nivå, i en grupp eller med en tagg (vem som lade till och när, borttagen när).
--                     kind och slot är denormaliserade från grupperingen: slot = 'level' för nivån, 'tag:<kategori>' för en
--                     tagg och null för grupper. Partiellt unikt index (case_id, slot) där removed_at är null: högst en aktiv
--                     nivå och högst ett aktivt värde per taggkategori per ärende. Samma gruppering bara en gång per ärende.
--
-- Samma regler som src/data/policy.ts (groupings, grouping_members), UNIQUE_KEYS i src/data/schema.ts och src/core/groupings.ts:
--   * groupings läses av alla Miljonbemannings roller i avtalet utom ekonomen (samordnare, avtalsansvarig, coach, handledare,
--     chef, admin). Kommunen och ekonomen ser inget.
--   * groupings skrivs av samordnare, avtalsansvarig, coach och admin i avtalet – ny rad i eget namn, varken ändrad eller
--     arkiverad; ändring i eget namn (updated_*), arkivering och återställning i eget namn (archived_*). Avtal, typ, kategori
--     och skapad ändras aldrig (medlemskapens slot bygger på typ och kategori). Ingen raderar.
--   * grouping_members läses som anteckningar (mm.can_see_notes: full eller team, aldrig ekonom eller kommunen).
--   * grouping_members skrivs av samordnare, avtalsansvarig, coach och admin med full åtkomst till ärendet – ny rad i eget
--     namn (added_by) och aktiv; ändring bara att ta bort (removed_at och removed_by, i eget namn, en gång). Ingen raderar.
--   * för alla (även service role): medlemskapets avtal = ärendets avtal = grupperingens avtal, typ och slot stämmer med
--     grupperingen, och en arkiverad gruppering kan inte få nya aktiva medlemmar.
-- Revisionsloggen (ctx.audit i src/features/grupper/handlers.ts) får bara id:n – aldrig namnen.
-- Standardvärden för befintliga avtal: fem nivåer och taggkategorin "Vill arbeta" (Heltid, Deltid, Vet inte än). Inga
-- standardgrupper – grupperna skapas fritt av MB. Id:na är desamma som i testdatat (src/core/groupings.ts).
--
-- Idempotent (if not exists, create or replace, drop … if exists, on conflict do nothing). Inga destruktiva satser. Kan
-- köras i SQL Editor. "Läs in testdata på nytt" (mm.reset_test_data) tömmer tabellerna som andra tabeller.

-- ---------------------------------------------------------------- Tabellerna
create table if not exists public.groupings (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  kind                       text not null check (kind in ('level', 'group', 'tag')),
  -- Taggens kategori (bara taggar), t.ex. 'Vill arbeta'.
  category                   text check (category is null or char_length(btrim(category)) between 1 and 60),
  name                       text not null check (char_length(btrim(name)) between 1 and 80),
  description                text not null check (char_length(description) <= 300),
  sort_order                 integer not null,
  created_at                 timestamptz not null,
  -- Null för standardvärdena som den här migrationen lade in.
  created_by                 text,
  updated_at                 timestamptz,
  updated_by                 text,
  archived_at                timestamptz,
  archived_by                text,
  constraint groupings_category_only_tags check ((kind = 'tag') = (category is not null)),
  constraint groupings_updated_pair check ((updated_at is null) = (updated_by is null)),
  constraint groupings_archived_pair check ((archived_at is null) = (archived_by is null))
);
create index if not exists groupings_contract_id_idx on public.groupings (contract_id, kind, sort_order);

create table if not exists public.grouping_members (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  case_id                    text not null references public.cases (id),
  grouping_id                text not null references public.groupings (id),
  -- Grupperingens typ och plats (denormaliserade – kontrolleras av triggern mot grupperingen).
  kind                       text not null check (kind in ('level', 'group', 'tag')),
  slot                       text,
  added_at                   timestamptz not null,
  added_by                   text not null,
  removed_at                 timestamptz,
  removed_by                 text,
  constraint grouping_members_removed_pair check ((removed_at is null) = (removed_by is null)),
  constraint grouping_members_slot_kind check (
    case kind when 'level' then slot = 'level' when 'tag' then slot like 'tag:_%' else slot is null end
  )
);
create index if not exists grouping_members_contract_id_idx on public.grouping_members (contract_id);
create index if not exists grouping_members_case_id_idx on public.grouping_members (case_id);
create index if not exists grouping_members_grouping_id_idx on public.grouping_members (grouping_id);
-- Högst en aktiv nivå och högst ett aktivt värde per taggkategori per ärende (UNIQUE_KEYS i src/data/schema.ts).
create unique index if not exists grouping_members_one_per_slot on public.grouping_members (case_id, slot) where removed_at is null and slot is not null;
-- Samma nivå, grupp eller tagg bara en gång per ärende.
create unique index if not exists grouping_members_active_once on public.grouping_members (case_id, grouping_id) where removed_at is null;

alter table public.groupings enable row level security;
alter table public.grouping_members enable row level security;
revoke all on public.groupings, public.grouping_members from anon, authenticated;
grant all on public.groupings, public.grouping_members to service_role;
-- Ingen delete: inget raderas av användare (grupperingar arkiveras, medlemskap får removed_at).
grant select, insert, update on public.groupings, public.grouping_members to authenticated;

-- ---------------------------------------------------------------- Uppslag
-- src/core/groupings.ts slotOf: 'level', 'tag:<kategori>' eller null (grupp).
create or replace function mm.grouping_slot(p_kind text, p_category text) returns text
language sql immutable set search_path = public, mm
as $$ select case p_kind when 'level' then 'level' when 'tag' then 'tag:' || p_category else null end $$;
grant execute on function mm.grouping_slot(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- Policyer: groupings
-- policy.ts groupings.read: GROUPING_READERS i avtalet (admin: alla avtal).
drop policy if exists groupings_select on public.groupings;
create policy groupings_select on public.groupings for select to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
-- policy.ts groupingWrite (ny rad): GROUPING_WRITERS i avtalet, i eget namn. Ändrad och arkiverad kontrolleras av triggern.
drop policy if exists groupings_insert on public.groupings;
create policy groupings_insert on public.groupings for insert to authenticated with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and created_by = (select mm.current_profile_id())
);
-- policy.ts groupingWrite (ändring). Vilka kolumner som får ändras styr triggern.
drop policy if exists groupings_update on public.groupings;
create policy groupings_update on public.groupings for update to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- ---------------------------------------------------------------- Policyer: grouping_members
-- policy.ts grouping_members.read: notesRead(caseId) – full eller team, aldrig ekonom eller kommunen.
drop policy if exists grouping_members_select on public.grouping_members;
create policy grouping_members_select on public.grouping_members for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom'
  and case_id in (select mm.case_ids('{full,team}'))
);
-- policy.ts groupingMemberWrite (ny rad): GROUPING_WRITERS med full åtkomst till ärendet, i eget namn.
drop policy if exists grouping_members_insert on public.grouping_members;
create policy grouping_members_insert on public.grouping_members for insert to authenticated with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'admin']))
  and mm.case_access(case_id) = 'full'
  and added_by = (select mm.current_profile_id())
);
-- policy.ts groupingMemberWrite (ändring): bara ta bort – kolumnerna styr triggern.
drop policy if exists grouping_members_update on public.grouping_members;
create policy grouping_members_update on public.grouping_members for update to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'admin']))
  and mm.case_access(case_id) = 'full'
) with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'admin']))
  and mm.case_access(case_id) = 'full'
);

-- ---------------------------------------------------------------- Kolumnskydd: groupings
-- policy.ts groupingWrite. Gäller inloggade (authenticated, anon); service role (migrationen, testdatat) påverkas inte.
--   ny rad:   varken ändrad eller arkiverad
--   ändring:  något måste ändras (som policy.ts, där regeln också stoppar MemoryRepo.remove()); id, avtal, typ, kategori och
--             skapad ändras aldrig; updated_* sätts parvis och i eget namn; archived_* sätts i eget namn eller töms båda
--             (återställ).
create or replace function mm.protect_grouping_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  me text := mm.current_profile_id();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.updated_at is not null or new.updated_by is not null or new.archived_at is not null or new.archived_by is not null then
      raise exception 'En ny gruppering kan inte vara ändrad eller arkiverad' using errcode = '42501';
    end if;
    return new;
  end if;
  if to_jsonb(new) = to_jsonb(old) then
    raise exception 'Ändringen ändrar ingenting' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.contract_id is distinct from old.contract_id or new.kind is distinct from old.kind
     or new.category is distinct from old.category or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Avtal, typ, kategori och skapad kan inte ändras' using errcode = '42501';
  end if;
  if (new.updated_at is distinct from old.updated_at or new.updated_by is distinct from old.updated_by)
     and (new.updated_at is null or new.updated_by is distinct from me) then
    raise exception 'En ändring görs i eget namn' using errcode = '42501';
  end if;
  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and new.archived_at is not null and new.archived_by is distinct from me then
    raise exception 'En gruppering arkiveras i eget namn' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists groupings_protect_columns on public.groupings;
create trigger groupings_protect_columns before insert or update on public.groupings
for each row execute function mm.protect_grouping_columns();

-- ---------------------------------------------------------------- Kontroller: grouping_members
-- För alla (även service role): avtalet, typen och platsen stämmer med grupperingen och ärendet, och en arkiverad
-- gruppering får inga nya medlemmar. För inloggade dessutom kolumnskyddet (policy.ts groupingMemberWrite):
--   ny rad:   aktiv (removed_at och removed_by null)
--   ändring:  bara removed_at och removed_by, satta tillsammans i eget namn, och bara på ett aktivt medlemskap
-- Ingen security definer: grupperingen läses med den inloggades behörighet (den som skriver läser avtalets grupperingar;
-- en gruppering i ett annat avtal finns inte för hen), ärendets avtal med mm.case_contract_id (0019).
create or replace function mm.check_grouping_member() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  g public.groupings%rowtype;
  me text;
begin
  select * into g from public.groupings where id = new.grouping_id;
  if not found or g.contract_id is distinct from new.contract_id or mm.case_contract_id(new.case_id) is distinct from new.contract_id then
    raise exception 'Medlemskapet ska höra till ärendets och grupperingens avtal' using errcode = '23514';
  end if;
  if new.kind is distinct from g.kind or new.slot is distinct from mm.grouping_slot(g.kind, g.category) then
    raise exception 'Typ och plats ska vara grupperingens' using errcode = '23514';
  end if;
  -- Ett nytt aktivt medlemskap – ett redan borttaget (historik som läses in av systemet) får peka på en arkiverad.
  if tg_op = 'INSERT' and g.archived_at is not null and new.removed_at is null then
    raise exception 'En arkiverad gruppering kan inte väljas' using errcode = '23514';
  end if;
  -- Kolumnskyddet gäller inloggade (authenticated, anon); service role (systemsteg) påverkas inte.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  me := mm.current_profile_id();
  if tg_op = 'INSERT' then
    if new.removed_at is not null or new.removed_by is not null then
      raise exception 'Ett nytt medlemskap kan inte vara borttaget' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.removed_at is not null then
    raise exception 'Ett borttaget medlemskap kan inte ändras' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['removed_at', 'removed_by']) is distinct from (to_jsonb(old) - array['removed_at', 'removed_by'])
     or new.removed_at is null or new.removed_by is distinct from me then
    raise exception 'Ett medlemskap tas bara bort, i eget namn' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists grouping_members_check on public.grouping_members;
create trigger grouping_members_check before insert or update on public.grouping_members
for each row execute function mm.check_grouping_member();

-- ---------------------------------------------------------------- Standardvärden för befintliga avtal
-- Samma id och värden som defaultGroupings i src/core/groupings.ts (testdatat).
insert into public.groupings (id, contract_id, kind, category, name, description, sort_order, created_at, created_by, updated_at, updated_by, archived_at, archived_by)
select 'grp-' || c.id || '-niva-' || l.n, c.id, 'level', null, l.name, '', l.n, now(), null, null, null, null, null
from public.contracts c
cross join (values
  (1, 'Nivå 1 – Långt från arbete'),
  (2, 'Nivå 2 – Behöver stöd för att komma igång'),
  (3, 'Nivå 3 – På väg'),
  (4, 'Nivå 4 – Nära arbete'),
  (5, 'Nivå 5 – Redo för arbete')
) as l (n, name)
on conflict (id) do nothing;

insert into public.groupings (id, contract_id, kind, category, name, description, sort_order, created_at, created_by, updated_at, updated_by, archived_at, archived_by)
select 'grp-' || c.id || '-vill-arbeta-' || t.slug, c.id, 'tag', 'Vill arbeta', t.name, '', t.n, now(), null, null, null, null, null
from public.contracts c
cross join (values (1, 'heltid', 'Heltid'), (2, 'deltid', 'Deltid'), (3, 'vet-inte-an', 'Vet inte än')) as t (n, slug, name)
on conflict (id) do nothing;
