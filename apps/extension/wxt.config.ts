import { defineConfig } from 'wxt';

// Chrome-only (Manifest V3). Env vars: see .env.example.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'Compras WhatsApp',
    description: 'Transforma propostas de fornecedores no WhatsApp Web em cotações e pedidos de compra no Omie.',
    permissions: ['sidePanel', 'contextMenus', 'storage'],
    host_permissions: ['https://web.whatsapp.com/*'],
    action: { default_title: 'Compras WhatsApp' },
  },
  webExt: {
    startUrls: ['https://web.whatsapp.com/'],
  },
});
