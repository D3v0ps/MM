-- 0039 Bonus: incitamentsmodellen med bonussteg 1–5 (beslut 2026-11-04 – Botkyrka har godtagit modellen, SPEC §7.17).
--
-- Fem bonussteg (1 Dokumenterad progression, 2 Stark progression, 3 Arbete eller studier, 4 Hållbart resultat, 5 Snabbhetspremie)
-- som läggs ihop utan avräkning upp till ett tak per deltagare. Reglerna, taket och stegens namn står i avtalskonfigurationen
-- (contracts.config.bonus, zod i src/core/config.ts) och stegens belopp i prislistan (price_items, unit bonus_step) – aldrig i
-- tabellerna här. Förslagen räknas fram av servern (src/core/bonus.ts, jobbet report_schedule) och skickas av en människa.
--
-- 1. bonus_claims (0007) får det som anspråket behöver: avtalet, bonussteget (step 1–5), läget (status suggested → submitted →
--    approved/rejected, eller withdrawn), källan (auto/manual), händelsen och steg 3-anspråket som det bygger på, resultatdatum,
--    verifieringens typ och datum (aldrig dokumentet), checklistan för steg 1, det frysta redovisningsunderlaget (snapshot, sätts
--    när anspråket skickas), vem och när. Aldrig belopp: amount_ore är alltid null (check) – beloppet räknas på bonusfakturan ur
--    prislistan och taket, så att kommunen och coachen aldrig kan läsa ett belopp i raden. evidence_paths är alltid tom (inga
--    dokument i Miljonmatch – intygen skickas till kommunen på annat sätt). Kolumnerna kind, basis (coachens korta kommentar i
--    underlaget), submitted_at, customer_decision, decided_by, decided_at och invoice_draft_id (används inte) finns kvar.
--    Högst ett anspråk som räknas (suggested, submitted, approved) per ärende och bonussteg (partiellt unikt index) – ett avslaget
--    eller återtaget anspråk hindrar inte ett nytt.
-- 2. bonus_claim_decisions: kommunens beslut – append-only, ett per anspråk. En ny rad ändrar anspråket i samma transaktion
--    (triggern bonus_claim_decisions_apply, security definer): status, beslut, vem, när och motiveringen – bara när anspråket är
--    skickat och inte beslutat, och ett godkännande av steg 4 eller 5 bara när steg 3-anspråket är godkänt. Annars nekas hela raden.
--      via portal  kommunens handläggare med åtkomsten "customer" till ärendet, i eget namn (decided_by = recorded_by = jag).
--                  Motiveringen är frivillig.
--      via mejl    kommunen skickade beslutet med mejl (CLAUDE.md punkt 10): samordnaren eller avtalsansvarig i avtalet registrerar
--                  det i eget namn (recorded_by = jag, decided_by null) med motivering (krävs).
-- 3. Övergångarna i bonus_claims (triggern bonus_claims_guard, bara inloggade): suggested → submitted (redovisningsunderlaget
--    krävs, i eget namn), suggested → withdrawn och submitted → withdrawn (i eget namn). submitted → approved/rejected bara via
--    beslutet (mm.apply_bonus_decision – security definer, som triggern släpper igenom). Ett beslutat eller återtaget anspråk
--    ändras aldrig. Steget, ärendet, avtalet, källan, händelsen, steg 3-anspråket och skaparen ändras aldrig. Ett skickat anspråk
--    ändras inte (underlaget är fryst). En ändring som inte ändrar något nekas.
-- 4. invoice_lines.bonus_claim_id: bonusfakturans rad pekar på anspråket – en rad per godkänt anspråk (unikt per faktura), id
--    `<faktura>:<ärende>:steg<n>`. Periodiska rader har ingen (null) och är som förut en per ärende och faktura. En bonusrad står
--    bara på en bonusfaktura och en periodisk rad bara på en periodisk faktura (triggern invoice_lines_bonus_check, för alla).
--    En bonusfaktura per avtal, månad och grupp ('bonus', 'bonus-tillagg-2' …) – samma regel som de periodiska.
-- 5. Behörighet (speglas exakt i src/data/policy.ts och prövas i src/data/supabase/rls-parity.test.ts):
--      bonus_claims       läsa: Miljonbemanning med åtkomst full, team eller billing (som förut); kommunen (åtkomst customer) bara
--                         skickade och beslutade anspråk (submitted, approved, rejected) – aldrig förslag eller återtagna.
--                         skapa: den som arbetar i ärendet (mm.work_on), som förslag (suggested), källa manual, i eget namn.
--                         ändra: den som arbetar i ärendet (övergångarna ovan). Ekonomens ändring (0026) är borttagen – raden
--                         har inga belopp. Ingen raderar.
--      bonus_claim_decisions  läsa: åtkomst full, team, billing eller customer. Skapa: se punkt 2. Ingen ändrar eller raderar.
-- 6. mm.customer_safe_config tar också bort bonusens tak i öre (bonus.capOre) i kommunens version av avtalet (contracts_public).
--
-- Speglas i src/data/policy.ts (bonus_claims, bonus_claim_decisions, invoice_lines), src/data/schema.ts (TABLE_NAMES,
-- UNIQUE_KEYS), src/core/config.ts (customerSafeConfig) och scripts/db/columns.ts.
-- Inga destruktiva satser och inga rader ändras utom att contract_id fylls i från ärendet. Produktionen har inga bonusanspråk.
-- Kontrollerna läggs till som not valid: befintliga rader prövas inte, nya och ändrade rader gör det. Idempotent (if not
-- exists, or replace, drop … if exists) – tål att köras igen i SQL Editor.
-- Befintliga objekt som ersätts: policyerna bonus_claims_select/insert/update, funktionen mm.customer_safe_config och det unika
-- indexet invoice_lines_draft_case_key (blir partiellt: bara periodiska rader).
--
-- Lås: alter table tar starka lås på invoice_lines och invoice_drafts. Väntar en sats längre än 5 sekunder på ett lås avbryts
-- körningen (felkod 55P03) i stället för att alla andra frågor köar bakom den – kör då filen igen, gärna utanför arbetstid.
-- Inställningen gäller bara den här körningen (återställs sist i filen).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- 1. Bonusanspråken
alter table public.bonus_claims add column if not exists contract_id text references public.contracts (id);
update public.bonus_claims b set contract_id = c.contract_id from public.cases c where c.id = b.case_id and b.contract_id is null;
alter table public.bonus_claims alter column contract_id set not null;
alter table public.bonus_claims add column if not exists step integer;
alter table public.bonus_claims add column if not exists status text not null default 'suggested';
alter table public.bonus_claims add column if not exists source text;
alter table public.bonus_claims add column if not exists outcome_event_id text references public.outcome_events (id);
alter table public.bonus_claims add column if not exists follows_claim_id text references public.bonus_claims (id);
alter table public.bonus_claims add column if not exists reached_on date;
alter table public.bonus_claims add column if not exists verification_kind text;
alter table public.bonus_claims add column if not exists verification_on date;
alter table public.bonus_claims add column if not exists checklist jsonb not null default '{}'::jsonb;
alter table public.bonus_claims add column if not exists snapshot jsonb;
alter table public.bonus_claims add column if not exists created_by text not null default 'system';
alter table public.bonus_claims add column if not exists created_at timestamptz not null default now();
alter table public.bonus_claims add column if not exists submitted_by text;
alter table public.bonus_claims add column if not exists withdrawn_by text;
alter table public.bonus_claims add column if not exists withdrawn_at timestamptz;
alter table public.bonus_claims add column if not exists decision_note text;

