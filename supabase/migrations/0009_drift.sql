-- 0009 Drift: bakgrundsjobb (mm.claim_jobs), AI-körningar och beslut, revisionslogg (append-only), interna regler,
-- mallversioner, loggkontroller och testdatans namngivna rader.

-- ---------------------------------------------------------------- Bakgrundsjobb (tabellen jobs + /api/jobs/run)
create table public.jobs (
  id                         text primary key,
  kind                       text not null,
  payload                    jsonb not null default '{}',
  status                     text not null,
  attempts                   integer not null default 0,
  run_after                  timestamptz not null,
  last_error                 text,
  created_at                 timestamptz not null,
  created_by                 text,
  finished_at                timestamptz,
  -- När mm.claim_jobs senast hämtade jobbet (för att hitta jobb som fastnat i status running).
  started_at                 timestamptz
);
create index jobs_queue_idx on public.jobs (status, run_after);

-- Hämtar upp till n jobb som ska köras: status queued och run_after passerad, eller running som fastnat längre än
-- p_stale_after (körningen avbröts). Radlås med FOR UPDATE SKIP LOCKED, så att två körningar aldrig tar samma jobb.
-- Jobben får status running, attempts ökas och started_at sätts. Jobb som redan försökts p_max_attempts gånger hämtas inte.
-- p_now: appens tid (ctx.now()); utan värde mm.app_now() – testtid i testmiljön, riktig tid i produktion.
create function mm.claim_jobs(
  n integer, p_now timestamptz default null, p_max_attempts integer default 5, p_stale_after interval default interval '10 minutes'
) returns setof public.jobs
language plpgsql security definer set search_path = public, mm
as $$
declare
  t timestamptz := coalesce(p_now, mm.app_now());
begin
  return query
  with picked as (
    select j.id from public.jobs j
    where j.attempts < p_max_attempts
      and ((j.status = 'queued' and j.run_after <= t)
        or (j.status = 'running' and j.started_at is not null and j.started_at < t - p_stale_after))
    order by j.run_after, j.id
    limit greatest(n, 0)
    for update skip locked
  )
  update public.jobs j set status = 'running', attempts = j.attempts + 1, started_at = t
  from picked where j.id = picked.id
  returning j.*;
end
$$;
revoke all on function mm.claim_jobs(integer, timestamptz, integer, interval) from public, anon, authenticated;
grant execute on function mm.claim_jobs(integer, timestamptz, integer, interval) to service_role;

-- Samma funktion i public, så att servern kan anropa den via supabase-js (.rpc("claim_jobs")). Bara service role.
create function public.claim_jobs(
  n integer, p_now timestamptz default null, p_max_attempts integer default 5, p_stale_after interval default interval '10 minutes'
) returns setof public.jobs
language sql security definer set search_path = public, mm
as $$ select * from mm.claim_jobs(n, p_now, p_max_attempts, p_stale_after) $$;
revoke all on function public.claim_jobs(integer, timestamptz, integer, interval) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer, timestamptz, integer, interval) to service_role;

-- Nästa ärendenummer via supabase-js (.rpc("next_case_number")). Bara service role.
create function public.next_case_number(p_contract_id text, p_year integer) returns integer
language sql security definer set search_path = public, mm
as $$ select mm.next_case_number(p_contract_id, p_year) $$;
revoke all on function public.next_case_number(text, integer) from public, anon, authenticated;
grant execute on function public.next_case_number(text, integer) to service_role;

-- ---------------------------------------------------------------- AI (fas 2) – aldrig för skyddade ärenden, aldrig utan samtycke
create table public.ai_runs (
  id                         text primary key,
  case_id                    text references public.cases (id),
  kind                       text not null,
  provider                   text not null,
  model                      text not null,
  input_ref                  text,
  status                     text not null,
  created_at                 timestamptz not null,
  audio_seconds              integer,
  tokens_in                  integer,
  tokens_out                 integer,
  cost_ore                   bigint not null,
  latency_ms                 integer,
  output                     jsonb,
  evidence                   jsonb,
  input_deleted_at           timestamptz
);
create index ai_runs_case_id_idx on public.ai_runs (case_id);

create table public.ai_field_decisions (
  id                         text primary key,
  ai_run_id                  text,
  field                      text not null,
  suggested                  jsonb,
  final                      jsonb,
  decision                   text not null,
  changed                    boolean not null,
  decided_by                 text not null,
  decided_at                 timestamptz not null
);
create index ai_field_decisions_ai_run_id_idx on public.ai_field_decisions (ai_run_id);

