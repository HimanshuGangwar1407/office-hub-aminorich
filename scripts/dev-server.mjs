// Local test server: serves public/ and the same API as Vercel. Usage: DATABASE_URL=... SESSION_SECRET=... SETUP_KEY=... node scripts/dev-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../server/app.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
    const out = await handle({ method: req.method, route: url.pathname.slice(5).replace(/\/+$/, ''), query: Object.fromEntries(url.searchParams), body, headers: req.headers });
    res.writeHead(out.status, out.headers); res.end(JSON.stringify(out.body)); return;
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`OfficeHub running at http://localhost:${port}`));
