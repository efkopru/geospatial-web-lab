import {test,expect} from '@playwright/test';

for (const [port,resource] of [[5171,'issues'],[5172,'datasets'],[5173,'fleet'],[5174,'scenarios'],[5175,'assets']]) {
 test(`port ${port}: copied cookies are revoked and CSRF failures are explicit`,async({browser})=>{
  const context=await browser.newContext();
  let copied;
  try {
   const base=`http://127.0.0.1:${port}`;
   const initial=await (await context.request.get(`${base}/api/session`)).json();
   const login=await context.request.post(`${base}/api/session`,{headers:{'X-CSRF-Token':initial.csrf_token},data:{email:'staff@example.test',password:'Learning123!'}});
   expect(login.ok()).toBe(true);
   const session=await login.json();
   copied=await browser.newContext({storageState:await context.storageState()});
   expect((await copied.request.get(`${base}/api/${resource}`)).ok()).toBe(true);
   const rejected=await context.request.delete(`${base}/api/session`);
   expect(rejected.status()).toBe(422);
   expect((await rejected.json()).code).toBe('invalid_csrf');
   expect((await context.request.delete(`${base}/api/session`,{headers:{'X-CSRF-Token':session.csrf_token}})).ok()).toBe(true);
   expect((await (await copied.request.get(`${base}/api/session`)).json()).user).toBeNull();
   expect((await copied.request.get(`${base}/api/${resource}`)).status()).toBe(401);
  } finally {await copied?.close();await context.close();}
 });
}

test('logout disconnects an already authenticated live subscription',async({page,context})=>{
 const frames=[];
 page.on('websocket',socket=>socket.on('framereceived',({payload})=>{
  try{frames.push(JSON.parse(payload.toString()));}catch{/* Binary frames do not carry auth events. */}
 }));
 await page.goto('http://127.0.0.1:5171');
 await page.getByRole('button',{name:'Open workspace'}).click();
 await expect(page.getByText('Live updates connected',{exact:false})).toBeVisible();
 const session=await (await context.request.get('http://127.0.0.1:5171/api/session')).json();
 const logout=await context.request.delete('http://127.0.0.1:5171/api/session',{headers:{'X-CSRF-Token':session.csrf_token}});
 expect(logout.ok()).toBe(true);
 await expect.poll(()=>frames.some(f=>f.type==='disconnect'&&f.reconnect===false),{timeout:8000}).toBe(true);
});
