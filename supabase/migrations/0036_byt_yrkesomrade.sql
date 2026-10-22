-- 0036 Byt yrkesområde och automatisk månadsbedömning (Karims beslut 2026-10-22).
--
-- "Vi ska kunna ha möjligheten för huvudcoachen att byta yrkeskategori på deltagarna med någon kortare motivering."
-- "Allt ska vara ifyllt, våra huvudcoacher ska bara 'gå igenom' och kontrollera att vi inte missat något."
--
-- 1. case_area_changes: ett byte av deltagarens yrkesområde (avtalsområde A–L, cases.primary_area_code). Motiveringen är en
--    vanlig anteckning i deltagarkortet (case_notes, note_id) – raden här har bara id:n, koder och tider, ingen fritext.
--    effective_month ('YYYY-MM') är månaden efter bytet: fakturan räknas på det gamla yrkesområdet till och med bytesmånaden
--    och på det nya från och med effective_month (areaForMonth i src/core/area-changes.ts). Grupp och inbjudningar ändras
--    direkt (hanteraren arenden.bytYrkesomrade).
--    Behörighet (samma regler som src/data/policy.ts case_area_changes):
--      * läsa: Miljonbemannings roller i avtalet, också ekonomen (faktureringen behöver bytet – raden har ingen fritext).
--        Kommunen läser aldrig raden (kommunens vyer visar bara nuvarande yrkesområde, som förut).
--      * skapa: coach, samordnare och avtalsansvarig med full åtkomst till ärendet, medlem i avtalet, i eget namn (changed_by).
--      * ingen ändrar eller raderar (ingen update- eller delete-policy och inga sådana rättigheter) – historiken är raderna.
--      * för alla (också service role, triggern case_area_changes_check): ärendet hör till avtalet, båda yrkesområdena hör till
--        avtalet (främmande nycklar mot contract_areas), det nya är aktivt och skiljer sig från det gamla, anteckningen hör
--        till ärendet och effective_month är månaden efter changed_at (Stockholmstid).
-- 2. monthly_assessments.prefill: vad som fylldes i automatiskt och ännu inte ändrats av coachen ("Ifyllt automatiskt –
--    kontrollera"). jsonb med bara id:n, dagar och källornas typ – aldrig text. Standard '{}' (inget förifyllt) – befintliga
--    rader påverkas inte. Nivåns ursprung per område (levelSource auto/coach/ai) och AI-förslagets belägg ligger i areas (jsonb)
--    och behöver ingen kolumn. Policyerna för monthly_assessments (0005) gäller oförändrat.
--
-- Speglas i src/data/policy.ts (case_area_changes, caseAreaChangeWrite), src/data/schema.ts (TABLE_NAMES) och
-- scripts/db/columns.ts, och prövas i src/data/supabase/rls-parity.test.ts.
-- Inga destruktiva satser. Idempotent (if not exists, or replace, drop … if exists) – tål att köras igen i SQL Editor.

-- ---------------------------------------------------------------- 1. Byten av yrkesområde
create table if not exists public.case_area_changes (
  id                text primary key,
  contract_id       text not null references public.contracts (id),
  case_id           text not null references public.cases (id),
  from_area         text not null,
  to_area           text not null,
  -- Månaden efter bytet ('YYYY-MM') – från den faktureras det nya yrkesområdet.
  effective_month   text not null check (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  changed_by        text not null references public.profiles (id),
  changed_at        timestamptz not null,
  -- Anteckningen med motiveringen.
  note_id           text not null references public.case_notes (id),
  constraint case_area_changes_from_area_fkey foreign key (contract_id, from_area) references public.contract_areas (contract_id, code),
  constraint case_area_changes_to_area_fkey foreign key (contract_id, to_area) references public.contract_areas (contract_id, code),
  constraint case_area_changes_differ check (from_area <> to_area)
);
create index if not exists case_area_changes_case_id_idx on public.case_area_changes (case_id, changed_at);
create index if not exists case_area_changes_contract_id_idx on public.case_area_changes (contract_id, effective_month);
create index if not exists case_area_changes_changed_by_idx on public.case_area_changes (changed_by);
create index if not exists case_area_changes_note_id_idx on public.case_area_changes (note_id);

alter table public.case_area_changes enable row level security;
revoke all on public.case_area_changes from anon, authenticated;
grant all on public.case_area_changes to service_role;
-- Bara läsa och skapa: ett byte ändras och raderas aldrig.
grant select, insert on public.case_area_changes to authenticated;

-- policy.ts case_area_changes.read: AREA_CHANGE_READERS (Miljonbemanning, också ekonomen) i avtalet (admin: alla avtal).
drop policy if exists case_area_changes_select on public.case_area_changes;
create policy case_area_changes_select on public.case_area_changes for select to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin', 'ekonom']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
-- policy.ts caseAreaChangeWrite (ny rad): AREA_CHANGERS med full åtkomst till ärendet, medlem i avtalet, i eget namn.
drop policy if exists case_area_changes_insert on public.case_area_changes;
create policy case_area_changes_insert on public.case_area_changes for insert to authenticated with check (
  (select mm.role_in(array['coach', 'samordnare', 'avtalsansvarig']))
  and mm.case_access(case_id) = 'full'
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and changed_by = (select mm.current_profile_id())
);

-- Raden stämmer med ärendet, avtalets yrkesområden, anteckningen och tiden (policy.ts caseAreaChangeConsistent – gäller alla,
-- också service role). Uppslagen görs med den inloggades rättigheter: den som får skapa raden (full åtkomst) läser avtalets
-- yrkesområden och ärendets anteckningar; ärendets avtal med mm.case_contract_id (0019).
create or replace function mm.check_case_area_change() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if mm.case_contract_id(new.case_id) is distinct from new.contract_id then
    raise exception 'Bytet ska höra till ärendets avtal' using errcode = '23514';
  end if;
  if not exists (select 1 from public.contract_areas a where a.contract_id = new.contract_id and a.code = new.to_area and a.active) then
    raise exception 'Det nya yrkesområdet ska vara ett aktivt yrkesområde i avtalet' using errcode = '23514';
  end if;
  if not exists (select 1 from public.case_notes n where n.id = new.note_id and n.case_id = new.case_id) then
    raise exception 'Motiveringen ska vara en anteckning i ärendet' using errcode = '23514';
  end if;
  if new.effective_month is distinct from to_char(date_trunc('month', new.changed_at at time zone 'Europe/Stockholm') + interval '1 month', 'YYYY-MM') then
    raise exception 'Bytet gäller fakturan från månaden efter bytet' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists case_area_changes_check on public.case_area_changes;
create trigger case_area_changes_check before insert or update on public.case_area_changes
for each row execute function mm.check_case_area_change();

-- ---------------------------------------------------------------- 2. Förifyllt i månadsbedömningen
alter table public.monthly_assessments add column if not exists prefill jsonb not null default '{}'::jsonb;
alter table public.monthly_assessments drop constraint if exists monthly_assessments_prefill_object;
alter table public.monthly_assessments add constraint monthly_assessments_prefill_object check (jsonb_typeof(prefill) = 'object');
