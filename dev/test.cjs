// Screenshots + checks at phone widths. Usage: node dev/test.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = process.argv[2] || '/tmp/claude-0/crew';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(8787);
(async () => {
  const b = await chromium.launch(); const errs = [];
  try {
    for (const w of [320, 430]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, hasTouch: true });
      const p = await ctx.newPage();
      p.on('pageerror', e => errs.push(w + ' ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(w + ' console ' + m.text()));
      await p.route('https://raw.githubusercontent.com/**', r => r.fulfill({ status: 404, body: '' }));
      await p.goto('http://localhost:8787/');
      await p.waitForTimeout(1200);
      const ov = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      console.log(w, 'scroll/client', ov);
      await p.screenshot({ path: `${out}/floor-${w}.png`, fullPage: true });
      await p.click('.tab[data-v="crew"]'); await p.waitForTimeout(400);
      await p.screenshot({ path: `${out}/crew-${w}.png`, fullPage: true });
      await p.click('.tab[data-v="floor"]'); await p.waitForTimeout(300);
      await p.click('.pod >> nth=0'); await p.waitForTimeout(500);
      await p.screenshot({ path: `${out}/sheet-${w}.png` });
      await p.click('[data-act="close"]'); await p.waitForTimeout(400);
      await p.click('#openSet'); await p.waitForTimeout(500);
      await p.screenshot({ path: `${out}/settings-${w}.png` });
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no errors');
})();
