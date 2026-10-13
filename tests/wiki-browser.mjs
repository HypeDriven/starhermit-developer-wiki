import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { Liquid } from 'liquidjs';
import { chromium } from 'playwright-core';
import { corpus, root } from '../scripts/build-localizations.mjs';

const locales=JSON.parse(await readFile(resolve(root,'_data/locales.json'),'utf8'));
const {documents}=await corpus();
const pages=new Map(documents.map(source=>[source.url,{source,html:source.document.querySelector('main').innerHTML,front:{lang:'en',url:source.url}}]));
for(const locale of Object.values(locales).filter(l=>l.code!=='en')) for(const source of documents){
  const path=resolve(root,'l10n',locale.code,source.path==='README.md'?'index.html':source.path.replace(/\.md$/,'.html'));
  const raw=await readFile(path,'utf8'); const match=raw.match(/^---\n([\s\S]*?)\n---\n/);
  const front=Object.fromEntries(match[1].split('\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),JSON.parse(line.slice(i+1))];}));
  pages.set(front.permalink,{front,html:raw.slice(match[0].length).replace(/^\{% raw %\}\n/,'').replace(/\n\{% endraw %\}\n$/,'')});
}
const liquid=new Liquid();
liquid.registerFilter('relative_url',value=>value);
liquid.registerFilter('absolute_url',value=>'https://wiki.starhermit.com'+value);
liquid.registerFilter('jsonify',value=>JSON.stringify(value));
const layout=await readFile(resolve(root,'_layouts/wiki.html'),'utf8');
const mime={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  const page=pages.get(path);
  if(page){
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.end(await liquid.parseAndRender(layout,{site:{data:{locales}},page:page.front,content:page.html}));
  }else{
   const file=resolve(root,'.'+path);
   if(!file.startsWith(root+'/')) {res.writeHead(403).end();return;}
   res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(file));
  }
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:950},colorScheme:'light'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const locale of Object.values(locales)){
   await page.goto(base+locale.prefix+'/docs/choosing-an-integration.html');
   assert.equal(await page.locator('html').getAttribute('lang'),locale.code);
   assert.equal(await page.locator('html').getAttribute('dir'),locale.dir);
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   assert.equal(await page.locator('.language-option').count(),10);
   assert.equal(await page.locator('.language-option[aria-current]').getAttribute('href'),locale.prefix+'/docs/choosing-an-integration.html');
   assert.equal(await page.locator('#language-picker summary img').getAttribute('src'),locale.flag);
   assert.deepEqual(await page.locator('#language-picker summary img').evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:21,height:14});
   assert.equal(await page.locator('#theme-toggle').textContent(),locale.light_mode);
   assert.equal(await page.locator('.sidebar a').nth(3).textContent(),locale.integration);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${locale.code} ${width} overflow`);
   assert.ok(await page.locator('#page-outline a').count()>0);
   assert.equal(await page.locator('link[hreflang]').count(),11);
   if(locale.code!=='en') assert.equal(await page.locator('.english-original').getAttribute('href'),'/docs/choosing-an-integration.html');
   for(const img of await page.locator('.document img').all()) assert.equal(await img.evaluate(e=>e.complete&&e.naturalWidth>0),true);
   if(['ar','zh-CN'].includes(locale.code)) await page.screenshot({path:`/tmp/wiki-${locale.code}-${width}.png`,fullPage:true});
  }
  await page.locator('#language-picker summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#language-picker').getAttribute('open'),'');
  for(const flag of await page.locator('.language-option img').all()) assert.equal(await flag.evaluate(e=>e.complete&&e.naturalWidth>0),true);
  await page.screenshot({path:`/tmp/wiki-flag-menu-${width}.png`});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#language-picker').getAttribute('open'),null);
  await page.locator('#language-picker summary').click();
  await page.mouse.click(5,5);
  assert.equal(await page.locator('#language-picker').getAttribute('open'),null);
  await page.goto(base+'/docs/tutorials/cloud-save-sync.html?example=1#conditions-and-conflicts');
  await page.locator('#language-picker summary').click();
  await page.locator('.language-option[data-language="ar"]').click();
  await page.waitForURL('**/ar/docs/tutorials/cloud-save-sync.html?example=1#conditions-and-conflicts');
  assert.ok(await page.locator('#conditions-and-conflicts').count());
  assert.equal(await page.locator('pre').first().evaluate(e=>getComputedStyle(e).direction),'ltr');
  assert.equal(await page.evaluate(()=>localStorage.getItem('wiki-language')),'ar');
  await page.locator('#theme-toggle').click();await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  assert.equal(await page.locator('#theme-toggle').textContent(),locales.ar.dark_mode);
  await page.goto(base+'/');await page.waitForURL('**/ar/');
  await page.locator('.english-original').click();await page.waitForURL(base+'/');
  assert.equal(await page.evaluate(()=>localStorage.getItem('wiki-language')),'en');
  // A saved preference never overrides an explicitly shared English deep link.
  await page.evaluate(()=>localStorage.setItem('wiki-language','fr'));
  await page.goto(base+'/docs/getting-started.html');assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await context.close();
 }
 const noJS=await browser.newContext({javaScriptEnabled:false});
 const page=await noJS.newPage();await page.goto(base+'/ar/');
 await page.locator('#language-picker summary').click();
 assert.equal(await page.locator('.language-option:visible').count(),10);
 await page.locator('.language-option[data-language="fr"]').click();
 await page.waitForURL('**/fr/');
 await noJS.close();assert.deepEqual(errors,[]);
 console.log('Wiki browser checks passed: all ten locales, desktop/mobile, RTL, images, anchors, theme, preference, English original, and no-JS navigation.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
