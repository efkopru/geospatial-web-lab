// Each application owns a separate database. No full-stack data is accessed.
const queues=new Map();
export function serial(name,task){
 const pending=(queues.get(name)||Promise.resolve()).catch(()=>{}).then(task);
 queues.set(name,pending);return pending.finally(()=>{if(queues.get(name)===pending)queues.delete(name);});
}
export class LocalStore {
 constructor(id,{indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks}={}){this.name=`geolab-standalone-${id}-v1`;this.indexedDB=indexedDB;this.locks=locks;this.db=null;}
 async open(){
  if(this.db)return this.db;
  if(!this.indexedDB)throw new Error('Browser storage is unavailable. Enable IndexedDB and reopen this app.');
  this.db=await new Promise((resolve,reject)=>{const request=this.indexedDB.open(this.name,1);request.onupgradeneeded=()=>request.result.createObjectStore('data');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other tabs of this app to finish opening browser storage.'));});
  this.db.onversionchange=()=>{this.db?.close();this.db=null;};return this.db;
 }
 async get(){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('data','readonly');const request=tx.objectStore('data').get('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 async put(value,{expectedRevision}={}){const db=await this.open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('data','readwrite');const data=tx.objectStore('data');let conflict;
  const write=()=>data.put(value,'state');
  if(expectedRevision===undefined)write();else{const read=data.get('state');read.onsuccess=()=>{
   if((read.result?._revision||0)!==expectedRevision){conflict=new Error('Another tab changed this dataset. Reload the current values and retry.');conflict.status=409;tx.abort();}else write();
  };}
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict||tx.error||new Error('Browser storage write was aborted.'));
 });}
 async exclusive(task){return serial(this.name,()=>this.locks?this.locks.request(`${this.name}:write`,task):task());}
 close(){this.db?.close();this.db=null;}
}
