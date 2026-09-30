-- 0002 Användare: profiler, roller per avtal, testmiljöns inställningar och testare, inloggningsförsök.
-- Hjälpfunktionerna för inloggad användare (mm.current_profile_id, mm.current_role …) och policyerna för 0001–0002.

-- ---------------------------------------------------------------- Profiler (MB-personal och kommunanvändare)
-- auth_user_id kopplas till auth.users vid första inloggningen (via e-postadressen). Ingen främmande nyckel:
-- seedens påhittade profiler har deterministiska id:n (uuid v5) utan konto i auth.users, så att RLS-testerna kan agera som dem.
create table public.profiles (
  id                         text primary key,
  organization_id            text not null references public.organizations (id),
  full_name                  text not null,
  email                      text not null,
  phone                      text not null,
  title                      text not null,
  active                     boolean not null,
  last_login_at              timestamptz,
  customer_unit              text,
  buyer_reference_id         text,
  team_role                  text,
  invited_at                 timestamptz,
  invited_by                 text,
  auth_user_id               uuid unique,
  is_tester                  boolean not null default false,
  constraint profiles_email_lowercase check (email = lower(email))
);
create unique index profiles_email_key on public.profiles (email) where email <> '';
create index profiles_organization_id_idx on public.profiles (organization_id);

-- Roll per avtal (SPEC §4).
create table public.memberships (
  id                         text primary key,
  user_id                    text not null references public.profiles (id),
  contract_id                text not null references public.contracts (id),
  role                       text not null check (role = any (mm.supplier_roles() || mm.customer_roles())),
  customer_unit              text,
  unique (user_id, contract_id, role)
);
create index memberships_contract_id_idx on public.memberships (contract_id);

-- ---------------------------------------------------------------- Drift: miljö, testklocka, testare, inloggningsförsök
-- Nycklar: environment ('staging' i testmiljön, 'production' i produktion), clock_real_epoch (ISO-tid när seeden lästes in),
-- clock_demo_epoch (testtiden då, '2027-02-01T09:12'). Bara service role läser och skriver.
create table public.app_settings (
  key                        text primary key,
  value                      text not null
);

-- Testarens valda testperson (bara testmiljön). profile_id = 'deltagare' för deltagaren (pulslänken har ingen profil).
create table public.tester_sessions (
  auth_user_id               uuid primary key references auth.users (id) on delete cascade,
  profile_id                 text not null,
  role                       text not null check (role = any (mm.all_roles())),
  updated_at                 timestamptz not null default now()
);

-- Hastighetsbegränsning för inloggning med e-postkod. Bara hashade värden – aldrig adressen eller IP-numret i klartext.
create table public.login_attempts (
  id                         bigint generated always as identity primary key,
  email_hash                 text not null,
  ip_hash                    text,
  attempted_at               timestamptz not null default now(),
  kind                       text not null
);
create index login_attempts_email_idx on public.login_attempts (email_hash, attempted_at);
create index login_attempts_ip_idx on public.login_attempts (ip_hash, attempted_at);

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.app_settings enable row level security;
alter table public.tester_sessions enable row level security;
alter table public.login_attempts enable row level security;
revoke all on public.profiles, public.memberships, public.app_settings, public.tester_sessions, public.login_attempts from anon, authenticated;
grant all on public.profiles, public.memberships, public.app_settings, public.tester_sessions, public.login_attempts to service_role;
grant usage on sequence public.login_attempts_id_seq to service_role;

-- ---------------------------------------------------------------- Inloggad användare (security definer: läser utan RLS)
-- Miljön: 'staging' i testmiljön. Null i en databas utan inställningen.
create function mm.environment() returns text
language sql stable security definer set search_path = public, mm
as $$ select value from public.app_settings where key = 'environment' $$;

-- Den inloggade användarens egen profil (aktiv profil med auth_user_id = auth.uid()).
create function mm.auth_profile_id() returns text
language sql stable security definer set search_path = public, mm
as $$ select p.id from public.profiles p where p.auth_user_id = auth.uid() and p.active $$;

-- Är den inloggade en testare i testmiljön? I produktion (environment <> 'staging') alltid falskt.
create function mm.auth_is_tester() returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(mm.environment() = 'staging', false)
     and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.active and p.is_tester)
$$;

-- Testarens valda testperson – bara i testmiljön, bara för testare och bara en roll som personen faktiskt har
-- (eller deltagaren). Annars ingen rad, och användaren agerar som sig själv.
create function mm.tester_session() returns table (profile_id text, role text)
language sql stable security definer set search_path = public, mm
as $$
  select ts.profile_id, ts.role
  from public.tester_sessions ts
  where ts.auth_user_id = auth.uid()
    and mm.auth_is_tester()
    and ((ts.profile_id = 'deltagare' and ts.role = 'deltagare')
         or exists (select 1 from public.memberships m where m.user_id = ts.profile_id and m.role = ts.role))
