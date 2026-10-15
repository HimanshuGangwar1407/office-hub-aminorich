<script>
/* ═════════════ Management: company-wide finance and purchase summary ═════════════
   The figures are computed on the server (server/erp-summary.js) — management sees totals, not the payments,
   invoices or bank records behind them. Drilling down needs the Accounts or Purchase permission. */

const MGF = { at: 0, data: null, busy: false, err: '' };
function mgmtSummary(force) {
  if (!MGF.busy && (force || !MGF.data || Date.now() - MGF.at > 60000)) {
    MGF.busy = true;
    erpCall('summary.get', {}).then((d) => { MGF.data = d; MGF.at = Date.now(); MGF.err = ''; }, (e) => { MGF.err = e?.message || 'The summary couldn’t be loaded.'; }).finally(() => { MGF.busy = false; schedule(); });
  }
  return MGF.data;
}
function mgmtFin() {
  const s = mgmtSummary(false);
  if (!s) return `<div class="body muted small">${MGF.err ? esc(MGF.err) : 'Loading…'}</div>`;
  const k = (l, v, src, sub = '', tone = '') => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v ${tone}">${v}</div><div class="tiny muted">${src ? srcPill(src) : ''} ${sub}</div></div>`;
  const grid = (x) => `<div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${x}</div>`;
  const drillA = erpHas('acc') ? (tab) => `<button class="btn sm ghost" data-a="erp-mg-go" data-v="accounts" data-t="${tab}">Open in Accounts</button>` : () => '';
  const drillP = erpHas('pur') ? (tab) => `<button class="btn sm ghost" data-a="erp-mg-go" data-v="purchase" data-t="${tab}">Open in Purchase</button>` : () => '';
  const when = (ms) => (ms ? fmtDT(ms) : 'no records yet');
  const c = s.cash, r = s.receivables, p = s.payables, pu = s.purchase;
  const cash = grid(`${k('Verified bank balance', inr(c.verified), 'VERIFIED', c.verifiedAsOf ? `oldest as of ${fmtD(c.verifiedAsOf)}` : 'none verified yet')}
    ${k('Cash today (estimate)', inr(c.current), '', 'verified + movements recorded since')}
    ${k('Projected · 30 days', inr(c.close30), 'FORECAST', 'base case')}${k('Projected · 90 days', inr(c.close90), 'FORECAST', 'base case')}
    ${k('Lowest point · 90 days', inr(c.minClose), 'FORECAST', `stress case ${inr(c.stressMin)}`, c.minClose < 0 ? 'bad' : '')}
    ${k('Available to spend (forecast)', inr(c.availableToSpend), 'FORECAST', 'after commitments and protected cash')}`);
  const shorts = c.shortfalls.length ? `<div class="card body" style="background:var(--bad-soft);border:0;margin-top:8px">${c.shortfalls.map((x) => `<div><b>${esc(x.name)}</b> ${x.belowZero ? 'goes below zero' : 'falls below its protected cash'} on <b>${fmtD(x.date)}</b> — short by <b>${inr(x.shortBy)}</b></div>`).join('')}</div>` : '';
  const recPay = grid(`${k('Expected receipts · 30 days', inr(r.expected30), 'EXPECTED', 'not cash until received')}${k('Overdue receivables', inr(r.overdue), 'EXPECTED', `${r.overdueCount} receipt${r.overdueCount === 1 ? '' : 's'}`, r.overdue ? 'warn' : '')}
    ${r.tally ? k('Receivables per Tally', inr(r.tally.amount), 'IMPORTED', `as of ${fmtD(r.tally.asOf)}`) : ''}
    ${k('Supplier invoices payable', inr(p.invoices), 'PENDING', 'after credit notes, advances and payments')}${k('Approved, not yet paid', inr(p.approvedUnpaid), 'RESERVED')}
    ${k('Waiting for approval', inr(p.pending), 'PENDING', `${p.pendingCount} request${p.pendingCount === 1 ? '' : 's'}`)}${p.tally ? k('Payables per Tally', inr(p.tally.amount), 'IMPORTED', `as of ${fmtD(p.tally.asOf)}`) : ''}
    ${k('EMIs · next 30 days', inr(s.emi.due30), 'RESERVED', `${s.emi.count30} instalment${s.emi.count30 === 1 ? '' : 's'}${s.emi.overdue ? ` · ${s.emi.overdue} overdue` : ''}`, s.emi.overdue ? 'bad' : '')}
    ${k('Reconciliation exceptions', String(s.exceptions), s.exceptions ? 'PENDING' : '', 'Tally / bank differences to resolve', s.exceptions ? 'warn' : '')}`);
  const purchase = grid(`${k('Open purchase orders', inr(pu.openPoValue), '', `${pu.openPoCount} PO${pu.openPoCount === 1 ? '' : 's'}`)}${k('Awaiting delivery', inr(pu.awaitingValue), '', `${pu.awaitingDelivery} order${pu.awaitingDelivery === 1 ? '' : 's'}${pu.overdueDeliveries ? ` · ${pu.overdueDeliveries} overdue` : ''}`, pu.overdueDeliveries ? 'warn' : '')}
    ${k('Advances paid, not adjusted', inr(pu.advancesUnadjusted), 'PAID', 'against supplier invoices', pu.advancesUnadjusted ? 'warn' : '')}${k('Received, not yet invoiced', inr(pu.receivedNotInvoiced), '', 'at PO rates')}
    ${k('Invoices for goods not received', String(pu.invoicesNotReceived), '', 'need a receipt or an exception', pu.invoicesNotReceived ? 'bad' : '')}`);
  const sup = pu.suppliers.length ? `<div class="tbl-wrap"><table class="t rd-t"><thead><tr><th>Supplier</th><th class="num">Ordered</th><th class="num">Invoiced</th><th class="num">Paid</th><th class="num">Advance not adjusted</th><th class="num">Still committed</th></tr></thead><tbody>${pu.suppliers.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${inr(x.ordered)}</td><td class="num">${inr(x.invoiced)}</td><td class="num">${inr(x.paid)}</td><td class="num">${x.unadjusted ? `<span class="v warn">${inr(x.unadjusted)}</span>` : '—'}</td><td class="num">${inr(x.ordered - x.paid)}</td></tr>`).join('')}</tbody></table></div>` : empty('No approved purchase orders yet.');
  const ALERT = { SHORTFALL: 'Cash', EMI_OVERDUE: 'EMI', DELIVERY_OVERDUE: 'Delivery', ADVANCE_NO_DELIVERY: 'Advance', INVOICE_NOT_RECEIVED: 'Invoice', RECON: 'Reconciliation', OVERRIDE: 'Override' };
  const alerts = s.alerts.length ? s.alerts.map((a) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span><span class="pill ${a.tone === 'bad' ? 't-bad' : 't-warn'}">${esc(ALERT[a.kind] || a.kind)}</span> ${esc(a.text)}</span>${a.amount ? `<span class="small">${inr(a.amount)}</span>` : ''}</div>`).join('') : '<span class="small muted">No alerts.</span>';
  const fresh = `<p class="tiny muted">Calculated ${fmtDT(s.generatedAt)}. Latest data — bank balances: ${when(s.updated.bank)} · payments: ${when(s.updated.payments)} · receipts: ${when(s.updated.receipts)} · purchase & stores: ${when(s.updated.purchase)} · last import: ${s.updated.import ? `${esc(s.updated.import.kind)}, ${fmtDT(s.updated.import.at)}` : 'none'}. ${c.unverifiedAccounts ? `${c.unverifiedAccounts} account${c.unverifiedAccounts === 1 ? ' has' : 's have'} no verified balance. ` : ''}Tally remains the official ledger; forecasts and expected receipts are planning figures, not cash.</p>`;
  return `<div class="row" style="justify-content:flex-end;gap:6px">${drillA('dash')}${drillP('dash')}<button class="btn sm" data-a="erp-mg-refresh">Refresh</button></div>
    ${card('Alerts', alerts)}
    ${card('Cash & banking', cash + shorts, { actions: drillA('fc') })}
    ${card('Receivables, payables & commitments', recPay, { actions: drillA('pay') })}
    ${card('Purchase & stores', purchase, { actions: drillP('dash') })}
    ${card('Supplier exposure', sup, { list: true, actions: drillP('sup') })}
    ${fresh}`;
}
Object.assign(ERP_ACTIONS, {
  'erp-mg-refresh': () => { mgmtSummary(true); },
  'erp-mg-go': (el) => { if (el.dataset.v === 'accounts') S.ui.accTab = el.dataset.t; else S.ui.puTab = el.dataset.t; setView(el.dataset.v); },
});
</script>
