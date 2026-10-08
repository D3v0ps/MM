-- 0023 En faktura per avtal och månad med en rad per ärende (beslut 2026-10-07, Karim, synpunkt #13 och beslut 3).
--
-- Fakturaunderlaget räknas som förut (debiterbara veckor per ärende, torsdagsregeln, pris och momssats per artikel) – bara
-- grupperingen ändras (src/core/billing.ts): en periodisk faktura (invoice_drafts, kind 'periodic') per avtal och månad med
-- grouping_key 'avtal', och en rad per ärende (invoice_lines). Beställarreferensen fylls i av Miljonbemanning, en per faktura
-- (invoice_drafts.buyer_reference), och kontrolleras i appen innan fakturan skapas (CLAUDE.md punkt 11, oförändrad).
-- Inköpsordernumret (99…) är fortfarande bara kommunens eget ordernummer.
--   1. invoice_lines: radens anmärkning (Peppol BT-127, upparbetat och återstående) och en rad per ärende och faktura.
--   2. invoice_credits gäller en faktura (invoice_draft_id). case_id finns kvar för äldre rader och blir valfri.
--   3. Fakturorna per ärende och månad blir fakturor per avtal och månad – exakt som den gamla modellen räknade: ärendets
--      status i månaden var ärendets egen faktura, annars körningens standardstatus (billing_runs.default_invoice_status),
--      annars underlag. Varje skapad status i månaden (fortnox_created, manual, booked, sent, paid, returned) blir en egen
--      faktura ('avtal' för körningens standardstatus eller den högsta statusen, sedan 'avtal-tillagg-2' …) med en rad per
--      ärende som hade den statusen. Raden har inga veckor (iso_weeks '{}') och täcker därför ärendets alla debiterbara
--      veckor i månaden (src/core/billing.ts); anmärkningen sparar de gamla fakturanumren (Fortnox och manuellt). Ärenden
--      som inte var fakturerade får ingen rad – de är underlag och räknas som ofakturerade som förut. Vilka ärenden som har
--      debiterbara veckor räknas som i appen (ISO-veckor med torsdagen i månaden från startveckan till slutdatumet, pausade
--      veckor undantagna). Godkännanden per ärende följer inte med (ekonomen godkänner fakturan). Testmiljön läses in på
--      nytt efter migreringen ("Läs in testdata på nytt"); produktionen har inga fakturor ännu.
--   4. billing_runs.default_invoice_status behövs inte längre.
--   5. En periodisk faktura per avtal, månad och grupp (tilläggsfakturor: 'avtal-tillagg-2' …).
--   6. Raderna fryses när fakturan skapas: ekonomen får bara lägga till, ändra och ta bort rader medan fakturan är underlag,
--      godkänd eller returnerad (mm.invoice_editable) – en returnerad faktura görs om med raderna frysta på nytt från dagens
--      underlag (eko.reissue). Raderna skrivs med fasta id:n och statusen ändras sist, så att en skapelse som avbröts kan
--      göras om. Samma regel i src/data/policy.ts (invoice_lines.write).
-- Vilka roller som läser och skriver är oförändrat (läser: ekonom, chef, avtalsansvarig, admin; skriver: ekonom). Belopp visas
-- bara för ekonomen (beslut 5) – den spärren ligger i appens hanterare (src/api/tester-access.ts, hidesMoney).
-- Migrationen skrivs men appliceras inte förrän omgångarna är sammanfogade (driftordning: 0023–0026 tillsammans, i nummerordning).

-- ---------------------------------------------------------------- 1. Fakturaraderna
alter table public.invoice_lines add column note text not null default '';
create unique index invoice_lines_draft_case_key on public.invoice_lines (invoice_draft_id, case_id);

-- ---------------------------------------------------------------- 2. Kreditering per faktura
alter table public.invoice_credits add column invoice_draft_id text references public.invoice_drafts (id);
alter table public.invoice_credits alter column case_id drop not null;
alter table public.invoice_credits add constraint invoice_credits_target_check check (invoice_draft_id is not null or case_id is not null);
create index invoice_credits_invoice_draft_id_idx on public.invoice_credits (invoice_draft_id);

-- ---------------------------------------------------------------- 3. Fakturorna per ärende blir fakturor per avtal och månad
-- Ärenden med minst en debiterbar vecka i körningens månad (som billableWeeks i src/core/billing.ts: måndagarna från
-- startveckan till slutdatumet – pågående ärenden till månadens slut – där torsdagen infaller i månaden och veckan inte är pausad).
create temporary table mm_0023_billable as
select distinct r.contract_id, r.month, c.id as case_id
from public.billing_runs r
join public.cases c on c.contract_id = r.contract_id and c.start_date is not null
cross join lateral generate_series(
  date_trunc('week', c.start_date)::date,
  coalesce(c.end_date, (to_date(r.month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date),
  interval '7 days'
) as w (monday)
where to_char(w.monday::date + 3, 'YYYY-MM') = r.month
  and not (to_char(w.monday::date, 'IYYY-"W"IW') = any (c.paused_weeks));

-- Ärendets status i månaden i den gamla modellen: egen faktura, annars körningens standardstatus, annars underlag.
create temporary table mm_0023_status as
select b.contract_id, b.month, b.case_id, r.id as run_id, r.default_invoice_status as default_status,
       coalesce(d.status, r.default_invoice_status, 'draft') as status,
       coalesce(d.buyer_reference, c.buyer_reference) as ref, d.fortnox_document_number, d.manual_invoice_no
from mm_0023_billable b
join public.billing_runs r on r.contract_id = b.contract_id and r.month = b.month
join public.cases c on c.id = b.case_id
left join public.invoice_drafts d on d.kind = 'periodic' and d.case_id = b.case_id and d.contract_id = b.contract_id and d.month = b.month;

-- En faktura per skapad status och månad: körningens standardstatus först ('avtal'), sedan den högsta statusen.
create temporary table mm_0023_groups as
with invoice_status_rank (status, rank) as (
  values ('returned', 0), ('fortnox_created', 1), ('manual', 2), ('booked', 3), ('sent', 4), ('paid', 5)
), per_status as (
  select s.contract_id, s.month, s.run_id, s.status, bool_or(s.status = s.default_status) as is_default, min(k.rank) as rank,
         case when count(distinct s.ref) = 1 and count(s.ref) = count(*) then min(s.ref) end as common_ref
  from mm_0023_status s join invoice_status_rank k on k.status = s.status
  group by s.contract_id, s.month, s.run_id, s.status
)
select p.*, case when n = 1 then 'avtal' else 'avtal-tillagg-' || n end as grouping_key
from (select per_status.*, row_number() over (partition by contract_id, month order by is_default desc, rank desc) as n from per_status) p;

insert into public.invoice_drafts (
  id, billing_run_id, contract_id, month, kind, case_id, grouping_key, buyer_reference, purchase_order_number, invoiced_object,
  accrued_ore, remaining_ore, status, approved_by, approved_at, manual_invoice_no, fortnox_document_number, fortnox_idempotency_key,
  fortnox_created_at, synced_at
)
select
  'inv-' || g.contract_id || '-' || g.month || '-' || g.grouping_key, g.run_id, g.contract_id, g.month, 'periodic', null, g.grouping_key, g.common_ref, null,
  k.contract_number, null, null, g.status, null, null, null, null, g.contract_id || ':' || g.month || ':' || g.grouping_key, null, null
from mm_0023_groups g
join public.contracts k on k.id = g.contract_id
on conflict (id) do nothing;

-- En rad per ärende (utan veckor = ärendets alla debiterbara veckor i månaden). Anmärkningen sparar de gamla fakturanumren.
insert into public.invoice_lines (id, invoice_draft_id, case_id, price_item_id, quantity, unit_price_ore, vat_rate, description, iso_weeks, zero_attendance_weeks, note)
select
  'inv-' || s.contract_id || '-' || s.month || '-' || g.grouping_key || ':' || s.case_id, 'inv-' || s.contract_id || '-' || s.month || '-' || g.grouping_key, s.case_id,
  '', 0, 0, 0, c.case_number, '{}', '{}',
  coalesce('Före 0023: ' || nullif(concat_ws(', ', 'Fortnox-nummer ' || s.fortnox_document_number, 'manuellt fakturanummer ' || s.manual_invoice_no), ''), '')
from mm_0023_status s
join mm_0023_groups g on g.contract_id = s.contract_id and g.month = s.month and g.status = s.status
join public.cases c on c.id = s.case_id
on conflict (id) do nothing;

-- Krediteringar gäller fakturan som har ärendets rad i månaden.
update public.invoice_credits ic set invoice_draft_id = l.invoice_draft_id
from public.invoice_lines l
join public.invoice_drafts d on d.id = l.invoice_draft_id
where ic.invoice_draft_id is null and ic.case_id = l.case_id and d.contract_id = ic.contract_id and d.month = ic.month;

-- Fakturorna per ärende tas bort (inga rader pekar på dem – fakturaraderna skrevs inte före 0023, men tas bort för säkerhets skull).
delete from public.invoice_lines l using public.invoice_drafts d where l.invoice_draft_id = d.id and d.kind = 'periodic' and d.case_id is not null;
delete from public.invoice_drafts where kind = 'periodic' and case_id is not null;
drop table mm_0023_groups, mm_0023_status, mm_0023_billable;

-- ---------------------------------------------------------------- 4. Körningens standardstatus behövs inte
alter table public.billing_runs drop column default_invoice_status;

-- ---------------------------------------------------------------- 5. En periodisk faktura per avtal, månad och grupp
create unique index invoice_drafts_periodic_key on public.invoice_drafts (contract_id, month, grouping_key) where kind = 'periodic';

-- ---------------------------------------------------------------- 6. Raderna fryses när fakturan skapas
-- Uppslag utan RLS (som mm.my_invoice_draft_ids i 0008): fakturan är underlag, godkänd eller returnerad (görs om).
create function mm.invoice_editable(p_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select coalesce((select d.status in ('draft', 'approved', 'returned') from public.invoice_drafts d where d.id = p_id), false) $$;
revoke all on function mm.invoice_editable(text) from public;
grant execute on function mm.invoice_editable(text) to authenticated, service_role;

-- policy.ts invoice_lines.write: ekonom, medlem i avtalet och fakturan får ändras (gäller både den gamla och den nya raden).
-- Borttagning med samma regel: en rad för ett ärende som inte längre är med (en skapelse som avbröts och görs om, eller en
-- returnerad faktura som görs om) tas bort.
drop policy invoice_lines_insert on public.invoice_lines;
create policy invoice_lines_insert on public.invoice_lines for insert to authenticated with check (
  (select mm.current_role()) = 'ekonom' and invoice_draft_id in (select mm.my_invoice_draft_ids()) and mm.invoice_editable(invoice_draft_id)
);
drop policy invoice_lines_update on public.invoice_lines;
create policy invoice_lines_update on public.invoice_lines for update to authenticated using (
  (select mm.role_in('{ekonom,chef,avtalsansvarig,admin}'))
  and ((select mm.current_role()) = 'admin' or invoice_draft_id in (select mm.my_invoice_draft_ids()))
  and mm.invoice_editable(invoice_draft_id)
) with check (
  (select mm.current_role()) = 'ekonom' and invoice_draft_id in (select mm.my_invoice_draft_ids()) and mm.invoice_editable(invoice_draft_id)
);
grant delete on public.invoice_lines to authenticated;
create policy invoice_lines_delete on public.invoice_lines for delete to authenticated using (
  (select mm.current_role()) = 'ekonom' and invoice_draft_id in (select mm.my_invoice_draft_ids()) and mm.invoice_editable(invoice_draft_id)
);
