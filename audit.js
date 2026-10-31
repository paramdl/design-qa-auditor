#!/usr/bin/env node
/**
 * Website Design QA Tool
 * ----------------------
 * Detects page sections, screenshots each one, exports computed CSS,
 * compares against a design-system spec and writes a developer-ready
 * issue report (report.md + report.html + css-export.json/csv).
 *
 * Usage:
 *   node audit.js <url> [more urls...] [--ds design-systems/foo.json]
 *                 [--out runs] [--width 1440] [--full-page] [--headed]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pageExtract } = require('./lib/page-extract');
const { compare } = require('./lib/compare');
const { writeReports } = require('./lib/report');

function parseArgs(argv) {
  const args = { urls: [], ds: null, out: 'runs', width: 1440, height: 900, fullPage: false, headed: false, keepOverlays: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ds') args.ds = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--width') args.width = +argv[++i];
    else if (a === '--height') args.height = +argv[++i];
    else if (a === '--full-page') args.fullPage = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--keep-overlays') args.keepOverlays = true;
    else if (!a.startsWith('--')) args.urls.push(a.startsWith('http') ? a : 'https://' + a);
  }
  return args;
}

async function auditUrl(browser, url, args, ds, dsName) {
  const context = await browser.newContext({ viewport: { width: args.width, height: args.height } });
  const page = await context.newPage();
  console.log(`\n▶ ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => console.log('  (networkidle timeout — continuing)'));

  // lazy-load: scroll through the page so below-fold content/fonts render
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        y += 800;
        window.scrollTo(0, y);
        if (y < document.body.scrollHeight) setTimeout(step, 120);
        else { window.scrollTo(0, 0); setTimeout(resolve, 400); }
      };
      step();
    });
  });
  await page.waitForTimeout(500);

  // hide floating overlays (promo popups, chat launchers, modals) so they don't
  // pollute screenshots or style extraction; skip with --keep-overlays
  if (!args.keepOverlays) {
    const hidden = await page.evaluate(() => {
      let n = 0;
      document.querySelectorAll('[role="dialog"], [aria-modal="true"]').forEach((el) => { el.style.setProperty('display', 'none', 'important'); n++; });
      document.querySelectorAll('body > div, body > aside').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && (+cs.zIndex || 0) > 50) { el.style.setProperty('display', 'none', 'important'); n++; }
      });
      return n;
    });
    if (hidden) console.log(`  ${hidden} floating overlay(s) hidden (use --keep-overlays to include them)`);
  }

  const data = await page.evaluate(pageExtract);
  console.log(`  ${data.sections.length} sections detected`);

  // output dir: runs/<host><path>-<timestamp>/
  const u = new URL(url);
  const slug = (u.hostname + u.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const outDir = path.resolve(args.out, `${slug}-${stamp}`);
  const shotDir = path.join(outDir, 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });

  // per-section screenshots (clip from full-page coordinates)
  const screenshots = {};
  for (const sec of data.sections) {
    try {
      const clipH = Math.min(sec.height, 4000);
      const file = `screenshots/${String(sec.index).padStart(2, '0')}-${sec.kind}.png`;
      await page.screenshot({
        path: path.join(outDir, file),
        clip: { x: 0, y: sec.top, width: args.width, height: clipH },
        fullPage: true,
      });
      screenshots[sec.index] = file;
      console.log(`  📸 ${file}`);
    } catch (e) {
      console.log(`  ⚠ screenshot failed for section ${sec.index}: ${e.message.split('\n')[0]}`);
    }
  }
  if (args.fullPage) {
    await page.screenshot({ path: path.join(outDir, 'screenshots/full-page.png'), fullPage: true });
    console.log('  📸 screenshots/full-page.png');
  }

  const issues = ds ? compare(data, ds) : [];
  writeReports({ data, issues, screenshots, outDir, dsName });

  const c = { high: 0, medium: 0, low: 0 };
  issues.forEach((i) => c[i.severity]++);
  console.log(`  Issues: 🔴 ${c.high}  🟠 ${c.medium}  🟡 ${c.low}${ds ? '' : '  (no --ds given: extraction only, no comparison)'}`);
  console.log(`  ✅ Report: ${path.join(outDir, 'report.html')}`);

  await context.close();
  return { outDir, issues, data };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.urls.length) {
    console.log('Usage: node audit.js <url> [more urls...] [--ds design-systems/xxx.json] [--out dir] [--width 1440] [--full-page] [--headed]');
    process.exit(1);
  }
  let ds = null;
  let dsName = '(none — extraction only)';
  if (args.ds) {
    ds = JSON.parse(fs.readFileSync(args.ds, 'utf8'));
    dsName = path.basename(args.ds);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed }).catch(() => chromium.launch({ headless: !args.headed }));
  let failed = false;
  for (const url of args.urls) {
    try {
      await auditUrl(browser, url, args, ds, dsName);
    } catch (e) {
      failed = true;
      console.error(`  ✖ ${url}: ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