alter table public.bonus_claims drop constraint if exists bonus_claims_step_range;
alter table public.bonus_claims add constraint bonus_claims_step_range check (step between 1 and 5) not valid;
alter table public.bonus_claims drop constraint if exists bonus_claims_status_check;
alter table public.bonus_claims add constraint bonus_claims_status_check check (status in ('suggested', 'submitted', 'approved', 'rejected', 'withdrawn')) not valid;
alter table public.bonus_claims drop constraint if exists bonus_claims_source_check;
alter table public.bonus_claims add constraint bonus_claims_source_check check (source in ('auto', 'manual')) not valid;
-- Aldrig belopp på anspråket och aldrig dokument.
alter table public.bonus_claims drop constraint if exists bonus_claims_no_amount;
alter table public.bonus_claims add constraint bonus_claims_no_amount check (amount_ore is null) not valid;
alter table public.bonus_claims drop constraint if exists bonus_claims_no_documents;
alter table public.bonus_claims add constraint bonus_claims_no_documents check (cardinality(evidence_paths) = 0) not valid;
-- Steg 1–2 är progression, steg 3–5 arbete eller studier; steg 4 och 5 bygger på ett steg 3-anspråk, de andra inte.
alter table public.bonus_claims drop constraint if exists bonus_claims_step_shape;
alter table public.bonus_claims add constraint bonus_claims_step_shape check (
  step is null or (kind = case when step <= 2 then 'progression' else 'work' end and (step in (4, 5)) = (follows_claim_id is not null))
) not valid;
-- Läget och kolumnerna hör ihop: ett skickat eller beslutat anspråk har underlaget och tiden, ett förslag har dem inte (ett
-- återtaget kan ha dem – det kan ha skickats först); ett beslutat har beslutet; ett återtaget har vem och när.
alter table public.bonus_claims drop constraint if exists bonus_claims_status_shape;
alter table public.bonus_claims add constraint bonus_claims_status_shape check (
  (status not in ('submitted', 'approved', 'rejected') or (snapshot is not null and submitted_at is not null))
  and (status <> 'suggested' or (snapshot is null and submitted_at is null))
  and (status in ('approved', 'rejected')) = (customer_decision is not null and decided_at is not null)
  and (status not in ('approved', 'rejected') or customer_decision = status)
  and (status = 'withdrawn') = (withdrawn_at is not null and withdrawn_by is not null)
) not valid;
alter table public.bonus_claims drop constraint if exists bonus_claims_text_length;
alter table public.bonus_claims add constraint bonus_claims_text_length check (
  char_length(basis) <= 500 and (verification_kind is null or char_length(verification_kind) <= 200) and (decision_note is null or char_length(decision_note) <= 1000)
  and jsonb_typeof(checklist) = 'object' and (snapshot is null or jsonb_typeof(snapshot) = 'object')
) not valid;

