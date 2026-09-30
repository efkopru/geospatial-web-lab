import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {api,AppShell,useSession} from '../shared/index.jsx';
const response=(data,status=200)=>({ok:status<400,status,headers:new Headers({'content-type':'application/json'}),json:async()=>data});
const user={id:7,name:'Tester',role:'staff'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('refreshes a rotated CSRF token and retries only the rejected request',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(response({user,csrf_token:'old'}))
  .mockResolvedValueOnce(response({code:'invalid_csrf'},422))
  .mockResolvedValueOnce(response({user,csrf_token:'new'}))
  .mockResolvedValueOnce(response({id:12}));
 vi.stubGlobal('fetch',fetch);
 await api('/session');
 expect(await api('/datasets',{method:'POST',body:{name:'Dataset'}})).toEqual({id:12});
 expect(fetch.mock.calls[3][1].headers['X-CSRF-Token']).toBe('new');
 expect(fetch).toHaveBeenCalledTimes(4);
});
it('does not replay a mutation under a different account after CSRF refresh',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(response({user,csrf_token:'old'}))
  .mockResolvedValueOnce(response({code:'invalid_csrf'},422))
  .mockResolvedValueOnce(response({user:{...user,id:8},csrf_token:'other'}));
 vi.stubGlobal('fetch',fetch);await api('/session');
 await expect(api('/datasets',{method:'POST',body:{name:'Private draft'}})).rejects.toThrow();
 expect(fetch).toHaveBeenCalledTimes(3);
});
it('never retries a validation error or loops on repeated CSRF rejection',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(response({error:'Invalid data'},422));
 vi.stubGlobal('fetch',fetch);
 await expect(api('/datasets',{method:'POST'})).rejects.toThrow('Invalid data');
 expect(fetch).toHaveBeenCalledTimes(1);
 fetch.mockResolvedValueOnce(response({code:'invalid_csrf'},422))
  .mockResolvedValueOnce(response({user:null,csrf_token:'fresh'}))
  .mockResolvedValueOnce(response({code:'invalid_csrf'},422));
 await expect(api('/session',{method:'POST'})).rejects.toThrow();
 expect(fetch).toHaveBeenCalledTimes(4);
});
it('ignores an old unauthorized response after recovering a newer account session',async()=>{
 let finishOld;
 const events=[];
 const listener=event=>events.push(event.detail.user?.id??null);
 window.addEventListener('geo:session',listener);
 const fetch=vi.fn().mockResolvedValueOnce(response({user,csrf_token:'old'}))
  .mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;}))
  .mockResolvedValueOnce(response({code:'invalid_csrf'},422))
  .mockResolvedValueOnce(response({user:{...user,id:8},csrf_token:'other'}));
 vi.stubGlobal('fetch',fetch);
 try {
  await api('/session');
  const old=api('/datasets');
  await expect(api('/datasets',{method:'POST',body:{name:'Draft'}})).rejects.toThrow();
  finishOld(response({error:'Expired prior session'},401));
  await expect(old).rejects.toThrow('Expired prior session');
  expect(events).toEqual([8]);
 } finally {window.removeEventListener('geo:session',listener);}
});
it('ignores an old session lookup that finishes after login',async()=>{
 let finishInitial;
 vi.stubGlobal('fetch',vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finishInitial=resolve;}))
  .mockResolvedValueOnce(response({user,csrf_token:'login-token'})));
 const {result}=renderHook(()=>useSession());
 await act(async()=>{await result.current.login('user@example.test','password');});
 await act(async()=>{finishInitial(response({user:null,csrf_token:'stale'}));});
 expect(result.current.user).toEqual(user);
 expect(result.current.loading).toBe(false);
});
it('clears the workspace when a protected request returns unauthorized',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({user,csrf_token:'token'}))
  .mockResolvedValueOnce(response({error:'Sign in to continue'},401)));
 const {result}=renderHook(()=>useSession());
 await waitFor(()=>expect(result.current.user).toEqual(user));
 await act(async()=>{await expect(api('/datasets')).rejects.toThrow('Sign in to continue');});
 expect(result.current.user).toBeNull();
});
it('shows logout failure while keeping the workspace available for another attempt',async()=>{
 const logout=vi.fn().mockRejectedValue(new Error('Network unavailable'));
 render(<AppShell title="Test" user={user} onLogout={logout}><p>Private workspace</p></AppShell>);
 fireEvent.click(screen.getByRole('button',{name:'Sign out'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Sign out failed: Network unavailable');
 expect(screen.getByRole('button',{name:'Sign out'})).toBeEnabled();
 expect(screen.getByText('Private workspace')).toBeVisible();
});
it('recovers concurrent CSRF failures without rejecting either legitimate mutation',async()=>{
 let completeRecovery;
 const attempts=new Map();
 let sessions=0;
 const fetch=vi.fn().mockImplementation((path)=>{
  if(path==='/api/session'){
   sessions++;
   return sessions===1?Promise.resolve(response({user,csrf_token:'old-token'})):new Promise(resolve=>{completeRecovery=resolve;});
  }
  const count=(attempts.get(path)||0)+1;attempts.set(path,count);
  return Promise.resolve(count===1?response({code:'invalid_csrf'},422):response({saved:path}));
 });
 vi.stubGlobal('fetch',fetch);
 await api('/session');
 const first=api('/datasets',{method:'POST',body:{name:'Dataset'}});
 const second=api('/issues',{method:'POST',body:{name:'Issue'}});
 await waitFor(()=>expect(completeRecovery).toBeTypeOf('function'));
 // A focus recheck during recovery must join it instead of superseding it.
 const focus=api('/session');
 completeRecovery(response({user,csrf_token:'current-token'}));
 await expect(Promise.all([first,second,focus])).resolves.toEqual([{saved:'/api/datasets'},{saved:'/api/issues'},{user,csrf_token:'current-token'}]);
 expect(sessions).toBe(2);
 expect(fetch.mock.calls.filter(([path])=>path!=='/api/session').slice(-2).every(([,options])=>options.headers['X-CSRF-Token']==='current-token')).toBe(true);
});

it('rechecks authentication after another tab reports a change and releases the channel on unmount',async()=>{
 let connection;
 class Channel {
  constructor(){connection=this;this.close=vi.fn();this.postMessage=vi.fn();}
 }
 vi.stubGlobal('BroadcastChannel',Channel);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({user,csrf_token:'token'}))
  .mockResolvedValueOnce(response({user:null,csrf_token:'logged-out'})));
 const view=renderHook(()=>useSession());
 await waitFor(()=>expect(view.result.current.user).toEqual(user));
 await act(async()=>{connection.onmessage({data:{type:'changed'}});});
 expect(view.result.current.user).toBeNull();
 expect(view.result.current.loading).toBe(false);
 view.unmount();expect(connection.close).toHaveBeenCalledOnce();
});

it('revalidates on focus while preserving the existing account object and draft effects',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({user,csrf_token:'token'})));
 const view=renderHook(()=>useSession());
 await waitFor(()=>expect(view.result.current.user).toEqual(user));
 const initial=view.result.current.user;
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 expect(view.result.current.user).toBe(initial);
 expect(view.result.current.loading).toBe(false);
});
