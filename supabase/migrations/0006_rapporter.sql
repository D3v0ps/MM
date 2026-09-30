-- 0006 Rapporter och kommunikation: rapporter (+ privat lagring för PDF), säkra meddelanden, personliga notiser,
-- läst-markeringar, uppgifter, utskick och kommunens senast öppnade ärenden.

create table public.reports (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  case_id                    text references public.cases (id),
  recipient_user_id          text,
  kind                       text not null,
  week                       text,
  month                      text,
  period_start               date,
  period_end                 date,
  status                     text not null,
  version                    integer not null,
  due_at                     timestamptz,
  approved_by                text,
  approved_at                timestamptz,
  delivered_at               timestamptz,
  delivered_to               text[] not null default '{}',
  opened_at                  timestamptz,
  opened_by                  text,
  provisional_due            boolean not null,
  pdf_path                   text,
  ai_summary_draft           text,
  summary                    text,
  summary_ai_used            boolean not null,
  final_text                 jsonb,
  previous_id                text,
  correction_pending         text,
  superseded                 boolean not null,
  superseded_at              timestamptz,
  superseded_by              text,
  correction_reason          text,
  corrected_by               text,
  corrected_at               timestamptz,
  quality_reviewed_by        text,
  quality_reviewed_at        timestamptz,
  snapshot                   jsonb
);
create index reports_contract_id_idx on public.reports (contract_id, kind);
create index reports_case_id_idx on public.reports (case_id);
create index reports_recipient_user_id_idx on public.reports (recipient_user_id);

create table public.messages (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  sender_id                  text not null,
  body                       text not null,
  created_at                 timestamptz not null,
  read_by                    text[] not null default '{}',
  read_at                    timestamptz,
  kind                       text
);
create index messages_case_id_idx on public.messages (case_id);

create table public.user_notifications (
  id                         text primary key,
  recipient_id               text not null,
  kind                       text not null,
  case_id                    text,
  created_at                 timestamptz not null,
  channels                   text[] not null default '{}',
  title                      text not null,
  body                       text not null,
  email_body                 text not null
);
create index user_notifications_recipient_id_idx on public.user_notifications (recipient_id);

create table public.notification_reads (
  id                         text primary key,
  user_id                    text not null,
  notification_key           text not null,
  read_at                    timestamptz not null
);
create index notification_reads_user_id_idx on public.notification_reads (user_id);

create table public.tasks (
  id                         text primary key,
  to_role                    text not null,
  to_id                      text,
  from_id                    text not null,
  created_at                 timestamptz not null,
  status                     text not null,
  kind                       text,
  case_ids                   text[] not null default '{}',
  text                       text not null,
  deviation_id               text,
  email_id                   text,
  response_id                text,
  month                      text,
  done_at                    timestamptz,
  done_by                    text,
  done_note                  text
);
create index tasks_to_role_idx on public.tasks (to_role, status);

-- Utskick (e-post, SMS, brev) – innehåller aldrig personuppgifter. Skrivs bara av servern (ctx.notify, service role).
-- status: queued | sent | failed | suppressed (stoppad, t.ex. av spärren i testmiljön) | manual (brev). Orsaken i status_reason.
create table public.outbound_messages (
  id                         text primary key,
  created_at                 timestamptz not null,
  channel                    text not null,
  "to"                       text not null,
  template                   text not null,
  subject                    text,
  body                       text not null,
  case_id                    text,
  status                     text not null,
  sent_at                    timestamptz,
  status_reason              text,
  provider_message_id        text
);
create index outbound_messages_created_at_idx on public.outbound_messages (created_at);
create index outbound_messages_status_idx on public.outbound_messages (status);
create index outbound_messages_case_id_idx on public.outbound_messages (case_id);

create table public.case_seen (
  id                         text primary key,
  user_id                    text not null references public.profiles (id),
  case_id                    text not null references public.cases (id),
  seen_at                    timestamptz not null
);
create index case_seen_user_id_idx on public.case_seen (user_id);

alter table public.reports enable row level security;
alter table public.messages enable row level security;
alter table public.user_notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.tasks enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.case_seen enable row level security;
revoke all on public.reports, public.messages, public.user_notifications, public.notification_reads, public.tasks, public.outbound_messages,
  public.case_seen from anon, authenticated;
grant all on public.reports, public.messages, public.user_notifications, public.notification_reads, public.tasks, public.outbound_messages,
  public.case_seen to service_role;
grant select, insert, update on public.reports, public.messages, public.notification_reads, public.tasks, public.case_seen to authenticated;
grant select on public.user_notifications, public.outbound_messages to authenticated;

