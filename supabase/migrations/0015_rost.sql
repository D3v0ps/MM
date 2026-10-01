-- 0015 Röstinspelning och transkribering (SPEC §8, docs/PLAN-ROST.md, beslut 2026-09-30).
--
-- Tre flöden: coachen spelar in avstämningen (eller laddar upp en ljudfil), kommunens handläggare talar in text och
-- deltagaren spelar in via en länk utan inloggning (/rost/:token, som pulslänken). Regler (CLAUDE.md punkt 5–8):
--   * ljud raderas direkt efter lyckad transkribering, senast efter 24 timmar vid fel – ljudfilerna ligger i den privata
--     bucketen "ljud" och tabellen audio_uploads är spåret (läge, storlek, när ljudet raderades – aldrig innehållet)
--   * aldrig inspelning eller AI för skyddade personuppgifter – inga röstlänkar i skyddade ärenden
--   * deltagarens röstmeddelande är text som coachen granskar (underlag, inte en bedömning); inget ljud sparas
--   * kommunen läser röstmeddelanden bara om avtalet säger det (customerVisibility.seesParticipantVoiceNotes) och coachen
--     granskat dem
--
-- Samma regler som src/data/policy.ts (voice_links, participant_voice_notes, audio_uploads). Deltagaren (databasrollen anon)
-- har inga rättigheter: hanteraren kontrollerar länkens token och sparar via service role (ctx.system). Ljudfilernas rader
-- skrivs bara av systemet (ctx.audio, service role) – användare läser bara läget.

-- ---------------------------------------------------------------- Deltagarens inspelningslänk
create table public.voice_links (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  -- SHA-256 (hex) av länkens token – token lagras aldrig i klartext.
  token_hash                 text,
  channel                    text not null,
  language                   text not null,
  sent_at                    timestamptz not null,
  expires_at                 timestamptz not null,
  used_at                    timestamptz,
  created_by                 text not null
);
create index voice_links_case_id_idx on public.voice_links (case_id);
create unique index voice_links_token_hash_key on public.voice_links (token_hash) where token_hash is not null;

-- ---------------------------------------------------------------- Deltagarens röstmeddelande (text)
create table public.participant_voice_notes (
  id                         text primary key,
  case_id                    text not null references public.cases (id),
  link_id                    text not null references public.voice_links (id),
  language                   text not null,
  text_sv                    text not null,
  text_original              text,
  consent_text_version       text not null,
  consent_given_at           timestamptz not null,
  status                     text not null,
  created_at                 timestamptz not null,
  reviewed_by                text,
  reviewed_at                timestamptz,
  ai_run_id                  text
);
create index participant_voice_notes_case_id_idx on public.participant_voice_notes (case_id, status);
create index participant_voice_notes_link_id_idx on public.participant_voice_notes (link_id);

-- ---------------------------------------------------------------- Ljudfilerna (spåret – innehållet ligger i bucketen "ljud")
create table public.audio_uploads (
  id                         text primary key,
  case_id                    text references public.cases (id),
  -- profiles.id, eller 'deltagare' för deltagarens länk.
  owner_id                   text not null,
  purpose                    text not null,
  -- Sökväg i bucketen "ljud", bara id:n (t.ex. 'checkin/aud-….webm').
  storage_path               text not null,
  mime_type                  text not null,
  bytes                      integer,
  duration_sec               integer,
  status                     text not null,
  created_at                 timestamptz not null,
  deleted_at                 timestamptz
);
create index audio_uploads_case_id_idx on public.audio_uploads (case_id);
create index audio_uploads_owner_id_idx on public.audio_uploads (owner_id);
-- Gallringen (ljud som inte raderats inom 24 timmar) letar på läge och tid.
create index audio_uploads_status_idx on public.audio_uploads (status, created_at);

alter table public.voice_links enable row level security;
alter table public.participant_voice_notes enable row level security;
alter table public.audio_uploads enable row level security;
revoke all on public.voice_links, public.participant_voice_notes, public.audio_uploads from anon, authenticated;
grant all on public.voice_links, public.participant_voice_notes, public.audio_uploads to service_role;
grant select, insert, update on public.voice_links to authenticated;
grant select, update on public.participant_voice_notes to authenticated;
grant select on public.audio_uploads to authenticated;

-- ---------------------------------------------------------------- Uppslag utan RLS
-- policy.ts protectedCase(caseId): ärendets person har skyddade personuppgifter. Ett ärende eller en person som saknas
-- räknas som skyddat.
create function mm.case_is_protected(p_case_id text) returns boolean
language sql stable security definer set search_path = public, mm
as $$
  select coalesce((select p.protected_identity from public.cases c join public.persons p on p.id = c.person_id where c.id = p_case_id), true)
$$;
grant execute on function mm.case_is_protected(text) to authenticated, service_role;

