import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('docs/examples/browser-quickstart');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!path.startsWith(root + '/') && path !== root) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
function capture(page) { page.on('pageerror', error => errors.push(error.message)); }
const game = '00112233-4455-6677-8899-aabbccddeeff';
const token = 'x.' + Buffer.from(JSON.stringify({ sub: game, game_scope: game, exp: 9999999999 })).toString('base64url') + '.x';
try {
  for (const viewport of [{ width: 1100, height: 850 }, { width: 360, height: 740 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(); capture(page);
    let requests = 0;
    await page.route('**/api/**', async route => { requests++; await route.fulfill({ status: 500, body: '' }); });
    await page.goto(base);
    assert.equal(await page.locator('#account').isDisabled(), true);
    await page.locator('#guest').click();
    await page.locator('#collect').click(); await page.locator('#collect').click();
    assert.equal(await page.locator('#points').textContent(), '2');
    assert.match(await page.locator('#sync').textContent(), /isn't tracked or saved/);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    await page.screenshot({ path: `/tmp/starhermit-wiki-quickstart-${viewport.width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.reload(); await page.locator('#guest').click();
    assert.equal(await page.locator('#points').textContent(), '0'); assert.equal(requests, 0);
    await context.close();
  }
  // Player requests are mocked; no account credentials or live writes are used.
  const context = await browser.newContext();
  let progress = null, etag = '"v0"', accepted = false, gets = 0, writes = 0, termsRevision = 1;
  async function mock(route) {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const send = (status, body, headers = {}) => route.fulfill({ status, body: body == null ? '' : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
    if (path === '/api/v1/terms') return send(200, { hash: `hash-${termsRevision}`, text: `Displayed terms ${termsRevision}` });
    if (path === '/api/v1/me/terms/accept') {
      const body = route.request().postDataJSON();
      if (body.hash !== `hash-${termsRevision}`) return send(409, { error: 'terms_version_mismatch' });
      accepted = true; return send(200, { termsAcceptedHash: body.hash });
    }
    if (path.endsWith('/launch-token')) return send(200, { token, expiresInSeconds: 3600 });
    if (path.includes('/cloud-saves/')) {
      if (!accepted) return send(403, { error: 'terms_acceptance_required' });
      if (method === 'GET') { gets++; return progress == null ? send(404, null) : send(200, progress, { ETag: etag }); }
      writes++;
      const headers = route.request().headers();
      if (progress == null ? headers['if-none-match'] !== '*' : headers['if-match'] !== etag) return send(412, { error: 'precondition_failed', etag });
      progress = JSON.parse(Buffer.from(route.request().postDataJSON().dataBase64, 'base64').toString('utf8'));
      etag = `"v${writes}"`; return send(200, { etag });
    }
    return send(404, { error: 'Unexpected path' });
  }
  await context.route('**/api/**', mock);
  const a = await context.newPage(); capture(a);
  await a.goto(`${base}/#game_token=${token}`);
  assert.equal(await a.evaluate(() => location.hash), '');
  await a.locator('#account').click();
  await a.locator('#terms').waitFor({ state: 'visible' });
  assert.equal(accepted, false); assert.equal(writes, 0);
  // A changed revision must be displayed for a new explicit decision.
  termsRevision = 2;
  await a.locator('#accept').click();
  await a.waitForFunction(() => document.getElementById('terms-text').textContent === 'Displayed terms 2');
  assert.equal(accepted, false);
  await a.locator('#accept').click();
  await a.waitForFunction(() => !document.getElementById('collect').disabled);
  await a.locator('#collect').click();
  await a.waitForFunction(() => document.getElementById('sync').textContent === 'Saved');
  assert.deepEqual(progress, { version: 1, points: 1 });
  assert.ok(gets > 0);

  const b = await context.newPage(); capture(b);
  await b.goto(`${base}/#access_token=${token}`); await b.locator('#account').click();
  await b.waitForFunction(() => !document.getElementById('collect').disabled);
  assert.equal(await b.locator('#points').textContent(), '1');
  await a.locator('#collect').click(); await a.waitForFunction(() => document.getElementById('sync').textContent === 'Saved');
  await b.locator('#collect').click();
  await b.locator('#reload').waitFor({ state: 'visible' });
  assert.equal(await b.locator('#collect').isDisabled(), true);
  assert.match(await b.locator('#message').textContent(), /Another tab/);
  await b.locator('#reload').click(); await b.waitForFunction(() => !document.getElementById('collect').disabled);
  assert.equal(await b.locator('#points').textContent(), '2');

  await a.locator('#menu').click(); await a.locator('#guest').click();
  const previousWrites = writes;
  await a.locator('#collect').click();
  assert.equal(await a.evaluate(() => StarHermit.signedIn), false); assert.equal(writes, previousWrites);
  await context.close();
  assert.deepEqual(errors, []);
  console.log('Quickstart browser checks passed: desktop/mobile unsigned play, explicit terms/revision change, account save/load, two-tab conflict, and account-to-untracked transition.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
