-- 0036 Byt yrkesområde och automatisk månadsbedömning (Karims beslut 2026-10-22).
--
-- "Vi ska kunna ha möjligheten för huvudcoachen att byta yrkeskategori på deltagarna med någon kortare motivering."
-- "Allt ska vara ifyllt, våra huvudcoacher ska bara 'gå igenom' och kontrollera att vi inte missat något."
--
-- 1. case_area_changes: ett byte av deltagarens yrkesområde (avtalsområde A–L, cases.primary_area_code). Motiveringen är en
--    vanlig anteckning i deltagarkortet (case_notes, note_id) – raden här har bara id:n, koder, tider och yrkesspåren före och
--    efter (spår ur listan för yrkesområdet), ingen fritext. effective_month ('YYYY-MM') är månaden efter bytet: fakturan och
--    rapporterna räknas på det gamla yrkesområdet till och med bytesmånaden och på det nya från och med effective_month
--    (areaForMonth och trackForMonth i src/core/area-changes.ts). Grupp och inbjudningar ändras direkt (hanteraren
--    arenden.bytYrkesomrade).
--    Bytet och ärendet i samma transaktion: när en inloggad skapar raden ändrar triggern case_area_changes_apply ärendets
--    yrkesområde, yrkesspår och alternativa yrkesområde i samma sats (mm.apply_case_area_change). Går det inte (ärendet har
--    hunnit ändras, är inte bekräftat, pågående eller pausat) nekas hela raden. Ett halvt byte – bytet utan ärendet eller
--    ärendet utan bytet – kan alltså aldrig bli kvar, inte heller om servern stängs av mitt i.
--    Behörighet (samma regler som src/data/policy.ts case_area_changes):
--      * läsa: Miljonbemannings roller i avtalet, också ekonomen (faktureringen behöver bytet – raden har ingen fritext;
--        yrkesspåret visar cases_public redan för ekonomen). Kommunen läser aldrig raden.
--      * skapa: coach, samordnare och avtalsansvarig med full åtkomst till ärendet, medlem i avtalet, i eget namn (changed_by).
--      * ingen ändrar eller raderar (ingen update- eller delete-policy och inga sådana rättigheter) – historiken är raderna.
--      * för alla (också service role, triggern case_area_changes_check): ärendet hör till avtalet, båda yrkesområdena hör till
--        avtalet (främmande nycklar mot contract_areas), det nya är aktivt och skiljer sig från det gamla, anteckningen hör
--        till ärendet och är motivering till bara det här bytet (unik), effective_month är månaden efter changed_at
--        (Stockholmstid) och seq är ärendets nästa nummer (1, 2, 3 …; unikt per ärende – två samtidiga byten kan aldrig få
--        samma nummer).
--      * för inloggade (samma trigger och case_area_changes_apply): bytet utgår från ärendets nuvarande yrkesområde,
--        yrkesspår och alternativa yrkesområde och från det förra bytets nya yrkesområde, ärendet är bekräftat, pågående
--        eller pausat, bytet är inte äldre än det förra och registreras med aktuell tid (changed_at högst 10 minuter från
--        mm.app_now()), och motiveringen är en ny anteckning (typ other, inte borttagen, skriven högst 10 minuter från bytet)
--        av den som byter. Ingen kan alltså skriva in en påhittad historik som ändrar vilket yrkesområde tidigare månader
--        faktureras på, eller göra någon annans anteckning till en låst motivering.
--      * motiveringen (anteckningen som note_id pekar på) är låst för inloggade: den ändras och tas aldrig bort (triggern
--        case_notes_area_change_lock) – den visas i bytets historik på deltagarkortet.
--      * ärendets yrkesområde (triggern cases_area_guard på public.cases): i ett bekräftat, pågående, pausat eller avslutat
--        ärende ändrar ingen inloggad cases.primary_area_code direkt – bara Byt yrkesområde (raden här). Kommunen ändrar
--        aldrig yrkesområdena (primary_area_code, secondary_area_code) när beställningen väl tagits emot (status annan än
--        received). Hanteraren skickar bara raden här (en begäran) – den läser eller villkorar aldrig på ärendets kolumner.
-- 2. monthly_assessments.prefill: vad som fylldes i automatiskt och ännu inte ändrats av coachen ("Ifyllt automatiskt –
--    kontrollera"). jsonb med bara id:n, dagar och källornas typ – aldrig text. Standard '{}' (inget förifyllt) – befintliga
--    rader påverkas inte. Nivåns ursprung per område (levelSource auto/coach/ai) och AI-förslagets belägg ligger i areas (jsonb)
--    och behöver ingen kolumn. Policyerna för monthly_assessments (0005) gäller oförändrat.
--
-- Speglas i src/data/policy.ts (case_area_changes, caseAreaChangeWrite, caseAreaChangeApply, caseWrite), src/data/schema.ts
-- (TABLE_NAMES, UNIQUE_KEYS) och scripts/db/columns.ts, och prövas i src/data/supabase/rls-parity.test.ts.
-- Inga destruktiva satser. Idempotent (if not exists, or replace, drop … if exists) – tål att köras igen i SQL Editor.
-- Befintliga objekt i produktionen som får något nytt: triggern case_notes_area_change_lock på public.case_notes och triggern
-- cases_area_guard på public.cases (båda bara before update, inga rader ändras), och kolumnen monthly_assessments.prefill.
--
-- Lås: alter table och nya triggrar tar starka lås på heta tabeller (cases, case_notes, monthly_assessments). Väntar en sats
-- längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i stället för att alla andra frågor köar bakom den – kör
-- då filen igen, gärna utanför arbetstid. Inställningen gäller bara den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

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
  -- Bytets nummer i ärendet (1, 2, 3 …) – ordningen för faktureringen (areaForMonth), också för två byten samma minut.
  seq               integer not null,
  -- Ärendets yrkesspår och alternativa yrkesområde före bytet (rapporterna för månaderna före bytet – trackForMonth) och
  -- yrkesspåret i det nya yrkesområdet ('' = väljs i kartläggningen). Triggern case_area_changes_apply skriver dem på ärendet.
  from_track          text not null default '',
  to_track            text not null default '' check (char_length(to_track) <= 200),
  from_secondary_area text check (from_secondary_area is null or char_length(from_secondary_area) <= 10),
  constraint case_area_changes_from_area_fkey foreign key (contract_id, from_area) references public.contract_areas (contract_id, code),
  constraint case_area_changes_to_area_fkey foreign key (contract_id, to_area) references public.contract_areas (contract_id, code),
  constraint case_area_changes_differ check (from_area <> to_area)
);
create index if not exists case_area_changes_case_id_idx on public.case_area_changes (case_id, changed_at);
-- seq för en databas där tabellen skapades innan kolumnen fanns (raderna numreras i tidsordning), sedan obligatorisk och unik.
alter table public.case_area_changes add column if not exists seq integer;
update public.case_area_changes x set seq = n.n
  from (select id, row_number() over (partition by case_id order by changed_at, id) as n from public.case_area_changes) n
 where n.id = x.id and x.seq is null;
