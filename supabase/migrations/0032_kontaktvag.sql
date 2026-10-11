-- 0032 Kontaktväg på deltagarkortet (coachmötet 2026-10-09, Karims beslut: kommunen anger inte längre kontaktvägen –
-- Miljonbemanning frågar deltagaren vid första mötet och för in svaret på deltagarkortet).
--
-- Kommandot arenden.caseSetContact (samordnare, avtalsansvarig, coach och systemadministratör) ändrar deltagarens
-- kontaktväg (SMS, telefon eller e-post), telefonnummer och e-postadress i public.persons. Samordnare, avtalsansvarig och
-- coach med full åtkomst fick redan skriva personen (mm.person_write, 0003). Systemadministratören läser ärendet med full
-- åtkomst men skrev inte personen. Ändringen:
--   * mm.person_write ger också rollen admin skrivrätt när åtkomsten till ett av personens ärenden är 'full' (aldrig vid
--     skyddade personuppgifter – vilande spärr, åtkomsten är då 'restricted').
--   * Triggern persons_admin_contact_only: systemadministratören ändrar bara kontaktuppgifterna (preferred_contact, phone,
--     email och address – adressen töms när kontaktvägen inte är brev). Namn, personnummer, språk och allt annat nekas.
--     Triggern gäller bara inloggade användare (authenticated); servern (service role) och övriga roller påverkas inte.
-- Samma regler i src/data/policy.ts (persons.write, PERSON_CONTACT_FIELDS) och prövas i src/data/supabase/rls-parity.test.ts.
-- Revisionsloggen (person.contact_changed) skrivs av hanteraren med id:n och vilka fält som ändrades – aldrig värdena.
-- Idempotent (create or replace, drop trigger if exists), inga destruktiva satser.

create or replace function mm.person_write(p_person_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select case
    when not exists (select 1 from public.cases c where c.person_id = p_person_id)
      then mm.role_in(array['samordnare', 'avtalsansvarig', 'kommun_handlaggare'])
    else exists (
      select 1 from public.cases c
      join mm.my_case_access() a on a.case_id = c.id
      where c.person_id = p_person_id
        and ((a.access = 'full' and mm.role_in(array['samordnare', 'avtalsansvarig', 'coach', 'admin']))
          or (a.access = 'customer' and mm.current_role() = 'kommun_handlaggare'
              and nullif(c.referrer_id, '') is not null and c.referrer_id = mm.current_profile_id())))
  end
$$;

-- Systemadministratören ändrar bara deltagarens kontaktuppgifter (policy.ts: PERSON_CONTACT_FIELDS).
create or replace function mm.protect_person_admin_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if mm.current_role() is distinct from 'admin' then
    return new;
  end if;
  if (to_jsonb(new) - array['preferred_contact', 'phone', 'email', 'address'])
     is distinct from (to_jsonb(old) - array['preferred_contact', 'phone', 'email', 'address']) then
    raise exception 'Systemadministratören ändrar bara deltagarens kontaktuppgifter' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists persons_admin_contact_only on public.persons;
create trigger persons_admin_contact_only before update on public.persons
for each row execute function mm.protect_person_admin_columns();