-- Avtal där kommunens chef ser enhetens individrapporter (config.customerVisibility.seesIndividualReports).
create function mm.individual_report_contract_ids() returns text[]
language sql stable security definer set search_path = public, mm
as $$
  select coalesce(array_agg(c.id), '{}') from public.contracts c
  where c.config #> '{customerVisibility,seesIndividualReports}' = 'true'::jsonb
$$;
grant execute on function mm.individual_report_contract_ids() to authenticated, service_role;

-- ---------------------------------------------------------------- Rapporter (policy.ts reportRead / reportWrite)
-- reportRead: medlem i avtalet;
--   MB: aldrig ekonom · veckorapporter alla · beställar- och statistikrapporter OVERSIGHT · aldrig handledare (månads- och
--       slutrapporter innehåller coachens bedömningar) · utan ärende OVERSIGHT · annars canSeeNotes(access)
--   kommunen: bara levererade · utan ärende: till mig · ärendet med åtkomst "customer" och till mig, eller kommunens chef när
--       avtalet säger att chefen ser enhetens individrapporter
create policy reports_select on public.reports for select to authenticated using (
  case
    when not mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids())) then false
    when (select mm.is_mb()) then case
      when (select mm.current_role()) = 'ekonom' then false
      when kind = 'weekly_attendance' then true
      when kind in ('customer_summary', 'statistics') then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      when (select mm.current_role()) = 'handledare' then false
      when nullif(case_id, '') is null then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      else case_id in (select mm.case_ids('{full,team}'))
    end
    when (select mm.is_kom()) then case
      when delivered_at is null then false
      when nullif(case_id, '') is null then coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
      when case_id not in (select mm.case_ids('{customer}')) then false
      when coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false) then true
      else (select mm.current_role()) = 'kommun_chef' and contract_id = any ((select mm.individual_report_contract_ids()))
    end
    else false
  end
);
-- reportWrite (ny rad): kommunen aldrig; MB-medlem: veckorapport CASE_WORKERS · beställar- och statistikrapport samordnare och
-- avtalsansvarig · rapport för ett ärende CASE_EDITORS med full åtkomst.
create policy reports_insert on public.reports for insert to authenticated with check (
  (select mm.is_mb())
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and case
    when kind = 'weekly_attendance' then (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
    when kind in ('customer_summary', 'statistics') then (select mm.role_in('{samordnare,avtalsansvarig}'))
    when nullif(case_id, '') is not null then (select mm.role_in('{samordnare,avtalsansvarig,coach}')) and mm.case_access(case_id) = 'full'
    else false
  end
);
-- reportWrite (ändring): kommunen får kvittera (openedAt) en rapport den får läsa; MB som ovan.
create policy reports_update on public.reports for update to authenticated using (
  case
    when not mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids())) then false
    when (select mm.is_mb()) then case
      when (select mm.current_role()) = 'ekonom' then false
      when kind = 'weekly_attendance' then true
      when kind in ('customer_summary', 'statistics') then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      when (select mm.current_role()) = 'handledare' then false
      when nullif(case_id, '') is null then (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
      else case_id in (select mm.case_ids('{full,team}'))
    end
    when (select mm.is_kom()) then case
      when delivered_at is null then false
      when nullif(case_id, '') is null then coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
      when case_id not in (select mm.case_ids('{customer}')) then false
      when coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false) then true
      else (select mm.current_role()) = 'kommun_chef' and contract_id = any ((select mm.individual_report_contract_ids()))
    end
    else false
  end
) with check (
  case
    when (select mm.is_kom()) then
      mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and case
        when delivered_at is null then false
        when nullif(case_id, '') is null then coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false)
        when case_id not in (select mm.case_ids('{customer}')) then false
        when coalesce((select mm.current_profile_id()) = any (delivered_to) or recipient_user_id = (select mm.current_profile_id()), false) then true
        else (select mm.current_role()) = 'kommun_chef' and contract_id = any ((select mm.individual_report_contract_ids()))
      end
    when (select mm.is_mb()) then
      mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and case
        when kind = 'weekly_attendance' then (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
        when kind in ('customer_summary', 'statistics') then (select mm.role_in('{samordnare,avtalsansvarig}'))
        when nullif(case_id, '') is not null then (select mm.role_in('{samordnare,avtalsansvarig,coach}')) and mm.case_access(case_id) = 'full'
        else false
      end
    else false
  end
);

