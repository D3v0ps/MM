-- 0008 Fakturering: körningar per månad, fakturautkast (ett per ärende och månad), rader, godkända nollveckor,
-- krediteringar, Fortnox-körningar och integrationer (hemligheter krypterade i appen).

create table public.billing_runs (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  month                      text not null,
  status                     text not null,
  created_by                 text not null,
  created_at                 timestamptz not null,
  closed_at                  timestamptz,
  closed_by                  text,
  default_invoice_status     text
);
create index billing_runs_contract_id_idx on public.billing_runs (contract_id, month);

create table public.invoice_drafts (
  id                         text primary key,
  billing_run_id             text,
  contract_id                text not null references public.contracts (id),
  month                      text not null,
  kind                       text not null,
  case_id                    text references public.cases (id),
  grouping_key               text not null,
  buyer_reference            text,
  purchase_order_number      text,
  invoiced_object            text not null,
  accrued_ore                bigint,
  remaining_ore              bigint,
  status                     text not null,
  approved_by                text,
  approved_at                timestamptz,
  manual_invoice_no          text,
  fortnox_document_number    text,
  fortnox_idempotency_key    text,
  fortnox_created_at         timestamptz,
  synced_at                  timestamptz
  -- Format på beställarreferens och inköpsordernummer valideras i appen mot avtalskonfigurationen (billing.buyerReference,
  -- billing.purchaseOrderNumber) – inga avtalsvärden hårdkodas i databasen (CLAUDE.md punkt 4).
);
create index invoice_drafts_contract_id_idx on public.invoice_drafts (contract_id, month);
create index invoice_drafts_case_id_idx on public.invoice_drafts (case_id);
-- Samma faktura skapas aldrig två gånger i Fortnox (idempotensnyckel `${month}:${caseId}`).
create unique index invoice_drafts_fortnox_idempotency_key on public.invoice_drafts (fortnox_idempotency_key) where fortnox_idempotency_key is not null;

create table public.invoice_lines (
  id                         text primary key,
  invoice_draft_id           text not null references public.invoice_drafts (id),
  case_id                    text not null references public.cases (id),
  price_item_id              text not null,
  quantity                   numeric not null,
  unit_price_ore             bigint not null,
  vat_rate                   numeric not null,
  description                text not null,
  iso_weeks                  text[] not null default '{}',
  zero_attendance_weeks      text[] not null default '{}'
);
create index invoice_lines_invoice_draft_id_idx on public.invoice_lines (invoice_draft_id);

create table public.billing_week_approvals (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  month                      text not null,
  case_id                    text not null references public.cases (id),
  week_key                   text not null,
  approved_by                text not null,
  approved_at                timestamptz not null,
  note                       text not null
);
create index billing_week_approvals_contract_id_idx on public.billing_week_approvals (contract_id, month);

create table public.invoice_credits (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  month                      text not null,
  case_id                    text not null references public.cases (id),
  credited_at                timestamptz not null,
  credited_by                text not null,
  buyer_reference            text
);
create index invoice_credits_contract_id_idx on public.invoice_credits (contract_id, month);

create table public.fortnox_runs (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  month                      text not null,
  kind                       text not null check (kind in ('create', 'sync')),
  ran_at                     timestamptz not null,
  ran_by                     text not null,
  created                    integer not null,
  skipped                    integer not null,
  not_ready                  integer not null,
  blocked                    integer not null,
  changed                    integer not null
);
create index fortnox_runs_contract_id_idx on public.fortnox_runs (contract_id, month);

create table public.integrations (
  id                         text primary key,
  kind                       text not null,
  name                       text not null,
  status                     text not null,
  config                     jsonb not null default '{}',
  secrets_enc                text,
  token_expires_at           timestamptz
);

alter table public.billing_runs enable row level security;
alter table public.invoice_drafts enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.billing_week_approvals enable row level security;
alter table public.invoice_credits enable row level security;
alter table public.fortnox_runs enable row level security;
alter table public.integrations enable row level security;
revoke all on public.billing_runs, public.invoice_drafts, public.invoice_lines, public.billing_week_approvals, public.invoice_credits,
  public.fortnox_runs, public.integrations from anon, authenticated;
grant all on public.billing_runs, public.invoice_drafts, public.invoice_lines, public.billing_week_approvals, public.invoice_credits,
  public.fortnox_runs, public.integrations to service_role;
grant select, insert, update on public.billing_runs, public.invoice_drafts, public.invoice_lines, public.billing_week_approvals,
  public.invoice_credits, public.fortnox_runs, public.integrations to authenticated;

-- Fakturautkast i aktörens avtal (uppslag utan RLS – policy.ts raw.get("invoice_drafts", id)?.contractId).
create function mm.my_invoice_draft_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$ select d.id from public.invoice_drafts d where d.contract_id = any (mm.my_contract_ids()) $$;
grant execute on function mm.my_invoice_draft_ids() to authenticated, service_role;

-- ---------------------------------------------------------------- Policyer
-- policy.ts billing_runs, invoice_drafts, billing_week_approvals, invoice_credits, fortnox_runs:
--   read BILLING_READERS (ekonom, chef, avtalsansvarig, admin) && member; write ekonom && member
create policy billing_runs_select on public.billing_runs for select to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy billing_runs_insert on public.billing_runs for insert to authenticated with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy billing_runs_update on public.billing_runs for update to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

create policy invoice_drafts_select on public.invoice_drafts for select to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy invoice_drafts_insert on public.invoice_drafts for insert to authenticated with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy invoice_drafts_update on public.invoice_drafts for update to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

create policy billing_week_approvals_select on public.billing_week_approvals for select to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy billing_week_approvals_insert on public.billing_week_approvals for insert to authenticated with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy billing_week_approvals_update on public.billing_week_approvals for update to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

create policy invoice_credits_select on public.invoice_credits for select to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy invoice_credits_insert on public.invoice_credits for insert to authenticated with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy invoice_credits_update on public.invoice_credits for update to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

create policy fortnox_runs_select on public.fortnox_runs for select to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy fortnox_runs_insert on public.fortnox_runs for insert to authenticated with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
create policy fortnox_runs_update on public.fortnox_runs for update to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}')) and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
) with check (
  (select mm.current_role()) = 'ekonom' and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);

-- policy.ts invoice_lines: samma regler via fakturautkastets avtal (member(a, undefined) är sant bara för admin)
create policy invoice_lines_select on public.invoice_lines for select to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}'))
  and ((select mm.current_role()) = 'admin' or invoice_draft_id in (select mm.my_invoice_draft_ids()))
);
create policy invoice_lines_insert on public.invoice_lines for insert to authenticated with check (
  (select mm.current_role()) = 'ekonom' and invoice_draft_id in (select mm.my_invoice_draft_ids())
);
create policy invoice_lines_update on public.invoice_lines for update to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}'))
  and ((select mm.current_role()) = 'admin' or invoice_draft_id in (select mm.my_invoice_draft_ids()))
) with check (
  (select mm.current_role()) = 'ekonom' and invoice_draft_id in (select mm.my_invoice_draft_ids())
);

-- policy.ts integrations: bara admin
create policy integrations_select on public.integrations for select to authenticated using ((select mm.current_role()) = 'admin');
create policy integrations_insert on public.integrations for insert to authenticated with check ((select mm.current_role()) = 'admin');
create policy integrations_update on public.integrations for update to authenticated
  using ((select mm.current_role()) = 'admin') with check ((select mm.current_role()) = 'admin');