-- Högst ett anspråk som räknas per ärende och bonussteg (src/data/schema.ts UNIQUE_KEYS).
create unique index if not exists bonus_claims_case_step_active_key on public.bonus_claims (case_id, step) where status in ('suggested', 'submitted', 'approved');
create index if not exists bonus_claims_contract_id_idx on public.bonus_claims (contract_id, status);
create index if not exists bonus_claims_outcome_event_id_idx on public.bonus_claims (outcome_event_id);
create index if not exists bonus_claims_follows_claim_id_idx on public.bonus_claims (follows_claim_id);

-- Raden stämmer med ärendet (policy.ts bonusClaimConsistent – gäller alla, också service role): ärendets avtal, händelsen i
-- ärendet och steg 3-anspråket i samma ärende. För inloggade som skapar ett anspråk dessutom (policy.ts bonusClaimChained): aktuell
-- tid (created_at högst 10 minuter från mm.app_now()) och steg 3-anspråket räknas (suggested, submitted, approved) – steg 4 och 5
-- skapas aldrig på ett avslaget eller återtaget steg 3. Uppslagen görs med den inloggades rättigheter (den som arbetar i ärendet
-- läser ärendets händelser och anspråk); ärendets avtal med mm.case_contract_id (0019).
create or replace function mm.check_bonus_claim() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  f_case   text;
  f_step   integer;
  f_status text;
begin
  if mm.case_contract_id(new.case_id) is distinct from new.contract_id then
    raise exception 'Anspråket ska höra till ärendets avtal' using errcode = '23514';
  end if;
  if new.outcome_event_id is not null and not exists (select 1 from public.outcome_events e where e.id = new.outcome_event_id and e.case_id = new.case_id) then
    raise exception 'Händelsen ska höra till ärendet' using errcode = '23514';
  end if;
  if new.follows_claim_id is not null then
    select x.case_id, x.step, x.status into f_case, f_step, f_status from public.bonus_claims x where x.id = new.follows_claim_id;
    if f_case is distinct from new.case_id or f_step is distinct from 3 then
      raise exception 'Bonussteg 4 och 5 bygger på bonussteg 3 i samma ärende' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and current_user = 'authenticated' and f_status not in ('suggested', 'submitted', 'approved') then
      raise exception 'Bonussteg 3 är avslaget eller återtaget' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' and current_user = 'authenticated' and abs(extract(epoch from (new.created_at - mm.app_now()))) > 600 then
    raise exception 'Anspråket registreras med aktuell tid' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists bonus_claims_check on public.bonus_claims;
create trigger bonus_claims_check before insert or update on public.bonus_claims
for each row execute function mm.check_bonus_claim();

