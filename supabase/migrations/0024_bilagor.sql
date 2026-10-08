-- 0024 Bilagor till beställningen (beslut 2026-10-07, synpunkt #7 och beslut 4).
--
-- I beställningens steg "Bakgrundsinformation om deltagaren" kan kommunens handläggare bifoga filer (PDF, Word, bild – högst
-- 10 MB per fil, högst 10 filer), t.ex. en kartläggning. Filerna ligger i den privata bucketen "bilagor" i Supabase Storage
-- (Stockholm). Tabellen case_attachments är spåret: vem, när, typ, storlek, var filen ligger och när den raderades.
-- Regler (samma som src/data/policy.ts, case_attachments):
--   * läsa: den som laddade upp, så länge filen inte är kopplad till en beställning (case_id is null) – och i ärendet:
--     samordnare, avtalsansvarig och coach med full åtkomst (coachen = namngiven huvudcoach) samt kommunens handläggare som
--     beställde (åtkomst 'customer'). Aldrig handledare (team), ekonom (billing), chef, admin eller deltagare. Raderade filer
--     syns inte (deleted_at is null).
--   * skriva: ingen inloggad användare skriver raderna. Hanteraren kontrollerar behörigheten (ärendet via RLS, rollen, den
--     egna uppladdningen) och porten (src/features/_shared/attachment-port.ts, src/server/attachments) skriver med service
--     role – samma mönster som audio_uploads (0015).
--   * filnamnet visas bara i appen: sökvägen i bucketen är "<avtal>/<id>.<ändelse>", nedladdningen sker med en signerad
--     adress som gäller i 60 sekunder (utan parametern download) och revisionsloggen får aldrig filnamnet.
--   * gallring: uppladdningar som aldrig kopplades raderas efter 24 timmar; bilagor i avslutade ärenden enligt avtalets
--     retentionRules.attachmentsAfterCloseDays (Botkyrka: ATT_FASTSTÄLLA – inget raderas tills regeln är fastställd).
-- Migrationen skrivs men appliceras inte förrän omgångarna är sammanfogade (driftordning: 0023–0026 tillsammans).

-- ---------------------------------------------------------------- Tabellen
create table public.case_attachments (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  -- Ärendet, eller null tills beställningen har skickats.
  case_id                    text references public.cases (id),
  -- profiles.id för den som laddade upp.
  uploaded_by                text not null references public.profiles (id),
  -- Filnamnet som det visas i appen. Aldrig i sökvägen, i en URL eller i revisionsloggen.
  file_name                  text not null check (char_length(file_name) between 1 and 200),
  mime_type                  text not null check (mime_type in (
                               'application/pdf', 'application/msword',
                               'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                               'image/jpeg', 'image/png', 'image/heic')),
  bytes                      integer not null check (bytes > 0 and bytes <= 10485760),
  -- Sökväg i bucketen "bilagor": bara avtal och id (t.ex. 'c-bot/att-….pdf').
  storage_path               text not null,
  status                     text not null check (status in ('pending', 'uploaded', 'deleted')),
  created_at                 timestamptz not null,
  linked_at                  timestamptz,
  removed_at                 timestamptz,
  removed_by                 text,
  deleted_at                 timestamptz,
  delete_reason              text check (delete_reason is null or delete_reason in ('unlinked_24h', 'retention', 'removed', 'invalid')),
  constraint case_attachments_removed_pair check ((removed_at is null) = (removed_by is null)),
  constraint case_attachments_deleted_pair check ((deleted_at is null) = (delete_reason is null)),
  constraint case_attachments_deleted_status check ((status = 'deleted') = (deleted_at is not null)),
  constraint case_attachments_linked check ((case_id is null) = (linked_at is null))
);
create unique index case_attachments_storage_path_key on public.case_attachments (storage_path);
create index case_attachments_case_id_idx on public.case_attachments (case_id);
create index case_attachments_contract_id_idx on public.case_attachments (contract_id);
create index case_attachments_uploaded_by_idx on public.case_attachments (uploaded_by);
-- Gallringen letar på läge och tid.
create index case_attachments_status_idx on public.case_attachments (status, created_at);

alter table public.case_attachments enable row level security;
revoke all on public.case_attachments from anon, authenticated;
grant all on public.case_attachments to service_role;
-- Bara läsning för inloggade. Raderna skrivs av systemet (ctx.attachments, service role).
grant select on public.case_attachments to authenticated;

-- ---------------------------------------------------------------- Policyer
-- policy.ts case_attachments.read. write: never (ingen insert-, update- eller delete-policy).
create policy case_attachments_select on public.case_attachments for select to authenticated using (
  deleted_at is null and (
    (case_id is null
      and (select mm.current_role()) is distinct from 'deltagare'
      and uploaded_by = (select mm.current_profile_id()))
    or (case_id is not null and (
      ((select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach'])) and case_id in (select mm.case_ids('{full}')))
      or ((select mm.current_role()) = 'kommun_handlaggare'
          and case_id in (select mm.case_ids('{customer}'))
          and mm.case_referrer_id(case_id) = (select mm.current_profile_id()))
    ))
  )
);

-- ---------------------------------------------------------------- Privat bucket för bilagor (Stockholm)
-- Bara service role läser och skriver (inga policyer på storage.objects). Webbläsaren laddar upp direkt med en signerad
-- uppladdningsadress som servern skapar och hämtar med en signerad adress som gäller i 60 sekunder. Högst 10 MB per fil,
-- bara PDF, Word och bild. Hoppas över där Supabase Storage saknas (t.ex. lokala tester i PGlite).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('bilagor', 'bilagor', false, 10485760, array[
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png', 'image/heic'])
    on conflict (id) do nothing;
  end if;
end
$$;
