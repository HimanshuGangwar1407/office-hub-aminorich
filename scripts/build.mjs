// Builds public/index.html from src/ (the app is plain HTML/CSS/JS — no framework, no bundler).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const ORDER = ['part1.html', 'vercel-shim.js', 'part2.js', 'part3.js', 'part4.js', 'part5.js', 'part6.js', 'part8.js', 'part9.js', 'part10.js', 'part11.js', 'part12.js', 'part13.js', 'part14-vercel.js', 'part15-complaints.js', 'part7.js'];
const body = ORDER.map(src).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0d6b57"><link rel="icon" href="/icon.svg"><link rel="manifest" href="/manifest.webmanifest">
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>
${body}
</body></html>
`;
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.writeFileSync(path.join(dir, 'public', 'index.html'), html);

if (process.argv.includes('--check')) {
  // syntax-check every inline script
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n;\n');
  const tmp = path.join(dir, '.check.cjs'); fs.writeFileSync(tmp, js);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' }); } finally { fs.unlinkSync(tmp); }
}
console.log(`Built public/index.html (${(html.length / 1024).toFixed(0)} KB)`);
