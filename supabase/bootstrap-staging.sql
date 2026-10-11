-- Startdata för testmiljön (staging): bara påhittade uppgifter och testarna (Karim, Ali, Sara, Adam, Shafik, Moda, Yacine).
-- GENERERAD av scripts/db/generate-bootstrap.ts (npx tsx scripts/db/generate-bootstrap.ts) – ändra inte för hand.
-- Kör efter migrationerna 0001–0017. Idempotent. Kör ALDRIG mot produktion (spärren nedan stoppar det).
-- Sedan: testaren loggar in och väljer "Läs in testdata på nytt" i adminvyn (resten av testdatat).

set timezone to 'Europe/Stockholm';
begin;

-- Spärr: bara en testmiljö (environment = staging) eller en tom databas utan inställningen.
do $$
begin
  if exists (select 1 from public.app_settings where key = 'environment' and value <> 'staging')
     or (not exists (select 1 from public.app_settings where key = 'environment') and exists (select 1 from public.cases)) then
    raise exception 'bootstrap-staging.sql får bara köras i testmiljön (app_settings.environment = staging) eller i en tom databas';
  end if;
end
$$;

-- holidays (32)
insert into public.holidays (id, date, name) values
  ('2026-01-01', '2026-01-01', 'Nyårsdagen'),
  ('2026-01-06', '2026-01-06', 'Trettondedag jul'),
  ('2026-04-03', '2026-04-03', 'Långfredagen'),
  ('2026-04-05', '2026-04-05', 'Påskdagen'),
  ('2026-04-06', '2026-04-06', 'Annandag påsk'),
  ('2026-05-01', '2026-05-01', 'Första maj'),
  ('2026-05-14', '2026-05-14', 'Kristi himmelsfärdsdag'),
  ('2026-05-24', '2026-05-24', 'Pingstdagen'),
  ('2026-06-06', '2026-06-06', 'Sveriges nationaldag'),
  ('2026-06-19', '2026-06-19', 'Midsommarafton'),
  ('2026-06-20', '2026-06-20', 'Midsommardagen'),
  ('2026-10-31', '2026-10-31', 'Alla helgons dag'),
  ('2026-12-24', '2026-12-24', 'Julafton'),
  ('2026-12-25', '2026-12-25', 'Juldagen'),
  ('2026-12-26', '2026-12-26', 'Annandag jul'),
  ('2026-12-31', '2026-12-31', 'Nyårsafton'),
  ('2027-01-01', '2027-01-01', 'Nyårsdagen'),
  ('2027-01-06', '2027-01-06', 'Trettondedag jul'),
  ('2027-03-26', '2027-03-26', 'Långfredagen'),
  ('2027-03-28', '2027-03-28', 'Påskdagen'),
  ('2027-03-29', '2027-03-29', 'Annandag påsk'),
  ('2027-05-01', '2027-05-01', 'Första maj'),
  ('2027-05-06', '2027-05-06', 'Kristi himmelsfärdsdag'),
  ('2027-05-16', '2027-05-16', 'Pingstdagen'),
  ('2027-06-06', '2027-06-06', 'Sveriges nationaldag'),
  ('2027-06-25', '2027-06-25', 'Midsommarafton'),
  ('2027-06-26', '2027-06-26', 'Midsommardagen'),
  ('2027-11-06', '2027-11-06', 'Alla helgons dag'),
  ('2027-12-24', '2027-12-24', 'Julafton'),
  ('2027-12-25', '2027-12-25', 'Juldagen'),
  ('2027-12-26', '2027-12-26', 'Annandag jul'),
  ('2027-12-31', '2027-12-31', 'Nyårsafton')
on conflict (id) do update set date = excluded.date, name = excluded.name;

-- organizations (2)
insert into public.organizations (id, name, org_nr, kind, email_domains) values
  ('org-mb', 'Miljonbemanning AB', '556959-9318', 'supplier', '{}'::text[]),
  ('org-botkyrka', 'Botkyrka kommun', '212000-2882', 'customer', array['botkyrka.se']::text[])
