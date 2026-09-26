import { beforeEach, describe, expect, it } from 'vitest';
import { isInConversation, phoneFromMessageIds, readContact, readConversation, readDrawerPhone, readMessageRows } from './whatsapp-dom';

// Mirrors the parts of WhatsApp Web's markup the extension relies on.
const msg = (dir: 'in' | 'out', meta: string, text: string, extra = '') => `
  <div role="row"><div data-id="${dir === 'out' ? 'true' : 'false'}_5511970001234@c.us_${Math.random().toString(36).slice(2)}">
    <div class="message-${dir}">${extra}
      <div class="copyable-text" data-pre-plain-text="${meta}"><span class="selectable-text copyable-text"><span>${text}</span></span></div>
    </div>
  </div></div>`;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="side"><span>Outra conversa com 999 reais</span></div>
    <div id="main">
      <header><span dir="auto" title="Carlos (Microsemi)">Carlos (Microsemi)</span></header>
      <div class="list">
        ${msg('out', '[09:12, 25/09/2026] Ana: ', 'Consegue cotar 30 fontes 24V?')}
        ${msg('in', '[10:47, 25/09/2026] Carlos (Microsemi): ', 'Consigo 30 fontes Microsemi por USD 111,46 cada.')}
        ${msg('in', '[10:48, 25/09/2026] Carlos (Microsemi): ', 'Segue foto do produto', '<img src="blob:https://web.whatsapp.com/abc">')}
        <div role="row"><div class="message-in"><span>mensagem de áudio sem texto</span></div></div>
      </div>
      <footer><div contenteditable="true">rascunho</div></footer>
    </div>`;
});

describe('readConversation', () => {
  it('reads text messages in order with direction, author and time', () => {
    const c = readConversation();
    expect(c.every((m) => /^(true|false)_5511970001234@c\.us_/.test(m.id ?? ''))).toBe(true);
    expect(c.map(({ id: _id, ...m }) => m)).toEqual([
      { direction: 'out', author: 'Ana', time: '09:12, 25/09/2026', text: 'Consegue cotar 30 fontes 24V?' },
      { direction: 'in', author: 'Carlos (Microsemi)', time: '10:47, 25/09/2026', text: 'Consigo 30 fontes Microsemi por USD 111,46 cada.' },
      { direction: 'in', author: 'Carlos (Microsemi)', time: '10:48, 25/09/2026', text: '[imagem] Segue foto do produto' },
    ]);
  });

  it('keeps only the most recent messages within the limits', () => {
    expect(readConversation(undefined, { maxMessages: 2, maxChars: 10_000 }).map((m) => m.time)).toEqual(['10:47, 25/09/2026', '10:48, 25/09/2026']);
    expect(readConversation(undefined, { maxMessages: 40, maxChars: 60 })).toHaveLength(1);
  });

  it('falls back to the row id when the direction classes are missing', () => {
    document.querySelectorAll('.message-in, .message-out').forEach((el) => el.removeAttribute('class'));
    expect(readConversation().map((m) => m.direction)).toEqual(['out', 'in', 'in']);
  });

  it('returns nothing when no conversation is open', () => {
    document.getElementById('main')!.remove();
    expect(readConversation()).toEqual([]);
  });
});

describe('contact and selection scope', () => {
  it('reads the contact from the header and the phone from the message ids', () => {
    expect(readContact()).toEqual({ contactName: 'Carlos (Microsemi)', contactPhone: '+5511970001234' });
  });
  it('falls back to the header text and to the message ids when the title markup changes', () => {
    document.querySelector('#main header')!.innerHTML = '<div role="button"><div><span>Carlos (Microsemi)</span></div><div><span>visto por último hoje</span></div></div>';
    expect(readContact()).toEqual({ contactName: 'Carlos (Microsemi)', contactPhone: '+5511970001234' });
    document.querySelector('#main header')!.innerHTML = '';
    expect(readContact()).toEqual({ contactName: null, contactPhone: '+5511970001234' });
  });
  it('gives no phone for group chats or privacy ids', () => {
    document.querySelectorAll('[data-id]').forEach((el) => el.setAttribute('data-id', 'false_120363025@g.us_ABC'));
    expect(phoneFromMessageIds()).toBeNull();
    document.querySelectorAll('[data-id]').forEach((el) => el.setAttribute('data-id', 'false_98765432109876@lid_ABC'));
    expect(readContact()).toEqual({ contactName: 'Carlos (Microsemi)', contactPhone: null });
  });
  it('treats a phone-number title as the phone', () => {
    document.querySelector('#main header span')!.setAttribute('title', '+55 11 97000-1234');
    expect(readContact()).toEqual({ contactName: null, contactPhone: '+55 11 97000-1234' });
  });
  it('only accepts selections inside the open conversation, outside the composer', () => {
    expect(isInConversation(document.querySelector('.selectable-text'))).toBe(true);
    expect(isInConversation(document.querySelector('#side span'))).toBe(false);
    expect(isInConversation(document.querySelector('footer div'))).toBe(false);
  });
});

describe('readMessageRows', () => {
  it('lists bubbles with direction, text, image and PDF name', () => {
    const list = document.querySelector('#main .list')!;
    list.insertAdjacentHTML('beforeend', `<div role="row"><div data-id="false_5511970001234@c.us_PDF1"><div class="message-in"><span>Orcamento_4471.pdf</span><span>2 páginas · PDF · 180 kB</span></div></div></div>`);
    const rows = readMessageRows();
    expect(rows.map((r) => r.direction)).toEqual(['out', 'in', 'in', 'in']);
    expect(rows[1]!.text).toBe('Consigo 30 fontes Microsemi por USD 111,46 cada.');
    expect(rows[2]!.image).not.toBeNull();
    expect(rows[3]).toMatchObject({ pdfName: 'Orcamento_4471.pdf', image: null });
  });
});

describe('contact phone from the contact info panel', () => {
  it('reads the phone outside the conversation and the chat list', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="drawer"><section><div><span>Carlos (Microsemi)</span></div><div><span>+55 11 97000-1234</span></div></section></div>');
    expect(readDrawerPhone()).toBe('+55 11 97000-1234');
  });
  it('ignores numbers typed inside the conversation', () => {
    expect(readDrawerPhone()).toBeNull();
  });
});

describe('current WhatsApp markup (2026: plain ids, no direction classes)', () => {
  const row = (id: string, inner: string) => `<div role="row"><div data-id="${id}" data-testid="conv-msg-${id}"><div data-virtualized="false"><div><div><div data-testid="msg-container">${inner}</div></div></div></div></div></div>`;
  const text = (meta: string, t: string, extra = '') =>
    `<div data-pre-plain-text="${meta}">${extra}<span data-testid="selectable-text" class="selectable-text"><span>${t}</span></span></div>`;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="main">
        <header data-testid="conversation-header"><span data-testid="conversation-info-header-chat-title" dir="auto">Carlos (Microsemi)</span></header>
        <div data-testid="conversation-panel-messages">
          ${row('3AE1612B7884760DB36D', `<span data-testid="tail-in" data-icon="tail-in"></span>${text('[10:47, 25/09/2026] Carlos: ', 'Fica R$ 42,10 cada')}`)}
          ${row('3EB0A1B2C3D4E5F60718', `${text('[10:50, 25/09/2026] Ana: ', 'Fechado, pode mandar')}<div data-testid="msg-meta"><span data-icon="msg-dblcheck"></span></div>`)}
          ${row('3AE1FFFF7884760DB36D', text('[10:52, 25/09/2026] Carlos: ', 'Na verdade R$ 40,00', '<div data-testid="quoted-message"><span class="selectable-text">Fechado, pode mandar</span></div>'))}
          ${row('3AE1EEEE7884760DB36D', '<div data-testid="image-thumb"><img></div><div data-testid="media-state-download"></div>')}
        </div>
      </div>`;
  });

  it('reads rows with plain ids, direction from icons and the reply text without the quote', () => {
    const rows = readMessageRows();
    expect(rows.map((r) => [r.id.length, r.direction, r.text, !!r.image])).toEqual([
      [20, 'in', 'Fica R$ 42,10 cada', false],
      [20, 'out', 'Fechado, pode mandar', false],
      [20, 'in', 'Na verdade R$ 40,00', false],
      [20, 'in', '', true],
    ]);
    expect(readConversation().map((m) => m.text)).toEqual(['Fica R$ 42,10 cada', 'Fechado, pode mandar', 'Na verdade R$ 40,00']);
    expect(readContact().contactName).toBe('Carlos (Microsemi)');
  });
});
