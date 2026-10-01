-- 0019 Fria anteckningar i deltagarkortet (rapportarbetet steg 2, SPEC §7.18, beslut 2026-10-01).
--
-- MB skriver korta anteckningar i ärendet (samtal med deltagaren, kontakt med kommunen, praktiskt, övrigt). De visas i
-- deltagarkortets tidslinje och kommer bara in i månadsrapporten genom att huvudcoachen lägger in texten i
-- månadsbedömningens sammanfattning och godkänner den – aldrig av sig själva. Aldrig i loggar, AI, utskick eller export.
-- Samma regler som src/data/policy.ts (case_notes, caseNoteWrite):
--   * läsa: som coachanteckningar – full eller team, aldrig ekonom eller kommunen (inte heller när avtalet har
--     customerVisibility.seesCoachNotes, som bara är en gränssnittstext). audience 'full' bara med full åtkomst.
--     Skyddade personuppgifter sköts av mm.case_access: bara avtalsansvarig och namngiven huvudcoach har 'full'.
--   * skriva ny: den som arbetar i ärendet (mm.work_on), i eget namn, i ärendets avtal; med teamåtkomst bara audience 'team'
--   * ändra texten: bara författaren
--   * dölja ("Ta bort"): författaren, och samordnare och avtalsansvarig med full åtkomst i ärendet (beslut 2026-10-01) –
--     bara removed_at och removed_by, i eget namn
--   * ingen raderar: ingen delete-policy och ingen delete-rättighet. En borttagen anteckning ändras och återställs aldrig.
-- Tiderna sätts av hanteraren med ctx.now() (testtid i testmiljön) – inga default now().

-- ---------------------------------------------------------------- Tabellen
create table public.case_notes (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  case_id                    text not null references public.cases (id),
  author_id                  text not null references public.profiles (id),
  -- Dagen anteckningen gäller.
  occurred_on                date not null,
  kind                       text not null check (kind in ('conversation', 'customer_contact', 'practical', 'other')),
  audience                   text not null check (audience in ('full', 'team')),
  body                       text not null check (char_length(body) between 1 and 2000),
  created_at                 timestamptz not null,
  updated_at                 timestamptz,
  removed_at                 timestamptz,
  -- Vem som tog bort anteckningen (profiles.id). Satt precis när removed_at är satt.
  removed_by                 text,
  constraint case_notes_removed_pair check ((removed_at is null) = (removed_by is null))
);
create index case_notes_case_id_idx on public.case_notes (case_id, occurred_on);
create index case_notes_author_id_idx on public.case_notes (author_id);
create index case_notes_contract_id_idx on public.case_notes (contract_id);

alter table public.case_notes enable row level security;
revoke all on public.case_notes from anon, authenticated;
grant all on public.case_notes to service_role;
-- Ingen delete: anteckningar raderas aldrig av användare (gallring görs av systemet).
grant select, insert, update on public.case_notes to authenticated;

-- ---------------------------------------------------------------- Uppslag utan RLS
-- policy.ts raw.get("cases", caseId)?.contractId: ärendets avtal (inloggade läser bara kolumnen id i cases direkt, 0013).
create function mm.case_contract_id(p_case_id text) returns text
language sql stable security definer set search_path = public, mm
as $$ select c.contract_id from public.cases c where c.id = p_case_id $$;
grant execute on function mm.case_contract_id(text) to authenticated, service_role;

-- ---------------------------------------------------------------- Policyer
-- policy.ts case_notes.read: notesRead(caseId) && (audience === "team" || accessTo(caseId) === "full")
create policy case_notes_select on public.case_notes for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom'
  and case_id in (select mm.case_ids('{full,team}'))
  and (audience = 'team' or case_id in (select mm.case_ids('{full}')))
);
-- policy.ts caseNoteWrite (ny rad): workOn(caseId) && self(authorId) && (audience === "team" || accessTo(caseId) === "full").
-- Avtalet, updated_at, removed_at och removed_by kontrolleras av triggern nedan.
create policy case_notes_insert on public.case_notes for insert to authenticated with check (
  mm.work_on(case_id) and author_id = (select mm.current_profile_id()) and (audience = 'team' or mm.case_access(case_id) = 'full')
);
-- policy.ts caseNoteWrite (ändring): författaren (workOn och samma regel för audience), eller samordnare och avtalsansvarig
-- med full åtkomst (bara dölja – vilka kolumner som får ändras styr triggern nedan).
create policy case_notes_update on public.case_notes for update to authenticated using (
  (author_id = (select mm.current_profile_id()) and mm.work_on(case_id))
  or ((select mm.current_role()) in ('samordnare', 'avtalsansvarig') and mm.case_access(case_id) = 'full')
) with check (
  (author_id = (select mm.current_profile_id()) and mm.work_on(case_id) and (audience = 'team' or mm.case_access(case_id) = 'full'))
  or ((select mm.current_role()) in ('samordnare', 'avtalsansvarig') and mm.case_access(case_id) = 'full')
);

-- ---------------------------------------------------------------- Kolumnskydd
-- policy.ts caseNoteWrite. Gäller inloggade (authenticated, anon); service role (systemsteg, gallring) påverkas inte.
--   ny rad:   avtalet är ärendets avtal; varken ändrad eller borttagen (updated_at, removed_at, removed_by är null)
--   ändring:  en borttagen anteckning är låst (ingen ändring av texten och ingen återställning med removed_at = null);
--             något måste ändras (som policy.ts, där regeln också stoppar MemoryRepo.remove()); id, ärende, avtal,
--             författare och skapad-tid ändras aldrig; removed_at och removed_by sätts tillsammans och i eget namn;
--             den som inte är författaren ändrar bara removed_at och removed_by (aldrig texten, typen, datumet eller
--             vem som ser anteckningen).
create function mm.protect_case_note_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  me text := mm.current_profile_id();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.contract_id is distinct from mm.case_contract_id(new.case_id) then
      raise exception 'Anteckningen ska höra till ärendets avtal' using errcode = '42501';
    end if;
    if new.updated_at is not null or new.removed_at is not null or new.removed_by is not null then
      raise exception 'En ny anteckning kan inte vara ändrad eller borttagen' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.removed_at is not null then
    raise exception 'En borttagen anteckning kan inte ändras' using errcode = '42501';
  end if;
  if to_jsonb(new) = to_jsonb(old) then
    raise exception 'Ändringen ändrar ingenting' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.case_id is distinct from old.case_id or new.contract_id is distinct from old.contract_id
     or new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at then
    raise exception 'Ärende, avtal, författare och tid kan inte ändras' using errcode = '42501';
  end if;
  if (new.removed_at is distinct from old.removed_at or new.removed_by is distinct from old.removed_by)
     and (new.removed_at is null or new.removed_by is distinct from me) then
    raise exception 'En anteckning tas bort i eget namn' using errcode = '42501';
  end if;
  if old.author_id is distinct from me
     and (to_jsonb(new) - array['removed_at', 'removed_by']) is distinct from (to_jsonb(old) - array['removed_at', 'removed_by']) then
    raise exception 'Bara författaren kan ändra anteckningen' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger case_notes_protect_columns before insert or update on public.case_notes
for each row execute function mm.protect_case_note_columns();
