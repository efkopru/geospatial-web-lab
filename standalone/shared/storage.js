// Each application owns a separate database. No full-stack data is accessed.
//
// Layout (database version 2, object store "data"):
//   'meta'               {version, app, _revision, savedAt, keys}  — revision checked on every write
//   ['f', key]           {mode:'value', value} or {mode:'records', ids}  — one per top-level state field
//   ['r', key, id]       one record of a 'records' field (an array of objects with unique ids)
// A change rewrites only the fields and records that differ from the previous committed state,
// so the cost of a save follows the size of the change instead of the size of the whole dataset.
const queues=new Map();
export function serial(name,task){
 const pending=(queues.get(name)||Promise.resolve()).catch(()=>{}).then(task);
 queues.set(name,pending);return pending.finally(()=>{if(queues.get(name)===pending)queues.delete(name);});
}
const META='meta';
const fieldKey=key=>['f',key];
const recordKey=(key,id)=>['r',key,id];
const plainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=id=>typeof id==='string'||Number.isFinite(id);
// Arrays of objects with unique string or numeric ids are stored one record per element.
export function recordIds(value){
 if(!Array.isArray(value)||!value.every(item=>plainObject(item)&&validId(item.id)))return null;
 const ids=value.map(item=>item.id);
 return new Set(ids).size===ids.length?ids:null;
}
const request=source=>new Promise((resolve,reject)=>{source.onsuccess=()=>resolve(source.result);source.onerror=()=>reject(source.error);});

// Writes `state` into an open readwrite store. With `base` (the committed state the store holds),
// only fields and records that differ from base by identity are written; without it the store
// must already be empty.
function writeState(data,state,base){
 const keys=Object.keys(state);
 const deleteRecords=(key,ids)=>{for(const id of ids||[])data.delete(recordKey(key,id));};
 for(const key of Object.keys(base||{}))if(!Object.hasOwn(state,key)){data.delete(fieldKey(key));deleteRecords(key,recordIds(base[key]));}
 for(const key of keys){
  const value=state[key],previous=base?.[key];
  if(base&&Object.hasOwn(base,key)&&value===previous)continue;
  const ids=recordIds(value),previousIds=base?recordIds(previous):null;
  if(!ids){data.put({mode:'value',value},fieldKey(key));deleteRecords(key,previousIds);continue;}
  if(!previousIds)for(const item of value)data.put(item,recordKey(key,item.id));
  else{
   const before=new Map(previous.map(item=>[item.id,item]));
   for(const item of value)if(before.get(item.id)!==item)data.put(item,recordKey(key,item.id));
   const kept=new Set(ids);
   for(const id of previousIds)if(!kept.has(id))data.delete(recordKey(key,id));
  }
  if(!previousIds||ids.length!==previousIds.length||ids.some((id,index)=>id!==previousIds[index]))data.put({mode:'records',ids},fieldKey(key));
 }
 return keys;
}
async function readState(data){
 const [keys,values]=await Promise.all([request(data.getAllKeys()),request(data.getAll())]);
 let meta;const fields=new Map(),records=new Map();
 keys.forEach((key,index)=>{
  const value=values[index];
  if(key===META)meta=value;
  else if(Array.isArray(key)&&key[0]==='f')fields.set(key[1],value);
  else if(Array.isArray(key)&&key[0]==='r'){if(!records.has(key[1]))records.set(key[1],new Map());records.get(key[1]).set(key[2],value);}
 });
 if(!meta)return undefined;
 const state={};
 for(const key of meta.keys){
  const field=fields.get(key);if(!field)continue;
  if(field.mode==='value')state[key]=field.value;
  else{const stored=records.get(key)||new Map();state[key]=field.ids.map(id=>stored.get(id));}
 }
 const {keys:_keys,...envelope}=meta;
 return {...envelope,state};
}

export class LocalStore {
 constructor(id,{indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks}={}){this.name=`geolab-standalone-${id}-v1`;this.indexedDB=indexedDB;this.locks=locks;this.db=null;}
 async open(){
  if(this.db)return this.db;
  if(!this.indexedDB)throw new Error('Browser storage is unavailable. Enable IndexedDB and reopen this app.');
  this.db=await new Promise((resolve,reject)=>{
   const opening=this.indexedDB.open(this.name,2);
   opening.onupgradeneeded=event=>{
    const db=opening.result;
    if(event.oldVersion<1){db.createObjectStore('data');return;}
    // Version 1 kept the whole envelope under 'state'; split it into fields and records.
    const data=opening.transaction.objectStore('data');
    const legacy=data.get('state');
    legacy.onsuccess=()=>{
     const value=legacy.result;data.delete('state');if(!value)return;
     const {state,...envelope}=value;
     const stateObject=plainObject(state)?state:{};
     const keys=writeState(data,stateObject);
     data.put({...envelope,keys},META);
    };
   };
   opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);
   opening.onblocked=()=>reject(new Error('Close other tabs of this app to finish opening browser storage.'));
  });
  this.db.onversionchange=()=>{this.db?.close();this.db=null;};return this.db;
 }
 // The committed envelope {version, app, state, _revision, savedAt}, assembled from its records.
 async get(){const db=await this.open();return readState(db.transaction('data','readonly').objectStore('data'));}
 // Only the revision, without reading any state.
 async revision(){const db=await this.open();const meta=await request(db.transaction('data','readonly').objectStore('data').get(META));return meta?._revision||0;}
 // Writes an envelope when the stored revision equals expectedRevision. With `base`, only the
 // fields and records that differ from base (by identity) are written.
 async put(value,{expectedRevision,base}={}){const db=await this.open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('data','readwrite');const data=tx.objectStore('data');let conflict;
  const {state,...envelope}=value;
  const write=()=>{
   if(!base)data.clear();
   const keys=writeState(data,plainObject(state)?state:{},base);
   data.put({...envelope,keys},META);
  };
  const read=data.get(META);
  read.onsuccess=()=>{
   if(expectedRevision!==undefined&&(read.result?._revision||0)!==expectedRevision){conflict=new Error('Another tab changed this dataset. Reload the current values and retry.');conflict.status=409;tx.abort();}
   else write();
  };
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict||tx.error||new Error('Browser storage write was aborted.'));
 });}
 async exclusive(task){return serial(this.name,()=>this.locks?this.locks.request(`${this.name}:write`,task):task());}
 close(){this.db?.close();this.db=null;}
}
