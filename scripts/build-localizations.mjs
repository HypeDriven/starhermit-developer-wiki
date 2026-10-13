/** Generate static translations without changing code, API literals, links, or heading IDs.
 * Prepare a translation corpus, then render from a complete cache. See localize.py.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import { parseHTML } from 'linkedom';

export const root = resolve(import.meta.dirname, '..');
export const languages = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'zh-CN', name: '简体中文', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'bn', name: 'বাংলা', dir: 'ltr' },
  { code: 'pt', name: 'Português', dir: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
];
export const ui = {
  language: 'Language', skip: 'Skip to content', brand: 'Developer wiki', platform: 'Platform',
  light_mode: 'Light mode', dark_mode: 'Dark mode', switch_light: 'Switch to light mode', switch_dark: 'Switch to dark mode',
  documentation: 'Documentation', start: 'Start building', overview: 'Overview', quickstart: 'Browser quickstart',
  getting_started: 'Getting started', integration: 'Choose an integration', concepts: 'Core concepts',
  credentials: 'Credentials and identifiers', manifest: 'Game manifest', sessions: 'Sessions and recovery', saves: 'Safe cloud saves',
  reference: 'Reference', all_api: 'All API areas', conventions: 'API conventions', contracts: 'REST and socket contracts',
  javascript: 'JavaScript SDK', unity: 'Unity SDK', help: 'Help', troubleshooting: 'Troubleshooting', availability: 'Availability and trust',
  outline: 'On this page', footer: 'StarHermit developer documentation', first_game: 'Build your first game',
  scroll_table: 'Scrollable documentation table',
  scroll_diagram: 'Scrollable diagram',
  translation_notice: 'Machine translation. Code examples and API identifiers are preserved in English.',
  original: 'Read the English original',
};
export const sha = s => createHash('sha256').update(s).digest('hex');
const md = new MarkdownIt({ html: true });
md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
  const heading = tokens[i + 1].children.map(t => t.content).join('');
  const slug = heading.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replaceAll(' ', '-');
  const count = env.headings[slug] || 0; env.headings[slug] = count + 1;
  tokens[i].attrSet('id', slug + (count ? `-${count}` : ''));
  return self.renderToken(tokens, i, options);
};
async function markdownFiles(dir) {
  const paths = [];
  for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await markdownFiles(path));
    else if (entry.name.endsWith('.md')) paths.push(path);
  }
  return paths.sort();
}
function segments(document, svg = false) {
  const result = [];
  function visit(node) {
    if (node.nodeType === 1 && /^(PRE|CODE|SCRIPT|STYLE|SAMP|KBD)$/i.test(node.tagName)) return;
    if (node.nodeType === 3) {
      const original = node.data.trim();
      if (/[a-z]{2}/i.test(original) && !/^https?:\/\//.test(original) && !/^[\w-]+\.(md|js|json|html|svg|txt)$/.test(original)) {
        result.push({ original, set(value) { node.data = node.data.replace(original, value); } });
      }
    }
    if (node.nodeType === 1) for (const attr of ['alt', 'title', 'aria-label']) {
      const original = node.getAttribute(attr);
      if (original?.trim()) result.push({ original, set(value) { node.setAttribute(attr, value); } });
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(svg ? document.querySelector('svg') : document.querySelector('main'));
  return result;
}
export async function corpus() {
  const documents = [];
  for (const path of ['README.md', ...await markdownFiles('docs')]) {
    const source = await readFile(resolve(root, path), 'utf8');
    const content = source.replace(/^---\n[\s\S]*?\n---\n/, '');
    const html = md.render(content, { headings: {} });
    const { document } = parseHTML(`<html><body><main>${html}</main></body></html>`);
    const url = path === 'README.md' ? '/' : '/' + path.replace(/\.md$/, '.html');
    documents.push({ path, url, hash: sha(source), document, items: segments(document) });
  }
  const images = [];
  for (const name of (await readdir(resolve(root, 'docs/images'))).filter(n => n.endsWith('.svg')).sort()) {
    const source = await readFile(resolve(root, 'docs/images', name), 'utf8');
    const { document } = parseHTML(`<html><body>${source}</body></html>`);
    images.push({ name, hash: sha(source), document, items: segments(document, true) });
  }
  return { documents, images };
}
const [mode, location] = process.argv.slice(2);
if (mode === 'prepare') {
  const { documents, images } = await corpus();
  const strings = [...new Set([...Object.values(ui), ...documents.flatMap(d => d.items.map(s => s.original)), ...images.flatMap(d => d.items.map(s => s.original))])];
  await writeFile(location, JSON.stringify({ languages: languages.slice(1), strings }, null, 2) + '\n');
  console.log(`${documents.length} pages, ${images.length} diagrams, ${strings.length} unique translation segments (${strings.join('').length} characters)`);
} else if (mode === 'render') {
  const cache = JSON.parse(await readFile(location, 'utf8'));
  const overrides = JSON.parse(await readFile(resolve(root, '_data/localization-overrides.json'), 'utf8'));
  const localeData = {};
  const manifest = { source: 'https://en.wikipedia.org/wiki/List_of_languages_by_total_number_of_speakers#Ethnologue_(2026)', basis: 'Total first- and second-language speakers, Ethnologue 2026', engine: 'Google Translate, generated static machine translations', pages: {}, images: {} };
  const originals = await corpus();
  const sourceURLs = new Set(originals.documents.map(d => d.url));
  for (const lang of languages) {
    function translated(original) {
      if (lang.code === 'en') return original;
      if (Object.hasOwn(overrides[lang.code] || {}, original)) return overrides[lang.code][original];
      const result = cache[lang.code]?.[sha(original)];
      // Some languages omit standalone English articles around inline markup.
      if (typeof result !== 'string' || (!result.trim() && !/^(the|a|an)$/i.test(original))) throw new Error(`Missing ${lang.code} translation for ${original.slice(0,80)}`);
      return result;
    }
    localeData[lang.code] = { ...lang, prefix: lang.code === 'en' ? '' : '/' + lang.code, ...Object.fromEntries(Object.entries(ui).map(([k,v]) => [k, translated(v)])) };
    if (lang.code === 'en') continue;
    // Each locale gets its own DOM; generated HTML never re-enters the Markdown parser.
    const { documents, images } = await corpus();
    for (const entry of documents) {
      for (const item of entry.items) item.set(translated(item.original));
      for (const element of entry.document.querySelectorAll('a[href], img[src]')) {
        const attr = element.tagName === 'IMG' ? 'src' : 'href';
        const value = element.getAttribute(attr);
        if (!value || value.startsWith('#') || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) continue;
        const target = new URL(value, 'https://wiki.invalid' + entry.url);
        let path = target.pathname.replace(/\.md$/, '.html');
        if (path === '/README.html') path = '/';
        if (sourceURLs.has(path)) path = '/' + lang.code + path;
        else if (attr === 'src' && /^\/docs\/images\/[^/]+\.svg$/.test(path)) path = path.replace('/docs/images/', `/docs/images/${lang.code}/`);
        element.setAttribute(attr, path + target.search + target.hash);
      }
      const title = entry.document.querySelector('h1')?.textContent || entry.path;
      const header = { layout: 'wiki', lang: lang.code, title, source_url: entry.url, source_path: entry.path, source_hash: entry.hash, translation: 'machine', permalink: '/' + lang.code + entry.url };
      const html = `---\n${Object.entries(header).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n{% raw %}\n` + entry.document.querySelector('main').innerHTML + '\n{% endraw %}\n';
      const output = resolve(root, 'l10n', lang.code, entry.path === 'README.md' ? 'index.html' : entry.path.replace(/\.md$/, '.html'));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, html);
      manifest.pages[entry.path] = { url: entry.url, hash: entry.hash };
    }
    for (const entry of images) {
      for (const item of entry.items) item.set(translated(item.original));
      const svg = entry.document.querySelector('svg');
      svg.setAttribute('lang', lang.code);
      // Labels stay centered on their nodes; Arabic and Urdu read right to left.
      for (const text of svg.querySelectorAll('text')) {
        if (lang.dir === 'rtl') { text.setAttribute('direction', 'rtl'); text.setAttribute('unicode-bidi', 'plaintext'); }
        // Long labels fit their original boxes without overlapping adjacent nodes.
        const x = Number(text.getAttribute('x')), y = Number(text.getAttribute('y'));
        const rect = [...svg.querySelectorAll('rect')].find(r => {
          const left=Number(r.getAttribute('x')), top=Number(r.getAttribute('y'));
          return r.hasAttribute('x') && x>=left && x<=left+Number(r.getAttribute('width')) && y>=top && y<=top+Number(r.getAttribute('height'));
        });
        const width = rect ? Number(rect.getAttribute('width')) - 20 : Math.min(x, Number(svg.getAttribute('width')) - x) * 2 - 24;
        const font = Number(text.getAttribute('font-size') || text.closest('g[font-size]')?.getAttribute('font-size') || 17);
        const estimate = [...text.textContent].reduce((n,c) => n + (/[\u2e80-\u9fff]/.test(c) ? 1 : .6), 0) * font;
        if (estimate > width && width > 0) { text.setAttribute('textLength', width); text.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      }
      const output = resolve(root, 'docs/images', lang.code, entry.name);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, svg.outerHTML + '\n');
      manifest.images[entry.name] = entry.hash;
    }
  }
  await writeFile(resolve(root, '_data/locales.json'), JSON.stringify(localeData, null, 2) + '\n');
  await writeFile(resolve(root, '_data/localization.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Generated ${Object.keys(manifest.pages).length * 9} localized pages and ${Object.keys(manifest.images).length * 9} diagrams.`);
} else if (mode) throw new Error('Usage: node scripts/build-localizations.mjs prepare|render CACHE_PATH');
