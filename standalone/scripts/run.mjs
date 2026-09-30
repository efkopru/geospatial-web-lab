import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {ProcessGroup,CancelledProcessError,assembleGallery} from './launcher.mjs';
import {copyNotices} from './notices.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const vite=join(dirname(require.resolve('vite/package.json')),'bin','vite.js');
const [mode='dev',selection]=process.argv.slice(2);
if(!['dev','build','preview'].includes(mode)||selection&&!/^[1-5]$/.test(selection))throw new Error('Use dev, build, or preview, optionally followed by an app number 1-5.');
let apps=(await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()&&/^0[1-5]-/.test(x.name)).map(x=>x.name).sort();
if(selection)apps=apps.filter(x=>Number(x.slice(0,2))===Number(selection));
const group=new ProcessGroup();
const interrupt=()=>group.stop(130),terminate=()=>group.stop(143);
process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
const run=app=>group.run(process.execPath,[vite,...(mode==='dev'?[]:[mode]),'--config','vite.config.js'],{cwd:resolve(root,app),stdio:'inherit',windowsHide:true},{label:app,persistent:mode!=='build'});
try{
 if(mode==='build'){
  for(const app of apps){group.throwIfStopped();console.log(`Building ${app}`);await run(app);}
  group.throwIfStopped();const dist=await assembleGallery(root,apps,()=>group.throwIfStopped());
  group.throwIfStopped();await copyNotices(dist);
  group.throwIfStopped();console.log('Static comparison gallery built in standalone/dist. Serve this directory over HTTP.');
 }else{
  const tasks=[];
  if(!selection)tasks.push(group.run(process.execPath,[join(root,'scripts','serve.mjs'),mode],{cwd:root,stdio:'inherit',windowsHide:true},{label:'Comparison gallery',persistent:true}));
  tasks.push(...apps.map(run));await Promise.all(tasks);
 }
}catch(error){if(!(error instanceof CancelledProcessError))console.error(error.message);group.stop(group.exitCode||1);}
finally{process.exitCode=group.exitCode;process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
