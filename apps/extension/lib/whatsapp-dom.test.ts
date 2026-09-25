import { beforeEach, describe, expect, it } from 'vitest';
import { isInConversation, readContact, readConversation } from './whatsapp-dom';

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
    expect(c).toEqual([
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
  it('reads the contact from the conversation header', () => {
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
