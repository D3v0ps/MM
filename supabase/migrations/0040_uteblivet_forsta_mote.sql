-- 0040 Deltagaren kom inte till första mötet (Karims beslut 2026-11-09, SPEC §7.4).
--
-- I dag kan frånvaro bara registreras efter Starta insatsen: före start finns första mötet bara som cases.first_meeting_at i ett
-- bekräftat ärende, utan något tillfälle. Kom deltagaren inte startade man insatsen bara för att kunna registrera frånvaron – och
-- då blev veckan debiterbar (faktureringen räknar ISO-veckor från startdatumet), Ändra startdatum låstes och den automatiska
-- närvaron kunde registrera mötet som närvarande. Besluten:
--   * Det gäller bara första mötet.
--   * Det är internt: kommunen får inget besked och ser det aldrig – inget mejl, inget meddelande i portalen, inget i kommunens vyer.
--   * Det faktureras aldrig och är ingen närvaro.
--
-- first_meeting_no_shows: att deltagaren inte kom till första mötet – en rad per ärende och möte (det mötet som var bokat när
-- raden registrerades, cases.first_meeting_at). Slaget är uteblev (utan att meddela) eller giltig (giltig frånvaro). Orsaken
-- (reason) krävs vid giltig frånvaro och får inte vara bara blanksteg; vid uteblev är den frivillig. Högst 300 tecken. Inga
-- tillfällen och ingen närvaro skapas: raden räknas aldrig i närvarograden, veckorapporten, månads- och slutrapporterna,
-- beställarrapporten, resultatfilen, exporterna, faktureringen, bonusen, den automatiska närvaron eller spärren för Ändra
-- startdatum – ingen av dem läser tabellen.
--   * Append-only för alla roller, också service role (triggern first_meeting_no_shows_append_only och rättigheterna – bara
--     läsa och skapa, så ingen truncate, som bonus_claim_decisions i 0039). "Läs in testdata på nytt" tömmer tabellen med
--     mm.reset_test_data (security definer) och läser in raderna med "on conflict do nothing" (src/server/staging/load.ts).
--   * För alla roller, också service role (triggern first_meeting_no_shows_check): ärendet är bekräftat och inte startat
--     (status confirmed och start_date null), raden hör till ärendets avtal, mötet är ärendets första möte (meeting_at =
--     cases.first_meeting_at) och mötets tid har varit (meeting_at <= mm.app_now()). För inloggade dessutom: i eget namn
--     (registered_by = den inloggade) och med aktuell tid (registered_at högst 10 minuter från mm.app_now()).
--   * Behörighet (speglas exakt i src/data/policy.ts first_meeting_no_shows och prövas i src/data/supabase/rls-parity.test.ts):
--       läsa:  Miljonbemanning med åtkomst full eller team till ärendet (mm.case_ids('{full,team}')) – aldrig kommunen och aldrig
--              ekonomen (åtkomsten billing).
--       skapa: den som arbetar i ärendet (mm.work_on), medlem i avtalet, i eget namn.
--       ingen ändrar eller raderar.
--   * Ett första möte en gång (unikt index på case_id och meeting_at). Bokas mötet om (arenden.caseBookFirstMeeting) har ärendet
--     ett nytt första möte – kommer deltagaren inte då heller registreras en ny rad.
--
-- Speglas i src/data/policy.ts (first_meeting_no_shows), src/data/schema.ts (TABLE_NAMES, UNIQUE_KEYS), src/core/scope.ts,
-- src/server/staging/load.ts (APPEND_ONLY) och scripts/db/columns.ts. Reglerna för hanteraren i src/core/first-meeting.ts.
-- Inga destruktiva satser och inga befintliga rader, tabeller, funktioner, policyer eller rättigheter ändras – bara en ny tabell
-- med sina triggrar och policyer och en ny hjälpfunktion i schemat mm. Idempotent (if not exists, or replace, drop … if exists) –
-- tål att köras igen i SQL Editor.
--
-- Lås: inga heta tabeller ändras (bara främmande nycklar från den nya tabellen till cases, contracts och profiles). Väntar en sats
-- ändå längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i stället för att alla andra frågor köar bakom den – kör
-- då filen igen. Inställningen gäller bara den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- Tabellen
create table if not exists public.first_meeting_no_shows (
  id            text primary key,
  case_id       text not null references public.cases (id),
  contract_id   text not null references public.contracts (id),
  -- Första mötet som deltagaren inte kom till (cases.first_meeting_at när raden registrerades).
  meeting_at    timestamptz not null,
  kind          text not null,
  reason        text,
  registered_by text not null references public.profiles (id),
  registered_at timestamptz not null
);
alter table public.first_meeting_no_shows drop constraint if exists first_meeting_no_shows_kind_check;
alter table public.first_meeting_no_shows add constraint first_meeting_no_shows_kind_check check (kind in ('uteblev', 'giltig'));
-- Orsaken: högst 300 tecken; vid giltig frånvaro krävs den och får inte vara bara blanksteg.
alter table public.first_meeting_no_shows drop constraint if exists first_meeting_no_shows_reason_check;
alter table public.first_meeting_no_shows add constraint first_meeting_no_shows_reason_check check (
  (reason is null or char_length(reason) <= 300) and (kind <> 'giltig' or (reason is not null and reason ~ '\S'))
);
-- Ett första möte en gång per ärende. Täcker också case_id (främmande nyckel).
create unique index if not exists first_meeting_no_shows_case_meeting_key on public.first_meeting_no_shows (case_id, meeting_at);
create index if not exists first_meeting_no_shows_contract_id_idx on public.first_meeting_no_shows (contract_id);
create index if not exists first_meeting_no_shows_registered_by_idx on public.first_meeting_no_shows (registered_by);

