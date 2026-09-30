-- 0005 Coachning: kartläggning, aktiviteter, närvaro, avstämningar, månadsbedömningar och -planer, händelser,
-- avvikelser, samtycken, arbetsgivare och praktik.

create table public.intake_assessments (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  work_experience            text not null,
  education                  text not null,
  language_notes             text not null,
  digital_skills             text not null,
  driving_licence            text not null,
  work_goals                 text not null,
  chosen_track               text not null,
  adaptations                text not null,
  first_week_goal            text not null,
  status                     text not null,
  approved_by                text,
  approved_at                timestamptz
);
create index intake_assessments_case_id_idx on public.intake_assessments (case_id);

create table public.activities (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  kind                       text not null,
  starts_at                  timestamptz not null,
  duration_min               integer not null,
  location                   text not null,
  note                       text not null
);
create index activities_case_id_idx on public.activities (case_id);
create index activities_starts_at_idx on public.activities (starts_at);

create table public.attendance (
  id                         text primary key,
  activity_id                text not null references public.activities (id),
  case_id                    text not null references public.cases (id),
  status                     text not null,
  reason                     text not null,
  registered_by              text not null,
  registered_at              timestamptz not null,
  customer_notified_at       timestamptz
);
create index attendance_case_id_idx on public.attendance (case_id);
create index attendance_activity_id_idx on public.attendance (activity_id);

create table public.check_ins (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  held_at                    timestamptz not null,
  duration_min               integer,
  mode                       text,
  input_method               text not null,
  goal_status                text,
  next_goal                  text not null,
  phase                      integer,
  activities_done            text[] not null default '{}',
  employer_contacts          jsonb not null,
  overall_status             text,
  obstacles                  text[] not null default '{}',
  note                       text not null,
  status                     text not null,
  approved_by                text,
  approved_at                timestamptz,
  ai_run_id                  text,
  doc_minutes                integer,
  ai                         jsonb
);
create index check_ins_case_id_idx on public.check_ins (case_id);

create table public.monthly_assessments (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  month                      text not null,
  areas                      jsonb not null,
  status                     text not null,
  decided_by                 text,
  decided_at                 timestamptz,
  summary                    text not null,
  ai_summary_draft           text,
  overall_status             text
);
create index monthly_assessments_case_id_idx on public.monthly_assessments (case_id, month);

create table public.monthly_plans (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  month                      text not null,
  goal1                      text not null,
  goal2                      text not null,
  planned_activities         text not null,
  planned_employer_contact   text not null,
  planned_adaptation         text not null,
  next_customer_meeting      date,
  status                     text not null
);
create index monthly_plans_case_id_idx on public.monthly_plans (case_id, month);

create table public.outcome_events (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  kind                       text not null,
  occurred_on                date not null,
  actor                      text not null,
  verification_kind          text,
  verification_path          text,
  note                       text not null,
  possible_bonus             boolean not null
);
create index outcome_events_case_id_idx on public.outcome_events (case_id);

create table public.deviations (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  created_at                 timestamptz not null,
  description                text not null,
  assessment                 text not null,
  action                     text not null,
  owner_id                   text,
  follow_up_on               date,
  needs_customer_decision    boolean not null,
  follow_up_meeting_at       timestamptz,
  status                     text not null,
  check_in_id                text
);
create index deviations_case_id_idx on public.deviations (case_id);

create table public.consents (
  id                         text primary key,
  person_id                  text not null references public.persons (id),
  case_id                    text not null references public.cases (id),
  kind                       text not null,
  text_version               text not null,
  given_at                   timestamptz,
  declined_at                timestamptz,
  informed_by                text not null,
  language                   text,
  revoked_at                 timestamptz
);
create index consents_case_id_idx on public.consents (case_id);
create index consents_person_id_idx on public.consents (person_id);

create table public.employers (
  id                         text primary key,
  name                       text not null,
  org_nr                     text not null,
  contact_name               text not null,
  phone                      text not null,
  email                      text not null,
  areas                      text[] not null default '{}',
  created_at                 timestamptz,
  created_by                 text
);

create table public.placements (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  employer_id                text not null references public.employers (id),
  starts_on                  date not null,
  ends_on                    date,
  tasks                      text not null,
  supervisor_name            text not null,
  goals                      text not null,
  follow_up_dates            date[] not null default '{}',
  status                     text not null,
  four_rights                jsonb not null
);
create index placements_case_id_idx on public.placements (case_id);
create index placements_employer_id_idx on public.placements (employer_id);