-- ---------------------------------------------------------------- Meddelanden (policy.ts messageRead och messages.write)
-- read: MB (utom ekonom) med full- eller teamåtkomst, kommunen med åtkomst "customer".
create policy messages_select on public.messages for select to authenticated using (
  case
    when (select mm.is_mb()) then (select mm.current_role()) <> 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
    when (select mm.is_kom()) then case_id in (select mm.case_ids('{customer}'))
    else false
  end
);
-- write, ny rad: avsändaren är aktören; MB: CASE_WORKERS med full/team; kommunen: handläggaren med åtkomst "customer".
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = (select mm.current_profile_id())
  and case
    when (select mm.is_mb()) then (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}')) and case_id in (select mm.case_ids('{full,team}'))
    else (select mm.current_role()) = 'kommun_handlaggare' and case_id in (select mm.case_ids('{customer}'))
  end
);
-- write, ändring (läskvitto): den som får läsa meddelandet och är kommunen eller CASE_WORKERS.
create policy messages_update on public.messages for update to authenticated using (
  case
    when (select mm.is_mb()) then (select mm.current_role()) <> 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
    when (select mm.is_kom()) then case_id in (select mm.case_ids('{customer}'))
    else false
  end
) with check (
  case
    when (select mm.is_mb()) then (select mm.current_role()) <> 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
      and (select mm.role_in('{samordnare,avtalsansvarig,coach,handledare}'))
    when (select mm.is_kom()) then case_id in (select mm.case_ids('{customer}'))
    else false
  end
);

-- ---------------------------------------------------------------- Notiser, läst-markeringar, uppgifter, utskick
-- policy.ts user_notifications: read bara mottagaren, write never (skapas via ctx.system)
create policy user_notifications_select on public.user_notifications for select to authenticated using (
  recipient_id = (select mm.current_profile_id())
);

-- policy.ts notification_reads: read och write bara användaren själv
create policy notification_reads_select on public.notification_reads for select to authenticated using (user_id = (select mm.current_profile_id()));
create policy notification_reads_insert on public.notification_reads for insert to authenticated with check (user_id = (select mm.current_profile_id()));
create policy notification_reads_update on public.notification_reads for update to authenticated
  using (user_id = (select mm.current_profile_id())) with check (user_id = (select mm.current_profile_id()));

-- policy.ts tasks.read: avsändaren, admin, mottagaren (toId, annars rollen) eller MB (utom ekonom) som får se
-- anteckningar i något av uppgiftens ärenden.
create policy tasks_select on public.tasks for select to authenticated using (
  from_id = (select mm.current_profile_id())
  or (select mm.current_role()) = 'admin'
  or case when nullif(to_id, '') is not null then to_id = (select mm.current_profile_id()) else to_role = (select mm.current_role()) end
  or ((select mm.is_mb()) and (select mm.current_role()) <> 'ekonom' and case_ids && array (select mm.case_ids('{full,team}')))
);
-- policy.ts tasks.write: ny uppgift – MB och avsändaren är aktören; ändring (klarmarkera) – avsändaren eller mottagaren.
create policy tasks_insert on public.tasks for insert to authenticated with check (
  (select mm.is_mb()) and from_id = (select mm.current_profile_id())
);
create policy tasks_update on public.tasks for update to authenticated using (
  from_id = (select mm.current_profile_id())
  or (select mm.current_role()) = 'admin'
  or case when nullif(to_id, '') is not null then to_id = (select mm.current_profile_id()) else to_role = (select mm.current_role()) end
  or ((select mm.is_mb()) and (select mm.current_role()) <> 'ekonom' and case_ids && array (select mm.case_ids('{full,team}')))
) with check (
  from_id = (select mm.current_profile_id())
  or case when nullif(to_id, '') is not null then to_id = (select mm.current_profile_id()) else to_role = (select mm.current_role()) end
);

-- policy.ts outbound_messages: read admin och samordnare, write never (bara via ctx.notify)
create policy outbound_messages_select on public.outbound_messages for select to authenticated using (
  (select mm.role_in('{admin,samordnare}'))
);

-- policy.ts case_seen: read och write bara användaren själv
create policy case_seen_select on public.case_seen for select to authenticated using (user_id = (select mm.current_profile_id()));
create policy case_seen_insert on public.case_seen for insert to authenticated with check (user_id = (select mm.current_profile_id()));
create policy case_seen_update on public.case_seen for update to authenticated
  using (user_id = (select mm.current_profile_id())) with check (user_id = (select mm.current_profile_id()));

-- Privat bucket för rapporternas PDF:er (bara service role). Hoppas över där Supabase Storage saknas.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;
  end if;
end
$$;
