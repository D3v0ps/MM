-- 0011 Härdning enligt Supabases säkerhets- och prestandarådgivare.
--
-- 1. Fast search_path på funktionerna som saknade det (rådgivarens "function_search_path_mutable"). Utan fast
--    search_path avgör den som anropar vilka scheman som söks först, och en funktion kan då lösa upp ett namn till
--    ett objekt som någon annan lagt dit. Samma inställning som övriga funktioner i mm: public, mm (pg_catalog söks
--    alltid först). Funktionerna använder redan fullt kvalificerade namn (mm.unit_covers, mm.supplier_roles …), så
--    beteendet ändras inte. Notera: en sql-funktion med set-klausul kan inte bäddas in (inlinas) av planeraren –
--    det kostar lite per anrop men är försumbart i pilotens volym.
alter function mm.supplier_roles() set search_path = public, mm;
alter function mm.customer_roles() set search_path = public, mm;
alter function mm.all_roles() set search_path = public, mm;
alter function mm.member_in(text, text, text[]) set search_path = public, mm;
alter function mm.customer_safe_config(jsonb) set search_path = public, mm;
alter function mm.unit_covers(text, text) set search_path = public, mm;
alter function mm.customer_scope(jsonb) set search_path = public, mm;
alter function mm.case_access_level(text, text, text[], text, text, text, text, boolean, boolean, text, text) set search_path = public, mm;
alter function mm.can_see_notes(text, text) set search_path = public, mm;
alter function mm.can_see_person(text) set search_path = public, mm;

-- 2. Index på främmande nycklar som saknade index (rådgivarens "unindexed_foreign_keys"). Snabbar upp uppslag per
--    ärende och gör att en borttagning i den refererade tabellen inte behöver läsa hela tabellen.
create index billing_week_approvals_case_id_idx on public.billing_week_approvals (case_id);
create index case_seen_case_id_idx on public.case_seen (case_id);
create index invoice_credits_case_id_idx on public.invoice_credits (case_id);
create index invoice_lines_case_id_idx on public.invoice_lines (case_id);
create index org_settings_organization_id_idx on public.org_settings (organization_id);
create index profiles_buyer_reference_id_idx on public.profiles (buyer_reference_id);