on conflict (id) do update set name = excluded.name, org_nr = excluded.org_nr, kind = excluded.kind, email_domains = excluded.email_domains;

-- contracts (1)
insert into public.contracts (id, supplier_id, customer_id, name, contract_number, dnr, starts_on, ends_on, case_prefix, data_role, config, status, contract_manager_id) values
  ('c-bot', 'org-mb', 'org-botkyrka', 'Yrkesförberedande och yrkesinriktade insatser', '332026110', 'AVN/2026:00048', '2026-09-10', '2030-09-10', 'BOT', 'processor', '{"casePrefix":"BOT","dataRole":"processor","thirdCountryProcessing":"forbidden_without_written_approval","orderChannels":["email","portal","phone"],"orderPeriods":{"months":[6,12],"allowOther":true},"selfRegistration":{"emailDomains":["botkyrka.se"]},"customerVisibility":{"scope":"ATT_FASTSTÄLLA (own | unit | all)","prototypeScope":"own","seesIndividualReports":true,"seesCoachNotes":false,"seesSlaStats":false,"seesParticipantVoiceNotes":false},"reportDelivery":{"channel":"portal","emailAttachmentAllowed":false},"phases":[{"no":1,"name":"Kartläggning"},{"no":2,"name":"Yrkesförberedande grund"},{"no":3,"name":"Yrkesspecifika moment"},{"no":4,"name":"Praktik/APL"},{"no":5,"name":"Matchning och slutrapport"}],"stuckRules":[{"phase":1,"maxDays":10},{"phase":3,"maxDays":35,"unlessPlacementPlanned":true}],"progression":{"scale":{"0":"Ingen / för tidigt att bedöma","1":"Liten","2":"Tydlig","3":"Uppnått delmål"},"areas":["narvaro_rutiner","yrkesfardigheter","arbetskapacitet","sjalvstandighet","digital_sjalvstandighet","instruktioner","arbetsgivarkontakter","beredskap","sprak_kommunikation","ovrigt"],"optionalAreas":["halsa_funktionellt","livskvalitet_sjalvskattad"],"areaLabels":{"narvaro_rutiner":"Närvaro, punktlighet och rutiner","yrkesfardigheter":"Yrkesfärdigheter/praktisk förmåga","arbetskapacitet":"Arbetskapacitet och uthållighet","sjalvstandighet":"Självständighet och ansvarstagande","digital_sjalvstandighet":"Digital självständighet","instruktioner":"Förmåga att förstå och följa yrkesrelaterade instruktioner","arbetsgivarkontakter":"Arbetsgivarkontakter/nätverk","beredskap":"Beredskap för praktik, arbete eller studier","sprak_kommunikation":"Språk och kommunikation","ovrigt":"Övrig relevant progression","halsa_funktionellt":"Hälsa (funktionellt beskrivet)","livskvalitet_sjalvskattad":"Livskvalitet (deltagarens egen skattning)"},"observationRequiredFromLevel":1,"clearFromLevel":2,"anyFromLevel":1},"result":{"definition":"ATT_FASTSTÄLLA","prototypeDefinition":"Preliminärt i prototypen: avslut till arbete eller studier som är verifierade räknas som resultat. Avbrott på grund av flytt eller kommunens beslut räknas inte i nämnaren.","countsAsResult":["arbete","studier"],"excludedFromDenominator":"ATT_FASTSTÄLLA","prototypeExcluded":["avbrott_flytt","avbrott_kommunens_beslut"],"requiresVerification":true},"kpis":[{"key":"resultatgrad","label":"Resultatgrad (arbete eller studier)","windows":["rolling_6m","since_start"],"contractTarget":0.32,"internalTarget":0.35,"minN":10,"notify":{"belowInternal":["chef","controller"],"belowContract":["chef","controller","avtalsansvarig"]}},{"key":"avrop_besvarade_i_tid","label":"Avrop besvarade inom en arbetsdag","windows":["month"],"internalTarget":1},{"key":"forsta_mote_inom_en_vecka","label":"Första möte inom en vecka","windows":["month"],"internalTarget":1},{"key":"veckorapporter_i_tid","label":"Veckorapporter i tid","windows":["month"],"internalTarget":1},{"key":"manadsrapporter_i_tid","label":"Månadsrapporter i tid","windows":["month"],"internalTarget":1},{"key":"narvarograd","label":"Närvarograd","windows":["month"],"internalTarget":"ATT_FASTSTÄLLA"},{"key":"nojdhet","label":"Nöjdhet (andel 4–5)","windows":["rolling_3m"],"internalTarget":"ATT_FASTSTÄLLA"}],"sla":[{"key":"ordererkannande","label":"Ordererkännande","from":"avrop_mottaget","within":{"minutes":5},"automatic":true},{"key":"avrop_svar","label":"Svar på avrop","from":"avrop_mottaget","within":{"workingDays":1}},{"key":"forsta_mote","label":"Första möte","from":"avrop_mottaget","within":{"days":7}},{"key":"veckorapport_registrering","label":"Närvaro registrerad","due":"måndag 10:00 för föregående vecka","weekday":0,"time":"10:00"},{"key":"veckorapport_publicering","label":"Veckorapport publicerad","due":"måndag 16:00 för föregående vecka","weekday":0,"time":"16:00"},{"key":"manadsrapport","label":"Månadsrapport","due":"ATT_FASTSTÄLLA (förslag: 5:e arbetsdagen efter månadsskiftet)","proposal":{"nthWorkingDay":5}},{"key":"slutrapport","label":"Slutrapport","from":"avslutsdatum","within":"ATT_FASTSTÄLLA (förslag: 5 arbetsdagar)","proposal":{"workingDays":5}}],"attendance":{"sameDayNoticeOnInvalidAbsence":"ATT_FASTSTÄLLA","repeatedAbsenceRule":{"absentInvalid":2,"withinDays":14}},"activities":{"defaultWeekPlan":[{"weekday":"first_meeting","kind":"möte","durationMin":60,"location":"Miljonbemanning"},{"weekday":1,"kind":"yrkesmoment","time":"09:00","durationMin":180,"location":"Miljonbemanning"},{"weekday":3,"kind":"yrkesmoment","time":"09:00","durationMin":180,"location":"Miljonbemanning"}]},"billing":{"unit":"participant_week","billableWeekRule":"every_iso_week_with_at_least_one_enrolled_day_excluding_paused_weeks","flagZeroAttendanceWeeks":true,"weekToMonthRule":"iso_thursday","invoicePer":"contract_and_month","collectiveInvoiceAllowed":true,"buyerReference":{"required":true,"pattern":"^[0-9]{8,10}$"},"purchaseOrderNumber":{"required":false,"pattern":"^99[0-9]{7}$"},"invoicedObject":"case_number","showAccruedAndRemaining":true,"separatePeriodicFromOther":true,"paymentTermsDays":30,"unbilledWarningDays":45,"format":"peppol_bis_3_via_fortnox","fallback":["export_xlsx_pdf","botkyrka_fakturaportal"]},"bonus":{"enabled":false,"model":"ATT_FASTSTÄLLA enligt incitamentsmodellen","separateInvoice":true},"pulse":{"occasions":["week2","exit"],"periodicEveryDays":30,"languages":["sv","en","ar","so"],"minNForAggregate":5},"statistics":{"onRequestMaxPerYear":2,"free":true},"termination":{"returnDataWithinDays":31,"deleteAfterReturn":true},"retention":"ATT_FASTSTÄLLA enligt PUB-avtalet","escalationLadder":[{"step":0,"level":"mindre","text":"Mindre avvikelse – påverkar inte kärnverksamheten och kan åtgärdas enkelt och snabbt."},{"step":1,"level":"större","text":"Större avvikelse – flera återkommande mindre avvikelser eller en avvikelse som kännbart påverkar kärnverksamheten. Skriftlig varning kan ges."},{"step":2,"level":"allvarlig","text":"Allvarlig avvikelse – flera återkommande större avvikelser eller avbrott i kärnverksamheten. Skriftlig varning kan ges."},{"step":3,"level":"allvarlig","text":"Upprepade allvarliga avvikelser. Skriftlig varning kan ges. Tre varningar kan leda till uppsägning."},{"step":4,"level":"hävning","text":"Risk för hävning av avtalet."}],"warningsBeforeTermination":3,"penalties":{"deviationOre":2500000,"insufficientInformationOre":2500000},"economicDeviation":"Kostnader avviker från anbud, timmar stämmer inte med utfört uppdrag, fel pris eller fel/saknad information på fakturan.","keyPersonnelChangeRequiresApproval":true,"ai":{"provider":"vertex_eu","recordingApprovedByCustomer":"2026-09-29","recording":{"coach":true,"customer":true,"participant":true,"approvedByCustomerOn":"2026-09-30"},"maxMinutes":{"coach":60,"customer":5,"participant":5},"languages":["sv","en","ar","so"],"participantLinkValidDays":7},"texts":{"scope":"Minst 70 och upp till 100 årsplatser i tolv avtalsområden (A–L). Miljonbemanning är rangordnad 1 i alla områden.","termination":"Uppsägning utan skäl tidigast två år efter start. Tre månaders uppsägningstid."},"reportSchedule":{"automatic":["weekly_attendance","monthly","customer_summary"],"monthly":{"minEnrolledDays":11},"customerSummaryDue":{"nthWorkingDay":8,"time":"16:00"}}}'::jsonb, 'active', 'u-johan')
