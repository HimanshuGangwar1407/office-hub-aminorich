// Who may use the Accounts, Purchase and Stores modules, and which of their records each person may read.
// Permissions are explicit (an administrator grants them on the Finance setup page) and are checked on the server for
// every read (server/access.js) and every change (server/erp.js). Being an administrator, HR or a director does not by
// itself allow approving or paying anything: financial approvals always need the matching permission, and nobody
// approves their own request (maker-checker).

export const ERP_PERMS = {
  acc: 'Accounts — bank accounts, receipts, payments, EMIs, forecasts and imports',
  'acc.approve': 'Approve payments (up to their limit)',
  pur: 'Purchase — suppliers, requisitions, purchase orders, invoices and advances',
  'pur.approve': 'Approve requisitions and purchase orders (up to their limit)',
  sto: 'Stores — expected deliveries, goods receipts and stock',
  'sto.verify': 'Verify goods receipts and quality inspection',
  fin: 'Management — company-wide financial and purchase summaries',
  'erp.admin': 'Finance setup — cash buffers, tolerances, categories and reminders',
};
// members of these departments (by department code) get the everyday permission of their department
const DEPT_DEFAULTS = { ACC: ['acc'], ACCOUNTS: ['acc'], PUR: ['pur'], PURCHASE: ['pur'], STO: ['sto'], STORES: ['sto'], WH: ['sto'], WAREHOUSE: ['sto'] };

/** The set of ERP permissions this session has. */
export function erpPerms(s, ctx) {
  const out = new Set();
  if (s?.bootstrap) { out.add('erp.admin'); return out; }
  if (!s?.active || !s.empId) return out;
  const me = ctx?.emps?.get(s.empId);
  if (!me || me.active === false) return out;
  for (const p of Array.isArray(me.erp) ? me.erp : []) if (ERP_PERMS[p]) out.add(p);
  const code = String((ctx.depts || []).find((d) => d?.id === me.deptId)?.code || '').toUpperCase();
  for (const p of DEPT_DEFAULTS[code] || []) out.add(p);
  if (s.role === 'DIRECTOR') out.add('fin');
  if (s.role === 'ADMIN') out.add('erp.admin');
  // approving needs the everyday permission of the same module too (an approver must be able to see what they approve)
  if (out.has('acc.approve')) out.add('acc');
  if (out.has('pur.approve')) out.add('pur');
  if (out.has('sto.verify')) out.add('sto');
  return out;
}

/** The most this person may approve in one go, in paise (Infinity when no limit is set). kind: 'acc' | 'pur'. */
export function approveLimit(emp, kind) {
  const v = emp?.erpLimits?.[kind];
  return Number.isSafeInteger(v) && v >= 0 ? v : Infinity;
}

export const ERP_COLLECTIONS = ['erp_cfg', 'erp_bank', 'erp_bal', 'erp_rcpt', 'erp_cust', 'erp_pay', 'erp_loan', 'erp_imp', 'erp_stl', 'erp_exc',
  'erp_sup', 'erp_supbank', 'erp_pr', 'erp_po', 'erp_inv', 'erp_grn', 'erp_item', 'erp_stk', 'erp_key'];
export const isErpCollection = (c) => typeof c === 'string' && c.startsWith('erp_');

/** Whether this session may read an ERP record. E: erpPerms(). Unknown erp_* collections are never readable. */
export function erpReadable(path, data, s, E) {
  const [c] = path.split('/');
  if (!s?.active && !s?.bootstrap) return false;
  const acc = E.has('acc'), pur = E.has('pur'), sto = E.has('sto'), me = s.empId;
  switch (c) {
    case 'erp_cfg': return E.size > 0; // the cash buffer and rules: for people with a finance permission only
    case 'erp_bank': case 'erp_bal': case 'erp_rcpt': case 'erp_cust': case 'erp_loan': case 'erp_imp': case 'erp_stl': case 'erp_exc': case 'erp_supbank': return acc;
    case 'erp_pay': return acc || !data || (pur && !!(data.poId || data.supplierId)) || (!!me && data.requestedBy === me);
    case 'erp_sup': return acc || pur || sto;
    case 'erp_pr': return pur || !data || (!!me && (data.requestedBy === me || data.approverId === me));
    case 'erp_po': return pur || acc || sto;
    case 'erp_inv': return pur || acc;
    case 'erp_grn': return sto || pur || acc;
    case 'erp_item': case 'erp_stk': return sto || pur;
    default: return false; // erp_key and anything not listed: server only
  }
}