-- Ärenden där kommunen (åtkomst 'customer') får läsa granskade röstmeddelanden: avtalet säger
-- customerVisibility.seesParticipantVoiceNotes = true.
create function mm.customer_voice_note_case_ids() returns setof text
language sql stable security definer set search_path = public, mm
as $$
  select a.case_id from mm.my_case_access() a
  join public.cases c on c.id = a.case_id
  join public.contracts k on k.id = c.contract_id
  where a.access = 'customer' and k.config #> '{customerVisibility,seesParticipantVoiceNotes}' = 'true'::jsonb
$$;
grant execute on function mm.customer_voice_note_case_ids() to authenticated, service_role;

-- ---------------------------------------------------------------- Policyer: inspelningslänkar
-- policy.ts voice_links.read: notesRead(caseId) – full eller team, aldrig ekonom eller kommunen
create policy voice_links_select on public.voice_links for select to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
);
-- policy.ts voice_links.write: workOn(caseId) och aldrig skyddade ärenden
create policy voice_links_insert on public.voice_links for insert to authenticated with check (
  mm.work_on(case_id) and not mm.case_is_protected(case_id)
);
create policy voice_links_update on public.voice_links for update to authenticated using (
  (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
) with check (mm.work_on(case_id) and not mm.case_is_protected(case_id));

-- ---------------------------------------------------------------- Policyer: deltagarens röstmeddelanden
-- policy.ts voiceNoteRead: MB notesRead(caseId); kommunen bara granskade (status reviewed) i ärenden med åtkomst 'customer'
-- när avtalet säger customerVisibility.seesParticipantVoiceNotes; övriga aldrig.
create policy participant_voice_notes_select on public.participant_voice_notes for select to authenticated using (
  case
    when (select mm.is_mb()) then (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
    when (select mm.is_kom()) then status = 'reviewed' and case_id in (select mm.customer_voice_note_case_ids())
    else false
  end
);
-- policy.ts participant_voice_notes.write: bara ändring (granskning) av den som arbetar i ärendet, aldrig skyddade ärenden.
-- Nya röstmeddelanden sparas av systemet efter tokenkontrollen (ingen insert för inloggade). Kolumnerna: triggern nedan.
create policy participant_voice_notes_update on public.participant_voice_notes for update to authenticated using (
  case
    when (select mm.is_mb()) then (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}'))
    when (select mm.is_kom()) then status = 'reviewed' and case_id in (select mm.customer_voice_note_case_ids())
    else false
  end
) with check (mm.work_on(case_id) and not mm.case_is_protected(case_id));

-- policy.ts reviewOnly: granskningen ändrar bara status, reviewed_by och reviewed_at – aldrig deltagarens text, språk eller
-- samtycke – och granskaren är den som ändrar. Gäller inloggade (authenticated, anon); service role (systemsteg) påverkas inte.
create function mm.protect_voice_note_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (to_jsonb(new) - array['status', 'reviewed_by', 'reviewed_at']) is distinct from (to_jsonb(old) - array['status', 'reviewed_by', 'reviewed_at']) then
      raise exception 'Bara granskningen av röstmeddelandet kan ändras' using errcode = '42501';
    end if;
    if new.reviewed_by is distinct from old.reviewed_by and new.reviewed_by is not null
       and new.reviewed_by is distinct from mm.current_profile_id() then
      raise exception 'Granskningen görs i eget namn' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger participant_voice_notes_protect_columns before update on public.participant_voice_notes
for each row execute function mm.protect_voice_note_columns();

-- ---------------------------------------------------------------- Policyer: ljudfilerna
-- policy.ts audio_uploads.read: den som spelade in (inte deltagarens gemensamma id), och den som arbetar i ärendet
-- (full eller team, aldrig ekonom) utom kommunens "Tala in". write: never – bara ctx.audio (service role).
create policy audio_uploads_select on public.audio_uploads for select to authenticated using (
  ((select mm.current_role()) is distinct from 'deltagare' and owner_id = (select mm.current_profile_id()))
  or (nullif(case_id, '') is not null and purpose <> 'dictation'
      and (select mm.current_role()) is distinct from 'ekonom' and case_id in (select mm.case_ids('{full,team}')))
);

-- ---------------------------------------------------------------- Privat bucket för ljud (Stockholm)
-- Bara service role läser och skriver (inga policyer på storage.objects). Klienten laddar upp direkt med en signerad
-- uppladdningsadress som servern skapar (Vercels funktioner tar högst 4,5 MB). Högst 25 MB per fil, bara ljud.
-- Hoppas över där Supabase Storage saknas (t.ex. lokala tester i PGlite).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ljud', 'ljud', false, 26214400, array['audio/*'])
    on conflict (id) do nothing;
  end if;
end
$$;
