// Headless check for the multi-window demo.
//   node tools/verify.mjs --base http://127.0.0.1:4461 [--chrome "/path/to/chrome"]
// --base is the folder holding a local build (lattice-grid.min.js, modules/...), served over HTTP.
// Needs playwright-core (or playwright) resolvable from the current folder or this script's folder,
// and a Chrome/Chromium binary (CHROME env var or --chrome).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const BASE = arg('base');
if (!BASE) { console.error('usage: node tools/verify.mjs --base <url of local build> [--chrome <path>]'); process.exit(2); }
const CHROME = arg('chrome', process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  for (const from of [process.cwd() + '/', root + '/']) {
    const req = createRequire(from);
    for (const name of ['playwright-core', 'playwright']) {
      try { return req(name); } catch { /* try next */ }
    }
  }
  throw new Error('playwright-core is not installed (npm i playwright-core in a scratch folder and run from there).');
}
const { chromium } = loadPlaywright();

// Static server for this repo.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(25); }
  return null;
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errors.push(tag + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  };
  const channel = 'verify-' + Date.now();
  const q = '?base=' + encodeURIComponent(BASE) + '&channel=' + channel;
  const gridRows = (p, scope) => p.evaluate((s) => {
    const host = document.querySelector(s);
    return host && host.__lattice ? host.__lattice.rows.count() : -1;
  }, scope);

  // 1. launcher
  const a = await ctx.newPage(); watch(a, 'launcher');
  await a.goto(origin + '/index.html' + q);
  const shown = '.panel-body.grid > div';
  const t1 = await waitFor(async () => (await gridRows(a, shown)) > 0, 8000);
  check('launcher grid renders rows', t1 !== null, t1 !== null ? (await gridRows(a, shown)) + ' rows' : '');
  check('launcher shows feed note', (await a.textContent('#owner-note')).includes('This window holds the feed'));
  const seq0 = Number(await a.textContent('#seq'));
  await sleep(2500);
  const seq1 = Number(await a.textContent('#seq'));
  check('seq advances with the feed', seq1 > seq0, seq0 + ' -> ' + seq1);

  // 2. chart panel in a second page of the same browser context
  const b = await ctx.newPage(); watch(b, 'chart');
  await b.goto(origin + '/index.html' + q + '&panel=chart');
  const hidden = '.lg-hidden > div';
  const t2 = await waitFor(async () => (await gridRows(b, hidden)) > 0, 4000);
  check('chart window resyncs on join', t2 !== null, t2 !== null ? (await gridRows(b, hidden)) + ' incidents after ' + t2 + ' ms' : '');
  check('chart window opens no feed', (await b.textContent('#role')).includes('another window'));

  // 3. select two rows in the launcher grid
  const keys = await a.evaluate((s) => document.querySelector(s).__lattice.rows.get(0) && ['0', '1'].map((i) => document.querySelector(s).__lattice.rows.get(Number(i)).key), shown);
  await a.evaluate(([s, k]) => document.querySelector(s).__lattice.selection.set(k), [shown, keys]);
  const tSel = await waitFor(async () => (await gridRows(b, hidden)) === 2, 2000);
  check('selecting two rows narrows the chart window to exactly two', tSel !== null, tSel !== null ? 'in ' + tSel + ' ms' : 'chart grid holds ' + (await gridRows(b, hidden)));

  // 4. clear
  await a.evaluate((s) => document.querySelector(s).__lattice.selection.clear(), shown);
  const tClr = await waitFor(async () => (await gridRows(b, hidden)) > 2, 2000);
  check('clearing the selection restores the chart window', tClr !== null, tClr !== null ? 'in ' + tClr + ' ms' : '');

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  check('verify run', false, err.message);
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? failed + ' check(s) failed' : 'all ' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
