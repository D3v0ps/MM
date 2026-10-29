-- 0038 Ändra startdatum (Karims beslut 2026-10-29).
--
-- "Lägg in så att vi kan ändra startdatum för deltagarna."
--
-- 1. case_start_changes: en ändring av startdatumet i en pågående eller pausad insats (cases.start_date). Motiveringen är en
--    anteckning i deltagarkortet (case_notes, note_id) – raden här har bara datum, id:n, tid och ändringens nummer i ärendet
--    (seq), ingen fritext. Kommunen och ekonomen läser den aldrig, och kommunen får inget meddelande om ändringen.
--    Ändringen och ärendet i samma transaktion: när en inloggad skapar raden ändrar triggern case_start_changes_apply ärendets
--    startdatum (och nuvarande fas sedan, när den var startdatumet eller hamnar före det nya) i samma sats
--    (mm.apply_case_start_change). Går det inte nekas hela raden (23514) och inget skrivs. Ärendet ändras bara när:
--      * ärendet fortfarande har det gamla startdatumet (from_date) och pågår eller är pausat,
--      * det nya startdatumet ligger tidigast första mötets dag och senast slutdatumet (eller planerat slut, om slutdatum saknas),
--      * ingen av månaderna ändringen rör är fakturerad eller godkänd (mm.start_change_locked_month): månaden (torsdagsregeln)
--        för varje ISO-vecka från veckan med det tidigare datumet till veckan med det senare, utom uppehållsveckor. Fakturerad =
--        månadens körning är stängd, fakturan för ärendets grupp är skapad (fortnox_created, booked, sent, paid, manual eller
--        returned) eller en skapad faktura har en fryst rad för ärendet; godkänd = fakturan för ärendets grupp är approved.
--        Ekonomen behöver kreditera först. Ett underlag (draft) och en krediterad faktura (credited) stoppar inte.
--      * inget tillfälle före det nya startdatumet har närvaro som en människa registrerat (attendance.source = 'manual') och
--        ingen mötesrapport hållen före det är godkänd (check_ins.status = 'approved'). Tillfällen utan närvaro eller med bara
--        automatisk närvaro tar servern bort efter ändringen (hanteraren arenden.andraStartdatum) – inga tillfällen skapas
--        bakåt i tiden.
--      * ingen månad som med det nya startdatumet får för få inskrivna dagar för en månadsrapport (färre än avtalets
--        reportSchedule.monthly.minEnrolledDays, minst en – samma regel som rapportutkasten) har en månadsrapport som är
--        granskad, godkänd eller lämnad till kommunen eller en godkänd månadsbedömning (mm.start_change_report_month). Utkasten
--        för en sådan månad tar servern bort efter ändringen.
--    Planerat slut, planerade veckor och beställningens veckor ändras inte (de räknas från första mötet, beslut 7, 2026-10-08).
--    Behörighet (samma regler som src/data/policy.ts case_start_changes):
--      * läsa: Miljonbemannings roller i avtalet utom ekonomen. Kommunen läser aldrig raden.
--      * skapa: coach, samordnare och avtalsansvarig med full åtkomst till ärendet, medlem i avtalet, i eget namn (changed_by).
--      * ingen ändrar eller raderar (ingen update- eller delete-policy och inga sådana rättigheter).
--      * för alla (också service role, triggern case_start_changes_check): ärendet hör till avtalet, två olika datum,
--        anteckningen hör till ärendet och är motivering till bara den här ändringen (unik) och seq är ärendets nästa nummer.
--      * för inloggade (samma trigger och case_start_changes_apply): ändringen registreras med aktuell tid (changed_at högst 10
--        minuter från mm.app_now()), motiveringen är en ny anteckning (typ other, inte borttagen, skriven högst 10 minuter från
--        ändringen) av den som ändrar, och villkoren för ärendet ovan.
--      * motiveringen (anteckningen som note_id pekar på) är låst för inloggade: den ändras och tas aldrig bort (triggern
--        case_notes_start_change_lock).
-- 2. Ärendets startdatum (triggern cases_start_date_guard på public.cases): startdatumet i en startad insats (active, paused,
--    closed) ändrar ingen inloggad direkt – bara Ändra startdatum (raden ovan, via mm.apply_case_start_change, security
--    definer). Före start (också ett bekräftat ärende som redan har ett startdatum) sätts det när insatsen startar
--    (arenden.caseStart) och bara av coach, samordnare och avtalsansvarig – aldrig av ekonomen eller kommunen, som annars får
--    ändra sina kolumner i ärendet (cases_update, 0003). Ett nytt ärende skapas aldrig med startdatum av en inloggad (kommunens
--    beställning har inget), och spärren går inte runt via statusen: en startad insats blir aldrig ostartad igen.
--
-- Speglas i src/data/policy.ts (case_start_changes, caseStartChangeWrite, caseStartChangeApply, caseStartGuard, caseWrite,
-- caseNoteWrite), src/core/start-date.ts (startChangeMonths, startChangeLock, startChangeReportLock, checkInsBeforeStart,
-- phaseSinceAfter), src/data/schema.ts (TABLE_NAMES, UNIQUE_KEYS) och scripts/db/columns.ts, och prövas i
-- src/data/supabase/rls-parity.test.ts.
-- Inga destruktiva satser. Idempotent (if not exists, or replace, drop … if exists) – tål att köras igen i SQL Editor.
-- Befintliga objekt i produktionen som ersätts: inga. Befintliga tabeller som får något nytt: public.cases (den nya triggern
-- cases_start_date_guard, before insert or update of start_date, status) och public.case_notes (den nya triggern
-- case_notes_start_change_lock, before update). Båda ändrar inga rader. Inga befintliga funktioner, policyer, triggrar eller
-- rättigheter ändras, och inga befintliga rader ändras.
--
-- Lås: nya triggrar tar starka lås på heta tabeller (cases, case_notes). Väntar en sats längre än 5 sekunder på ett lås avbryts
-- körningen (felkod 55P03) i stället för att alla andra frågor köar bakom den – kör då filen igen, gärna utanför arbetstid.
-- Inställningen gäller bara den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- 1. Ändringar av startdatum
create table if not exists public.case_start_changes (
  id          text primary key,
  contract_id text not null references public.contracts (id),
  case_id     text not null references public.cases (id),
  -- Startdatumet före och efter ändringen.
  from_date   date not null,
  to_date     date not null,
  changed_by  text not null references public.profiles (id),
  changed_at  timestamptz not null,
  -- Anteckningen med motiveringen.
  note_id     text not null references public.case_notes (id),
  -- Ändringens nummer i ärendet (1, 2, 3 …).
  seq         integer not null,
  constraint case_start_changes_differ check (from_date <> to_date),
  constraint case_start_changes_seq_positive check (seq >= 1)
);
-- Ändringarna numreras i tur och ordning per ärende (två samtidiga ändringar kan aldrig få samma nummer). Täcker också case_id.
create unique index if not exists case_start_changes_case_seq_key on public.case_start_changes (case_id, seq);
-- En anteckning är motivering till högst en ändring.
create unique index if not exists case_start_changes_note_id_key on public.case_start_changes (note_id);
create index if not exists case_start_changes_contract_id_idx on public.case_start_changes (contract_id);
create index if not exists case_start_changes_changed_by_idx on public.case_start_changes (changed_by);

