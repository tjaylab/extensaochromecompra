-- Compras WhatsApp: initial schema.
-- Runs on Supabase Postgres (via `npm run db:migrate` or the SQL editor) and on PGlite in development.
-- Every business table carries company_id; the API derives it from the session, never from the request body.
-- RLS is enabled with no policies so the tables are unreachable through Supabase's public REST API
-- (anon/authenticated roles); the API connects as the database owner and bypasses RLS.

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text,
  omie_app_key_enc text,
  omie_app_secret_enc text,
  omie_status text not null default 'not_configured',
  omie_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table memberships (
  user_id uuid primary key,
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'buyer')),
  created_at timestamptz not null default now()
);
create index memberships_company_idx on memberships(company_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  role text not null default 'buyer' check (role in ('admin', 'buyer')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (company_id, email)
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  name_normalized text not null,
  phone_e164 text,
  cnpj text,
  email text,
  omie_id bigint,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index suppliers_phone_uq on suppliers(company_id, phone_e164) where phone_e164 is not null;
create unique index suppliers_cnpj_uq on suppliers(company_id, cnpj) where cnpj is not null;
create index suppliers_name_idx on suppliers(company_id, name_normalized);

create table requisitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  seq bigserial not null,
  title text not null,
  status text not null default 'open' check (status in ('open', 'ordered', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index requisitions_company_idx on requisitions(company_id, created_at desc);

create table requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  position int not null,
  description text not null,
  quantity numeric(14, 4) not null,
  unit text
);

create table extractions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null,
  source_text text not null,
  contact_name text,
  contact_phone text,
  output jsonb not null,
  model text not null,
  latency_ms int not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  seq bigserial not null,
  supplier_id uuid not null references suppliers(id),
  requisition_id uuid references requisitions(id) on delete set null,
  extraction_id uuid references extractions(id) on delete set null,
  status text not null check (status in ('registered', 'comparing', 'selected', 'ordered', 'discarded')),
  currency text not null check (currency in ('BRL', 'USD', 'EUR')),
  delivery_days int,
  delivery_date date,
  delivery_text text,
  payment_terms_text text,
  freight_type text check (freight_type in ('CIF', 'FOB')),
  freight_value numeric(14, 4),
  validity_text text,
  quote_date date not null,
  source_text text not null,
  origin text not null check (origin in ('whatsapp', 'manual')),
  registration_ms int,
  corrected_fields text[] not null default '{}',
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index quotes_company_idx on quotes(company_id, created_at desc);
create index quotes_requisition_idx on quotes(requisition_id);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  position int not null,
  description text not null,
  brand text,
  sku text,
  quantity numeric(14, 4) not null,
  unit text,
  unit_price numeric(14, 4) not null
);
create index quote_items_quote_idx on quote_items(quote_id);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  seq bigserial not null,
  quote_id uuid not null unique references quotes(id),
  supplier_id uuid not null references suppliers(id),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'error')),
  payment_term_code text,
  exchange_rate numeric(14, 6),
  total_brl numeric(14, 4),
  omie_order_id bigint,
  omie_number text,
  last_error text,
  attempts int not null default 0,
  sent_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index purchase_orders_company_idx on purchase_orders(company_id, created_at desc);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  quote_item_id uuid not null references quote_items(id),
  position int not null,
  omie_product_id bigint
);

create table omie_products (
  company_id uuid not null references companies(id) on delete cascade,
  omie_id bigint not null,
  code text not null,
  description text not null,
  unit text,
  synced_at timestamptz not null default now(),
  primary key (company_id, omie_id)
);

create table omie_payment_terms (
  company_id uuid not null references companies(id) on delete cascade,
  code text not null,
  description text not null,
  installments int,
  synced_at timestamptz not null default now(),
  primary key (company_id, code)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  user_id uuid,
  type text not null,
  entity_id uuid,
  data jsonb,
  occurred_at timestamptz not null default now()
);
create index events_company_idx on events(company_id, occurred_at desc);

alter table companies enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table suppliers enable row level security;
alter table requisitions enable row level security;
alter table requisition_items enable row level security;
alter table extractions enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
alter table omie_products enable row level security;
alter table omie_payment_terms enable row level security;
alter table events enable row level security;
