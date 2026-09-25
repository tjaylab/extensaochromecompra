import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildUserMessage } from '../src/extraction/prompt.js';
import { attachmentLabel, withDocument } from '../src/services/extractions.js';
import { setup } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');

describe('attachment helpers', () => {
  it('labels files and keeps the transcribed lines', () => {
    const label = attachmentLabel({ name: 'Orcamento_4471.pdf', media_type: 'application/pdf', data: PDF });
    expect(label).toBe('Arquivo: Orcamento_4471.pdf (application/pdf, 0 KB)');
    expect(withDocument('', [label], 'Fonte 24V  30 UN  R$ 589,90')).toBe(`${label}\nTrecho do documento:\nFonte 24V  30 UN  R$ 589,90`);
    expect(withDocument('[2] · Fornecedor: segue', [label], null)).toBe(`${label}\n\n[2] · Fornecedor: segue`);
    expect(withDocument('só texto', [], 'ignorado')).toBe('só texto');
  });

  it('tells the model which files are attached', () => {
    const msg = buildUserMessage({ text: '', attachments: [{ name: 'tabela.pdf', media_type: 'application/pdf' }, { media_type: 'image/jpeg' }], today: '2026-09-25' });
    expect(msg).toContain('Anexos acima: PDF "tabela.pdf", imagem');
  });
});

describe('POST /v1/extractions with attachments', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  const user = () => env.as('anexo@empresa.com');
  beforeAll(async () => {
    env = await setup();
    await user().post('/v1/company', { name: 'Anexos' });
  });
  afterAll(async () => env?.close());

  it('accepts a PDF alone and preserves a reference to it', async () => {
    const r = await user().post('/v1/extractions', { attachments: [{ name: 'orcamento.pdf', media_type: 'application/pdf', data: PDF }] });
    expect(r.status).toBe(200);
    expect(r.body.source_text).toContain('Arquivo: orcamento.pdf (application/pdf');
    // The mock cannot read files and says so instead of inventing data.
    expect(r.body.data.itens).toEqual([]);
    expect(r.body.data.campos_ambiguos[0].campo).toBe('anexo');
  });

  it('rejects unsupported formats, oversized files and too many files', async () => {
    const bad = await user().post('/v1/extractions', { attachments: [{ name: 'planilha.xlsx', media_type: 'application/vnd.ms-excel', data: PDF }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Formato não suportado: use PDF, JPG, PNG ou WEBP');

    const huge = await user().post('/v1/extractions', { attachments: [{ media_type: 'image/png', data: 'A'.repeat(11_300_000) }] });
    expect(huge.status).toBe(400);
    expect(huge.body.error.message).toBe('Arquivo maior que 8 MB');

    const many = await user().post('/v1/extractions', { attachments: Array.from({ length: 4 }, () => ({ media_type: 'image/png', data: PDF })) });
    expect(many.status).toBe(400);
    expect(many.body.error.message).toBe('Envie no máximo 3 arquivos por cotação');
  });
});