alter table public.case_start_changes enable row level security;
revoke all on public.case_start_changes from anon, authenticated;
grant all on public.case_start_changes to service_role;
-- Bara läsa och skapa: en ändring ändras och raderas aldrig.
grant select, insert on public.case_start_changes to authenticated;

-- policy.ts case_start_changes.read: START_CHANGE_READERS (Miljonbemanning utom ekonomen) i avtalet (admin: alla avtal).
drop policy if exists case_start_changes_select on public.case_start_changes;
create policy case_start_changes_select on public.case_start_changes for select to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
);
-- policy.ts caseStartChangeWrite (ny rad): START_CHANGERS med full åtkomst till ärendet, medlem i avtalet, i eget namn.
drop policy if exists case_start_changes_insert on public.case_start_changes;
create policy case_start_changes_insert on public.case_start_changes for insert to authenticated with check (
  (select mm.role_in(array['coach', 'samordnare', 'avtalsansvarig']))
  and mm.case_access(case_id) = 'full'
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and changed_by = (select mm.current_profile_id())
);

-- Raden stämmer med ärendet och anteckningen (policy.ts caseStartChangeConsistent – gäller alla, också service role). Uppslagen
-- görs med den inloggades rättigheter: den som får skapa raden (full åtkomst) läser ärendets anteckningar och ändringar;
-- ärendets avtal med mm.case_contract_id (0019). För inloggade dessutom tiden och motiveringen (policy.ts
-- caseStartChangeChained). Ärendets villkor prövar mm.apply_case_start_change nedan, när ärendet ändras.
create or replace function mm.check_case_start_change() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  prior_seq     integer;
  note_author   text;
  note_kind     text;
  note_removed  timestamptz;
  note_created  timestamptz;
