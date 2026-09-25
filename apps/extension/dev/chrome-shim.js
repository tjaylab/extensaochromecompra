// Development only: minimal chrome.* stand-in so the built side panel runs in a normal tab
// (served by preview-server.mjs). Not part of the extension bundle.
(() => {
  const listeners = [];
  const area = (name, persist) => {
    const key = `chrome-shim:${name}`;
    const load = () => (persist ? JSON.parse(localStorage.getItem(key) || '{}') : (window[key] ||= {}));
    const save = (data) => (persist ? localStorage.setItem(key, JSON.stringify(data)) : (window[key] = data));
    return {
      async get(keys) {
        const data = load();
        if (keys == null) return { ...data };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
      },
      async set(items) {
        const data = load();
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: data[k], newValue: v };
          data[k] = v;
        }
        save(data);
        listeners.forEach((l) => l(changes, name));
      },
      async remove(keys) {
        const data = load();
        for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        save(data);
      },
    };
  };
  window.chrome = {
    storage: {
      local: area('local', true),
      session: area('session', false),
      onChanged: { addListener: (l) => listeners.push(l), removeListener: (l) => listeners.splice(listeners.indexOf(l), 1) },
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { sendMessage: async () => {}, onMessage: { addListener() {} } },
    // Simulates an open WhatsApp tab: set window.__conversation = [{ direction, author, time, text }, …]
    tabs: {
      query: async () => (window.__conversation ? [{ id: 1, active: true }] : []),
      sendMessage: async () => ({ contactName: window.__contactName ?? null, contactPhone: window.__contactPhone ?? null, conversation: window.__conversation ?? [] }),
    },
  };
  // Simulates the WhatsApp content script: __capture('Consigo 30 fontes…', 'Carlos (Microsemi)', '+55 11 97000-1234')
  window.__capture = (text, contactName = null, contactPhone = null) =>
    chrome.storage.session.set({
      pendingCapture: { id: String(Date.now()), mode: 'selection', text, conversation: window.__conversation ?? null, contactName, contactPhone, capturedAt: Date.now() },
    });
})();
// Simulates switching conversations in WhatsApp Web: __openChat('Carlos (Microsemi)', '+55 11 97000-1234')
window.__openChat = (contactName = null, contactPhone = null) =>
  chrome.storage.session.set({ activeContact: { contactName, contactPhone, at: Date.now() } });
// Simulates something arriving in the open conversation:
// __suggest({ kind: 'text', text: 'Fica USD 105,90 cada' }) or __suggest({ kind: 'pdf', text: 'orc.pdf', attachment: {...} })
window.__suggest = (s) =>
  chrome.storage.session.set({
    suggestion: { id: String(Date.now()), at: Date.now(), contact: { contactName: window.__contactName ?? 'Carlos (Microsemi)', contactPhone: window.__contactPhone ?? '+55 11 97000-1234' }, text: '', ...s },
  });
