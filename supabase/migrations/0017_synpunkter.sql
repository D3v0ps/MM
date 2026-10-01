-- 0017 Synpunkter i testmiljön ("Lämna synpunkt", beslut 2026-10-01).
--
-- Testarna (profiles.is_tester) lämnar synpunkter på processen och plattformen med en knapp i testmiljöns verktygsfält.
-- En synpunkt sparas med typ, prioritet, text, status, rollen testaren agerade som, sidan (bara sökväg och id:n – aldrig
-- namn, personnummer eller fritext) och skärmens titel. Testarna ser alla synpunkter, svarar och ändrar status.
-- Samma regler som src/data/policy.ts (feedback, feedback_replies):
--   * bara inloggade testare i testmiljön läser och skriver: mm.auth_is_tester() (is_tester OCH environment = 'staging'),
--     oavsett vilken testperson testaren agerar som. I produktion kan ingen läsa eller skriva.
--   * ny synpunkt och nytt svar bara i eget namn (author_id = testarens egen profil, mm.auth_profile_id())
--   * i en synpunkt ändras bara status (status, status_changed_at, status_changed_by – i eget namn); svar ändras aldrig
--   * ingen tar bort något (statusen "avfardad" i stället)
-- Synpunkterna hör inte till testdatat: mm.reset_test_data() ("Läs in testdata på nytt") tömmer dem inte längre (nedan), och
-- seed.sql rör dem inte. created_at sätts av hanteraren med ctx.now() (testtid i testmiljön) – ingen default now().
-- Inga utskick om synpunkter. Revisionsloggen får feedback.created, feedback.replied och feedback.status_changed (bara id:n).

-- ---------------------------------------------------------------- Tabellerna
create table public.feedback (
  id                         text primary key,
  type                       text not null check (type in ('fel', 'forbattring', 'fraga', 'bra')),
  priority                   text not null check (priority in ('maste', 'bor', 'kan')),
  text                       text not null check (length(text) between 1 and 4000),
  status                     text not null check (status in ('ny', 'diskutera', 'andras', 'klar', 'avfardad')),
  -- Rollen testaren agerade som (testpersonens roll).
  role                       text not null check (role = any (mm.all_roles())),
  -- Bara sökväg och id:n, t.ex. '/arenden/case-260143?flik=narvaro'. Engångslänkarnas token är maskerad ('/rost/•••••').
  -- Inga mellanslag (fritext). Null = hela Miljonmatch.
  path                       text check (path is null or (length(path) <= 300 and path ~ '^/[A-Za-z0-9/_.?=&•-]*$')),
  view_title                 text check (view_title is null or length(view_title) <= 120),
  created_at                 timestamptz not null,
  -- Testarens egen profil (profiles.id). Ingen främmande nyckel: profilerna läses om när testdatat läses in på nytt.
  author_id                  text not null,
  status_changed_at          timestamptz,
  status_changed_by          text
);
create index feedback_created_at_idx on public.feedback (created_at);

create table public.feedback_replies (
  id                         text primary key,
  feedback_id                text not null references public.feedback (id),
  text                       text not null check (length(text) between 1 and 2000),
  created_at                 timestamptz not null,
  -- Testarens egen profil (profiles.id).
  author_id                  text not null
);
create index feedback_replies_feedback_id_idx on public.feedback_replies (feedback_id);

alter table public.feedback enable row level security;
alter table public.feedback_replies enable row level security;
revoke all on public.feedback, public.feedback_replies from anon, authenticated;
grant all on public.feedback, public.feedback_replies to service_role;
grant select, insert, update on public.feedback to authenticated;
grant select, insert on public.feedback_replies to authenticated;

-- ---------------------------------------------------------------- Policyer
-- policy.ts feedback.read: stagingTester(a) – den inloggade är testare i testmiljön
create policy feedback_select on public.feedback for select to authenticated using ((select mm.auth_is_tester()));
-- policy.ts feedback.write (ny rad): testare, i eget namn
create policy feedback_insert on public.feedback for insert to authenticated with check (
  (select mm.auth_is_tester()) and author_id = (select mm.auth_profile_id())
);
-- policy.ts feedback.write (ändring): testare; vilka kolumner som får ändras styr triggern nedan
create policy feedback_update on public.feedback for update to authenticated
  using ((select mm.auth_is_tester())) with check ((select mm.auth_is_tester()));

