-- 0004 Avrop: mejl till avrop@ och privat lagring för mejl och bilagor.

create table public.inbound_emails (
  id                         text primary key,
  graph_message_id           text not null,
  received_at                timestamptz not null,
  from_address               text not null,
  from_name                  text not null,
  subject                    text not null,
  body_text                  text not null,
  attachments                jsonb not null default '[]',
  parse_method               text not null,
  classification             text not null,
  extracted                  jsonb not null default '{}',
  confidence                 jsonb not null default '{}',
  missing_fields             text[] not null default '{}',
  corrections                jsonb not null default '{}',
  status                     text not null,
  case_id                    text references public.cases (id),
  ack_sent_at                timestamptz,
  ack_kind                   text,
  ai_run_id                  text,
  linked_by                  text,
  registered_by              text,
  registered_at              timestamptz,
  handled_by                 text,
  handled_at                 timestamptz
);
create index inbound_emails_case_id_idx on public.inbound_emails (case_id);
create index inbound_emails_received_at_idx on public.inbound_emails (received_at);
create index inbound_emails_graph_message_id_idx on public.inbound_emails (graph_message_id);

alter table public.inbound_emails enable row level security;
revoke all on public.inbound_emails from anon, authenticated;
grant all on public.inbound_emails to service_role;

-- policy.ts inbound_emails.read: OVERSIGHT && (!caseId || classification === "order_protected" || access not in (none, restricted))
-- Mejl om skyddade personuppgifter innehåller inga uppgifter om deltagaren (bara "ring mig").
create policy inbound_emails_select on public.inbound_emails for select to authenticated using (
  (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
  and (nullif(case_id, '') is null
       or classification = 'order_protected'
       or case_id in (select mm.case_ids('{full,team,billing,customer}')))
);
-- policy.ts inbound_emails.write: (samordnare || avtalsansvarig) && (!caseId || access === "full")
create policy inbound_emails_insert on public.inbound_emails for insert to authenticated with check (
  (select mm.role_in('{samordnare,avtalsansvarig}'))
  and (nullif(case_id, '') is null or mm.case_access(case_id) = 'full')
);
create policy inbound_emails_update on public.inbound_emails for update to authenticated using (
  (select mm.role_in('{samordnare,avtalsansvarig,chef,admin}'))
  and (nullif(case_id, '') is null
       or classification = 'order_protected'
       or case_id in (select mm.case_ids('{full,team,billing,customer}')))
) with check (
  (select mm.role_in('{samordnare,avtalsansvarig}'))
  and (nullif(case_id, '') is null or mm.case_access(case_id) = 'full')
);
grant select, insert, update on public.inbound_emails to authenticated;

-- Privat bucket för mejl och bilagor (bara service role – inga policyer för storage.objects).
-- Hoppas över där Supabase Storage saknas (t.ex. lokala tester i PGlite).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('inbound-emails', 'inbound-emails', false) on conflict (id) do nothing;
  end if;
end
$$;