on conflict (id) do update set supplier_id = excluded.supplier_id, customer_id = excluded.customer_id, name = excluded.name, contract_number = excluded.contract_number, dnr = excluded.dnr, starts_on = excluded.starts_on, ends_on = excluded.ends_on, case_prefix = excluded.case_prefix, data_role = excluded.data_role, config = excluded.config, status = excluded.status, contract_manager_id = excluded.contract_manager_id;

-- contract_areas (12)
insert into public.contract_areas (id, contract_id, code, name, active) values
  ('c-bot:A', 'c-bot', 'A', 'Administration', true),
  ('c-bot:B', 'c-bot', 'B', 'Hälsa och sjukvård', true),
  ('c-bot:C', 'c-bot', 'C', 'Bygg och anläggning', true),
  ('c-bot:D', 'c-bot', 'D', 'Kök, restaurang och måltidsservice', true),
  ('c-bot:E', 'c-bot', 'E', 'Transport och åkeri', true),
  ('c-bot:F', 'c-bot', 'F', 'Lokalvård', true),
  ('c-bot:G', 'c-bot', 'G', 'Lager och logistik', true),
  ('c-bot:H', 'c-bot', 'H', 'Serviceyrken', true),
  ('c-bot:I', 'c-bot', 'I', 'Fastighet, mark och park', true),
  ('c-bot:J', 'c-bot', 'J', 'Parti- och detaljhandel', true),
  ('c-bot:K', 'c-bot', 'K', 'Industri', true),
  ('c-bot:L', 'c-bot', 'L', 'Övrigt', true)
