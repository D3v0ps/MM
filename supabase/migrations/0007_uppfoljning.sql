-- 0007 Uppföljning: avtalsavvikelser, flaggor och kvittenser, deadlines, KPI-ögonblicksbilder, pulsmätning, bonusanspråk.

create table public.contract_deviations (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  case_id                    text references public.cases (id),
  source                     text not null,
  type                       text not null,
  level                      text not null,
  escalation_step            integer not null,
  description                text not null,
  raised_at                  timestamptz not null,
  registered_by              text,
  action_plan                text not null,
  action_plan_due            date,
  owner_id                   text,
  plan_submitted_at          timestamptz,
  customer_approved_at       timestamptz,
  customer_approved_by       text,
  warning_issued             boolean not null,
  warning_issued_at          timestamptz,
  penalty_kind               text,
  penalty_ore                bigint not null,
  penalty_offset_month       text,
  order_stop                 boolean not null,
  status                     text not null,
  lessons                    text not null,
  closed_at                  timestamptz,
  closed_by                  text
);
create index contract_deviations_contract_id_idx on public.contract_deviations (contract_id);
create index contract_deviations_case_id_idx on public.contract_deviations (case_id);

create table public.alerts (
  id                         text primary key,
  key                        text not null,
  contract_id                text not null references public.contracts (id),
  case_id                    text references public.cases (id),
  kind                       text not null,
  severity                   text not null,
  title                      text not null,
  message                    text not null,
  recipient_roles            text[] not null default '{}',
  created_at                 timestamptz not null,
  acknowledged_by            text,
  acknowledged_at            timestamptz,
  action_plan                text
);
create index alerts_contract_id_idx on public.alerts (contract_id);
create index alerts_case_id_idx on public.alerts (case_id);
create index alerts_key_idx on public.alerts (key);

create table public.alert_acks (
  id                         text primary key,
  alert_key                  text not null,
  acknowledged_by            text not null,
  acknowledged_at            timestamptz not null,
  action_plan                text not null
);

create table public.deadlines (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  case_id                    text references public.cases (id),
  report_id                  text,
  kind                       text not null,
  due_at                     timestamptz not null,
  met_at                     timestamptz,
  status                     text not null
);
create index deadlines_contract_id_idx on public.deadlines (contract_id, status);
create index deadlines_case_id_idx on public.deadlines (case_id);

create table public.kpi_snapshots (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  kpi_key                    text not null,
  "window"                   text not null,
  value                      numeric,
  numerator                  integer not null,
  denominator                integer not null,
  computed_at                timestamptz not null
);
create index kpi_snapshots_contract_id_idx on public.kpi_snapshots (contract_id, kpi_key);

-- Pulslänken: bara hashen av engångstoken lagras (aldrig token i klartext).
create table public.pulse_invites (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  token_hash                 text,
  channel                    text not null,
  language                   text not null,
  occasion                   text not null,
  sent_at                    timestamptz not null,
  expires_at                 timestamptz not null,
  used_at                    timestamptz
);
create index pulse_invites_case_id_idx on public.pulse_invites (case_id);
create unique index pulse_invites_token_hash_key on public.pulse_invites (token_hash) where token_hash is not null;

create table public.pulse_responses (
  id                         text primary key,
  invite_id                  text not null references public.pulse_invites (id),
  case_id                    text not null references public.cases (id),
  coach_id                   text,
  occasion                   text not null,
  language                   text not null,
  answers                    jsonb not null,
  text                       text not null,
  contact_requested          boolean not null,
  submitted_at               timestamptz not null
);
create index pulse_responses_case_id_idx on public.pulse_responses (case_id);
create index pulse_responses_invite_id_idx on public.pulse_responses (invite_id);
create index pulse_responses_coach_id_idx on public.pulse_responses (coach_id);

create table public.bonus_claims (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  kind                       text not null,
  basis                      text not null,
  evidence_paths             text[] not null default '{}',
  submitted_at               timestamptz,
  customer_decision          text,
  decided_by                 text,
  decided_at                 timestamptz,
  amount_ore                 bigint,
  invoice_draft_id           text
);
create index bonus_claims_case_id_idx on public.bonus_claims (case_id);

alter table public.contract_deviations enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_acks enable row level security;
alter table public.deadlines enable row level security;
alter table public.kpi_snapshots enable row level security;
alter table public.pulse_invites enable row level security;
alter table public.pulse_responses enable row level security;
alter table public.bonus_claims enable row level security;
revoke all on public.contract_deviations, public.alerts, public.alert_acks, public.deadlines, public.kpi_snapshots, public.pulse_invites,
  public.pulse_responses, public.bonus_claims from anon, authenticated;
grant all on public.contract_deviations, public.alerts, public.alert_acks, public.deadlines, public.kpi_snapshots, public.pulse_invites,
  public.pulse_responses, public.bonus_claims to service_role;
grant select, insert, update on public.contract_deviations, public.alert_acks, public.pulse_invites, public.bonus_claims to authenticated;
grant select, update on public.alerts to authenticated;
grant select on public.deadlines, public.kpi_snapshots to authenticated;
grant select, insert on public.pulse_responses to authenticated;

