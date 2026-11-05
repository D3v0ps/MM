-- Incitamentsmodellen med bonussteg 1–5 i Botkyrkaavtalet (Karims beslut 2026-11-04, SPEC §7.17).
--
-- KÖRS EN GÅNG FÖR HAND i produktionen efter Karims ja – aldrig automatiskt. Ingen migration: filen ändrar data i
-- ett befintligt avtal (prislistan och avtalskonfigurationen), inte schemat.
--
-- Ordning (docs/DRIFT.md, "Bonus – incitamentsmodellen"):
--   1. Migration 0039 (supabase/migrations/0039_bonus.sql) är applicerad.
--   2. Koden med bonusstegen är driftsatt (den äldre koden känner inte enheten bonus_step i prislistan).
--   3. Den här filen.
--
-- Vad filen gör, i en transaktion:
--   - Lägger in fem prisrader för bonusstegen i avtalet med avtalsnummer 332026110 (enhet bonus_step, utan avtalsområde,
--     artikelnummer BOT-BONUS-1 … BOT-BONUS-5, moms 25 %, giltiga 2026-09-10 – 2027-09-09, inga exempelpriser). En rad som
--     redan finns (samma avtal och kod) rörs inte.
--   - Sätter avtalskonfigurationens avsnitt bonus till den fastställda modellen (samma värden som BOTKYRKA_CONFIG i
--     src/core/config.ts). Taket står i konfigurationen och tas bort ur kommunens vy (mm.customer_safe_config, 0039).
--   - Skriver en rad i revisionsloggen per ny prisrad och en för konfigurationen – bara id:n, koder och steg, inga belopp och
--     inga personuppgifter.
-- Filen tål att köras igen: en andra körning ändrar ingenting och skriver inga nya rader i revisionsloggen.
--
-- Kontroll efteråt:
--   select code, unit, price_ore, vat_rate, valid_from, valid_to, fortnox_article_no, example_only
--     from public.price_items where code like 'BOT-BONUS-%' order by code;            -- fem rader
--   select config->'bonus'->>'enabled', config->'bonus'->>'capOre' from public.contracts where contract_number = '332026110';
--   select config->'bonus' ? 'capOre' from public.contracts_public;                    -- false (kommunens vy)

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.bonus_claim_decisions') is null then
    raise exception 'Migration 0039 (bonus) är inte applicerad – kör den först.';
  end if;
  if (select count(*) from public.contracts where contract_number = '332026110') <> 1 then
    raise exception 'Hittar inte exakt ett avtal med avtalsnummer 332026110.';
  end if;
end
$$;

-- Prislistan: fem bonussteg. Beloppen i öre exkl. moms.
with c as (
  select id from public.contracts where contract_number = '332026110'
), steps(step, price_ore) as (
  values (1, 150000::bigint), (2, 300000::bigint), (3, 600000::bigint), (4, 400000::bigint), (5, 200000::bigint)
), ins as (
  insert into public.price_items (id, contract_id, area_code, code, unit, package_months, price_ore, vat_rate, valid_from, valid_to, fortnox_article_no, example_only)
  select 'pi-bonus-' || s.step || '-' || c.id, c.id, null, 'BOT-BONUS-' || s.step, 'bonus_step', null, s.price_ore, 25,
         date '2026-09-10', date '2027-09-09', 'BOT-BONUS-' || s.step, false
    from c cross join steps s
   where not exists (select 1 from public.price_items p where p.contract_id = c.id and p.code = 'BOT-BONUS-' || s.step)
  returning id, contract_id, code
)
insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details)
select 'log-bonus-2026-11-04-' || ins.id, now(), 'system', 'price_item.created', 'price_item', ins.id, ins.contract_id,
       jsonb_build_object('code', ins.code, 'unit', 'bonus_step', 'decision', '2026-11-04')
  from ins
on conflict (id) do nothing;

-- Avtalskonfigurationen: den fastställda modellen.
with model(bonus) as (
  select jsonb_build_object(
    'enabled', true,
    'model', 'Miljonbemannings incitamentsmodell med bonussteg 1–5, godtagen av Botkyrka kommun',
    'separateInvoice', true,
    'capOre', 1200000,
    'offset', 'never',
    'attendanceMinPercent', 80,
    'speedWeeks', 10,
    'sustainMonths', 3,
    'resultWindowMonthsAfterEnd', 3,
    'step2EventKinds', jsonb_build_array('praktik_startad', 'validering_uppnadd', 'yrkesbevis', 'intervju_arbetsgivarkontakt'),
    'step3EventKinds', jsonb_build_array('arbete_paborjat', 'studier_paborjade'),
    'steps', jsonb_build_array(
      jsonb_build_object('step', 1, 'label', 'Dokumenterad progression', 'priceItemCode', 'BOT-BONUS-1'),
      jsonb_build_object('step', 2, 'label', 'Stark progression', 'priceItemCode', 'BOT-BONUS-2'),
      jsonb_build_object('step', 3, 'label', 'Arbete eller studier', 'priceItemCode', 'BOT-BONUS-3'),
      jsonb_build_object('step', 4, 'label', 'Hållbart resultat', 'priceItemCode', 'BOT-BONUS-4'),
      jsonb_build_object('step', 5, 'label', 'Snabbhetspremie', 'priceItemCode', 'BOT-BONUS-5')
    )
  )
), upd as (
  update public.contracts k
     set config = jsonb_set(k.config, '{bonus}', model.bonus, true)
    from model
   where k.contract_number = '332026110'
     and k.config->'bonus' is distinct from model.bonus
  returning k.id
)
insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details)
select 'log-bonus-2026-11-04-config-' || upd.id, now(), 'system', 'contract.config_updated', 'contract', upd.id, upd.id,
       jsonb_build_object('section', 'bonus', 'enabled', true, 'steps', 5, 'decision', '2026-11-04')
  from upd
on conflict (id) do nothing;

commit;
