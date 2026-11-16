-- Delmål för progressionerna i Botkyrkaavtalet (Karims beslut 2026-11-11, SPEC §7.7 och §7.17).
--
-- KÖRS EN GÅNG FÖR HAND i produktionen efter Karims ja – aldrig automatiskt. Ingen migration: filen lägger in data i ett befintligt
-- avtal (katalogen med delmål och avtalskonfigurationens tröskel för punkterna i steg 1–2), inte schemat.
--
-- Ordning (docs/DRIFT.md, "Delmål – migration 0043 och startlistan"):
--   1. Migration 0043 (supabase/migrations/0043_delmal.sql) är applicerad.
--   2. Koden med delmålen är driftsatt.
--   3. Den här filen.
--
-- Vad filen gör, i en transaktion:
--   - Lägger in startlistan (25 delmål, godkänd av Karim 2026-11-11) i avtalet med avtalsnummer 332026110. Samma lista, nummer och
--     id (pg-<avtalets id>-01 … 25) som DEFAULT_PROGRESS_GOALS i src/core/progress-goals.ts. Ett delmål som redan finns (samma id)
--     rörs inte – inte heller om avtalsansvarig har bytt namn på det eller inaktiverat det i appen.
--   - Sätter bonus.stepItemMin i avtalskonfigurationen till { "ansokningshandlingar": 2 } (samma som BOTKYRKA_CONFIG): förbättrade
--     ansökningshandlingar kräver två uppnådda delmål, övriga punkter ett. Bara om bonusavsnittet finns och värdet skiljer sig.
--   - Skriver en rad i revisionsloggen för startlistan och en för konfigurationen – bara id:n, antal och nycklar, inga namn.
--     Loggradens id har körningens tid, så att varje verklig ändring loggas.
-- Filen tål att köras igen: en andra körning ändrar ingenting och skriver inga nya rader i revisionsloggen. Bonusfilen
-- (2026-11-bonus-botkyrka.sql) kan köras före eller efter den här – den rör inte tröskeln.
--
-- Kontroll efteråt:
--   select area_key, sort_order, label, step_items from public.progress_goals
--    where contract_id = (select id from public.contracts where contract_number = '332026110') order by area_key, sort_order;  -- 25 rader
--   select config->'bonus'->'stepItemMin' from public.contracts where contract_number = '332026110';                     -- {"ansokningshandlingar": 2}

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.case_progress_goals') is null then
    raise exception 'Migration 0043 (delmål) är inte applicerad – kör den först.';
  end if;
  if (select count(*) from public.contracts where contract_number = '332026110') <> 1 then
    raise exception 'Hittar inte exakt ett avtal med avtalsnummer 332026110.';
  end if;
end
$$;

