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
--   * Append-only för inloggade (triggern first_meeting_no_shows_append_only och rättigheterna): ingen inloggad ändrar eller
--     raderar en rad. Service role ändrar aldrig en rad men får radera (gallring) – rättigheterna select, insert och delete, och
--     ingen truncate. "Läs in testdata på nytt" tömmer tabellen med mm.reset_test_data (security definer) och läser in raderna med
--     "on conflict do nothing" (src/server/staging/load.ts).
--   * För alla roller, också service role (triggern first_meeting_no_shows_check): ärendet är bekräftat och inte startat
--     (status confirmed och start_date null), raden hör till ärendets avtal, mötet är ärendets första möte (meeting_at =
--     cases.first_meeting_at) och mötets tid har varit (meeting_at <= mm.app_now()). För inloggade dessutom: den som arbetar i
--     ärendet (mm.work_on – annars ett och samma nekande, 42501, utan uppgifter om ärendet: triggern körs före policyn), i eget
--     namn (registered_by = den inloggade) och med aktuell tid (registered_at högst 10 minuter från mm.app_now()).
--   * Startdatumet (triggern cases_start_date_no_show_guard på public.cases, för alla roller): ett ärendes startdatum sätts inte så
--     länge ärendets första möte (cases.first_meeting_at) är registrerat som ett möte som deltagaren inte kom till – inte med
--     Starta insatsen och inte med Ändra startdatum. Annars skulle insatsen kunna starta på det mötet, så att veckan blev
--     debiterbar och mötet kunde få automatisk närvaro. Efter ett nytt första möte gäller den vanliga regeln (tidigast mötets dag,
--     också samma dag som deltagaren inte kom till ett tidigare möte).
--   * Behörighet (speglas exakt i src/data/policy.ts first_meeting_no_shows och prövas i src/data/supabase/rls-parity.test.ts):
--       läsa:  Miljonbemanning med åtkomst full eller team till ärendet (mm.case_ids('{full,team}')) – aldrig kommunen och aldrig
--              ekonomen (åtkomsten billing).
--       skapa: den som arbetar i ärendet (mm.work_on), medlem i avtalet, i eget namn.
--       ingen inloggad ändrar eller raderar; service role raderar bara (gallring).
--   * Ett första möte en gång (unikt index på case_id och meeting_at). Bokas mötet om (arenden.caseBookFirstMeeting) har ärendet
--     ett nytt första möte – kommer deltagaren inte då heller registreras en ny rad.
--
-- Speglas i src/data/policy.ts (first_meeting_no_shows, cases.guard och caseStartChangeApplies – noShowOnOrAfter),
-- src/data/schema.ts (TABLE_NAMES, UNIQUE_KEYS), src/core/scope.ts, src/server/staging/load.ts (APPEND_ONLY) och
-- scripts/db/columns.ts. Reglerna för hanterarna i src/core/first-meeting.ts.
-- Inga destruktiva satser och inga befintliga rader, tabeller, funktioner, policyer eller rättigheter ändras – bara en ny tabell
-- med sina triggrar och policyer och nya funktioner i schemat mm. Befintliga tabeller som får något nytt: public.cases (den nya
-- triggern cases_start_date_no_show_guard, before insert or update of start_date – ändrar inga rader). Idempotent (if not exists,
-- or replace, drop … if exists) – tål att köras igen i SQL Editor.
--
-- Lås: den nya triggern tar ett starkt lås på public.cases (het tabell) en kort stund; i övrigt bara främmande nycklar från den nya
-- tabellen till cases, contracts och profiles. Väntar en sats längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i
-- stället för att alla andra frågor köar bakom den – kör då filen igen, gärna utanför arbetstid. Inställningen gäller bara den här
-- körningen (återställs sist i filen).
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
-- Inloggade läser och skapar. Service role läser, skapar och raderar (gallring) – ändrar aldrig och tömmer aldrig tabellen med
-- truncate, som inte går genom radtriggrarna.
revoke all on public.first_meeting_no_shows from anon, authenticated, service_role;
grant select, insert, delete on public.first_meeting_no_shows to service_role;
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

-- För alla roller, också service role: ärendet, mötet och att mötet har varit. För inloggade dessutom den som arbetar i ärendet,
-- i eget namn och med aktuell tid. Triggern körs med anroparens rättigheter (current_user skiljer inloggade från servern), ärendet
-- läses av funktionen ovan. Triggern körs före policyn first_meeting_no_shows_insert: den inloggade som inte arbetar i ärendet
-- (kommunen, ekonomen, chefen, admin – eller ett ärende som inte finns) nekas därför först, med ett och samma svar, så att
-- felmeddelandena aldrig säger något om ärendets läge eller möte.
create or replace function mm.check_first_meeting_no_show() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  problem text;
begin
  if current_user = 'authenticated' and not mm.work_on(new.case_id) then
    raise exception 'Du kan inte registrera det i det här ärendet' using errcode = '42501';
  end if;
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

-- Append-only för inloggade (policy.ts noShowGuard): en rad ändras aldrig – inte heller av service role – och tas bara bort av
-- service role (gallring; rättigheten delete har bara service role). "Läs in testdata på nytt" tömmer tabellen med truncate
-- (mm.reset_test_data), som inte går genom radtriggrar.
create or replace function mm.forbid_first_meeting_no_show_change() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon') then
    return old;
  end if;
  raise exception 'Att deltagaren inte kom till första mötet ändras aldrig och tas bara bort vid gallring' using errcode = '42501';
end
$$;
drop trigger if exists first_meeting_no_shows_append_only on public.first_meeting_no_shows;
create trigger first_meeting_no_shows_append_only before update or delete on public.first_meeting_no_shows
for each row execute function mm.forbid_first_meeting_no_show_change();

-- ---------------------------------------------------------------- Startdatumet och ett första möte som deltagaren inte kom till
-- policy.ts cases.guard och caseStartChangeApplies (missedCurrentMeeting): startdatumet sätts inte så länge ärendets första möte
-- (raden efter ändringen) är registrerat som ett möte som deltagaren inte kom till – för alla roller, också service role och
-- Ändra startdatum (mm.apply_case_start_change). Efter ett nytt första möte gäller den vanliga regeln. Security definer: alla
-- registreringar i ärendet läses, oavsett vem som ändrar. Triggern heter så att den körs efter cases_start_date_guard (0038 –
-- triggrarna körs i bokstavsordning): den som inte får sätta startdatumet nekas där först och får aldrig veta något om
-- registreringarna.
create or replace function mm.guard_case_start_after_no_show() returns trigger
language plpgsql security definer set search_path = public, mm
as $$
begin
  if new.start_date is null or (tg_op = 'UPDATE' and new.start_date is not distinct from old.start_date) then
    return new;
  end if;
  if new.first_meeting_at is not null and exists (
    select 1 from public.first_meeting_no_shows x where x.case_id = new.id and x.meeting_at = new.first_meeting_at
  ) then
    raise exception 'Deltagaren kom inte till första mötet – boka ett nytt första möte innan insatsen startar' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function mm.guard_case_start_after_no_show() from public, anon;
drop trigger if exists cases_start_date_no_show_guard on public.cases;
create trigger cases_start_date_no_show_guard before insert or update of start_date on public.cases
for each row execute function mm.guard_case_start_after_no_show();

reset lock_timeout;
reset statement_timeout;
