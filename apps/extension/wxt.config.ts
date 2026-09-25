import { defineConfig } from 'wxt';

// Chrome-only (Manifest V3). Env vars: see .env.example.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'ProcureMate',
    description: 'Cotações, histórico de fornecedores e pedidos de compra no Omie, direto do WhatsApp Web.',
    permissions: ['sidePanel', 'contextMenus', 'storage'],
    host_permissions: ['https://web.whatsapp.com/*'],
    action: { default_title: 'ProcureMate' },
    // The floating window over WhatsApp Web loads the app page in an iframe.
    web_accessible_resources: [{ resources: ['sidepanel.html', 'chunks/*', 'assets/*', 'icon/*', 'brand/*'], matches: ['https://web.whatsapp.com/*'] }],
  },
  webExt: {
    startUrls: ['https://web.whatsapp.com/'],
  },
});