-- Övergångarna (policy.ts bonusClaimTransition – bara inloggade; servern och beslutet via mm.apply_bonus_decision rörs inte).
-- Fälten jämförs som jsonb utan de fält som övergången får ändra.
create or replace function mm.guard_bonus_claim() returns trigger
language plpgsql set search_path = public, mm
as $$
declare
  editable text[] := array['basis', 'reached_on', 'verification_kind', 'verification_on', 'checklist'];
  allowed  text[];
  me       text := mm.current_profile_id();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.status in ('approved', 'rejected', 'withdrawn') then
    raise exception 'Ett beslutat eller återtaget bonusanspråk ändras inte' using errcode = '42501';
  end if;
  if to_jsonb(new) = to_jsonb(old) then
    raise exception 'Ändringen ändrar ingenting' using errcode = '42501';
  end if;
  if old.status = 'suggested' and new.status = 'suggested' then
    allowed := editable;
  elsif old.status = 'suggested' and new.status = 'submitted' then
    if new.snapshot is null or new.submitted_at is null or new.submitted_by is distinct from me
       or abs(extract(epoch from (new.submitted_at - mm.app_now()))) > 600 then
      raise exception 'Ett skickat anspråk har redovisningsunderlaget och skickas i eget namn med aktuell tid' using errcode = '42501';
    end if;
    allowed := editable || array['status', 'snapshot', 'submitted_at', 'submitted_by'];
  elsif old.status in ('suggested', 'submitted') and new.status = 'withdrawn' then
    if new.withdrawn_at is null or new.withdrawn_by is distinct from me or abs(extract(epoch from (new.withdrawn_at - mm.app_now()))) > 600 then
      raise exception 'Anspråket återtas i eget namn med aktuell tid' using errcode = '42501';
    end if;
    allowed := array['status', 'withdrawn_at', 'withdrawn_by'];
  else
    raise exception 'Kommunens beslut registreras bara som ett beslut (bonus_claim_decisions)' using errcode = '42501';
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Bonusanspråket får inte ändras så' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists bonus_claims_guard on public.bonus_claims;
create trigger bonus_claims_guard before update on public.bonus_claims
for each row execute function mm.guard_bonus_claim();

-- ---------------------------------------------------------------- 2. Kommunens beslut
create table if not exists public.bonus_claim_decisions (
  id          text primary key,
  claim_id    text not null references public.bonus_claims (id),
  case_id     text not null references public.cases (id),
  contract_id text not null references public.contracts (id),
  decision    text not null check (decision in ('approved', 'rejected')),
  note        text check (note is null or char_length(note) <= 1000),
  via         text not null check (via in ('portal', 'mejl')),
  decided_by  text references public.profiles (id),
  recorded_by text not null references public.profiles (id),
  decided_at  timestamptz not null,
  -- Portalen: handläggaren beslutar själv. Mejlet: Miljonbemanning registrerar beslutet med kommunens motivering.
  constraint bonus_claim_decisions_via_shape check (
    (via = 'portal' and decided_by is not null and decided_by = recorded_by)
    or (via = 'mejl' and decided_by is null and note is not null and char_length(btrim(note)) >= 1)
  )
);
-- Ett beslut per anspråk.
create unique index if not exists bonus_claim_decisions_claim_id_key on public.bonus_claim_decisions (claim_id);
create index if not exists bonus_claim_decisions_case_id_idx on public.bonus_claim_decisions (case_id);
create index if not exists bonus_claim_decisions_contract_id_idx on public.bonus_claim_decisions (contract_id, decided_at);
create index if not exists bonus_claim_decisions_decided_by_idx on public.bonus_claim_decisions (decided_by);
create index if not exists bonus_claim_decisions_recorded_by_idx on public.bonus_claim_decisions (recorded_by);

alter table public.bonus_claim_decisions enable row level security;
revoke all on public.bonus_claim_decisions from anon, authenticated;
grant all on public.bonus_claim_decisions to service_role;
-- Bara läsa och skapa: ett beslut ändras och raderas aldrig.
grant select, insert on public.bonus_claim_decisions to authenticated;

-- policy.ts bonus_claim_decisions.read: åtkomst full, team, billing eller customer till ärendet.
drop policy if exists bonus_claim_decisions_select on public.bonus_claim_decisions;
create policy bonus_claim_decisions_select on public.bonus_claim_decisions for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing,customer}'))
);
-- policy.ts bonusDecisionWrite: kommunens handläggare i portalen, eller samordnare och avtalsansvarig som registrerar ett mejl.
drop policy if exists bonus_claim_decisions_insert on public.bonus_claim_decisions;
create policy bonus_claim_decisions_insert on public.bonus_claim_decisions for insert to authenticated with check (
  (
    via = 'portal'
    and (select mm.current_role()) = 'kommun_handlaggare'
    and mm.case_access(case_id) = 'customer'
    and decided_by = (select mm.current_profile_id())
    and recorded_by = (select mm.current_profile_id())
  ) or (
    via = 'mejl'
    and (select mm.role_in(array['samordnare', 'avtalsansvarig']))
    and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
    and mm.case_access(case_id) = 'full'
    and decided_by is null
    and recorded_by = (select mm.current_profile_id())
  )
);

