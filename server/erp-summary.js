// Management summary: company-wide finance and purchase figures computed on the server, so people with the
// Management permission (fin) see totals without receiving the individual payments, invoices or bank records.
// Drilling down into records needs the Accounts or Purchase permission. Every figure carries its source and date.
import { registerErp } from './erp.js';
import { deny, ymdIST, addDays } from './erp-core.js';
import { forecast, paidOf, receivedOf, rcptStatus } from './erp-forecast.js';
import { advancesOf, poProgress, invoiceLiability } from './erp-purchase.js';

const sum = (l, f = (x) => x) => l.reduce((s, x) => s + (f(x) || 0), 0);
const DEAD = ['REJECTED', 'CANCELLED'];

registerErp({
  'summary.get': async (a, { E, t, now, cfg }) => {
    if (!E.has('fin') && !E.has('acc')) deny('The finance summary is for management and Accounts.');
    const today = ymdIST(now), d30 = addDays(today, 30);
    const L = Object.fromEntries(await Promise.all(['erp_bank', 'erp_bal', 'erp_rcpt', 'erp_pay', 'erp_loan', 'erp_po', 'erp_inv', 'erp_grn', 'erp_exc', 'erp_imp', 'erp_cust', 'erp_sup'].map(async (c) => [c, await t.list(c)])));
    const fc = forecast({ banks: L.erp_bank, bals: L.erp_bal, rcpts: L.erp_rcpt, pays: L.erp_pay, loans: L.erp_loan, cfg: await cfg(), today, horizon: 90, scenario: 'base' });
    const stress = forecast({ banks: L.erp_bank, bals: L.erp_bal, rcpts: L.erp_rcpt, pays: L.erp_pay, loans: L.erp_loan, cfg: await cfg(), today, horizon: 90, scenario: 'stress' });
    const latest = (c) => Math.max(0, ...L[c].map((x) => x.data.updatedAt || x.data.at || x.data.createdAt || 0));
    // receivables / payables
    const rOpen = L.erp_rcpt.filter((r) => !['RECEIVED', 'CANCELLED'].includes(rcptStatus(r.data, today)));
    const left = (r) => r.data.amount - receivedOf(r.data);
    const snap = (side) => L.erp_cust.filter((c) => c.data.side === side && !c.data.superseded);
    const pays = L.erp_pay.map((p) => p.data);
    const openPay = pays.filter((p) => ['APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'].includes(p.status));
    const pendPay = pays.filter((p) => ['SUBMITTED', 'UNDER_REVIEW'].includes(p.status));
    const emis = L.erp_loan.filter((l) => l.data.status === 'ACTIVE').flatMap((l) => (l.data.schedule || []).filter((i) => !i.paid && !i.skipped && i.due <= d30).map((i) => ({ ...i, lender: l.data.lender })));
    // purchase
    const pos = L.erp_po.filter((p) => p.data.status === 'APPROVED');
    const prog = pos.map((p) => ({ p, pr: poProgress({ ...p.data, id: p.id }, L.erp_grn, L.erp_inv) }));
    const undelivered = prog.filter((x) => x.p.data.kind !== 'SERVICES' && x.pr.some((l) => l.accepted < l.qty));
    const valueLeft = (x) => sum(x.pr, (l) => Math.round(((l.qty - Math.min(l.qty, l.accepted)) * l.rate) / 1000));
    const adv = pos.concat(L.erp_po.filter((p) => p.data.status === 'CLOSED')).map((p) => ({ p, a: advancesOf(p.id, L.erp_pay, L.erp_inv) }));
    const recvNotInv = prog.map((x) => ({ x, v: sum(x.pr, (l) => Math.max(0, Math.round(((l.accepted - l.invoiced) * l.rate) / 1000))) })).filter((y) => y.v > 0);
    const invs = L.erp_inv.filter((i) => i.data.status !== 'CANCELLED');
    const notRecv = invs.filter((i) => (i.data.match?.issues || []).some((m) => /accepted at stores|accepted work/.test(m)) && !i.data.match?.accepted);
    const payables = sum(invs, (i) => Math.max(0, invoiceLiability(i.data, i.id, L.erp_pay).payable));
    const bySup = new Map();
    for (const p of L.erp_po.filter((x) => ['APPROVED', 'CLOSED'].includes(x.data.status))) {
      const s = bySup.get(p.data.supplierId) || { name: p.data.supplierName, ordered: 0, invoiced: 0, paid: 0, unadjusted: 0 };
      s.ordered += p.data.total;
      s.invoiced += sum(invs.filter((i) => i.data.poId === p.id), (i) => i.data.amount - sum(i.data.creditNotes || [], (c) => c.amount));
      s.paid += sum(L.erp_pay.filter((y) => y.data.poId === p.id && !DEAD.includes(y.data.status)), (y) => paidOf(y.data));
      s.unadjusted += advancesOf(p.id, L.erp_pay, L.erp_inv).unadjusted;
      bySup.set(p.data.supplierId, s);
    }
    const alerts = [
      ...fc.shortfalls.map((s) => ({ tone: 'bad', text: `${s.name} falls below its protected cash on ${s.date}`, kind: 'SHORTFALL', date: s.date, amount: s.shortBy, name: s.name })),
      ...emis.filter((i) => i.due < today).map((i) => ({ tone: 'bad', kind: 'EMI_OVERDUE', text: `${i.lender} EMI ${i.n} overdue since ${i.due}`, amount: i.amount })),
      ...undelivered.filter((x) => x.p.data.expectedDate < today).map((x) => ({ tone: 'warn', kind: 'DELIVERY_OVERDUE', text: `${x.p.data.code} from ${x.p.data.supplierName} overdue since ${x.p.data.expectedDate}`, amount: valueLeft(x) })),
      ...adv.filter((y) => y.a.paid > 0 && y.p.data.kind !== 'SERVICES' && poProgress({ ...y.p.data, id: y.p.id }, L.erp_grn, L.erp_inv).every((l) => !l.accepted)).map((y) => ({ tone: 'warn', kind: 'ADVANCE_NO_DELIVERY', text: `Advance paid on ${y.p.data.code} (${y.p.data.supplierName}), nothing delivered yet`, amount: y.a.paid })),
      ...notRecv.map((i) => ({ tone: 'warn', kind: 'INVOICE_NOT_RECEIVED', text: `${i.data.supplierName} invoice ${i.data.invoiceNo} for material not yet received`, amount: i.data.amount })),
      ...(L.erp_exc.filter((x) => x.data.status === 'OPEN').length ? [{ tone: 'warn', kind: 'RECON', text: `${L.erp_exc.filter((x) => x.data.status === 'OPEN').length} reconciliation exceptions open` }] : []),
      ...pays.filter((p) => (p.dupOverride || p.exception) && !DEAD.includes(p.status) && p.status !== 'PAID').map((p) => ({ tone: 'warn', kind: 'OVERRIDE', text: `${p.code} ${p.payee}: ${p.dupOverride ? 'raised despite a duplicate warning' : 'approved as an exception'}`, amount: p.amountApproved ?? p.amountReq })),
    ];
    const lastImp = L.erp_imp.map((x) => x.data).sort((x, y) => y.at - x.at)[0];
    return {
      today, generatedAt: now,
      cash: {
        verified: fc.company.verifiedTotal, verifiedAsOf: fc.company.oldestAsOf, unverifiedAccounts: fc.company.unverifiedAccounts.length, accounts: fc.accounts.map((x) => ({ name: x.name, verified: x.opening, asOf: x.asOf, source: x.source, current: x.current, minClose: x.minClose, protect: x.protect })),
        current: fc.company.current, close30: fc.company.series[Math.min(30, fc.company.series.length - 1)].close, close90: fc.company.closeEnd, minClose: fc.company.minClose,
        availableToSpend: fc.company.availableToSpend, stressMin: stress.company.minClose, shortfalls: fc.shortfalls.map((s) => ({ name: s.name, date: s.date, shortBy: s.shortBy, belowZero: s.belowZero })),
      },
      receivables: { expected30: sum(rOpen.filter((r) => (r.data.promisedDate || r.data.expectedDate) <= d30 && rcptStatus(r.data, today) !== 'OVERDUE'), left), overdue: sum(rOpen.filter((r) => rcptStatus(r.data, today) === 'OVERDUE'), left), overdueCount: rOpen.filter((r) => rcptStatus(r.data, today) === 'OVERDUE').length, tally: snap('RECEIVABLE').length ? { amount: sum(snap('RECEIVABLE'), (c) => c.data.amount), asOf: snap('RECEIVABLE')[0].data.asOf } : null },
      payables: { invoices: payables, approvedUnpaid: sum(openPay, (p) => (p.amountApproved ?? p.amountReq) - paidOf(p)), pending: sum(pendPay, (p) => p.amountReq), pendingCount: pendPay.length, tally: snap('PAYABLE').length ? { amount: sum(snap('PAYABLE'), (c) => c.data.amount), asOf: snap('PAYABLE')[0].data.asOf } : null },
      emi: { due30: sum(emis, (i) => i.amount), count30: emis.length, overdue: emis.filter((i) => i.due < today).length },
      purchase: {
        openPoValue: sum(pos, (p) => p.data.total), openPoCount: pos.length, awaitingDelivery: undelivered.length, awaitingValue: sum(undelivered, valueLeft),
        overdueDeliveries: undelivered.filter((x) => x.p.data.expectedDate < today).length, advancesUnadjusted: sum(adv, (y) => Math.max(0, y.a.unadjusted)),
        receivedNotInvoiced: sum(recvNotInv, (y) => y.v), invoicesNotReceived: notRecv.length, suppliers: [...bySup.values()].sort((x, y) => (y.ordered - y.paid) - (x.ordered - x.paid)).slice(0, 10),
      },
      exceptions: L.erp_exc.filter((x) => x.data.status === 'OPEN').length,
      updated: { bank: latest('erp_bal'), payments: latest('erp_pay'), receipts: latest('erp_rcpt'), purchase: Math.max(latest('erp_po'), latest('erp_grn'), latest('erp_inv')), import: lastImp ? { at: lastImp.at, kind: lastImp.kindLabel } : null },
      alerts: alerts.slice(0, 40),
    };
  },
});
