-- 0020 Datamigration: gränserna för tydlig och någon progression blir tal i avtalskonfigurationen (rapporter steg 2,
-- beslut 2026-10-01, SPEC §6.2).
--
-- Appen läser progression.clearFromLevel och progression.anyFromLevel (src/core/config.ts) i stället för fritexten
-- progression.statDefinition ("minst ett område på nivå >= 2"). Konfigurationen i databasen valideras inte på nytt när den
-- läses, så ett avtal som saknar talen skulle ge noll tydlig progression och texter utan siffror. Den här migrationen lägger
-- in talen i befintliga avtal, utlästa ur avtalets egen fritext – inga värden hårdkodas här (CLAUDE.md punkt 4).
--   * bara avtal som har progression men saknar något av talen
--   * bara när båda talen går att läsa ur fritexten (">= N", N = 0–3); annars lämnas avtalet orört och måste rättas i
--     adminvyn/konfigurationen innan det används
--   * fritexten lämnas kvar (schemat tillåter den, appen läser den inte)
-- Idempotent: kan köras igen utan att något ändras. Ofarlig för en äldre version av appen (den läser inte de nya fälten).
-- I testmiljön skriver "Läs in testdata på nytt" dessutom över avtalet med testdatats konfiguration (som har talen).

update public.contracts
set config = jsonb_set(
  jsonb_set(config, '{progression,clearFromLevel}', to_jsonb(substring(config #>> '{progression,statDefinition,clear}' from '>=\s*([0-3])')::int)),
  '{progression,anyFromLevel}', to_jsonb(substring(config #>> '{progression,statDefinition,any}' from '>=\s*([0-3])')::int)
)
where jsonb_typeof(config -> 'progression') = 'object'
  and not ((config -> 'progression') ? 'clearFromLevel' and (config -> 'progression') ? 'anyFromLevel')
  and substring(config #>> '{progression,statDefinition,clear}' from '>=\s*([0-3])') is not null
  and substring(config #>> '{progression,statDefinition,any}' from '>=\s*([0-3])') is not null;