-- ---------------------------------------------------------------- Revisionslogg – append-only (CLAUDE.md punkt 3)
-- Inga personuppgifter i details (bara id:n). Ingen roll får ändra eller ta bort rader (triggern gäller alla, även
-- service role). Insert bara för service role (ctx.audit). Läses av admin och chef.
create table public.audit_log (
  id                         text primary key,
  occurred_at                timestamptz not null,
  actor_id                   text,
  action                     text not null,
  entity                     text not null,
  entity_id                  text,
  contract_id                text,
  details                    jsonb not null default '{}'
);
create index audit_log_occurred_at_idx on public.audit_log (occurred_at);
create index audit_log_contract_id_idx on public.audit_log (contract_id);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create function mm.forbid_audit_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'Revisionsloggen kan inte ändras eller tas bort' using errcode = '42501';
end
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
for each row execute function mm.forbid_audit_change();

-- ---------------------------------------------------------------- Interna regler, mallar, loggkontroller
create table public.org_settings (
  id                         text primary key,
  organization_id            text not null references public.organizations (id),
  settings                   jsonb not null,
  updated_at                 timestamptz,
  updated_by                 text
);

create table public.template_versions (
  id                         text primary key,
  template_key               text not null,
  version                    integer not null,
  subject                    text not null,
  body                       text not null,
  saved_at                   timestamptz not null,
  saved_by                   text not null,
  note                       text not null
);
create index template_versions_key_idx on public.template_versions (template_key, version);

create table public.log_checks (
  id                         text primary key,
  month                      text not null,
  items                      jsonb not null default '[]',
  note                       text not null,
  signed_by                  text not null,
  signed_at                  timestamptz not null
);

-- BARA TESTDATA: namngivna rader som scenarier och förklaringar pekar på. Tom i produktion.
create table public.demo_tags (
  id                         text primary key,
  tag                        text not null,
  entity                     text not null,
  entity_ids                 text[] not null default '{}'
);

alter table public.jobs enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_field_decisions enable row level security;
alter table public.audit_log enable row level security;
alter table public.org_settings enable row level security;
alter table public.template_versions enable row level security;
alter table public.log_checks enable row level security;
alter table public.demo_tags enable row level security;
revoke all on public.jobs, public.ai_runs, public.ai_field_decisions, public.audit_log, public.org_settings, public.template_versions,
  public.log_checks, public.demo_tags from anon, authenticated, service_role;
grant all on public.jobs, public.ai_runs, public.ai_field_decisions, public.org_settings, public.template_versions, public.log_checks,
  public.demo_tags to service_role;
grant select, insert on public.audit_log to service_role;
grant select on public.audit_log, public.demo_tags to authenticated;
grant select, insert, update on public.jobs, public.ai_runs, public.ai_field_decisions, public.org_settings, public.template_versions,
  public.log_checks to authenticated;

