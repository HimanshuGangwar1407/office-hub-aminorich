// Shared helpers for the Accounts, Purchase and Stores modules (server/erp*.js).
// Money is always whole paise (integers): amounts arrive as rupee strings ("12,500.50") and are parsed exactly, never
// through floating-point arithmetic. Every change runs inside one transaction (server/db.js withTx).
import crypto from 'node:crypto';

const err = (status, code) => (message) => { throw Object.assign(new Error(message), { status, code }); };
export const bad = err(400, 'invalid_argument');
export const deny = err(403, 'permission_denied');
export const conflict = err(409, 'conflict');
export const newId = () => crypto.randomBytes(9).toString('base64url');

/** "12,500.50" / "₹ 12500.5" / "-300" → paise (integer). Throws on anything that isn't an exact amount. */
export function toPaise(v, label = 'Amount', { allowNegative = false, allowZero = true } = {}) {
  const raw = String(v ?? '').replace(/[,\s₹]/g, '').replace(/^Rs\.?/i, '');
  const m = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) bad(`${label}: enter an amount like 12500 or 12500.50.`);
  const p = (Number(m[2]) * 100 + Number((m[3] || '0').padEnd(2, '0'))) * (m[1] ? -1 : 1);
  if (p < 0 && !allowNegative) bad(`${label} can’t be negative.`);
  if (p === 0 && !allowZero) bad(`${label} must be more than zero.`);
  return p === 0 ? 0 : p; // no -0
}
export const optPaise = (v, label, o) => (v === '' || v == null ? null : toPaise(v, label, o));
/** paise → "₹1,23,456.78" (for messages; the browser formats its own) */
export function inr(p) {
  const n = Math.abs(p), r = Math.floor(n / 100), c = n % 100;
  return `${p < 0 ? '−' : ''}₹${r.toLocaleString('en-IN')}${c ? '.' + String(c).padStart(2, '0') : ''}`;
}
/** paise → "1234.50" (exact, for passing an amount on to another command) */
export const rupeeStr = (p) => `${p < 0 ? '-' : ''}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, '0')}`;
/** quantities: up to 3 decimals, kept as integer thousandths so they add up exactly */
export function toQty(v, label = 'Quantity', { allowZero = false } = {}) {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(String(v ?? '').replace(/[,\s]/g, ''));
  if (!m) bad(`${label}: enter a number like 10 or 2.5.`);
  const q = Number(m[1]) * 1000 + Number((m[2] || '0').padEnd(3, '0'));
  if (!q && !allowZero) bad(`${label} must be more than zero.`);
  return q;
}
/** rate (paise per unit) × quantity (thousandths) → paise, rounded half up */
export const lineAmount = (ratePaise, qtyMilli) => Math.round((ratePaise * qtyMilli) / 1000);
/** percentage of an amount, in basis points (1250 = 12.5%) → paise, rounded half up */
export const pctOf = (paise, bp) => Math.round((paise * bp) / 10000);
export function toBp(v, label = 'Percentage') {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(v ?? '').trim());
  if (!m) bad(`${label}: enter a percentage like 18 or 2.5.`);
  const bp = Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'));
  if (bp > 10000) bad(`${label} can’t be over 100%.`);
  return bp;
}

export const str = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export const text = (v, max = 2000) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
export function need(v, label) { if (!v) bad(`${label} is required.`); return v; }
export function ymdOf(v, label = 'Date', { optional = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s && optional) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) bad(`${label}: pick a valid date.`);
  return s;
}
export const oneOf = (v, list, label) => { if (!list.includes(v)) bad(`${label}: choose one of the options.`); return v; };
export const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
export const needId = (v, label = 'Record') => { if (!isId(v)) bad(`${label} is missing.`); return v; };

/** invoice numbers compared without spaces, punctuation or case: "INV/2024-001" = "inv 2024 001" */
export const normRef = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
/** a second form that also ignores zero-padding inside each part: "ACME/24-25/0118" = "acme 24 25 118" */
export const normRef2 = (v) => String(v ?? '').toUpperCase().split(/[^A-Z0-9]+/).map((p) => p.replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ''))).join('');
/** a key usable as one segment of a document path */
export const keyOf = (...parts) => crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0001')).digest('hex').slice(0, 40);

// business dates are Indian Standard Time (the company's timezone), whatever the server's own clock zone is
export const ymdIST = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
export const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/** Supporting documents: files the person uploaded (blob/{fid}_0 written by them) — anything else is refused. */
const FILE_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'csv', 'docx', 'txt', 'zip', 'xml'];
export async function filesFrom(list, t, by, now) {
  const out = [];
  for (const f of (Array.isArray(list) ? list : []).slice(0, 10)) {
    if (!f || !isId(f.fid) || !Number.isInteger(f.chunks) || f.chunks < 1 || f.chunks > 200) bad('A file wasn’t uploaded properly. Attach it again.');
    const ext = String(f.ext || '').toLowerCase();
    if (!FILE_EXT.includes(ext)) bad(`.${ext || '?'} files can’t be attached. Use PDF, images, Excel, CSV, Word, text or ZIP.`);
    const head = await t.get(`blob/${f.fid}_0`);
    if (!head || head.by !== by) bad('A file wasn’t uploaded properly. Attach it again.');
    out.push({ fid: f.fid, chunks: f.chunks, name: str(f.name, 120) || 'file', ext, size: Number.isInteger(f.size) ? f.size : 0, by, at: now });
  }
  return out;
}

export const ERP_DEFAULTS = {
  cashBuffer: 0, // paise kept untouched across all accounts unless an account has its own
  qtyTolBp: 0, // allowed difference between received and invoiced quantity, basis points
  rateTolBp: 0, // allowed difference between PO rate and invoice rate, basis points
  roundTol: 100, // allowed rounding difference on invoice totals, paise (₹1)
  emiRemind: [7, 3, 1], // days before an EMI is due that Accounts is reminded
  grnRequired: true, // goods need a verified goods receipt before balance payment (services use acceptance)
  categories: ['SUPPLIER', 'ADVANCE', 'SALARY', 'RENT', 'UTILITIES', 'EMI', 'TAX', 'REIMBURSEMENT', 'PROFESSIONAL', 'OTHER'],
};
export const PAY_CATEGORIES = {
  SUPPLIER: 'Supplier payment', ADVANCE: 'Purchase advance', SALARY: 'Salaries', RENT: 'Rent', UTILITIES: 'Electricity & utilities', EMI: 'EMI / loan repayment',
  TAX: 'Taxes & statutory', REIMBURSEMENT: 'Employee reimbursement', PROFESSIONAL: 'Professional fees', TRANSFER: 'Transfer between company accounts', OTHER: 'Other approved expense',
};
