-- 0010 Testdata i testmiljön: mm.reset_test_data() tömmer appens tabeller inför "Läs in testdata på nytt".
--
-- Bara i testmiljön (app_settings.environment = 'staging'). I alla andra databaser – produktion, eller en databas utan
-- inställningen – gör funktionen ingenting och kastar fel. Bara service role får anropa den (servern, POST /api/staging/seed,
-- som bara testare i testmiljön når). Själva testdatat läses sedan in av servern i batchar (src/server/staging/load.ts).
--
-- Töms: alla tabeller i public utom
--   audit_log                 revisionsloggen är append-only (CLAUDE.md punkt 3) – även inläsningen loggas där
--   app_settings              miljön och testklockan (klockan sätts om till p_demo_epoch nedan)
--   tester_sessions, login_attempts   testarnas val av testperson och inloggningens hastighetsbegränsning
--   profiles, memberships     bara testarnas rader (is_tester) behålls – så att testarna fortfarande kan logga in
--   organizations, contracts  bara de rader testarnas profiler och medlemskap pekar på (skrivs över av inläsningen)
--   buyer_references          bara de rader en kvarvarande profil pekar på
-- Tabeller som läggs till senare töms automatiskt (listan byggs från pg_tables). En främmande nyckel från en kvarvarande
-- tabell till en tömd tabell stoppar funktionen (truncate utan cascade) i stället för att tömma för mycket.

create function mm.reset_test_data(p_demo_epoch text) returns void
language plpgsql security definer set search_path = public, mm
as $$
declare
  keep constant text[] := array[
    'audit_log', 'app_settings', 'tester_sessions', 'login_attempts',
    'profiles', 'memberships', 'organizations', 'contracts', 'buyer_references'
  ];
  targets text;
begin
  if coalesce(mm.environment(), '') <> 'staging' then
    raise exception 'reset_test_data körs bara i testmiljön (app_settings.environment = staging)' using errcode = '42501';
  end if;
  if p_demo_epoch is null or p_demo_epoch !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
    raise exception 'reset_test_data: testklockans start ska vara YYYY-MM-DDTHH:MM' using errcode = '22023';
  end if;

  -- 1. Allt ärende- och driftdata.
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

-- Samma funktion i public, så att servern kan anropa den via supabase-js (.rpc("reset_test_data")). Bara service role.
create function public.reset_test_data(p_demo_epoch text) returns void
language sql security definer set search_path = public, mm
as $$ select mm.reset_test_data(p_demo_epoch) $$;
revoke all on function public.reset_test_data(text) from public, anon, authenticated;
grant execute on function public.reset_test_data(text) to service_role;
