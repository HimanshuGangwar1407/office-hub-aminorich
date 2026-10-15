<script>
/* ═════════════ Departments: Accounts, Purchase, Stores — shared pieces and Finance setup ═════════════
   Records live in erp_* collections. The server sends each person only what their permissions allow
   (server/erp-perms.js) and changes them only through POST /api/erp (server/erp.js): one checked command per change,
   in one transaction, audited. Money is whole paise everywhere; the browser only formats it. Nothing here invents
   figures: a balance or forecast is always shown with where it came from and when. */

const ERP_PERMS = {
  acc: 'Accounts — bank accounts, receipts, payments, EMIs, forecasts and imports',
  'acc.approve': 'Approve payments (up to their limit)',
  pur: 'Purchase — suppliers, requisitions, purchase orders, invoices and advances',
  'pur.approve': 'Approve requisitions and purchase orders (up to their limit)',
  sto: 'Stores — expected deliveries, goods receipts and stock',
  'sto.verify': 'Verify goods receipts and quality inspection',
  fin: 'Management — company-wide financial and purchase summaries',
  'erp.admin': 'Finance setup — cash buffers, tolerances, categories and reminders',
};
const ERP_DEPT_DEFAULTS = { ACC: ['acc'], ACCOUNTS: ['acc'], PUR: ['pur'], PURCHASE: ['pur'], STO: ['sto'], STORES: ['sto'], WH: ['sto'], WAREHOUSE: ['sto'] };
// the same rule as the server (server/erp-perms.js erpPerms); the server decides, this only shapes the screens
function erpP(e = S.me) {
  const out = new Set();
  if (!e || e.active === false) return out;
  for (const p of Array.isArray(e.erp) ? e.erp : []) if (ERP_PERMS[p]) out.add(p);
  for (const p of ERP_DEPT_DEFAULTS[String(deptOf(e.deptId)?.code || '').toUpperCase()] || []) out.add(p);
  if (e.role === 'DIRECTOR') out.add('fin');
  if (e.role === 'ADMIN') out.add('erp.admin');
  if (out.has('acc.approve')) out.add('acc');
  if (out.has('pur.approve')) out.add('pur');
  if (out.has('sto.verify')) out.add('sto');
  return out;
}
const erpHas = (p) => erpP().has(p);

