# OfficeHub ERP — Accounts, Purchase, Stores and Management

This adds department modules to OfficeHub on top of the existing app (attendance, leave, tasks, HR, approvals, chat).
Tally stays the official accounting system: OfficeHub plans, controls and evidences payments, and imports from Tally
and bank statements — it never writes back to Tally.

## Modules

| Menu | Who | What |
|---|---|---|
| **Accounts** | `acc` | Dashboard, bank accounts and verified balances, receipts, payment requests (maker-checker), cash-flow forecast, EMIs & loans, funds calendar, imports & reconciliation |
| **Purchase** | everyone (requisitions); `pur` for the rest | Dashboard, requisitions, purchase orders (versioned), advances, supplier invoices, suppliers |
| **Stores** | `sto` | Expected deliveries, goods receipts (GRN) and service acceptance, inventory and stock movements |
| **Finance setup** | administrators | Who has which permission, approval limits, cash buffer, tolerances, EMI reminder days |
| **Management → Finance & purchase** | `fin` (directors by default) | Company totals computed on the server — no access to the records behind them |

## Permissions (server-enforced — `server/erp-perms.js`)

| Permission | Meaning |
|---|---|
| `acc` | Accounts everyday work. Members of a department with code `ACC` get it automatically. |
| `acc.approve` | Approve payments, up to the person's payment limit |
| `pur` | Purchase everyday work (department code `PUR`) |
| `pur.approve` | Approve requisitions, POs, suppliers, invoice differences — up to the purchase limit |
| `sto` | Stores everyday work (department code `STO` / `WH`) |
| `sto.verify` | Verify goods receipts, record inspections, stock adjustments |
| `fin` | Management summary (directors get it automatically) |
| `erp.admin` | Finance setup rules (administrators get it automatically) |

Rules that apply to everyone, administrators included:
- Nobody verifies or approves their own payment request; the verifier can't also approve it.
- Approvals are limited by the approver's limit.
- A payment is "paid" only with a bank reference (UTR / cheque number), and the same reference can't be used twice on an account.
- Goods are received only by Stores and verified by a different person; receipts are corrected by reversal, never edited.
- Supplier bank details go live only after a different Accounts person verifies them with evidence.
- Every finance change is in the audit log.

## Duplicate-payment controls (the main business problem)

- **Invoices**: same supplier + invoice number is blocked whatever the spacing, punctuation, case or zero-padding.
  Near-duplicates (same amount within a week, similar number) are shown before saving. An approver may override with a reason (audited).
- **Liability-based payments**: an invoice's payable = invoice − credit notes − adjusted advances − payments made. A new payment
  request can never exceed that, minus requests already open for it.
- **Advances**: limited by the PO's terms; must be adjusted against the invoice before the balance is approved.
- **Eligibility checks** at approval: PO approved, invoice verified, material received and verified, inspection complete,
  advances adjusted, within the remaining payable, three-way match, no duplicate warning. A failed check blocks approval
  unless the approver records an exception (audited).
- **Repeated clicks / concurrent requests**: every finance change runs in one database transaction holding one lock
  (`server/db.js withTx`), and requests carry an idempotency key.

## Data model

Records are documents in the existing `docs` table (same sync, permissions and live updates as the rest of the app):

| Collection | Holds |
|---|---|
| `erp_cfg` | Finance settings |
| `erp_bank`, `erp_bal` | Bank accounts (last 4 digits only), verified balances (source + date) |
| `erp_rcpt` | Expected and received customer receipts |
| `erp_pay` | Every payment request: suppliers, advances, EMIs, salaries, rent, transfers… (one record per payment — Purchase never keeps its own) |
| `erp_loan` | Loans and their EMI schedules |
| `erp_sup`, `erp_supbank` | Suppliers; their bank details (Accounts only) |
| `erp_pr`, `erp_po`, `erp_inv`, `erp_grn` | Requisitions, purchase orders, supplier invoices, goods receipts |
| `erp_item`, `erp_stk` | Items; stock movements (stock = their sum) |
| `erp_imp`, `erp_stl`, `erp_cust`, `erp_exc` | Import history, statement lines, Tally outstanding snapshots, reconciliation exceptions |
| `erp_key` | Server-only unique keys (duplicate invoices, UTRs, imported rows and files, idempotency) |

Money is stored as whole paise (integers) and quantities as thousandths — never floating point. Business dates are IST.
No migration is needed: the collections are created as they are used, and existing data is untouched.

## Environment variables

Nothing new is required. Existing: `DATABASE_URL`, `SESSION_SECRET`, `SETUP_KEY`, optional `RESEND_API_KEY`, `MAIL_FROM`.

Optional: `CRON_SECRET` — enables `GET /api/cron/erp` (EMI reminders and overdue flags on a schedule). To use it, add a
Vercel Cron job calling `/api/cron/erp` daily (Vercel sends `Authorization: Bearer $CRON_SECRET`). Without it, the same
check runs whenever someone in Accounts opens the app.

## Deployment checklist

1. Merge the branch to `main` only after review; Vercel deploys `public/` and `api/` as before (no build step on Vercel).
2. Before deploying, take a database backup (Neon: create a branch or note the restore point time).
3. After deploying, as an administrator open **Finance setup**:
   - give department codes `ACC`, `PUR`, `STO` to the Accounts, Purchase and Stores departments (Settings → departments), or grant `acc` / `pur` / `sto` to people directly;
   - grant `acc.approve` / `pur.approve` with limits to approvers, and `sto.verify` to Stores verifiers;
   - set the cash buffer, tolerances and EMI reminder days.
4. Accounts adds bank accounts with a verified opening balance, then imports the latest statements and Tally outstanding lists.
5. Tell staff that payments are now made only against approved requests, and that supplier bank changes need verification.

## Backup and rollback

- **Data**: use Neon point-in-time restore (or a branch taken before deployment). The ERP adds documents only; it does not change existing records' shape.
- **Code**: Vercel → Deployments → *Instant Rollback* to the previous deployment. Finance records created meanwhile stay in the database and reappear when the feature is deployed again.

## Not done yet / known limits

- **Tally live connection**: TallyPrime's XML/ODBC server runs on the office network, which Vercel can't reach. A small connector at the office could send rows to the same import commands. Until then: file imports (CSV, Tally XML vouchers).
- **Bank feeds**: none; statements are imported as CSV. Never store internet-banking credentials.
- **Excel (.xlsx) and PDF imports**: save as CSV first. Exports are Excel (tables) and print.
- **MFA** for privileged accounts and **rate limiting** on the API are not implemented (the existing app has neither); recommended before wider rollout.
- **Approval matrix by category / department**: approval limits are per person (one for payments, one for purchase).
- **Services**: accepted by Purchase / Stores with a service acceptance record (milestones are lines on the PO).

## Tests

- `node scripts/test-erp.mjs` — 47 rule tests (money, permissions, maker-checker, duplicates, forecast, EMIs, purchase,
  stores, three-way match, imports, summary), against an in-memory database with transactions.
- The existing `scripts/test-*.mjs` suites still pass.
