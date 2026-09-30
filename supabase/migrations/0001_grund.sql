-- 0001 Grund: tidszon, schemat mm, helgdagar, organisationer, avtal, avtalsområden och priser.
--
-- Gemensamt för alla migrationer (se supabase/README.md):
--   * Tabell- och kolumnnamn = src/data/schema.ts (fältnamnen i snake_case). Facit: scripts/db/columns.ts.
--   * Row Level Security på varje tabell, neka som standard. Policyerna är samma regler som src/data/policy.ts
--     (kommentaren "policy.ts:" anger vilken regel). anon får ingenting. service_role (ctx.system) går förbi RLS.
--   * Inga "default now()" för affärstider – hanterarna sätter tiden via ctx.now().
--   * Personuppgifter loggas aldrig; felmeddelanden i funktionerna innehåller bara id:n.

-- ---------------------------------------------------------------- Tidszon (CLAUDE.md punkt 12)
-- Gäller nya anslutningar. '2027-02-01T09:12' tolkas då som Stockholmstid och läses som '2027-02-01T09:12:00+01:00'.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Europe/Stockholm');
end
$$;
set timezone to 'Europe/Stockholm';

-- ---------------------------------------------------------------- Schemat mm: hjälpfunktioner för RLS (exponeras inte i API:t)
create schema if not exists mm;
revoke all on schema mm from public;
grant usage on schema mm to authenticated, service_role;
-- Funktioner får inga rättigheter automatiskt – varje funktion får sina grants uttryckligen.
alter default privileges in schema mm revoke execute on functions from public;
-- Supabase ger som standard anon och authenticated alla rättigheter på nya tabeller och funktioner i public.
-- Här nekas det som standard; varje tabell får sina grants uttryckligen (neka som standard, CLAUDE.md punkt 1).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------- Rollgrupper (samma som src/api/roles.ts och policy.ts)
create function mm.supplier_roles() returns text[] language sql immutable
as $$ select array['admin', 'avtalsansvarig', 'samordnare', 'coach', 'handledare', 'chef', 'ekonom'] $$;
create function mm.customer_roles() returns text[] language sql immutable
as $$ select array['kommun_handlaggare', 'kommun_chef'] $$;
create function mm.all_roles() returns text[] language sql immutable
as $$ select mm.supplier_roles() || mm.customer_roles() || array['deltagare'] $$;
grant execute on function mm.supplier_roles(), mm.customer_roles(), mm.all_roles() to authenticated, service_role;

-- ---------------------------------------------------------------- Helgdagar (src/core/holidays.ts)
create table public.holidays (
  id                         text primary key,
  date                       date not null unique,
  name                       text not null,
  constraint holidays_id_is_date check (id = to_char(date, 'YYYY-MM-DD'))
);

-- ---------------------------------------------------------------- Organisationer (leverantör och kunder)
create table public.organizations (
  id                         text primary key,
  name                       text not null,
  org_nr                     text not null,
  kind                       text not null check (kind in ('supplier', 'customer')),
  email_domains              text[] not null default '{}'
);

-- ---------------------------------------------------------------- Avtal. config valideras med zod i appen (src/core/config.ts).
create table public.contracts (
  id                         text primary key,
  supplier_id                text not null references public.organizations (id),
  customer_id                text not null references public.organizations (id),
  name                       text not null,
  contract_number            text not null,
  dnr                        text,
  starts_on                  date not null,
  ends_on                    date,
  case_prefix                text not null,
  data_role                  text not null,
  config                     jsonb not null,
  status                     text not null,
  contract_manager_id        text
);
create index contracts_supplier_id_idx on public.contracts (supplier_id);
create index contracts_customer_id_idx on public.contracts (customer_id);

create table public.contract_areas (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  code                       text not null,
  name                       text not null,
  active                     boolean not null,
  unique (contract_id, code)
);

create table public.price_items (
  id                         text primary key,
  contract_id                text not null references public.contracts (id),
  area_code                  text,
  code                       text not null,
  unit                       text not null,
  package_months             integer,
  price_ore                  bigint not null check (price_ore >= 0),
  vat_rate                   numeric not null,
  valid_from                 date not null,
  valid_to                   date,
  fortnox_article_no         text,
  example_only               boolean not null
);
create index price_items_contract_id_idx on public.price_items (contract_id);

-- ---------------------------------------------------------------- Neka som standard
alter table public.holidays enable row level security;
alter table public.organizations enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_areas enable row level security;
alter table public.price_items enable row level security;

revoke all on public.holidays, public.organizations, public.contracts, public.contract_areas, public.price_items from anon, authenticated;
grant all on public.holidays, public.organizations, public.contracts, public.contract_areas, public.price_items to service_role;
-- Policyerna för tabellerna ovan skapas i 0002 (de behöver funktionerna för inloggad användare och roll).