$$;

-- Aktörens profil-id (Actor.userId): testpersonen om testaren valt en, annars den egna profilen.
create function mm.current_profile_id() returns text
language sql stable security definer set search_path = public, mm
as $$ select coalesce((select s.profile_id from mm.tester_session() s), mm.auth_profile_id()) $$;

-- Aktörens roll (Actor.role): testpersonens valda roll, annars den egna rollen. Har användaren flera roller används
-- medlemskapet med lägst id (src/data/actors.ts actorFor tar det första medlemskapet). Null = ingen roll.
create function mm.current_role() returns text
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(
    (select s.role from mm.tester_session() s),
    (select m.role from public.memberships m where m.user_id = mm.auth_profile_id() order by m.id limit 1)
  )
$$;

-- Aktörens avtal (Actor.contractIds): medlemskapen med aktörens roll. Admin ser ändå alla avtal (mm.member_in).
create function mm.my_contract_ids() returns text[]
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(array_agg(distinct m.contract_id order by m.contract_id), '{}')
  from public.memberships m
  where m.user_id = mm.current_profile_id() and m.role = mm.current_role()
$$;

-- Aktörens enhet (Actor.customerUnit): medlemskapets enhet, annars profilens (actorFor i src/data/actors.ts).
create function mm.current_unit() returns text
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(
    (select m.customer_unit from public.memberships m
      where m.user_id = mm.current_profile_id() and m.role = mm.current_role() order by m.id limit 1),
    (select p.customer_unit from public.profiles p where p.id = mm.current_profile_id())
  )
$$;

-- policy.ts: isMB / isKom / has(roles, a)
create function mm.is_mb() returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce(mm.current_role() = any (mm.supplier_roles()), false) $$;
create function mm.is_kom() returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce(mm.current_role() = any (mm.customer_roles()), false) $$;
create function mm.role_in(roles text[]) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce(mm.current_role() = any (roles), false) $$;

-- policy.ts: member(a, contractId) – admin: alla avtal; övriga: avtal de är medlemmar i.
-- Anropas med (select mm.current_role()) och (select mm.my_contract_ids()) så att de räknas en gång per fråga.
create function mm.member_in(contract_id text, role text, contract_ids text[]) returns boolean
language sql immutable
as $$ select coalesce(role = 'admin' or (nullif(contract_id, '') is not null and contract_id = any (contract_ids)), false) $$;

-- policy.ts: orgsOf(a) – leverantör och kund i aktörens avtal. customersOf(a) – bara kunderna.
create function mm.my_org_ids() returns text[]
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(array_agg(distinct o.id), '{}')
  from public.contracts c
  cross join lateral (values (c.supplier_id), (c.customer_id)) as o (id)
  where c.id = any (mm.my_contract_ids())
$$;
create function mm.my_customer_ids() returns text[]
language sql stable security definer set search_path = public, mm
as $$ select coalesce(array_agg(distinct c.customer_id), '{}') from public.contracts c where c.id = any (mm.my_contract_ids()) $$;

-- Testtid i testmiljön: klockan startade på clock_demo_epoch (Stockholmstid) när seeden lästes in och går i vanlig takt.
-- Utan epoker (produktion): riktig tid. Samma regel som ctx.now() i src/server/runtime.ts.
create function mm.app_now() returns timestamptz
language sql stable security definer set search_path = public, mm
as $$
  select case
    when r.value is not null and d.value is not null
      then (d.value::timestamp at time zone 'Europe/Stockholm') + (now() - r.value::timestamptz)
    else now()
  end
  from (select 1) as one
  left join public.app_settings r on r.key = 'clock_real_epoch'
  left join public.app_settings d on d.key = 'clock_demo_epoch'
$$;

grant execute on function
  mm.environment(), mm.auth_profile_id(), mm.auth_is_tester(), mm.tester_session(), mm.current_profile_id(), mm.current_role(),
  mm.my_contract_ids(), mm.current_unit(), mm.is_mb(), mm.is_kom(), mm.role_in(text[]), mm.member_in(text, text, text[]),
  mm.my_org_ids(), mm.my_customer_ids(), mm.app_now()
to authenticated, service_role;

