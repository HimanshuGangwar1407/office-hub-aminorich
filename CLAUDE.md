# OfficeHub — notes for Claude Code

Office management app for Aminorich Nutrients, hosted on Vercel with a Postgres (Neon) database.

## Layout
- `src/` — the app (plain HTML/CSS/JS, no framework). `part1.html` = styles + page shell, `part2…13.js` = features, `part7.js` = routing + boot (must stay last), `vercel-shim.js` = browser ↔ server bridge, `part14-vercel.js` = server sign-in overrides.
- `public/index.html` — GENERATED from `src/` by `node scripts/build.mjs`. Never edit it by hand. Vercel serves `public/` as-is (no build step on Vercel).
- `server/` — API logic (`app.js` routes + access rules, `auth.js` sessions/passwords, `db.js` Postgres). `api/main.js` is the single Vercel Function; `vercel.json` rewrites `/api/*` to it.
- Accounts / Purchase / Stores / Management ("ERP"): `server/erp*.js` (commands via `POST /api/erp`, one transaction each; permissions in `erp-perms.js`) and `src/part19–25`. Their records (`erp_*`) are never written through `POST /api/write`. Money is integer paise. See `docs/ERP.md`.

## Every change
1. Edit files in `src/` (or `server/`).
2. Run `npm run check` — rebuilds `public/index.html` and syntax-checks every script. It must pass.
   Finance rules: `node scripts/test-erp.mjs`.
3. Commit BOTH `src/` and `public/index.html`.

## Rules
- Later script parts override earlier ones by redeclaring functions; never redeclare a `const`/`let` from another part (it breaks the whole page).
- Salary data (`pay`, `payroll`, `fines`), accounts and access rules are enforced in `server/app.js` — keep server checks when adding features; the browser is not trusted.
- Never commit `officehub-data.json` or any `.env` file. Secrets live in Vercel environment variables (`DATABASE_URL`, `SESSION_SECRET`, `SETUP_KEY`, optional `RESEND_API_KEY`, `MAIL_FROM`).
- Local run: `cp .env.example .env`, fill it in, then `node --env-file=.env scripts/dev-server.mjs` (http://localhost:3000).
