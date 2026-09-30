import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {api,Login,BarChart} from '../shared/index.jsx';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('shared data contract',()=>{
 it('sends session cookies and refreshed CSRF tokens on mutations',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce({ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>({csrf_token:'new-token'})}).mockResolvedValueOnce({ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>({id:4})});vi.stubGlobal('fetch',fetch);
  await api('/api/session');await api('/datasets',{method:'POST',body:{name:'Sample'}});
  expect(fetch.mock.calls[1][0]).toBe('/api/datasets');expect(fetch.mock.calls[1][1]).toMatchObject({credentials:'include',headers:{'X-CSRF-Token':'new-token'},body:'{"name":"Sample"}'});
 });
 it('turns forbidden server responses into readable errors',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:403,headers:new Headers({'content-type':'application/json'}),json:async()=>({error:'Staff access required'})}));
  await expect(api('/api/datasets')).rejects.toThrow('Staff access required');
 });
});
it('submits the selected account without dropping credentials',async()=>{const login=vi.fn().mockResolvedValue({id:2});render(<Login onLogin={login} title="Test workspace"/>);fireEvent.click(screen.getByRole('button',{name:'Reporter demo'}));fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));expect(login).toHaveBeenCalledWith({email:'reporter@example.test',password:'Learning123!'});});
it('charts preserve exact accessible values',()=>{render(<BarChart items={[{label:'Open',value:6},{label:'Closed',value:2}]}/>);expect(screen.getByRole('img')).toHaveAttribute('aria-label','Open: 6, Closed: 2');});
