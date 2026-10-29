-- 0037 Filer på deltagarkortet – CV, personligt brev, betyg och intyg (Karims beslut 2026-10-29).
--
-- "Vi vill kunna ladda upp filer på deltagares profiler. Typ CVn o så." Ska kommunen se filerna? "Nej, bara MB."
--
-- Byggt på bilagorna till beställningen (0024, 0028): samma tabell case_attachments, samma privata bucket "bilagor" i
-- Stockholm, samma filtyper (PDF, Word, bild), samma gräns på 10 MB per fil, samma kontroll av filens första byte och samma väg
-- in (signerad uppladdningsadress – porten src/features/_shared/attachment-port.ts skriver raderna med service role).
--
-- 1. case_attachments.kind: 'order' (bilaga till beställningen – alla befintliga rader, och standardvärdet) eller
--    'participant' (fil på deltagarkortet). Kolumnen läggs till med ett fast standardvärde, så befintliga rader blir 'order'
--    utan att tabellen skrivs om.
-- 2. case_attachments.category: deltagarfilens typ – 'cv', 'personligt_brev', 'betyg_intyg' eller 'ovrigt'. Null för
--    beställningens bilagor. Kontrollerna (gäller alla, också service role): en deltagarfil har alltid en typ och hör alltid
--    till ett ärende – den laddas upp på deltagarkortet, aldrig innan beställningen finns; en bilaga till beställningen har
--    aldrig någon typ.
-- 3. Policyn case_attachments_select skrivs om (samma regler som src/data/policy.ts case_attachments):
--      * samordnare, avtalsansvarig och coach med full åtkomst till ärendet läser båda slagen (beställningens bilagor som förut),
--      * kommunens handläggare som beställde läser bara beställningens bilagor (kind = 'order') – aldrig deltagarfilerna,
--      * den egna uppladdningen innan beställningen skickats gäller bara beställningens bilagor (en deltagarfil har alltid ett
--        ärende, se 2),
--      * ekonom, chef, admin, den vilande rollen handledare och deltagare läser aldrig någon av dem. Raderade filer syns inte.
--    Skrivningen är oförändrad: ingen inloggad användare skriver raderna (ingen insert-, update- eller delete-policy och bara
--    select-rättighet) – bara servern med service role efter hanterarens kontroll (roll, full åtkomst, ärendets status).
-- Gallring: deltagarfilerna gallras aldrig automatiskt – samma beslut som för bilagorna i ett ärende (beslut 5, 2026-10-08).
-- Miljonbemanning tar bort dem för hand, när som helst. Städningen (jobbet attachments_retention) rör bara uppladdningar som
-- aldrig blev klara och filer i lagringen utan levande rad. Inget i rapporter, resultatfil, exporter, fakturor, underlaget till
-- AI eller kommunens portal läser deltagarfilerna.
--
-- Speglas i src/data/policy.ts (case_attachments), src/data/schema.ts (CaseAttachment.kind och category) och
-- scripts/db/columns.ts, och prövas i src/data/supabase/rls-parity.test.ts.
-- Inga destruktiva satser. Idempotent (add column if not exists, drop … if exists före varje add constraint och create policy)
-- – tål att köras igen i SQL Editor. SQL Editor kör filen som en transaktion: policyn byts i samma steg som den tas bort, så det
-- finns aldrig ett ögonblick utan policy (och utan policy nekar RLS ändå allt).
-- Driftordning (docs/DRIFT.md): 0037 appliceras FÖRE koden – koden skriver kind och category vid varje ny uppladdning och läser
-- dem i varje lista.
-- Befintliga objekt i produktionen som ersätts: policyn case_attachments_select (0024) – samma villkor som förut plus
-- kind = 'order' för kommunens handläggare och för den egna uppladdningen utan ärende. Tabellen case_attachments får två
-- kolumner och tre kontroller; befintliga rader ändras inte (kind blir 'order' via standardvärdet, category null). Inget raderas.
--
-- Lås: alter table tar ett starkt lås på case_attachments (liten tabell, läses av deltagarkortet och avropsinkorgen). Väntar en
-- sats längre än 5 sekunder på ett lås avbryts körningen (felkod 55P03) i stället för att andra frågor köar bakom den – kör då
-- filen igen. Inställningen gäller bara den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- 1–2. Slag och typ
alter table public.case_attachments add column if not exists kind text not null default 'order';
alter table public.case_attachments add column if not exists category text;

alter table public.case_attachments drop constraint if exists case_attachments_kind_check;
alter table public.case_attachments add constraint case_attachments_kind_check check (kind in ('order', 'participant'));
alter table public.case_attachments drop constraint if exists case_attachments_category_check;
alter table public.case_attachments add constraint case_attachments_category_check
  check (category is null or category in ('cv', 'personligt_brev', 'betyg_intyg', 'ovrigt'));
-- En deltagarfil har alltid en typ och ett ärende; en bilaga till beställningen har aldrig en typ.
alter table public.case_attachments drop constraint if exists case_attachments_participant_shape;
alter table public.case_attachments add constraint case_attachments_participant_shape
  check ((kind = 'participant') = (category is not null) and (kind = 'order' or case_id is not null));

comment on column public.case_attachments.kind is 'order = bilaga till beställningen (kommunen och Miljonbemanning), participant = fil på deltagarkortet, bara Miljonbemanning (Karims beslut 2026-10-29, 0037).';
comment on column public.case_attachments.category is 'Deltagarfilens typ: cv, personligt_brev, betyg_intyg eller ovrigt. Null för beställningens bilagor (0037).';

-- ---------------------------------------------------------------- 3. Läsning
-- policy.ts case_attachments.read. write: never (ingen insert-, update- eller delete-policy).
drop policy if exists case_attachments_select on public.case_attachments;
create policy case_attachments_select on public.case_attachments for select to authenticated using (
  deleted_at is null and (
    (case_id is null
      and kind = 'order'
      and (select mm.current_role()) is distinct from 'deltagare'
      and uploaded_by = (select mm.current_profile_id()))
    or (case_id is not null and (
      ((select mm.role_in(array['samordnare', 'avtalsansvarig', 'coach'])) and case_id in (select mm.case_ids('{full}')))
      or (kind = 'order'
          and (select mm.current_role()) = 'kommun_handlaggare'
          and case_id in (select mm.case_ids('{customer}'))
          and mm.case_referrer_id(case_id) = (select mm.current_profile_id()))
    ))
  )
);

reset lock_timeout;
reset statement_timeout;