on conflict (id) do update set contract_id = excluded.contract_id, code = excluded.code, name = excluded.name, active = excluded.active;

-- price_items (12)
insert into public.price_items (id, contract_id, area_code, code, unit, package_months, price_ore, vat_rate, valid_from, valid_to, fortnox_article_no, example_only) values
  ('pi-A', 'c-bot', 'A', 'vecka-A', 'participant_week', null, 152300, 25, '2026-09-10', '2027-09-09', 'BOT-A', true),
  ('pi-B', 'c-bot', 'B', 'vecka-B', 'participant_week', null, 166800, 25, '2026-09-10', '2027-09-09', 'BOT-B', true),
  ('pi-C', 'c-bot', 'C', 'vecka-C', 'participant_week', null, 159800, 25, '2026-09-10', '2027-09-09', 'BOT-C', true),
  ('pi-D', 'c-bot', 'D', 'vecka-D', 'participant_week', null, 144500, 25, '2026-09-10', '2027-09-09', 'BOT-D', true),
  ('pi-E', 'c-bot', 'E', 'vecka-E', 'participant_week', null, 156200, 25, '2026-09-10', '2027-09-09', 'BOT-E', true),
  ('pi-F', 'c-bot', 'F', 'vecka-F', 'participant_week', null, 132300, 25, '2026-09-10', '2027-09-09', 'BOT-F', true),
  ('pi-G', 'c-bot', 'G', 'vecka-G', 'participant_week', null, 139800, 25, '2026-09-10', '2027-09-09', 'BOT-G', true),
  ('pi-H', 'c-bot', 'H', 'vecka-H', 'participant_week', null, 141200, 25, '2026-09-10', '2027-09-09', 'BOT-H', true),
  ('pi-I', 'c-bot', 'I', 'vecka-I', 'participant_week', null, 147600, 25, '2026-09-10', '2027-09-09', 'BOT-I', true),
  ('pi-J', 'c-bot', 'J', 'vecka-J', 'participant_week', null, 138900, 25, '2026-09-10', '2027-09-09', 'BOT-J', true),
  ('pi-K', 'c-bot', 'K', 'vecka-K', 'participant_week', null, 153400, 25, '2026-09-10', '2027-09-09', 'BOT-K', true),
  ('pi-L', 'c-bot', 'L', 'vecka-L', 'participant_week', null, 145000, 25, '2026-09-10', '2027-09-09', 'BOT-L', true)