alter table public.case_area_changes alter column seq set not null;
alter table public.case_area_changes drop constraint if exists case_area_changes_seq_positive;
alter table public.case_area_changes add constraint case_area_changes_seq_positive check (seq >= 1);
create unique index if not exists case_area_changes_case_seq_key on public.case_area_changes (case_id, seq);
create index if not exists case_area_changes_contract_id_idx on public.case_area_changes (contract_id, effective_month);
create index if not exists case_area_changes_changed_by_idx on public.case_area_changes (changed_by);
-- En anteckning är motivering till högst ett byte.
create unique index if not exists case_area_changes_note_id_key on public.case_area_changes (note_id);
-- De sammansatta främmande nycklarna mot contract_areas (contract_id, code) får var sitt index.
create index if not exists case_area_changes_from_area_idx on public.case_area_changes (contract_id, from_area);
create index if not exists case_area_changes_to_area_idx on public.case_area_changes (contract_id, to_area);

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
-- yrkesområden, ärendets anteckningar och byten; ärendets avtal med mm.case_contract_id (0019).
-- För inloggade dessutom kedjan, tiden och motiveringen (policy.ts caseAreaChangeChained): bytet utgår från det förra bytets
-- nya yrkesområde, är inte äldre än det förra och registreras med aktuell tid, och anteckningen är en ny anteckning (typ other,
-- inte borttagen, skriven högst 10 minuter från bytet) av den som byter. Att bytet utgår från ärendets nuvarande yrkesområde,
-- yrkesspår och alternativ prövar mm.apply_case_area_change nedan, när ärendet ändras. Servern (service role) och testdatat
-- rörs inte av de kontrollerna.
create or replace function mm.check_case_area_change() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  prior_seq     integer;
  prior_to      text;
  prior_at      timestamptz;
  note_author   text;
  note_kind     text;
  note_removed  timestamptz;
  note_created  timestamptz;
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
  if tg_op = 'INSERT' then
    select x.seq, x.to_area, x.changed_at into prior_seq, prior_to, prior_at
      from public.case_area_changes x where x.case_id = new.case_id order by x.seq desc limit 1;
    if new.seq is distinct from coalesce(prior_seq, 0) + 1 then
      raise exception 'Bytena numreras i tur och ordning' using errcode = '23514';
    end if;
    if current_user = 'authenticated' then
      if prior_seq is not null and new.from_area is distinct from prior_to then
        raise exception 'Bytet ska utgå från ärendets nuvarande yrkesområde' using errcode = '23514';
      end if;
      if prior_at is not null and new.changed_at < prior_at then
        raise exception 'Bytet kan inte vara äldre än det förra bytet' using errcode = '23514';
      end if;
      if abs(extract(epoch from (new.changed_at - mm.app_now()))) > 600 then
        raise exception 'Bytet registreras med aktuell tid' using errcode = '23514';
      end if;
      select n.author_id, n.kind, n.removed_at, n.created_at into note_author, note_kind, note_removed, note_created
        from public.case_notes n where n.id = new.note_id;
      if note_author is distinct from new.changed_by or note_kind is distinct from 'other' or note_removed is not null
         or abs(extract(epoch from (new.changed_at - note_created))) > 600 then
        raise exception 'Motiveringen ska vara en ny anteckning av den som byter' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists case_area_changes_check on public.case_area_changes;
