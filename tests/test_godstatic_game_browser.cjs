#!/usr/bin/env node
'use strict';

/**
 * GODstatic browser regression tests: clean-player and returning-player flows.
 *
 * Usage:
 *   npm install --save-dev playwright
 *   npx playwright install chromium
 *   node test_godstatic_game_browser.cjs /path/to/GODstatic_Immersive_Prototype.html
 *   node test_godstatic_game_browser.cjs http://127.0.0.1:8788/
 *
 * With system Chromium:
 *   CHROMIUM_PATH=/usr/bin/chromium node test_godstatic_game_browser.cjs ./prototype.html
 *
 * The script serves the local HTML on an ephemeral 127.0.0.1 port. It does not
 * open or modify the live site, connectors, or production browser storage. The
 * returning-player test seeds only the test browser context with four solved
 * stages. It never forces the Hidden Hand open; if the gate fails, downstream
 * gameplay tests are marked SKIP rather than reported as passes.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    console.error('Missing Playwright. Install with: npm install --save-dev playwright');
    process.exit(2);
  }
}

const defaultSource = '/home/ubuntu/upload/GODstatic_Immersive_Prototype(2).html';
const input = process.argv[2] || defaultSource;
const isUrl = /^https?:\/\//i.test(input);
let targetUrl = '';
let sourcePath = '';
if (isUrl) {
  try {
    targetUrl = new URL(input).toString();
  } catch {
    console.error(`Invalid test URL: ${input}`);
    process.exit(2);
  }
} else {
  sourcePath = path.resolve(input);
}
if (!isUrl && !fs.existsSync(sourcePath)) {
  console.error(`HTML file not found: ${sourcePath}`);
  console.error('Pass an HTML file path or an HTTP(S) URL as the first argument.');
  process.exit(2);
}
const html = isUrl ? '' : fs.readFileSync(sourcePath, 'utf8');
const results = [];
let origin = isUrl ? new URL(targetUrl).origin : '';

function pass(name, detail = '') {
  results.push({ name, status: 'PASS' });
  console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, error) {
  const detail = error && error.message ? error.message : String(error);
  results.push({ name, status: 'FAIL', detail });
  console.log(`FAIL: ${name} — ${detail}`);
}
function skip(name, reason) {
  results.push({ name, status: 'SKIP', detail: reason });
  console.log(`SKIP: ${name} — ${reason}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, typeof detail === 'string' ? detail : '');
    return true;
  } catch (error) {
    fail(name, error);
    return false;
  }
}
function makeServer() {
  return http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  });
}
function monitor(page) {
  const state = { pageErrors: [], consoleErrors: [], externalRequests: [] };
  page.on('pageerror', error => state.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') state.consoleErrors.push(message.text());
  });
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      state.externalRequests.push(url);
    }
  });
  return state;
}
async function inspectHandlers(page) {
  return page.evaluate(() => ({
    stages: [...document.querySelectorAll('.stage')].every(el => typeof el.onclick === 'function'),
    decode: typeof document.getElementById('decode')?.onclick === 'function',
    enterKey: typeof document.getElementById('token')?.onkeydown === 'function',
    factions: [...document.querySelectorAll('.faction')].every(el => typeof el.onclick === 'function'),
    resolve: typeof document.getElementById('resolve')?.onclick === 'function',
    draw: typeof document.getElementById('draw')?.onclick === 'function',
    cards: [...document.querySelectorAll('#handCards .card')].length === 3 &&
      [...document.querySelectorAll('#handCards .card')].every(el => typeof el.onclick === 'function'),
  }));
}
async function auditStructure(page, label) {
  return step(`${label}: DOM IDs, anchors, and handlers`, async () => {
    const audit = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
      const script = [...document.scripts].map(el => el.textContent || '').join('\n');
      const refs = new Set();
      for (const pattern of [
        /\$\(\s*['"]([^'"]+)['"]\s*\)/g,
        /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g,
      ]) for (const match of script.matchAll(pattern)) refs.add(match[1]);
      for (const match of script.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (match[1].startsWith('#')) refs.add(match[1].slice(1));
      }
      const badAnchors = [...document.querySelectorAll('a[href^="#"]')]
        .map(a => a.getAttribute('href').slice(1))
        .filter(id => id && !document.getElementById(id));
      const handlers = {
        stages: [...document.querySelectorAll('.stage')].every(el => typeof el.onclick === 'function'),
        decode: typeof document.getElementById('decode')?.onclick === 'function',
        enterKey: typeof document.getElementById('token')?.onkeydown === 'function',
        factions: [...document.querySelectorAll('.faction')].every(el => typeof el.onclick === 'function'),
        resolve: typeof document.getElementById('resolve')?.onclick === 'function',
        draw: typeof document.getElementById('draw')?.onclick === 'function',
        cards: [...document.querySelectorAll('#handCards .card')].length === 3 &&
          [...document.querySelectorAll('#handCards .card')].every(el => typeof el.onclick === 'function'),
      };
      return {
        idCount: ids.length,
        duplicates,
        missing: [...refs].filter(id => !ids.includes(id)),
        badAnchors,
        missingHandlers: Object.entries(handlers).filter(([, ok]) => !ok).map(([key]) => key),
      };
    });
    assert(audit.duplicates.length === 0, `duplicate IDs: ${audit.duplicates.join(', ')}`);
    assert(audit.missing.length === 0, `JS references absent IDs: ${audit.missing.join(', ')}`);
    assert(audit.badAnchors.length === 0, `anchors target absent IDs: ${audit.badAnchors.join(', ')}`);
    assert(audit.missingHandlers.length === 0, `handlers missing: ${audit.missingHandlers.join(', ')}`);
    return `${audit.idCount} IDs; handlers attached`;
  });
}
async function visible(page, selector) {
  return page.locator(selector).evaluate(el => getComputedStyle(el).display !== 'none');
}
async function runHiddenHandInteractions(page, prefix) {
  let ok = await step(`${prefix}: faction buttons and descriptions`, async () => {
    const copies = {
      keeper: 'Gates, memory, preservation.',
      witness: 'Routes, observation, evidence.',
      listener: 'Signal, sound, hidden patterns.',
    };
    for (const [faction, copy] of Object.entries(copies)) {
      const button = page.locator(`.faction[data-faction="${faction}"]`);
      await button.click();
      assert(await button.evaluate(el => el.classList.contains('active')), `${faction} did not activate`);
      assert((await page.locator('#factionCopy').textContent()).includes(copy), `${faction} copy did not update`);
    }
  });
  if (!ok) return;

  ok = await step(`${prefix}: cards select, deselect, and limit to three`, async () => {
    await page.locator('.faction[data-faction="listener"]').click();
    const cards = page.locator('#handCards .card');
    assert(await cards.count() === 3, 'expected three listener cards');
    for (let i = 0; i < 3; i++) await cards.nth(i).click();
    assert(await page.locator('#handCards .card.selected').count() === 3, 'failed to select three cards');
    await cards.nth(1).click();
    assert(await page.locator('#handCards .card.selected').count() === 2, 'card did not deselect');
    await cards.nth(1).click();
    assert(await page.locator('#handCards .card.selected').count() === 3, 'card did not reselect');
  });
  if (!ok) return;

  ok = await step(`${prefix}: incomplete hand gives a recoverable response`, async () => {
    await page.locator('#draw').click();
    await page.locator('#handCards .card').nth(0).click();
    await page.locator('#resolve').click();
    assert((await page.locator('#outcome').textContent()).includes('Choose three cards'), 'missing incomplete-hand prompt');
    assert(!(await page.locator('#returnWorld').isVisible()), 'return link shown before success');
  });
  if (!ok) return;

  await step(`${prefix}: complete hand resolves, updates meters, and returns to Signals`, async () => {
    await page.locator('#draw').click();
    await page.locator('.faction[data-faction="witness"]').click();
    for (let i = 0; i < 3; i++) await page.locator('#handCards .card').nth(i).click();
    await page.locator('#resolve').click();
    const outcome = await page.locator('#outcome').textContent();
    assert(outcome.includes('THE HAND ANSWERS.'), 'successful hand did not resolve');
    assert(outcome.includes('Three routes overlap'), 'wrong faction outcome');
    assert(await page.locator('#returnWorld').isVisible(), 'return link did not appear');
    for (const selector of ['#m1', '#m2', '#m3']) {
      assert(await page.locator(selector).evaluate(el => el.style.width.endsWith('%')), `${selector} did not update`);
    }
    await page.locator('#returnWorld').click();
    assert(new URL(page.url()).hash === '#signals', 'return link did not navigate to #signals');
  });
}

(async () => {
  const server = isUrl ? null : makeServer();
  let browser;
  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      origin = `http://127.0.0.1:${server.address().port}`;
    }
    const entryUrl = isUrl ? targetUrl : origin;

    const launch = { headless: process.env.HEADED !== '1', args: ['--no-sandbox', '--disable-dev-shm-usage'] };
    if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
    browser = await chromium.launch(launch);

    // CLEAN PLAYER: empty storage, solve each stage, and follow the reveal gate.
    console.log('\n=== CLEAN PLAYER FLOW ===');
    const cleanContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cleanPage = await cleanContext.newPage();
    const cleanMonitor = monitor(cleanPage);
    await cleanPage.goto(entryUrl, { waitUntil: 'load' });
    await auditStructure(cleanPage, 'Clean profile');

    let cleanGatePassed = false;
    await step('Clean profile starts at 0/4 with Hidden Hand concealed', async () => {
      assert((await cleanPage.locator('#count').textContent()).trim() === '0 / 4', 'new profile did not start at 0/4');
      assert(!(await visible(cleanPage, '#hand')), 'Hidden Hand should start concealed');
      assert(await cleanPage.evaluate(() => localStorage.getItem('godstaticSolvedStages')) === null,
        'clean context unexpectedly contains saved progress');
    });

    await step('Clean profile: stage buttons update prompt and active state', async () => {
      const expected = { 1: 'Enter the first signal.', 2: 'Enter the second signal.', 3: 'Enter the third signal.', 4: 'Enter the door signal.' };
      for (const [number, prompt] of Object.entries(expected)) {
        await cleanPage.locator(`.stage[data-stage="${number}"]`).click();
        assert(await cleanPage.locator('.stage.active').getAttribute('data-stage') === number, `stage ${number} not active`);
        assert((await cleanPage.locator('#prompt').textContent()).trim() === prompt, `stage ${number} prompt mismatch`);
      }
    });

    await step('Clean profile: wrong token shows error and does not advance', async () => {
      await cleanPage.locator('.stage[data-stage="1"]').click();
      await cleanPage.locator('#token').fill('NOT-A-SIGNAL');
      await cleanPage.locator('#decode').click();
      assert(await cleanPage.locator('#error').isVisible(), 'error message not visible');
      assert(!(await cleanPage.locator('#result').isVisible()), 'wrong token revealed output');
      assert((await cleanPage.locator('#count').textContent()).trim() === '0 / 4', 'wrong token changed progress');
    });

    await step('Clean profile: valid stages decode, persist, and stage 4 reveals Hidden Hand', async () => {
      const cases = [
        { stage: 1, token: '  hum  ', output: 'HUM VEL NARA LJOS', enter: true },
        { stage: 2, token: 'SEN', output: 'SEN VAK NARA VAR' },
        { stage: 3, token: 'MIR', output: 'MIR TAK NARA NAM' },
        { stage: 4, token: 'HUM KEL NARA DOR', output: 'HUM KEL NARA DOR' },
      ];
      for (const item of cases) {
        await cleanPage.locator(`.stage[data-stage="${item.stage}"]`).click();
        await cleanPage.locator('#token').fill(item.token);
        if (item.enter) await cleanPage.locator('#token').press('Enter');
        else await cleanPage.locator('#decode').click();
        assert(await cleanPage.locator('#result').isVisible(), `stage ${item.stage} output not visible`);
        assert((await cleanPage.locator('#latin').textContent()).trim() === item.output, `stage ${item.stage} output mismatch`);
        assert((await cleanPage.locator('#count').textContent()).trim() === `${item.stage} / 4`, `stage ${item.stage} count mismatch`);
      }
      assert(await visible(cleanPage, '#hand'), 'Hidden Hand did not appear after stage 4');
      cleanGatePassed = true;
      const saved = await cleanPage.evaluate(() => JSON.parse(localStorage.getItem('godstaticSolvedStages') || '[]'));
      assert([1, 2, 3, 4].every(stage => saved.includes(stage)), `incomplete saved stages: ${JSON.stringify(saved)}`);
    });

    if (cleanGatePassed) {
      await runHiddenHandInteractions(cleanPage, 'Clean profile');
      await step('Clean profile: completed progress survives reload and gate stays open', async () => {
        await cleanPage.reload({ waitUntil: 'load' });
        assert((await cleanPage.locator('#count').textContent()).trim() === '4 / 4', 'completed progress did not persist');
        assert(await visible(cleanPage, '#hand'), 'Hidden Hand closed again on reload');
      });
    } else {
      skip('Clean profile: Hidden Hand interactions', 'reveal gate failed; no test-only bypass was used');
      skip('Clean profile: completed reload reveal', 'clean player did not reach the Hidden Hand');
    }

    await step('Clean profile: no external requests or browser errors', async () => {
      const errors = [
        ...cleanMonitor.pageErrors.map(value => `pageerror: ${value}`),
        ...cleanMonitor.consoleErrors.map(value => `console: ${value}`),
      ];
      assert(cleanMonitor.externalRequests.length === 0, `external requests: ${cleanMonitor.externalRequests.join(', ')}`);
      assert(errors.length === 0, errors.join(' | '));
    });
    await cleanContext.close();

    // RETURNING PLAYER: a separate context starts with all four stages saved.
    console.log('\n=== RETURNING PLAYER FLOW ===');
    const returningContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await returningContext.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: 'godstaticSolvedStages', value: [1, 2, 3, 4] });
    const returningPage = await returningContext.newPage();
    const returningMonitor = monitor(returningPage);
    await returningPage.goto(entryUrl, { waitUntil: 'load' });
    await auditStructure(returningPage, 'Returning profile');

    const returningGatePassed = await step('Returning profile: saved 4/4 progress restores and reveals Hidden Hand on load', async () => {
      assert((await returningPage.locator('#count').textContent()).trim() === '4 / 4', 'saved count did not restore as 4/4');
      for (let stage = 1; stage <= 4; stage++) {
        assert(await returningPage.locator(`.stage[data-stage="${stage}"]`).evaluate(el => el.classList.contains('complete')),
          `stage ${stage} not marked complete`);
      }
      assert(await visible(returningPage, '#hand'), 'saved 4/4 profile did not automatically reveal Hidden Hand');
    });

    if (returningGatePassed) {
      await runHiddenHandInteractions(returningPage, 'Returning profile');
    } else {
      skip('Returning profile: Hidden Hand interactions', 'saved-completion gate failed; no test-only bypass was used');
    }

    await step('Returning profile: no external requests or browser errors', async () => {
      const errors = [
        ...returningMonitor.pageErrors.map(value => `pageerror: ${value}`),
        ...returningMonitor.consoleErrors.map(value => `console: ${value}`),
      ];
      assert(returningMonitor.externalRequests.length === 0, `external requests: ${returningMonitor.externalRequests.join(', ')}`);
      assert(errors.length === 0, errors.join(' | '));
    });
    await returningContext.close();

    const passed = results.filter(item => item.status === 'PASS').length;
    const failed = results.filter(item => item.status === 'FAIL').length;
    const skipped = results.filter(item => item.status === 'SKIP').length;
    console.log(`\nTOTAL: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log(`${isUrl ? 'Test URL' : 'Prototype'}: ${isUrl ? targetUrl : sourcePath}`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error('FATAL:', error && error.stack ? error.stack : error);
    process.exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