alter table public.intake_assessments enable row level security;
alter table public.activities enable row level security;
alter table public.attendance enable row level security;
alter table public.check_ins enable row level security;
alter table public.monthly_assessments enable row level security;
alter table public.monthly_plans enable row level security;
alter table public.outcome_events enable row level security;
alter table public.deviations enable row level security;
alter table public.consents enable row level security;
alter table public.employers enable row level security;
alter table public.placements enable row level security;
revoke all on public.intake_assessments, public.activities, public.attendance, public.check_ins, public.monthly_assessments, public.monthly_plans,
  public.outcome_events, public.deviations, public.consents, public.employers, public.placements from anon, authenticated;
grant all on public.intake_assessments, public.activities, public.attendance, public.check_ins, public.monthly_assessments, public.monthly_plans,
  public.outcome_events, public.deviations, public.consents, public.employers, public.placements to service_role;
grant select, insert, update on public.intake_assessments, public.activities, public.attendance, public.check_ins, public.monthly_assessments,
  public.monthly_plans, public.outcome_events, public.deviations, public.consents, public.employers, public.placements to authenticated;

-- Arbetsgivare som kommunen ser: de som har praktik i ett ärende där kommunen har åtkomst (uppslag utan RLS).
create function mm.customer_employer_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$
  select distinct p.employer_id from public.placements p
  where p.case_id in (select a.case_id from mm.my_case_access() a where a.access = 'customer')
$$;
grant execute on function mm.customer_employer_ids() to authenticated, service_role;

-- ---------------------------------------------------------------- Anteckningar och bedömningar
-- policy.ts: read notesRead(caseId) = canSeeNotes(access, role) – full eller team, aldrig ekonom eller kommunen;
--            write workOn(caseId) = CASE_WORKERS med full- eller teamåtkomst.
create policy intake_assessments_select on public.intake_assessments for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
create policy intake_assessments_insert on public.intake_assessments for insert to authenticated with check (mm.work_on(case_id));
create policy intake_assessments_update on public.intake_assessments for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id));

create policy check_ins_select on public.check_ins for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
create policy check_ins_insert on public.check_ins for insert to authenticated with check (mm.work_on(case_id));
create policy check_ins_update on public.check_ins for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id));

create policy monthly_assessments_select on public.monthly_assessments for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
create policy monthly_assessments_insert on public.monthly_assessments for insert to authenticated with check (mm.work_on(case_id));
create policy monthly_assessments_update on public.monthly_assessments for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id));

create policy monthly_plans_select on public.monthly_plans for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
create policy monthly_plans_insert on public.monthly_plans for insert to authenticated with check (mm.work_on(case_id));
create policy monthly_plans_update on public.monthly_plans for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id));

create policy deviations_select on public.deviations for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
create policy deviations_insert on public.deviations for insert to authenticated with check (mm.work_on(case_id));
create policy deviations_update on public.deviations for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id));

create policy consents_select on public.consents for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
create policy consents_insert on public.consents for insert to authenticated with check (mm.work_on(case_id));
create policy consents_update on public.consents for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id));

-- ---------------------------------------------------------------- Närvaro: även ekonom (debitering) och kommunen (veckorapport)
-- policy.ts activities/attendance: read access in (full, team, billing, customer), write workOn(caseId)
create policy activities_select on public.activities for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing,customer}'))
);
create policy activities_insert on public.activities for insert to authenticated with check (mm.work_on(case_id));
create policy activities_update on public.activities for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing,customer}'))
) with check (mm.work_on(case_id));

create policy attendance_select on public.attendance for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing,customer}'))
);
create policy attendance_insert on public.attendance for insert to authenticated with check (mm.work_on(case_id));
create policy attendance_update on public.attendance for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing,customer}'))
) with check (mm.work_on(case_id));

-- ---------------------------------------------------------------- Händelser och praktik: resultat som kommunen får i rapporterna
-- policy.ts outcome_events/placements: read canSeePerson(access), write workOn(caseId)
create policy outcome_events_select on public.outcome_events for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
);
create policy outcome_events_insert on public.outcome_events for insert to authenticated with check (mm.work_on(case_id));
create policy outcome_events_update on public.outcome_events for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
) with check (mm.work_on(case_id));

create policy placements_select on public.placements for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
);
create policy placements_insert on public.placements for insert to authenticated with check (mm.work_on(case_id));
create policy placements_update on public.placements for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer}'))
) with check (mm.work_on(case_id));

-- policy.ts employers: read isMB || (isKom && praktik i ett ärende med åtkomst "customer"), write CASE_WORKERS
create policy employers_select on public.employers for select to authenticated using (
  (select mm.is_mb()) or ((select mm.is_kom()) and id in (select mm.customer_employer_ids()))
);
create policy employers_insert on public.employers for insert to authenticated with check (
  (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
);
create policy employers_update on public.employers for update to authenticated using (
  (select mm.is_mb()) or ((select mm.is_kom()) and id in (select mm.customer_employer_ids()))
) with check (
  (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
);
