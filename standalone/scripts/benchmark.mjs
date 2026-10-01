// Measures standalone domain work at documented limits and at larger stored datasets.
// Runs the real adapters through the shared runtime (clone, handler, envelope, IndexedDB
// write) on fake-indexeddb in Node. Absolute times differ in browsers; use the numbers to
// compare sizes and to find operations whose cost grows with the whole stored state.
// Usage: node scripts/benchmark.mjs [--quick]
import {IDBFactory} from 'fake-indexeddb';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {LocalStore} from '../shared/storage.js';
import {createRuntime} from '../shared/runtime.js';
import * as service from '../01-service-requests/src/local-api.js';
import * as quality from '../02-data-quality-portal/src/local-api.js';
import * as fleet from '../03-fleet-monitor/src/local-api.js';
import * as parcels from '../04-parcel-scenarios/src/local-api.js';
import * as inspections from '../05-infrastructure-inspections/src/local-api.js';

const quick=process.argv.includes('--quick');
const RUNS=quick?2:5;
const rows=[];
const kb=value=>Math.round(Buffer.byteLength(JSON.stringify(value))/1024);
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];

async function open(id,adapter,state){
 const store=new LocalStore(id,{indexedDB:new IDBFactory(),locks:undefined});
 if(state)await store.put({version:1,app:id,state,_revision:1,savedAt:new Date().toISOString()});
 const runtime=createRuntime({id,seed:adapter.seed,handle:adapter.handle,store,environment:{}});
 await runtime.ready;
 if(runtime.meta.error)throw new Error(runtime.meta.error);
 return runtime;
}
// `after` runs untimed between runs; `stateKb` reports the size when `after` resets the state.
async function measure(app,operation,size,runtime,task,{after,stateKb}={}){
 const times=[];
 for(let run=0;run<RUNS;run++){const start=performance.now();await task(run);times.push(performance.now()-start);await after?.();}
 rows.push({app,operation,size,stateKb:stateKb?.()??kb(runtime.read()),ms:median(times)});
 if(process.stderr.isTTY||process.env.BENCH_PROGRESS)console.error(`${app} | ${operation} | ${size}: ${median(times).toFixed(1)} ms`);
}

// 01 Civic Works: up to 5000 requests, 500-feature imports, CSV export of every visible request.
function serviceState(count){
 const state=service.seed();const template=state.issues[0];
 state.issues=Array.from({length:count},(_,index)=>({...structuredClone(template),id:index+1,title:`Synthetic request ${index+1}`,latitude:33.0+(index%100)*0.001,longitude:-97.0+Math.floor(index/100)*0.001,updated_at:`2026-09-29T15:${String(index%60).padStart(2,'0')}:00.000Z`}));
 state.nextIssue=count+1;return state;
}
const pointFeatures=(count,offset)=>({type:'FeatureCollection',features:Array.from({length:count},(_,index)=>({type:'Feature',properties:{title:`Imported ${offset}-${index}`,category:'roads'},geometry:{type:'Point',coordinates:[-97+index*0.0001,33+offset*0.0001]}}))});
for(const count of quick?[6,4500]:[6,1000,2500,4500]){
 const runtime=await open('01-service-requests',service,serviceState(count));
 const size=`${count} requests`;
 await measure('01 Civic Works','Create one request',size,runtime,run=>runtime.request('/api/issues',{method:'POST',body:{issue:{title:`Bench ${run}`,category:'roads',latitude:33.04,longitude:-96.99}}}));
 await measure('01 Civic Works','List with 1 km distance filter',size,runtime,()=>runtime.request('/api/issues?latitude=33.045&longitude=-96.995&radius_m=1000'));
 if(count+RUNS*501<=5000)await measure('01 Civic Works','Import 500 point features',size,runtime,run=>runtime.request('/api/import_runs',{method:'POST',body:{geojson:pointFeatures(500,run+count)}}));
 await measure('01 Civic Works','Generate CSV export',size,runtime,()=>runtime.request('/api/export_runs',{method:'POST'}));
 runtime.dispose();
}