alter table public.first_meeting_no_shows enable row level security;
-- Bara läsa och skapa, för alla (som revisionsloggen, 0009, och kommunens bonusbeslut, 0039): en rad ändras och raderas aldrig –
-- inte heller med truncate, som inte går genom radtriggrarna.
revoke all on public.first_meeting_no_shows from anon, authenticated, service_role;
grant select, insert on public.first_meeting_no_shows to service_role;
grant select, insert on public.first_meeting_no_shows to authenticated;

-- policy.ts first_meeting_no_shows.read: Miljonbemanning med åtkomst full eller team till ärendet – aldrig kommunen (customer)
-- och aldrig ekonomen (billing).
drop policy if exists first_meeting_no_shows_select on public.first_meeting_no_shows;
create policy first_meeting_no_shows_select on public.first_meeting_no_shows for select to authenticated using (
  case_id in (select mm.case_ids('{full,team}'))
);
-- policy.ts noShowWrite (ny rad): den som arbetar i ärendet (mm.work_on – full eller team), medlem i avtalet, i eget namn.
drop policy if exists first_meeting_no_shows_insert on public.first_meeting_no_shows;
create policy first_meeting_no_shows_insert on public.first_meeting_no_shows for insert to authenticated with check (
  mm.work_on(case_id)
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and registered_by = (select mm.current_profile_id())
);

-- ---------------------------------------------------------------- Kontrollen (för alla roller)
-- Ärendets läge för raden (policy.ts noShowCaseOk): null när ärendet är bekräftat och inte startat, hör till avtalet och har
-- mötet som första möte – annars vad som inte stämmer. Security definer: den inloggade läser bara id direkt i public.cases (0013).
-- Svarar bara med en kod (inga uppgifter ur ärendet) och ligger i schemat mm, som inte nås via API:t.
create or replace function mm.first_meeting_no_show_problem(p_case_id text, p_contract_id text, p_meeting_at timestamptz) returns text
language sql stable security definer set search_path = public, mm
as $$
  select case
    when c.id is null then 'case'
    when c.contract_id is distinct from p_contract_id then 'contract'
    when c.status <> 'confirmed' or c.start_date is not null then 'status'
    when c.first_meeting_at is null or c.first_meeting_at <> p_meeting_at then 'meeting'
    else null
  end
  from (select 1) as one
  left join public.cases c on c.id = p_case_id
$$;
revoke all on function mm.first_meeting_no_show_problem(text, text, timestamptz) from public, anon;
grant execute on function mm.first_meeting_no_show_problem(text, text, timestamptz) to authenticated, service_role;

-- För alla roller, också service role: ärendet, mötet och att mötet har varit. För inloggade dessutom i eget namn och med aktuell
-- tid. Triggern körs med anroparens rättigheter (current_user skiljer inloggade från servern), ärendet läses av funktionen ovan.
create or replace function mm.check_first_meeting_no_show() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  problem text;
begin
  problem := mm.first_meeting_no_show_problem(new.case_id, new.contract_id, new.meeting_at);
  if problem = 'case' or problem = 'contract' then
    raise exception 'Raden ska höra till ärendet och ärendets avtal' using errcode = '23514';
  elsif problem = 'status' then
    raise exception 'Bara i ett bekräftat ärende där insatsen inte har startat' using errcode = '23514';
  elsif problem = 'meeting' then
    raise exception 'Mötet ska vara ärendets första möte' using errcode = '23514';
  end if;
  if new.meeting_at > mm.app_now() then
    raise exception 'Första mötet har inte varit än' using errcode = '23514';
  end if;
  if current_user = 'authenticated' then
    if new.registered_by is distinct from mm.current_profile_id() then
      raise exception 'Registreras i eget namn' using errcode = '42501';
    end if;
    if abs(extract(epoch from (new.registered_at - mm.app_now()))) > 600 then
      raise exception 'Registreras med aktuell tid' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists first_meeting_no_shows_check on public.first_meeting_no_shows;
create trigger first_meeting_no_shows_check before insert on public.first_meeting_no_shows
for each row execute function mm.check_first_meeting_no_show();

-- Append-only för alla roller (som revisionsloggen, 0009, och bonus_claim_decisions, 0039): en rad ändras och tas aldrig bort –
-- inte heller av service role. "Läs in testdata på nytt" tömmer tabellen med truncate (mm.reset_test_data), som inte går genom
-- radtriggrar.
create or replace function mm.forbid_first_meeting_no_show_change() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  raise exception 'Att deltagaren inte kom till första mötet ändras och tas aldrig bort' using errcode = '42501';
end
$$;
drop trigger if exists first_meeting_no_shows_append_only on public.first_meeting_no_shows;
create trigger first_meeting_no_shows_append_only before update or delete on public.first_meeting_no_shows
for each row execute function mm.forbid_first_meeting_no_show_change();

reset lock_timeout;
reset statement_timeout;
