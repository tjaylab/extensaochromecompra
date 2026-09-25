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
        .bubble { position: fixed; right: 20px; bottom: 88px; z-index: 2147483646; width: 54px; height: 54px; padding: 0; border-radius: 15px;
          border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 6px 20px rgba(37,99,235,.35); transition: transform .15s ease; }
        .bubble img { width: 54px; height: 54px; display: block; }
        .bubble:hover { transform: scale(1.06); }
        .bubble:focus-visible { outline: 3px solid #4F46E5; outline-offset: 3px; }
        .dot { position: absolute; top: 2px; right: 2px; width: 14px; height: 14px; border-radius: 50%; background: #E0592A;
          border: 2px solid #fff; display: none; }
        .note { position: fixed; right: 84px; bottom: 96px; z-index: 2147483646; max-width: 260px; padding: 8px 12px; border-radius: 10px;
          background: #172033; color: #fff; font: 500 13px/1.35 system-ui, 'Segoe UI', sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.25);
          display: none; cursor: pointer; }
        .window { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: ${WIDTH}px; height: min(720px, calc(100vh - 32px));
          display: none; flex-direction: column; border-radius: 14px; overflow: hidden; background: #F8FAFC;
          box-shadow: 0 16px 48px rgba(0,0,0,.28); border: 1px solid #CBD5E1; }
        .bar { height: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 6px 0 12px;
          background: #2563EB; color: #fff; font: 600 13px system-ui, 'Segoe UI', sans-serif; letter-spacing: .02em; }
        .bar button { width: 30px; height: 30px; border: none; border-radius: 8px; background: transparent; color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center; }
        .bar button:hover { background: rgba(255,255,255,.15); }
        .bar button:focus-visible { outline: 2px solid #fff; }
        .title { display: flex; align-items: center; gap: 8px; }
        .mini { width: 20px; height: 20px; border-radius: 5px; }
        iframe { flex: 1; width: 100%; border: 0; background: #F8FAFC; }
      </style>
      <button class="bubble" type="button" aria-label="Abrir ProcureMate">
        <img class="logo" alt="" />
        <span class="dot"></span>
      </button>
      <div class="note" role="status"></div>
      <section class="window" role="dialog" aria-label="ProcureMate">
        <div class="bar">
          <span class="title"><img class="mini" alt="" />Procuremate</span>
          <button type="button" class="min" aria-label="Minimizar ProcureMate" title="Minimizar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
          </button>
        </div>
      </section>`;
    document.documentElement.appendChild(host);

    const bubble = shadow.querySelector<HTMLButtonElement>('.bubble')!;
    const iconUrl = chrome.runtime.getURL('/icon/128.png');
    shadow.querySelectorAll<HTMLImageElement>('.logo, .mini').forEach((img) => (img.src = iconUrl));
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
