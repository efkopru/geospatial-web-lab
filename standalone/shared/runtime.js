import {createDraft,finishDraft,current,isDraft,freeze} from 'immer';
import {LocalStore} from './storage.js';
export const USERS=Object.freeze([
 {id:1,name:'Alex Morgan',role:'staff',email:'staff@example.test'},
 {id:2,name:'Jordan Lee',role:'reporter',email:'reporter@example.test'},
 {id:3,name:'Casey Rivera',role:'staff',email:'crew@example.test'}
]);
export function fail(message,status=422){const error=new Error(message);error.status=status;throw error;}
const copy=value=>value===undefined?undefined:structuredClone(value);
export const BACKUP_FORMAT='geospatial-web-lab-standalone-backup';
const plain=value=>value!==null&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
// Converts any draft inside a handler result into plain data before the draft is finished.
const snapshot=value=>isDraft(value)?current(value):Array.isArray(value)?value.map(snapshot):plain(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,snapshot(item)])):value;
const kind=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
// Required fields and value kinds for the records of each top-level array, inferred from the
// seeded records. A field the seed only ever leaves null carries no type information.
function recordShapes(reference){
 const shapes={};
 for(const [key,items] of Object.entries(reference)){
  if(kind(items)!=='array'||!items.length||items.some(item=>kind(item)!=='object'))continue;
  const fields=new Map();
  for(const field of Object.keys(items[0]))if(items.every(item=>Object.hasOwn(item,field)))fields.set(field,new Set(items.map(item=>kind(item[field]))));
  for(const [field,kinds] of fields)if(kinds.size===1&&kinds.has('null'))fields.delete(field);
  shapes[key]=fields;
 }
 return shapes;
}
// A backup must come from this app, use the current envelope version and match the shape of a
// freshly seeded state (top-level fields and the fields of seeded record types), so a restore
// cannot load another app's records or records the handlers cannot read.
export function checkBackup(value,id,reference,shapes=recordShapes(reference)){
 if(kind(value)!=='object'||value.format!==BACKUP_FORMAT)fail('This file is not a standalone backup. Choose a file saved with Export local backup.');
 if(value.app!==id)fail(`This backup belongs to ${typeof value.app==='string'?value.app:'another app'}, not ${id}.`);
 if(value.version!==1)fail(`Backup version ${value.version} is not supported by this edition.`);
 const state=value.state;if(kind(state)!=='object')fail('The backup has no stored state.');
 for(const [key,expected] of Object.entries(reference)){
  const actual=kind(state[key]);
  if(actual!==kind(expected))fail(`The backup field "${key}" should be ${kind(expected)}, not ${actual==='undefined'?'missing':actual}.`);
  if(actual==='array'&&state[key].some(item=>kind(item)!=='object'))fail(`The backup field "${key}" contains invalid records.`);
  if(actual==='number'&&!Number.isFinite(state[key]))fail(`The backup field "${key}" is not a finite number.`);
 }
 if('schema_version' in reference&&state.schema_version!==reference.schema_version)fail(`Backup schema ${state.schema_version} does not match this edition's schema ${reference.schema_version}.`);
 for(const [key,fields] of Object.entries(shapes))state[key].forEach((record,index)=>{
  for(const [field,kinds] of fields){
   const actual=kind(record[field]);
   if(!kinds.has(actual))fail(`Record ${index+1} in "${key}" has ${actual==='undefined'?'no':`an invalid (${actual})`} "${field}" field.`);
  }
 });
 return copy(state);
}
let active;
export function getRuntime(){if(!active)throw new Error('Standalone application was not initialized.');return active;}
export function configureStandalone(options){active?.dispose();active=createRuntime(options);return active;}

