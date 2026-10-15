<script>
/* ═════════════ Accounts: Tally & bank statement imports, reconciliation ═════════════
   Files are read in the browser (CSV, or Tally's XML voucher export), previewed on the server, then committed
   (server/erp-import.js). Tally is not connected live — the page says so; imports never write back to Tally. */

const IMP_KINDS = { BANK_STATEMENT: 'Bank statement', TALLY_BALANCES: 'Tally bank / cash balances', TALLY_RECEIVABLES: 'Tally outstanding receivables', TALLY_PAYABLES: 'Tally outstanding payables', TALLY_VOUCHERS: 'Tally payment / receipt vouchers' };
const IMP_FIELDS = {
  BANK_STATEMENT: [['date', 'Date', /date|txn|value/i], ['desc', 'Description', /desc|narr|particular|remark/i], ['ref', 'Reference / cheque no.', /ref|chq|cheque|utr/i], ['debit', 'Debit (withdrawal)', /debit|withdraw|dr\b/i], ['credit', 'Credit (deposit)', /credit|deposit|cr\b/i], ['amount', 'Amount (if one column)', /^amount$|amt/i], ['balance', 'Balance', /bal/i]],
  TALLY_BALANCES: [['ledger', 'Ledger', /ledger|particular|name|account/i], ['amount', 'Closing balance', /clos|bal|amount/i], ['date', 'As of date', /date|as on|as of/i]],
  TALLY_RECEIVABLES: [['party', 'Party', /party|customer|name|ledger/i], ['ref', 'Bill / invoice no.', /ref|bill|inv|no/i], ['date', 'Bill date', /^date|bill date|inv.*date/i], ['amount', 'Pending amount', /pend|outst|amount|bal/i], ['due', 'Due date', /due/i]],
  TALLY_VOUCHERS: [['date', 'Date', /date/i], ['vtype', 'Voucher type', /type/i], ['number', 'Voucher no.', /no|number/i], ['party', 'Party ledger', /party|ledger|particular/i], ['amount', 'Amount', /amount|value/i], ['guid', 'GUID', /guid|id/i], ['narration', 'Narration', /narr/i]],
};
IMP_FIELDS.TALLY_PAYABLES = IMP_FIELDS.TALLY_RECEIVABLES.map((f) => (f[0] === 'party' ? ['party', 'Party (supplier)', /party|supplier|name|ledger/i] : f));
const EXC_KIND = { STATEMENT_UNMATCHED: ['Not in OfficeHub', 't-bad'], PAYMENT_NOT_IN_STATEMENT: ['Not on statement', 't-warn'], TALLY_LEDGER_UNMAPPED: ['Ledger not linked', 't-warn'], OUTSTANDING_MISMATCH: ['Tally differs', 't-bad'], TALLY_VOUCHER_UNMATCHED: ['Voucher not matched', 't-warn'] };
const IMP = { file: null, kind: 'BANK_STATEMENT', headers: [], rows: [], map: {}, ledgers: {}, preview: null, hash: '', err: '' };

