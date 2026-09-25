-- Supplier context: local copies of Omie suppliers and purchase orders, so the side panel can
-- recognize the supplier of the open WhatsApp conversation (by phone or contact name) and show its history.
-- Omie's API filters neither suppliers by phone nor purchase orders by supplier.

-- WhatsApp contact names the buyer confirmed for this supplier ("Carlos (Microsemi)").
alter table suppliers add column whatsapp_aliases text[] not null default '{}';

create table omie_suppliers (
  company_id uuid not null references companies(id) on delete cascade,
  omie_id bigint not null,
  name text not null,
  trade_name text,
  cnpj text,
  -- Phone match keys: DDD + last 8 digits ("1170001234"), so numbers with or without the 9th digit match.
  phone_keys text[] not null default '{}',
  phones text[] not null default '{}',
  email text,
  tags text[] not null default '{}',
  name_normalized text not null,
  synced_at timestamptz not null default now(),
  primary key (company_id, omie_id)
);
create index omie_suppliers_phone_idx on omie_suppliers using gin (phone_keys);

create table omie_purchase_orders (
  company_id uuid not null references companies(id) on delete cascade,
  omie_id bigint not null,
  number text,
  supplier_omie_id bigint not null,
  created_on date not null,
  stage text,
  total numeric(14, 2) not null,
  items jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  primary key (company_id, omie_id)
);
create index omie_purchase_orders_supplier_idx on omie_purchase_orders (company_id, supplier_omie_id, created_on desc);

-- When each Omie copy was last refreshed (also when it came back empty).
create table omie_sync_state (
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,
  synced_at timestamptz not null,
  primary key (company_id, kind)
);

alter table omie_suppliers enable row level security;
alter table omie_purchase_orders enable row level security;
alter table omie_sync_state enable row level security;
