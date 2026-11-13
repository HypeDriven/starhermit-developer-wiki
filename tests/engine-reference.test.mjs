import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, latestRelease, root } from '../scripts/build-engine-reference.mjs';

// The engine API reference and the example walkthroughs describe the latest engine release only.
const { version } = latestRelease();

test('engine API reference is generated from the latest release', () => {
  const { files } = build();
  const dir = resolve(root, 'docs/engine-api');
  const stale = [...files].filter(([f, c]) => !existsSync(resolve(dir, f)) || readFileSync(resolve(dir, f), 'utf8') !== c).map(([f]) => f);
  const extra = readdirSync(dir).filter(f => f.endsWith('.md') && !files.has(f));
  assert.deepEqual([...stale, ...extra], [], `run npm run engine-reference (latest engine ${version})`);
});

test('engine tutorial and Football walkthrough name the latest release', () => {
  for (const page of ['docs/tutorials/starhermit-engine.md', 'docs/tutorials/football.md']) {
    const text = readFileSync(resolve(root, page), 'utf8');
    assert.match(text, new RegExp(`engine \\*\\*${version.replaceAll('.', '\\.')}\\*\\*`), `${page} must describe engine ${version}`);
  }
});