/* ── reading files ── */
function parseCsv(textIn) {
  const t = String(textIn).replace(/^﻿/, ''), firstLine = t.split(/\r?\n/)[0] || '';
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell.trim()); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some((x) => x !== '')) rows.push(row); row = []; cell = ''; } else cell += c;
  }
  row.push(cell.trim()); if (row.some((x) => x !== '')) rows.push(row);
  // the header is the first row with mostly text (banks often put account details above it)
  const h = rows.findIndex((r) => r.filter((x) => /[A-Za-z]/.test(x)).length >= Math.max(2, r.filter(Boolean).length * 0.6));
  const headers = (rows[h] || []).map((x, i) => x || `Column ${i + 1}`);
  return { headers, rows: rows.slice(h + 1).filter((r) => r.length > 1).map((r) => Object.fromEntries(headers.map((x, i) => [x, r[i] ?? '']))) };
}
const IMP_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Indian formats: 14/10/2026, 14-10-26, 14.10.2026, 14-Oct-2026, 1-Apr-24, 20261014, 2026-10-14 (day first, never month first) */
function toYmd(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/.exec(s); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[\- ]([A-Za-z]{3})[A-Za-z]*[\- ,]*(\d{2,4})$/.exec(s); if (m && IMP_MON[m[2].toLowerCase()]) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(IMP_MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s; // the server reports it as a bad date
}
/** Tally's XML export of vouchers (Day Book → Export → XML) */
function parseTallyXml(textIn) {
  const doc = new DOMParser().parseFromString(textIn, 'application/xml');
  if (doc.querySelector('parsererror')) fail('That isn’t a readable XML file.');
  const tx = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const rows = [...doc.getElementsByTagName('VOUCHER')].map((v) => {
    const party = tx(v, 'PARTYLEDGERNAME'), entries = [...v.getElementsByTagName('ALLLEDGERENTRIES.LIST'), ...v.getElementsByTagName('LEDGERENTRIES.LIST')];
    const pe = entries.find((e) => tx(e, 'LEDGERNAME') === party) || entries.sort((a, b) => Math.abs(parseFloat(tx(b, 'AMOUNT')) || 0) - Math.abs(parseFloat(tx(a, 'AMOUNT')) || 0))[0];
    return { date: toYmd(tx(v, 'DATE')), vtype: v.getAttribute('VCHTYPE') || tx(v, 'VOUCHERTYPENAME'), number: tx(v, 'VOUCHERNUMBER'), party, amount: String(Math.abs(parseFloat(pe ? tx(pe, 'AMOUNT') : '0') || 0).toFixed(2)), guid: tx(v, 'GUID'), narration: tx(v, 'NARRATION') };
  });
  return { headers: ['date', 'vtype', 'number', 'party', 'amount', 'guid', 'narration'], rows, xml: true };
}
async function sha256(buf) { const h = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function guessMap(kind, headers) {
  const out = {};
  for (const [k, , re] of IMP_FIELDS[kind]) out[k] = headers.find((h) => re.test(h) && !Object.values(out).includes(h)) || '';
  return out;
}
function impRows() {
  const F = IMP_FIELDS[IMP.kind], dateKeys = ['date', 'due'];
  return IMP.rows.map((r, i) => Object.fromEntries([...F.map(([k]) => [k, IMP.map[k] ? (dateKeys.includes(k) ? toYmd(r[IMP.map[k]]) : r[IMP.map[k]]) : '']), ['seq', i]]));
}

/* ── the tab ── */
function accImports() {
  erpUse('erp_imp', 'erp_exc', 'erp_stl', 'erp_cust');
  const exc = erpList('erp_exc').filter((x) => x.status === 'OPEN'), imps = erpList('erp_imp').slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const last = (k) => imps.find((x) => x.kind === k);
  const status = `<div class="grid two" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
    <div class="card body"><b>Tally</b> <span class="pill">Not connected</span><p class="small muted" style="margin:6px 0 0">Tally runs on the office network, which this cloud app can’t reach. Export from Tally and import the file here. Nothing is ever written back to Tally — it stays the official ledger.</p></div>
    <div class="card body"><b>Bank feeds</b> <span class="pill">Not connected</span><p class="small muted" style="margin:6px 0 0">Download the statement (CSV) from internet banking and import it. Never enter banking passwords or OTPs in OfficeHub.</p></div>
    <div class="card body"><b>Last imports</b><div class="small" style="margin-top:6px">${Object.entries(IMP_KINDS).map(([k, l]) => `<div>${esc(l)}: ${last(k) ? `${fmtDT(last(k).at)} ${srcPill('IMPORTED')}` : '<span class="muted">never</span>'}</div>`).join('')}</div></div></div>`;
  const F = IMP_FIELDS[IMP.kind];
  const pv = IMP.preview;
  const form = `<form data-f="erp-imp-preview" class="grid">
    <div class="grid two"><label class="f">What are you importing?<select class="i" id="im-k" name="kind" data-a="erp-imp-kind">${opts(Object.entries(IMP_KINDS), IMP.kind)}</select></label>
      ${IMP.kind === 'BANK_STATEMENT' ? `<label class="f">Bank account<select class="i" id="im-b" name="bankId" required>${bankOpts(ui('imBank', ''))}</select></label>` : IMP.kind.startsWith('TALLY_R') || IMP.kind === 'TALLY_PAYABLES' ? `<label class="f">Outstanding as of<input type="date" class="i" id="im-as" name="asOf" value="${today()}" max="${today()}"></label>` : '<span></span>'}
      <label class="f full">File (${IMP.kind === 'TALLY_VOUCHERS' ? 'Tally XML export or CSV' : 'CSV'})<input type="file" class="i" id="im-f" name="file" accept=".csv,.txt,.xml,text/csv,text/xml,application/xml" data-a="erp-imp-file"></label></div>
    ${IMP.err ? `<p class="small" style="color:var(--bad)">${esc(IMP.err)}</p>` : ''}
    ${IMP.rows.length ? `<div><b class="small">${IMP.rows.length} rows read from ${esc(IMP.file?.name || '')}.</b> ${IMP.xml ? '' : 'Check which column is which:'}</div>
      ${IMP.xml ? '' : `<div class="grid two" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${F.map(([k, l]) => `<label class="f">${esc(l)}<select class="i" name="map_${k}" data-a="erp-imp-map" data-k="${k}">${opts(IMP.headers.map((h) => [h, h]), IMP.map[k] || '', '— not in the file —')}</select></label>`).join('')}</div>`}
      <div class="row"><span style="flex:1"></span><button class="btn pri">Preview</button></div>` : ''}
  </form>`;
  const previewHtml = pv ? `<div class="card body" style="background:var(--sunk);border:0">
    <h3>Preview — nothing imported yet</h3>
    <div class="row small" style="gap:14px"><span>Rows: <b>${pv.total}</b></span><span>New: <b>${pv.new}</b></span><span>Already imported (skipped): <b>${pv.duplicates}</b></span><span>Errors: <b class="${pv.errorCount ? 'v bad' : ''}">${pv.errorCount}</b></span>${pv.recon ? `<span>Match recorded payments / receipts: <b>${pv.recon.matched}</b></span><span>Will become exceptions: <b>${pv.recon.unmatched}</b></span>` : ''}</div>
    ${pv.fileSeen ? '<p class="small" style="color:var(--bad)">This exact file was imported before — committing will be refused.</p>' : ''}
    ${pv.errors.length ? `<details open><summary class="small">Errors</summary><ul class="small">${pv.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
    ${(pv.unmappedLedgers || []).length ? `<div><b class="small">Link Tally ledgers to bank accounts</b>${pv.unmappedLedgers.map((l) => `<label class="f">${esc(l)}<select class="i" data-a="erp-imp-ledger" data-l="${esc(l)}">${bankOpts(IMP.ledgers[l] || '', 'Not a bank account (skip)')}</select></label>`).join('')}<button type="button" class="btn sm" data-a="erp-imp-repreview">Preview again</button></div>` : ''}
    <div class="tbl-wrap" style="max-height:260px;overflow:auto"><table class="t"><thead><tr>${Object.keys(pv.rows[0] || {}).filter((k) => !['k', 'dup', 'seq'].includes(k)).map((k) => `<th>${esc(k)}</th>`).join('')}<th></th></tr></thead><tbody>${pv.rows.slice(0, 60).map((r) => `<tr>${Object.entries(r).filter(([k]) => !['k', 'dup', 'seq'].includes(k)).map(([k, x]) => `<td class="small">${typeof x === 'number' && ['amount', 'balance'].includes(k) ? inr(x) : esc(x ?? '')}</td>`).join('')}<td>${r.dup ? '<span class="pill">Already imported</span>' : ''}${pv.recon?.sample?.find((s) => s.k === r.k)?.match ? `<span class="pill t-ok">${esc(pv.recon.sample.find((s) => s.k === r.k).match)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="row">${pv.errorCount ? '<label class="row small" style="gap:6px"><input type="checkbox" id="im-skip"> Import the valid rows and skip the ones with errors</label>' : ''}<span style="flex:1"></span><button class="btn" data-a="erp-imp-clear">Start again</button><button class="btn pri" data-a="erp-imp-commit" ${pv.new ? '' : 'disabled'}>Import ${pv.new} row${pv.new === 1 ? '' : 's'}</button></div>
  </div>` : '';
  const excTbl = dataTable('impX', exc, [
    { k: 'kind', label: 'Exception', v: (x) => x.kind, html: (x) => pill(EXC_KIND, x.kind) }, { k: 'date', label: 'Date', v: (x) => x.date || '', html: (x) => (x.date ? fmtD(x.date) : '—') },
    { k: 'what', label: 'What', v: (x) => x.text || '', html: (x) => `${esc(x.text || '')}${x.code ? ` · ${esc(x.code)}` : ''}<div class="tiny muted">${esc(x.note || '')}</div>` },
    { k: 'acct', label: 'Account', v: (x) => (x.bankId ? bankName(x.bankId) : '') }, { k: 'amt', label: 'Amount', num: true, v: (x) => x.amount || 0, html: (x) => (x.amount != null ? inr(x.amount, { sign: true }) : '—') },
    { k: 'act', label: '', v: () => '', html: (x) => `<button class="btn sm" data-a="erp-exc" data-id="${x.id}">Resolve</button>` },
  ], { name: 'Reconciliation exceptions', empty: 'No open exceptions.' });
  const histTbl = dataTable('impH', imps, [
    { k: 'at', label: 'When', v: (x) => x.at, html: (x) => `${fmtDT(x.at)}<div class="tiny muted">${esc(nameOf(x.by))}</div>` }, { k: 'kind', label: 'Import', v: (x) => x.kindLabel, html: (x) => `${esc(x.kindLabel)}<div class="tiny muted">${esc(x.fileName)}${x.bankId ? ' · ' + esc(bankName(x.bankId)) : ''}</div>` },
    { k: 'n', label: 'Imported', num: true, v: (x) => x.counts.imported }, { k: 'dup', label: 'Skipped (already in)', num: true, v: (x) => x.counts.duplicates }, { k: 'err', label: 'Errors', num: true, v: (x) => x.counts.errors },
    { k: 'm', label: 'Matched', num: true, v: (x) => x.counts.matched }, { k: 'x', label: 'Exceptions', num: true, v: (x) => x.counts.exceptions },
  ], { name: 'Import history', pageSize: 15, empty: 'Nothing imported yet.' });
  const snap = (side) => erpList('erp_cust').filter((c) => c.side === side && !c.superseded);
  const snapCard = (side, title) => { const l = snap(side); return l.length ? card(`${title} · ${inr(sumBy(l, (c) => c.amount))} ${srcPill('IMPORTED')} <span class="tiny muted">as of ${fmtD(l[0].asOf)}</span>`, dataTable('impC' + side, l, [{ k: 'party', label: 'Party', v: (c) => c.party }, { k: 'ref', label: 'Bill', v: (c) => c.ref || '' }, { k: 'date', label: 'Bill date', v: (c) => c.date || '', html: (c) => (c.date ? fmtD(c.date) : '—') }, { k: 'due', label: 'Due', v: (c) => c.due || '', html: (c) => (c.due ? fmtD(c.due) : '—') }, { k: 'amt', label: 'Outstanding', num: true, v: (c) => c.amount, html: (c) => inr(c.amount) }], { name: title, pageSize: 15 }), { list: true }) : ''; };
  return `${status}${card('Import a file', form + previewHtml)}${card(`Reconciliation exceptions · ${exc.length}`, excTbl, { list: true })}${snapCard('RECEIVABLE', 'Receivables per Tally')}${snapCard('PAYABLE', 'Payables per Tally')}${card('Import history', histTbl, { list: true })}`;
}
function excModal(id) {
  const x = erpGet('erp_exc', id);
  if (!x) return `${mhead('Exception')}<div class="body">${empty('Already resolved.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const cands = x.kind === 'STATEMENT_UNMATCHED' && x.amount < 0 ? erpList('erp_pay').filter((p) => (p.payments || []).some((y) => y.amount === -x.amount && !y.stl)) : [];
  return `${mhead(`${(EXC_KIND[x.kind] || [x.kind])[0]}`, `${x.date ? fmtD(x.date) : ''} · ${x.amount != null ? inr(x.amount, { sign: true }) : ''}`)}<form data-f="erp-exc" data-id="${x.id}"><div class="body grid">
    <p class="small">${esc(x.text || '')}<br><span class="muted">${esc(x.note || '')}</span></p>
    ${cands.length ? `<label class="f">Match to a recorded payment (optional)<select class="i" name="payId" id="ex-p">${opts(cands.map((p) => [p.id, `${p.code} · ${p.payee} · ${inr(p.amountApproved ?? p.amountReq)}`]), '', 'Don’t match')}</select></label>` : ''}
    <label class="f">Explanation (kept with the exception)<input class="i" name="note" id="ex-n" required placeholder="e.g. bank charges — booked in Tally as JV 88"></label>
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Resolve</button></footer></form>`;
}
ACC_TABS_EXTRA.push(['imp', 'Imports & reconciliation', () => accImports(), () => erpList('erp_exc').filter((x) => x.status === 'OPEN').length || '']);

async function impReadFile(file) {
  IMP.err = ''; IMP.preview = null; IMP.file = file;
  const buf = await file.arrayBuffer(); IMP.hash = await sha256(buf);
  const textIn = new TextDecoder().decode(buf);
  const p = /^\s*</.test(textIn) ? parseTallyXml(textIn) : parseCsv(textIn);
  if (p.xml) IMP.kind = 'TALLY_VOUCHERS';
  IMP.headers = p.headers; IMP.rows = p.rows; IMP.xml = !!p.xml; IMP.map = p.xml ? Object.fromEntries(p.headers.map((h) => [h, h])) : guessMap(IMP.kind, p.headers);
  if (!IMP.rows.length) IMP.err = 'No rows found in the file.';
}
async function impPreview() {
  const args = { kind: IMP.kind, bankId: $('#im-b')?.value || undefined, asOf: $('#im-as')?.value || undefined, rows: impRows(), map: IMP.ledgers, fileName: IMP.file?.name, fileHash: IMP.hash };
  if (IMP.kind === 'BANK_STATEMENT') S.ui.imBank = args.bankId;
  // the server accepts requests up to about 4.5 MB (Vercel's limit)
  if (JSON.stringify(args).length > 4e6) fail('This file is too large to import in one go. Split it (for example by month) and import the parts.');
  IMP.preview = await erpCall('imp.preview', args); IMP.args = args; schedule();
}
Object.assign(ERP_ACTIONS, {
  'erp-imp-kind': () => {}, 'erp-imp-file': () => {}, 'erp-imp-map': () => {}, 'erp-imp-ledger': () => {},
  'erp-imp-clear': () => { Object.assign(IMP, { file: null, headers: [], rows: [], map: {}, ledgers: {}, preview: null, hash: '', err: '' }); const f = $('#im-f'); if (f) f.value = ''; schedule(); },
  'erp-imp-repreview': () => erpAct(impPreview),
  'erp-imp-commit': () => erpAct(async () => {
    const r = await erpCall('imp.commit', { ...IMP.args, map: IMP.ledgers, skipErrors: !!$('#im-skip')?.checked });
    Object.assign(IMP, { file: null, headers: [], rows: [], map: {}, preview: null, hash: '' }); const f = $('#im-f'); if (f) f.value = ''; schedule();
    toast(`Imported ${r.counts.imported} · matched ${r.counts.matched} · ${r.counts.exceptions} exception${r.counts.exceptions === 1 ? '' : 's'} · ${r.counts.duplicates} already in`);
  }),
  'erp-exc': (el) => openModal(() => excModal(el.dataset.id)),
});
Object.assign(ERP_FORMS, {
  'erp-imp-preview': () => erpAct(impPreview),
  'erp-exc': (form, fd, v) => erpAct(async () => { await erpCall('exc.resolve', { id: form.dataset.id, note: v('note'), payId: v('payId') || undefined }); closeModal(); }, 'Resolved'),
});
// file, type, column and ledger choices are read when they change (not on click)
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'im-k') { IMP.kind = el.value; IMP.preview = null; if (IMP.headers.length && !IMP.xml) IMP.map = guessMap(IMP.kind, IMP.headers); schedule(); }
  else if (el.id === 'im-f' && el.files?.[0]) act(async () => { await impReadFile(el.files[0]); schedule(); });
  else if (el.dataset?.a === 'erp-imp-map') { IMP.map[el.dataset.k] = el.value; IMP.preview = null; }
  else if (el.dataset?.a === 'erp-imp-ledger') { if (el.value) IMP.ledgers[el.dataset.l] = el.value; else delete IMP.ledgers[el.dataset.l]; }
});
</script>
