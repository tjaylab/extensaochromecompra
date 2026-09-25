import { beforeEach, describe, expect, it } from 'vitest';
import { loadHistory, parseMessageTime, readConversation } from './whatsapp-dom';

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime();

describe('parseMessageTime', () => {
  it.each([
    ['10:47, 25/09/2026', 'pt-BR', at(2026, 9, 25, 10, 47)],
    ['09:05, 01/10/2026', 'pt-BR', at(2026, 10, 1, 9, 5)],
    ['10:47 AM, 9/25/2026', 'en-US', at(2026, 9, 25, 10, 47)],
    ['12:10 PM, 9/25/2026', 'en-US', at(2026, 9, 25, 12, 10)],
    ['12:10 AM, 9/25/2026', 'en-US', at(2026, 9, 25, 0, 10)],
    ['3:15 p.m., 25/9/2026', 'es-ES', at(2026, 9, 25, 15, 15)],
    // US order is detected even on a pt page when the day cannot be a month.
    ['10:47, 9/25/2026', 'pt-BR', at(2026, 9, 25, 10, 47)],
    ['sem data', 'pt-BR', null],
  ])('%s (%s)', (time, lang, expected) => expect(parseMessageTime(time, lang)).toBe(expected));
});

const bubble = (i: number, time: string, text: string) =>
  `<div role="row"><div data-id="false_5511970001234@c.us_M${i}"><div class="message-in"><div class="copyable-text" data-pre-plain-text="[${time}] Carlos: "><span class="selectable-text">${text}</span></div></div></div></div>`;

describe('history', () => {
  beforeEach(() => {
    document.documentElement.lang = 'pt-BR';
    document.body.innerHTML = `<div id="main"><header><span dir="auto" title="Carlos">Carlos</span></header><div id="scroller" style="overflow-y: auto"><div id="list"></div></div></div>`;
  });

  it('reads only the messages within the period', () => {
    document.getElementById('list')!.innerHTML = [
      bubble(1, '10:00, 20/09/2026', 'antiga'),
      bubble(2, '10:00, 23/09/2026', 'R$ 10,00 cada'),
      bubble(3, '09:00, 25/09/2026', 'fica R$ 9,50'),
    ].join('');
    const since = at(2026, 9, 22, 11, 0);
    expect(readConversation(undefined, { maxMessages: 300, maxChars: 60_000 }, since).map((m) => m.text)).toEqual(['R$ 10,00 cada', 'fica R$ 9,50']);
  });

  it('scrolls up until the period is loaded, then restores the scroll position', async () => {
    const list = document.getElementById('list')!;
    const scroller = document.getElementById('scroller')!;
    // Today's messages are loaded; older days arrive each time the list is scrolled to the top.
    list.innerHTML = [bubble(10, '09:00, 25/09/2026', 'hoje 1'), bubble(11, '10:00, 25/09/2026', 'hoje 2')].join('');
    const older = [
      [bubble(8, '10:00, 24/09/2026', 'ontem'), bubble(9, '15:00, 24/09/2026', 'ontem 2')],
      [bubble(6, '10:00, 23/09/2026', 'anteontem'), bubble(7, '12:00, 23/09/2026', 'anteontem 2')],
      [bubble(4, '10:00, 20/09/2026', 'semana passada'), bubble(5, '11:00, 20/09/2026', 'semana passada 2')],
    ];
    let scrollTop = 900;
    Object.defineProperty(scroller, 'clientHeight', { get: () => 400 });
    Object.defineProperty(scroller, 'scrollHeight', { get: () => 1000 + list.children.length * 100 });
    Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, set: (v) => (scrollTop = v) });
    scroller.addEventListener('scroll', () => {
      if (scrollTop !== 0 || !older.length) return;
      const t = document.createElement('template');
      t.innerHTML = older.shift()!.join('');
      list.prepend(...Array.from(t.content.childNodes));
    });
    const heightBefore = scroller.scrollHeight;

    const reached = await loadHistory(at(2026, 9, 22, 10, 0), { stepWaitMs: 1 });
    expect(reached).toBe(true);
    expect(older).toHaveLength(0); // three loads: today -> yesterday -> 2 days -> last week
    // Same distance from the bottom as before: the buyer's view did not jump.
    expect(scroller.scrollHeight - scrollTop).toBe(heightBefore - 900);
    const since = at(2026, 9, 22, 10, 0);
    expect(readConversation(undefined, { maxMessages: 300, maxChars: 60_000 }, since).map((m) => m.text)).toEqual([
      'anteontem',
      'anteontem 2',
      'ontem',
      'ontem 2',
      'hoje 1',
      'hoje 2',
    ]);
  });

  it('stops when nothing more loads (start of the conversation)', async () => {
    const list = document.getElementById('list')!;
    const scroller = document.getElementById('scroller')!;
    list.innerHTML = bubble(1, '09:00, 25/09/2026', 'primeira mensagem');
    Object.defineProperty(scroller, 'clientHeight', { get: () => 100 });
    Object.defineProperty(scroller, 'scrollHeight', { get: () => 500 });
    expect(await loadHistory(at(2026, 9, 22, 10, 0), { stepWaitMs: 1 })).toBe(false);
  });
});
