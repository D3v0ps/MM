-- 0021 Sparade rapporter i rapportbyggaren (rapportarbetet steg 4, SPEC §7.11 k, beslut 2026-10-01 och tillägg 2026-10-02).
--
-- Miljonbemanning (samordnare, avtalsansvarig och chef) bygger rapporter av de levererade rapporternas frysta fakta och sparar
-- definitionen. En sparad rapport ses av ägaren (private), av samordnare, avtalsansvarig och chef i avtalet (mb) eller dessutom
-- av kommunens chef (customer – bara avtalsansvarig delar med kommunen, och bara när avtalet har
-- customerVisibility.seesIndividualReports). Kommunens chef ser rapporten med sin egen behörighet (sin enhet, aldrig skyddade
-- ärenden, "färre än N") – det sköter hanterarna; tabellen innehåller inga personuppgifter.
-- Samma regler som src/data/policy.ts (saved_reports, savedReportRead och savedReportWrite):
--   * läsa (MB): rollen är samordnare, avtalsansvarig eller chef, medlem i avtalet, och raden är ens egen eller inte privat.
--     Arkiverade rader filtreras INTE här: SupabaseRepo.update läser tillbaka raden (update … select), och Postgres kräver då
--     att den nya raden klarar select-policyn – annars går det inte att arkivera. Hanterarna visar bara archived_at is null.
--   * läsa (kommunen): kommunens chef, medlem i avtalet, avtalet i mm.individual_report_contract_ids(), visibility = 'customer'
--     och inte arkiverad. Alla andra roller: inget.
--   * ny rad: byggroll, medlem, i eget namn (owner_id = mm.current_profile_id(), aldrig auth.uid()); 'customer' bara för
--     avtalsansvarig när avtalet tillåter det. Triggern: inte ändrad eller arkiverad; delad i eget namn när den inte är privat.
--   * ändring: byggroll, medlem, inte arkiverad; ägaren eller avtalsansvarig när raden inte är privat; en rad som är delad med
--     kommunen ändras bara av avtalsansvarig. Ny rad: ägaren eller avtalsansvarig när den nya raden inte är privat (avtalsansvarig
--     kan inte göra någon annans rapport privat, och raden förblir läsbar för den som ändrar); 'customer' bara för avtalsansvarig
--     när avtalet tillåter det.
--   * bara ägaren ändrar innehållet (titel och definition – tillägg 2026-10-02): avtalsansvarig som inte är ägare ändrar bara
--     delningen (visibility, shared_*) och arkiverar (archived_*). Triggern kontrollerar det.
--   * ingen raderar: ingen delete-policy och ingen delete-rättighet. Rader arkiveras.
-- Tiderna sätts av hanteraren med ctx.now() (testtid i testmiljön) – ingen default now() och ingen now() i triggern.
-- ctx.now() har minutprecision: delar och slutar samma person dela inom samma minut blir shared_at och shared_by oförändrade.
-- Triggern kräver därför bara att de är satta i eget namn när delningen ändras – inte att de skiljer sig från de gamla.

-- ---------------------------------------------------------------- Tabellen
create table public.saved_reports (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  -- Den som skapade raden (profiles.id). Ändras aldrig.
  owner_id                   text not null references public.profiles (id),
  title                      text not null check (char_length(title) between 3 and 80),
  -- Mallen rapporten började i (en nyckel i koden). Hanteraren tar bara emot nycklar som finns i TEMPLATES.
  template_key               text check (template_key is null or template_key ~ '^[a-z0-9-]{1,60}$'),
  -- Definitionen. Innehållet valideras med zod i hanteraren (ReportDefinitionSchema).
  definition                 jsonb not null check (jsonb_typeof(definition) = 'object' and definition ->> 'v' = '1'),
  visibility                 text not null check (visibility in ('private', 'mb', 'customer')),
  created_at                 timestamptz not null,
  updated_at                 timestamptz,
  updated_by                 text,
  -- Senaste ändringen av delningen (satt när raden inte är privat).
  shared_at                  timestamptz,
  shared_by                  text,
  archived_at                timestamptz,
  archived_by                text,
  constraint saved_reports_updated_pair check ((updated_at is null) = (updated_by is null)),
  constraint saved_reports_shared_pair check ((shared_at is null) = (shared_by is null)),
  constraint saved_reports_archived_pair check ((archived_at is null) = (archived_by is null)),
  constraint saved_reports_shared_when_visible check (visibility = 'private' or shared_at is not null)
);
create index saved_reports_contract_id_idx on public.saved_reports (contract_id);
create index saved_reports_owner_id_idx on public.saved_reports (owner_id);

alter table public.saved_reports enable row level security;
revoke all on public.saved_reports from anon, authenticated;
grant all on public.saved_reports to service_role;
-- Ingen delete: sparade rapporter raderas aldrig av användare – de arkiveras.
grant select, insert, update on public.saved_reports to authenticated;

