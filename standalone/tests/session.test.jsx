import React from 'react';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {describe,it,expect,afterEach} from 'vitest';
import {configureStandalone} from '../shared/runtime.js';
import {useSession,AppShell} from '../shared/index.jsx';
let runtime;afterEach(()=>{cleanup();runtime?.dispose();});
function Harness(){const session=useSession();if(session.loading)return <p>Loading session</p>;return <AppShell title="Test standalone" user={session.user} onLogout={session.logout}><p>Current role: {session.user?.role||'none'}</p></AppShell>;}
describe('standalone session controls',()=>{
 it('opens a persisted local role, changes role without a server, and confirms reset before discarding edits',async()=>{
  runtime=configureStandalone({id:'ui-'+crypto.randomUUID(),seed:()=>({count:0}),handle:()=>({})});
  render(<Harness/>);await screen.findByText('Current role: staff');
  fireEvent.change(screen.getByLabelText('Demo role'),{target:{value:'2'}});await screen.findByText('Current role: reporter');
  await runtime.mutate(state=>{state.count=10;});fireEvent.click(screen.getByRole('button',{name:'Reset demo data'}));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Full-stack application data is unaffected');
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(runtime.read().count).toBe(10);
 });
 it('does not remain loading when initialization finishes before its effect subscribes',async()=>{
  runtime=configureStandalone({id:'ui-'+crypto.randomUUID(),seed:()=>({count:0}),handle:()=>({})});await runtime.ready;
  render(<Harness/>);await waitFor(()=>expect(screen.queryByText('Loading session')).not.toBeInTheDocument());expect(screen.getByText('Current role: staff')).toBeInTheDocument();
 });
});
