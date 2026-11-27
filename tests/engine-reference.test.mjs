import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build, latestRelease, root } from '../scripts/build-engine-reference.mjs';

// The engine API reference and the example walkthroughs describe the latest engine release only:
// the engine store's newest release, snapshotted in scripts/engine-store/ by scripts/engine-release.mjs
// (npm run engine-release). The tests read the snapshot only, never the network.
const { version, api, manifest } = latestRelease();
const snapshot = JSON.parse(readFileSync(resolve(root, 'scripts/engine-store/latest-release.json'), 'utf8'));
const rerun = `run npm run engine-release (latest engine ${version})`;
const sri384 = bytes => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

test('the snapshot is the store\'s release and its declarations', () => {
  assert.equal(snapshot.source, 'https://engine.starhermit.com/engine/versions.json');
  assert.equal(snapshot.revoked, false);
  assert.match(manifest, /^sha384-[A-Za-z0-9+/]{64}$/);
  const dts = readFileSync(resolve(root, 'scripts/engine-store/starhermit.d.ts'));
  assert.equal(sri384(dts), snapshot.types.sha384, 'scripts/engine-store/starhermit.d.ts is not the release\'s');
});

test('engine API reference is generated from the latest release', () => {
  const { files } = build();
  const dir = resolve(root, 'docs/engine-api');
  const stale = [...files].filter(([f, c]) => !existsSync(resolve(dir, f)) || readFileSync(resolve(dir, f), 'utf8') !== c).map(([f]) => f);
  const extra = readdirSync(dir).filter(f => f.endsWith('.md') && !files.has(f));
  assert.deepEqual([...stale, ...extra], [], rerun);
});

test('engine tutorial and Football walkthrough name the latest release', () => {
  for (const page of ['docs/tutorials/starhermit-engine.md', 'docs/tutorials/football.md']) {
    const text = readFileSync(resolve(root, page), 'utf8');
    assert.match(text, new RegExp(`engine \\*\\*${version.replaceAll('.', '\\.')}\\*\\*`), `${page} must describe engine ${version}; ${rerun}`);
  }
  const tutorial = readFileSync(resolve(root, 'docs/tutorials/starhermit-engine.md'), 'utf8');
  assert.ok(tutorial.includes(`(manifest ${manifest})`), `the tutorial's package output must show ${version}'s manifest; ${rerun}`);
  assert.ok(tutorial.includes(`(host API ${api.major}.${api.minor}, launcher`), `the tutorial's --version output must show host API ${api.major}.${api.minor}`);
});

test('the engine API page\'s examples name the latest release on the store', () => {
  const text = readFileSync(resolve(root, 'docs/api/engine.md'), 'utf8');
  assert.ok(text.includes(`"version": "${version}", "api": {"major": ${api.major}, "minor": ${api.minor}}`), `docs/api/engine.md example must be ${version}; ${rerun}`);
  assert.ok(text.includes(`https://engine.starhermit.com/engine/${version}/`), 'docs/api/engine.md must use engine.starhermit.com URLs');
  assert.ok(!/wiki\.starhermit\.com\/engine\/\d/.test(text), 'docs/api/engine.md must not name wiki engine URLs');
});

test('the developer tools page and latest.json point at the store', () => {
  const latest = JSON.parse(readFileSync(resolve(root, 'engine/tools/latest.json'), 'utf8'));
  const page = readFileSync(resolve(root, 'engine/tools/README.md'), 'utf8');
  assert.match(page, new RegExp(`Developer tools ${latest.version.replaceAll('.', '\\.')} `));
  for (const [platform, d] of Object.entries(latest.downloads)) {
    assert.ok(d.url.startsWith(`https://engine.starhermit.com/engine/tools/${d.version}/`), `${platform}: ${d.url}`);
    assert.ok(page.includes(`](${d.url})`) && page.includes(`](${d.url}.sha256)`) && page.includes(d.sha256), `engine/tools/README.md must link ${d.url} with its SHA-256; ${rerun}`);
  }
  assert.ok(!/\]\(\d+\.\d+\.\d+\//.test(page), 'engine/tools/README.md must not link archives on the wiki');
});

test('no page sends readers to the wiki\'s engine copy', () => {
  // Engine files are on engine.starhermit.com/engine/<version>/..., tools on engine.starhermit.com/engine/tools/...,
  // the release list at api.starhermit.com/api/v1/engine/releases. The wiki's engine/ folder stays, unlinked.
  const skip = new Set(['.git', 'node_modules', 'scripts', 'tests', 'engine']);
  const pages = [resolve(root, 'engine/tools/README.md')];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (dir === root && skip.has(entry.name)) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|html|json|js|mjs|ts|sh|txt|yml)$/.test(entry.name)) pages.push(full);
    }
  };
  walk(root);
  const bad = [
    /wiki\.starhermit\.com\/engine\b/,                         // an absolute wiki engine URL
    /\]\((?:\.\.?\/)*engine\/(?!-)/,                           // a Markdown link into engine/
    /\b(?:href|src)="(?:\.\.?\/)*(?:\/)?engine\/(?!-)/,         // an HTML link into engine/
    /\]\(\/engine\//,                                           // a site-absolute Markdown link
  ];
  const hits = [];
  for (const page of pages) {
    const lines = readFileSync(page, 'utf8').split('\n');
    lines.forEach((line, i) => { if (bad.some(re => re.test(line))) hits.push(`${page.slice(root.length + 1)}:${i + 1}: ${line.trim().slice(0, 160)}`); });
  }
  assert.deepEqual(hits, [], 'link engine.starhermit.com or api.starhermit.com instead of the wiki\'s engine/ folder');
});
