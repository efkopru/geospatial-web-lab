import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep,extname} from 'node:path';
import {cpSync,createReadStream,statSync,mkdirSync} from 'node:fs';
import {noticesPlugin} from './scripts/notices.mjs';
const require=createRequire(import.meta.url);
const shared=fileURLToPath(new URL('./shared/',import.meta.url));

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
 return defineConfig({root,base:'./',logLevel:'warn',plugins:[react(),noticesPlugin(),...(cesium?[cesiumAssets()]:[])],
  resolve:{alias:[{find:'@geo/shared/style.css',replacement:join(shared,'style.css')},{find:/^@geo\/shared$/,replacement:join(shared,'index.jsx')}],dedupe:['react','react-dom']},
  ...(cesium?{define:{CESIUM_BASE_URL:JSON.stringify('./cesium/')}}:{}),
  server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[resolve(shared,'..')]}},
  preview:{host:'127.0.0.1',port,strictPort:true},build:{chunkSizeWarningLimit:5000}
 });
}