on conflict (id) do update set contract_id = excluded.contract_id, area_code = excluded.area_code, code = excluded.code, unit = excluded.unit, package_months = excluded.package_months, price_ore = excluded.price_ore, vat_rate = excluded.vat_rate, valid_from = excluded.valid_from, valid_to = excluded.valid_to, fortnox_article_no = excluded.fortnox_article_no, example_only = excluded.example_only;

-- groupings: standardvärdena (8)
insert into public.groupings (id, contract_id, kind, category, name, description, sort_order, created_at, created_by, updated_at, updated_by, archived_at, archived_by) values
  ('grp-c-bot-niva-1', 'c-bot', 'level', null, 'Nivå 1 – Långt från arbete', '', 1, '2026-09-01T08:00', null, null, null, null, null),
  ('grp-c-bot-niva-2', 'c-bot', 'level', null, 'Nivå 2 – Behöver stöd för att komma igång', '', 2, '2026-09-01T08:00', null, null, null, null, null),
  ('grp-c-bot-niva-3', 'c-bot', 'level', null, 'Nivå 3 – På väg', '', 3, '2026-09-01T08:00', null, null, null, null, null),
  ('grp-c-bot-niva-4', 'c-bot', 'level', null, 'Nivå 4 – Nära arbete', '', 4, '2026-09-01T08:00', null, null, null, null, null),
  ('grp-c-bot-niva-5', 'c-bot', 'level', null, 'Nivå 5 – Redo för arbete', '', 5, '2026-09-01T08:00', null, null, null, null, null),
  ('grp-c-bot-vill-arbeta-heltid', 'c-bot', 'tag', 'Vill arbeta', 'Heltid', '', 1, '2026-09-01T08:00', null, null, null, null, null),
  ('grp-c-bot-vill-arbeta-deltid', 'c-bot', 'tag', 'Vill arbeta', 'Deltid', '', 2, '2026-09-01T08:00', null, null, null, null, null),
  ('grp-c-bot-vill-arbeta-vet-inte-an', 'c-bot', 'tag', 'Vill arbeta', 'Vet inte än', '', 3, '2026-09-01T08:00', null, null, null, null, null)
