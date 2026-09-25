// Drizzle mirror of migrations/0001_init.sql. The SQL file is the source of truth for DDL.
import { bigint, bigserial, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const money = (name: string) => numeric(name, { precision: 14, scale: 4, mode: 'number' });
const omieId = (name: string) => bigint(name, { mode: 'number' });

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  cnpj: text('cnpj'),
  omieAppKeyEnc: text('omie_app_key_enc'),
  omieAppSecretEnc: text('omie_app_secret_enc'),
  omieStatus: text('omie_status').notNull().default('not_configured'),
  omieCheckedAt: ts('omie_checked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const memberships = pgTable('memberships', {
  userId: uuid('user_id').primaryKey(),
  companyId: uuid('company_id').notNull(),
  email: text('email').notNull(),
  role: text('role').$type<'admin' | 'buyer'>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  email: text('email').notNull(),
  role: text('role').$type<'admin' | 'buyer'>().notNull().default('buyer'),
  createdAt: ts('created_at').notNull().defaultNow(),
  acceptedAt: ts('accepted_at'),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  name: text('name').notNull(),
  nameNormalized: text('name_normalized').notNull(),
  phoneE164: text('phone_e164'),
  cnpj: text('cnpj'),
  email: text('email'),
  omieId: omieId('omie_id'),
  whatsappAliases: text('whatsapp_aliases').array().notNull().default([]),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const omieSuppliers = pgTable(
  'omie_suppliers',
  {
    companyId: uuid('company_id').notNull(),
    omieId: omieId('omie_id').notNull(),
    name: text('name').notNull(),
    tradeName: text('trade_name'),
    cnpj: text('cnpj'),
    phoneKeys: text('phone_keys').array().notNull().default([]),
    phones: text('phones').array().notNull().default([]),
    email: text('email'),
    tags: text('tags').array().notNull().default([]),
    nameNormalized: text('name_normalized').notNull(),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.omieId] })],
);

export const omiePurchaseOrders = pgTable(
  'omie_purchase_orders',
  {
    companyId: uuid('company_id').notNull(),
    omieId: omieId('omie_id').notNull(),
    number: text('number'),
    supplierOmieId: omieId('supplier_omie_id').notNull(),
    createdOn: date('created_on', { mode: 'string' }).notNull(),
    stage: text('stage'),
    total: numeric('total', { precision: 14, scale: 2, mode: 'number' }).notNull(),
    items: jsonb('items').$type<OmiePOItem[]>().notNull().default([]),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.omieId] })],
);

export interface OmiePOItem {
  omie_product_id: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export const omieSyncState = pgTable(
  'omie_sync_state',
  {
    companyId: uuid('company_id').notNull(),
    kind: text('kind').notNull(),
    syncedAt: ts('synced_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.kind] })],
);

export const requisitions = pgTable('requisitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  seq: bigserial('seq', { mode: 'number' }).notNull(),
  title: text('title').notNull(),
  status: text('status').$type<'open' | 'ordered' | 'cancelled'>().notNull().default('open'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const requisitionItems = pgTable('requisition_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  requisitionId: uuid('requisition_id').notNull(),
  position: integer('position').notNull(),
  description: text('description').notNull(),
  quantity: money('quantity').notNull(),
  unit: text('unit'),
});

export const extractions = pgTable('extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  userId: uuid('user_id').notNull(),
  sourceText: text('source_text').notNull(),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  output: jsonb('output').notNull(),
  model: text('model').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  seq: bigserial('seq', { mode: 'number' }).notNull(),
  supplierId: uuid('supplier_id').notNull(),
  requisitionId: uuid('requisition_id'),
  extractionId: uuid('extraction_id'),
  status: text('status').$type<'registered' | 'comparing' | 'selected' | 'ordered' | 'discarded'>().notNull(),
  currency: text('currency').$type<'BRL' | 'USD' | 'EUR'>().notNull(),
  deliveryDays: integer('delivery_days'),
  deliveryDate: date('delivery_date', { mode: 'string' }),
  deliveryText: text('delivery_text'),
  paymentTermsText: text('payment_terms_text'),
  freightType: text('freight_type').$type<'CIF' | 'FOB'>(),
  freightValue: money('freight_value'),
  validityText: text('validity_text'),
  quoteDate: date('quote_date', { mode: 'string' }).notNull(),
  sourceText: text('source_text').notNull(),
  origin: text('origin').$type<'whatsapp' | 'manual'>().notNull(),
  registrationMs: integer('registration_ms'),
  correctedFields: text('corrected_fields').array().notNull().default([]),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const quoteItems = pgTable('quote_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull(),
  position: integer('position').notNull(),
  description: text('description').notNull(),
  brand: text('brand'),
  sku: text('sku'),
  quantity: money('quantity').notNull(),
  unit: text('unit'),
  unitPrice: money('unit_price').notNull(),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  seq: bigserial('seq', { mode: 'number' }).notNull(),
  quoteId: uuid('quote_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  status: text('status').$type<'draft' | 'sending' | 'sent' | 'error'>().notNull().default('draft'),
  paymentTermCode: text('payment_term_code'),
  exchangeRate: numeric('exchange_rate', { precision: 14, scale: 6, mode: 'number' }),
  totalBrl: money('total_brl'),
  omieOrderId: omieId('omie_order_id'),
  omieNumber: text('omie_number'),
  lastError: text('last_error'),
  attempts: integer('attempts').notNull().default(0),
  sentAt: ts('sent_at'),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').notNull(),
  quoteItemId: uuid('quote_item_id').notNull(),
  position: integer('position').notNull(),
  omieProductId: omieId('omie_product_id'),
});

export const omieProducts = pgTable(
  'omie_products',
  {
    companyId: uuid('company_id').notNull(),
    omieId: omieId('omie_id').notNull(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    unit: text('unit'),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.omieId] })],
);

export const omiePaymentTerms = pgTable(
  'omie_payment_terms',
  {
    companyId: uuid('company_id').notNull(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    installments: integer('installments'),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.code] })],
);

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id'),
  userId: uuid('user_id'),
  type: text('type').notNull(),
  entityId: uuid('entity_id'),
  data: jsonb('data'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});
