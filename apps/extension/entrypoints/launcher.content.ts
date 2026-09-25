import { defineContentScript } from 'wxt/utils/define-content-script';
import { LAUNCHER_OPEN_KEY, PANEL_MESSAGE, type LauncherCommand } from '../lib/capture';

// ProcureMate as a floating icon over WhatsApp Web: click to open the window, minimize to go back to the icon.
// The app runs in an iframe of the extension's own page, kept loaded while minimized so automatic readings
// continue; when something is ready the icon shows a dot and a short note.

const WIDTH = 400;

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  runAt: 'document_idle',
  main() {
    const host = document.createElement('div');
    host.id = 'procuremate-launcher';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .bubble { position: fixed; right: 20px; bottom: 88px; z-index: 2147483646; width: 52px; height: 52px; border-radius: 50%;
          border: none; background: #1E6B55; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 6px 20px rgba(20,73,58,.35); transition: transform .15s ease; }
        .bubble:hover { transform: scale(1.06); }
        .bubble:focus-visible { outline: 3px solid #14493A; outline-offset: 3px; }
        .dot { position: absolute; top: 2px; right: 2px; width: 14px; height: 14px; border-radius: 50%; background: #E0592A;
          border: 2px solid #fff; display: none; }
        .note { position: fixed; right: 84px; bottom: 96px; z-index: 2147483646; max-width: 260px; padding: 8px 12px; border-radius: 10px;
          background: #1B1D1C; color: #fff; font: 500 13px/1.35 system-ui, 'Segoe UI', sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.25);
          display: none; cursor: pointer; }
        .window { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: ${WIDTH}px; height: min(720px, calc(100vh - 32px));
          display: none; flex-direction: column; border-radius: 14px; overflow: hidden; background: #F6F4F0;
          box-shadow: 0 16px 48px rgba(0,0,0,.28); border: 1px solid #D3CEC4; }
        .bar { height: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 6px 0 12px;
          background: #1E6B55; color: #fff; font: 600 13px system-ui, 'Segoe UI', sans-serif; letter-spacing: .02em; }
        .bar button { width: 30px; height: 30px; border: none; border-radius: 8px; background: transparent; color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center; }
        .bar button:hover { background: rgba(255,255,255,.15); }
        .bar button:focus-visible { outline: 2px solid #fff; }
        iframe { flex: 1; width: 100%; border: 0; background: #F6F4F0; }
      </style>
      <button class="bubble" type="button" aria-label="Abrir ProcureMate">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6M9 14h6M9 18h4"/></svg>
        <span class="dot"></span>
      </button>
      <div class="note" role="status"></div>
      <section class="window" role="dialog" aria-label="ProcureMate">
        <div class="bar">
          <span>ProcureMate</span>
          <button type="button" class="min" aria-label="Minimizar ProcureMate" title="Minimizar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
          </button>
        </div>
      </section>`;
    document.documentElement.appendChild(host);

    const bubble = shadow.querySelector<HTMLButtonElement>('.bubble')!;
    const dot = shadow.querySelector<HTMLElement>('.dot')!;
    const note = shadow.querySelector<HTMLElement>('.note')!;
    const win = shadow.querySelector<HTMLElement>('.window')!;
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('/sidepanel.html');
    iframe.title = 'ProcureMate';
    iframe.allow = 'clipboard-write';
    win.appendChild(iframe); // loaded right away: automatic readings run even while minimized

    let open = false;
    const setOpen = (v: boolean, remember = true) => {
      open = v;
      win.style.display = v ? 'flex' : 'none';
      bubble.style.display = v ? 'none' : 'flex';
      if (v) {
        dot.style.display = 'none';
        note.style.display = 'none';
      }
      if (remember) chrome.storage.local.set({ [LAUNCHER_OPEN_KEY]: v }).catch(() => {});
    };
    chrome.storage.local.get(LAUNCHER_OPEN_KEY).then((r) => setOpen(r[LAUNCHER_OPEN_KEY] === true, false));

    bubble.addEventListener('click', () => setOpen(true));
    note.addEventListener('click', () => setOpen(true));
    shadow.querySelector('.min')!.addEventListener('click', () => setOpen(false));

    // The app inside the window asks for attention when a proposal is ready.
    const panelOrigin = new URL(chrome.runtime.getURL('/')).origin;
    window.addEventListener('message', (e) => {
      if (e.origin !== panelOrigin || e.data?.source !== PANEL_MESSAGE) return;
      if (e.data.type === 'attention' && !open) {
        dot.style.display = 'block';
        if (e.data.text) {
          note.textContent = String(e.data.text).slice(0, 140);
          note.style.display = 'block';
          setTimeout(() => (note.style.display = 'none'), 12_000);
        }
      }
      if (e.data.type === 'open') setOpen(true);
    });

    // The toolbar icon, the floating "Registrar cotação" button and the right-click menu open the window.
    chrome.runtime.onMessage.addListener((msg: LauncherCommand) => {
      if (msg?.type === 'launcher') setOpen(msg.action === 'toggle' ? !open : msg.action === 'open');
    });
  },
});
