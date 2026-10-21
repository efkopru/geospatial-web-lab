import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep,extname} from 'node:path';
import {cpSync,createReadStream,statSync,mkdirSync} from 'node:fs';
import {noticesPlugin} from './scripts/notices.mjs';
import {CONTENT_SECURITY_POLICY} from './scripts/content-security-policy.mjs';
const require=createRequire(import.meta.url);
const shared=fileURLToPath(new URL('./shared/',import.meta.url));

// GitHub Pages cannot send headers, so built pages carry the policy as their first <head> element
// after the character set. Development pages do not: Vite's dev client runs inline scripts.
function contentSecurityPolicy(){
 return {name:'standalone-content-security-policy',apply:'build',transformIndexHtml(html){
  const charset=/<meta charset="[^"]*"\s*\/?>/i;
  if(!charset.test(html))throw new Error('index.html needs a <meta charset> element before the Content-Security-Policy');
  return html.replace(charset,match=>`${match}<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}"/>`);
 }};
}

// Cesium bundles Knockout, which finds the global object with (0,eval)("this") unless it runs as a
// classic script. The Content-Security-Policy refuses eval, which stops Cesium loading, so the build
// substitutes globalThis, the same object. The build fails if Knockout stops matching.
function knockoutWithoutEval(){
 return {name:'knockout-without-eval',apply:'build',transform(code,id){
  if(!/[\\/]knockout-[\d.]+\.js$/.test(id))return null;
  const patched=code.replace('this||(0,eval)("this")','globalThis');
  if(patched===code)throw new Error(`${id} no longer uses the expected global lookup; update knockoutWithoutEval in vite.shared.js`);
  return {code:patched,map:null};
 }};
}

function cesiumAssets(){
 const source=join(dirname(require.resolve('cesium/package.json')),'Build','Cesium');
 let output;
 return {name:'standalone-cesium-assets',configResolved(config){output=resolve(config.root,config.build.outDir);},
  configureServer(server){server.middlewares.use('/cesium',(request,response,next)=>{
   let path;try{path=resolve(source,'.'+decodeURIComponent((request.url||'/').split('?')[0]));}catch{return next();}
   if(!path.startsWith(source+sep))return next();
   try{if(!statSync(path).isFile())return next();}catch{return next();}
   const types={'.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm','.css':'text/css'};
   response.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');createReadStream(path).pipe(response);
  });},
  closeBundle(){mkdirSync(join(output,'cesium'),{recursive:true});for(const directory of ['Assets','ThirdParty','Workers','Widgets'])cpSync(join(source,directory),join(output,'cesium',directory),{recursive:true});}
 };
}

export function standaloneConfig(root,{cesium=false,port=5271}={}){
 return defineConfig({root,base:'./',logLevel:'warn',plugins:[react(),noticesPlugin(),contentSecurityPolicy(),...(cesium?[cesiumAssets(),knockoutWithoutEval()]:[])],
  resolve:{alias:[{find:'@geo/shared/style.css',replacement:join(shared,'style.css')},{find:/^@geo\/shared$/,replacement:join(shared,'index.jsx')}],dedupe:['react','react-dom']},
  ...(cesium?{define:{CESIUM_BASE_URL:JSON.stringify('./cesium/')}}:{}),
  server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[resolve(shared,'..')]}},
  preview:{host:'127.0.0.1',port,strictPort:true},build:{chunkSizeWarningLimit:5000}
 });
}
