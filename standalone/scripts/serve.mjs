import http from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const appNames=['01-service-requests','02-data-quality-portal','03-fleet-monitor','04-parcel-scenarios','05-infrastructure-inspections'];
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.md':'text/plain;charset=utf-8','.txt':'text/plain;charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2','.ico':'image/x-icon'};

export function createStaticHandler({directory=root,mode='preview'}={}){
 if(!['dev','preview'].includes(mode))throw new Error('Static server mode must be dev or preview');
 const base=resolve(directory,mode==='dev'?'.':'dist');
 return async(req,res)=>{
  try{
   if(req.method&&req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
   const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);
   const app=appNames.indexOf(path.replace(/^\//,'').replace(/\/$/,''));
   if(mode==='dev'&&app!==-1){res.writeHead(302,{Location:`http://127.0.0.1:${5271+app}/${url.search}`});res.end();return;}
   const devPublic=path==='/'||path==='/index.html'||path==='/THIRD_PARTY_NOTICES.md'||/^\/licenses\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(path);
   if(mode==='dev'&&!devPublic){res.writeHead(404);res.end('Not found');return;}
   let file=resolve(base,'.'+path);
   if(file!==base&&!file.startsWith(base+sep)){res.writeHead(403);res.end();return;}
   if((await stat(file)).isDirectory()){
    // Relative Vite assets need a slash-terminated document directory.
    if(!url.pathname.endsWith('/')){res.writeHead(308,{Location:`${url.pathname}/${url.search}`});res.end();return;}
    file=resolve(file,'index.html');
   }
   const canonicalBase=await realpath(base),canonicalFile=await realpath(file);
   if(canonicalFile!==canonicalBase&&!canonicalFile.startsWith(canonicalBase+sep)){res.writeHead(403);res.end();return;}
   const content=await readFile(canonicalFile);
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found. Build the standalone apps before starting preview.');}
 };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2]||'preview',port=Number(process.env.STANDALONE_PORT||5270);
 const server=http.createServer(createStaticHandler({mode}));
 server.listen(port,'127.0.0.1',()=>console.log(`Standalone comparison gallery: http://127.0.0.1:${port}/ (${mode})`));
 server.on('error',error=>{console.error(error.message);process.exitCode=1;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
}
