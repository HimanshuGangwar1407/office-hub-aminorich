// Postgres connection + schema. Works with Neon (Vercel Storage → Neon) or any Postgres 13+.
import pg from 'pg';

let pool;
export function getPool() {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!raw) throw Object.assign(new Error('DATABASE_URL is not set. Add a Postgres database in Vercel → Storage, or set DATABASE_URL.'), { status: 500, code: 'config' });
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname) || process.env.DATABASE_SSL === 'false';
  url.searchParams.delete('sslmode'); url.searchParams.delete('channel_binding');
  pool = new pg.Pool({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true }, max: 4, idleTimeoutMillis: 10000 });
  return pool;
}

export const q = (text, params) => getPool().query(text, params);

let ready;
export function ensureSchema() {
  if (!ready) {
    ready = q(`
      CREATE SEQUENCE IF NOT EXISTS docs_v;
      CREATE TABLE IF NOT EXISTS docs (
        path    text PRIMARY KEY,
        parent  text NOT NULL,
        data    jsonb,
        v       bigint NOT NULL,
        deleted boolean NOT NULL DEFAULT false,
        at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS docs_v_idx ON docs (v);
      CREATE INDEX IF NOT EXISTS docs_parent_idx ON docs (parent);
      CREATE TABLE IF NOT EXISTS users (
        uid         text PRIMARY KEY,
        emp_id      text UNIQUE,
        login_email text,
        pw          text NOT NULL,
        ver         bigint NOT NULL,
        fails       int NOT NULL DEFAULT 0,
        lock_until  bigint NOT NULL DEFAULT 0,
        owner       boolean NOT NULL DEFAULT false,
        created     bigint NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (path text PRIMARY KEY, holder text NOT NULL, expires bigint NOT NULL);
      CREATE TABLE IF NOT EXISTS presence (peer text PRIMARY KEY, uid text NOT NULL, state jsonb, at bigint NOT NULL);
    `).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export const parentOf = (path) => path.split('/').slice(0, -1).join('/');

/** Write one document. op: set | update | delete. Returns the new version, or throws not_found for update on a missing doc. */
export async function writeDoc(client, op, path, data) {
  const parent = parentOf(path);
  if (op === 'set') {
    const r = await client.query(
      `INSERT INTO docs (path, parent, data, v, deleted, at) VALUES ($1, $2, $3, nextval('docs_v'), false, now())
       ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, v = EXCLUDED.v, deleted = false, at = now() RETURNING v`,
      [path, parent, data]);
    return Number(r.rows[0].v);
  }
  if (op === 'update') {
    const r = await client.query(
      `UPDATE docs SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb, v = nextval('docs_v'), at = now() WHERE path = $1 AND NOT deleted RETURNING v`,
      [path, data]);
    if (!r.rowCount) throw Object.assign(new Error('That record no longer exists.'), { status: 404, code: 'not_found' });
    return Number(r.rows[0].v);
  }
  if (op === 'delete') {
    const r = await client.query(`UPDATE docs SET data = NULL, deleted = true, v = nextval('docs_v'), at = now() WHERE path = $1 AND NOT deleted RETURNING v`, [path]);
    return r.rowCount ? Number(r.rows[0].v) : 0;
  }
  throw Object.assign(new Error('Unknown write.'), { status: 400, code: 'invalid_argument' });
}

/**
 * Run fn inside one database transaction, holding a lock that every finance / purchase / stores operation takes
 * (server/erp.js). Linked records (a payment and its invoice, a GRN and its purchase order) change together or not
 * at all, and two people can't create the same payment at the same moment. fn receives the helpers below.
 */
const ERP_LOCK = 4207311;
export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ERP_LOCK]);
    const out = await fn(txApi(client));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
function txApi(client) {
  return {
    get: async (path) => (await client.query('SELECT data FROM docs WHERE path = $1 AND NOT deleted', [path])).rows[0]?.data ?? null,
    list: async (parent) => (await client.query('SELECT path, data FROM docs WHERE parent = $1 AND NOT deleted', [parent])).rows.map((r) => ({ id: r.path.split('/').pop(), data: r.data })),
    set: (path, data) => writeDoc(client, 'set', path, data),
    update: (path, data) => writeDoc(client, 'update', path, data),
    // a unique key (duplicate-invoice fingerprints, imported rows): true when this call took it, false when it was already taken
    claim: async (path, data) => (await client.query(
      `INSERT INTO docs (path, parent, data, v, deleted, at) VALUES ($1, $2, $3, nextval('docs_v'), false, now())
       ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, v = EXCLUDED.v, deleted = false, at = now() WHERE docs.deleted RETURNING v`,
      [path, parentOf(path), data])).rowCount > 0,
    release: (path) => writeDoc(client, 'delete', path, null),
    // the next number in a series (PO-0001, GRN-0001…); never reused, even when the record is later cancelled
    next: async (name) => {
      const r = await client.query(
        `INSERT INTO docs (path, parent, data, v, deleted, at) VALUES ($1, 'seq', '{"n":1}'::jsonb, nextval('docs_v'), false, now())
         ON CONFLICT (path) DO UPDATE SET data = jsonb_build_object('n', COALESCE((docs.data->>'n')::int, 0) + 1), v = nextval('docs_v'), deleted = false, at = now()
         RETURNING (data->>'n')::int AS n`, [`seq/${name}`]);
      return `${name}-${String(r.rows[0].n).padStart(4, '0')}`;
    },
  };
}

export async function getDoc(path) {
  const r = await q('SELECT data, v FROM docs WHERE path = $1 AND NOT deleted', [path]);
  return r.rowCount ? { data: r.rows[0].data, v: Number(r.rows[0].v) } : null;
}
