import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySite,APPS} from '../scripts/verify-site.mjs';

const TYPES={'.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.md':'text/markdown'};
function site({spaFallback=false,omit=[]}={}){
 const files=new Map([
  ['/demo/',APPS.map(app=>`<a href="./${app}/">Open</a>`).join('')+'<a data-port href="http://127.0.0.1:5171/">Original</a>'],
  ['/demo/THIRD_PARTY_NOTICES.md','notices'],['/demo/licenses/SOURCES.json','{}']
 ]);
 for(const app of APPS){
  files.set(`/demo/${app}/`,'<link rel="icon" href="./favicon.svg"><script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css">');
  for(const asset of ['favicon.svg','assets/index.js','assets/index.css','THIRD_PARTY_NOTICES.md'])files.set(`/demo/${app}/${asset}`,'content');
 }
 files.set('/demo/05-infrastructure-inspections/cesium/Assets/approximateTerrainHeights.json','{}');
 for(const path of omit)files.delete(path);
 return async url=>{
  const path=new URL(url).pathname;const type=path.endsWith('/')?'.html':(path.match(/\.[a-z]+$/)||[''])[0];
  if(files.has(path))return new Response(files.get(path),{headers:{'content-type':TYPES[type]||'application/octet-stream'}});
  return spaFallback?new Response(files.get('/demo/'),{headers:{'content-type':TYPES['.html']}}):new Response('missing',{status:404});
 };
}

test('site verification accepts a complete static deployment under a subpath',async()=>{
 const result=await verifySite('https://example.test/demo',{fetch:site()});
 assert.deepEqual(result.failures,[]);
 assert.ok(result.checked.includes('https://example.test/demo/05-infrastructure-inspections/cesium/Assets/approximateTerrainHeights.json'));
 assert.ok(!result.checked.some(url=>url.includes('127.0.0.1')));
});

test('site verification reports missing files, including single-page fallbacks that return HTML',async()=>{
 const missing=await verifySite('https://example.test/demo/',{fetch:site({omit:['/demo/03-fleet-monitor/assets/index.js','/demo/02-data-quality-portal/THIRD_PARTY_NOTICES.md']})});
 assert.equal(missing.ok,false);
 assert.deepEqual(missing.failures,['https://example.test/demo/02-data-quality-portal/THIRD_PARTY_NOTICES.md: HTTP 404','https://example.test/demo/03-fleet-monitor/assets/index.js: HTTP 404']);
 const fallback=await verifySite('https://example.test/demo/',{fetch:site({spaFallback:true,omit:['/demo/04-parcel-scenarios/assets/index.css']})});
 assert.deepEqual(fallback.failures,['https://example.test/demo/04-parcel-scenarios/assets/index.css: unexpected content type "text/html; charset=utf-8"']);
});
