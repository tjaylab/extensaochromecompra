import PDFDocument from 'pdfkit';
import { eq } from 'drizzle-orm';
import { formatCnpj, formatDecimal, formatMoney, isoToBr, ORDER_STATUS_LABEL, type OrderDTO } from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { companies } from '../db/schema.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { logEvent } from './events.js';
import { getOrder } from './orders.js';

// ProcureMate colors (Azul Parceiro, Grafite Profundo, muted, lines).
const BLUE = '#2563EB';
const INK = '#172033';
const MUTED = '#5B6478';
const LINE = '#E2E8F0';

export function orderFileName(o: OrderDTO) {
  return `Pedido-${o.number}${o.omie_number ? `-Omie-${o.omie_number}` : ''}.pdf`;
}

/** The purchase order as a PDF the buyer can drop in the WhatsApp conversation or e-mail to the supplier. */
export async function renderOrderPdf(ctx: AppContext, member: Member, id: string): Promise<{ file: Buffer; name: string; order: OrderDTO }> {
  const o = await getOrder(ctx, member, id);
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, member.companyId)).limit(1);
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Pedido de compra ${o.number}`, Author: company?.name ?? 'ProcureMate' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = 48;
  const width = doc.page.width - 96;
  const money = (v: number | null | undefined) => formatMoney(v ?? null, 'BRL');

  // Header band
  doc.rect(0, 0, doc.page.width, 92).fill(BLUE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('Pedido de compra', left, 28);
  doc.font('Helvetica').fontSize(11).text(`${o.number}${o.omie_number ? `  ·  Omie nº ${o.omie_number}` : ''}`, left, 56);
  doc.fontSize(10).text(company?.name ?? '', left, 30, { width, align: 'right' });
  if (company?.cnpj) doc.text(`CNPJ ${formatCnpj(company.cnpj)}`, left, 44, { width, align: 'right' });
  doc.text(`Emitido em ${isoToBr((o.sent_at ?? o.created_at).slice(0, 10))}`, left, 58, { width, align: 'right' });

  // Supplier and conditions
  let y = 116;
  const label = (t: string, x: number, yy: number) => doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(t.toUpperCase(), x, yy, { characterSpacing: 0.6 });
  const value = (t: string, x: number, yy: number, w: number) => doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(t, x, yy, { width: w });
  label('Fornecedor', left, y);
  value(o.supplier.name, left, y + 12, width / 2 - 12);
  if (o.supplier.cnpj) value(`CNPJ ${formatCnpj(o.supplier.cnpj)}`, left, y + 27, width / 2 - 12);
  const colR = left + width / 2 + 12;
  label('Status', colR, y);
  value(ORDER_STATUS_LABEL[o.status], colR, y + 12, width / 2 - 12);
  label('Cotação de origem', colR, y + 34);
  value(`${o.quote.number}${o.requisition ? ` · ${o.requisition.number} ${o.requisition.title}` : ''}`, colR, y + 46, width / 2 - 12);

  y += 84;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(LINE).stroke();
  y += 14;

  // Items
  const cols = [
    { title: 'Item', x: left, w: 26, align: 'left' as const },
    { title: 'Produto', x: left + 26, w: width - 26 - 70 - 90 - 90, align: 'left' as const },
    { title: 'Qtd', x: left + width - 250, w: 70, align: 'right' as const },
    { title: 'Valor unit.', x: left + width - 180, w: 90, align: 'right' as const },
    { title: 'Total', x: left + width - 90, w: 90, align: 'right' as const },
  ];
  cols.forEach((c) => label(c.title, c.x, y));
  y += 16;
  const fx = o.quote.currency === 'BRL' ? 1 : (o.exchange_rate ?? null);
  o.items.forEach((it, i) => {
    const unitBrl = fx ? it.unit_price * fx : null;
    const name = it.omie_product_label ? `${it.description}\n${it.omie_product_label}` : it.description;
    const h = Math.max(doc.heightOfString(name, { width: cols[1]!.w }), 14);
    doc.fillColor(INK).font('Helvetica').fontSize(10);
    doc.text(String(i + 1), cols[0]!.x, y, { width: cols[0]!.w });
    doc.text(name, cols[1]!.x, y, { width: cols[1]!.w });
    doc.text(`${formatDecimal(it.quantity)} ${it.unit ?? ''}`.trim(), cols[2]!.x, y, { width: cols[2]!.w, align: 'right' });
    doc.text(unitBrl != null ? money(unitBrl) : formatMoney(it.unit_price, o.quote.currency), cols[3]!.x, y, { width: cols[3]!.w, align: 'right' });
    doc.text(unitBrl != null ? money(unitBrl * it.quantity) : formatMoney(it.unit_price * it.quantity, o.quote.currency), cols[4]!.x, y, { width: cols[4]!.w, align: 'right' });
    y += h + 8;
    doc.moveTo(left, y - 4).lineTo(left + width, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  });

  // Total
  y += 6;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(`Total ${o.total_brl != null ? money(o.total_brl) : formatMoney(o.total_original, o.quote.currency)}`, left, y, { width, align: 'right' });
  if (o.quote.currency !== 'BRL' && o.exchange_rate) {
    y += 16;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Cotação original ${formatMoney(o.total_original, o.quote.currency)} · taxa ${formatDecimal(o.exchange_rate)}`, left, y, { width, align: 'right' });
  }

  // Conditions
  y += 34;
  const delivery = o.quote.delivery_date ? isoToBr(o.quote.delivery_date) : o.quote.delivery_days != null ? `${o.quote.delivery_days} dias` : 'A combinar';
  const conditions: [string, string][] = [
    ['Prazo de entrega', delivery],
    ['Condição de pagamento', [o.payment_term_code, o.quote.payment_terms_text].filter(Boolean).join(' · ') || 'A combinar'],
    ['Frete', o.quote.freight_type ? `${o.quote.freight_type}${o.quote.freight_value != null ? ` · ${formatMoney(o.quote.freight_value, o.quote.currency)}` : ''}` : 'Não informado'],
  ];
  conditions.forEach(([k, v], i) => {
    const x = left + (width / 3) * i;
    label(k, x, y);
    value(v, x, y + 12, width / 3 - 12);
  });

  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Gerado pelo ProcureMate', left, doc.page.height - 60, { width, align: 'center' });
  doc.end();
  return { file: await done, name: orderFileName(o), order: o };
}