-- Pulslänken är oanvänd och hör till ärendet (uppslag utan RLS – policy.ts raw.get("pulse_invites", id)).
create function mm.pulse_invite_open(p_invite_id text, p_case_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select coalesce((select i.used_at is null and i.case_id = p_case_id from public.pulse_invites i where i.id = p_invite_id), false)
$$;
grant execute on function mm.pulse_invite_open(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- Avtalsavvikelser
-- policy.ts contract_deviations.read: medlem; OVERSIGHT: utan ärende eller åtkomst till ärendet;
-- kommunens chef (godkänner åtgärdsplaner): utan ärende eller åtkomst "customer".
create policy contract_deviations_select on public.contract_deviations for select to authenticated using (
  mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and case
    when (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      then nullif(case_id, '') is null or case_id in (select mm.case_ids('{full,team,restricted,billing,customer}'))
    when (select mm.current_role()) = 'kommun_chef'
      then nullif(case_id, '') is null or case_id in (select mm.case_ids('{customer}'))
    else false
  end
);
-- policy.ts contract_deviations.write: samordnare, avtalsansvarig, chef i avtalet; kommunens chef bara ändring (godkännande).
create policy contract_deviations_insert on public.contract_deviations for insert to authenticated with check (
  (select mm.role_in('{samordnare,avtalsansvarig,chef}'))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy contract_deviations_update on public.contract_deviations for update to authenticated using (
  mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and case
    when (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      then nullif(case_id, '') is null or case_id in (select mm.case_ids('{full,team,restricted,billing,customer}'))
    when (select mm.current_role()) = 'kommun_chef'
      then nullif(case_id, '') is null or case_id in (select mm.case_ids('{customer}'))
    else false
  end
) with check (
  (select mm.role_in('{samordnare,avtalsansvarig,chef,kommun_chef}'))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- ---------------------------------------------------------------- Bonusanspråk
-- policy.ts bonus_claims.read: access in (full, team, customer, billing)
create policy bonus_claims_select on public.bonus_claims for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer,billing}'))
);
-- policy.ts bonus_claims.write: workOn; ändring även beställande handläggare ("customer") och ekonom ("billing").
create policy bonus_claims_insert on public.bonus_claims for insert to authenticated with check (mm.work_on(case_id));
create policy bonus_claims_update on public.bonus_claims for update to authenticated using (
  case_id in (select mm.case_ids('{full,team,customer,billing}'))
) with check (
  mm.work_on(case_id)
  or ((select mm.current_role()) = 'kommun_handlaggare' and mm.case_access(case_id) = 'customer'
      and nullif(mm.case_referrer_id(case_id), '') is not null and mm.case_referrer_id(case_id) = (select mm.current_profile_id()))
  or ((select mm.current_role()) = 'ekonom' and mm.case_access(case_id) = 'billing')
);

-- ---------------------------------------------------------------- Puls: coachen läser aldrig enskilda svar
-- policy.ts pulse_invites: read notesRead(caseId), write workOn(caseId)
create policy pulse_invites_select on public.pulse_invites for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
create policy pulse_invites_insert on public.pulse_invites for insert to authenticated with check (mm.work_on(case_id));
create policy pulse_invites_update on public.pulse_invites for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id));

-- policy.ts pulse_responses.read: OVERSIGHT med full åtkomst (coachen ser bara aggregat via ctx.system)
create policy pulse_responses_select on public.pulse_responses for select to authenticated using (
  (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}')) and case_id in (select mm.case_ids('{full}'))
);
-- policy.ts pulse_responses.write: deltagaren, ny rad, oanvänd pulslänk till samma ärende (tokenkontrollen görs av hanteraren)
create policy pulse_responses_insert on public.pulse_responses for insert to authenticated with check (
  (select mm.current_role()) = 'deltagare' and mm.pulse_invite_open(invite_id, case_id)
);

-- ---------------------------------------------------------------- KPI:er, flaggor, deadlines (interna – aldrig kommunen eller ekonomen)
-- policy.ts kpi_snapshots: read (samordnare, avtalsansvarig, chef, admin, coach) && member, write never
create policy kpi_snapshots_select on public.kpi_snapshots for select to authenticated using (
  (select mm.role_in('{samordnare,avtalsansvarig,chef,admin,coach}'))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- policy.ts alerts.read: MB utom ekonom, medlem, mottagarroll (eller chef/admin), åtkomst till ärendet
create policy alerts_select on public.alerts for select to authenticated using (
  (select mm.is_mb()) and (select mm.current_role()) <> 'ekonom'
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and ((select mm.current_role()) = any (recipient_roles) or (select mm.role_in('{chef,admin}')))
  and (nullif(case_id, '') is null or case_id in (select mm.case_ids('{full,team,restricted,billing,customer}')))
);
-- policy.ts alerts.write: bara ändring (kvittens) av mottagarrollen i avtalet – flaggor skapas av systemet
create policy alerts_update on public.alerts for update to authenticated using (
  (select mm.is_mb()) and (select mm.current_role()) <> 'ekonom'
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and ((select mm.current_role()) = any (recipient_roles) or (select mm.role_in('{chef,admin}')))
  and (nullif(case_id, '') is null or case_id in (select mm.case_ids('{full,team,restricted,billing,customer}')))
) with check (
  (select mm.is_mb()) and (select mm.current_role()) = any (recipient_roles)
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- policy.ts alert_acks: read isMB, write isMB && self(acknowledgedBy)
create policy alert_acks_select on public.alert_acks for select to authenticated using ((select mm.is_mb()));
create policy alert_acks_insert on public.alert_acks for insert to authenticated with check (
  (select mm.is_mb()) and acknowledged_by = (select mm.current_profile_id())
);
create policy alert_acks_update on public.alert_acks for update to authenticated using ((select mm.is_mb())) with check (
  (select mm.is_mb()) and acknowledged_by = (select mm.current_profile_id())
);

-- policy.ts deadlines: read MB utom ekonom, medlem, åtkomst till ärendet; write never
create policy deadlines_select on public.deadlines for select to authenticated using (
  (select mm.is_mb()) and (select mm.current_role()) <> 'ekonom'
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and (nullif(case_id, '') is null or case_id in (select mm.case_ids('{full,team,restricted,billing,customer}')))
);