-- ---------------------------------------------------------------- Policyer
-- policy.ts savedReportRead
create policy saved_reports_select on public.saved_reports for select to authenticated using (
  case
    when (select mm.role_in(array['samordnare', 'avtalsansvarig', 'chef'])) then
      mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and (owner_id = (select mm.current_profile_id()) or visibility <> 'private')
    when (select mm.current_role()) = 'kommun_chef' then
      mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
      and contract_id = any ((select mm.individual_report_contract_ids())::text[])
      and visibility = 'customer'
      and archived_at is null
    else false
  end
);
-- policy.ts savedReportWrite (ny rad). Ändrad, arkiverad och delad i eget namn kontrolleras av triggern nedan.
create policy saved_reports_insert on public.saved_reports for insert to authenticated with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'chef']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and owner_id = (select mm.current_profile_id())
  and (visibility <> 'customer'
       or ((select mm.current_role()) = 'avtalsansvarig' and contract_id = any ((select mm.individual_report_contract_ids())::text[])))
);
-- policy.ts savedReportWrite (ändring). Vilka kolumner som får ändras styr triggern nedan.
create policy saved_reports_update on public.saved_reports for update to authenticated using (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'chef']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and archived_at is null
  and (owner_id = (select mm.current_profile_id()) or ((select mm.current_role()) = 'avtalsansvarig' and visibility <> 'private'))
  and (visibility <> 'customer' or (select mm.current_role()) = 'avtalsansvarig')
) with check (
  (select mm.role_in(array['samordnare', 'avtalsansvarig', 'chef']))
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and (owner_id = (select mm.current_profile_id()) or ((select mm.current_role()) = 'avtalsansvarig' and visibility <> 'private'))
  and (visibility <> 'customer'
       or ((select mm.current_role()) = 'avtalsansvarig' and contract_id = any ((select mm.individual_report_contract_ids())::text[])))
);

-- ---------------------------------------------------------------- Kolumnskydd
-- policy.ts savedReportWrite. Gäller inloggade (authenticated, anon); service role (systemsteg) påverkas inte.
--   ny rad:   varken ändrad eller arkiverad; privat = inte delad; annars delad i eget namn
--   ändring:  något måste ändras (som policy.ts, där regeln också stoppar MemoryRepo.remove()); id, avtal, ägare och
--             skapad-tid ändras aldrig; updated_* och archived_* sätts parvis, inte till null och i eget namn när de ändras;
--             ändras visibility ska shared_at vara satt och shared_by vara den som ändrar (värdena behöver inte skilja sig
--             från de gamla – minutprecisionen); shared_* ändras bara tillsammans med visibility; den som inte är ägaren
--             ändrar bara visibility, shared_* och archived_* (tillägg 2026-10-02).
create function mm.protect_saved_report_columns() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  me text := mm.current_profile_id();
  sharing constant text[] := array['visibility', 'shared_at', 'shared_by', 'archived_at', 'archived_by'];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.updated_at is not null or new.updated_by is not null or new.archived_at is not null or new.archived_by is not null then
      raise exception 'En ny rapport kan inte vara ändrad eller arkiverad' using errcode = '42501';
    end if;
    if new.visibility = 'private' then
      if new.shared_at is not null or new.shared_by is not null then
        raise exception 'En privat rapport är inte delad' using errcode = '42501';
      end if;
    elsif new.shared_at is null or new.shared_by is distinct from me then
      raise exception 'En rapport delas i eget namn' using errcode = '42501';
    end if;
    return new;
  end if;
  if to_jsonb(new) = to_jsonb(old) then
    raise exception 'Ändringen ändrar ingenting' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.contract_id is distinct from old.contract_id or new.owner_id is distinct from old.owner_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Avtal, ägare och tid kan inte ändras' using errcode = '42501';
  end if;
  if (new.updated_at is distinct from old.updated_at or new.updated_by is distinct from old.updated_by)
     and (new.updated_at is null or new.updated_by is distinct from me) then
    raise exception 'En ändring görs i eget namn' using errcode = '42501';
  end if;
  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and (new.archived_at is null or new.archived_by is distinct from me) then
    raise exception 'En rapport arkiveras i eget namn' using errcode = '42501';
  end if;
  if new.visibility is distinct from old.visibility then
    if new.shared_at is null or new.shared_by is distinct from me then
      raise exception 'Delningen ändras i eget namn' using errcode = '42501';
    end if;
  elsif new.shared_at is distinct from old.shared_at or new.shared_by is distinct from old.shared_by then
    raise exception 'Delningen ändras bara tillsammans med vem som ser rapporten' using errcode = '42501';
  end if;
  if old.owner_id is distinct from me and (to_jsonb(new) - sharing) is distinct from (to_jsonb(old) - sharing) then
    raise exception 'Bara den som skapade rapporten kan ändra innehållet' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger saved_reports_protect_columns before insert or update on public.saved_reports
for each row execute function mm.protect_saved_report_columns();
