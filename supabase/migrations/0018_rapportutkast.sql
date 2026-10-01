-- 0018 Rapportutkast som skapas automatiskt (rapportarbetet steg 1, src/features/rapporter/ensure.ts).
--
-- Jobbet report_schedule (src/server/jobs/reports.ts, högst var tionde minut) skapar veckorapporter, månadsrapporter och
-- beställarrapporter när perioden är slut. Funktionen är idempotent, men två körningar samtidigt (cron och after()) kan
-- försöka skapa samma rad. De unika indexen nedan gör att bara den första lyckas – den andra får 23505, som hoppas över
-- utan fel. Nycklarna är samma som reportKey() i src/core/report-schedule.ts:
--   veckorapport      avtal + handläggare + ISO-vecka
--   månadsrapport     avtal + ärende + månad
--   beställarrapport  avtal + kommunens chef + månad
-- Bara den första versionen räknas (previous_id is null): en rättelse är en ny rad med samma nyckel och previous_id satt.
-- Inga nya tabeller och inga ändrade policyer – RLS är oförändrad (raderna skrivs med service role).

create unique index reports_weekly_key on public.reports (contract_id, recipient_user_id, week)
  where kind = 'weekly_attendance' and previous_id is null;
create unique index reports_monthly_key on public.reports (contract_id, case_id, month)
  where kind = 'monthly' and previous_id is null;
create unique index reports_customer_summary_key on public.reports (contract_id, recipient_user_id, month)
  where kind = 'customer_summary' and previous_id is null;

-- Raderna som körningen själv skapat (report.created i revisionsloggen) flyttar inte frontlinjen – uppslaget görs vid
-- varje körning, så det får ett eget litet index.
create index audit_log_report_created_idx on public.audit_log (contract_id, entity_id)
  where action = 'report.created';
