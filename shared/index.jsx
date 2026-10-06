import React, {useState,useEffect,useRef,lazy,Suspense} from 'react';
import {createConsumer} from '@rails/actioncable';
export {useState,useEffect};
let csrf, sessionUserId, sessionRead, authEpoch=0, sessionRevision=0, sessionRequest=0;
const sessionEvent='geo:session';
const announceSession=user=>window.dispatchEvent(new CustomEvent(sessionEvent,{detail:{user}}));
export function api(path, options={}, retried=false) {
 if(!path.startsWith('/api/')&&!path.startsWith('/up')) path='/api'+(path.startsWith('/')?'':'/')+path;
 if(path==='/api/session'&&(options.method||'GET').toUpperCase()==='GET'){
  // Focus events and concurrent CSRF failures share one authoritative lookup.
  // Login/logout and cross-tab changes advance the epoch, bypassing old reads.
  if(sessionRead?.epoch===authEpoch)return sessionRead.promise;
  const lookup={epoch:authEpoch};
  lookup.promise=sendRequest(path,options,retried).finally(()=>{if(sessionRead===lookup)sessionRead=null;});
  sessionRead=lookup;
  return lookup.promise;
 }
 return sendRequest(path,options,retried);
}
async function sendRequest(path, options, retried) {
 const method=(options.method||'GET').toUpperCase();
 if(path==='/api/session'&&method!=='GET'&&!retried) authEpoch++;
 const epoch=authEpoch;
 const revision=sessionRevision;
 const sessionSequence=path==='/api/session'?++sessionRequest:null;
 const expectedUser=sessionUserId;
 const {body,headers,...rest}=options;
 const response=await fetch(path,{credentials:'include',...rest,headers:{'Accept':'application/json',...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body!==undefined?{body:typeof body==='string'||body instanceof FormData?body:JSON.stringify(body)}:{})});
 const isJson=response.headers.get('content-type')?.includes('json');
 const data=isJson?await response.json():await response.text();
 if(!response.ok) {
  // This code is returned only when Rails rejected the request before executing it.
  if(data?.code==='invalid_csrf'&&!retried&&epoch===authEpoch){
   const session=await api('/api/session');
   if(epoch===authEpoch){
    if(path!=='/api/session') announceSession(session.user);
    if(path==='/api/session'||(session.user&&expectedUser===session.user.id)) return api(path,options,true);
   }
  }
  if(response.status===401&&path!=='/api/session'&&epoch===authEpoch&&revision===sessionRevision) announceSession(null);
  const e=new Error(data.error||data.errors?.join(', ')||`Request failed (${response.status})`);e.status=response.status;throw e;
 }
 if(path==='/api/session'&&(epoch!==authEpoch||sessionSequence!==sessionRequest)){
  const failure=new Error('Session changed while this request was running. Try again.');failure.status=409;throw failure;
 }
 if(data?.csrf_token&&epoch===authEpoch) csrf=data.csrf_token;
 if(path==='/api/session'&&epoch===authEpoch){sessionUserId=data.user?.id;sessionRevision++;}
 return data;
}
export function useSession(){
 const [user,setUser]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const version=useRef(0),channel=useRef(null),changing=useRef(false),pendingRefresh=useRef(false),refreshSession=useRef(null);
 useEffect(()=>{
  let active=true;
  const refresh=async(clear=false)=>{
   if(!active)return;
   if(clear){authEpoch++;version.current++;setUser(null);setLoading(true);}
   if(changing.current){pendingRefresh.current=true;return;}
   const request=++version.current;
   try {
    const state=await api('/api/session');
    if(request===version.current){
     // Keep the same object for an unchanged account so refocusing a tab does
     // not restart data effects or discard the current editing draft.
     setUser(previous=>JSON.stringify(previous)===JSON.stringify(state.user)?previous:state.user);
     setError('');
    }
   }catch(failure){if(request===version.current)setError(failure.message);}
   finally{if(request===version.current)setLoading(false);}
  };
  refreshSession.current=refresh;
  const receive=e=>{version.current++;setUser(e.detail.user);setLoading(false);setError(e.detail.user?'':'Session expired. Sign in to continue.');};
  const focus=()=>refresh();
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  if(typeof window.BroadcastChannel==='function'){
   channel.current=new window.BroadcastChannel('geo-session-change');
   channel.current.onmessage=event=>{if(event.data?.type==='changed')refresh(true);};
  }
  window.addEventListener(sessionEvent,receive);
  window.addEventListener('focus',focus);
  document.addEventListener('visibilitychange',visible);
  refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the version on unmount invalidates lookups still in flight
  return ()=>{active=false;version.current++;refreshSession.current=null;channel.current?.close();channel.current=null;window.removeEventListener(sessionEvent,receive);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible);};
 },[]);
 const finishChange=()=>{changing.current=false;if(pendingRefresh.current){pendingRefresh.current=false;refreshSession.current?.();}};
 const notifyTabs=()=>{try{channel.current?.postMessage({type:'changed'});}catch{/* Focus revalidation remains available if cross-tab delivery fails. */}};
 const login=async(a,b)=>{const request=++version.current;changing.current=true;setError('');try {const x=await api('/api/session',{method:'POST',body:typeof a==='string'?{email:a,password:b}:a});if(request===version.current)setUser(x.user);notifyTabs();return x.user;}catch(e){if(request===version.current)setError(e.message);return null;}finally{if(request===version.current)setLoading(false);finishChange();}};
 const logout=async()=>{const request=++version.current;changing.current=true;try{await api('/api/session',{method:'DELETE'});if(request===version.current){setUser(null);setError('');}notifyTabs();}finally{finishChange();}};
 return {user,loading,error,login,logout};
}
export function useLive(channel,onReceived,params={}){
 const ref=useRef(onReceived);ref.current=onReceived;
 const [connected,setConnected]=useState(false);
 const key=JSON.stringify(params);
 useEffect(()=>{setConnected(false);const consumer=createConsumer(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/cable`);const sub=consumer.subscriptions.create({channel,...JSON.parse(key)},{connected(){setConnected(true);ref.current?.({type:'connected'});},disconnected(){setConnected(false);},rejected(){setConnected(false);},received(data){ref.current?.(data);}});return ()=>{sub.unsubscribe();consumer.disconnect();};},[channel,key]);
 return connected;
}
export function usePolling(refresh,ms=10000){const ref=useRef(refresh);ref.current=refresh;useEffect(()=>{const id=setInterval(()=>ref.current?.(),ms);return ()=>clearInterval(id);},[ms]);}
export function Login({onLogin,error,title='Geo Lab'}){
 // The seeded learning accounts are prefilled unless a build sets VITE_DEMO_ACCOUNTS=false,
 // for example a deployment that skipped db:seed. Read inline so such a build drops them.
 const demo=import.meta.env.VITE_DEMO_ACCOUNTS!=='false';
 const [email,setEmail]=useState(demo?'staff@example.test':''),[password,setPassword]=useState(demo?'Learning123!':''),[busy,setBusy]=useState(false);
 return <main className="login-page"><div className="login-art"><div className="brand-mark">G</div><span className="eyebrow">GEOSPATIAL WEB LAB</span><h1>{title}</h1><p>Explore the workflow. Work with the map. See every change.</p><div className="contours" aria-hidden="true"/><div className="login-note">Learning environment · Synthetic data</div></div><form className="login-form" onSubmit={async e=>{e.preventDefault();setBusy(true);await onLogin({email,password});setBusy(false);}}><span className="eyebrow">WORKSPACE ACCESS</span><h2>Sign in</h2><p className="muted">{demo?'Demo accounts are prefilled. Use the staff account to explore every workflow.':'Sign in with the account provided for this workspace.'}</p><label className="field">Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div role="alert" className="notice error">{error}</div>}<button disabled={busy}>{busy?'Signing in…':'Open workspace'}</button>{demo&&<><div className="demo-users"><button type="button" className="text-button" onClick={()=>setEmail('staff@example.test')}>Staff demo</button><button type="button" className="text-button" onClick={()=>setEmail('reporter@example.test')}>Reporter demo</button></div><small>Demo password: Learning123!</small></>}</form></main>;
}
export function AppShell({title,subtitle,accent='#1c6860',user,onLogout,actions,children}){
 const [logoutError,setLogoutError]=useState(''),[loggingOut,setLoggingOut]=useState(false);
 const signOut=async()=>{setLoggingOut(true);setLogoutError('');try{await onLogout();}catch(e){setLogoutError(`Sign out failed: ${e.message}`);}finally{setLoggingOut(false);}};
 return <div className="app-shell" style={{'--accent':accent}}><header className="app-header"><div className="brand-mark">G</div><div className="app-heading"><span className="eyebrow">GEOSPATIAL WEB LAB</span><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div><div className="header-actions">{actions}<span className="environment">Synthetic data</span>{user&&<div className="identity"><strong>{user.name}</strong><span>{user.role}</span></div>}<button className="secondary compact" disabled={loggingOut} onClick={signOut}>{loggingOut?'Signing out…':'Sign out'}</button></div></header><main className="workspace"><Notice error>{logoutError}</Notice>{children}</main><footer className="app-footer"><span>Geo Lab / {title}</span><span>Demonstration datasets · No operational decisions</span></footer></div>;
}
export function Stat({label,value,hint}){return <div className="stat"><span>{label}</span><strong>{value??'0'}</strong>{hint&&<small>{hint}</small>}</div>;}
export function BarChart({items=[],color='var(--accent)',title}){
 const max=Math.max(1,...items.map(x=>Number(x.value)||0));
 return <div className="bar-chart" role="img" aria-label={title||items.map(x=>`${x.label}: ${x.value}`).join(', ')}>{items.map((x,i)=><div className="bar-row" key={`${x.label}-${i}`}><span>{x.label}</span><div className="bar-track"><div style={{width:`${Math.max(0,Number(x.value))/max*100}%`,background:color}}/></div><strong>{x.value}</strong></div>)}</div>;
}
const MapImpl=lazy(()=>import('./map.jsx'));
export function GeoMap(props){return <Suspense fallback={<div className="map-loading">Loading map…</div>}><MapImpl {...props}/></Suspense>;}
export function Loading(){return <div className="loading-screen">Opening workspace…</div>;}
export function Notice({children,error=false}){return children?<div className={`notice ${error?'error':''}`} role={error?'alert':'status'}>{children}</div>:null;}
export function downloadJson(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
