-- 0027 Rollväxling för egna roller (beslut Karim 2026-10-08, skarp drift).
--
-- Kollegorna är vanliga användare med en eller flera roller (memberships är unik per användare, avtal och roll). Den som har
-- flera roller väljer roll i sidopanelens huvud. Valet sparas här – inte bara i en kaka – och styr mm.current_role(), så att
-- servern (public.current_actor()) och RLS alltid ser samma roll. Samma regler i src/data/policy.ts (role_choices) och
-- src/data/actors.ts (defaultRoleFor/actorFor); pariteten kontrolleras i src/data/supabase/rls-parity.test.ts.
--
--   mm.current_role() = coalesce(testpersonens roll            (tester_sessions – bara testare i testmiljön, som förut),
--                                den valda rollen              (role_choices – bara om ett medlemskap med rollen finns),
--                                medlemskapet med lägst id)    (som förut)
--   mm.my_contract_ids(), mm.current_unit(), mm.is_mb() … bygger på mm.current_role() och följer med utan ändring.
--
-- Tabellen: en rad per användare. id är samma som user_id (Repo-konventionen: varje tabell har kolumnen id som nyckel).
-- Raden tas bort med profilen. Bara den egna raden får läsas och skrivas, och bara till en roll man har medlemskap för.
-- Hanteraren (session.vaxlaRoll) skriver raden via användarens klient (RLS) och loggar role.switched (bara id och roll).
-- "Läs in testdata på nytt" (mm.reset_test_data, 0010/0017) tömmer tabellen som andra tabeller – ett val görs om i appen.
--
-- Idempotent: kan köras igen utan fel. Inga concurrently. Körs av Karim i Supabase → SQL Editor.

-- ---------------------------------------------------------------- Tabellen
create table if not exists public.role_choices (
  id                         text primary key,
  user_id                    text not null unique references public.profiles (id) on delete cascade,
  role                       text not null check (role = any (mm.supplier_roles() || mm.customer_roles())),
  chosen_at                  timestamptz not null,
  constraint role_choices_id_is_user_id check (id = user_id)
);

alter table public.role_choices enable row level security;
revoke all on public.role_choices from anon, authenticated;
grant all on public.role_choices to service_role;
grant select, insert, update, delete on public.role_choices to authenticated;

-- ---------------------------------------------------------------- Har användaren rollen? (utan RLS – memberships läses ändå av en själv)
create or replace function mm.has_membership_role(p_user_id text, p_role text) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select exists (select 1 from public.memberships m where m.user_id = p_user_id and m.role = p_role) $$;
revoke all on function mm.has_membership_role(text, text) from public, anon;
grant execute on function mm.has_membership_role(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- Policyer: bara den egna raden
-- policy.ts role_choices.read: self(userId)
drop policy if exists role_choices_select on public.role_choices;
create policy role_choices_select on public.role_choices for select to authenticated using (
  user_id = (select mm.current_profile_id())
);
-- policy.ts role_choices.write: self(userId) && id = userId && medlemskap med rollen finns
drop policy if exists role_choices_insert on public.role_choices;
create policy role_choices_insert on public.role_choices for insert to authenticated with check (
  user_id = (select mm.current_profile_id()) and id = user_id and mm.has_membership_role(user_id, role)
);
drop policy if exists role_choices_update on public.role_choices;
create policy role_choices_update on public.role_choices for update to authenticated using (
  user_id = (select mm.current_profile_id())
) with check (
  user_id = (select mm.current_profile_id()) and id = user_id and mm.has_membership_role(user_id, role)
);
drop policy if exists role_choices_delete on public.role_choices;
create policy role_choices_delete on public.role_choices for delete to authenticated using (
  user_id = (select mm.current_profile_id())
);

-- ---------------------------------------------------------------- Medlemskap tas bort (Ändra roller)
-- 0002 gav bara select, insert och update på memberships. Administratören tar bort roller i appen (admin.setStaffRoles):
-- samma regel som policy.ts memberships.write – admin alla, avtalsansvarig bara kommunens roller i sina avtal.
grant delete on public.memberships to authenticated;
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete to authenticated using (
  (select mm.current_role()) = 'admin'
  or ((select mm.current_role()) = 'avtalsansvarig'
      and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and role = any (mm.customer_roles()))
);

-- ---------------------------------------------------------------- Aktörens roll
-- Testpersonens valda roll (bara testmiljön), annars den valda rollen om medlemskapet finns, annars medlemskapet med lägst id.
-- Null = ingen roll. Samma regel som defaultRoleFor i src/data/actors.ts.
create or replace function mm.current_role() returns text
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(
    (select s.role from mm.tester_session() s),
    (select rc.role from public.role_choices rc
      where rc.user_id = mm.auth_profile_id()
        and exists (select 1 from public.memberships m where m.user_id = rc.user_id and m.role = rc.role)),
    (select m.role from public.memberships m where m.user_id = mm.auth_profile_id() order by m.id limit 1)
  )
$$;
