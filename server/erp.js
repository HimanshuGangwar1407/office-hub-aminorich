// The Accounts, Purchase and Stores modules change their records only through here (POST /api/erp), never through the
// generic write route: each action is one command, checked against the person's permissions and the business rules,
// and applied in one transaction (server/db.js withTx) together with its audit entry and notifications.
import { erpPerms, ERP_PERMS } from './erp-perms.js';
import { bad, deny, newId, str, optPaise, toBp, ERP_DEFAULTS, PAY_CATEGORIES } from './erp-core.js';

const MODULES = []; // command maps from the module files, registered below
export function registerErp(commands) { MODULES.push(commands); }
// cross-module checks, e.g. Purchase deciding whether a supplier payment may be approved (server/erp-purchase.js)
const HOOKS = { eligibility: [], paymentBlockers: [], afterPayment: [], beforeCreate: [] };
export function registerErpHooks(h) { for (const k of Object.keys(h)) HOOKS[k].push(h[k]); }

/** Run one ERP command. t: transaction helpers (server/db.js). Returns what the command returns. */
export async function runErp(cmd, args, s, ctx, t, now = Date.now()) {
  if (!s?.active && !s?.bootstrap) deny('Your account is not active. Ask HR.');
  const fn = CORE[cmd] || MODULES.map((m) => m[cmd]).find(Boolean);
  if (typeof fn !== 'function') bad('Unknown action.');
  const E = erpPerms(s, ctx);
  const me = s.empId ? ctx.emps.get(s.empId) || null : null;
  const env = {
    s, ctx, E, t, now, me, by: s.empId || null, hooks: HOOKS,
    cfg: async () => ({ ...ERP_DEFAULTS, ...((await t.get('erp_cfg/main')) || {}) }),
    need: (perm, what) => { if (!E.has(perm)) deny(what || 'You don’t have permission for this.'); },
    audit: (action, detail) => t.set(`audit/${newId()}`, { at: now, by: s.empId || null, action, detail }),
    // system: a reminder from OfficeHub itself — it also goes to the person whose action triggered it, and has no sender
    notify: async (to, n, { system = false } = {}) => {
      for (const id of [...new Set((to || []).filter(Boolean))]) if (system || id !== s.empId) await t.set(`ntf/${newId()}`, { to: id, at: now, title: n.title, body: n.body || '', go: n.go || null, read: false, from: system ? null : s.empId || null });
    },
    // everyone holding a permission (for notifications: "a payment is waiting for your approval")
    holders: (perm) => [...ctx.emps.entries()].filter(([id, e]) => e?.active !== false && erpPerms({ empId: id, role: e.role, active: true }, ctx).has(perm)).map(([id]) => id),
  };
  // one command may run another inside the same transaction (an EMI raising its payment request)
  env.run = (c, x) => { const f = CORE[c] || MODULES.map((m) => m[c]).find(Boolean); if (!f) bad('Unknown action.'); return f(x, env); };
  return fn(args && typeof args === 'object' ? args : {}, env);
}

const CORE = {
  /** Administrators grant ERP permissions and approval limits (recorded in the audit log with before / after). */
  'perm.set': async (a, { s, ctx, t, audit }) => {
    if (!s.admin && !s.bootstrap) deny('Only an administrator can change finance, purchase and stores permissions.');
    const id = String(a.empId || ''), e = ctx.emps.get(id);
    if (!e) bad('Pick an employee.');
    const perms = [...new Set((Array.isArray(a.perms) ? a.perms : []).map(String))];
    if (perms.some((p) => !ERP_PERMS[p])) bad('Unknown permission.');
    const limits = {};
    for (const k of ['acc', 'pur']) { const v = optPaise(a.limits?.[k], `${k === 'acc' ? 'Payment' : 'Purchase'} approval limit`); if (v != null) limits[k] = v; }
    const before = { perms: e.erp || [], limits: e.erpLimits || {} };
    await t.update(`emp/${id}`, { erp: perms.sort(), erpLimits: limits });
    await audit('ERP_PERMISSIONS_CHANGED', { emp: id, from: before, to: { perms, limits } });
    return { ok: true };
  },
  /** Finance settings: cash buffer, matching tolerances, EMI reminders, payment categories. */
  'settings.save': async (a, { need, t, cfg, audit }) => {
    need('erp.admin', 'Only finance setup can change these settings.');
    const old = await cfg();
    const remind = [...new Set((Array.isArray(a.emiRemind) ? a.emiRemind : String(a.emiRemind || '').split(',')).map((x) => Number(String(x).trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 60))].sort((x, y) => y - x);
    const cats = (Array.isArray(a.categories) ? a.categories : []).filter((c) => PAY_CATEGORIES[c]);
    const next = {
      cashBuffer: optPaise(a.cashBuffer, 'Cash buffer') ?? 0,
      qtyTolBp: a.qtyTol === '' || a.qtyTol == null ? 0 : toBp(a.qtyTol, 'Quantity tolerance'),
      rateTolBp: a.rateTol === '' || a.rateTol == null ? 0 : toBp(a.rateTol, 'Rate tolerance'),
      roundTol: optPaise(a.roundTol, 'Rounding tolerance') ?? 0,
      emiRemind: remind.length ? remind : ERP_DEFAULTS.emiRemind,
      grnRequired: a.grnRequired !== false,
      categories: cats.length ? cats : ERP_DEFAULTS.categories,
      note: str(a.note, 300),
    };
    await t.set('erp_cfg/main', next);
    await audit('ERP_SETTINGS_CHANGED', { from: { cashBuffer: old.cashBuffer, qtyTolBp: old.qtyTolBp, rateTolBp: old.rateTolBp, roundTol: old.roundTol, grnRequired: old.grnRequired }, to: { cashBuffer: next.cashBuffer, qtyTolBp: next.qtyTolBp, rateTolBp: next.rateTolBp, roundTol: next.roundTol, grnRequired: next.grnRequired } });
    return { ok: true };
  },
};
