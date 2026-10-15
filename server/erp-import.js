// Imports from Tally and bank statements: preview first, then commit. Tally stays the official ledger — nothing is
// written back to it, and imported figures never replace internal records silently: what doesn't match becomes a
// reconciliation exception for Accounts to resolve. Files and rows already imported are recognised and skipped.
//
// The browser parses the file (CSV, or Tally's XML voucher export) into rows and sends them here; a future connector
// running next to Tally could send the same rows. Nothing here pretends Tally is connected.
import { registerErp } from './erp.js';
import { bad, conflict, newId, toPaise, str, text, need, ymdOf, oneOf, needId, normRef, keyOf, ymdIST, daysBetween, inr } from './erp-core.js';
import { paidOf, receivedOf } from './erp-forecast.js';

export const IMPORT_KINDS = {
  BANK_STATEMENT: 'Bank statement',
  TALLY_BALANCES: 'Tally bank / cash balances',
  TALLY_RECEIVABLES: 'Tally outstanding receivables',
  TALLY_PAYABLES: 'Tally outstanding payables',
  TALLY_VOUCHERS: 'Tally payment / receipt vouchers',
};
const MAX_ROWS = 5000;
const signedAmount = (r, k) => {
  // a single amount column ("12,500.00 Dr" / "-12500") or separate debit / credit columns
  if (r.debit != null && r.debit !== '' || r.credit != null && r.credit !== '') {
    const dr = r.debit ? toPaise(String(r.debit).replace(/\s*(Dr|Cr)\.?$/i, ''), `Row ${k}: debit`) : 0, cr = r.credit ? toPaise(String(r.credit).replace(/\s*(Dr|Cr)\.?$/i, ''), `Row ${k}: credit`) : 0;
    return cr - dr;
  }
  const raw = String(r.amount ?? '').trim(), dr = /\bDr\.?$/i.test(raw), cr = /\bCr\.?$/i.test(raw);
  const v = toPaise(raw.replace(/\s*(Dr|Cr)\.?$/i, '').replace(/^\((.*)\)$/, '-$1'), `Row ${k}: amount`, { allowNegative: true });
  return dr ? -Math.abs(v) : cr ? Math.abs(v) : v;
};

/** validate and normalise the rows of one import (no writes) */
async function prepare(a, t) {
  const kind = oneOf(String(a.kind || ''), Object.keys(IMPORT_KINDS), 'Import type');
  const rows = Array.isArray(a.rows) ? a.rows : [];
  if (!rows.length) bad('The file has no rows.');
  if (rows.length > MAX_ROWS) bad(`Import at most ${MAX_ROWS} rows at a time — split the file.`);
  const bankId = kind === 'BANK_STATEMENT' ? needId(a.bankId, 'Bank account') : null;
  if (bankId && !(await t.get(`erp_bank/${bankId}`))) bad('Pick the bank account this statement is for.');
  const map = a.map && typeof a.map === 'object' ? a.map : {}; // Tally ledger name → bank account id
  const out = [], errors = [];
  for (const [i, r] of rows.entries()) {
    const k = i + 1;
    try {
      if (kind === 'BANK_STATEMENT') {
        const date = ymdOf(r.date, `Row ${k}: date`), amount = signedAmount(r, k);
        if (!amount) throw Object.assign(new Error(`Row ${k}: no amount`), { status: 400 });
        const balance = r.balance === '' || r.balance == null ? null : signedAmount({ amount: r.balance }, k);
        const ref = str(r.ref, 80), desc = str(r.desc, 200);
        out.push({ k, date, amount, balance, ref, desc, fp: keyOf('stl', bankId, date, amount, normRef(ref || desc), balance ?? '', r.seq ?? '') });
      } else if (kind === 'TALLY_BALANCES') {
        const ledger = need(str(r.ledger, 120), `Row ${k}: ledger`), asOf = ymdOf(r.date || a.asOf, `Row ${k}: date`);
        // a Tally ledger balance: Dr = money in the bank (positive), Cr = overdrawn (negative) — the opposite of a statement line
        const raw = String(r.amount ?? '').trim(), amount = /\b(Dr|Cr)\.?$/i.test(raw) ? -signedAmount({ amount: raw }, k) : signedAmount({ amount: raw }, k);
        out.push({ k, ledger, asOf, amount, bankId: map[ledger] || null, fp: keyOf('tb', ledger, asOf, amount) });
      } else if (kind === 'TALLY_RECEIVABLES' || kind === 'TALLY_PAYABLES') {
        const party = need(str(r.party, 120), `Row ${k}: party`), ref = str(r.ref, 60), date = ymdOf(r.date, `Row ${k}: bill date`, { optional: true });
        const amount = Math.abs(signedAmount({ amount: r.amount }, k)), due = ymdOf(r.due, `Row ${k}: due date`, { optional: true });
        out.push({ k, party, ref, date, amount, due, fp: keyOf(kind, normRef(party), normRef(ref), date || '', amount) });
      } else {
        const date = ymdOf(r.date, `Row ${k}: date`), vtype = need(str(r.vtype, 40), `Row ${k}: voucher type`), number = str(r.number, 40);
        const amount = Math.abs(signedAmount({ amount: r.amount }, k)), party = str(r.party, 120), guid = str(r.guid, 80);
        out.push({ k, date, vtype, number, party, amount, guid, narration: str(r.narration, 200), fp: guid ? keyOf('tv', guid) : keyOf('tv', vtype, number, date, amount) });
      }
    } catch (e) { errors.push(e.message); }
  }
  // rows already imported (any earlier file) are skipped, not duplicated
  const seen = new Set();
  for (const r of out) { r.dup = seen.has(r.fp) || !!(await t.get(`erp_key/impr_${r.fp}`)); seen.add(r.fp); }
  return { kind, bankId, rows: out, errors };
}

