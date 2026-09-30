import React,{useState,useEffect,useRef,lazy,Suspense} from 'react';
import {getRuntime,download} from './runtime.js';
export {useState,useEffect};
export const api=(path,options)=>getRuntime().request(path,options);

export function useSession(){
 const runtime=getRuntime();const [,render]=useState(0);
 useEffect(()=>{const unsubscribe=runtime.subscribe(type=>{if(type==='session'||type==='meta')render(x=>x+1);});render(x=>x+1);return unsubscribe;},[runtime]);
 return {user:runtime.user,loading:runtime.meta.loading,error:runtime.meta.error,
  login:async value=>{const result=await api('/api/session',{method:'POST',body:typeof value==='string'?{email:value}:value});return result.user;},
  logout:()=>runtime.selectUser(0)};
}
export function useLive(channel,onReceived){
 const callback=useRef(onReceived);callback.current=onReceived;
 useEffect(()=>getRuntime().subscribe(type=>{if(type==='data')callback.current?.({type:'local_change'});}),[]);
 return true;
}
export function usePolling(refresh,ms=10000){const callback=useRef(refresh);callback.current=refresh;useEffect(()=>{const timer=setInterval(()=>callback.current?.(),ms);return()=>clearInterval(timer);},[ms]);}
export function Login({onLogin,error,title='Geo Lab'}){
 return <main className="login-page"><div className="login-art"><div className="brand-mark">G</div><span className="eyebrow">STANDALONE GEOSPATIAL LAB</span><h1>{title}</h1><p>The same visual workflow, running entirely in your browser.</p><div className="contours" aria-hidden="true"/><div className="login-note">Synthetic data. No backend required.</div></div><section className="login-form"><span className="eyebrow">ROLE SIMULATION</span><h2>Choose a demo role</h2><p>Roles change the visible workflow. They are not authentication or a security boundary. All records stay in this browser.</p>{getRuntime().users.map(user=><button key={user.id} className="secondary" onClick={()=>onLogin({user_id:user.id})}>{user.name} ({user.role})</button>)}{error&&<Notice error>{error}</Notice>}</section></main>;
}
export function AppShell({title,subtitle,accent='#1c6860',user,onLogout,actions,children}){
 const runtime=getRuntime();const [,render]=useState(0);const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);
 useEffect(()=>runtime.subscribe(()=>render(x=>x+1)),[runtime]);
 const reset=async()=>{setBusy(true);try{await runtime.reset();window.location.reload();}catch(error){runtime.reportError(error);setBusy(false);}};
 const backup=async()=>{try{download({filename:`${runtime.id}-standalone-backup.json`,content:JSON.stringify(await runtime.backup(),null,2)});}catch(error){runtime.reportError(error);}};
 const originalPort=5170+Number(runtime.id.slice(0,2));
 return <div className="app-shell" style={{'--accent':accent}}>
  <div className="standalone-banner"><div><strong>STANDALONE EDITION</strong><span>Browser data only. Simulated roles. No Rails or database server.</span></div><div className="standalone-tools">
   <label>Demo role<select aria-label="Demo role" value={user?.id||''} onChange={event=>runtime.selectUser(event.target.value)}>{runtime.users.map(person=><option key={person.id} value={person.id}>{person.name} ({person.role})</option>)}</select></label>
   <button className="secondary compact" onClick={backup}>Export local backup</button><button className="secondary compact" onClick={()=>setConfirm(true)}>Reset demo data</button>
   {['127.0.0.1','localhost'].includes(location.hostname)&&<a href={`http://127.0.0.1:${originalPort}/`} target="_blank" rel="noreferrer">Open full-stack version</a>}
  </div></div>
  {confirm&&<section className="standalone-reset" role="alertdialog" aria-label="Reset standalone data"><p>Restore the original synthetic dataset for this standalone app? This replaces its local edits. Full-stack application data is unaffected.</p><button disabled={busy} onClick={reset}>Restore synthetic dataset</button><button className="secondary" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></section>}
  <header className="app-header"><div className="brand-mark">G</div><div className="app-heading"><span className="eyebrow">GEOSPATIAL WEB LAB / STANDALONE</span><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div><div className="header-actions">{actions}<span className="environment">Synthetic data</span>{user&&<div className="identity"><strong>{user.name}</strong><span>{user.role} simulation</span></div>}<button className="secondary compact" onClick={onLogout}>Leave demo</button></div></header>
  <main className="workspace"><Notice error>{runtime.meta.error}</Notice>{children}</main>
  <footer className="app-footer"><span>Geo Lab / {title} / Standalone</span><span>{runtime.meta.persistent?'Saved in this browser (IndexedDB)':'Browser storage unavailable'}{runtime.meta.savedAt?` · Saved ${new Date(runtime.meta.savedAt).toLocaleTimeString()}`:''}</span><span>{runtime.id.startsWith('05-')?'Synthetic elevations. Not operational data.':'Internet required for ArcGIS basemaps. Not operational data.'}</span><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`}>Third-party notices</a></footer>
 </div>;
}
export function Stat({label,value,hint}){return <div className="stat"><span>{label}</span><strong>{value??'0'}</strong>{hint&&<small>{hint}</small>}</div>;}
export function BarChart({items=[],color='var(--accent)',title}){
 const max=Math.max(1,...items.map(x=>Number(x.value)||0));
 return <div className="bar-chart" role="img" aria-label={title||items.map(x=>`${x.label}: ${x.value}`).join(', ')}>{items.map((x,i)=><div className="bar-row" key={`${x.label}-${i}`}><span>{x.label}</span><div className="bar-track"><div style={{width:`${Math.max(0,Number(x.value))/max*100}%`,background:color}}/></div><strong>{x.value}</strong></div>)}</div>;
}
const MapImpl=lazy(()=>import('./map.jsx'));
export function GeoMap(props){return <Suspense fallback={<div className="map-loading">Loading map...</div>}><MapImpl {...props}/></Suspense>;}
export function Loading(){return <div className="loading-screen">Opening standalone workspace...</div>;}
export function Notice({children,error=false}){return children?<div className={`notice ${error?'error':''}`} role={error?'alert':'status'}>{children}</div>:null;}
export function downloadJson(data,name){download({filename:name,mime:'application/geo+json',content:JSON.stringify(data,null,2)});}
