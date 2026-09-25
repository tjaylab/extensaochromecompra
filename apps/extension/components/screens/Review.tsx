import { useEffect, useMemo, useState } from 'react';
import {
  brToIso,
  formatConversation,
  formatMoney,
  isoToBr,
  parseDecimal,
  todayIso,
  type CreateQuoteInput,
  type Currency,
  type ExtractionResponse,
  type RequisitionDTO,
  type SupplierDTO,
  type Attachment,
} from '@compras/shared';
import { api } from '../../lib/api';
import type { Capture } from '../../lib/capture';
import { ErrorBanner, Field, Icon, Screen, Spinner, useNav } from '../ui';

interface ItemForm {
  description: string;
  brand: string;
  sku: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

interface Form {
  supplierMode: 'new' | 'existing';
  supplierId: string;
  newName: string;
  newPhone: string;
  currency: Currency;
  delivery_days: string;
  delivery_date: string;
  delivery_text: string;
  payment_terms_text: string;
  freight_type: '' | 'CIF' | 'FOB';
  freight_value: string;
  validity_text: string;
  quote_date: string;
  requisition_id: string; // '' none, '__new' create
  new_requisition_title: string;
  items: ItemForm[];
}

const num = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
// Prices with two decimals ("589,90"), no thousands separator so the field stays easy to edit.
const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });
const blankItem = (): ItemForm => ({ description: '', brand: '', sku: '', quantity: '', unit: 'un', unit_price: '' });
const missing = (v: string) => (v.trim() ? 'input' : 'input missing');

function companyFromContact(name: string | null) {
  if (!name) return '';
  const m = name.match(/\(([^)]+)\)/);
  return m?.[1] ?? name;
}

function formFromExtraction(ex: ExtractionResponse | null, capture: Capture): Form {
  const d = ex?.data;
  const match = ex?.supplier_match.supplier;
  return {
    supplierMode: match ? 'existing' : 'new',
    supplierId: match?.id ?? '',
    newName: d?.fornecedor_nome ?? companyFromContact(capture.contactName),
    newPhone: capture.contactPhone ?? '',
    currency: d?.moeda ?? 'BRL',
    delivery_days: d?.prazo_entrega_dias != null ? String(d.prazo_entrega_dias) : '',
    delivery_date: d?.prazo_entrega_data ? isoToBr(d.prazo_entrega_data) : '',
    delivery_text: d?.prazo_entrega_texto ?? '',
    payment_terms_text: d?.condicao_pagamento ?? '',
    freight_type: d?.frete_tipo ?? '',
    freight_value: money(d?.frete_valor),
    validity_text: d?.validade_proposta ?? '',
    quote_date: isoToBr(todayIso()),
    requisition_id: '',
    new_requisition_title: '',
    items: d?.itens.length
      ? d.itens.map((i) => ({
          description: i.descricao,
          brand: i.marca ?? '',
          sku: i.sku ?? '',
          quantity: num(i.quantidade),
          unit: i.unidade ?? 'un',
          // Only a total was given: leave the unit price for the buyer, with the total as a hint.
          unit_price: money(i.valor_unitario ?? (i.valor_total != null && i.quantidade ? i.valor_total / i.quantidade : null)),
        }))
      : [blankItem()],
  };
}