create trigger case_area_changes_check before insert or update on public.case_area_changes
for each row execute function mm.check_case_area_change();

-- Ärendet ändras i samma transaktion som bytet skrivs (policy.ts caseAreaChangeApply – MemoryRepo gör samma ändring i samma
-- steg som raden): yrkesområdet blir det nya, yrkesspåret det valda (eller tomt) och ett alternativt yrkesområde som blir det
-- nya tas bort. Bara när ärendet fortfarande har bytets gamla yrkesområde, yrkesspår och alternativ och är bekräftat, pågående
-- eller pausat – annars nekas hela bytet (23514) och inget skrivs. Security definer: den inloggade läser bara id direkt i
-- public.cases (0013) och ändrar aldrig yrkesområdet direkt (cases_area_guard nedan). Funktionen ändrar bara ärendet enligt
-- ärendets senaste byte, och ligger i schemat mm som inte nås via API:t.
create or replace function mm.apply_case_area_change(p_change_id text) returns boolean
language plpgsql security definer set search_path = public, mm
as $$
declare
  x public.case_area_changes%rowtype;
begin
  select * into x from public.case_area_changes where id = p_change_id;
  if not found then
    return false;
  end if;
  if exists (select 1 from public.case_area_changes y where y.case_id = x.case_id and y.seq > x.seq) then
    return false;
  end if;
  update public.cases c
     set primary_area_code = x.to_area,
         vocational_track = x.to_track,
         secondary_area_code = case when c.secondary_area_code = x.to_area then null else c.secondary_area_code end
   where c.id = x.case_id
     and c.contract_id = x.contract_id
     and c.primary_area_code = x.from_area
     and c.vocational_track = x.from_track
     and c.secondary_area_code is not distinct from x.from_secondary_area
     and c.status in ('confirmed', 'active', 'paused');
  return found;
