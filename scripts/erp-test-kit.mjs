// Shared helpers for the ERP tests: an in-memory database with transactions, a small company, and a test list.
import assert from 'node:assert/strict';
import { runErp } from '../server/erp-all.js';

// ── an in-memory stand-in for server/db.js withTx: changes are thrown away when a command fails ──
export function memDb() {
  const docs = new Map();
  let chain = Promise.resolve();
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const t = {
    get: async (p) => (docs.has(p) ? structuredClone(docs.get(p)) : null),
    list: async (par) => [...docs].filter(([p]) => parent(p) === par).map(([p, d]) => ({ id: p.split('/').pop(), data: structuredClone(d) })),
    set: async (p, d) => { docs.set(p, structuredClone(d)); },
    update: async (p, d) => { if (!docs.has(p)) throw Object.assign(new Error('That record no longer exists.'), { status: 404 }); docs.set(p, { ...docs.get(p), ...structuredClone(d) }); },
    claim: async (p, d) => { if (docs.has(p)) return false; docs.set(p, structuredClone(d)); return true; },
    release: async (p) => { docs.delete(p); },
    next: async (name) => { const n = (docs.get('seq/' + name)?.n || 0) + 1; docs.set('seq/' + name, { n }); return `${name}-${String(n).padStart(4, '0')}`; },
  };
  const tx = (fn) => { const run = async () => { const snap = new Map([...docs].map(([k, v]) => [k, structuredClone(v)])); try { return await fn(t); } catch (e) { docs.clear(); for (const [k, v] of snap) docs.set(k, v); throw e; } }; const p = chain.then(run, run); chain = p.catch(() => {}); return p; };
  const of = (par) => [...docs].filter(([p]) => parent(p) === par).map(([p, d]) => ({ id: p.split('/').pop(), ...d }));
  return { docs, tx, of };
}

// Accounts (ACC): ACC1 (everyday), APR (approver, limit ₹10,00,000). Purchase (PUR): PUR1, PAPR (approver). Stores (STO): ST1, STV (verifier).
// Ops: E1 (employee), MGR. HRP (HR), DIRP (director), ADM (administrator).
export function world() {
  const db = memDb();
  const emps = {
    ACC1: { name: 'Anita', deptId: 'acc', role: 'EMPLOYEE' }, ACC2: { name: 'Ajay', deptId: 'acc', role: 'EMPLOYEE' }, APR: { name: 'Arun', deptId: 'acc', role: 'MANAGER', erp: ['acc.approve'], erpLimits: { acc: 100000000 } },
    PUR1: { name: 'Pooja', deptId: 'pur', role: 'EMPLOYEE' }, PAPR: { name: 'Prakash', deptId: 'pur', role: 'MANAGER', erp: ['pur.approve'] },
    ST1: { name: 'Sunil', deptId: 'sto', role: 'EMPLOYEE' }, STV: { name: 'Sita', deptId: 'sto', role: 'MANAGER', erp: ['sto.verify'] },
    E1: { name: 'Esha', deptId: 'ops', role: 'EMPLOYEE', managerId: 'MGR' }, MGR: { name: 'Mohan', deptId: 'ops', role: 'MANAGER' },
    HRP: { name: 'Hari', deptId: 'ops', role: 'HR' }, DIRP: { name: 'Dina', deptId: 'ops', role: 'DIRECTOR' }, ADM: { name: 'Anil', deptId: 'ops', role: 'ADMIN' },
  };
  for (const [id, e] of Object.entries(emps)) db.docs.set(`emp/${id}`, { ...e, active: true });
  const depts = [{ id: 'acc', code: 'ACC', name: 'Accounts' }, { id: 'pur', code: 'PUR', name: 'Purchase' }, { id: 'sto', code: 'STO', name: 'Stores' }, { id: 'ops', code: 'OPS', name: 'Operations', headId: 'MGR' }];
  const ctx = () => ({ emps: new Map([...db.docs].filter(([p]) => p.startsWith('emp/')).map(([p, d]) => [p.slice(4), d])), depts, chats: new Map(), policies: new Map() });
  const sess = (id) => { const e = db.docs.get(`emp/${id}`); return { uid: 'u-' + id, empId: id, role: e.role, active: e.active !== false, hr: ['ADMIN', 'HR'].includes(e.role), admin: e.role === 'ADMIN', salary: false }; };
  let clock = Date.parse('2026-10-14T05:00:00Z');
  const run = (who, cmd, args) => db.tx((t) => runErp(cmd, args, sess(who), ctx(), t, clock));
  const fails = async (who, cmd, args, re) => { await assert.rejects(run(who, cmd, args), (e) => { assert.match(e.message, re); return true; }); };
  return { db, ctx, sess, run, fails, tick: (ms) => { clock += ms; }, audits: () => db.of('audit') };
}

export const tests = [];
export const test = (name, fn) => tests.push([name, fn]);
