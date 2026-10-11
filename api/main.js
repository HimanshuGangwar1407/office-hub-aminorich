// Single Vercel Function for every /api/* route (see the rewrite in vercel.json).
import { handle } from '../server/app.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const qp = req.query?.path;
  let route = Array.isArray(qp) ? qp.join('/') : String(qp || url.searchParams.get('path') || '');
  if (!route) route = url.pathname.replace(/^\/api\/?/, '');
  route = route.replace(/^main\/?/, '').replace(/\/+$/, '');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const query = Object.fromEntries(url.searchParams);
  const out = await handle({ method: req.method, route, query, body: body || {}, headers: req.headers });
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.status(out.status).send(JSON.stringify(out.body));
}