-- ---------------------------------------------------------------- Aktören för servern (samma värden som RLS använder)
-- Servern bygger Actor (src/api/roles.ts) från det här anropet, så att hanterarnas rollkontroll och RLS alltid ser samma aktör.
create function public.current_actor() returns jsonb
language sql stable security definer set search_path = public, mm
as $$
  select jsonb_build_object(
    'authProfileId', mm.auth_profile_id(),
    'isTester', mm.auth_is_tester(),
    'environment', mm.environment(),
    'impersonating', exists (select 1 from mm.tester_session()),
    'userId', mm.current_profile_id(),
    'role', mm.current_role(),
    'contractIds', to_jsonb(mm.my_contract_ids()),
    'customerUnit', mm.current_unit()
  )
$$;
revoke all on function public.current_actor() from public, anon;
grant execute on function public.current_actor() to authenticated, service_role;

-- ---------------------------------------------------------------- Skydd för inloggningskolumnerna
-- auth_user_id och is_tester ändras bara av servern med service role (inloggning och testare). Utan det skyddet
-- skulle en användare kunna göra sig själv till testare och välja en annan testperson. E-post lagras med gemener.
create function mm.protect_profile_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  new.email := lower(btrim(new.email));
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.auth_user_id is not null or new.is_tester then
        raise exception 'Inloggningskolumnerna ändras bara av servern' using errcode = '42501';
      end if;
    elsif new.auth_user_id is distinct from old.auth_user_id or new.is_tester is distinct from old.is_tester then
      raise exception 'Inloggningskolumnerna ändras bara av servern' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger profiles_protect_columns before insert or update on public.profiles
for each row execute function mm.protect_profile_columns();

-- ---------------------------------------------------------------- Avtal för läsning: vyn contracts_public
-- RLS döljer rader, inte kolumner. contracts.config innehåller interna mål (kpis[].internalTarget, t.ex. 35 %) och
-- interna notisregler (kpis[].notify) som kommunen inte får läsa. Därför:
--   * tabellen contracts: bara MB-roller i sina avtal (och admin) läser den direkt,
--   * vyn contracts_public: samma rader som policy.ts (MB och kommunen i sina avtal); kommunen får config utan interna delar.
-- SupabaseRepo läser tabellen "contracts" via vyn contracts_public; skrivningar (bara admin) går till tabellen.
create function mm.customer_safe_config(config jsonb) returns jsonb
language sql immutable
as $$
  select case
    when jsonb_typeof(config -> 'kpis') = 'array' then jsonb_set(config, '{kpis}', (
      select coalesce(jsonb_agg(case when jsonb_typeof(e.k) = 'object' then e.k - 'internalTarget' - 'notify' else e.k end order by e.ord), '[]'::jsonb)
      from jsonb_array_elements(config -> 'kpis') with ordinality as e (k, ord)))
    else config
  end
$$;

create function mm.visible_contracts() returns setof public.contracts
language sql stable security definer set search_path = public, mm
as $$
  -- policy.ts contracts.read: (isMB(a) || isKom(a)) && member(a, c.id)
  select c.id, c.supplier_id, c.customer_id, c.name, c.contract_number, c.dnr, c.starts_on, c.ends_on, c.case_prefix, c.data_role,
         case when mm.is_kom() then mm.customer_safe_config(c.config) else c.config end,
         c.status, c.contract_manager_id
  from public.contracts c
  where (mm.is_mb() or mm.is_kom()) and mm.member_in(c.id, mm.current_role(), mm.my_contract_ids())
$$;
grant execute on function mm.customer_safe_config(jsonb), mm.visible_contracts() to authenticated, service_role;

create view public.contracts_public with (security_invoker = true) as select * from mm.visible_contracts();
revoke all on public.contracts_public from anon, authenticated;
grant select on public.contracts_public to authenticated, service_role;

-- ---------------------------------------------------------------- Policyer: helgdagar, organisationer, avtal
-- policy.ts holidays: read () => true, write admin
create policy holidays_select on public.holidays for select to authenticated using (true);
create policy holidays_insert on public.holidays for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy holidays_update on public.holidays for update to authenticated using (true) with check ((select mm.current_role()) = 'admin');

-- policy.ts organizations: read admin || ((isMB || isKom) && orgsOf(a).has(o.id)), write admin
create policy organizations_select on public.organizations for select to authenticated using (
  (select mm.current_role()) = 'admin'
  or (((select mm.is_mb()) or (select mm.is_kom())) and id = any ((select mm.my_org_ids())))
);
create policy organizations_insert on public.organizations for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy organizations_update on public.organizations for update to authenticated using (
  (select mm.current_role()) = 'admin'
  or (((select mm.is_mb()) or (select mm.is_kom())) and id = any ((select mm.my_org_ids())))
) with check ((select mm.current_role()) = 'admin');

