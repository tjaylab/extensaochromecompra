import { describe, expect, it } from 'vitest';
import { MessageWatch } from './message-watch';
import type { MessageRow } from './whatsapp-dom';

const row = (id: string, dir: 'in' | 'out', text = '', extra: Partial<MessageRow> = {}): MessageRow => ({ id, direction: dir, text, image: null, pdfName: null, ...extra });
const img = {} as HTMLImageElement;

describe('MessageWatch', () => {
  it('ignores what was already on screen and reports new proposals only', () => {
    const w = new MessageWatch();
    const base = [row('a', 'out', 'Consegue cotar?'), row('b', 'in', 'R$ 10,00 cada')];
    expect(w.scan('carlos', base)).toEqual([]);
    const next = [...base, row('c', 'in', 'Bom dia!'), row('d', 'in', 'Fica USD 105,90 cada')];
    expect(w.scan('carlos', next).map((a) => [a.kind, a.row.id])).toEqual([['text', 'd']]);
    // Nothing new: nothing reported twice.
    expect(w.scan('carlos', next)).toEqual([]);
  });

  it('never triggers on older messages loaded by scrolling up', () => {
    const w = new MessageWatch();
    const base = [row('c', 'in', 'oi'), row('d', 'in', 'tudo bem')];
    w.scan('carlos', base);
    const scrolled = [row('a', 'in', 'R$ 99,00 cada'), row('b', 'in', 'R$ 88,00 cada'), ...base];
    expect(w.scan('carlos', scrolled)).toEqual([]);
  });

  it('ignores the buyer own messages and resets on conversation switch', () => {
    const w = new MessageWatch();
    w.scan('carlos', [row('a', 'in', 'oi')]);
    expect(w.scan('carlos', [row('a', 'in', 'oi'), row('b', 'out', 'Pago R$ 10,00 cada')])).toEqual([]);
    expect(w.scan('paulista', [row('x', 'in', 'R$ 5,00 cada')])).toEqual([]);
  });

  it('waits for images to load and reports PDFs as hints', () => {
    const w = new MessageWatch(30_000);
    w.scan('carlos', [row('a', 'in', 'oi')], 0);
    const loading = [row('a', 'in', 'oi'), row('b', 'in', ''), row('c', 'in', '', { pdfName: 'Orcamento_4471.pdf' })];
    expect(w.scan('carlos', loading, 1000).map((a) => [a.kind, a.row.id])).toEqual([['pdf-hint', 'c']]);
    const loaded = [row('a', 'in', 'oi'), row('b', 'in', '', { image: img }), loading[2]!];
    expect(w.scan('carlos', loaded, 3000).map((a) => [a.kind, a.row.id])).toEqual([['image', 'b']]);
  });

  it('gives up on rows that never load', () => {
    const w = new MessageWatch(10_000);
    w.scan('carlos', [row('a', 'in', 'oi')], 0);
    w.scan('carlos', [row('a', 'in', 'oi'), row('b', 'in', '')], 1000);
    expect(w.scan('carlos', [row('a', 'in', 'oi'), row('b', 'in', '', { image: img })], 20_000)).toEqual([]);
  });
});
