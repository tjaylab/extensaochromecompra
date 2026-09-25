import { z } from 'zod';

// ---------------------------------------------------------------------------
// Extraction: what the model returns for one supplier message.
// Kept free of refinements (min/max/regex) so it maps cleanly to a
// structured-output JSON schema. The API validates business rules afterwards.
// ---------------------------------------------------------------------------

export const Currency = z.enum(['BRL', 'USD', 'EUR']);
export type Currency = z.infer<typeof Currency>;

export const FreightType = z.enum(['CIF', 'FOB']);
export type FreightType = z.infer<typeof FreightType>;

export const ExtractedItem = z.object({
  descricao: z.string().describe('Produto como o fornecedor descreveu, sem quantidade nem preço'),
  marca: z.string().nullable().describe('Marca ou fabricante, se citado'),
  sku: z.string().nullable().describe('SKU, part number ou código do produto, se citado'),
  quantidade: z.number().nullable(),
  unidade: z.string().nullable().describe('Unidade de medida: un, m, kg, cx, etc.'),
  valor_unitario: z.number().nullable(),
  valor_total: z.number().nullable().describe('Total do item somente se escrito na mensagem'),
});
export type ExtractedItem = z.infer<typeof ExtractedItem>;

export const ExtractionOutput = z.object({
  fornecedor_nome: z.string().nullable().describe('Empresa fornecedora se citada no texto'),
  moeda: Currency.nullable(),
  prazo_entrega_dias: z.number().nullable().describe('Prazo de entrega em dias corridos'),
  prazo_entrega_data: z.string().nullable().describe('Data de entrega absoluta em YYYY-MM-DD'),
  prazo_entrega_texto: z.string().nullable().describe('Prazo como escrito na mensagem'),
  condicao_pagamento: z.string().nullable().describe('Condição de pagamento como escrita, ex.: "28 dias", "30/60/90"'),
  frete_tipo: FreightType.nullable(),
  frete_valor: z.number().nullable(),
  validade_proposta: z.string().nullable(),
  itens: z.array(ExtractedItem),
  campos_ambiguos: z.array(z.object({ campo: z.string(), motivo: z.string() })),
  mensagens_usadas: z
    .array(z.number())
    .describe('Números [n] das mensagens da conversa de onde saiu a proposta vigente; vazio quando não houver conversa'),
  trecho_documento: z
    .string()
    .nullable()
    .describe('Com anexo (PDF ou imagem): as linhas da proposta transcritas como estão no documento; sem anexo, null'),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;

/** One message read from the open WhatsApp conversation. */
export const ConversationMessage = z.object({
  direction: z.enum(['in', 'out']), // in = from the supplier, out = from the buyer
  author: z.string().max(200).nullish(),
  time: z.string().max(40).nullish(), // as WhatsApp shows it, e.g. "10:47, 25/09/2026"
  text: z.string().max(3000),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;

export const MAX_CONVERSATION_CHARS = 16_000;

export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** A PDF or image with the proposal, base64 without the data: prefix. */
export const Attachment = z.object({
  name: z.string().max(200).nullish(),
  media_type: z.enum(ATTACHMENT_TYPES, { message: 'Formato não suportado: use PDF, JPG, PNG ou WEBP' }),
  data: z
    .string()
    .min(1)
    .refine((b) => Math.floor((b.length * 3) / 4) <= MAX_ATTACHMENT_BYTES, { message: 'Arquivo maior que 8 MB' }),
});
export type Attachment = z.infer<typeof Attachment>;

export const ExtractionRequest = z
  .object({
    /** The buyer's selection. Optional when a conversation or an attachment is sent. */
    text: z.string().trim().max(4000).default(''),
    /** Recent messages of the open conversation, oldest first. */
    conversation: z.array(ConversationMessage).max(80).nullish(),
    attachments: z.array(Attachment).max(3, 'Envie no máximo 3 arquivos por cotação').nullish(),
    contact_name: z.string().max(200).nullish(),
    contact_phone: z.string().max(40).nullish(),
  })
  .refine((d) => d.text.length > 0 || (d.conversation?.length ?? 0) > 0 || (d.attachments?.length ?? 0) > 0, {
    message: 'Selecione uma mensagem, abra uma conversa ou anexe um arquivo',
  })
  .refine((d) => (d.conversation ?? []).reduce((a, m) => a + m.text.length, 0) <= MAX_CONVERSATION_CHARS, {
    message: 'Conversa longa demais: selecione o trecho da proposta',
  });
export type ExtractionRequest = z.infer<typeof ExtractionRequest>;

/**
 * Renders the conversation as numbered lines, the format the model sees and the buyer reviews:
 * "[3] 25/09 10:47 · Fornecedor · Carlos: Consigo 30 fontes…"
 */
export function formatConversation(messages: ConversationMessage[], opts: { only?: number[] } = {}): string {
  return messages
    .map((m, i) => ({ m, n: i + 1 }))
    .filter(({ n }) => !opts.only || opts.only.includes(n))
    .map(({ m, n }) => {
      const who = m.direction === 'out' ? 'Comprador' : `Fornecedor${m.author ? ` · ${m.author}` : ''}`;
      return `[${n}]${m.time ? ` ${m.time}` : ''} · ${who}: ${m.text}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Domain DTOs returned by the API.
// ---------------------------------------------------------------------------

export const QuoteStatus = z.enum(['registered', 'comparing', 'selected', 'ordered', 'discarded']);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  registered: 'Registrada',
  comparing: 'Em comparação',
  selected: 'Selecionada',
  ordered: 'Pedido gerado',
  discarded: 'Descartada',
};

export const OrderStatus = z.enum(['draft', 'sending', 'sent', 'error']);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Rascunho',
  sending: 'Enviando',
  sent: 'Enviado',
  error: 'Erro no envio',
};

export type OmieStatus = 'not_configured' | 'connected' | 'invalid' | 'error';

export interface SupplierDTO {
  id: string;
  name: string;
  phone: string | null;
  cnpj: string | null;
  email: string | null;
  omie_id: number | null;
}

export interface OmieSupplierDTO {
  omie_id: number;
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  phones: string[];
  email: string | null;
  is_supplier: boolean; // has the "Fornecedor" tag
}

/** What the side panel shows when a WhatsApp conversation is opened. */
export interface SupplierContextDTO {
  contact: { name: string | null; phone: string | null };
  /** How the conversation was recognized. */
  match: 'phone' | 'alias' | 'name' | null;
  supplier: SupplierDTO | null;
  omie_supplier: OmieSupplierDTO | null;
  /** When nothing matched: likely suppliers for the buyer to confirm. */
  candidates: OmieSupplierDTO[];
  omie: {
    available: boolean; // false when Omie is not connected or unreachable
    synced_at: string | null;
    orders_12m: number;
    spent_12m: number;
    average_ticket: number | null;
    last_order: { number: string | null; date: string; total: number } | null;
    recent_orders: { number: string | null; date: string; total: number; items: string }[];
    top_products: { description: string; quantity: number; total: number; last_unit_price: number; last_date: string }[];
  };
  quotes: {
    total: number;
    ordered: number;
    last: { id: string; number: string; date: string; total: number; currency: string } | null;
    average_delivery_days: number | null;
    recent: { id: string; number: string; date: string; total: number; currency: string; status: QuoteStatus }[];
  };
}

export const LinkSupplierInput = z.object({
  omie_id: z.number().int().nullish(),
  supplier_id: z.string().uuid().nullish(),
  contact_name: z.string().max(200).nullish(),
  contact_phone: z.string().max(40).nullish(),
});
export type LinkSupplierInput = z.infer<typeof LinkSupplierInput>;

export interface SupplierMatch {
  supplier: SupplierDTO | null;
  reason: 'phone' | 'name' | null;
  suggestions: SupplierDTO[];
}

export interface ExtractionResponse {
  extraction_id: string;
  data: ExtractionOutput;
  /** What the quote preserves as its original text: the messages the proposal came from. */
  source_text: string;
  supplier_match: SupplierMatch;
  latency_ms: number;
}

export const QuoteItemInput = z.object({
  description: z.string().trim().min(1, 'Informe o produto'),
  brand: z.string().trim().nullish(),
  sku: z.string().trim().nullish(),
  quantity: z.number().positive('Quantidade deve ser maior que zero'),
  unit: z.string().trim().nullish(),
  unit_price: z.number().nonnegative('Valor unitário inválido'),
});
export type QuoteItemInput = z.infer<typeof QuoteItemInput>;

export const SupplierRef = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({
    new: z.object({
      name: z.string().trim().min(1, 'Informe o nome do fornecedor'),
      phone: z.string().nullish(),
      cnpj: z.string().nullish(),
      email: z.string().nullish(),
    }),
  }),
]);
export type SupplierRef = z.infer<typeof SupplierRef>;

export const CreateQuoteInput = z.object({
  extraction_id: z.string().uuid().nullish(),
  supplier: SupplierRef,
  requisition_id: z.string().uuid().nullish(),
  currency: Currency,
  delivery_days: z.number().int().nonnegative().nullish(),
  delivery_date: z.string().nullish(),
  delivery_text: z.string().nullish(),
  payment_terms_text: z.string().nullish(),
  freight_type: FreightType.nullish(),
  freight_value: z.number().nonnegative().nullish(),
  validity_text: z.string().nullish(),
  quote_date: z.string(),
  source_text: z.string().min(1),
  origin: z.enum(['whatsapp', 'manual']),
  registration_ms: z.number().int().nonnegative().nullish(),
  items: z.array(QuoteItemInput).min(1, 'Informe ao menos um item'),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteInput>;

export const UpdateQuoteInput = z.object({
  requisition_id: z.string().uuid().nullable().optional(),
  status: z.enum(['registered', 'comparing', 'discarded']).optional(),
});
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteInput>;

export interface QuoteItemDTO {
  id: string;
  position: number;
  description: string;
  brand: string | null;
  sku: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total: number;
}

export interface QuoteDTO {
  id: string;
  number: string;
  status: QuoteStatus;
  supplier: SupplierDTO;
  requisition: { id: string; number: string; title: string } | null;
  currency: Currency;
  delivery_days: number | null;
  delivery_date: string | null;
  delivery_text: string | null;
  payment_terms_text: string | null;
  freight_type: FreightType | null;
  freight_value: number | null;
  validity_text: string | null;
  quote_date: string;
  source_text: string;
  origin: 'whatsapp' | 'manual';
  registration_ms: number | null;
  total: number;
  items: QuoteItemDTO[];
  created_at: string;
}

export const CreateRequisitionInput = z.object({
  title: z.string().trim().min(1, 'Informe um título'),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        quantity: z.number().positive(),
        unit: z.string().trim().nullish(),
      }),
    )
    .default([]),
});
export type CreateRequisitionInput = z.infer<typeof CreateRequisitionInput>;

export interface RequisitionDTO {
  id: string;
  number: string;
  title: string;
  status: 'open' | 'ordered' | 'cancelled';
  items: { description: string; quantity: number; unit: string | null }[];
  quote_count: number;
  created_at: string;
}

export interface ComparisonDTO {
  requisition: RequisitionDTO;
  quotes: (QuoteDTO & { badges: string[] })[];
}

export interface OrderItemDTO {
  id: string;
  quote_item_id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number; // quote currency
  omie_product_id: number | null;
  omie_product_label: string | null;
  suggestion: { omie_id: number; label: string } | null;
}

export interface OrderDTO {
  id: string;
  number: string;
  status: OrderStatus;
  quote: { id: string; number: string; currency: Currency; payment_terms_text: string | null; delivery_days: number | null; delivery_date: string | null; freight_type: FreightType | null; freight_value: number | null };
  requisition: { id: string; number: string; title: string } | null;
  supplier: SupplierDTO;
  payment_term_code: string | null;
  exchange_rate: number | null;
  total_original: number;
  total_brl: number | null;
  items: OrderItemDTO[];
  omie_order_id: number | null;
  omie_number: string | null;
  last_error: string | null;
  attempts: number;
  sent_at: string | null;
  created_at: string;
  checks: { key: string; label: string; ok: boolean }[];
  ready: boolean;
}

export const UpdateOrderInput = z.object({
  payment_term_code: z.string().nullable().optional(),
  exchange_rate: z.number().positive().nullable().optional(),
  supplier_cnpj: z.string().nullable().optional(),
  items: z.array(z.object({ id: z.string().uuid(), omie_product_id: z.number().int().nullable() })).optional(),
});
export type UpdateOrderInput = z.infer<typeof UpdateOrderInput>;

export interface OmieProductDTO {
  omie_id: number;
  code: string;
  description: string;
  unit: string | null;
}

export interface OmiePaymentTermDTO {
  code: string;
  description: string;
  installments: number | null;
}

export interface MeDTO {
  user: { id: string; email: string };
  company: { id: string; name: string; cnpj: string | null } | null;
  role: 'admin' | 'buyer' | null;
  omie: { status: OmieStatus; checked_at: string | null; mode: 'live' | 'mock' };
}

export interface MetricsDTO {
  quotes_total: number;
  quotes_whatsapp: number;
  median_registration_seconds: number | null;
  under_one_minute_pct: number | null;
  corrected_fields_pct: number | null;
  corrected_by_field: { field: string; count: number }[];
  quotes_by_user: { email: string; count: number }[];
  orders_sent: number;
}

export const EVENT_TYPES = [
  'capture_started',
  'extraction_viewed',
  'quote_form_cancelled',
  'comparison_viewed',
  'order_generated',
] as const;
export const EventInput = z.object({
  type: z.enum(EVENT_TYPES),
  entity_id: z.string().uuid().nullish(),
  data: z.record(z.string(), z.unknown()).nullish(),
});