/** match statement lines to recorded payments / receipts: same account, same amount, within 3 days, reference first */
function reconcileStatement(lines, pays, rcpts, bankId) {
  const cand = [];
  for (const { id, data: p } of pays) for (const [i, x] of (p.payments || []).entries()) if ((x.bankId || p.bankId) === bankId && x.amount > 0 && !x.reversed) cand.push({ kind: 'pay', id, i, code: p.code, amount: -x.amount, date: x.date, ref: normRef(x.ref), used: false, matched: !!x.stl });
  for (const { id, data: p } of pays) if (p.category === 'TRANSFER' && p.transferTo === bankId) for (const [i, x] of (p.payments || []).entries()) if (x.amount > 0 && !x.reversed) cand.push({ kind: 'transfer', id, i, code: p.code, amount: x.amount, date: x.date, ref: normRef(x.ref), used: false, matched: !!x.stlIn });
  for (const { id, data: r } of rcpts) for (const [i, x] of (r.received || []).entries()) if (x.bankId === bankId) cand.push({ kind: 'rcpt', id, i, code: r.code, amount: x.amount, date: x.date, ref: normRef(x.ref), used: false, matched: !!x.stl });
  const res = [];
  for (const l of lines) {
    const text = normRef(`${l.ref} ${l.desc}`);
    const pool = cand.filter((c) => !c.used && !c.matched && c.amount === l.amount && Math.abs(daysBetween(c.date, l.date)) <= 3);
    const best = pool.find((c) => c.ref && c.ref.length >= 4 && text.includes(c.ref)) || (pool.length === 1 ? pool[0] : null);
    if (best) { best.used = true; res.push({ line: l, match: best, how: best.ref && text.includes(best.ref) ? 'reference' : 'amount and date' }); } else res.push({ line: l, match: null, ambiguous: pool.length > 1 });
  }
  return res;
}

