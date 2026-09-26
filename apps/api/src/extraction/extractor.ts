import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { ExtractionOutput, looksLikeProposal, parseDecimal, ScanOutput, type Attachment, type ConversationMessage } from '@compras/shared';
import type { Config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { buildScanMessage, buildUserMessage, EXTRACTION_SYSTEM_PROMPT } from './prompt.js';

export interface ExtractionResult {
  output: ExtractionOutput;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ExtractionInput {
  /** The buyer's selection ('' when capturing the whole conversation). */
  text: string;
  conversation?: ConversationMessage[] | null;
  /** PDFs and images with the proposal. */
  attachments?: Attachment[] | null;
  contactName?: string | null;
  today: string;
}

export type Extractor = (input: ExtractionInput) => Promise<ExtractionResult>;

export interface ScanResult {
  proposals: ExtractionOutput[];
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Finds every distinct proposal in a stretch of conversation (reading as the buyer scrolls). */
export type Scanner = (input: { conversation: ConversationMessage[]; contactName?: string | null; today: string }) => Promise<ScanResult>;

export function createExtractor(cfg: Config): Extractor {
  return cfg.EXTRACTION_MODE === 'mock' ? mockExtractor : claudeExtractor(cfg);
}

export function createScanner(cfg: Config): Scanner {
  return cfg.EXTRACTION_MODE === 'mock' ? mockScanner : claudeScanner(cfg);
}

function anthropicClient(cfg: Config) {
  return new Anthropic({
    apiKey: cfg.ANTHROPIC_API_KEY,
    timeout: 30_000,
    maxRetries: 2,
    defaultHeaders: cfg.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': cfg.ANTHROPIC_WORKSPACE_ID } : undefined,
  });
}

/** One structured-output call; maps API failures to messages the buyer can act on. */
async function parseWithClaude<T extends z.ZodType>(
  client: Anthropic,
  cfg: Config,
  schema: T,
  content: Anthropic.Beta.BetaContentBlockParam[],
  opts: { maxTokens: number; timeoutMs: number },
): Promise<{ output: z.infer<T>; model: string; inputTokens: number | null; outputTokens: number | null }> {
  let response;
  try {
    response = await client.beta.messages.parse(
      {
        model: cfg.CLAUDE_MODEL,
        max_tokens: opts.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort: cfg.CLAUDE_EFFORT, format: betaZodOutputFormat(schema) },
        // If a safety classifier declines, the API re-runs the request on its recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
      },
      { timeout: opts.timeoutMs },
    );
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(503, 'extraction_busy', 'Serviço de interpretação ocupado. Tente de novo em alguns segundos.');
    }
    if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
      throw new HttpError(503, 'extraction_unavailable', 'Serviço de interpretação indisponível. Tente de novo.');
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.BadRequestError) {
      // Configuration problem (key, workspace, model): logged by the error handler, shown to the buyer as unavailable.
      throw Object.assign(new HttpError(503, 'extraction_misconfigured', 'Interpretação automática indisponível no momento. Preencha manualmente.'), { cause: err });
    }
    throw err;
  }
  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'extraction_refused', 'Não foi possível interpretar esta mensagem. Preencha a cotação manualmente.');
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new HttpError(422, 'extraction_failed', 'A interpretação não terminou. Tente com um trecho menor da conversa.');
  }
  return {
    output: response.parsed_output as z.infer<T>,
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };
}

function claudeExtractor(cfg: Config): Extractor {
  const client = anthropicClient(cfg);
  return async (input) => {
    const started = Date.now();
    const files = input.attachments ?? [];
    // Files go before the text so the instructions about them read in order.
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...files.map((f): Anthropic.Beta.BetaContentBlockParam =>
        f.media_type === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name ?? undefined }
          : { type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } },
      ),
      { type: 'text', text: buildUserMessage(input) },
    ];
    // Price lists in PDFs can carry dozens of items.
    const r = await parseWithClaude(client, cfg, ExtractionOutput, content, {
      maxTokens: files.length ? 16000 : 8000,
      timeoutMs: files.length ? 90_000 : 30_000,
    });
    return { ...r, output: normalizeOutput(r.output), latencyMs: Date.now() - started };
  };
}

function claudeScanner(cfg: Config): Scanner {
  const client = anthropicClient(cfg);
  return async (input) => {
    const started = Date.now();
    const r = await parseWithClaude(client, cfg, ScanOutput, [{ type: 'text', text: buildScanMessage(input) }], { maxTokens: 16000, timeoutMs: 60_000 });
    return {
      proposals: r.output.propostas.map(normalizeOutput).filter((p) => p.itens.length),
      model: r.model,
      latencyMs: Date.now() - started,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    };
  };
}

