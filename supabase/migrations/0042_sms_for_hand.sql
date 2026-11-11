-- 0042 SMS att skicka och seriens tid för ett flyttat tillfälle (Karims beslut 2026-11-11, SPEC §9 och §7.19).
--
-- 1. SMS att skicka – coachen skickar SMS till deltagaren själv.
--
-- SMS till deltagare är inte kopplat i produktionen (46elks, docs/DRIFT.md avsnitt 13) och e-post till deltagare stoppas av
-- spärrlistan. Coachens Min vecka har därför sektionen "SMS att skicka": veckans tider (från fredag för nästa ISO-vecka) och
-- meddelanden till deltagaren som inte kunde skickas automatiskt (kallelse, inbjudan, ändrad och inställd aktivitet). Coachen
-- kopierar numret och texten, skickar SMS:et från sin telefon och trycker Markera som skickat. Raderna räknas fram av servern
-- varje gång (aktiviteterna, utskicksloggen och samordnarens uppgifter) – inget genererat sparas.
--
-- Markera som skickat sparar en rad i utskicksloggen (public.outbound_messages): kanalen sms, status sent_manually (ny status –
-- kolumnen är text utan check, 0006), mottagaren "deltagare (SMS)" och texten som skickades (bara tid, plats och Miljonbemannings
-- telefonnummer – CLAUDE.md punkt 9). Aldrig deltagarens nummer eller adress. Radens id bestäms av vad som skickades (veckan och
-- ärendet, eller samordnarens uppgift), så att två coacher som trycker samtidigt ger en rad – den andra skrivningen stoppas av
-- primärnyckeln (23505) och hanteraren svarar att SMS:et redan är markerat.
--
-- Den här migrationen: kolumnen sent_by – vem som markerade SMS:et som skickat (profiles.id). Null för allt som servern skickar
-- (e-post, SMS och samtal via leverantören, brev). Ingen främmande nyckel: utskicksloggen töms och läses in på nytt i testmiljön
-- (mm.reset_test_data) i samma ordning som förut, och raden ska finnas kvar om profilen tas bort.
--
-- Behörigheten är oförändrad (0006, speglas i src/data/policy.ts outbound_messages): systemadministratören och samordnaren läser
-- utskicksloggen, ingen inloggad skriver – raden skrivs av servern (service role) efter att hanteraren prövat att coachen får se
-- ärendet och personen. Rättigheten select på tabellen (0006) gäller också den nya kolumnen. Prövas i
-- src/data/supabase/sms-for-hand.test.ts.
--
-- 2. Seriens tid för ett tillfälle (Ändra tid, punkt 4 – granskningen 2026-11-11). Ett enskilt tillfälle i en återkommande aktivitet
--    kan få ny dag, tid eller längd. Jobbet som skapar seriens tillfällen (ensureSeriesOccurrences, report_schedule) får aldrig
--    skapa ett nytt tillfälle på den gamla tiden. Tidigare stod den gamla tiden bara i revisionsloggen, skriven efter flytten – ett
--    jobb mellan flytten och loggraden kunde skapa en dubblett. Nu står den på raden:
--      * group_activities.series_slot (timestamptz, null utan serie): tiden jobbet skapade tillfället på. Sätts av servern när
--        tillfället skapas och ändras aldrig – inte heller när tillfället flyttas. Check: bara med series_id.
--      * Unikt (series_id, series_slot) där båda finns: jobbet kan inte skapa ett andra tillfälle på seriens tid, också mitt i en flytt.
--      * Befintliga tillfällen fylls i: seriens tid från en tidigare flytt i revisionsloggen (group_activity_series.occurrence_moved,
--        details.seriesSlot i Stockholms tid), annars tillfällets tid nu.
--      * Inloggade sätter eller ändrar aldrig kolumnen: nya rader från inloggade har ingen serie (policyn group_activities_insert,
--        0035) och därmed ingen seriens tid (checken), och kolumnskyddet (mm.protect_group_activity_columns, 0030/0035) nekar en
--        ändring. Speglas i src/data/policy.ts (GROUP_FIXED, groupActivityShape, groupActivityWrite) och src/data/schema.ts
--        (UNIQUE_KEYS). Prövas i src/data/supabase/series-slot.test.ts.
--
-- Idempotent (if not exists, or replace, drop … if exists) – tål att köras igen i SQL Editor. Lås: korta lås på
-- public.outbound_messages och public.group_activities när kolumnerna läggs till (ingen omskrivning – inget standardvärde) och när
-- indexet och checken skapas (små tabeller). Väntar en sats längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i
-- stället för att andra frågor köar bakom den – kör då filen igen. Inställningen återställs sist i filen.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table public.outbound_messages add column if not exists sent_by text;

comment on column public.outbound_messages.sent_by is
  'Vem som markerade ett SMS som skickat för hand (status sent_manually, profiles.id). Null för utskick som servern skickar. Aldrig nummer eller adresser.';

-- ---------------------------------------------------------------- 2. Seriens tid för ett tillfälle
alter table public.group_activities add column if not exists series_slot timestamptz;

comment on column public.group_activities.series_slot is
  'Seriens tid för tillfället: tiden jobbet skapade det på. Ändras aldrig, inte heller när tillfället får ny tid. Null utan serie.';

-- Befintliga tillfällen: seriens tid från en tidigare flytt (loggen), annars tillfällets tid nu. Bara rader som saknar den.
update public.group_activities g
set series_slot = coalesce(
  (select (l.details ->> 'seriesSlot')::timestamp at time zone 'Europe/Stockholm'
     from public.audit_log l
    where l.entity = 'group_activity_series' and l.action = 'group_activity_series.occurrence_moved'
      and l.entity_id = g.series_id and l.details ->> 'groupActivityId' = g.id and l.details ->> 'seriesSlot' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
    order by l.occurred_at, l.id
    limit 1),
  g.starts_at)
where g.series_id is not null and g.series_slot is null;

alter table public.group_activities drop constraint if exists group_activities_series_slot_series;
alter table public.group_activities add constraint group_activities_series_slot_series check (series_slot is null or series_id is not null);

-- Ett tillfälle per serie och seriens tid (UNIQUE_KEYS i src/data/schema.ts).
create unique index if not exists group_activities_series_slot_key on public.group_activities (series_id, series_slot)
  where series_id is not null and series_slot is not null;

-- Kolumnskyddet från 0030/0035, och seriens tid ändras aldrig av en inloggad.
create or replace function mm.protect_group_activity_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  me text := mm.current_profile_id();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if to_jsonb(new) = to_jsonb(old) then
    raise exception 'Ändringen ändrar ingenting' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.contract_id is distinct from old.contract_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.series_id is distinct from old.series_id
     or new.series_slot is distinct from old.series_slot then
    raise exception 'Avtal, skapare, tid och serie kan inte ändras' using errcode = '42501';
  end if;
  if (new.updated_at is distinct from old.updated_at or new.updated_by is distinct from old.updated_by)
     and (new.updated_at is null or new.updated_by is distinct from me) then
    raise exception 'En ändring görs i eget namn' using errcode = '42501';
  end if;
  if (new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by)
     and (new.cancelled_at is null or new.cancelled_by is distinct from me) then
    raise exception 'En aktivitet ställs in i eget namn' using errcode = '42501';
  end if;
  return new;
end
$$;

reset lock_timeout;
reset statement_timeout;