const imports = {
  'imp.preview': async (a, { need: needP, t }) => {
    needP('acc', 'Only Accounts imports Tally and bank data.');
    const p = await prepare(a, t);
    const fileSeen = a.fileHash ? !!(await t.get(`erp_key/impf_${keyOf(a.fileHash)}`)) : false;
    const fresh = p.rows.filter((r) => !r.dup);
    let recon = null;
    if (p.kind === 'BANK_STATEMENT') {
      const [pays, rcpts] = await Promise.all([t.list('erp_pay'), t.list('erp_rcpt')]);
      const rr = reconcileStatement(fresh, pays, rcpts, p.bankId);
      recon = { matched: rr.filter((x) => x.match).length, unmatched: rr.filter((x) => !x.match).length, sample: rr.slice(0, 50).map((x) => ({ k: x.line.k, match: x.match ? `${x.match.code} (${x.how})` : null, ambiguous: !!x.ambiguous })) };
    }
    return {
      kind: p.kind, total: p.rows.length + p.errors.length, valid: p.rows.length, new: fresh.length, duplicates: p.rows.length - fresh.length, errors: p.errors.slice(0, 50), errorCount: p.errors.length, fileSeen, recon,
      unmappedLedgers: p.kind === 'TALLY_BALANCES' ? [...new Set(p.rows.filter((r) => !r.bankId).map((r) => r.ledger))] : [],
      rows: p.rows.slice(0, 200).map(({ fp, ...r }) => r),
    };
  },
  'imp.commit': async (a, { need: needP, t, now, by, audit, notify, holders }) => {
    needP('acc', 'Only Accounts imports Tally and bank data.');
    const p = await prepare(a, t);
    if (p.errors.length && !a.skipErrors) bad(`${p.errors.length} row${p.errors.length === 1 ? ' has' : 's have'} errors (first: ${p.errors[0]}). Fix the file, or import the valid rows and skip these.`);
    const fileName = str(a.fileName, 160) || 'import', fileHash = str(a.fileHash, 128);
    const id = newId();
    if (fileHash && !(await t.claim(`erp_key/impf_${keyOf(fileHash)}`, { imp: id, at: now }))) conflict('This exact file was imported before. Nothing was imported again.');
    const fresh = [];
    for (const r of p.rows) if (!r.dup && (await t.claim(`erp_key/impr_${r.fp}`, { imp: id, at: now }))) fresh.push(r);
    const counts = { total: p.rows.length + p.errors.length, imported: fresh.length, duplicates: p.rows.length - fresh.length, errors: p.errors.length, matched: 0, exceptions: 0 };
    const exc = async (x) => { counts.exceptions++; await t.set(`erp_exc/${newId()}`, { ...x, impId: id, status: 'OPEN', at: now }); };
    if (p.kind === 'BANK_STATEMENT') {
      const [pays, rcpts] = await Promise.all([t.list('erp_pay'), t.list('erp_rcpt')]);
      const rr = reconcileStatement(fresh, pays, rcpts, p.bankId);
      const touched = new Map();
      for (const { line, match, how, ambiguous } of rr) {
        const sid = newId();
        await t.set(`erp_stl/${sid}`, { impId: id, bankId: p.bankId, date: line.date, amount: line.amount, balance: line.balance, ref: line.ref, desc: line.desc, status: match ? 'MATCHED' : 'UNMATCHED', match: match ? { kind: match.kind, id: match.id, code: match.code, how } : null, at: now });
        if (match) {
          counts.matched++;
          const col = match.kind === 'rcpt' ? 'erp_rcpt' : 'erp_pay', doc = touched.get(match.id) || (await t.get(`${col}/${match.id}`));
          const field = match.kind === 'rcpt' ? 'received' : 'payments', mark = match.kind === 'transfer' ? 'stlIn' : 'stl';
          doc[field] = doc[field].map((x, i) => (i === match.i ? { ...x, [mark]: sid } : x));
          touched.set(match.id, doc); await t.set(`${col}/${match.id}`, doc);
        } else await exc({ kind: 'STATEMENT_UNMATCHED', bankId: p.bankId, stlId: sid, date: line.date, amount: line.amount, text: `${line.desc} ${line.ref}`.trim(), note: ambiguous ? 'More than one recorded payment could match — pick the right one.' : line.amount < 0 ? 'Money left the account with no matching payment in OfficeHub.' : 'Money came in with no matching receipt in OfficeHub.' });
      }
      // the statement's closing balance becomes the verified balance (source: statement)
      const withBal = fresh.filter((r) => r.balance != null).sort((x, y) => x.date.localeCompare(y.date) || x.k - y.k);
      const last = withBal[withBal.length - 1];
      if (last) await t.set(`erp_bal/${newId()}`, { bankId: p.bankId, amount: last.balance, asOf: last.date, source: 'STATEMENT', impId: id, at: now, by, note: `Closing balance in ${fileName}` });
      // payments recorded in OfficeHub in the statement's period but missing from it
      if (fresh.length) {
        const from = fresh.map((r) => r.date).sort()[0], to = fresh.map((r) => r.date).sort().slice(-1)[0];
        for (const { id: pid, data: py } of await t.list('erp_pay')) for (const x of py.payments || []) if ((x.bankId || py.bankId) === p.bankId && x.amount > 0 && !x.reversed && !x.stl && x.date >= from && daysBetween(x.date, to) >= 3 && !rr.some((m) => m.match?.id === pid)) await exc({ kind: 'PAYMENT_NOT_IN_STATEMENT', bankId: p.bankId, payId: pid, code: py.code, date: x.date, amount: -x.amount, text: `${py.payee} · ${x.ref}`, note: 'Recorded as paid in OfficeHub, but not on the bank statement for that period.' });
      }
    }
    if (p.kind === 'TALLY_BALANCES') {
      for (const r of fresh) {
        if (!r.bankId) { await exc({ kind: 'TALLY_LEDGER_UNMAPPED', date: r.asOf, amount: r.amount, text: r.ledger, note: 'This Tally ledger isn’t linked to a bank account in OfficeHub.' }); continue; }
        await t.set(`erp_bal/${newId()}`, { bankId: r.bankId, amount: r.amount, asOf: r.asOf, source: 'TALLY', impId: id, at: now, by, note: `Tally ledger “${r.ledger}”` });
      }
    }
    if (p.kind === 'TALLY_RECEIVABLES' || p.kind === 'TALLY_PAYABLES') {
      // a fresh snapshot of what Tally says is outstanding (earlier snapshots are kept, marked superseded)
      const side = p.kind === 'TALLY_RECEIVABLES' ? 'RECEIVABLE' : 'PAYABLE';
      for (const { id: oid, data: o } of (await t.list('erp_cust')).filter((x) => x.data.side === side && !x.data.superseded)) await t.set(`erp_cust/${oid}`, { ...o, superseded: id });
      const asOf = ymdOf(a.asOf || ymdIST(now), 'Outstanding as of');
      const internal = side === 'RECEIVABLE' ? await t.list('erp_rcpt') : await t.list('erp_inv'), allPays = side === 'PAYABLE' ? await t.list('erp_pay') : [];
      for (const r of p.rows) {
        await t.set(`erp_cust/${newId()}`, { side, party: r.party, ref: r.ref, date: r.date, due: r.due, amount: r.amount, asOf, impId: id, at: now, source: 'TALLY' });
        // compare with what OfficeHub has for the same bill — differences are exceptions, never silent changes
        const m = internal.find(({ data: x }) => side === 'RECEIVABLE' ? normRef(x.tallyRef || x.ref) === normRef(r.ref) && !!r.ref : normRef(x.invoiceNo) === normRef(r.ref) && !!r.ref && normRef(x.supplierName) === normRef(r.party));
        if (m) {
          const ours = side === 'RECEIVABLE' ? m.data.amount - receivedOf(m.data) : m.data.amount - (m.data.creditNotes || []).reduce((s, c) => s + c.amount, 0) - (m.data.advanceAdj || []).reduce((s, c) => s + c.amount, 0) - allPays.filter((y) => y.data.invoiceId === m.id).reduce((s, y) => s + paidOf(y.data), 0);
          if (ours !== r.amount) await exc({ kind: 'OUTSTANDING_MISMATCH', side, ref: r.ref, code: m.data.code, date: asOf, amount: r.amount, text: r.party, note: `Tally shows ${inr(r.amount)} outstanding; OfficeHub shows ${inr(ours)}.` });
        }
      }
      counts.imported = p.rows.length; // a snapshot is always the whole list
    }
    if (p.kind === 'TALLY_VOUCHERS') {
      // link Tally vouchers to OfficeHub payments / receipts (exact amount and date, or the voucher number already noted)
      const [pays, rcpts] = await Promise.all([t.list('erp_pay'), t.list('erp_rcpt')]);
      for (const r of fresh) {
        const isPay = /payment|purchase|journal/i.test(r.vtype), list = isPay ? pays : rcpts;
        const byRef = list.find(({ data: x }) => x.tallyRef && normRef(x.tallyRef) === normRef(r.number));
        const cands = byRef ? [byRef] : list.filter(({ data: x }) => (isPay ? (x.payments || []).some((y) => y.amount === r.amount && Math.abs(daysBetween(y.date, r.date)) <= 3) : (x.received || []).some((y) => y.amount === r.amount && Math.abs(daysBetween(y.date, r.date)) <= 3)) && (!r.party || normRef(isPay ? x.payee : x.customer).includes(normRef(r.party).slice(0, 6))));
        if (cands.length === 1) {
          const m = cands[0], col = isPay ? 'erp_pay' : 'erp_rcpt';
          if (!m.data.tallyRef) { await t.set(`${col}/${m.id}`, { ...m.data, tallyRef: r.number || r.guid, tallyGuid: r.guid || null }); m.data.tallyRef = r.number || r.guid; }
          counts.matched++;
        } else await exc({ kind: 'TALLY_VOUCHER_UNMATCHED', date: r.date, amount: isPay ? -r.amount : r.amount, text: `${r.vtype} ${r.number} · ${r.party}`.trim(), note: cands.length > 1 ? 'More than one OfficeHub record could match.' : 'No OfficeHub payment or receipt matches this voucher.' });
      }
    }
    const rec = { kind: p.kind, kindLabel: IMPORT_KINDS[p.kind], fileName, fileHash, bankId: p.bankId, at: now, by, counts, errors: p.errors.slice(0, 50), status: 'COMMITTED', source: str(a.source, 40) || 'FILE' };
    await t.set(`erp_imp/${id}`, rec);
    await audit('IMPORT_COMMITTED', { imp: id, kind: p.kind, fileName, ...counts });
    if (counts.exceptions) await notify(holders('acc'), { title: `${counts.exceptions} reconciliation exception${counts.exceptions === 1 ? '' : 's'} from ${IMPORT_KINDS[p.kind].toLowerCase()}`, body: fileName, go: { view: 'accounts', erpKind: 'imp' } }, { system: true });
    return { id, counts };
  },
  /** an exception is resolved by linking it to the right record, or explaining it — never by deleting it */
  'exc.resolve': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts resolves reconciliation exceptions.');
    const id = needId(a.id), x = await t.get(`erp_exc/${id}`);
    if (!x || x.status !== 'OPEN') bad('That exception is already resolved.');
    const note = need(text(a.note, 500), 'Explanation');
    let link = null;
    if (a.payId && x.stlId) {
      const p = await t.get(`erp_pay/${needId(a.payId)}`);
      if (!p) bad('Pick the payment.');
      const k = (p.payments || []).findIndex((y) => y.amount === -x.amount && !y.stl);
      if (k < 0) bad('That payment has no unmatched entry of this amount.');
      await t.set(`erp_pay/${a.payId}`, { ...p, payments: p.payments.map((y, i) => (i === k ? { ...y, stl: x.stlId } : y)) });
      const l = await t.get(`erp_stl/${x.stlId}`); if (l) await t.set(`erp_stl/${x.stlId}`, { ...l, status: 'MATCHED', match: { kind: 'pay', id: a.payId, code: p.code, how: 'matched by hand' } });
      link = p.code;
    }
    await t.set(`erp_exc/${id}`, { ...x, status: 'RESOLVED', resolvedBy: by, resolvedAt: now, note, link });
    await audit('RECONCILIATION_RESOLVED', { exc: id, kind: x.kind, note, link });
    return { ok: true };
  },
};
registerErp(imports);
