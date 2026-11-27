#!/usr/bin/env node
// Brings the wiki up to the engine store's newest release, in one command, after every engine release:
//   npm run engine-release                 store -> snapshot, tools page, docs, reference, l10n, npm test
//   npm run engine-release -- --no-localize --no-test   skip the translation refresh and the test run
//
// Engine releases and developer tools are published only to the store at engine.starhermit.com
// (from 1.43); the wiki's engine/ folder is frozen at 1.42.0. This script:
//   1. reads the store's release list (engine/versions.json), takes the newest unrevoked release, checks
//      its manifest.json against the listed SRI hash and its starhermit.d.ts against the manifest, and
//      writes the snapshot scripts/engine-store/latest-release.json plus that starhermit.d.ts
//      (the tests and the engine API reference read only the snapshot, never the network);
//   2. reads the store's engine/tools/latest.json, downloads every archive and checks it against
//      latest.json and the .sha256 file beside it, then writes engine/tools/latest.json (the store's
//      bytes) and the Downloads table of docs/developer-tools.md and engine/tools/README.md;
//   3. moves the engine tutorial, the Football walkthrough and docs/api/engine.md from the version they
//      name to the new one, and regenerates docs/engine-api/;
//   4. refreshes the translations (scripts/localize.py --translate) and runs npm test.
// Review the diff afterwards (prose about what changed in the release is not written here).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = 'https://engine.starhermit.com/engine';
const UA = { 'User-Agent': 'StarHermit-Wiki-EngineRelease/1.0' };
const args = new Set(process.argv.slice(2));
const path = p => resolve(root, p);
const read = p => readFileSync(path(p), 'utf8');
const sha256 = b => createHash('sha256').update(b).digest('hex');
const sri384 = b => `sha384-${createHash('sha384').update(b).digest('base64')}`;
const key = v => v.split('.').map(Number).reduce((a, n) => a * 10000 + n, 0);
const fail = message => { console.error(`engine-release: ${message}`); process.exit(1); };