-- Beslutet stämmer med anspråket (policy.ts bonusDecisionConsistent – för alla): samma ärende och avtal. För inloggade dessutom
-- aktuell tid (decided_at högst 10 minuter från mm.app_now()). Uppslaget med den inloggades rättigheter: kommunen läser bara
-- skickade och beslutade anspråk i sina ärenden.
create or replace function mm.check_bonus_decision() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if not exists (select 1 from public.bonus_claims k where k.id = new.claim_id and k.case_id = new.case_id and k.contract_id = new.contract_id) then
    raise exception 'Beslutet ska gälla ett anspråk i ärendet' using errcode = '23514';
  end if;
  if current_user = 'authenticated' and abs(extract(epoch from (new.decided_at - mm.app_now()))) > 600 then
    raise exception 'Beslutet registreras med aktuell tid' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists bonus_claim_decisions_check on public.bonus_claim_decisions;
create trigger bonus_claim_decisions_check before insert on public.bonus_claim_decisions
for each row execute function mm.check_bonus_decision();

-- Anspråket ändras i samma transaktion som beslutet skrivs (policy.ts bonusDecisionApply – MemoryRepo gör samma ändring i samma
-- steg): status och beslut, vem (handläggaren, eller den som registrerade ett mejl), när och motiveringen. Bara när anspråket är
-- skickat och inte beslutat – och ett godkännande av steg 4 eller 5 bara när steg 3-anspråket är godkänt. Security definer: den
-- inloggade ändrar aldrig anspråkets beslut direkt (bonus_claims_guard ovan). Ligger i schemat mm, som inte nås via API:t.
create or replace function mm.apply_bonus_decision(p_decision_id text) returns boolean
language plpgsql security definer set search_path = public, mm
as $$
declare
  d public.bonus_claim_decisions%rowtype;
begin
  select * into d from public.bonus_claim_decisions where id = p_decision_id;
  if not found then
    return false;
  end if;
  update public.bonus_claims k
     set status = d.decision, customer_decision = d.decision, decided_by = coalesce(d.decided_by, d.recorded_by), decided_at = d.decided_at, decision_note = d.note
   where k.id = d.claim_id and k.case_id = d.case_id and k.contract_id = d.contract_id and k.status = 'submitted' and k.customer_decision is null
     and (d.decision = 'rejected' or k.follows_claim_id is null
          or exists (select 1 from public.bonus_claims s where s.id = k.follows_claim_id and s.status = 'approved'));
  return found;
end
$$;
revoke all on function mm.apply_bonus_decision(text) from public, anon;
grant execute on function mm.apply_bonus_decision(text) to authenticated, service_role;

create or replace function mm.after_bonus_decision() returns trigger
language plpgsql set search_path = public, mm
as $$
begin
  if current_user = 'authenticated' and not mm.apply_bonus_decision(new.id) then
    raise exception 'Anspråket är inte skickat till kommunen, är redan beslutat, eller så behöver bonussteg 3 godkännas först' using errcode = '23514';
  end if;
  return null;
end
$$;
drop trigger if exists bonus_claim_decisions_apply on public.bonus_claim_decisions;
create trigger bonus_claim_decisions_apply after insert on public.bonus_claim_decisions
for each row execute function mm.after_bonus_decision();

-- ---------------------------------------------------------------- Policyerna för bonusanspråken (ersätter 0007 och 0026)
-- policy.ts bonus_claims.read: Miljonbemanning med åtkomst full, team eller billing; kommunen bara skickade och beslutade.
drop policy if exists bonus_claims_select on public.bonus_claims;
create policy bonus_claims_select on public.bonus_claims for select to authenticated using (
  case_id in (select mm.case_ids('{full,team,billing}'))
  or (status in ('submitted', 'approved', 'rejected') and case_id in (select mm.case_ids('{customer}')))
);
-- policy.ts bonusClaimWrite (ny rad): den som arbetar i ärendet, i avtalet, som förslag från coachen i eget namn.
drop policy if exists bonus_claims_insert on public.bonus_claims;
create policy bonus_claims_insert on public.bonus_claims for insert to authenticated with check (
  mm.work_on(case_id)
  and mm.member_in(contract_id, (select mm.current_role()), (select mm.my_contract_ids()))
  and status = 'suggested' and source = 'manual' and created_by = (select mm.current_profile_id())
  and snapshot is null and submitted_at is null and submitted_by is null and withdrawn_at is null and withdrawn_by is null
  and customer_decision is null and decided_by is null and decided_at is null and decision_note is null and invoice_draft_id is null
);
-- policy.ts bonusClaimWrite (ändring): den som arbetar i ärendet. Övergångarna prövas av triggern bonus_claims_guard.
drop policy if exists bonus_claims_update on public.bonus_claims;
create policy bonus_claims_update on public.bonus_claims for update to authenticated using (mm.work_on(case_id)) with check (mm.work_on(case_id));

