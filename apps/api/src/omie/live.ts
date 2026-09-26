import type { OmiePaymentTermDTO, OmieProductDTO } from '@compras/shared';
import {
  OmieError,
  type OmieGateway,
  type OmieOrderInput,
  type OmiePurchaseOrderRecord,
  type OmieSupplierInput,
  type OmieSupplierRecord,
} from './gateway.js';

const BASE_URL = 'https://app.omie.com.br/api/v1/';
const PAGE_SIZE = 500;
const MAX_PAGES = 40;

type Fetch = typeof fetch;

/** Talks to the Omie REST API (POST JSON with call / app_key / app_secret / param). */
export class LiveOmie implements OmieGateway {
  readonly mode = 'live' as const;

  constructor(
    private appKey: string,
    private appSecret: string,
    private fetchImpl: Fetch = fetch,
    private log: (msg: string, data?: object) => void = () => {},
  ) {}

  async call<T>(path: string, call: string, param: object): Promise<T> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(BASE_URL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call, app_key: this.appKey, app_secret: this.appSecret, param: [param] }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.log('omie request failed', { path, call, error: String(err) });
      throw new OmieError('Não foi possível conectar ao Omie.', true);
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // Non-JSON body (gateway errors)
    }
    this.log('omie call', { path, call, status: res.status, ms: Date.now() - started });
    if (res.ok && !body.faultstring) return body as T;

    const fault = String(body.faultstring ?? `HTTP ${res.status}`);
    const retryable =
      res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504 ||
      /redundante|bloquead|tente novamente|timeout|temporariamente|limite/i.test(fault);
    throw new OmieError(fault.replace(/^ERROR:\s*/i, ''), retryable, body.faultcode ? String(body.faultcode) : undefined);
  }

  private static isEmptyPage(err: unknown) {
    return err instanceof OmieError && /n[ãa]o existem registros/i.test(err.message);
  }

  async testConnection() {
    try {
      await this.call('geral/parcelas/', 'ListarParcelas', { pagina: 1, registros_por_pagina: 1 });
    } catch (err) {
      if (LiveOmie.isEmptyPage(err)) return;
      throw err;
    }
  }

  async listProducts(): Promise<OmieProductDTO[]> {
    const out: OmieProductDTO[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      let body: { total_de_paginas?: number; produto_servico_cadastro?: Record<string, unknown>[] };
      try {
        body = await this.call('geral/produtos/', 'ListarProdutos', {
          pagina: page,
          registros_por_pagina: PAGE_SIZE,
          apenas_importado_api: 'N',
          filtrar_apenas_omiepdv: 'N',
        });
      } catch (err) {
        if (LiveOmie.isEmptyPage(err)) break;
        throw err;
      }
      for (const p of body.produto_servico_cadastro ?? []) {
        if (p.inativo === 'S') continue;
        out.push({
          omie_id: Number(p.codigo_produto),
          code: String(p.codigo ?? ''),
          description: String(p.descricao ?? ''),
          unit: p.unidade ? String(p.unidade) : null,
        });
      }
      if (!body.total_de_paginas || page >= body.total_de_paginas) break;
    }
    return out;
  }

  async listPaymentTerms(): Promise<OmiePaymentTermDTO[]> {
    const out: OmiePaymentTermDTO[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      let body: { total_de_paginas?: number; cadastros?: Record<string, unknown>[] };
      try {
        body = await this.call('geral/parcelas/', 'ListarParcelas', { pagina: page, registros_por_pagina: PAGE_SIZE });
      } catch (err) {
        if (LiveOmie.isEmptyPage(err)) break;
        throw err;
      }
      for (const p of body.cadastros ?? []) {
        out.push({
          code: String(p.nCodigo),
          description: String(p.cDescricao ?? p.nCodigo),
          installments: p.nParcelas != null ? Number(p.nParcelas) : null,
        });
      }
      if (!body.total_de_paginas || page >= body.total_de_paginas) break;
    }
    return out;
  }

  async listSuppliers(): Promise<OmieSupplierRecord[]> {
    const out: OmieSupplierRecord[] = [];
    for (let page = 1; page <= 100; page++) {
      let body: { total_de_paginas?: number; clientes_cadastro?: Record<string, unknown>[] };
      try {
        body = await this.call('geral/clientes/', 'ListarClientes', { pagina: page, registros_por_pagina: PAGE_SIZE, apenas_importado_api: 'N' });
      } catch (err) {
        if (LiveOmie.isEmptyPage(err)) break;
        throw err;
      }
      for (const c of body.clientes_cadastro ?? []) {
        if (c.inativo === 'S') continue;
        const phones = [
          [c.telefone1_ddd, c.telefone1_numero],
          [c.telefone2_ddd, c.telefone2_numero],
        ]
          .filter(([, n]) => n)
          .map(([ddd, n]) => ({ ddd: ddd ? String(ddd) : null, number: String(n) }));
        out.push({
          omie_id: Number(c.codigo_cliente_omie),
          name: decodeHtml(String(c.razao_social ?? c.nome_fantasia ?? '')),
          trade_name: c.nome_fantasia ? decodeHtml(String(c.nome_fantasia)) : null,
          cnpj: c.cnpj_cpf ? String(c.cnpj_cpf).replace(/\D/g, '') : null,
          phones,
          email: c.email ? String(c.email) : null,
          tags: Array.isArray(c.tags) ? (c.tags as { tag?: string }[]).map((t) => String(t.tag ?? '')).filter(Boolean) : [],
        });
      }
      if (!body.total_de_paginas || page >= body.total_de_paginas) break;
    }
    return out;
  }

  async listPurchaseOrders(from: string, to: string): Promise<OmiePurchaseOrderRecord[]> {
    const out: OmiePurchaseOrderRecord[] = [];
    for (let page = 1; page <= 200; page++) {
      let body: { nTotalPaginas?: number; pedidos_pesquisa?: Record<string, any>[] };
      try {
        body = await this.call('produtos/pedidocompra/', 'PesquisarPedCompra', {
          nPagina: page,
          nRegsPorPagina: 100,
          dDataInicial: from,
          dDataFinal: to,
          lExibirPedidosPendentes: true,
          lExibirPedidosFaturados: true,
          lExibirPedidosRecebidos: true,
          lExibirPedidosEncerrados: true,
          lExibirPedidosRecParciais: true,
          lExibirPedidosFatParciais: true,
          lExibirPedidosCancelados: false,
        });
      } catch (err) {
        if (LiveOmie.isEmptyPage(err)) break;
        throw err;
      }
      for (const p of body.pedidos_pesquisa ?? []) {
        const h = p.cabecalho_consulta ?? {};
        out.push({
          omie_id: Number(h.nCodPed),
          number: h.cNumero ? String(h.cNumero) : null,
          supplier_omie_id: Number(h.nCodFor),
          created_on: String(h.dIncData ?? ''),
          stage: h.cEtapa ? String(h.cEtapa) : null,
          freight: Number(p.frete_consulta?.nValFrete ?? 0),
          items: ((p.produtos_consulta ?? []) as Record<string, any>[]).map((i) => ({
            omie_product_id: i.nCodProd ? Number(i.nCodProd) : null,
            description: cleanDescription(decodeHtml(String(i.cDescricao ?? ''))),
            quantity: Number(i.nQtde ?? 0),
            unit_price: Number(i.nValUnit ?? 0),
            total: Number(i.nValTot ?? i.nValMerc ?? 0),
          })),
        });
      }
      if (!body.nTotalPaginas || page >= body.nTotalPaginas) break;
    }
    return out;
  }

  async findSupplierByCnpj(cnpj: string): Promise<number | null> {
    try {
      const body = await this.call<{ clientes_cadastro?: { codigo_cliente_omie: number }[] }>('geral/clientes/', 'ListarClientes', {
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: 'N',
        clientesFiltro: { cnpj_cpf: cnpj },
      });
      return body.clientes_cadastro?.[0]?.codigo_cliente_omie ?? null;
    } catch (err) {
      if (LiveOmie.isEmptyPage(err)) return null;
      throw err;
    }
  }

  async createSupplier(input: OmieSupplierInput): Promise<number> {
    const local = input.phone?.startsWith('+55') ? input.phone.slice(3) : null;
    const body = await this.call<{ codigo_cliente_omie: number }>('geral/clientes/', 'UpsertCliente', {
      codigo_cliente_integracao: input.integrationCode,
      razao_social: input.name.slice(0, 60),
      nome_fantasia: input.name.slice(0, 100),
      cnpj_cpf: input.cnpj,
      email: input.email ?? '',
      ...(local && local.length >= 10 ? { telefone1_ddd: local.slice(0, 2), telefone1_numero: local.slice(2) } : {}),
      tags: [{ tag: 'Fornecedor' }],
    });
    return Number(body.codigo_cliente_omie);
  }

  async updateSupplierPhone(omieId: number, phone: string) {
    const digits = phone.replace(/\D/g, '');
    const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
    if (local.length < 10) throw new OmieError('Telefone inválido', false);
    await this.call('geral/clientes/', 'AlterarCliente', {
      codigo_cliente_omie: omieId,
      telefone1_ddd: local.slice(0, 2),
      telefone1_numero: local.slice(2),
    });
  }

  async upsertPurchaseOrder(input: OmieOrderInput) {
    const body = await this.call<{ nCodPed: number; cNumero?: string }>('produtos/pedidocompra/', 'UpsertPedCompra', {
      cabecalho_upsert: {
        cCodIntPed: input.cCodIntPed,
        nCodFor: input.nCodFor,
        cCodParc: input.cCodParc,
        ...(input.nQtdeParc ? { nQtdeParc: input.nQtdeParc } : {}),
        ...(input.dDtPrevisao ? { dDtPrevisao: input.dDtPrevisao } : {}),
        ...(input.cContato ? { cContato: input.cContato.slice(0, 100) } : {}),
        cObs: input.cObs,
      },
      ...(input.freight && (input.freight.cTpFrete || input.freight.nValFrete)
        ? {
            frete_upsert: {
              ...(input.freight.cTpFrete ? { cTpFrete: input.freight.cTpFrete } : {}),
              ...(input.freight.nValFrete ? { nValFrete: input.freight.nValFrete } : {}),
            },
          }
        : {}),
      produtos_upsert: input.items,
    });
    return { nCodPed: Number(body.nCodPed), cNumero: body.cNumero ?? null };
  }
}

/** Omie returns some text HTML-escaped ("NORONHA &amp; NORONHA"). */
export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Drops Omie's variant markers: "Câmera Dahua   [spec]Resol. 4MP [est]ops" -> "Câmera Dahua". */
export function cleanDescription(s: string): string {
  return s.split(/\s*\[(?:spec|est)\]/i)[0]!.replace(/\s+/g, ' ').trim();
}
