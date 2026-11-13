#!/usr/bin/env node
// Generates the engine API reference (docs/engine-api/) from the latest engine release's
// starhermit.d.ts (engine/<version>/starhermit.d.ts, the newest unrevoked entry in
// engine/versions.json). The reference always describes the latest release only.
//   node scripts/build-engine-reference.mjs          write the pages
//   node scripts/build-engine-reference.mjs --check  exit 1 if the pages are stale
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/engine-api');

export function latestRelease() {
  const { versions } = JSON.parse(readFileSync(resolve(root, 'engine/versions.json'), 'utf8'));
  const key = v => v.split('.').map(Number).reduce((a, n) => a * 10000 + n, 0);
  const live = versions.filter(v => !v.revoked).sort((a, b) => key(b.version) - key(a.version));
  return { version: live[0].version, api: live[0].api };
}

// ---- comment text to Markdown -------------------------------------------------------------
function escapeText(text) {
  // Escape Markdown/kramdown syntax outside inline code spans.
  return text.split(/(`+[^`]*`+)/).map((part, i) => i % 2 ? part : part
    .replace(/\\/g, '\\\\').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([*_|$\[\]{}])/g, '\\$1')).join('');
}
function prose(lines) {
  // Dedent, then: blank lines split paragraphs, "- " starts a list item, deeper indentation is code.
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (!lines.length) return '';
  const base = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  lines = lines.map(l => l.slice(base).replace(/\s+$/, ''));
  const out = [];
  let para = [], inList = false;
  const flush = () => {
    if (!para.length) return;
    const text = escapeText(para.join(' ')).replace(/^(\d+)\. /, '$1\\. ').replace(/^([#+=-])/, '\\$1');
    out.push((inList ? '- ' : '') + text);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); inList = false; out.push(''); continue; }
    if (/^- /.test(line)) { const wasList = inList; flush(); if (!wasList && out.length && out.at(-1) !== '') out.push(''); inList = true; para.push(line.slice(2)); continue; }
    if (inList && /^  \S/.test(line)) { para.push(line.trim()); continue; }
    if (/^  /.test(line)) {
      flush(); inList = false;
      const code = [];
      while (i < lines.length && (/^  /.test(lines[i]) || (!lines[i].trim() && /^  /.test(lines[i + 1] || '')))) code.push(lines[i++]);
      i--;
      const ind = Math.min(...code.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
      if (out.length && out.at(-1) !== '') out.push('');
      out.push('```text', ...code.map(l => l.slice(ind)), '```', '');
      continue;
    }
    if (inList && para.length) { flush(); inList = false; out.push(''); }
    para.push(line.trim());
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function jsDocLines(raw) {
  return raw.replace(/^\/\*\*\s?/, '').replace(/\s*\*\/$/, '').split('\n').map(l => l.replace(/^\s*\* ?/, ''));
}
function lineCommentLines(raw) { return raw.split('\n').map(l => l.replace(/^\s*\/\/ ?/, '')); }

// Leading comments of a node: "//" runs become notes (a "-- Title ---" line becomes a section),
// the last "/** */" before the node is its documentation.
function leading(text, node) {
  return grouped(text, ts.getLeadingCommentRanges(text, node.pos) || []);
}
function grouped(text, ranges) {
  const notes = []; let doc = '';
  for (const r of ranges) {
    const raw = text.slice(r.pos, r.end);
    if (raw.startsWith('/**')) { doc = raw; continue; }
    if (raw.startsWith('//')) {
      const prev = notes.at(-1);
      if (prev && prev.end !== undefined && !/\n\s*\n/.test(text.slice(prev.end, r.pos))) { prev.lines.push(...lineCommentLines(raw)); prev.end = r.end; }
      else notes.push({ lines: lineCommentLines(raw), end: r.end });
    } else notes.push({ lines: jsDocLines(raw.replace(/^\/\*/, '/**')), end: r.end });
  }
  return { notes: notes.map(n => n.lines), doc: doc ? jsDocLines(doc) : null };
}
function renderNotes(notes) {
  const out = [];
  for (let lines of notes) {
    const title = lines[0]?.match(/^-{2,}\s*(.+?)\s*-*$/);
    if (title) { out.push(`## ${escapeText(title[1])}`); lines = lines.slice(1); }
    const body = prose(lines);
    if (body) out.push(body);
  }
  return out.join('\n\n');
}