export function Review({ capture }: { capture: Capture & { origin: 'whatsapp' | 'manual' } }) {
  const nav = useNav();
  const [phase, setPhase] = useState<'extracting' | 'form' | 'failed'>('extracting');
  const [ex, setEx] = useState<ExtractionResponse | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => formFromExtraction(null, capture));
  const [requisitions, setRequisitions] = useState<RequisitionDTO[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierDTO[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());

  const extract = () => {
    setPhase('extracting');
    setExtractError(null);
    api
      .extract({
        text: capture.text,
        conversation: capture.conversation,
        attachments: capture.attachments,
        contact_name: capture.contactName,
        contact_phone: capture.contactPhone,
      })
      .then((r) => {
        setEx(r);
        setForm(formFromExtraction(r, capture));
        setPhase('form');
        api.event('extraction_viewed', r.extraction_id);
      })
      .catch((e) => {
        setExtractError(e.message);
        setPhase('failed');
      });
  };

  useEffect(() => {
    extract();
    api.requisitions('open').then(setRequisitions).catch(() => {});
    api.suppliers().then(setSuppliers).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (idx: number, k: keyof ItemForm, v: string) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)) }));

  const totals = form.items.map((i) => {
    const q = parseDecimal(i.quantity);
    const u = parseDecimal(i.unit_price);
    return q != null && u != null ? q * u : null;
  });
  const total = totals.reduce<number>((a, t) => a + (t ?? 0), 0);
  const elapsed = Math.max(0, Math.floor((now - capture.capturedAt) / 1000));
  // What the quote preserves: the API's excerpt (selection or the messages used), else what was captured.
  const files = capture.attachments ?? [];
  const sourceText =
    ex?.source_text ||
    [files.map((f) => `Arquivo: ${f.name ?? f.media_type}`).join('\n'), capture.text, capture.conversation?.length ? formatConversation(capture.conversation) : '']
      .filter(Boolean)
      .join('\n\n');
  const noProposal = phase === 'form' && capture.mode !== 'selection' && ex && ex.data.itens.length === 0;
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  const missingCount = useMemo(() => {
    if (phase !== 'form') return 0;
    const header = [form.delivery_days || form.delivery_date, form.payment_terms_text, form.freight_type, form.validity_text].filter((v) => !v.trim()).length;
    const items = form.items.reduce((a, i) => a + [i.description, i.quantity, i.unit_price, i.sku, i.brand].filter((v) => !v.trim()).length, 0);
    return header + items;
  }, [form, phase]);

  const validate = (): CreateQuoteInput | null => {
    const e: Record<string, string> = {};
    if (form.supplierMode === 'new' && !form.newName.trim()) e.supplier = 'Informe o nome do fornecedor';
    if (form.supplierMode === 'existing' && !form.supplierId) e.supplier = 'Escolha o fornecedor';
    const quoteDate = brToIso(form.quote_date);
    if (!quoteDate) e.quote_date = 'Use DD/MM/AAAA';
    if (form.delivery_date && !brToIso(form.delivery_date)) e.delivery_date = 'Use DD/MM/AAAA';
    const days = form.delivery_days.trim() ? Number(form.delivery_days) : null;
    if (days != null && (!Number.isInteger(days) || days < 0)) e.delivery_days = 'Número de dias inteiro';
    const freightValue = form.freight_value.trim() ? parseDecimal(form.freight_value) : null;
    if (form.freight_value.trim() && freightValue == null) e.freight_value = 'Valor inválido';
    if (form.requisition_id === '__new' && !form.new_requisition_title.trim()) e.requisition = 'Dê um título para a nova requisição';
    const items = form.items.map((i, idx) => {
      const quantity = parseDecimal(i.quantity);
      const unitPrice = parseDecimal(i.unit_price);
      if (!i.description.trim()) e[`item${idx}.description`] = 'Informe o produto';
      if (quantity == null || quantity <= 0) e[`item${idx}.quantity`] = 'Quantidade inválida';
      if (unitPrice == null || unitPrice < 0) e[`item${idx}.unit_price`] = 'Valor inválido';
      return { description: i.description, brand: i.brand || null, sku: i.sku || null, quantity: quantity ?? 0, unit: i.unit || null, unit_price: unitPrice ?? 0 };
    });
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      extraction_id: ex?.extraction_id ?? null,
      supplier: form.supplierMode === 'existing' ? { id: form.supplierId } : { new: { name: form.newName.trim(), phone: form.newPhone || null } },
      requisition_id: form.requisition_id && form.requisition_id !== '__new' ? form.requisition_id : null,
      currency: form.currency,
      delivery_days: days,
      delivery_date: form.delivery_date || null,
      delivery_text: form.delivery_text || null,
      payment_terms_text: form.payment_terms_text || null,
      freight_type: form.freight_type || null,
      freight_value: freightValue,
      validity_text: form.validity_text || null,
      quote_date: quoteDate!,
      source_text: sourceText,
      origin: capture.origin,
      registration_ms: Date.now() - capture.capturedAt,
      items,
    };
  };

  const save = async () => {
    const payload = validate();
    if (!payload) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (form.requisition_id === '__new') {
        const req = await api.createRequisition({ title: form.new_requisition_title.trim(), items: [] });
        payload.requisition_id = req.id;
      }
      const q = await api.createQuote(payload);
      const secs = Math.round((payload.registration_ms ?? 0) / 1000);
      nav.replace({ name: 'quotes', flash: `Cotação ${q.number} salva${capture.origin === 'whatsapp' ? ` em ${secs} s` : ''}. Texto original preservado.` });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    api.event('quote_form_cancelled', ex?.extraction_id);
    nav.back();
  };

  if (phase === 'extracting') {
    return (
      <Screen title="Registrar cotação">
        <Spinner
          label={
            capture.mode === 'file'
              ? `Lendo ${files.length > 1 ? `${files.length} arquivos` : files[0]?.media_type === 'application/pdf' ? 'o PDF' : 'a imagem'}… pode levar até 30 s`
              : capture.mode === 'conversation'
                ? `Lendo ${capture.conversation?.length ?? 0} mensagens da conversa…`
                : 'Interpretando a mensagem…'
          }
        />
        <AttachmentList files={files} />
        <div className="source">{capture.text || formatConversation(capture.conversation ?? []).split('\n').slice(-4).join('\n')}</div>
        <div className="stack">
          {[60, 45, 52].map((w) => (
            <div key={w} className="stack" style={{ gap: 6 }}>
              <div className="skeleton" style={{ height: 12, width: `${w}%` }} />
              <div className="skeleton" style={{ height: 40 }} />
            </div>
          ))}
        </div>
      </Screen>
    );
  }

  const supplierMatch = ex?.supplier_match;

  return (
    <Screen
      title="Conferir cotação"
      footer={
        <>
          <div className="grow">
            <span className="small muted">Total da cotação</span>
            <span className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{formatMoney(total, form.currency)}</span>
          </div>
          <span className="mono small muted" aria-label="Tempo desde a captura">{timer}</span>
          <button type="button" className="btn btn-secondary" onClick={cancel}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar cotação'}</button>
        </>
      }
    >
      {phase === 'failed' ? (
        <ErrorBanner message={`${extractError} Você pode tentar de novo ou preencher os campos manualmente.`} onRetry={extract} />
      ) : (
        <div className="banner banner-warn" role="note">
          <Icon name="warn" />
          <div className="stack" style={{ gap: 4 }}>
            <strong>Informações extraídas automaticamente. Confira antes de salvar.</strong>
            <span className="small">
              {missingCount ? `${missingCount} campo(s) não identificados na mensagem estão destacados.` : 'Todos os campos principais foram identificados.'}
            </span>
            {ex?.data.campos_ambiguos.map((a) => (
              <span key={a.campo} className="small">• {a.campo}: {a.motivo}</span>
            ))}
          </div>
        </div>
      )}
      {saveError && <ErrorBanner message={saveError} />}
      {noProposal && (
        <div className="banner banner-info">
          Não encontrei uma proposta com preço nas últimas mensagens. Se ela for mais antiga, role a conversa para cima e tente de novo, ou selecione o texto da proposta.
        </div>
      )}

      <div className="stack">
        <span className="section-label">
          {capture.mode === 'file'
            ? 'Arquivo e trecho usados'
            : capture.mode === 'conversation'
              ? 'Mensagens usadas · WhatsApp'
              : `Texto original · ${capture.origin === 'whatsapp' ? 'WhatsApp' : 'colado'}`}
        </span>
        <AttachmentList files={files} />
        <div className="source">{sourceText}</div>
        {!!capture.conversation?.length && (
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Ver as {capture.conversation.length} mensagens lidas da conversa</summary>
            <div className="source small" style={{ marginTop: 8, maxHeight: 240, overflow: 'auto' }}>{formatConversation(capture.conversation)}</div>
          </details>
        )}
      </div>

      <section className="stack" aria-labelledby="sup-label">
        <span id="sup-label" className="section-label">Fornecedor</span>
        {(capture.contactName || capture.contactPhone) && (
          <span className="small muted">
            Contato: {[capture.contactName, capture.contactPhone].filter(Boolean).join(' · ')}
            {supplierMatch?.reason === 'phone' && ' · reconhecido pelo telefone'}
            {supplierMatch?.reason === 'name' && ' · reconhecido pelo nome'}
          </span>
        )}
        <div className="row">
          <button type="button" className="seg" aria-pressed={form.supplierMode === 'new'} onClick={() => set('supplierMode', 'new')}>Criar novo</button>
          <button type="button" className="seg" aria-pressed={form.supplierMode === 'existing'} onClick={() => set('supplierMode', 'existing')}>Vincular existente</button>
        </div>
        {form.supplierMode === 'new' ? (
          <>
            <Field id="sup-name" label="Nome do fornecedor" error={errors.supplier} hint="Será criado ao salvar. CNPJ só é pedido ao gerar o pedido no Omie.">
              <input id="sup-name" className={missing(form.newName)} value={form.newName} onChange={(e) => set('newName', e.target.value)} placeholder="Não identificado" />
            </Field>
            {!!supplierMatch?.suggestions.length && (
              <div className="row wrap">
                <span className="small muted">Parecidos:</span>
                {supplierMatch.suggestions.map((s) => (
                  <button key={s.id} type="button" className="chip" onClick={() => setForm((f) => ({ ...f, supplierMode: 'existing', supplierId: s.id }))}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <Field id="sup-existing" label="Fornecedor cadastrado" error={errors.supplier}>
            <select id="sup-existing" className="select" value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
              <option value="">Selecione…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        )}
      </section>

      {form.items.map((item, idx) => (
        <section key={idx} className="card" aria-label={`Item ${idx + 1}`}>
          <div className="row-between">
            <span className="section-label">Item {idx + 1}</span>
            <div className="row">
              <span className="small muted">Total <strong className="mono" style={{ color: 'var(--ink)' }}>{formatMoney(totals[idx], form.currency)}</strong></span>
              {form.items.length > 1 && (
                <button type="button" className="icon-btn" aria-label={`Remover item ${idx + 1}`} onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="grid2">
            <Field id={`i${idx}-desc`} label="Produto" className="span2" error={errors[`item${idx}.description`]}>
              <input id={`i${idx}-desc`} className={missing(item.description)} value={item.description} onChange={(e) => setItem(idx, 'description', e.target.value)} placeholder="Não identificado" />
            </Field>
            <Field id={`i${idx}-brand`} label="Marca / fabricante">
              <input id={`i${idx}-brand`} className={missing(item.brand)} value={item.brand} onChange={(e) => setItem(idx, 'brand', e.target.value)} placeholder="Não identificado" />
            </Field>
            <Field id={`i${idx}-sku`} label="SKU / part number">
              <input id={`i${idx}-sku`} className={missing(item.sku)} value={item.sku} onChange={(e) => setItem(idx, 'sku', e.target.value)} placeholder="Não identificado" />
            </Field>
            <Field id={`i${idx}-qty`} label="Quantidade" error={errors[`item${idx}.quantity`]}>
              <input id={`i${idx}-qty`} className={missing(item.quantity)} inputMode="decimal" value={item.quantity} onChange={(e) => setItem(idx, 'quantity', e.target.value)} placeholder="Não identificado" />
            </Field>
            <Field id={`i${idx}-unit`} label="Unidade">
              <input id={`i${idx}-unit`} className="input" value={item.unit} onChange={(e) => setItem(idx, 'unit', e.target.value)} />
            </Field>
            <Field id={`i${idx}-price`} label={`Valor unitário (${form.currency})`} className="span2" error={errors[`item${idx}.unit_price`]}>
              <input id={`i${idx}-price`} className={missing(item.unit_price)} inputMode="decimal" value={item.unit_price} onChange={(e) => setItem(idx, 'unit_price', e.target.value)} placeholder="Não identificado" />
            </Field>
          </div>
        </section>
      ))}
      <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', borderStyle: 'dashed' }} onClick={() => setForm((f) => ({ ...f, items: [...f.items, blankItem()] }))}>
        <Icon name="plus" size={16} /> Adicionar item
      </button>

      <section className="stack" aria-labelledby="cond-label">
        <span id="cond-label" className="section-label">Condições</span>
        <div className="grid2">
          <Field id="currency" label="Moeda">
            <select id="currency" className="select" value={form.currency} onChange={(e) => set('currency', e.target.value as Currency)}>
              <option value="BRL">BRL · Real</option>
              <option value="USD">USD · Dólar</option>
              <option value="EUR">EUR · Euro</option>
            </select>
          </Field>
          <Field id="quote-date" label="Data da cotação" error={errors.quote_date}>
            <input id="quote-date" className="input" value={form.quote_date} onChange={(e) => set('quote_date', e.target.value)} />
          </Field>
          <Field id="days" label="Prazo de entrega (dias)" error={errors.delivery_days} hint={form.delivery_text && !(form.delivery_days && form.delivery_text.includes(form.delivery_days)) ? `Na mensagem: "${form.delivery_text}"` : undefined}>
            <input id="days" className={missing(form.delivery_days || form.delivery_date)} inputMode="numeric" value={form.delivery_days} onChange={(e) => set('delivery_days', e.target.value)} placeholder="Não identificado" />
          </Field>
          <Field id="ddate" label="ou data de entrega" error={errors.delivery_date}>
            <input id="ddate" className="input" value={form.delivery_date} onChange={(e) => set('delivery_date', e.target.value)} placeholder="DD/MM/AAAA" />
          </Field>
          <Field id="pay" label="Condição de pagamento" className="span2">
            <input id="pay" className={missing(form.payment_terms_text)} value={form.payment_terms_text} onChange={(e) => set('payment_terms_text', e.target.value)} placeholder="Não identificado" />
          </Field>
          <Field id="freight" label="Frete">
            <select id="freight" className={form.freight_type ? 'select' : 'select missing'} value={form.freight_type} onChange={(e) => set('freight_type', e.target.value as Form['freight_type'])}>
              <option value="">Não informado</option>
              <option value="CIF">CIF (fornecedor paga)</option>
              <option value="FOB">FOB (por nossa conta)</option>
            </select>
          </Field>
          <Field id="freight-value" label={`Valor do frete (${form.currency})`} error={errors.freight_value}>
            <input id="freight-value" className="input" inputMode="decimal" value={form.freight_value} onChange={(e) => set('freight_value', e.target.value)} placeholder="Opcional" />
          </Field>
          <Field id="validity" label="Validade da proposta" className="span2">
            <input id="validity" className={missing(form.validity_text)} value={form.validity_text} onChange={(e) => set('validity_text', e.target.value)} placeholder="Não identificado" />
          </Field>
        </div>
      </section>

      <section className="stack">
        <Field id="req" label="Requisição" error={errors.requisition} hint="Vincule para comparar com outras propostas. Dá para vincular depois.">
          <select id="req" className="select" value={form.requisition_id} onChange={(e) => set('requisition_id', e.target.value)}>
            <option value="">Sem requisição (vincular depois)</option>
            {requisitions.map((r) => (
              <option key={r.id} value={r.id}>{r.number} · {r.title}</option>
            ))}
            <option value="__new">+ Nova requisição…</option>
          </select>
        </Field>
        {form.requisition_id === '__new' && (
          <Field id="req-title" label="Título da nova requisição">
            <input id="req-title" className="input" value={form.new_requisition_title} onChange={(e) => set('new_requisition_title', e.target.value)} placeholder="ex.: Fontes 24V industriais" />
          </Field>
        )}
      </section>
    </Screen>
  );
}

function AttachmentList({ files }: { files: Attachment[] }) {
  if (!files.length) return null;
  return (
    <div className="stack">
      {files.map((f, i) =>
        f.media_type === 'application/pdf' ? (
          <div key={i} className="row card" style={{ padding: '10px 12px' }}>
            <span className="badge badge-info">PDF</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name ?? 'documento.pdf'}</span>
          </div>
        ) : (
          <img
            key={i}
            src={`data:${f.media_type};base64,${f.data}`}
            alt={f.name ? `Anexo ${f.name}` : 'Imagem anexada'}
            style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--line)', background: '#fff' }}
          />
        ),
      )}
    </div>
  );
}
