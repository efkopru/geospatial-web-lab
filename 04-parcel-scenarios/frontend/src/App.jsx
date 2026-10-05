import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {api,useSession,Login,Loading,AppShell,GeoMap,Stat,BarChart,useLive,usePolling,Notice} from '@geo/shared';
const fmt=n=>Number(n||0).toLocaleString();
export default function App(){const s=useSession();if(s.loading)return <Loading/>;if(!s.user)return <Login title="Parcel scenario explorer" onLogin={s.login} error={s.error}/>;return <Workspace key={s.user.id} session={s}/>;}
function Workspace({session}){
 const [parcels,setParcels]=useState([]),[scenarios,setScenarios]=useState([]),[selected,setSelected]=useState([]),[district,setDistrict]=useState(''),[compare,setCompare]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [form,setForm]=useState({name:'New courtyard concept',floors:4,coverage:0.4,unit_area:900});
 const mounted=useRef(true),requestSequence=useRef(0),parcelsLoaded=useRef(false);
 const refresh=useCallback(async()=>{
  if(!mounted.current)return;
  const request=++requestSequence.current;
  try{
   // Parcels are fixed reference data, so live updates and polling refresh only scenarios.
   const [p,s]=await Promise.all([parcelsLoaded.current?null:api('/api/parcels'),api('/api/scenarios')]);
   if(!mounted.current||request!==requestSequence.current)return;
   if(p){parcelsLoaded.current=true;setParcels(p.features);}
   setScenarios(s);
  }catch(e){if(mounted.current&&request===requestSequence.current)setError(e.message);}
 },[]);
 useEffect(()=>{mounted.current=true;refresh();return()=>{mounted.current=false;requestSequence.current+=1;};},[refresh]);const live=useLive('ScenarioChannel',refresh);usePolling(refresh,15000);
 const toggle=id=>setSelected(xs=>xs.includes(id)?xs.filter(x=>x!==id):[...xs,id]);
 const visible=useMemo(()=>parcels.filter(p=>!district||p.properties.district===district),[parcels,district]);
 // Memoized so typing in the form or moving the coverage slider does not redraw the map.
 const mapFeatures=useMemo(()=>visible.map(p=>({...p,properties:{...p.properties,color:selected.includes(p.id)?'#cc8529':'#658b72'}})),[visible,selected]);
 const area=parcels.filter(p=>selected.includes(p.id)).reduce((s,p)=>s+p.properties.area_acres,0);
 const completed=scenarios.filter(s=>s.status==='complete');const compared=completed.filter(s=>compare.includes(s.id));
 const patch=(key,value)=>setForm({...form,[key]:value});
 async function submit(e){
  e.preventDefault();setBusy(true);setError('');setMessage('');
  try{
   const saved=await api('/api/scenarios',{method:'POST',body:{scenario:{...form,parcel_ids:selected}}});
   if(!mounted.current)return;
   if(saved.status==='failed')setError(saved.error_message||'Scenario was saved, but processing could not start. Retry the failed scenario.');
   else setMessage(saved.status==='complete'?'Scenario calculated. Results are ready.':'Scenario queued. Results will appear when the calculation finishes.');
   await refresh();
  }catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}
 }
 async function changeScenario(id,action){
  setError('');setMessage('');
  try{
   const result=await api(`/api/scenarios/${id}${action==='retry'?'/recalculate':''}`,{method:action==='retry'?'POST':'DELETE'});
   if(!mounted.current)return;
   if(action==='delete')setCompare(xs=>xs.filter(x=>x!==id));
   else if(result.status==='failed')setError(result.error_message||'Scenario processing could not start. Retry when the queue is available.');
   await refresh();
  }catch(e){if(mounted.current)setError(e.message);}
 }
 return <AppShell title="Parcel scenario explorer" subtitle="Explore capacity, compare assumptions, preserve every scenario." user={session.user} onLogout={session.logout} accent="#716044" actions={<span className="badge">{live?'Live':'Reconnecting'}</span>}>
 <div className="stat-grid"><Stat label="Available parcels" value={parcels.length} hint="Two synthetic districts"/><Stat label="Selected land" value={`${area.toFixed(2)} ac`} hint={`${selected.length} parcels selected`}/><Stat label="Saved scenarios" value={scenarios.length} hint="Private to your account"/><Stat label="Ready to compare" value={completed.length} hint="Calculated on the server"/></div>
 <Notice error>{error}</Notice><Notice>{message}</Notice>
 <div className="sidebar-layout"><aside className="panel"><span className="eyebrow">01 / DESIGN ASSUMPTIONS</span><h2 style={{marginTop:10}}>Build a scenario</h2><form onSubmit={submit}><label className="field">Scenario name<input value={form.name} maxLength={100} onChange={e=>patch('name',e.target.value)} required/></label><div className="form-grid"><label className="field">Floors<input type="number" min="1" max="30" value={form.floors} onChange={e=>patch('floors',Number(e.target.value))} required/></label><label className="field">Unit area (sq ft)<input type="number" min="400" max="3000" step="25" value={form.unit_area} onChange={e=>patch('unit_area',Number(e.target.value))} required/></label></div><label className="field">Building coverage: {Math.round(form.coverage*100)}%<input type="range" min="0.05" max="0.8" step="0.05" value={form.coverage} onChange={e=>patch('coverage',Number(e.target.value))}/></label><div className="notice">Select parcels on the map or in the table. The same selection is used for each scenario you save.</div><button disabled={busy||!selected.length} style={{width:'100%'}}>{busy?'Saving…':`Calculate ${selected.length} selected parcels`}</button></form><div className="section-space"><h3>Calculation assumptions</h3><p className="muted">Gross floor area = site area × coverage × floors. Residential area uses an 80% efficiency assumption. Unit count rounds down.</p><small>These are transparent scenario calculations. Synthetic height limits are included as warnings, not permit decisions.</small></div></aside>
 <section><div className="panel"><div className="panel-header"><div><span className="eyebrow">02 / SPATIAL SELECTION</span><h2 style={{marginTop:7}}>Find your study area</h2></div><select aria-label="District" value={district} onChange={e=>setDistrict(e.target.value)} style={{width:180}}><option value="">All districts</option><option>River district</option><option>North quarter</option></select></div><GeoMap features={mapFeatures} onSelect={f=>toggle(f.id)} center={[-96.808,32.779]} zoom={14}/><div className="toolbar" style={{marginTop:14}}><button className="secondary compact" onClick={()=>setSelected(visible.map(p=>p.id))}>Select visible</button><button className="secondary compact" onClick={()=>setSelected([])}>Clear selection</button><small>Orange parcels are selected.</small></div><div className="table-wrap" style={{maxHeight:245}}><table><thead><tr><th>Select</th><th>Parcel</th><th>District</th><th>Acres</th><th>Height limit</th></tr></thead><tbody>{visible.map(p=><tr key={p.id} className={selected.includes(p.id)?'selected':''}><td><input type="checkbox" aria-label={`Select ${p.properties.title}`} checked={selected.includes(p.id)} onChange={()=>toggle(p.id)}/></td><td>{p.properties.title}</td><td>{p.properties.district}</td><td>{p.properties.area_acres}</td><td>{p.properties.height_limit} floors</td></tr>)}</tbody></table></div></div></section></div>
 <section className="panel section-space"><div className="panel-header"><div><span className="eyebrow">03 / COMPARE OUTCOMES</span><h2 style={{marginTop:7}}>Saved scenarios</h2></div><small>Select up to four completed scenarios.</small></div>{!scenarios.length?<div className="empty">Select parcels and calculate your first scenario.</div>:<div className="table-wrap"><table><thead><tr><th>Compare</th><th>Scenario</th><th>State</th><th>Floors / coverage</th><th>Gross area</th><th>Units</th><th>FAR</th><th>Actions</th></tr></thead><tbody>{scenarios.map(s=><tr key={s.id}><td><input type="checkbox" aria-label={`Compare ${s.name}`} disabled={s.status!=='complete'||(!compare.includes(s.id)&&compare.length>=4)} checked={compare.includes(s.id)} onChange={()=>setCompare(xs=>xs.includes(s.id)?xs.filter(x=>x!==s.id):[...xs,s.id])}/></td><td><strong>{s.name}</strong>{s.error_message&&<div className="notice error">{s.error_message}</div>}{s.results?.warnings?.map(w=><div key={w}><small style={{color:'#98631e'}}>{w}</small></div>)}</td><td><span className={`badge ${s.status==='failed'?'error':''}`}>{s.status}</span></td><td>{s.floors} / {Math.round(s.coverage*100)}%</td><td>{s.status==='complete'?`${fmt(s.results.gross_floor_area_sqft)} sq ft`:'Pending'}</td><td>{s.status==='complete'?fmt(s.results.units):'Pending'}</td><td>{s.results?.floor_area_ratio??'Pending'}</td><td>{s.status==='complete'&&<a className="link" href={`/api/scenarios/${s.id}/export`}>Export</a>}{s.status==='failed'&&<button onClick={()=>changeScenario(s.id,'retry')}>Retry</button>} <button className="secondary" onClick={()=>changeScenario(s.id,'delete')}>Delete</button></td></tr>)}</tbody></table></div>}
 {compared.length>0&&<div className="grid-two section-space"><div><h3>Estimated unit capacity</h3><BarChart items={compared.map(s=>({label:s.name,value:s.results.units}))} color="#887447"/></div><div><h3>Open space (sq ft)</h3><BarChart items={compared.map(s=>({label:s.name,value:s.results.open_space_sqft}))} color="#457b64"/></div></div>}</section>
 </AppShell>;
}