-- Startlistan: nummer, område, ordning inom området, namn och punkterna i steg 1–2.
with c as (
  select id from public.contracts where contract_number = '332026110'
), goals(n, area_key, sort_order, label, step_items) as (
  values
    (1, 'narvaro_rutiner', 10, 'Kommer i tid tre veckor i rad', '{}'::text[]),
    (2, 'narvaro_rutiner', 20, 'Meddelar frånvaro innan tillfället', '{}'::text[]),
    (3, 'narvaro_rutiner', 30, 'Håller en egen veckoplan', '{individuell_plan}'::text[]),
    (4, 'yrkesfardigheter', 10, 'Genomfört branschintroduktion', '{branschintroduktion}'::text[]),
    (5, 'yrkesfardigheter', 20, 'Utför en arbetsuppgift självständigt i yrkesmoment', '{}'::text[]),
    (6, 'yrkesfardigheter', 30, 'Klarat ett branschintyg eller en validering', '{branschintyg,validering}'::text[]),
    (7, 'arbetskapacitet', 10, 'Klarar ett helt tillfälle utan avbrott', '{}'::text[]),
    (8, 'arbetskapacitet', 20, 'Klarar tre tillfällen i veckan', '{}'::text[]),
    (9, 'sjalvstandighet', 10, 'Bokar och håller egna möten', '{}'::text[]),
    (10, 'sjalvstandighet', 20, 'Följer sin individuella plan', '{individuell_plan}'::text[]),
    (11, 'digital_sjalvstandighet', 10, 'Kan starta och logga in på en dator', '{}'::text[]),
    (12, 'digital_sjalvstandighet', 20, 'Loggar in på sin e-post via dator', '{}'::text[]),
    (13, 'digital_sjalvstandighet', 30, 'Söker jobb via datorn (Platsbanken eller annan sajt)', '{ansokningshandlingar}'::text[]),
    (14, 'digital_sjalvstandighet', 40, 'Skickar en ansökan med bifogat CV', '{ansokningshandlingar}'::text[]),
    (15, 'instruktioner', 10, 'Följer en muntlig instruktion i flera steg', '{}'::text[]),
    (16, 'instruktioner', 20, 'Följer en skriftlig arbetsinstruktion', '{}'::text[]),
    (17, 'arbetsgivarkontakter', 10, 'Deltagit i en arbetsgivarnära aktivitet', '{arbetsgivarnara}'::text[]),
    (18, 'arbetsgivarkontakter', 20, 'Tagit egen kontakt med en arbetsgivare', '{}'::text[]),
    (19, 'arbetsgivarkontakter', 30, 'Genomfört en arbetsintervju', '{arbetsintervju}'::text[]),
    (20, 'beredskap', 10, 'Har ett uppdaterat CV', '{ansokningshandlingar}'::text[]),
    (21, 'beredskap', 20, 'Har ett personligt brev', '{ansokningshandlingar}'::text[]),
    (22, 'beredskap', 30, 'Påbörjat praktik eller arbetsträning', '{praktik}'::text[]),
    (23, 'beredskap', 40, 'Antagen till utbildningsförberedande aktivitet eller jobbspår', '{jobbspar,utbildning}'::text[]),
    (24, 'sprak_kommunikation', 10, 'Presenterar sig själv för en arbetsgivare', '{}'::text[]),
    (25, 'sprak_kommunikation', 20, 'Skriver ett kort mejl på svenska', '{}'::text[])
), ins as (
  insert into public.progress_goals (id, contract_id, area_key, label, sort_order, active, step_items, created_by, created_at, updated_by, updated_at)
  select 'pg-' || c.id || '-' || lpad(g.n::text, 2, '0'), c.id, g.area_key, g.label, g.sort_order, true, g.step_items, 'system', now(), null, null
    from c cross join goals g
   where not exists (select 1 from public.progress_goals p where p.id = 'pg-' || c.id || '-' || lpad(g.n::text, 2, '0'))
  returning id, contract_id
)
insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details)
select 'log-delmal-2026-11-11-' || ins.contract_id || '-' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISSUS'), now(), 'system',
       'progress_goal.catalog_seeded', 'contract', ins.contract_id, ins.contract_id,
       jsonb_build_object('count', count(*), 'decision', '2026-11-11')
  from ins
 group by ins.contract_id
on conflict (id) do nothing;

-- Avtalskonfigurationen: tröskeln för punkterna i steg 1–2 (förbättrade ansökningshandlingar kräver två delmål).
with upd as (
  update public.contracts k
     set config = jsonb_set(k.config, '{bonus,stepItemMin}', '{"ansokningshandlingar": 2}'::jsonb, true)
   where k.contract_number = '332026110'
     and k.config ? 'bonus'
     and k.config->'bonus'->'stepItemMin' is distinct from '{"ansokningshandlingar": 2}'::jsonb
  returning k.id
)
insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details)
select 'log-delmal-2026-11-11-config-' || upd.id || '-' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISSUS'), now(), 'system',
       'contract.config_updated', 'contract', upd.id, upd.id,
       jsonb_build_object('section', 'bonus.stepItemMin', 'items', 1, 'decision', '2026-11-11')
  from upd
on conflict (id) do nothing;

commit;