-- policy.ts contracts: read (isMB || isKom) && member – här bara MB (kommunen läser via contracts_public), write admin
create policy contracts_select on public.contracts for select to authenticated using (
  (select mm.is_mb()) and mm.member_in(id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy contracts_insert on public.contracts for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy contracts_update on public.contracts for update to authenticated using (
  (select mm.is_mb()) and mm.member_in(id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check ((select mm.current_role()) = 'admin');

-- policy.ts contract_areas och price_items: read (isMB || isKom) && member(contractId), write admin
create policy contract_areas_select on public.contract_areas for select to authenticated using (
  ((select mm.is_mb()) or (select mm.is_kom())) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy contract_areas_insert on public.contract_areas for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy contract_areas_update on public.contract_areas for update to authenticated using (
  ((select mm.is_mb()) or (select mm.is_kom())) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check ((select mm.current_role()) = 'admin');

create policy price_items_select on public.price_items for select to authenticated using (
  ((select mm.is_mb()) or (select mm.is_kom())) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy price_items_insert on public.price_items for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy price_items_update on public.price_items for update to authenticated using (
  ((select mm.is_mb()) or (select mm.is_kom())) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check ((select mm.current_role()) = 'admin');

grant select on public.holidays, public.organizations, public.contracts, public.contract_areas, public.price_items to authenticated;
grant insert, update on public.holidays, public.organizations, public.contracts, public.contract_areas, public.price_items to authenticated;

-- ---------------------------------------------------------------- Policyer: profiler och medlemskap
-- policy.ts profiles.read: self(p.id) || admin || ((isMB || isKom) && orgsOf(a).has(p.organizationId))
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select mm.current_profile_id())
  or (select mm.current_role()) = 'admin'
  or (((select mm.is_mb()) or (select mm.is_kom())) and organization_id = any ((select mm.my_org_ids())))
);
-- policy.ts profiles.write: admin || (avtalsansvarig && customersOf(a).has(p.organizationId)) || (self && exists)
create policy profiles_insert on public.profiles for insert to authenticated with check (
  (select mm.current_role()) = 'admin'
  or ((select mm.current_role()) = 'avtalsansvarig' and organization_id = any ((select mm.my_customer_ids())))
);
create policy profiles_update on public.profiles for update to authenticated using (
  id = (select mm.current_profile_id())
  or (select mm.current_role()) = 'admin'
  or (((select mm.is_mb()) or (select mm.is_kom())) and organization_id = any ((select mm.my_org_ids())))
) with check (
  (select mm.current_role()) = 'admin'
  or ((select mm.current_role()) = 'avtalsansvarig' and organization_id = any ((select mm.my_customer_ids())))
  or id = (select mm.current_profile_id())
);

-- policy.ts memberships.read: self(m.userId) || ((isMB || isKom) && member(a, m.contractId))
create policy memberships_select on public.memberships for select to authenticated using (
  user_id = (select mm.current_profile_id())
  or (((select mm.is_mb()) or (select mm.is_kom())) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids())))
);
-- policy.ts memberships.write: admin || (avtalsansvarig && member && isCustomerRole(m.role))
create policy memberships_insert on public.memberships for insert to authenticated with check (
  (select mm.current_role()) = 'admin'
  or ((select mm.current_role()) = 'avtalsansvarig'
      and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and role = any (mm.customer_roles()))
);
create policy memberships_update on public.memberships for update to authenticated using (
  user_id = (select mm.current_profile_id())
  or (((select mm.is_mb()) or (select mm.is_kom())) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids())))
) with check (
  (select mm.current_role()) = 'admin'
  or ((select mm.current_role()) = 'avtalsansvarig'
      and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and role = any (mm.customer_roles()))
);

grant select, insert, update on public.profiles, public.memberships to authenticated;

-- ---------------------------------------------------------------- Policyer: testarens val av testperson
-- Bara testaren själv, bara i testmiljön (mm.auth_is_tester). app_settings och login_attempts: bara service role.
create policy tester_sessions_select on public.tester_sessions for select to authenticated using (
  auth_user_id = auth.uid() and (select mm.auth_is_tester())
);
create policy tester_sessions_insert on public.tester_sessions for insert to authenticated with check (
  auth_user_id = auth.uid() and (select mm.auth_is_tester())
);
create policy tester_sessions_update on public.tester_sessions for update to authenticated using (
  auth_user_id = auth.uid() and (select mm.auth_is_tester())
) with check (
  auth_user_id = auth.uid() and (select mm.auth_is_tester())
);
create policy tester_sessions_delete on public.tester_sessions for delete to authenticated using (
  auth_user_id = auth.uid() and (select mm.auth_is_tester())
);
grant select, insert, update, delete on public.tester_sessions to authenticated;