begin
  if mm.case_contract_id(new.case_id) is distinct from new.contract_id then
    raise exception 'Ändringen ska höra till ärendets avtal' using errcode = '23514';
  end if;
  if not exists (select 1 from public.case_notes n where n.id = new.note_id and n.case_id = new.case_id) then
    raise exception 'Motiveringen ska vara en anteckning i ärendet' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    select max(x.seq) into prior_seq from public.case_start_changes x where x.case_id = new.case_id;
    if new.seq is distinct from coalesce(prior_seq, 0) + 1 then
      raise exception 'Ändringarna numreras i tur och ordning' using errcode = '23514';
    end if;
    if current_user = 'authenticated' then
      if abs(extract(epoch from (new.changed_at - mm.app_now()))) > 600 then
        raise exception 'Ändringen registreras med aktuell tid' using errcode = '23514';
      end if;
      select n.author_id, n.kind, n.removed_at, n.created_at into note_author, note_kind, note_removed, note_created
        from public.case_notes n where n.id = new.note_id;
      if note_author is distinct from new.changed_by or note_kind is distinct from 'other' or note_removed is not null
         or abs(extract(epoch from (new.changed_at - note_created))) > 600 then
        raise exception 'Motiveringen ska vara en ny anteckning av den som ändrar' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists case_start_changes_check on public.case_start_changes;
create trigger case_start_changes_check before insert or update on public.case_start_changes
for each row execute function mm.check_case_start_change();

-- Den första månaden som ändringen rör och som är fakturerad eller godkänd för ärendet, eller null (src/core/start-date.ts
-- startChangeMonths och startChangeLock). Veckans månad är månaden för veckans torsdag (måndag + 3); uppehållsveckor
-- (cases.paused_weeks, 'IYYY-"W"IW') räknas inte. Bara servern kör den (inloggade läser inte faktureringen): den anropas av
-- mm.apply_case_start_change, som är security definer.
create or replace function mm.start_change_locked_month(p_case_id text, p_contract_id text, p_from date, p_to date, p_paused text[])
returns text
language sql stable set search_path = public, mm
as $$
  with weeks as (
    select w::date as mon
      from generate_series(date_trunc('week', least(p_from, p_to)::timestamp), date_trunc('week', greatest(p_from, p_to)::timestamp), interval '7 days') w
  ), months as (
    select distinct to_char(mon + 3, 'YYYY-MM') as m
      from weeks
     where not (to_char(mon, 'IYYY-"W"IW') = any (coalesce(p_paused, '{}'::text[])))
  )
  select x.m from months x
   where exists (select 1 from public.billing_runs r where r.contract_id = p_contract_id and r.month = x.m and r.status = 'closed')
      or exists (select 1 from public.invoice_drafts d
                  where d.contract_id = p_contract_id and d.month = x.m and d.kind = 'periodic'
                    and d.status in ('approved', 'fortnox_created', 'booked', 'sent', 'paid', 'manual', 'returned')
                    and regexp_replace(d.grouping_key, '-tillagg-[0-9]+$', '') in ('avtal', p_case_id))
      or exists (select 1 from public.invoice_lines l join public.invoice_drafts d on d.id = l.invoice_draft_id
                  where l.case_id = p_case_id and d.contract_id = p_contract_id and d.month = x.m and d.kind = 'periodic'
                    and d.status in ('fortnox_created', 'booked', 'sent', 'paid', 'manual', 'returned'))
   order by x.m
   limit 1