-- policy.ts feedback_replies: läsa som testare; nytt svar i eget namn (synpunkten måste finnas – främmande nyckel); ingen ändring
create policy feedback_replies_select on public.feedback_replies for select to authenticated using ((select mm.auth_is_tester()));
create policy feedback_replies_insert on public.feedback_replies for insert to authenticated with check (
  (select mm.auth_is_tester()) and author_id = (select mm.auth_profile_id())
);

-- policy.ts feedbackStatusOnly: i en synpunkt ändras bara status, status_changed_at och status_changed_by, och den som
-- ändrar status gör det i eget namn. Gäller inloggade (authenticated, anon); service role påverkas inte.
create function mm.protect_feedback_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (to_jsonb(new) - array['status', 'status_changed_at', 'status_changed_by'])
       is distinct from (to_jsonb(old) - array['status', 'status_changed_at', 'status_changed_by']) then
      raise exception 'Bara synpunktens status kan ändras' using errcode = '42501';
    end if;
    if new.status_changed_by is distinct from old.status_changed_by and new.status_changed_by is not null
       and new.status_changed_by is distinct from mm.auth_profile_id() then
      raise exception 'Statusen ändras i eget namn' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger feedback_protect_columns before update on public.feedback
for each row execute function mm.protect_feedback_columns();

-- ---------------------------------------------------------------- "Läs in testdata på nytt" behåller synpunkterna
-- Samma funktion som i 0010, med feedback och feedback_replies i listan över tabeller som inte töms.
create or replace function mm.reset_test_data(p_demo_epoch text) returns void
language plpgsql security definer set search_path = public, mm
as $$
declare
  keep constant text[] := array[
    'audit_log', 'app_settings', 'tester_sessions', 'login_attempts',
    'profiles', 'memberships', 'organizations', 'contracts', 'buyer_references',
    'feedback', 'feedback_replies'
  ];
  targets text;
begin
  if coalesce(mm.environment(), '') <> 'staging' then
    raise exception 'reset_test_data körs bara i testmiljön (app_settings.environment = staging)' using errcode = '42501';
  end if;
  if p_demo_epoch is null or p_demo_epoch !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
    raise exception 'reset_test_data: testklockans start ska vara YYYY-MM-DDTHH:MM' using errcode = '22023';
  end if;

  -- 1. Allt ärende- och driftdata (inte synpunkterna).
  select string_agg(format('public.%I', t.tablename), ', ' order by t.tablename)
    into targets
    from pg_tables t
   where t.schemaname = 'public' and t.tablename <> all (keep);
  if targets is not null then
    execute 'truncate table ' || targets || ' restart identity';
  end if;

  -- 2. Testpersonernas profiler och medlemskap – testarnas behålls.
  delete from public.memberships m
   where not exists (select 1 from public.profiles p where p.id = m.user_id and p.is_tester);
  delete from public.profiles p where not p.is_tester;
  delete from public.buyer_references b
   where not exists (select 1 from public.profiles p where p.buyer_reference_id = b.id);

  -- 3. Avtal och organisationer som ingen kvarvarande rad pekar på.
  delete from public.contracts c
   where not exists (select 1 from public.memberships m where m.contract_id = c.id);
  delete from public.organizations o
   where not exists (select 1 from public.profiles p where p.organization_id = o.id)
     and not exists (select 1 from public.contracts c where c.supplier_id = o.id or c.customer_id = o.id)
     and not exists (select 1 from public.buyer_references b where b.customer_id = o.id);

  -- 4. Testklockan startar om på testtiden (samma regel som seed.sql och mm.app_now()).
  insert into public.app_settings (key, value) values
    ('clock_demo_epoch', p_demo_epoch),
    ('clock_real_epoch', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  on conflict (key) do update set value = excluded.value;
end
$$;
revoke all on function mm.reset_test_data(text) from public, anon, authenticated;
grant execute on function mm.reset_test_data(text) to service_role;