export function createRuntime({id,seed,handle,start,prepareRestore,store=new LocalStore(id),environment=globalThis}){
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
 // The committed state is kept frozen in memory. Handlers work on a copy-on-write draft, so a
 // change shares every untouched record with the committed state and only changed records are
 // written to storage. Freezing makes any accidental mutation of committed data throw.
 const apply=value=>{state=freeze(value.state,true);dataRevision=value._revision||0;meta.savedAt=value.savedAt;meta.persistent=true;};
 // Reloads the committed state only when another tab has written since this tab last read it.
 const sync=async()=>{
  if(!store.revision){apply(valid(await store.get()));return;}
  if(!state||await store.revision()!==dataRevision)apply(valid(await store.get()));
 };
 const runDraft=async fn=>{
  const draft=createDraft(state);let result;
  try{result=snapshot(await fn(draft));}catch(error){finishDraft(draft);throw error;}
  return {next:finishDraft(draft),result};
 };
 const broadcast=()=>{try{channel?.postMessage({type:'changed'});}catch{}notify('data');};
 // The seed shape is computed once; validated backups are remembered so a confirmed restore
 // does not clone and check the same file twice.
 let shape;const validated=new WeakMap();
 const backupState=async value=>{
  if(!validated.has(value)){shape??=(async()=>{const reference=await seed();return {reference,shapes:recordShapes(reference)};})();const {reference,shapes}=await shape;const state=checkBackup(value,id,reference,shapes);prepareRestore?.(state);validated.set(value,state);}
  return validated.get(value);
 };
 const persist=async(draft,baseRevision=dataRevision,base)=>{const value=envelope(draft,baseRevision);try{await store.put(value,{expectedRevision:baseRevision,base});}catch(error){if(error.status===409)throw error;throw new Error(`Changes were not saved: ${error.message}. Export a backup or free browser storage.`);}apply(value);meta.error='';};
 // Reset and restore publish a whole replacement state as one revision-checked write.
 const replaceState=next=>store.exclusive(async()=>{const previousRevision=store.revision?await store.revision():(await store.get())?._revision||0;await persist(next,previousRevision);revision++;broadcast();notify('reset');});
 const runtime={id,meta,users:USERS,
  get user(){return copy(user);},get revision(){return revision;},
  read:()=>copy(state),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},reportError,
  async selectUser(id){await runtime.ready;user=USERS.find(x=>x.id===Number(id))||null;try{environment.sessionStorage?.setItem(roleKey,String(user?.id||0));}catch{}notify('session');return copy(user);},
  async mutate(fn,actor=copy(user)){await runtime.ready;return store.exclusive(async()=>{
   await sync();const base=state,baseRevision=dataRevision;
   const {next,result}=await runDraft(draft=>fn(draft,context(draft,actor)));
   if(disposed)return;
   if(next!==base){await persist(next,baseRevision,base);broadcast();}
   return copy(result);
  }).catch(error=>{reportError(error);throw error;});},
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
   // Read the last committed state; handlers receive a disposable draft.
   await sync();const {result}=await runDraft(draft=>handle(request,context(draft,actor)));return copy(result);
  },
  async reset(){await runtime.ready;await replaceState(await seed());},
  async backup(){await runtime.ready;const saved=await store.get();return {format:BACKUP_FORMAT,exportedAt:new Date().toISOString(),...copy(saved)};},
  // Checks a backup without changing stored data; restore then replaces the whole state with it.
  async validateBackup(value){await backupState(value);},
  async restore(value){await runtime.ready;await replaceState(await backupState(value));},
  dispose(){disposed=true;stop?.();channel?.close();store.close();listeners.clear();environment.removeEventListener?.('pagehide',unload);environment.removeEventListener?.('pageshow',reloadFromCache);environment.document?.removeEventListener('click',downloadClick);}
 };
 const downloadClick=async event=>{
  if(event.defaultPrevented||event.button!==0)return;const anchor=event.target.closest?.('a[href]');if(!anchor)return;
  const href=anchor.getAttribute('href');if(!href?.startsWith('/api/'))return;
  event.preventDefault();try{const value=await runtime.request(href);if(!value?.download)throw new Error('This download is unavailable.');download(value.download);}catch(error){reportError(error);}
 };
 const unload=()=>{stop?.();channel?.close();};
 const reloadFromCache=event=>{if(event.persisted)environment.location?.reload();};
 environment.document?.addEventListener('click',downloadClick);
 environment.addEventListener?.('pagehide',unload);
 environment.addEventListener?.('pageshow',reloadFromCache);
 runtime.ready=(async()=>{
  await store.exclusive(async()=>{const previous=await store.get();if(previous)apply(valid(previous));else await persist(await seed());});
  if(disposed)return;
  if(environment.BroadcastChannel){channel=new environment.BroadcastChannel(`geolab-standalone-${id}`);channel.onmessage=async()=>{try{await sync();notify('data');}catch(error){reportError(error);}};}
  meta.loading=false;notify('session');
 })().catch(error=>{meta.loading=false;reportError(error);notify('session');});
 runtime.ready.then(async()=>{if(start&&state&&!disposed)try{stop=await start(runtime);}catch(error){reportError(error);}});
 return runtime;
}

export function download({filename,mime='application/json',content}){
 const url=URL.createObjectURL(new Blob([content],{type:mime}));const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
