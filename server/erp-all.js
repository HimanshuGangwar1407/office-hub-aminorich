// Loads every ERP module so its commands are registered, then exposes the single entry point used by server/app.js.
import './erp-accounts.js';
import './erp-loans.js';
import './erp-purchase.js';
import './erp-stores.js';
import './erp-import.js';
import './erp-summary.js';
export { runErp } from './erp.js';