end
$$;
revoke all on function mm.apply_case_area_change(text) from public, anon;
grant execute on function mm.apply_case_area_change(text) to authenticated, service_role;

create or replace function mm.after_case_area_change() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user = 'authenticated' and not mm.apply_case_area_change(new.id) then
    raise exception 'Bytet ska utgå från ärendets nuvarande yrkesområde och yrkesspår' using errcode = '23514';
  end if;
  return null;
end
$$;
drop trigger if exists case_area_changes_apply on public.case_area_changes;
create trigger case_area_changes_apply after insert on public.case_area_changes
for each row execute function mm.after_case_area_change();

-- Ärendets yrkesområde byts bara med Byt yrkesområde (policy.ts caseWrite): i ett bekräftat, pågående, pausat eller avslutat
-- ärende ändrar ingen inloggad primary_area_code direkt (bytet ändrar ärendet via mm.apply_case_area_change – security
-- definer, som den här triggern släpper igenom). Kommunen ändrar aldrig yrkesområdena när beställningen väl tagits emot.
-- Accepten (received/acknowledged → confirmed) och avropsinkorgen (received/acknowledged) väljer yrkesområdet som förut.
create or replace function mm.guard_case_area() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.primary_area_code is distinct from old.primary_area_code and old.status in ('confirmed', 'active', 'paused', 'closed') then
    raise exception 'Yrkesområdet byts med Byt yrkesområde på deltagarkortet' using errcode = '42501';
  end if;
  if mm.current_role() = 'kommun_handlaggare' and old.status <> 'received'
     and (new.primary_area_code is distinct from old.primary_area_code or new.secondary_area_code is distinct from old.secondary_area_code) then
    raise exception 'Yrkesområdet i en beställning som tagits emot ändras av Miljonbemanning' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists cases_area_guard on public.cases;
create trigger cases_area_guard before update of primary_area_code, secondary_area_code on public.cases
for each row execute function mm.guard_case_area();

-- Motiveringen är låst (policy.ts caseNoteWrite): en anteckning som ett byte pekar på (note_id) ändras och tas aldrig bort av
-- inloggade – inte heller av författaren, samordnaren eller avtalsansvarig. Servern (service role) rörs inte.
-- Uppslaget med security definer: bytena läses annars med den inloggades rättigheter.
create or replace function mm.is_area_change_note(p_note_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select exists (select 1 from public.case_area_changes x where x.note_id = p_note_id) $$;
revoke all on function mm.is_area_change_note(text) from public, anon;
grant execute on function mm.is_area_change_note(text) to authenticated, service_role;

create or replace function mm.lock_area_change_note() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') and mm.is_area_change_note(old.id) then
    raise exception 'Motiveringen till ett byte av yrkesområde kan inte ändras eller tas bort' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists case_notes_area_change_lock on public.case_notes;
create trigger case_notes_area_change_lock before update on public.case_notes
for each row execute function mm.lock_area_change_note();

-- ---------------------------------------------------------------- 2. Förifyllt i månadsbedömningen
alter table public.monthly_assessments add column if not exists prefill jsonb not null default '{}'::jsonb;
alter table public.monthly_assessments drop constraint if exists monthly_assessments_prefill_object;
alter table public.monthly_assessments add constraint monthly_assessments_prefill_object check (jsonb_typeof(prefill) = 'object');

reset lock_timeout;
reset statement_timeout;
