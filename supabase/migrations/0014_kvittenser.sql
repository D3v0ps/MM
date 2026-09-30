-- 0014 Kvittenser ändrar bara sina egna kolumner (rapporter och meddelanden).
--
-- RLS avgör vilka rader en användare får ändra, inte vilka kolumner. Policyerna reports_update och messages_update
-- finns för kvittenser: kommunen kvitterar att en levererad rapport öppnats (opened_at, opened_by) och den som arbetar
-- i ärendet eller beställande handläggare markerar meddelanden som lästa (read_by, read_at). Utan kolumnkontroll kunde
-- ett direktanrop mot API:t skriva om en levererad rapport (status, snapshot, approved_by …) eller ett meddelande
-- (body, sender_id). Triggarna nedan stoppar det för inloggade användare (rollerna authenticated och anon); service
-- role (systemsteg) påverkas inte. Samma regler finns i src/data/policy.ts (minnesläget).

-- Rapporter: kommunens roller får bara kvittera – en gång, i eget namn, och inga andra kolumner.
create function mm.protect_report_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') and mm.is_kom() then
    if (to_jsonb(new) - array['opened_at', 'opened_by']) is distinct from (to_jsonb(old) - array['opened_at', 'opened_by']) then
      raise exception 'Kommunen får bara kvittera rapporten' using errcode = '42501';
    end if;
    if (new.opened_at is distinct from old.opened_at or new.opened_by is distinct from old.opened_by)
       and (old.opened_at is not null or new.opened_at is null or new.opened_by is distinct from mm.current_profile_id()) then
      raise exception 'Kommunen får bara kvittera rapporten' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger reports_protect_columns before update on public.reports
for each row execute function mm.protect_report_columns();

-- Meddelanden: bara läskvittot (read_by, read_at). Den som ändrar får bara lägga till sig själv i read_by, aldrig ta bort
-- någon, och read_at sätts bara en gång. Kommunens chef läser utan kvitto och ändrar inga meddelanden.
create function mm.protect_message_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if mm.current_role() = 'kommun_chef' then
      raise exception 'Kommunens chef ändrar inga meddelanden' using errcode = '42501';
    end if;
    if (to_jsonb(new) - array['read_by', 'read_at']) is distinct from (to_jsonb(old) - array['read_by', 'read_at']) then
      raise exception 'Bara läskvittot får ändras' using errcode = '42501';
    end if;
    if new.read_by is distinct from old.read_by and (
      not (old.read_by <@ new.read_by)
      or exists (select 1 from unnest(new.read_by) as r (id) where r.id <> all (old.read_by) and r.id is distinct from mm.current_profile_id())
    ) then
      raise exception 'Bara läskvittot får ändras' using errcode = '42501';
    end if;
    if new.read_at is distinct from old.read_at and (old.read_at is not null or new.read_at is null) then
      raise exception 'Bara läskvittot får ändras' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger messages_protect_columns before update on public.messages
for each row execute function mm.protect_message_columns();
