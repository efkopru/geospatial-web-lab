// Checks that a served standalone build (local preview or a static host) exposes the
// gallery, all five apps, their bundled assets and the preserved third-party notices.
// Browser behavior (IndexedDB, WebGL, downloads) still needs an interactive check.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const APPS=['01-service-requests','02-data-quality-portal','03-fleet-monitor','04-parcel-scenarios','05-infrastructure-inspections'];
const EXPECTED_TYPES={'.js':/javascript/,'.css':/text\/css/,'.svg':/image\/svg\+xml/,'.json':/json/,'.md':/text\//};
const extension=url=>(new URL(url).pathname.match(/\.[a-z0-9]+$/i)||[''])[0].toLowerCase();
const localReferences=html=>[...html.matchAll(/\b(?:src|href)="(\.\/[^"#?]*)"/g)].map(match=>match[1]);

export async function verifySite(baseUrl,{fetch=globalThis.fetch}={}){
 const base=new URL(baseUrl.endsWith('/')?baseUrl:baseUrl+'/');
 const failures=[],checked=[];
 const get=async(url,{html=false}={})=>{
  checked.push(url.href);
  let response;try{response=await fetch(url,{redirect:'follow'});}catch(error){failures.push(`${url.href}: ${error.message}`);return null;}
  const type=response.headers.get('content-type')||'';
  if(!response.ok){failures.push(`${url.href}: HTTP ${response.status}`);return null;}
  const expected=html?/text\/html/:EXPECTED_TYPES[extension(url.href)];
  // Single-page fallbacks return index.html with 200 for missing files; the content type exposes them.
  if(expected&&!expected.test(type)){failures.push(`${url.href}: unexpected content type "${type}"`);return null;}
  return html||extension(url.href)==='.md'?response.text():'';
 };
 const gallery=await get(base,{html:true});
 if(gallery!==null){
  const linked=localReferences(gallery).map(path=>path.replace(/^\.\//,'').replace(/\/$/,''));
  for(const app of APPS)if(!linked.includes(app))failures.push(`Gallery does not link ./${app}/`);
 }
 for(const path of ['THIRD_PARTY_NOTICES.md','licenses/SOURCES.json'])await get(new URL(path,base));
 for(const app of APPS){
  const appBase=new URL(`${app}/`,base);
  const html=await get(appBase,{html:true});if(html===null)continue;
  const assets=localReferences(html);
  if(!assets.some(path=>path.endsWith('.js')))failures.push(`${appBase.href}: no bundled script reference`);
  for(const path of assets)await get(new URL(path,appBase));
  const notices=await get(new URL('THIRD_PARTY_NOTICES.md',appBase));
  if(notices!==null&&!notices.trim())failures.push(`${appBase.href}THIRD_PARTY_NOTICES.md is empty`);
  if(app.startsWith('05-'))await get(new URL('cesium/Assets/approximateTerrainHeights.json',appBase));
 }
 return {ok:failures.length===0,failures,checked};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=process.argv[2]||'http://127.0.0.1:5270/';
 const result=await verifySite(target);
 console.log(`Checked ${result.checked.length} URLs under ${target}`);
 for(const failure of result.failures)console.error(`FAIL ${failure}`);
 if(!result.ok)process.exitCode=1;else console.log('Gallery, five apps, bundled assets and notices are reachable.');
}