-- ---------------------------------------------------------------- 4. Bonusfakturans rader
alter table public.invoice_lines add column if not exists bonus_claim_id text references public.bonus_claims (id);
create index if not exists invoice_lines_bonus_claim_id_idx on public.invoice_lines (bonus_claim_id);
-- Periodiska rader: en per ärende och faktura (som förut). Bonusrader: en per anspråk och faktura.
drop index if exists public.invoice_lines_draft_case_key;
create unique index if not exists invoice_lines_draft_case_periodic_key on public.invoice_lines (invoice_draft_id, case_id) where bonus_claim_id is null;
create unique index if not exists invoice_lines_draft_bonus_claim_key on public.invoice_lines (invoice_draft_id, bonus_claim_id) where bonus_claim_id is not null;
-- En bonusfaktura per avtal, månad och grupp (som de periodiska, 0023).
create unique index if not exists invoice_drafts_bonus_key on public.invoice_drafts (contract_id, month, grouping_key) where kind = 'bonus';

-- policy.ts invoiceLineKindOk (för alla): en bonusrad står bara på en bonusfaktura och gäller ett godkänt anspråk i radens
-- ärende och fakturans avtal; en periodisk rad står bara på en periodisk faktura. Bonus blandas aldrig in i en periodisk faktura.
create or replace function mm.check_invoice_line_kind() returns trigger
language plpgsql security definer set search_path = public, mm
as $$
declare
  k text;
  c text;
begin
  select d.kind, d.contract_id into k, c from public.invoice_drafts d where d.id = new.invoice_draft_id;
  if new.bonus_claim_id is null then
    if k is distinct from 'periodic' then
      raise exception 'En rad utan bonusanspråk står bara på en periodisk faktura' using errcode = '23514';
    end if;
  elsif k is distinct from 'bonus'
     or not exists (select 1 from public.bonus_claims b where b.id = new.bonus_claim_id and b.case_id = new.case_id and b.contract_id = c and b.status = 'approved') then
    raise exception 'En bonusrad står bara på en bonusfaktura och gäller ett godkänt anspråk i ärendet' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function mm.check_invoice_line_kind() from public, anon;
drop trigger if exists invoice_lines_bonus_check on public.invoice_lines;
create trigger invoice_lines_bonus_check before insert or update of invoice_draft_id, case_id, bonus_claim_id on public.invoice_lines
for each row execute function mm.check_invoice_line_kind();

-- ---------------------------------------------------------------- 6. Kommunens version av avtalet
-- Som 0026, och dessutom utan bonusens tak i öre (bonus.capOre) – kommunen ser aldrig belopp (src/core/config.ts customerSafeConfig).
create or replace function mm.customer_safe_config(config jsonb) returns jsonb
language sql immutable set search_path = public, mm
as $$
  select case when jsonb_typeof(b.cfg -> 'bonus') = 'object' then jsonb_set(b.cfg, '{bonus}', (b.cfg -> 'bonus') - 'capOre') else b.cfg end
  from (
    select case when jsonb_typeof(c.cfg -> 'penalties') = 'object' then jsonb_set(c.cfg, '{penalties}', '{}'::jsonb) else c.cfg end as cfg
    from (
      select case
        when jsonb_typeof(config -> 'kpis') = 'array' then jsonb_set(config, '{kpis}', (
          select coalesce(jsonb_agg(case when jsonb_typeof(e.k) = 'object' then e.k - 'internalTarget' - 'notify' else e.k end order by e.ord), '[]'::jsonb)
          from jsonb_array_elements(config -> 'kpis') with ordinality as e (k, ord)))
        else config
      end as cfg
    ) c
  ) b
$$;

reset lock_timeout;
reset statement_timeout;