async function get(url) {
  const response = await fetch(url, { headers: UA, cache: 'no-store' });
  if (!response.ok) fail(`GET ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// ---- 1. the newest release and its declarations -------------------------------------------------
const list = JSON.parse(await get(`${STORE}/versions.json`));
const live = list.versions.filter(v => !v.revoked).sort((a, b) => key(b.version) - key(a.version));
if (!live.length) fail('the store lists no unrevoked release');
const release = live[0];
const { version, api } = release;
if (!release.web?.manifest) fail(`${version} has no web runtime to take starhermit.d.ts from`);
const manifestBytes = await get(`${STORE}/${version}/manifest.json`);
if (sri384(manifestBytes) !== release.web.manifest) fail(`${version}/manifest.json does not match versions.json's ${release.web.manifest}`);
const manifest = JSON.parse(manifestBytes);
const dtsEntry = manifest.files['starhermit.d.ts'];
if (!dtsEntry) fail(`${version}/manifest.json lists no starhermit.d.ts`);
const dts = await get(`${STORE}/${version}/starhermit.d.ts`);
if (sri384(dts) !== dtsEntry.sha384) fail(`${version}/starhermit.d.ts does not match its manifest`);
const releaseApi = JSON.parse(await get(`https://api.starhermit.com/api/v1/engine/releases/${version}`));
if (releaseApi.version !== version || releaseApi.web?.manifestIntegrity !== release.web.manifest) {
  fail(`the platform API's ${version} does not match the store's versions.json`);
}
mkdirSync(path('scripts/engine-store'), { recursive: true });
writeFileSync(path('scripts/engine-store/starhermit.d.ts'), dts);
const snapshot = { source: `${STORE}/versions.json`, ...release, types: { file: 'starhermit.d.ts', sha384: dtsEntry.sha384 } };
writeFileSync(path('scripts/engine-store/latest-release.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Engine ${version} (host API ${api.major}.${api.minor}, manifest ${release.web.manifest})`);

// ---- 2. developer tools ---------------------------------------------------------------------------
const toolsBytes = await get(`${STORE}/tools/latest.json`);
const tools = JSON.parse(toolsBytes);
const PLATFORMS = [
  ['macos-aarch64', 'macOS, Apple Silicon'], ['macos-x86_64', 'macOS, Intel'],
  ['linux-x86_64', 'Linux, x86-64'], ['windows-x86_64', 'Windows, x86-64'],
];
const rows = [];
for (const [platform, label] of PLATFORMS) {
  const d = tools.downloads[platform];
  if (!d) fail(`tools/latest.json has no ${platform} download`);
  if (!d.url.startsWith(`${STORE}/tools/${d.version}/`)) fail(`tools ${platform} is not on the store: ${d.url}`);
  const archive = await get(d.url);
  const listed = (await get(`${d.url}.sha256`)).toString().trim().split(/\s+/)[0];
  if (archive.length !== d.size || sha256(archive) !== d.sha256 || listed !== d.sha256) {
    fail(`${d.url} does not match latest.json and its .sha256 file`);
  }
  const name = d.url.slice(d.url.lastIndexOf('/') + 1);
  rows.push(`| ${label} | [${name}](${d.url}) | [checksum](${d.url}.sha256) | \`${d.sha256}\` |`);
}
writeFileSync(path('engine/tools/latest.json'), toolsBytes);
const downloads = `## Downloads

Developer tools ${tools.version} (macOS, Linux and Windows) are separate from the engine
runtime a game pins. They are served from engine.starhermit.com.

| Computer | Download | Checksum file | SHA-256 |
|---|---|---|---|
${rows.join('\n')}

[${STORE}/tools/latest.json](${STORE}/tools/latest.json) always lists the
newest tools: each download's address, size, SHA-256 and version.

`;
// The guide (docs/developer-tools.md) and the old download address (engine/tools/README.md, which
// links the store and the guide) carry the same table.
for (const page of ['docs/developer-tools.md', 'engine/tools/README.md']) {
  const text = read(page).replace(/## Downloads\n[\s\S]*?(?=## |$)/, downloads);
  if (!text.includes(downloads)) fail(`${page} has no "## Downloads" section to replace`);
  writeFileSync(path(page), text);
}
console.log(`Tools ${tools.version}: ${rows.length} downloads checked`);

// ---- 3. the docs ----------------------------------------------------------------------------------
const tutorial = 'docs/tutorials/starhermit-engine.md';
const old = read(tutorial).match(/describes engine \*\*(\d+\.\d+\.\d+)\*\*/)?.[1];
if (!old) fail(`${tutorial} names no engine version ("describes engine **X.Y.Z**")`);
const oldMinor = old.split('.')[1];
const esc = s => s.replaceAll('.', '\\.');
const date = release.date;
const edits = {
  [tutorial]: t => t
    .replace(/(Engine \S+ from https:\/\/engine\.starhermit\.com\/engine \(manifest )sha384-[A-Za-z0-9+/=]+/, `$1${release.web.manifest}`)
    .replace(/(starhermit \S+ \(host API )\d+\.\d+/, `$1${api.major}.${api.minor}`),
  'docs/tutorials/football.md': t => t
    .replace(new RegExp(`(\`engine\\.minor\` to )${oldMinor}\\b`), `$1${api.minor}`)
    .replace(new RegExp(`host API ${api.major}\\.${oldMinor}\\b`, 'g'), `host API ${api.major}.${api.minor}`),
  'docs/api/engine.md': t => t
    .replace(/("api": \{"major": \d+, "minor": )\d+(\}, "revoked": false, "date": ")[^"]+"/, `$1${api.minor}$2${date}"`),
};
for (const [file, edit] of old === version ? [] : Object.entries(edits)) {
  // Every mention of the old release becomes the new one, except history ("from 1.42.0", "From 1.42.0").
  let text = edit(read(file)).replace(new RegExp(`(?<![Ff]rom )(?<![\\d.])${esc(old)}(?![\\d])`, 'g'), version);
  writeFileSync(path(file), text);
  const left = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(old));
  for (const [n, l] of left) console.log(`  kept ${file}:${n}: ${l.trim().slice(0, 120)}`);
}
console.log(`Docs: engine ${old} -> ${version}`);
let step = spawnSync(process.execPath, ['scripts/build-engine-reference.mjs'], { cwd: root, stdio: 'inherit' });
if (step.status !== 0) fail('npm run engine-reference failed');

// ---- 4. translations and tests ---------------------------------------------------------------------
if (!args.has('--no-localize')) {
  step = spawnSync('python3', ['scripts/localize.py', '--translate'], { cwd: root, stdio: 'inherit' });
  if (step.status !== 0) fail('scripts/localize.py --translate failed');
}
if (!args.has('--no-test')) {
  step = spawnSync('npm', ['test'], { cwd: root, stdio: 'inherit' });
  if (step.status !== 0) fail('npm test failed');
}
console.log(`Done: review git diff, then commit "Engine ${version} docs and tools ${tools.version} from engine.starhermit.com".`);
