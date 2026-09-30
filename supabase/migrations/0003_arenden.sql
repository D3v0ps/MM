-- 0003 Ärenden: personer, ärenden, statushistorik, löpnummer, team, beställarreferenser.
-- Behörigheten per ärende: mm.case_access – exakt port av caseAccess i src/core/access.ts.

-- ---------------------------------------------------------------- Beställarreferenser
create table public.buyer_references (
  id                         text primary key,
  customer_id                text not null references public.organizations (id),
  reference                  text not null,
  unit                       text not null,
  active                     boolean not null,
  note                       text
);
create index buyer_references_customer_id_idx on public.buyer_references (customer_id);
alter table public.profiles add constraint profiles_buyer_reference_id_fkey foreign key (buyer_reference_id) references public.buyer_references (id);

-- ---------------------------------------------------------------- Personer
-- Personnummer krypteras i appen (AES-256-GCM) och söks via HMAC-hash (CLAUDE.md punkt 2). Adress bara vid brev och aldrig
-- vid skyddade personuppgifter (punkt 8).
create table public.persons (
  id                         text primary key,
  personnummer_enc           text not null,
  personnummer_hash          text not null,
  personnummer_last4         text not null,
  birth_year                 integer,
  first_name                 text not null,
  last_name                  text not null,
  phone                      text not null,
  email                      text not null,
  city                       text not null,
  address                    text,
  preferred_contact          text not null,
  protected_identity         boolean not null,
  accessibility_needs        text not null,
  language                   text not null,
  needs_interpreter          boolean not null,
  constraint persons_protected_no_address check (not protected_identity or address is null)
);
create index persons_personnummer_hash_idx on public.persons (personnummer_hash) where personnummer_hash <> '';

-- ---------------------------------------------------------------- Ärenden
create table public.cases (
  id                         text primary key,
  case_number                text not null unique,
  contract_id                text not null references public.contracts (id),
  person_id                  text not null references public.persons (id),
  status                     text not null,
  source                     text not null,
  referred_at                timestamptz not null,
  referrer_id                text references public.profiles (id),
  referrer_name              text,
  referrer_unit              text,
  referrer_phone             text,
  referrer_email             text,
  buyer_reference            text,
  purchase_order_number      text,
  primary_area_code          text,
  secondary_area_code        text,
  vocational_track           text not null,
  desired_start              date,
  planned_start              date,
  planned_weeks              integer,
  planned_end                date,
  order_value_weeks          integer,
  acknowledged_at            timestamptz,
  confirmed_at               timestamptz,
  declined_at                timestamptz,
  decline_reason             text,
  first_meeting_at           timestamptz,
  start_date                 date,
  end_date                   date,
  closed_at                  timestamptz,
  end_reason                 text,
  result_class               text,
  result_verified_at         timestamptz,
  phase                      integer not null,
  phase_since                date,
  lead_coach_id              text references public.profiles (id),
  background_info            text not null,
  ai_consent_status          text not null,
  meeting_day                integer,
  meeting_time               text,
  location                   text not null,
  paused_weeks               text[] not null default '{}',
  pause_reason               text,
  source_email_id            text
);
create index cases_contract_id_idx on public.cases (contract_id);
create index cases_person_id_idx on public.cases (person_id);
create index cases_referrer_id_idx on public.cases (referrer_id);
create index cases_lead_coach_id_idx on public.cases (lead_coach_id);
create index cases_status_idx on public.cases (status);

create table public.case_status_history (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  from_status                text,
  to_status                  text not null,
  from_coach                 text,
  to_coach                   text,
  reason                     text not null,
  changed_by                 text not null,
  changed_at                 timestamptz not null,
  customer_notified_at       timestamptz
);
create index case_status_history_case_id_idx on public.case_status_history (case_id);

-- Löpnummer per avtal och år (id = contractId:year). Skrivs bara av systemsteg (ctx.system) eller mm.next_case_number.
create table public.case_counters (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  year                       integer not null,
  last_value                 integer not null,
  unique (contract_id, year)
);

create table public.case_team (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  user_id                    text not null references public.profiles (id),
  role                       text not null
);
create index case_team_case_id_idx on public.case_team (case_id);
create index case_team_user_id_idx on public.case_team (user_id);

alter table public.buyer_references enable row level security;
alter table public.persons enable row level security;
alter table public.cases enable row level security;
alter table public.case_status_history enable row level security;
alter table public.case_counters enable row level security;
alter table public.case_team enable row level security;
revoke all on public.buyer_references, public.persons, public.cases, public.case_status_history, public.case_counters, public.case_team from anon, authenticated;
grant all on public.buyer_references, public.persons, public.cases, public.case_status_history, public.case_counters, public.case_team to service_role;