// ---- declarations ---------------------------------------------------------------------------
function nameOf(node) {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map(d => d.name.getText()).join(', ');
  return node.name ? node.name.getText() : null;
}
function kindOf(node) {
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableStatement(node)) return node.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'variable';
  if (ts.isModuleDeclaration(node)) return 'namespace';
  return 'declaration';
}
const code = (sig) => '```ts\n' + sig + '\n```';
function dedentBlock(text) {
  const lines = text.split('\n');
  const ind = Math.min(...lines.slice(1).filter(l => l.trim()).map(l => l.match(/^ */)[0].length), 1e9);
  return [lines[0], ...lines.slice(1).map(l => l.slice(ind === 1e9 ? 0 : Math.max(0, ind - 2)))].join('\n');
}
function inlineCode(sig) {
  const flat = sig.replace(/\s+/g, ' ').trim();
  return flat.includes('`') ? '`` ' + flat + ' ``' : '`' + flat + '`';
}
function renderMembers(text, sf, members) {
  const out = [];
  for (const m of members) {
    const { notes, doc } = leading(text, m);
    const n = renderNotes(notes); if (n) out.push(n.replace(/^## /gm, '#### '));
    const sig = text.slice(m.getStart(sf), m.end).trim();
    const multi = /\n/.test(sig) || /\/\/|\/\*/.test(sig);
    let item = multi ? '- ' + code(dedentBlock(sig)).split('\n').join('\n  ') : '- ' + inlineCode(sig);
    const body = doc ? prose(doc) : '';
    if (body) item += '\n\n' + body.split('\n').map(l => l ? '  ' + l : l).join('\n');
    out.push({ item, tight: !multi && !body });
  }
  return out.map((o, i) => typeof o === 'string' ? (i ? '\n\n' : '') + o + '\n\n'
    : (i && o.tight && out[i - 1].tight ? '\n' : i && typeof out[i - 1] !== 'string' ? '\n\n' : '') + o.item).join('').trim();
}
function renderStatements(text, sf, statements) {
  const out = []; let last = null;
  for (const st of statements) {
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) continue;
    const { notes, doc } = leading(text, st);
    const n = renderNotes(notes); if (n) out.push(n);
    const name = nameOf(st); const kind = kindOf(st);
    if (name && !(last && last.name === name && last.kind === kind)) out.push(`### ${escapeText(name)}\n\n*${kind}*`);
    last = { name, kind };
    if (ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) {
      const head = text.slice(st.getStart(sf), text.indexOf('{', st.name ? st.name.end : st.getStart(sf))).trim();
      if (doc) out.push(prose(doc));
      out.push(code(head.replace(/\s+/g, ' ') + ' { … }'));
      if (st.members.length) out.push(renderMembers(text, sf, st.members));
    } else if (ts.isModuleDeclaration(st) && st.body && ts.isModuleBlock(st.body)) {
      if (doc) out.push(prose(doc));
      out.push(renderStatements(text, sf, st.body.statements).replace(/^### /gm, '#### '));
    } else {
      out.push(code(dedentBlock(text.slice(st.getStart(sf), st.end).trim())));
      if (doc) out.push(prose(doc));
    }
  }
  return out.join('\n\n');
}

// One line per module for the index; a module missing here falls back to its first sentence.
const SUMMARIES = {
  engine: 'Lifecycle (`onStart`, `onFixedUpdate`, `onUpdate`, `onRender`), frames and timing, graphics levels, fuel and busy states, files, the game\'s manifest and runtime information.',
  input: 'Actions bound from `control.*` lines, keyboard, pointer, touch and gamepads, rebinding and the on-screen controls.',
  storage: 'The game\'s private stores: key-value storage, `localStorage`, settings and cloud saves.',
  scene: 'The 3D scene after three.js r185: cameras, lights, meshes, geometries, materials, textures, loaders, animation, LOD, particles and the renderer.',
  volume: 'Volumetric effects: smoke, explosions, fire, dust, clouds and fog banks from presets, grids and `.wvdb` files (an engine extension).',
  sky: 'A physically based sky (`SkyAtmosphere`) with sun, moon, stars and aerial perspective, and three.js\'s Preetham `Sky` (host API 1.40).',
  weather: 'Wind (`WindField`), foliage sway, and weather visuals: clouds, rain, wet surfaces and lightning (host API 1.40).',
  canvas: 'Off-screen 2D canvases after the web\'s CanvasRenderingContext2D, for textures and HUD images.',
  draw: 'The per-frame 2D overlay over the 3D scene (HUDs): shapes, images and text drawn in call order.',
  ui: 'The engine\'s immediate-mode UI for the game\'s own menus and HUD panels: widgets called every frame, layout, styles and focus.',
  audio: 'Sounds, music and the mixer after the Web Audio API.',
  platform: 'The StarHermit platform: the signed-in player, rooms and sockets, leaderboards, achievements, replays, chat and voice.',
  world: 'Native per-entity work: tables, kernels and bindings that move thousands of objects without per-object script.',
  physics: '3D rigid bodies, colliders, joints, queries and a character controller, deterministic on every runtime (host API 1.40).',
  script: 'Other realms: classic scripts, workers, the platform\'s sandboxed server script run locally, and authorities for client-side prediction.',
  particles: 'GPU particles (`GPUParticleEmitter`) and Solstice `.particles` effects (host API 1.40).',
  vehicle: 'Vehicle dynamics, tracks, lap timing and autopilots (host API 1.40).',
  water: 'FFT oceans, ponds and water shading, with a deterministic wave field for gameplay (host API 1.40).',
  surfaces: 'Procedural tiling surfaces, terrain blending and grass (host API 1.40).',
};

// ---- pages ------------------------------------------------------------------------------------
function page(title, body) {
  // English-only, generated: Liquid off for the body (it may contain "{{").
  return `---\ntitle: ${JSON.stringify(title)}\nenglish_only: true\n---\n{% raw %}\n<!-- Generated by scripts/build-engine-reference.mjs from the latest engine release. Do not edit. -->\n\n${body.trim()}\n{% endraw %}\n`;
}
export function build() {
  const { version, api } = latestRelease();
  const source = resolve(root, 'engine', version, 'starhermit.d.ts');
  const text = readFileSync(source, 'utf8');
  const sf = ts.createSourceFile('starhermit.d.ts', text, ts.ScriptTarget.Latest, true);
  const stamp = `Engine **${version}** (host API ${api.major}.${api.minor}), the latest release. Generated from the release's \`starhermit.d.ts\`; \`starhermit types\` writes the same file into your game.`;
  const files = new Map();
  const modules = []; const globals = [];
  for (const st of sf.statements) {
    if (ts.isModuleDeclaration(st) && ts.isStringLiteral(st.name)) modules.push(st); else globals.push(st);
  }
  // The file's opening comment holds the conventions for every module.
  const header = ts.getLeadingCommentRanges(text, 0) || [];
  const conventions = renderNotes(grouped(text, header.filter(r => text.startsWith('//', r.pos))).notes);
  const summary = (st) => {
    const slug = st.name.text.replace(/^starhermit:/, '');
    if (SUMMARIES[slug]) return SUMMARIES[slug];
    const first = grouped(text, ts.getLeadingCommentRanges(text, st.body.statements[0]?.pos ?? st.end) || []).notes.flat().join(' ');
    const sentence = first.replace(/\s+/g, ' ').match(/^(.{20,300}?\.)(\s|$)/);
    return sentence ? escapeText(sentence[1]) : '';
  };
  const rows = [];
  for (const st of modules) {
    const spec = st.name.text; const slug = spec.replace(/^starhermit:/, '');
    const body = st.body && ts.isModuleBlock(st.body) ? st.body.statements : [];
    const md = `# \`${spec}\`\n\n${stamp} [All modules](index.md).\n\n\`\`\`ts\nimport { … } from "${spec}";\n\`\`\`\n\n${renderStatements(text, sf, body)}`;
    files.set(`${slug}.md`, page(`${spec} · Engine API`, md));
    rows.push(`| [\`${spec}\`](${slug}.md) | ${summary(st)} |`);
  }
  // Globals: the leading comment ranges of the first global are the file header; skip them there.
  const globalsBody = renderStatements(text, sf, globals).replace(/^[\s\S]*?(?=### )/, '');
  files.set('globals.md', page('Globals · Engine API', `# Globals\n\n${stamp} [All modules](index.md).\n\nBuilt-ins every realm has without an import.\n\n${globalsBody}`));
  const index = `# Engine API reference

${stamp}

This is the complete host API of the StarHermit engine for script games: every module a game imports
by name, every member, unit, limit and error. It follows the latest release only; a game pinned to an
older release has that release's \`.starhermit/starhermit.d.ts\` (from \`starhermit types\`) as its own
reference. New in host API 1.40 is summarised in [engine features](../engine-features.md); for a
guided start see the [engine tutorial](../tutorials/starhermit-engine.md) and the
[Football walkthrough](../tutorials/football.md). This reference is in English only.

| Module | Summary |
|---|---|
${rows.join('\n')}
| [Globals](globals.md) | \`console\`, timers and the other built-ins available without an import. |

## Conventions for every module

${conventions.replace('The globals below are the only ones', 'The [globals](globals.md) are the only ones')}
`;
  files.set('index.md', page('Engine API reference', index));
  return { version, files };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { version, files } = build();
  if (process.argv.includes('--check')) {
    const existing = existsSync(outDir) ? readdirSync(outDir).filter(f => f.endsWith('.md')).sort() : [];
    const stale = [...files].filter(([f, c]) => !existsSync(resolve(outDir, f)) || readFileSync(resolve(outDir, f), 'utf8') !== c).map(([f]) => f);
    const extra = existing.filter(f => !files.has(f));
    if (stale.length || extra.length) {
      console.error(`Engine API reference is not current with engine ${version}: ${[...stale, ...extra].join(', ')}. Run npm run engine-reference.`);
      process.exit(1);
    }
    console.log(`Engine API reference current with engine ${version} (${files.size} pages)`);
  } else {
    rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
    for (const [f, c] of files) writeFileSync(resolve(outDir, f), c);
    console.log(`Wrote ${files.size} engine API pages for engine ${version}`);
  }
}
