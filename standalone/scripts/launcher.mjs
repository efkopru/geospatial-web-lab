import {spawn as spawnProcess} from 'node:child_process';
import {cp,lstat,mkdir,realpath,rm,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';

export class CancelledProcessError extends Error {
 constructor(){super('Standalone launcher stopped.');this.name='CancelledProcessError';}
}

export class ProcessGroup {
 constructor(spawn=spawnProcess){this.spawn=spawn;this.children=new Set();this.stopping=false;this.exitCode=0;}
 throwIfStopped(){if(this.stopping)throw new CancelledProcessError();}
 stop(code=0){
  if(this.stopping)return;
  this.stopping=true;this.exitCode=code;
  for(const child of this.children){try{child.kill('SIGTERM');}catch{}}
 }
 run(command,args,options,{label=command,persistent=false}={}){
  return new Promise((resolveRun,rejectRun)=>{
   if(this.stopping){rejectRun(new CancelledProcessError());return;}
   let child;
   try{child=this.spawn(command,args,options);}catch(error){this.stop(1);rejectRun(error);return;}
   this.children.add(child);
   child.once('error',error=>{this.children.delete(child);this.stop(1);rejectRun(error);});
   child.once('exit',(code,signal)=>{
    this.children.delete(child);
    if(this.stopping){rejectRun(new CancelledProcessError());return;}
    if(code!==0||persistent){this.stop(code||1);rejectRun(new Error(`${label} exited ${signal||code}${persistent?' while the launcher was running':''}`));return;}
    resolveRun();
   });
  });
 }
}

async function noSymbolicLink(path){
 try{if((await lstat(path)).isSymbolicLink())throw new Error(`Refusing to replace a symbolic link in generated output: ${path}`);}
 catch(error){if(error.code!=='ENOENT')throw error;}
}

export async function assembleGallery(root,apps,check=()=>{}){
 const canonicalRoot=await realpath(root),dist=resolve(canonicalRoot,'dist');
 await noSymbolicLink(dist);
 check();await mkdir(dist,{recursive:true});
 for(const app of apps){
  check();
  if(!/^0[1-5]-[a-z0-9-]+$/.test(app))throw new Error('Invalid standalone app directory');
  const target=resolve(dist,app);
  // Verify the final absolute delete target stays under this generated dist.
  if(target===dist||!target.startsWith(dist+sep))throw new Error('Generated output escaped its dist directory');
  await noSymbolicLink(target);
  check();await rm(target,{recursive:true,force:true});
  check();await cp(join(canonicalRoot,app,'dist'),target,{recursive:true,force:true});
 }
 check();await cp(join(canonicalRoot,'index.html'),join(dist,'index.html'));
 check();await writeFile(join(dist,'.nojekyll'),'');
 return dist;
}
