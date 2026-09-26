-- Plans and subscriptions (one per company) and the AI usage they are measured by.
-- The plan catalog (prices, limits) lives in code: packages/shared/src/billing.ts.

create table subscriptions (
  company_id uuid primary key references companies(id) on delete cascade,
  plan text not null,
  status text not null, -- trialing | active | past_due | canceled
  cycle text not null default 'monthly', -- monthly | yearly
  trial_ends_at timestamptz,
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- Set by the ProcureMate team: readings added to this period, and limits for "empresa" customers.
  extra_readings integer not null default 0,
  custom_seats integer,
  custom_readings integer,
  -- Asaas (payments): customer, recurring subscription and the open invoice's payment page.
  asaas_customer_id text,
  asaas_subscription_id text,
  invoice_url text,
  updated_at timestamptz not null default now()
);
create unique index subscriptions_asaas_idx on subscriptions (asaas_subscription_id) where asaas_subscription_id is not null;

-- One row per AI call (a message stretch, a PDF or an image): what plans count as a "reading".
create table ai_usage (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid,
  kind text not null, -- extraction | scan
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index ai_usage_company_idx on ai_usage (company_id, created_at);

alter table subscriptions enable row level security;
alter table ai_usage enable row level security;