-- ---------------------------------------------------------------- Behörighet per ärende (src/core/access.ts)
-- unitCovers: chefens enhet omfattar ärendet (samma enhet eller underenhet). Ingen enhet = hela avtalet.
create function mm.unit_covers(chef_unit text, referrer_unit text) returns boolean
language sql immutable
as $$
  select case
    when coalesce(chef_unit, '') = '' then true
    when coalesce(referrer_unit, '') = '' then false
    else referrer_unit = chef_unit or starts_with(referrer_unit, chef_unit || ' ')
  end
$$;

-- effectiveCustomerScope: fastställt värde, annars det preliminära, annars 'own'. ATT_FASTSTÄLLA räknas som ej fastställt.
create function mm.customer_scope(config jsonb) returns text
language sql immutable
as $$
  select case
    when coalesce(config #>> '{customerVisibility,scope}', '') <> ''
         and not starts_with(config #>> '{customerVisibility,scope}', 'ATT_FASTSTÄLLA')
      then config #>> '{customerVisibility,scope}'
    else coalesce(config #>> '{customerVisibility,prototypeScope}', 'own')
  end
$$;

-- caseAccess(c, actor, lookups): åtkomstnivå full | team | restricted | billing | customer | none. Ren funktion.
create function mm.case_access_level(
  p_role text, p_profile_id text, p_contract_ids text[], p_unit text,
  c_contract_id text, c_lead_coach_id text, c_referrer_id text,
  l_protected boolean, l_in_team boolean, l_referrer_unit text, l_scope text
) returns text
language sql immutable
as $$
  select case
    when c_contract_id is null then 'none'
    when p_role is distinct from 'admin' and not coalesce(c_contract_id = any (p_contract_ids), false) then 'none'
    when p_role = 'avtalsansvarig' then 'full'
    when p_role in ('samordnare', 'chef', 'admin') then case when l_protected then 'restricted' else 'full' end
    when p_role = 'coach' then case
      when c_lead_coach_id = p_profile_id then 'full'
      when l_in_team and not l_protected then 'team'
      else 'none' end
    when p_role = 'handledare' then case when l_in_team and not l_protected then 'team' else 'none' end
    when p_role = 'ekonom' then 'billing'
    when p_role = 'kommun_handlaggare' then case
      -- Handläggaren som beställde ser alltid sitt ärende (även skyddade – hon lämnade uppgifterna).
      when nullif(c_referrer_id, '') is not null and c_referrer_id = p_profile_id then 'customer'
      when l_protected then 'none'
      when coalesce(l_scope, 'own') = 'all' then 'customer'
      when l_scope = 'unit' and nullif(p_unit, '') is not null and l_referrer_unit = p_unit then 'customer'
      else 'none' end
    when p_role = 'kommun_chef' then case
      when not mm.unit_covers(p_unit, l_referrer_unit) then 'none'
      when l_protected then 'restricted'
      else 'customer' end
    else 'none'
  end
$$;

-- Åtkomst för aktören till ett ärende med de här fälten (även en ny rad som inte sparats än – policy.ts accessOfCase).
-- Uppslagen (lookupsFor) görs utan RLS: skyddade personuppgifter, teamet, beställarens enhet, avtalets synlighet.
create function mm.case_access_of(
  p_case_id text, p_contract_id text, p_person_id text, p_lead_coach_id text, p_referrer_id text, p_referrer_unit text
) returns text
language sql stable security definer set search_path = public, mm
as $$
  select mm.case_access_level(
    mm.current_role(), mm.current_profile_id(), mm.my_contract_ids(), mm.current_unit(),
    p_contract_id, p_lead_coach_id, p_referrer_id,
    coalesce((select p.protected_identity from public.persons p where p.id = p_person_id), false),
    exists (select 1 from public.case_team t where t.case_id = p_case_id and t.user_id = mm.current_profile_id()),
    coalesce(case when nullif(p_referrer_id, '') is not null then (select r.customer_unit from public.profiles r where r.id = p_referrer_id) end, p_referrer_unit),
    mm.customer_scope((select k.config from public.contracts k where k.id = p_contract_id))
  )
$$;

-- mm.case_access(case_id): aktörens åtkomst till ärendet med id:t ('none' om det inte finns).
create function mm.case_access(p_case_id text) returns text
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(
    (select mm.case_access_of(c.id, c.contract_id, c.person_id, c.lead_coach_id, c.referrer_id, c.referrer_unit)
       from public.cases c where c.id = p_case_id),
    'none')
$$;

-- Åtkomst till alla ärenden på en gång (samma regler som mm.case_access, men i en fråga). Policyerna använder
-- (select mm.case_ids(...)) så att mängden räknas en gång per fråga i stället för en gång per rad.
create function mm.my_case_access() returns table (case_id text, access text)
language sql stable security definer set search_path = public, mm
as $$
  with me as materialized (
    select mm.current_role() as role, mm.current_profile_id() as uid, mm.my_contract_ids() as cids, mm.current_unit() as unit
  )
  select c.id,
         mm.case_access_level(
           me.role, me.uid, me.cids, me.unit,
           c.contract_id, c.lead_coach_id, c.referrer_id,
           coalesce(p.protected_identity, false),
           exists (select 1 from public.case_team t where t.case_id = c.id and t.user_id = me.uid),
           coalesce(case when nullif(c.referrer_id, '') is not null then r.customer_unit end, c.referrer_unit),
           mm.customer_scope(k.config))
  from me
  cross join public.cases c
  left join public.persons p on p.id = c.person_id
  left join public.profiles r on r.id = c.referrer_id
  left join public.contracts k on k.id = c.contract_id
$$;

-- Ärenden där aktören har någon av nivåerna.
create function mm.case_ids(levels text[]) returns setof text
language sql stable security definer set search_path = public, mm
as $$ select a.case_id from mm.my_case_access() a where a.access = any (levels) $$;

-- canSeeNotes(access, role): anteckningar och bedömningar – full eller team, aldrig ekonom.
create function mm.can_see_notes(access text, role text default null) returns boolean
language sql immutable
as $$ select coalesce(access in ('full', 'team') and role is distinct from 'ekonom', false) $$;
-- canSeePerson(access): personens uppgifter – full, team eller customer.
create function mm.can_see_person(access text) returns boolean
language sql immutable
as $$ select coalesce(access in ('full', 'team', 'customer'), false) $$;

-- policy.ts workOn(caseId): CASE_WORKERS med full- eller teamåtkomst.
create function mm.work_on(p_case_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare'])
     and mm.case_access(p_case_id) in ('full', 'team')
$$;

-- policy.ts caseWrite(c): får aktören ändra ärendet? p_exists = raden finns redan (ändring, inte ny rad).
create function mm.case_write_check(
  p_case_id text, p_contract_id text, p_person_id text, p_lead_coach_id text, p_referrer_id text, p_referrer_unit text, p_exists boolean
) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(case mm.current_role()
    when 'samordnare' then acc = 'full'
    when 'avtalsansvarig' then acc = 'full'
    when 'coach' then acc = 'full' and p_exists -- coachen skapar inga ärenden
    when 'ekonom' then acc = 'billing' and p_exists -- beställarreferens
    when 'kommun_handlaggare' then acc = 'customer' and nullif(p_referrer_id, '') is not null and p_referrer_id = mm.current_profile_id()
    else false
  end, false)
  from (select mm.case_access_of(p_case_id, p_contract_id, p_person_id, p_lead_coach_id, p_referrer_id, p_referrer_unit) as acc) a
$$;

-- policy.ts caseWriteById(caseId): ärendet finns och aktören får ändra det.
create function mm.can_write_case(p_case_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select coalesce((
    select mm.case_write_check(c.id, c.contract_id, c.person_id, c.lead_coach_id, c.referrer_id, c.referrer_unit, true)
    from public.cases c where c.id = p_case_id), false)
$$;

-- Beställande handläggare för ärendet (uppslag utan RLS, policy.ts raw.get("cases", id)?.referrerId).
create function mm.case_referrer_id(p_case_id text) returns text
language sql stable security definer set search_path = public, mm
as $$ select c.referrer_id from public.cases c where c.id = p_case_id $$;

-- policy.ts persons.read: personen syns via ett ärende där rollen får se personuppgifter.
create function mm.visible_person_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$
  select c.person_id from public.cases c
  join mm.my_case_access() a on a.case_id = c.id
  where mm.can_see_person(a.access)
$$;

-- policy.ts persons.write: ny person (inga ärenden än) – ORDER_CREATORS; annars full åtkomst med CASE_EDITORS
-- eller beställande handläggare i ett av personens ärenden.
create function mm.person_write(p_person_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select case
    when not exists (select 1 from public.cases c where c.person_id = p_person_id)
      then mm.role_in(array['samordnare', 'avtalsansvarig', 'kommun_handlaggare'])
    else exists (
      select 1 from public.cases c
      join mm.my_case_access() a on a.case_id = c.id
      where c.person_id = p_person_id
        and ((a.access = 'full' and mm.role_in(array['samordnare', 'avtalsansvarig', 'coach']))
          or (a.access = 'customer' and mm.current_role() = 'kommun_handlaggare'
              and nullif(c.referrer_id, '') is not null and c.referrer_id = mm.current_profile_id())))
  end
$$;

-- Nästa ärendenummer för avtalet och året, med radlås i samma transaktion (docs/PLAN-FAS1.md 0003). Bara service role.
create function mm.next_case_number(p_contract_id text, p_year integer) returns integer
language plpgsql security definer set search_path = public, mm
as $$
declare
  v integer;
begin
  insert into public.case_counters (id, contract_id, year, last_value)
  values (p_contract_id || ':' || p_year, p_contract_id, p_year, 0)
  on conflict (id) do nothing;
  update public.case_counters set last_value = last_value + 1
  where id = p_contract_id || ':' || p_year
  returning last_value into v;
  return v;
end
$$;

grant execute on function
  mm.unit_covers(text, text), mm.customer_scope(jsonb),
  mm.case_access_level(text, text, text[], text, text, text, text, boolean, boolean, text, text),
  mm.case_access_of(text, text, text, text, text, text), mm.case_access(text), mm.my_case_access(), mm.case_ids(text[]),
  mm.can_see_notes(text, text), mm.can_see_person(text), mm.work_on(text),
  mm.case_write_check(text, text, text, text, text, text, boolean), mm.can_write_case(text), mm.case_referrer_id(text),
  mm.visible_person_ids(), mm.person_write(text)
to authenticated, service_role;
grant execute on function mm.next_case_number(text, integer) to service_role;

-- ---------------------------------------------------------------- Policyer
-- policy.ts buyer_references.read: admin || ((isMB || isKom) && customersOf(a).has(b.customerId))
create policy buyer_references_select on public.buyer_references for select to authenticated using (
  (select mm.current_role()) = 'admin'
  or (((select mm.is_mb()) or (select mm.is_kom())) and customer_id = any ((select mm.my_customer_ids())::text[]))
);
-- policy.ts buyer_references.write: admin || ((avtalsansvarig || ekonom) && customersOf(a).has(b.customerId))
create policy buyer_references_insert on public.buyer_references for insert to authenticated with check (
  (select mm.current_role()) = 'admin'
  or ((select mm.role_in('{avtalsansvarig,ekonom}')) and customer_id = any ((select mm.my_customer_ids())::text[]))
);
create policy buyer_references_update on public.buyer_references for update to authenticated using (
  (select mm.current_role()) = 'admin'
  or (((select mm.is_mb()) or (select mm.is_kom())) and customer_id = any ((select mm.my_customer_ids())::text[]))
) with check (
  (select mm.current_role()) = 'admin'
  or ((select mm.role_in('{avtalsansvarig,ekonom}')) and customer_id = any ((select mm.my_customer_ids())::text[]))
);

-- policy.ts persons.read / persons.write
create policy persons_select on public.persons for select to authenticated using (id in (select mm.visible_person_ids()));
create policy persons_insert on public.persons for insert to authenticated with check (mm.person_write(id));
create policy persons_update on public.persons for update to authenticated
  using (id in (select mm.visible_person_ids())) with check (mm.person_write(id));

-- policy.ts cases.read: accessOfCase !== "none"; cases.write: caseWrite (ny rad: exists = false)
create policy cases_select on public.cases for select to authenticated using (
  id in (select mm.case_ids('{full,team,restricted,billing,customer}'))
);
create policy cases_insert on public.cases for insert to authenticated with check (
  mm.case_write_check(id, contract_id, person_id, lead_coach_id, referrer_id, referrer_unit, false)
);
create policy cases_update on public.cases for update to authenticated using (
  id in (select mm.case_ids('{full,team,restricted,billing,customer}'))
) with check (
  mm.case_write_check(id, contract_id, person_id, lead_coach_id, referrer_id, referrer_unit, true)
);

-- policy.ts case_status_history: read canSeePerson(access), write caseWriteById
create policy case_status_history_select on public.case_status_history for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
);
create policy case_status_history_insert on public.case_status_history for insert to authenticated with check (mm.can_write_case(case_id));
create policy case_status_history_update on public.case_status_history for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
) with check (mm.can_write_case(case_id));

-- policy.ts case_counters: read isMB && member, write never (löpnummer via ctx.system)
create policy case_counters_select on public.case_counters for select to authenticated using (
  (select mm.is_mb()) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- policy.ts case_team: read canSeePerson(access), write CASE_EDITORS && access === "full" (även borttagning vid coachbyte)
create policy case_team_select on public.case_team for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
);
create policy case_team_insert on public.case_team for insert to authenticated with check (
  (select mm.role_in('{samordnare,avtalsansvarig,coach}')) and mm.case_access(case_id) = 'full'
);
create policy case_team_update on public.case_team for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
) with check (
  (select mm.role_in('{samordnare,avtalsansvarig,coach}')) and mm.case_access(case_id) = 'full'
);
create policy case_team_delete on public.case_team for delete to authenticated using (
  (select mm.role_in('{samordnare,avtalsansvarig,coach}')) and mm.case_access(case_id) = 'full'
);

grant select, insert, update on public.buyer_references, public.persons, public.cases, public.case_status_history, public.case_team to authenticated;
grant delete on public.case_team to authenticated;
grant select on public.case_counters to authenticated;