-- AI-körningen finns och dess ärende (uppslag utan RLS – policy.ts raw.get("ai_runs", id)).
create function mm.ai_run_exists(p_ai_run_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select nullif(p_ai_run_id, '') is not null and exists (select 1 from public.ai_runs r where r.id = p_ai_run_id) $$;
create function mm.ai_run_case_id(p_ai_run_id text) returns text
language sql stable security definer set search_path = public, mm
as $$ select r.case_id from public.ai_runs r where r.id = p_ai_run_id $$;
grant execute on function mm.ai_run_exists(text), mm.ai_run_case_id(text) to authenticated, service_role;

-- ---------------------------------------------------------------- Policyer
-- policy.ts jobs: bara admin (manuella körningar i adminvyn). Bakgrundsjobben körs med service role.
create policy jobs_select on public.jobs for select to authenticated using ((select mm.current_role()) = 'admin');
create policy jobs_insert on public.jobs for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy jobs_update on public.jobs for update to authenticated
  using ((select mm.current_role()) = 'admin') with check ((select mm.current_role()) = 'admin');

-- policy.ts ai_runs.read: med ärende notesRead(caseId), utan ärende OVERSIGHT
create policy ai_runs_select on public.ai_runs for select to authenticated using (
  case when nullif(case_id, '') is not null
    then (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
    else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
  end
);
-- policy.ts ai_runs.write: med ärende workOn(caseId), utan ärende samordnare och avtalsansvarig
create policy ai_runs_insert on public.ai_runs for insert to authenticated with check (
  case when nullif(case_id, '') is not null then mm.work_on(case_id) else (select mm.role_in('{samordnare,avtalsansvarig}')) end
);
create policy ai_runs_update on public.ai_runs for update to authenticated using (
  case when nullif(case_id, '') is not null
    then (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
    else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
  end
) with check (
  case when nullif(case_id, '') is not null then mm.work_on(case_id) else (select mm.role_in('{samordnare,avtalsansvarig}')) end
);

-- policy.ts ai_field_decisions.read: finns AI-körningen gäller dess läsregel, annars den som beslutade, chef och admin.
create policy ai_field_decisions_select on public.ai_field_decisions for select to authenticated using (
  case
    when mm.ai_run_exists(ai_run_id) then
      case when nullif(mm.ai_run_case_id(ai_run_id), '') is not null
        then (select mm.current_role()) is distinct from 'ekonom' and mm.ai_run_case_id(ai_run_id) in (select mm.case_ids('{full,team}'))
        else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      end
    else coalesce(decided_by = (select mm.current_profile_id()), false) or (select mm.role_in('{chef,admin}'))
  end
);
-- policy.ts ai_field_decisions.write: CASE_WORKERS som själv beslutar, och får arbeta i körningens ärende.
create policy ai_field_decisions_insert on public.ai_field_decisions for insert to authenticated with check (
  (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
  and decided_by = (select mm.current_profile_id())
  and (not mm.ai_run_exists(ai_run_id) or nullif(mm.ai_run_case_id(ai_run_id), '') is null or mm.work_on(mm.ai_run_case_id(ai_run_id)))
);
create policy ai_field_decisions_update on public.ai_field_decisions for update to authenticated using (
  case
    when mm.ai_run_exists(ai_run_id) then
      case when nullif(mm.ai_run_case_id(ai_run_id), '') is not null
        then (select mm.current_role()) is distinct from 'ekonom' and mm.ai_run_case_id(ai_run_id) in (select mm.case_ids('{full,team}'))
        else (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      end
    else coalesce(decided_by = (select mm.current_profile_id()), false) or (select mm.role_in('{chef,admin}'))
  end
) with check (
  (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
  and decided_by = (select mm.current_profile_id())
  and (not mm.ai_run_exists(ai_run_id) or nullif(mm.ai_run_case_id(ai_run_id), '') is null or mm.work_on(mm.ai_run_case_id(ai_run_id)))
);

-- policy.ts audit_log: read admin, eller chef för loggposter utan avtal eller i sina avtal; write never (ctx.audit, service role)
create policy audit_log_select on public.audit_log for select to authenticated using (
  (select mm.current_role()) = 'admin'
  or ((select mm.current_role()) = 'chef'
      and (nullif(contract_id, '') is null or mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))))
);

-- policy.ts org_settings: read MB, write admin
create policy org_settings_select on public.org_settings for select to authenticated using ((select mm.is_mb()));
create policy org_settings_insert on public.org_settings for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy org_settings_update on public.org_settings for update to authenticated
  using ((select mm.is_mb())) with check ((select mm.current_role()) = 'admin');

-- policy.ts template_versions: read admin och samordnare, write admin
create policy template_versions_select on public.template_versions for select to authenticated using ((select mm.role_in('{admin,samordnare}')));
create policy template_versions_insert on public.template_versions for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy template_versions_update on public.template_versions for update to authenticated
  using ((select mm.role_in('{admin,samordnare}'))) with check ((select mm.current_role()) = 'admin');

-- policy.ts log_checks: read admin och chef, write admin/chef som själv signerar
create policy log_checks_select on public.log_checks for select to authenticated using ((select mm.role_in('{admin,chef}')));
create policy log_checks_insert on public.log_checks for insert to authenticated with check (
  (select mm.role_in('{admin,chef}')) and signed_by = (select mm.current_profile_id())
);
create policy log_checks_update on public.log_checks for update to authenticated using ((select mm.role_in('{admin,chef}'))) with check (
  (select mm.role_in('{admin,chef}')) and signed_by = (select mm.current_profile_id())
);

-- policy.ts demo_tags: read alla, write never (bara testdata, inga personuppgifter)
create policy demo_tags_select on public.demo_tags for select to authenticated using (true);
