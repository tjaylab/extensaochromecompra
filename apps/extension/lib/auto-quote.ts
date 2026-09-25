import { brToIso, looksLikeProposal, todayIso, type ConversationMessage, type CreateQuoteInput, type ExtractionResponse } from '@compras/shared';

export interface ProposalSource {
  contactName: string | null;
  contactPhone: string | null;
  /** When the proposal arrived or was detected: start of the registration timer. */
  detectedAt: number;
  origin: 'whatsapp' | 'manual';
}

/**
 * Builds the quote straight from an automatic reading, so it can be saved in one click after the buyer
 * sees the summary. Returns the fields that block saving (the buyer then uses "Revisar").
 */
export function quoteFromExtraction(ex: ExtractionResponse, src: ProposalSource, now = Date.now()): { payload: CreateQuoteInput | null; missing: string[] } {
  const d = ex.data;
  const missing: string[] = [];
  const match = ex.supplier_match.supplier;
  const contactCompany = src.contactName?.match(/\(([^)]+)\)/)?.[1] ?? src.contactName;
  const name = d.fornecedor_nome || contactCompany || src.contactPhone;
  if (!match && !name) missing.push('fornecedor');
  if (!d.moeda) missing.push('moeda');
  if (!d.itens.length) missing.push('itens');
  const items = d.itens.map((i, idx) => {
    const unit = i.valor_unitario ?? (i.valor_total != null && i.quantidade ? i.valor_total / i.quantidade : null);
    if (!i.descricao.trim()) missing.push(`produto do item ${idx + 1}`);
    if (!i.quantidade || i.quantidade <= 0) missing.push(`quantidade do item ${idx + 1}`);
    if (unit == null) missing.push(`preço do item ${idx + 1}`);
    return { description: i.descricao.trim(), brand: i.marca, sku: i.sku, quantity: i.quantidade ?? 0, unit: i.unidade, unit_price: unit ?? 0 };
  });
  if (missing.length) return { payload: null, missing };
  return {
    missing,
    payload: {
      extraction_id: ex.extraction_id,
      supplier: match ? { id: match.id } : { new: { name: name!, phone: src.contactPhone } },
      requisition_id: null,
      currency: d.moeda!,
      delivery_days: d.prazo_entrega_dias,
      delivery_date: d.prazo_entrega_data ? brToIso(d.prazo_entrega_data) : null,
      delivery_text: d.prazo_entrega_texto,
      payment_terms_text: d.condicao_pagamento,
      freight_type: d.frete_tipo,
      freight_value: d.frete_valor,
      validity_text: d.validade_proposta,
      quote_date: todayIso(),
      source_text: ex.source_text || '(sem texto)',
      origin: src.origin,
      registration_ms: Math.max(0, now - src.detectedAt),
      items,
    },
  };
}

/** Whether the loaded period has any supplier message with a price (worth an automatic reading). */
export function hasPricedMessage(conversation: ConversationMessage[] | null | undefined) {
  return !!conversation?.some((m) => m.direction === 'in' && looksLikeProposal(m.text));
}

/**
 * Identifies "this proposal in this conversation": the contact plus the latest priced supplier message.
 * The same key means nothing new arrived, so the conversation is not read again.
 */
export function proposalKey(contact: { contactName: string | null; contactPhone: string | null }, conversation: ConversationMessage[] | null | undefined) {
  const last = [...(conversation ?? [])].reverse().find((m) => m.direction === 'in' && looksLikeProposal(m.text));
  return last ? `${contact.contactPhone ?? contact.contactName}|${last.time ?? ''}|${last.text.slice(0, 80)}` : null;
}

// ---------------------------------------------------------------------------
// What was already read automatically (kept for a while, so reopening a chat does not spend a new reading)
// ---------------------------------------------------------------------------

const PROCESSED_KEY = 'processedProposals';
const MAX_ENTRIES = 300;

export async function wasProcessed(key: string): Promise<boolean> {
  const r = await chrome.storage.local.get(PROCESSED_KEY);
  return !!(r[PROCESSED_KEY] as Record<string, number> | undefined)?.[key];
}

export async function markProcessed(key: string) {
  const r = await chrome.storage.local.get(PROCESSED_KEY);
  const map = { ...((r[PROCESSED_KEY] as Record<string, number> | undefined) ?? {}), [key]: Date.now() };
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [PROCESSED_KEY]: Object.fromEntries(entries) });
}
