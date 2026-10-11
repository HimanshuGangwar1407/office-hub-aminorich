# Run OfficeHub in VS Code

1. Install **Node.js LTS** (nodejs.org) and **VS Code** (code.visualstudio.com).
2. Unzip this folder, then in VS Code: **File → Open Folder…** → choose it. Accept the recommended extensions (includes **Claude Code**).
3. Open the terminal (**Ctrl+`**) and run: `npm install`
4. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — easiest: copy it from Vercel → your project → Settings → Environment Variables (the Neon one), or use any Postgres.
   - `SESSION_SECRET` — any random text, 32+ characters.
   - `SETUP_KEY` — any text, 12+ characters.
5. Press **F5** (or Run → Start Debugging → “Run OfficeHub”). Open http://localhost:3000
   - Empty database? Open http://localhost:3000/setup.html and import `officehub-data.json`, then “Create your account” with AMR001 + your email.

Edit files in `src/` only — `public/index.html` is generated (Ctrl+Shift+B rebuilds it). See `CLAUDE.md` for how the code is organised; Claude Code reads it automatically.