// 02 Data Quality Portal: 2000-feature uploads (5 MB file limit) and a nearly full 10 MB stored-upload budget.
const ring=(x,y,vertices)=>{const points=Array.from({length:vertices},(_,index)=>{const angle=index/vertices*2*Math.PI;return [x+Math.cos(angle)*0.0005,y+Math.sin(angle)*0.0005];});return [...points,points[0]];};
const polygons=(count,vertices,seed)=>JSON.stringify({type:'FeatureCollection',features:Array.from({length:count},(_,index)=>({type:'Feature',properties:{asset_id:`A-${seed}-${index}`},geometry:{type:'Polygon',coordinates:[ring(-97+(index%50)*0.002,33+Math.floor(index/50)*0.002,vertices)]}}))});
const upload=(runtime,source,name)=>runtime.request('/api/datasets',{method:'POST',body:{name,source,required_attributes:['asset_id']}});
for(const [count,vertices] of quick?[[2000,16]]:[[500,16],[2000,16],[2000,64]]){
 const runtime=await open('02-data-quality-portal',quality);
 const sample=polygons(count,vertices,0);
 // Each run starts from the seeded datasets so the stored-upload budget does not interfere.
 const seeded=runtime.read();let stored;
 await measure('02 Data Quality','Validate upload',`${count} polygons x ${vertices} vertices (${Math.round(Buffer.byteLength(sample)/1024)} KB)`,runtime,run=>upload(runtime,polygons(count,vertices,run),`Bench ${run}`),{after:async()=>{stored=kb(runtime.read());await runtime.mutate(state=>{Object.assign(state,structuredClone(seeded));});},stateKb:()=>stored});
 runtime.dispose();
}
{
 const runtime=await open('02-data-quality-portal',quality);
 for(let index=0;index<2;index++)await upload(runtime,polygons(2000,64,`fill-${index}`),`Fill ${index}`);
 await measure('02 Data Quality','Small upload at the stored-upload budget',`${runtime.read().datasets.length} datasets, 2 x 4.9 MB uploads`,runtime,run=>upload(runtime,polygons(1,8,`small-${run}`),`Small ${run}`));
 runtime.dispose();
}

// 03 Fleet Monitor: one replay tick with empty and full retained history.
{
 const runtime=await open('03-fleet-monitor',fleet);
 await runtime.mutate(state=>{fleet.controlReplay(state,'start',1);});
 await measure('03 Fleet Monitor','Replay tick (10 vehicles)','empty history',runtime,()=>runtime.mutate(state=>fleet.advance(state)));
 await runtime.mutate(state=>{for(let frame=0;frame<fleet.HISTORY_LIMIT+50;frame++)fleet.advance(state);});
 await measure('03 Fleet Monitor','Replay tick (10 vehicles)',`history at ${fleet.HISTORY_LIMIT} points per vehicle`,runtime,()=>runtime.mutate(state=>fleet.advance(state)));
 runtime.dispose();
}

// 04 Parcel Scenarios: growth up to the 500 saved-scenario cap.
for(const count of quick?[0,parcels.MAX_SCENARIOS-RUNS-2]:[0,100,250,parcels.MAX_SCENARIOS-RUNS-2]){
 const state=parcels.seed();const ids=state.parcels.slice(0,6).map(parcel=>parcel.id);
 const runtime=await open('04-parcel-scenarios',parcels,state);
 if(count)await runtime.mutate((draft,ctx)=>{for(let index=0;index<count;index++)parcels.handle({path:'/api/scenarios',method:'POST',body:{scenario:{name:`Seeded ${index}`,floors:4,coverage:0.5,unit_area:850,parcel_ids:ids}}},ctx);});
 await measure('04 Parcel Scenarios','Save one scenario',`${count+2} saved scenarios`,runtime,run=>runtime.request('/api/scenarios',{method:'POST',body:{scenario:{name:`Bench ${run}`,floors:6,coverage:0.6,unit_area:900,parcel_ids:ids}}}));
 runtime.dispose();
}

// 05 Infrastructure Inspections: completed profile runs are pruned to the newest PROFILE_RUN_LIMIT.
for(const count of [0,inspections.PROFILE_RUN_LIMIT]){
 const runtime=await open('05-infrastructure-inspections',inspections);
 if(count)await runtime.mutate((draft,ctx)=>{for(let index=0;index<count;index++)inspections.handle({path:'/api/profile_runs',method:'POST',body:{}},ctx);});
 await measure('05 Inspections','Generate 71-sample profile',`${count} stored profile runs`,runtime,()=>runtime.request('/api/profile_runs',{method:'POST',body:{}}));
 runtime.dispose();
}

console.log(`Standalone benchmark: Node ${process.version}, ${os.cpus()[0]?.model||'unknown CPU'}, fake-indexeddb, median of ${RUNS}`);
console.log('');
console.log('| App | Operation | Data size | Stored state after the runs | Median |');
console.log('| --- | --- | --- | ---: | ---: |');
for(const row of rows)console.log(`| ${row.app} | ${row.operation} | ${row.size} | ${row.stateKb.toLocaleString('en-US')} KB | ${row.ms.toFixed(1)} ms |`);
