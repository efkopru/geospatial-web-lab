const CATEGORIES=['roads','lighting','drainage','parks'];
const STATUSES=['new','assigned','in_progress','resolved'];
const TRANSITIONS={new:['assigned'],assigned:['in_progress'],in_progress:['resolved','assigned'],resolved:['in_progress']};
const clone=value=>structuredClone(value);
const person=(id,name)=>({id,name});
const staff=person(1,'Alex Morgan'),reporter=person(2,'Jordan Lee');
const MAX_ISSUES=5000;
export function seed(){
 const rows=[['Pavement repair on Oak Street','roads',33.0471,-96.9942,'new'],['Streetlight near the library','lighting',33.0437,-96.9918,'assigned'],['Blocked drainage grate','drainage',33.0417,-96.9982,'in_progress'],['Damaged park bench','parks',33.0508,-96.9975,'resolved'],['Faded crossing near school','roads',33.0465,-97.0013,'new'],['Trail light requires repair','lighting',33.052,-96.9911,'in_progress']];
 return {issues:rows.map(([title,category,latitude,longitude,status],index)=>({id:index+1,title,category,latitude,longitude,status,description:'Synthetic training record. This is not a real municipal service request.',reporter:clone(reporter),assigned_to:status==='new'?null:clone(staff),lock_version:0,created_at:`2026-09-${String(22+index).padStart(2,'0')}T15:00:00.000Z`,updated_at:'2026-09-29T15:00:00.000Z',resolved_at:status==='resolved'?'2026-09-29T15:00:00.000Z':null})),imports:[],exports:[],nextIssue:7,nextImport:1,nextExport:1};
}
function number(value){return typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number(value):NaN;}
export function validateIssue(data){
 const errors=[];
 if(typeof data.title!=='string'||!data.title.trim()||data.title.length>160)errors.push('Title must contain 1 to 160 characters.');
 if(data.description!=null&&(typeof data.description!=='string'||data.description.length>5000))errors.push('Description must be text no longer than 5000 characters.');
 if(!CATEGORIES.includes(data.category))errors.push('Choose roads, lighting, drainage, or parks.');
 if(!Number.isFinite(number(data.latitude))||Math.abs(number(data.latitude))>90)errors.push('Latitude must be between -90 and 90.');
 if(!Number.isFinite(number(data.longitude))||Math.abs(number(data.longitude))>180)errors.push('Longitude must be between -180 and 180.');
 return errors;
}
export function distanceMeters(lat1,lon1,lat2,lon2){
 const radians=Math.PI/180;const p1=lat1*radians,p2=lat2*radians,dlat=(lat2-lat1)*radians,dlon=(lon2-lon1)*radians;
 const a=Math.sin(dlat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dlon/2)**2;
 return 6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,a)),Math.sqrt(Math.max(0,1-a)));
}
export function csvCell(value,{text=false}={}){let result=String(value??'');if(text&&/^[=+@\-\t\r\n]/.test(result))result="'"+result;return '"'+result.replaceAll('"','""')+'"';}
export function csvReport(issues){
 const header=['id','title','category','status','latitude','longitude','reporter','assigned_to','created_at','resolved_at'];
 return header.join(',')+'\r\n'+issues.map(issue=>[issue.id,csvCell(issue.title,{text:true}),issue.category,issue.status,issue.latitude,issue.longitude,csvCell(issue.reporter.name,{text:true}),csvCell(issue.assigned_to?.name,{text:true}),issue.created_at,issue.resolved_at||''].join(',')).join('\r\n')+'\r\n';
}
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}
async function digest(value){const bytes=new TextEncoder().encode(JSON.stringify(canonical(value)));const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');}
function createIssue(data,ctx){
 const errors=validateIssue(data);if(errors.length)ctx.fail(errors.join(' '));
 if(ctx.state.issues.length>=MAX_ISSUES)ctx.fail('This standalone workspace supports 5000 requests. Export a backup and reset to continue.');
 const time=ctx.now();const issue={id:ctx.state.nextIssue++,title:data.title.trim(),description:data.description||'',category:data.category,latitude:number(data.latitude),longitude:number(data.longitude),reporter:person(ctx.user.id,ctx.user.name),assigned_to:null,status:'new',created_at:time,updated_at:time,resolved_at:null,lock_version:0};
 ctx.state.issues.push(issue);return issue;
}
function visible(state,user){return state.issues.filter(issue=>user.role==='staff'||issue.reporter.id===user.id);}
function findIssue(ctx,id){const issue=visible(ctx.state,ctx.user).find(x=>x.id===Number(id));if(!issue)ctx.fail('Request not found for this demo role.',404);return issue;}
function owned(list,ctx,id){const run=list.find(x=>x.id===Number(id)&&x.requested_by===ctx.user.id);if(!run)ctx.fail('Processing record not found for this demo role.',404);return run;}
export async function handle({path,method,body={},query=new URLSearchParams()},ctx){
 const {state,user,fail,requireStaff}=ctx;
 if(path==='/api/staff'&&method==='GET'){requireStaff();return {staff:ctx.users.filter(x=>x.role==='staff').map(x=>person(x.id,x.name))};}
 if(path==='/api/issues'&&method==='GET'){
  let issues=visible(state,user);const q=(query.get('q')||'').slice(0,160).toLowerCase();
  if(q)issues=issues.filter(x=>(x.title+' '+x.description).toLowerCase().includes(q));
  for(const field of ['status','category'])if(query.get(field))issues=issues.filter(x=>x[field]===query.get(field));
  if(['latitude','longitude','radius_m'].some(key=>query.has(key))){
   const lat=number(query.get('latitude')),lon=number(query.get('longitude')),radius=number(query.get('radius_m'));
   if(![lat,lon,radius].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lon)>180||radius<1||radius>100000)fail('Distance filter requires valid coordinates and a radius from 1 to 100000 meters.');
   issues=issues.filter(x=>distanceMeters(lat,lon,x.latitude,x.longitude)<=radius);
  }
  const counts=Object.fromEntries(STATUSES.map(status=>[status,issues.filter(x=>x.status===status).length]));
  return {issues:issues.toSorted((a,b)=>b.updated_at.localeCompare(a.updated_at)||b.id-a.id).slice(0,500),total_count:issues.length,counts,categories:CATEGORIES,statuses:STATUSES};
 }
 if(path==='/api/issues'&&method==='POST')return {issue:createIssue(body.issue||{},ctx)};
 const issueMatch=path.match(/^\/api\/issues\/(\d+)$/);
 if(issueMatch&&method==='GET')return {issue:findIssue(ctx,issueMatch[1])};
 if(issueMatch&&method==='PATCH'){
  requireStaff();const issue=findIssue(ctx,issueMatch[1]),attrs=body.issue||{};
  if(!/^(0|[1-9]\d*)$/.test(String(attrs.lock_version))||!Number.isSafeInteger(number(attrs.lock_version)))fail('lock_version must be a nonnegative integer.');
  if(number(attrs.lock_version)!==issue.lock_version)fail('Another demo edit changed this request. Load current values before saving.',409);
  const next={...issue};for(const key of ['title','description','category','latitude','longitude'])if(Object.hasOwn(attrs,key))next[key]=attrs[key];
  const errors=validateIssue(next);if(errors.length)fail(errors.join(' '));
  next.latitude=number(next.latitude);next.longitude=number(next.longitude);
  if(Object.hasOwn(attrs,'assigned_to_id')){const assigned=ctx.users.find(x=>x.role==='staff'&&x.id===number(attrs.assigned_to_id));if(!assigned)fail('Select a staff member.');next.assigned_to=person(assigned.id,assigned.name);}
  next.status=attrs.status??issue.status;if(next.status==='new'&&next.assigned_to)next.status='assigned';
  if(!STATUSES.includes(next.status)||next.status!==issue.status&&!TRANSITIONS[issue.status].includes(next.status))fail('This status transition is not allowed.');
  if(next.status!=='new'&&!next.assigned_to)fail('Assigned work requires a staff member.');
  next.lock_version++;next.updated_at=ctx.now();next.resolved_at=next.status==='resolved'?(issue.resolved_at||next.updated_at):null;Object.assign(issue,next);return {issue};
 }
 if(path==='/api/import_runs'&&method==='GET'){requireStaff();return {imports:state.imports.filter(x=>x.requested_by===user.id).toReversed().slice(0,15)};}
 if(path==='/api/import_runs'&&method==='POST'){
  requireStaff();const geojson=body.geojson;
  if(!geojson||geojson.type!=='FeatureCollection'||!Array.isArray(geojson.features)||geojson.features.length<1||geojson.features.length>500)fail('Upload a GeoJSON FeatureCollection containing 1 to 500 Point features.');
  if(new TextEncoder().encode(JSON.stringify(geojson)).length>2*1024*1024)fail('GeoJSON must be smaller than 2 MB.');
  const hash=await digest(geojson);const existing=state.imports.find(x=>x.digest===hash&&x.requested_by===user.id);if(existing)return {import:existing,reused:true};
  if(state.imports.length>=100)fail('This standalone dataset holds 100 imports. Export a backup and reset to continue.');
  const run={id:state.nextImport++,requested_by:user.id,digest:hash,status:'completed',imported_count:0,processed_count:geojson.features.length,total_count:geojson.features.length,errors:[],failure:null,created_at:ctx.now()};
  geojson.features.forEach((feature,index)=>{try{
   if(!feature||feature.type!=='Feature'||feature.geometry?.type!=='Point')fail('Expected a GeoJSON Point feature.');
   const coords=feature.geometry.coordinates,props=feature.properties??{};
   if(!Array.isArray(coords)||coords.length<2||!coords.slice(0,2).every(Number.isFinite))fail('Point coordinates must contain numeric longitude and latitude.');
   if(!props||typeof props!=='object'||Array.isArray(props))fail('Feature properties must be an object.');
   createIssue({title:props.title,category:props.category??'roads',description:props.description??'',latitude:coords[1],longitude:coords[0]},ctx);run.imported_count++;
  }catch(error){run.errors.push({row:index+1,message:error.message});}});
  state.imports.push(run);return {import:run,reused:false};
 }
 if(/^\/api\/import_runs\/\d+\/retry$/.test(path)&&method==='POST'){requireStaff();owned(state.imports,ctx,path.split('/')[3]);fail('Local imports finish immediately. Correct rejected rows and upload a revised file.',409);}
 if(path==='/api/export_runs'&&method==='GET'){requireStaff();return {exports:state.exports.filter(x=>x.requested_by===user.id).toReversed().slice(0,10).map(({content,...run})=>run)};}
 if(path==='/api/export_runs'&&method==='POST'){
  requireStaff();const issues=visible(state,user);const run={id:state.nextExport++,requested_by:user.id,status:'completed',record_count:issues.length,created_at:ctx.now(),content:csvReport(issues),failure:null};
  state.exports.push(run);state.exports=state.exports.slice(-30);return {export:run};
 }
 const download=path.match(/^\/api\/export_runs\/(\d+)\/download$/);
 if(download&&method==='GET'){requireStaff();const run=owned(state.exports,ctx,download[1]);return {download:{filename:`standalone-service-requests-${run.id}.csv`,mime:'text/csv;charset=utf-8',content:run.content}};}
 fail(`Unknown local route: ${method} ${path}`,404);
}
