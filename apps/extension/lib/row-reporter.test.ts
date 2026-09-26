import { describe, expect, it } from 'vitest';
import { RowReporter } from './row-reporter';
import type { MessageRow } from './whatsapp-dom';

const row = (id: string, text = 'oi', extra: Partial<MessageRow> = {}): MessageRow => ({ id, direction: 'in', text, image: null, pdfName: null, ...extra });
const ids = (batches: ReturnType<RowReporter['scan']>) => batches.map((b) => [b.position, b.rows.map((r) => r.id)]);

describe('RowReporter', () => {
  it('reports what is loaded when the conversation opens, then only new rows', () => {
    const r = new RowReporter();
    expect(ids(r.scan('carlos', [row('a'), row('b')]))).toEqual([['initial', ['a', 'b']]]);
    expect(r.scan('carlos', [row('a'), row('b')])).toEqual([]);
    expect(ids(r.scan('carlos', [row('a'), row('b'), row('c')]))).toEqual([['newer', ['c']]]);
  });

  it('reports history loaded by scrolling up as older', () => {
    const r = new RowReporter();
    r.scan('carlos', [row('c'), row('d')]);
    expect(ids(r.scan('carlos', [row('a'), row('b'), row('c'), row('d')]))).toEqual([['older', ['a', 'b']]]);
    // Scrolling up and a new message at the same time.
    expect(ids(r.scan('carlos', [row('z'), row('a'), row('b'), row('c'), row('d'), row('e')]))).toEqual([
      ['older', ['z']],
      ['newer', ['e']],
    ]);
  });

  it('starts over when the conversation changes', () => {
    const r = new RowReporter();
    r.scan('carlos', [row('a')]);
    expect(ids(r.scan('paulista', [row('x'), row('y')]))).toEqual([['initial', ['x', 'y']]]);
  });

  it('reports an image again once it has loaded', () => {
    const r = new RowReporter();
    r.scan('carlos', [row('a')]);
    expect(ids(r.scan('carlos', [row('a'), row('b', '')]))).toEqual([['newer', ['b']]]);
    const loaded = r.scan('carlos', [row('a'), row('b', '', { image: {} as HTMLImageElement })]);
    expect(loaded[0]!.rows[0]!.image).not.toBeNull();
    expect(r.scan('carlos', [row('a'), row('b', '', { image: {} as HTMLImageElement })])).toEqual([]);
  });
});