/** Defensive cleanup; the schema already guarantees the shape. */
export function normalizeOutput(o: ExtractionOutput): ExtractionOutput {
  const clean = (s: string | null) => (s && s.trim() ? s.trim() : null);
  return {
    ...o,
    fornecedor_nome: clean(o.fornecedor_nome),
    prazo_entrega_texto: clean(o.prazo_entrega_texto),
    prazo_entrega_data: o.prazo_entrega_data && /^\d{4}-\d{2}-\d{2}$/.test(o.prazo_entrega_data) ? o.prazo_entrega_data : null,
    prazo_entrega_dias: o.prazo_entrega_dias != null && o.prazo_entrega_dias >= 0 ? Math.round(o.prazo_entrega_dias) : null,
    condicao_pagamento: clean(o.condicao_pagamento),
    validade_proposta: clean(o.validade_proposta),
    trecho_documento: clean(o.trecho_documento),
    mensagens_usadas: [...new Set(o.mensagens_usadas.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b),
    itens: o.itens
      // Keep items without a product name when they carry numbers: the buyer fills the name in.
      .filter((i) => (i.descricao ?? '').trim() || i.quantidade != null || i.valor_unitario != null || i.valor_total != null)
      .map((i) => ({ ...i, descricao: (i.descricao ?? '').trim(), marca: clean(i.marca), sku: clean(i.sku), unidade: clean(i.unidade) })),
  };
}

/**
 * Local stand-in used when no Anthropic key is configured (development and tests).
 * Handles simple one-item messages like "Consigo 30 fontes Microsemi por USD 111,46 cada. Prazo de 45 dias. Pagamento 28 dias."
 */
export const mockExtractor: Extractor = async ({ text, conversation, attachments }) => {
  const started = Date.now();
  // With a conversation and no selection, use the supplier's last message that carries a number.
  let used: number[] = [];
  if (!text.trim() && conversation?.length) {
    const idx = conversation
      .map((m, i) => ({ m, i }))
      .reverse()
      .find(({ m }) => m.direction === 'in' && /\d/.test(m.text))?.i;
    if (idx != null) {
      text = conversation[idx]!.text;
      used = [idx + 1];
    }
  }
  const t = text.replace(/\s+/g, ' ');
  const currency = /US\$|USD|d[óo]lar/i.test(t) ? 'USD' : /€|EUR|euro/i.test(t) ? 'EUR' : /R\$|reais/i.test(t) ? 'BRL' : null;
  const price = t.match(/(?:por|a|R\$|US\$|USD|EUR|€)\s*(?:R\$|US\$|USD|EUR|€)?\s*([\d.,]+\d)\s*(?:cada|a unidade|\/un|por unidade)?/i);
  const qty = t.match(/(\d+[\d.]*)\s+(un(?:idades?)?\s+(?:de\s+)?)?([a-zà-ú][\w\sà-ú-]*?)\s+(?:por|a)\s/i);
  const prazo = t.match(/prazo(?: de entrega)?(?: de)?\s*:?\s*(\d+)\s*dias/i);
  const pagamento = t.match(/pagamento\s*:?\s*([^.;]+)/i);
  const frete = /frete incluso|cif/i.test(t) ? 'CIF' : /fob|frete por (sua|conta)/i.test(t) ? 'FOB' : null;
  const desc = qty?.[3]?.trim();
  const items = desc
    ? [
        {
          descricao: desc.charAt(0).toUpperCase() + desc.slice(1).replace(/s(\s|$)/, '$1'),
          marca: desc.split(' ').length > 1 ? desc.split(' ').slice(1).join(' ') : null,
          sku: null,
          quantidade: parseDecimal(qty![1]),
          unidade: 'un',
          valor_unitario: price ? parseDecimal(price[1]) : null,
          valor_total: null,
        },
      ]
    : [];
  return {
    output: {
      fornecedor_nome: null,
      moeda: currency,
      prazo_entrega_dias: prazo ? Number(prazo[1]) : null,
      prazo_entrega_data: null,
      prazo_entrega_texto: prazo ? `${prazo[1]} dias` : null,
      condicao_pagamento: pagamento ? pagamento[1].trim() : null,
      frete_tipo: frete,
      frete_valor: null,
      validade_proposta: null,
      itens: items,
      campos_ambiguos: [],
      mensagens_usadas: used,
      trecho_documento: null,
      // The local heuristic cannot read files.
      ...(attachments?.length ? { campos_ambiguos: [{ campo: 'anexo', motivo: 'Leitura de PDF e imagem exige EXTRACTION_MODE=claude' }] } : {}),
    },
    model: 'mock',
    latencyMs: Date.now() - started,
    inputTokens: null,
    outputTokens: null,
  };
};

/** Local stand-in for the scanner: one proposal per priced supplier message. */
export const mockScanner: Scanner = async ({ conversation, contactName, today }) => {
  const started = Date.now();
  const proposals: ExtractionOutput[] = [];
  for (const [i, m] of conversation.entries()) {
    if (m.direction !== 'in' || !looksLikeProposal(m.text)) continue;
    const { output } = await mockExtractor({ text: m.text, contactName, today });
    if (output.itens.length) proposals.push({ ...output, mensagens_usadas: [i + 1] });
  }
  return { proposals, model: 'mock', latencyMs: Date.now() - started, inputTokens: null, outputTokens: null };
};
