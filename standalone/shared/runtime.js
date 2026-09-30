import {LocalStore} from './storage.js';
export const USERS=Object.freeze([
 {id:1,name:'Alex Morgan',role:'staff',email:'staff@example.test'},
 {id:2,name:'Jordan Lee',role:'reporter',email:'reporter@example.test'},
 {id:3,name:'Casey Rivera',role:'staff',email:'crew@example.test'}
]);
export function fail(message,status=422){const error=new Error(message);error.status=status;throw error;}
const copy=value=>value===undefined?undefined:structuredClone(value);
let active;
export function getRuntime(){if(!active)throw new Error('Standalone application was not initialized.');return active;}
export function configureStandalone(options){active?.dispose();active=createRuntime(options);return active;}

export function createRuntime({id,seed,handle,start,store=new LocalStore(id),environment=globalThis}){
 let state,user=USERS[0],revision=0,dataRevision=0,disposed=false,stop,channel;
 const listeners=new Set();
 const meta={loading:true,error:'',persistent:false,savedAt:null,coordinated:!!environment.navigator?.locks};
 const roleKey=`geolab-standalone-${id}:role`;
 try{const saved=environment.sessionStorage?.getItem(roleKey);if(saved!==null&&saved!==undefined)user=USERS.find(x=>x.id===Number(saved))||null;}catch{}
 const notify=type=>{for(const listener of listeners)listener(type);};
 const reportError=error=>{meta.error=error?.message||String(error);notify('meta');};
 const context=(draft,actor=copy(user))=>({state:draft,user:copy(actor),users:copy(USERS),now:()=>new Date().toISOString(),fail,requireStaff(){if(actor?.role!=='staff')fail('This action requires the staff demonstration role.',403);}});
 const envelope=(draft,baseRevision)=>({version:1,app:id,state:draft,_revision:baseRevision+1,savedAt:new Date().toISOString()});
 const valid=value=>{if(value?.version!==1||value.app!==id||!value.state||typeof value.state!=='object')throw new Error('Saved data is incompatible. Export a backup, then reset this standalone dataset.');return value;};
 const apply=value=>{state=copy(value.state);dataRevision=value._revision||0;meta.savedAt=value.savedAt;meta.persistent=true;};
 const broadcast=()=>{try{channel?.postMessage({type:'changed'});}catch{}notify('data');};
 const persist=async(draft,baseRevision=dataRevision)=>{const value=envelope(draft,baseRevision);try{await store.put(value,{expectedRevision:baseRevision});}catch(error){if(error.status===409)throw error;throw new Error(`Changes were not saved: ${error.message}. Export a backup or free browser storage.`);}apply(value);meta.error='';};
 const runtime={id,meta,users:USERS,
  get user(){return copy(user);},get revision(){return revision;},
  read:()=>copy(state),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},reportError,
  async selectUser(id){await runtime.ready;user=USERS.find(x=>x.id===Number(id))||null;try{environment.sessionStorage?.setItem(roleKey,String(user?.id||0));}catch{}notify('session');return copy(user);},
  async mutate(fn,actor=copy(user)){await runtime.ready;return store.exclusive(async()=>{apply(valid(await store.get()));const baseRevision=dataRevision;const draft=copy(state);const result=await fn(draft,context(draft,actor));if(disposed)return;await persist(draft,baseRevision);broadcast();return copy(result);}).catch(error=>{reportError(error);throw error;});},
  async request(input,options={}){
   const actor=copy(user);await runtime.ready;
   const url=new URL(input.startsWith('/api/')?input:'/api'+(input.startsWith('/')?'':'/')+input,'https://standalone.invalid');
   const method=(options.method||'GET').toUpperCase();const body=typeof options.body==='string'?JSON.parse(options.body):options.body||{};
   if(url.pathname==='/api/session'){
    if(method==='DELETE'){await runtime.selectUser(0);return {user:null};}
    if(method==='POST'){const target=USERS.find(x=>x.email===body.email||x.id===Number(body.user_id));if(!target)fail('Choose a demonstration role.');await runtime.selectUser(target.id);}
    return {user:copy(user)};
   }
   if(meta.loading||!state)fail(meta.error||'Browser storage has not loaded.',503);
   if(!actor)fail('Choose a demonstration role to continue.',401);
   const request={path:url.pathname,query:url.searchParams,method,body};
   if(method!=='GET')return runtime.mutate((draft,ctx)=>handle(request,ctx),actor);
   // Read the last committed snapshot; handlers receive a disposable draft.
   apply(valid(await store.get()));const draft=copy(state);return copy(await handle(request,context(draft,actor)));
  },
  async reset(){await runtime.ready;await store.exclusive(async()=>{const previous=await store.get();await persist(await seed(),previous?._revision||0);revision++;broadcast();notify('reset');});},
  async backup(){await runtime.ready;const saved=await store.get();return {format:'geospatial-web-lab-standalone-backup',exportedAt:new Date().toISOString(),...copy(saved)};},
  dispose(){disposed=true;stop?.();channel?.close();store.close();listeners.clear();environment.removeEventListener?.('pagehide',unload);environment.removeEventListener?.('pageshow',restore);environment.document?.removeEventListener('click',downloadClick);}
 };
 const downloadClick=async event=>{
  if(event.defaultPrevented||event.button!==0)return;const anchor=event.target.closest?.('a[href]');if(!anchor)return;
  const href=anchor.getAttribute('href');if(!href?.startsWith('/api/'))return;
  event.preventDefault();try{const value=await runtime.request(href);if(!value?.download)throw new Error('This download is unavailable.');download(value.download);}catch(error){reportError(error);}
 };
 const unload=()=>{stop?.();channel?.close();};
 const restore=event=>{if(event.persisted)environment.location?.reload();};
 environment.document?.addEventListener('click',downloadClick);
 environment.addEventListener?.('pagehide',unload);
 environment.addEventListener?.('pageshow',restore);
 runtime.ready=(async()=>{
  await store.exclusive(async()=>{const previous=await store.get();if(previous)apply(valid(previous));else await persist(await seed());});
  if(disposed)return;
  if(environment.BroadcastChannel){channel=new environment.BroadcastChannel(`geolab-standalone-${id}`);channel.onmessage=async()=>{try{apply(valid(await store.get()));notify('data');}catch(error){reportError(error);}};}
  meta.loading=false;notify('session');
 })().catch(error=>{meta.loading=false;reportError(error);notify('session');});
 runtime.ready.then(async()=>{if(start&&state&&!disposed)try{stop=await start(runtime);}catch(error){reportError(error);}});
 return runtime;
}

export function download({filename,mime='application/json',content}){
 const url=URL.createObjectURL(new Blob([content],{type:mime}));const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
