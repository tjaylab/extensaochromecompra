import PDFDocument from 'pdfkit';
import { eq } from 'drizzle-orm';
import { formatCnpj, formatDecimal, formatMoney, isoToBr, QUOTE_STATUS_LABEL, type ComparisonDTO, type QuoteDTO } from '@compras/shared';
import type { AppContext, Member } from '../context.js';
import { companies } from '../db/schema.js';
import { getComparison } from './requisitions.js';

// Same visual identity as the order PDF.
const BLUE = '#2563EB';
const INK = '#172033';
const MUTED = '#5B6478';
const LINE = '#E2E8F0';
const SELECTED_BG = '#EFF6FF';

/** Proposals per page: more than this and the table continues on the next page. */
const PER_PAGE = 4;

function delivery(q: QuoteDTO) {
  if (q.delivery_date) return isoToBr(q.delivery_date);
  if (q.delivery_days != null) return q.delivery_days === 0 ? 'Pronta entrega' : `${q.delivery_days} dias`;
  return q.delivery_text ?? 'Não informado';
}

const ROWS: { label: string; value: (q: QuoteDTO) => string }[] = [
  { label: 'Itens', value: (q) => q.items.map((i) => `${formatDecimal(i.quantity)} ${i.unit ?? ''} × ${i.description}`.replace(/\s+/g, ' ').trim()).join('\n') },
  { label: 'Valor unitário', value: (q) => q.items.map((i) => formatMoney(i.unit_price, q.currency)).join('\n') },
  { label: 'Valor total', value: (q) => formatMoney(q.total, q.currency) },
  { label: 'Prazo de entrega', value: delivery },
  { label: 'Pagamento', value: (q) => q.payment_terms_text ?? 'Não informado' },
  { label: 'Frete', value: (q) => (q.freight_type ? `${q.freight_type}${q.freight_value != null ? ` · ${formatMoney(q.freight_value, q.currency)}` : ''}` : 'Não informado') },
  { label: 'Validade', value: (q) => q.validity_text ?? 'Não informada' },
  { label: 'Data da cotação', value: (q) => isoToBr(q.quote_date) },
  { label: 'Status', value: (q) => QUOTE_STATUS_LABEL[q.status] },
];

export function comparisonFileName(c: ComparisonDTO) {
  const slug = c.requisition.title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `Comparativo-${c.requisition.number}${slug ? `-${slug}` : ''}.pdf`;
}

/** The comparison as a landscape PDF: one column per proposal, the chosen one highlighted. */
export async function renderComparisonPdf(ctx: AppContext, member: Member, id: string): Promise<{ file: Buffer; name: string }> {
  const c = await getComparison(ctx, member, id);
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, member.companyId)).limit(1);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, info: { Title: `Comparativo ${c.requisition.number}`, Author: company?.name ?? 'ProcureMate' } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = 40;
  const width = doc.page.width - 80;
  const labelW = 120;
  const groups: (typeof c.quotes)[] = [];
  for (let i = 0; i < Math.max(1, c.quotes.length); i += PER_PAGE) groups.push(c.quotes.slice(i, i + PER_PAGE));

  // Lowest total per currency (values are never converted between currencies).
  const best = new Map<string, number>();
  for (const q of c.quotes) best.set(q.currency, Math.min(best.get(q.currency) ?? Infinity, q.total));

  groups.forEach((group, page) => {
    if (page > 0) doc.addPage();
    // Header band
    doc.rect(0, 0, doc.page.width, 78).fill(BLUE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text('Comparativo de propostas', left, 22);
    doc.font('Helvetica').fontSize(11).text(`${c.requisition.number}  ·  ${c.requisition.title}`, left, 48, { width: width - 220 });
    doc.fontSize(9.5).text(company?.name ?? '', left, 24, { width, align: 'right' });
    if (company?.cnpj) doc.text(`CNPJ ${formatCnpj(company.cnpj)}`, left, 37, { width, align: 'right' });
    doc.text(`Emitido em ${isoToBr(new Date().toISOString().slice(0, 10))}${groups.length > 1 ? `  ·  página ${page + 1} de ${groups.length}` : ''}`, left, 50, { width, align: 'right' });

    let y = 98;
    if (!group.length) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('Nenhuma proposta neste comparativo ainda.', left, y);
      return;
    }
    const colW = (width - labelW) / group.length;
    const colX = (i: number) => left + labelW + colW * i;
    const pad = 6;

    // Column headers: supplier, quote number, badges.
    const headH = 58;
    group.forEach((q, i) => {
      const chosen = q.status === 'selected' || q.status === 'ordered';
      if (chosen) doc.rect(colX(i), y - 4, colW, headH).fill(SELECTED_BG);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(q.supplier.name, colX(i) + pad, y, { width: colW - pad * 2, height: 28, ellipsis: true });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(`${q.number}${chosen ? '  ·  ESCOLHIDA' : ''}`, colX(i) + pad, y + 28, { width: colW - pad * 2 });
      if (q.badges.length) doc.fillColor(BLUE).fontSize(8).text(q.badges.join(' · '), colX(i) + pad, y + 40, { width: colW - pad * 2, height: 12, ellipsis: true });
    });
    y += headH;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(LINE).stroke();

    for (const row of ROWS) {
      const values = group.map((q) => row.value(q));
      const h = Math.max(16, ...values.map((v) => doc.font('Helvetica').fontSize(9.5).heightOfString(v, { width: colW - pad * 2 }))) + 10;
      if (y + h > doc.page.height - 50) break; // very long item lists: the rest is in the app
      group.forEach((q, i) => {
        if (q.status === 'selected' || q.status === 'ordered') doc.rect(colX(i), y, colW, h).fill(SELECTED_BG);
      });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(row.label.toUpperCase(), left, y + 6, { width: labelW - 8, characterSpacing: 0.4 });
      group.forEach((q, i) => {
        const isBest = row.label === 'Valor total' && c.quotes.length > 1 && q.total === best.get(q.currency);
        doc
          .fillColor(values[i]!.startsWith('Não informad') ? MUTED : INK)
          .font(row.label === 'Valor total' ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(9.5)
          .text(values[i]! + (isBest ? '  (menor)' : ''), colX(i) + pad, y + 5, { width: colW - pad * 2 });
      });
      y += h;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
    }

    doc.page.margins.bottom = 0; // the footer sits in the margin: no automatic page break
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text('Valores na moeda original de cada proposta, sem conversão.  ·  Gerado pelo ProcureMate', left, doc.page.height - 34, { width, align: 'center', lineBreak: false });
  });

  doc.end();
  return { file: await done, name: comparisonFileName(c) };
}
