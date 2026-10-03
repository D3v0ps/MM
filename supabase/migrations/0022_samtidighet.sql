-- 0022 Samtidighet (granskning av D2, beslut 2026-10-03): radversion på utkasten och en närvarorad per tillfälle.
--
-- 1. version på check_ins, monthly_assessments och intake_assessments. Samma utkast kan vara öppet i två flikar (eller på
--    två enheter); med automatisk utkastsparning räcker en tangenttryckning i den gamla fliken för att skriva över den nya
--    flikens innehåll utan att någon märker det. Hanterarna (coach.checkinSave, coach.assessmentSave, coach.intakeSave)
--    skickar därför expectedVersion, uppdaterar bara när versionen stämmer (update … where id = ? and version = ?) och ökar
--    den med ett – annars svarar de "conflict" och skärmen stoppar autosparningen ("ändrats i en annan flik – ladda om").
--    Befintliga rader får version 1 (testdatat också, src/data/seed/map.ts). Ingen trigger: hanteraren sätter värdet, som
--    med alla andra tider och tal (ctx.now()), så att minnesläget och databasen beter sig lika.
-- 2. En närvarorad per tillfälle. attendanceSet läser raden (first) och skriver sedan – två samtidiga registreringar av
--    samma tillfälle (dubbelklick, eller "Markera alla som närvarande" samtidigt med en radknapp) gav två rader, och en
--    senare rättning uppdaterade den ena medan vyn, veckorapporten och fakturaunderlaget läste den andra. Den unika
--    nyckeln stoppar den andra raden (felkod 23505 = UniqueError i src/data/repo.ts); hanteraren läser då om raden och
--    uppdaterar den i stället (writeAttendance i src/features/coach/handlers.ts). Minnesläget gör samma kontroll
--    (UNIQUE_KEYS i src/data/schema.ts). Nyckeln ersätter indexet attendance_activity_id_idx från 0005 (den är också index
--    för den främmande nyckeln).
-- Kontroll före i en databas med närvaro (ska ge noll rader):
--   select activity_id, count(*) from public.attendance group by activity_id having count(*) > 1;
-- RLS: inga nya tabeller och inga nya policyer – kolumnerna ärver tabellernas regler (0005, mm.work_on(case_id)).
-- INTE applicerad i testmiljön av byggagenten (brief D2): appliceras av samordnaren vid driftsättningen.

alter table public.check_ins add column version integer not null default 1;
alter table public.monthly_assessments add column version integer not null default 1;
alter table public.intake_assessments add column version integer not null default 1;

alter table public.attendance add constraint attendance_activity_id_key unique (activity_id);
drop index if exists public.attendance_activity_id_idx;