$$;
revoke all on function mm.start_change_locked_month(text, text, date, date, text[]) from public, anon, authenticated;
grant execute on function mm.start_change_locked_month(text, text, date, date, text[]) to service_role;

-- Den första månaden som med det nya startdatumet får för få inskrivna dagar för en månadsrapport (src/core/start-date.ts
-- startChangeDroppedMonths och startChangeReportLock) men redan har en månadsrapport som är granskad, godkänd, lämnad eller
-- öppnad (inte ersatt) eller en godkänd månadsbedömning, eller null. Bara när starten flyttas senare. Inskrivna dagar i månaden =
-- från startdatumet (eller den 1:a) till slutdatumet (eller månadens sista dag), som src/core/report-schedule.ts enrolledDays;
-- gränsen är avtalets reportSchedule.monthly.minEnrolledDays (minst 1). Bara servern kör den (inloggade läser inte alla
-- rapporter): den anropas av mm.apply_case_start_change, som är security definer.
create or replace function mm.start_change_report_month(p_case_id text, p_contract_id text, p_from date, p_to date, p_end date)
returns text
language sql stable set search_path = public, mm
as $$
  with cfg as (
    select greatest(1, coalesce((k.config #>> '{reportSchedule,monthly,minEnrolledDays}')::int, 1)) as min_days
      from public.contracts k where k.id = p_contract_id
  ), months as (
    select m::date as first_day, (m + interval '1 month' - interval '1 day')::date as last_day
      from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') m
     where p_to > p_from
  ), days as (
    select to_char(x.first_day, 'YYYY-MM') as m,
           greatest(0, least(x.last_day, coalesce(p_end, x.last_day)) - greatest(p_from, x.first_day) + 1) as old_days,
           greatest(0, least(x.last_day, coalesce(p_end, x.last_day)) - greatest(p_to, x.first_day) + 1) as new_days
      from months x
  )
  select d.m from days d cross join cfg
   where d.old_days >= cfg.min_days and d.new_days < cfg.min_days
     and (exists (select 1 from public.reports r
                   where r.case_id = p_case_id and r.kind = 'monthly' and r.month = d.m and not r.superseded
                     and r.status in ('reviewed', 'approved', 'delivered', 'opened'))
          or exists (select 1 from public.monthly_assessments a where a.case_id = p_case_id and a.month = d.m and a.status = 'approved'))
   order by d.m
   limit 1
$$;
revoke all on function mm.start_change_report_month(text, text, date, date, date) from public, anon, authenticated;
grant execute on function mm.start_change_report_month(text, text, date, date, date) to service_role;

-- Ärendet ändras i samma transaktion som ändringen skrivs (policy.ts caseStartChangeApply – MemoryRepo gör samma ändring i
-- samma steg som raden): startdatumet blir det nya, och nuvarande fas sedan blir det nya startdatumet när den var det gamla eller
-- hamnar före det nya (phaseSinceAfter). Bara när villkoren i punkt 1 överst är uppfyllda – annars nekas hela ändringen (23514)
-- och inget skrivs. Security definer: den inloggade läser inte faktureringen och ändrar aldrig ett satt startdatum direkt
-- (cases_start_date_guard nedan). Funktionen ändrar bara ärendet enligt ärendets senaste ändring och ligger i schemat mm, som
-- inte nås via API:t.
create or replace function mm.apply_case_start_change(p_change_id text) returns boolean
language plpgsql security definer set search_path = public, mm
as $$
declare
  x public.case_start_changes%rowtype;
begin
  select * into x from public.case_start_changes where id = p_change_id;
  if not found then
    return false;
  end if;
  if exists (select 1 from public.case_start_changes y where y.case_id = x.case_id and y.seq > x.seq) then
    return false;
  end if;
  update public.cases c
     set start_date = x.to_date,
         phase_since = case when c.phase_since is not null and (c.phase_since = x.from_date or c.phase_since < x.to_date) then x.to_date else c.phase_since end
   where c.id = x.case_id
     and c.contract_id = x.contract_id
     and c.start_date = x.from_date
     and c.status in ('active', 'paused')
     and (c.first_meeting_at is null or x.to_date >= (c.first_meeting_at at time zone 'Europe/Stockholm')::date)
     and (coalesce(c.end_date, c.planned_end) is null or x.to_date <= coalesce(c.end_date, c.planned_end))
     and mm.start_change_locked_month(c.id, c.contract_id, x.from_date, x.to_date, c.paused_weeks) is null
     and not exists (
       select 1 from public.activities a join public.attendance t on t.activity_id = a.id
        where a.case_id = c.id and t.source = 'manual' and (a.starts_at at time zone 'Europe/Stockholm')::date < x.to_date
     )
     and not exists (
       select 1 from public.check_ins k
        where k.case_id = c.id and k.status = 'approved' and (k.held_at at time zone 'Europe/Stockholm')::date < x.to_date
     )
     and mm.start_change_report_month(c.id, c.contract_id, x.from_date, x.to_date, c.end_date) is null;
  return found;
end
$$;
revoke all on function mm.apply_case_start_change(text) from public, anon;
grant execute on function mm.apply_case_start_change(text) to authenticated, service_role;

create or replace function mm.after_case_start_change() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user = 'authenticated' and not mm.apply_case_start_change(new.id) then
    raise exception 'Startdatumet kan inte ändras: ärendet har ändrats, en månad är fakturerad eller närvaro, en mötesrapport eller en månadsrapport stoppar' using errcode = '23514';
  end if;
  return null;
end
$$;
drop trigger if exists case_start_changes_apply on public.case_start_changes;
create trigger case_start_changes_apply after insert on public.case_start_changes
for each row execute function mm.after_case_start_change();

-- Motiveringen är låst (policy.ts caseNoteWrite): en anteckning som en ändring pekar på (note_id) ändras och tas aldrig bort av
-- inloggade – inte heller av författaren, samordnaren eller avtalsansvarig. Servern (service role) rörs inte.
-- Uppslaget med security definer: ändringarna läses annars med den inloggades rättigheter.
create or replace function mm.is_start_change_note(p_note_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$ select exists (select 1 from public.case_start_changes x where x.note_id = p_note_id) $$;
revoke all on function mm.is_start_change_note(text) from public, anon;
grant execute on function mm.is_start_change_note(text) to authenticated, service_role;

create or replace function mm.lock_start_change_note() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') and mm.is_start_change_note(old.id) then
    raise exception 'Motiveringen till ett ändrat startdatum kan inte ändras eller tas bort' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists case_notes_start_change_lock on public.case_notes;
create trigger case_notes_start_change_lock before update on public.case_notes
for each row execute function mm.lock_start_change_note();

-- ---------------------------------------------------------------- 2. Ärendets startdatum
-- policy.ts caseWrite, caseStartGuard: startdatumet i en startad insats (active, paused, closed) ändras bara med Ändra
-- startdatum (mm.apply_case_start_change – security definer, som den här triggern släpper igenom). Före start sätts det när
-- insatsen startar och bara av coach, samordnare och avtalsansvarig – också i ett bekräftat ärende som redan har ett startdatum
-- (Starta insatsen med ett annat datum än första mötets). Ett nytt ärende har inget startdatum, och en startad insats blir aldrig
-- ostartad igen (annars kunde statusen ändras tillbaka, startdatumet ändras direkt och statusen återställas). Servern (service
-- role) rörs inte.
create or replace function mm.guard_case_start_date() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.start_date is not null then
      raise exception 'Ett nytt ärende har inget startdatum – det sätts när insatsen startar' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status in ('active', 'paused', 'closed') and new.status not in ('active', 'paused', 'closed') then
    raise exception 'En startad insats kan inte bli ostartad igen' using errcode = '42501';
  end if;
  if new.start_date is distinct from old.start_date then
    if old.start_date is not null and old.status in ('active', 'paused', 'closed') then
      raise exception 'Startdatumet ändras med Ändra startdatum på deltagarkortet' using errcode = '42501';
    end if;
    if coalesce(mm.current_role(), '') not in ('coach', 'samordnare', 'avtalsansvarig') then
      raise exception 'Startdatumet sätts av huvudcoachen, samordnaren eller avtalsansvarig när insatsen startar' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists cases_start_date_guard on public.cases;
create trigger cases_start_date_guard before insert or update of start_date, status on public.cases
for each row execute function mm.guard_case_start_date();

reset lock_timeout;
reset statement_timeout;
