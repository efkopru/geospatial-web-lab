import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,handle,distanceMeters,csvReport,validateIssue} from '../01-service-requests/src/local-api.js';
const users=[{id:1,name:'Alex Morgan',role:'staff'},{id:2,name:'Jordan Lee',role:'reporter'},{id:3,name:'Casey Rivera',role:'staff'}];
function context(state=seed(),user=users[0]){const fail=(message,status=422)=>{const error=new Error(message);error.status=status;throw error;};return {state,user,users,now:()=>new Date().toISOString(),fail,requireStaff(){if(user.role!=='staff')fail('Requires staff',403);}};}
const request=(ctx,path,method='GET',body={})=>{const url=new URL(path,'https://test.local');return handle({path:url.pathname,query:url.searchParams,method,body},ctx);};
test('service: validated create and simulated ownership',async()=>{
 const ctx=context(undefined,users[1]);const {issue}=await request(ctx,'/api/issues','POST',{issue:{title:'New sidewalk',category:'roads',latitude:'33',longitude:'-97'}});
 assert.equal(issue.reporter.id,2);assert.equal(issue.latitude,33);assert.equal(issue.status,'new');
 const staffCtx=context(ctx.state,users[0]);await request(staffCtx,'/api/issues','POST',{issue:{title:'Staff-only own report',category:'parks',latitude:33,longitude:-97}});
 const result=await request(ctx,'/api/issues');assert.ok(result.issues.every(x=>x.reporter.id===2));
 assert.ok(validateIssue({title:'',category:'fake',latitude:null,longitude:Infinity}).length>=4);
});
test('service: valid lifecycle, assignment and stale version conflict',async()=>{
 const ctx=context();const first=await request(ctx,'/api/issues/1','PATCH',{issue:{status:'assigned',assigned_to_id:3,lock_version:0}});
 assert.equal(first.issue.assigned_to.name,'Casey Rivera');assert.equal(first.issue.lock_version,1);
 await assert.rejects(request(ctx,'/api/issues/1','PATCH',{issue:{status:'in_progress',assigned_to_id:3,lock_version:0}}),e=>e.status===409);
 await assert.rejects(request(ctx,'/api/issues/1','PATCH',{issue:{status:'resolved',assigned_to_id:3,lock_version:1}}),/transition/);
 await request(ctx,'/api/issues/1','PATCH',{issue:{status:'in_progress',assigned_to_id:3,lock_version:1}});
 await request(ctx,'/api/issues/1','PATCH',{issue:{status:'resolved',assigned_to_id:3,lock_version:2}});
 assert.ok(ctx.state.issues[0].resolved_at);
 await assert.rejects(request(context(ctx.state,users[1]),'/api/issues/1','PATCH',{issue:{}}),/staff/);
});
test('service: combined filter counts and numeric radius rejection',async()=>{
 const ctx=context();const result=await request(ctx,'/api/issues?status=new&category=roads&q=Oak&latitude=33.0471&longitude=-96.9942&radius_m=10');
 assert.equal(result.total_count,1);assert.equal(result.counts.new,1);assert.equal(result.counts.assigned,0);
 await assert.rejects(request(ctx,'/api/issues?latitude=&longitude=-97&radius_m=100'),/Distance filter/);
 assert.equal(distanceMeters(33,-97,33,-97),0);assert.ok(Math.abs(distanceMeters(0,0,0,1)-111195.08)<1);
});
test('service: import retains valid rows, reports failures, and detects equivalent JSON duplicates',async()=>{
 const ctx=context();const feature={type:'Feature',geometry:{type:'Point',coordinates:[-97,33]},properties:{title:'Imported request',category:'roads'}};
 const geojson={type:'FeatureCollection',features:[feature,{...feature,geometry:{type:'Point',coordinates:[-97,95]}}]};
 const first=await request(ctx,'/api/import_runs','POST',{geojson});assert.equal(first.import.imported_count,1);assert.equal(first.import.errors.length,1);assert.equal(first.import.errors[0].row,2);
 const count=ctx.state.issues.length;const again=await request(ctx,'/api/import_runs','POST',{geojson:{features:geojson.features,type:geojson.type}});assert.equal(again.reused,true);assert.equal(ctx.state.issues.length,count);
});
test('service: export is an owned stable CSV snapshot with spreadsheet-safe text',async()=>{
 const ctx=context();ctx.state.issues[0].title='=SUM(1,2)';const report=await request(ctx,'/api/export_runs','POST');
 const path=`/api/export_runs/${report.export.id}/download`;const before=(await request(ctx,path)).download.content;
 assert.match(before,/"'=SUM\(1,2\)"/);ctx.state.issues[0].title='Changed';assert.equal((await request(ctx,path)).download.content,before);
 await assert.rejects(request(context(ctx.state,users[2]),path),e=>e.status===404);
 assert.match(csvReport([{...ctx.state.issues[0],title:'A "quoted" title\ncontinued'}]),/"A ""quoted"" title\ncontinued"/);
});