// ── money: paise in, text out ──
function inr(p, { sign = false } = {}) {
  if (p == null || !Number.isFinite(+p)) return '—';
  const n = Math.abs(Math.round(+p)), r = Math.floor(n / 100), c = n % 100;
  return `${p < 0 ? '−' : sign && p > 0 ? '+' : ''}₹${r.toLocaleString('en-IN')}${c ? '.' + String(c).padStart(2, '0') : ''}`;
}
const rupeesIn = (p) => (p == null ? '' : `${p < 0 ? '-' : ''}${Math.floor(Math.abs(p) / 100)}${Math.abs(p) % 100 ? '.' + String(Math.abs(p) % 100).padStart(2, '0') : ''}`); // for input values
const qtyTxt = (m) => (m == null ? '—' : (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const qtyIn = (m) => (m == null ? '' : String(m / 1000));
// where a figure comes from — shown next to every balance and total
const SRC = {
  VERIFIED: ['Actual / verified', 't-ok'], IMPORTED: ['Imported', 't-info'], EXPECTED: ['Expected', 't-warn'], FORECAST: ['Forecast', 't-vio'],
  RESERVED: ['Reserved', ''], PENDING: ['Pending approval', 't-warn'], PAID: ['Paid', 't-ok'],
};
const srcPill = (k, extra = '') => pill(SRC, k, extra);

// ── data: the erp_* collections this person may read, kept live ──
const ERPD = { sub: {}, c: {} };
function erpUse(...cols) {
  if (!S.db) return;
  for (const c of cols) {
    if (ERPD.sub[c]) continue;
    ERPD.sub[c] = true;
    S.db.collection(c).onSnapshot((q) => { ERPD.c[c] = docsOf(q); schedule(); }, () => { ERPD.c[c] = ERPD.c[c] || []; });
  }
}
const erpList = (c) => ERPD.c[c] || [];
const erpGet = (c, id) => erpList(c).find((x) => x.id === id) || null;
const erpLoading = (...cols) => cols.some((c) => !ERPD.c[c]);
const erpCfg = () => ({ cashBuffer: 0, qtyTolBp: 0, rateTolBp: 0, roundTol: 100, emiRemind: [7, 3, 1], grnRequired: true, categories: ['SUPPLIER', 'ADVANCE', 'SALARY', 'RENT', 'UTILITIES', 'EMI', 'TAX', 'REIMBURSEMENT', 'PROFESSIONAL', 'OTHER'], ...(erpGet('erp_cfg', 'main') || {}) });
const PAY_CATEGORIES = {
  SUPPLIER: 'Supplier payment', ADVANCE: 'Purchase advance', SALARY: 'Salaries', RENT: 'Rent', UTILITIES: 'Electricity & utilities', EMI: 'EMI / loan repayment',
  TAX: 'Taxes & statutory', REIMBURSEMENT: 'Employee reimbursement', PROFESSIONAL: 'Professional fees', TRANSFER: 'Transfer between company accounts', OTHER: 'Other approved expense',
};

/** one ERP command on the server; the result, or a thrown error the caller's act() shows */
async function erpCall(cmd, args) {
  const r = await window.OH.api('erp', { cmd, args });
  // changes made by the server arrive with the next sync — fetch them now so the screen shows them straight away
  if (!/\.get$/.test(cmd)) await window.OH.sync?.().catch(() => {});
  return r;
}
const erpDo = (cmd, args, ok, after) => act(async () => { const r = await erpCall(cmd, args); if (after) await after(r); }, ok);

const erpTabs = (key, tabs, def) => {
  const cur = ui(key, def);
  return { cur, html: `<div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button class="tab" role="tab" aria-selected="${cur === k}" data-a="ui" data-k="${key}" data-v="${k}">${l}${n ? ` <span class="ct">${n}</span>` : ''}</button>`).join('')}</div>` };
};
const erpNoAccess = (title, what) => shell(empty(`${esc(what)} Ask an administrator for access on the Finance setup page.`), title);

/* ═════════════ Navigation ═════════════ */
VIEWS.push(['accounts', 'Accounts', () => erpHas('acc')], ['purchase', 'Purchase', () => true], ['stores', 'Stores', () => erpHas('sto')], ['erpsetup', 'Finance setup', () => erpHas('erp.admin') || isAdmin()]);
Object.assign(ICON, {
  accounts: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  purchase: 'M4 5h2l2 11h10l2-8H7M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  stores: 'M3 9l9-5 9 5v11H3zM8 20v-6h8v6M3 9h18',
  erpsetup: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
});
Object.assign(SEC, { accounts: 'leaf', purchase: 'amber', stores: 'cyan', erpsetup: 'slate' });
NAV_GROUPS.push(['Departments', ['accounts', 'purchase', 'stores', 'erpsetup']]);

/* ═════════════ Finance setup (administrators: permissions; finance setup: rules) ═════════════ */
function vErpSetup() {
  if (!erpHas('erp.admin') && !isAdmin()) return erpNoAccess('Finance setup', 'Finance setup is for administrators.');
  erpUse('erp_cfg');
  const { cur, html: tabs } = erpTabs('esTab', [['perms', 'Permissions'], ['settings', 'Rules & settings']], 'perms');
  let body = '';
  if (cur === 'perms') {
    const q = ui('esQ', '').trim().toLowerCase();
    const list = active().filter((e) => !q || `${e.name} ${e.code || ''} ${deptOf(e.deptId)?.name || ''}`.toLowerCase().includes(q));
    const permPills = (e) => { const P = erpP(e); return [...P].sort().map((p) => `<span class="pill ${(e.erp || []).includes(p) ? 't-acc' : ''}" title="${esc(ERP_PERMS[p])}${(e.erp || []).includes(p) ? '' : ' — from their department or role'}">${esc(p)}</span>`).join(' ') || '<span class="tiny muted">None</span>'; };
    const lim = (e, k) => (e.erpLimits?.[k] != null ? inr(e.erpLimits[k]) : (e.erp || []).includes(k + '.approve') ? 'No limit' : '—');
    body = `<p class="small muted">Accounts, Purchase and Stores permissions are separate from roles: an administrator, HR or a director gets no finance approvals unless granted here, and nobody approves their own request. Department members get their department’s everyday permission automatically (department codes ACC, PUR, STO). Every change is recorded in the audit log.</p>
      <div class="filters rd-filters"><input class="i" id="es-q" data-i="esQ" placeholder="Search people" value="${esc(ui('esQ', ''))}" aria-label="Search"></div>
      ${card(`People · ${list.length}`, dataTable('esP', list, [
        { k: 'name', label: 'Name', v: (e) => e.name, html: (e) => person(e.id, deptOf(e.deptId)?.name || '') },
        { k: 'perms', label: 'Permissions', v: (e) => [...erpP(e)].join(' '), html: permPills },
        { k: 'accl', label: 'Payment approval limit', v: (e) => e.erpLimits?.acc ?? -1, html: (e) => esc(lim(e, 'acc')) },
        { k: 'purl', label: 'Purchase approval limit', v: (e) => e.erpLimits?.pur ?? -1, html: (e) => esc(lim(e, 'pur')) },
      ], { name: 'Finance permissions', click: (e) => (isAdmin() ? `data-a="erp-perm" data-id="${e.id}"` : ''), empty: 'No one matches.' }), { list: true })}
      ${isAdmin() ? '' : '<p class="tiny muted">Only administrators change permissions.</p>'}`;
  }
  if (cur === 'settings') {
    const c = erpCfg(), can = erpHas('erp.admin');
    const ro = can ? '' : 'disabled';
    body = card('Rules & settings', `<form data-f="erp-settings" class="grid two">
        <label class="f">Protected cash buffer (₹, across all accounts unless an account sets its own)<input class="i" id="es-buf" name="cashBuffer" inputmode="decimal" value="${esc(rupeesIn(c.cashBuffer))}" ${ro}></label>
        <label class="f">Invoice rounding tolerance (₹)<input class="i" id="es-rnd" name="roundTol" inputmode="decimal" value="${esc(rupeesIn(c.roundTol))}" ${ro}></label>
        <label class="f">Quantity tolerance (%)<input class="i" id="es-qt" name="qtyTol" inputmode="decimal" value="${esc(String((c.qtyTolBp || 0) / 100))}" ${ro}></label>
        <label class="f">Rate tolerance (%)<input class="i" id="es-rt" name="rateTol" inputmode="decimal" value="${esc(String((c.rateTolBp || 0) / 100))}" ${ro}></label>
        <label class="f">EMI reminders (days before, comma separated)<input class="i" id="es-emi" name="emiRemind" value="${esc((c.emiRemind || []).join(', '))}" ${ro}></label>
        <label class="f">Goods need a verified goods receipt before balance payment<select class="i" id="es-grn" name="grnRequired" ${ro}>${opts([['yes', 'Yes (recommended)'], ['no', 'No']], c.grnRequired === false ? 'no' : 'yes')}</select></label>
        <fieldset class="full" style="border:1px solid var(--line);border-radius:10px;padding:8px 12px"><legend class="small">Payment categories in use</legend>
          <div class="row">${Object.entries(PAY_CATEGORIES).filter(([k]) => k !== 'TRANSFER').map(([k, l]) => `<label class="row small" style="gap:4px"><input type="checkbox" name="cat" value="${k}" ${(c.categories || []).includes(k) ? 'checked' : ''} ${ro}>${esc(l)}</label>`).join('')}</div></fieldset>
        ${can ? '<div class="full row"><span style="flex:1"></span><button class="btn pri">Save settings</button></div>' : '<p class="tiny muted full">Only people with Finance setup permission change these.</p>'}
      </form>`);
  }
  return shell(`${tabs}${body}`, 'Finance setup', 'Permissions and rules for Accounts, Purchase and Stores');
}

function erpPermModal(id) {
  const e = empById(id);
  if (!e) return `${mhead('Permissions')}<div class="body">${empty('This person no longer exists.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const own = new Set(e.erp || []), eff = erpP(e);
  return `${mhead(`Finance permissions · ${esc(e.name)}`, esc(deptOf(e.deptId)?.name || ''))}<form data-f="erp-perm" data-id="${e.id}"><div class="body grid">
    ${Object.entries(ERP_PERMS).map(([k, l]) => `<label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" name="perm" value="${k}" ${own.has(k) ? 'checked' : ''}><span><b>${esc(k)}</b> — ${esc(l)}${!own.has(k) && eff.has(k) ? ' <span class="pill">already from department / role</span>' : ''}</span></label>`).join('')}
    <div class="grid two"><label class="f">Payment approval limit (₹, blank = no limit)<input class="i" id="ep-acc" name="limAcc" inputmode="decimal" value="${esc(rupeesIn(e.erpLimits?.acc ?? null))}"></label>
    <label class="f">Purchase approval limit (₹, blank = no limit)<input class="i" id="ep-pur" name="limPur" inputmode="decimal" value="${esc(rupeesIn(e.erpLimits?.pur ?? null))}"></label></div>
    <p class="tiny muted">Recorded in the audit log. Approvers still can’t approve their own requests.</p></div>
    <footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Save</button></footer></form>`;
}

/* ═════════════ actions and forms (routed from part7: data-a="erp-…", data-f="erp-…") ═════════════ */
const ERP_ACTIONS = {};
const ERP_FORMS = {};
async function erpAction(a, el, ev) {
  if (a === 'erp-perm') return openModal(() => erpPermModal(el.dataset.id));
  const fn = ERP_ACTIONS[a];
  if (fn) return fn(el, ev);
}
async function erpSubmit(f, form, fd, submitter) {
  const v = (k) => String(fd.get(k) ?? '').trim();
  if (f === 'erp-perm') return erpDo('perm.set', { empId: form.dataset.id, perms: fd.getAll('perm').map(String), limits: { acc: v('limAcc'), pur: v('limPur') } }, 'Permissions saved', () => closeModal());
  if (f === 'erp-settings') return erpDo('settings.save', { cashBuffer: v('cashBuffer'), roundTol: v('roundTol'), qtyTol: v('qtyTol'), rateTol: v('rateTol'), emiRemind: v('emiRemind'), grnRequired: v('grnRequired') !== 'no', categories: fd.getAll('cat').map(String) }, 'Settings saved');
  const fn = ERP_FORMS[f];
  if (fn) return fn(form, fd, v, submitter);
}

/* ═════════════ Department pages (filled in by part20–22) ═════════════ */
function vAccounts() { return typeof vAccounts2 === 'function' ? vAccounts2() : erpNoAccess('Accounts', 'Accounts isn’t available.'); }
function vPurchase() { return typeof vPurchase2 === 'function' ? vPurchase2() : shell(empty('Purchase isn’t available.'), 'Purchase'); }
function vStores() { return typeof vStores2 === 'function' ? vStores2() : erpNoAccess('Stores', 'Stores isn’t available.'); }
</script>
