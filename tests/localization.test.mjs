import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { corpus, languages, root, sha, ui } from '../scripts/build-localizations.mjs';

export function splitPage(source) {
  const match=source.match(/^---\n([\s\S]*?)\n---\n/);
  const front=Object.fromEntries(match[1].split('\n').map(line=>{
    const i=line.indexOf(':'); return [line.slice(0,i),JSON.parse(line.slice(i+1))];
  }));
  return {front, html:source.slice(match[0].length).replace(/^\{% raw %\}\n/,'').replace(/\n\{% endraw %\}\n$/,'')};
}
const english=await corpus();
const locales=JSON.parse(await readFile(resolve(root,'_data/locales.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(root,'_data/localization.json'),'utf8'));
const generated=new Map();
for(const lang of languages.slice(1)) for(const source of english.documents){
  const path=resolve(root,'l10n',lang.code,source.path==='README.md'?'index.html':source.path.replace(/\.md$/,'.html'));
  const {front}=splitPage(await readFile(path,'utf8'));
  generated.set(front.permalink,{front,path,source,lang});
}
async function visitPages(callback){
  for(const [url,page] of generated){
    const {html}=splitPage(await readFile(page.path,'utf8'));
    const {document}=parseHTML(`<html><body><main>${html}</main></body></html>`);
    await callback(url,{...page,document});
  }
}

test('all ten languages have complete navigation and all translated pages are current',()=>{
  assert.deepEqual(Object.keys(locales),languages.map(l=>l.code));
  assert.equal(generated.size,english.documents.length*9);
  for(const language of languages){
    const locale=locales[language.code];
    assert.equal(locale.dir,language.dir);
    for(const key of Object.keys(ui)) assert.ok(locale[key]?.trim(),`${language.code}: ${key}`);
  }
  for(const [url,{front,source,lang}] of generated){
    assert.equal(front.source_hash,source.hash,`Stale translation: ${url}; run npm run localize:refresh`);
    assert.equal(front.source_url,source.url);
    assert.equal(front.lang,lang.code);
    assert.equal(front.layout,'wiki'); assert.equal(front.translation,'machine');
    assert.equal(manifest.pages[source.path].hash,source.hash);
  }
});

test('translations preserve every code example, inline API literal, and heading anchor',async()=>{
  const contents=(document,selector)=>[...document.querySelectorAll(selector)].map(e=>e.textContent);
  await visitPages((url,{document,source})=>{
    assert.deepEqual(contents(document,'pre, code'),contents(source.document,'pre, code'),`Changed code at ${url}`);
    assert.deepEqual([...document.querySelectorAll('[id]')].map(e=>e.id),[...source.document.querySelectorAll('[id]')].map(e=>e.id),`Changed anchor at ${url}`);
    assert.ok(document.querySelector('h1').textContent.trim(),`Missing heading at ${url}`);
    assert.notEqual(document.querySelector('main').textContent,source.document.querySelector('main').textContent,`Untranslated page at ${url}`);
  });
});

test('internal links retain the locale and resolve, including downloads and section anchors',async()=>{
  const sources=new Map(english.documents.map(s=>[s.url,s]));
  await visitPages(async(url,{document,lang})=>{
    for(const element of document.querySelectorAll('a[href],img[src]')){
      const attr=element.tagName==='IMG'?'src':'href'; const value=element.getAttribute(attr);
      if(!value||/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) continue;
      const target=new URL(value,'https://wiki.invalid'+url);
      const page=generated.get(target.pathname);
      if(page){
        assert.equal(page.lang.code,lang.code,`Locale lost: ${url} -> ${value}`);
        if(target.hash) assert.ok(page.source.document.getElementById(decodeURIComponent(target.hash.slice(1))),`Missing anchor ${url} -> ${value}`);
      }else{
        assert.ok(!sources.has(target.pathname),`English document link leaked: ${url} -> ${value}`);
        // Jekyll also renders Markdown pages outside the translated docs
        // corpus, such as the engine download guides, as .html.
        const path = resolve(root, '.' + target.pathname);
        try { await access(path); }
        catch (error) {
          if (!path.endsWith('.html')) throw error;
          await access(path.replace(/\.html$/, '.md'));
        }
      }
    }
  });
});

test('all diagrams have translated text, stable geometry, and valid source fingerprints',async()=>{
  for(const source of english.images){
    assert.equal(manifest.images[source.name],source.hash);
    for(const lang of languages.slice(1)){
      const svg=await readFile(resolve(root,'docs/images',lang.code,source.name),'utf8');
      const {document}=parseHTML(`<html><body>${svg}</body></html>`);
      const actual=document.querySelector('svg');const original=source.document.querySelector('svg');
      assert.equal(actual.getAttribute('viewBox'),original.getAttribute('viewBox'));
      assert.equal(actual.getAttribute('lang'),lang.code);
      assert.equal(actual.querySelectorAll('text').length,original.querySelectorAll('text').length);
      assert.notEqual(actual.querySelector('title').textContent,original.querySelector('title').textContent);
      if(lang.dir==='rtl') for(const text of actual.querySelectorAll('text')) assert.equal(text.getAttribute('direction'),'rtl');
    }
  }
});