/** E-mails the order PDF to the supplier (Resend). Without e-mail configured, the panel falls back to mailto. */
export async function emailOrder(ctx: AppContext, member: Member, id: string, input: { to: string; message?: string | null }) {
  if (!ctx.cfg.RESEND_API_KEY || !ctx.cfg.EMAIL_FROM) {
    throw new HttpError(409, 'email_not_configured', 'Envio de e-mail não configurado no servidor.');
  }
  const to = input.to.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw badRequest('E-mail do fornecedor inválido');
  const { file, name, order } = await renderOrderPdf(ctx, member, id);
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, member.companyId)).limit(1);
  const text = [
    input.message?.trim() || `Olá, segue o pedido de compra ${order.number}${order.omie_number ? ` (Omie nº ${order.omie_number})` : ''}.`,
    '',
    `Total: ${order.total_brl != null ? formatMoney(order.total_brl, 'BRL') : formatMoney(order.total_original, order.quote.currency)}`,
    '',
    company?.name ?? '',
  ].join('\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.cfg.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ctx.cfg.EMAIL_FROM,
      to: [to],
      reply_to: member.email,
      subject: `Pedido de compra ${order.number}${company?.name ? ` · ${company.name}` : ''}`,
      text,
      attachments: [{ filename: name, content: file.toString('base64') }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    ctx.log.warn({ status: res.status, body: (await res.text()).slice(0, 300) }, 'order e-mail failed');
    throw new HttpError(502, 'email_failed', 'Não foi possível enviar o e-mail. Tente de novo ou envie pelo seu e-mail.');
  }
  await logEvent(ctx, { companyId: member.companyId, userId: member.userId, type: 'order_emailed', entityId: id, data: { to } });
  return { sent: true, to };
}
