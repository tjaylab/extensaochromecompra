// Development only: serves the built side panel (.output/chrome-mv3) at http://localhost:5174
// with a chrome.* shim, so the panel can be exercised in a regular browser tab.
// Build first: WXT_AUTH_MODE=dev npm run build -w @compras/extension
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../.output/chrome-mv3');
const port = Number(process.env.PORT ?? 5174);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  try {
    if (url.pathname === '/chrome-shim.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(await readFile(path.join(here, 'chrome-shim.js')));
    }
    const rel = url.pathname === '/' ? 'sidepanel.html' : url.pathname.slice(1);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root)) throw new Error('outside root');
    let body = await readFile(file);
    if (rel === 'sidepanel.html') body = Buffer.from(body.toString().replace('<head>', '<head><script src="/chrome-shim.js"></script>'));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`panel preview on http://localhost:${port}`));
