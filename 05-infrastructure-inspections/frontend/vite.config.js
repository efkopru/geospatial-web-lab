import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {dirname,join,resolve,sep,extname} from 'node:path';
import {cpSync,createReadStream,statSync,mkdirSync} from 'node:fs';
const require=createRequire(import.meta.url);
const cesiumRoot=join(dirname(require.resolve('cesium/package.json')),'Build','Cesium');
function cesiumAssets(){
 let output;
 return {name:'cesium-local-assets',configResolved(config){output=config.build.outDir;},
  configureServer(server){server.middlewares.use('/cesium',(request,response,next)=>{
   let path;try{path=resolve(cesiumRoot,'.'+decodeURIComponent((request.url||'/').split('?')[0]));}catch{return next();}
   if(!path.startsWith(cesiumRoot+sep))return next();
   try{if(!statSync(path).isFile())return next();}catch{return next();}
   const types={'.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm','.css':'text/css'};
   response.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');createReadStream(path).pipe(response);
  });},
  closeBundle(){mkdirSync(join(output,'cesium'),{recursive:true});for(const directory of ['Assets','ThirdParty','Workers','Widgets'])cpSync(join(cesiumRoot,directory),join(output,'cesium',directory),{recursive:true});}
 };
}
export default defineConfig({plugins:[react(),cesiumAssets()],define:{CESIUM_BASE_URL:JSON.stringify('/cesium/')},server:{proxy:{'/api':{target:'http://127.0.0.1:3105',changeOrigin:false},'/up':{target:'http://127.0.0.1:3105',changeOrigin:false},'/cable':{target:'ws://127.0.0.1:3105',ws:true,changeOrigin:false}}},build:{chunkSizeWarningLimit:5000}});