on conflict (id) do nothing;

-- Testarna (7): admin i båda avtalen, is_tester. Inloggningskopplingen (auth_user_id) och senaste inloggning behålls.
insert into public.profiles (id, organization_id, full_name, email, phone, title, active, last_login_at, customer_unit, buyer_reference_id, team_role, invited_at, invited_by, auth_user_id, is_tester) values
  ('tester-karim', 'org-mb', 'Karim Khalil', 'karim.khalil@miljonbemanning.se', '', 'Systemadministratör', true, null, null, null, null, null, null, null, true),
  ('tester-ali', 'org-mb', 'Ali Khalil', 'ali.khalil@miljonbemanning.se', '', 'Systemadministratör', true, null, null, null, null, null, null, null, true),
  ('tester-sara', 'org-mb', 'Sara Salah', 'sara.salah@miljonbemanning.se', '', 'Systemadministratör', true, null, null, null, null, null, null, null, true),
  ('tester-adam', 'org-mb', 'Adam Abdalla', 'adam.abdalla@miljonbemanning.se', '', 'Systemadministratör', true, null, null, null, null, null, null, null, true),
  ('tester-shafik', 'org-mb', 'Shafik Muwanga', 'shafik.muwanga@miljonbemanning.se', '', 'Systemadministratör', true, null, null, null, null, null, null, null, true),
  ('tester-moda', 'org-mb', 'Moda Habib', 'moda.habib@miljonbemanning.se', '', 'Systemadministratör', true, null, null, null, null, null, null, null, true),
  ('tester-yacine', 'org-mb', 'Yacine Laghmari', 'yacine.laghmari@miljonbemanning.se', '', 'Systemadministratör', true, null, null, null, null, null, null, null, true)
on conflict (id) do update set organization_id = excluded.organization_id, full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, title = excluded.title, active = excluded.active, customer_unit = excluded.customer_unit, buyer_reference_id = excluded.buyer_reference_id, team_role = excluded.team_role, invited_at = excluded.invited_at, invited_by = excluded.invited_by, is_tester = excluded.is_tester;
insert into public.memberships (id, user_id, contract_id, role, customer_unit) values
  ('tester-karim:c-bot', 'tester-karim', 'c-bot', 'admin', null),
  ('tester-ali:c-bot', 'tester-ali', 'c-bot', 'admin', null),
  ('tester-sara:c-bot', 'tester-sara', 'c-bot', 'admin', null),
  ('tester-adam:c-bot', 'tester-adam', 'c-bot', 'admin', null),
  ('tester-shafik:c-bot', 'tester-shafik', 'c-bot', 'admin', null),
  ('tester-moda:c-bot', 'tester-moda', 'c-bot', 'admin', null),
  ('tester-yacine:c-bot', 'tester-yacine', 'c-bot', 'admin', null),
  ('tester-ali:c-bot:avtalsansvarig', 'tester-ali', 'c-bot', 'avtalsansvarig', null)
on conflict (id) do update set user_id = excluded.user_id, contract_id = excluded.contract_id, role = excluded.role, customer_unit = excluded.customer_unit;

-- Testmiljön och testklockan. Klockan sätts bara om den saknas – "Läs in testdata på nytt" startar om den på testtiden.
insert into public.app_settings (key, value) values ('environment', 'staging')
on conflict (key) do update set value = excluded.value;
insert into public.app_settings (key, value) values
  ('clock_demo_epoch', '2027-02-01T09:12'),
  ('clock_real_epoch', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
on conflict (key) do nothing;

-- Testarna behåller sin inloggning: koppla profilen till kontot i auth.users via e-postadressen (om kontot finns).
update public.profiles p set auth_user_id = u.id
from auth.users u
where p.is_tester and p.auth_user_id is null and lower(u.email) = p.email;

commit;
