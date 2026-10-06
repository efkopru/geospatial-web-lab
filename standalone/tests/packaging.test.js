import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {ProcessGroup,CancelledProcessError,assembleGallery} from '../scripts/launcher.mjs';
import {createStaticHandler} from '../scripts/serve.mjs';

function processFixture(){
 const children=[];
 const group=new ProcessGroup(()=>{const child=new EventEmitter();child.kills=[];child.kill=signal=>{child.kills.push(signal);queueMicrotask(()=>child.emit('exit',null,signal));};children.push(child);return child;});
 return {children,group};
}
async function tempFixture(fn){
 const parent=resolve(tmpdir()),directory=await mkdtemp(join(parent,'geolab-packaging-'));
 const target=resolve(directory);
 // Checked before the test runs: throwing from finally would hide the test's own failure.
 if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('geolab-packaging-'))throw new Error('Refusing unsafe test cleanup');
 try{return await fn(directory);}finally{await rm(target,{recursive:true,force:true});}
}
async function response(handler,url,method='GET'){
 const result={};
 await handler({url,method},{writeHead(status,headers={}){result.status=status;result.headers=headers;},end(content){result.content=content?.toString();}});
 return result;
}

test('child spawn error stops siblings and removes the failed child from supervision',async()=>{
 const {group,children}=processFixture();
 const first=group.run('node',[],{}, {persistent:true}),second=group.run('node',[],{}, {persistent:true});
 const completion=Promise.allSettled([first,second]);
 children[1].emit('error',new Error('Cannot spawn'));
 const results=await completion;
 assert.equal(group.exitCode,1);assert.equal(group.children.size,0);
 assert.deepEqual(children[0].kills,['SIGTERM']);
 assert.equal(results[1].reason.message,'Cannot spawn');
 assert.ok(results[0].reason instanceof CancelledProcessError);
});

test('signal cancellation rejects an in-flight build and prevents later build steps',async()=>{
 const {group,children}=processFixture();let later=false;
 const build=group.run('node',[],{}).then(()=>{later=true;return group.run('node',[],{});});
 const completion=Promise.allSettled([build]);group.stop(130);
 const [result]=await completion;
 assert.ok(result.reason instanceof CancelledProcessError);assert.equal(later,false);assert.equal(children.length,1);
 assert.equal(group.exitCode,130);
 await assert.rejects(group.run('node',[],{}),CancelledProcessError);
});

test('a clean but unexpected preview exit stops every remaining server',async()=>{
 const {group,children}=processFixture();
 const completion=Promise.allSettled([group.run('node',[],{}, {persistent:true}),group.run('node',[],{}, {persistent:true})]);
 children[0].emit('exit',0,null);await completion;
 assert.equal(group.exitCode,1);assert.deepEqual(children[1].kills,['SIGTERM']);
});

test('gallery assembly replaces stale generated app assets while preserving app source',async()=>tempFixture(async directory=>{
 const app='04-parcel-scenarios';
 await mkdir(join(directory,app,'dist'),{recursive:true});await mkdir(join(directory,'dist',app,'assets'),{recursive:true});
 await writeFile(join(directory,app,'src.js'),'preserve source');await writeFile(join(directory,app,'dist','index.html'),'new app');
 await writeFile(join(directory,'dist',app,'assets','old-hash.js'),'stale');await writeFile(join(directory,'index.html'),'gallery');
 await assembleGallery(directory,[app]);
 await assert.rejects(access(join(directory,'dist',app,'assets','old-hash.js')));
 assert.equal(await readFile(join(directory,'dist',app,'index.html'),'utf8'),'new app');
 assert.equal(await readFile(join(directory,app,'src.js'),'utf8'),'preserve source');
 assert.equal(await readFile(join(directory,'dist','index.html'),'utf8'),'gallery');
 await assert.rejects(assembleGallery(directory,['../outside']),/Invalid standalone app directory/);
}));

test('cancelled gallery assembly does not remove an existing app build',async()=>tempFixture(async directory=>{
 await mkdir(join(directory,'dist','03-fleet-monitor'),{recursive:true});await writeFile(join(directory,'dist','03-fleet-monitor','index.html'),'existing');
 await assert.rejects(assembleGallery(directory,['03-fleet-monitor'],()=>{throw new CancelledProcessError();}),CancelledProcessError);
 assert.equal(await readFile(join(directory,'dist','03-fleet-monitor','index.html'),'utf8'),'existing');
}));

test('preview redirects a slashless app path before serving relative asset HTML',async()=>tempFixture(async directory=>{
 await mkdir(join(directory,'dist','03-fleet-monitor'),{recursive:true});await writeFile(join(directory,'dist','03-fleet-monitor','index.html'),'<script src="./assets/main.js"></script>');
 const handler=createStaticHandler({directory});
 const redirect=await response(handler,'/03-fleet-monitor?view=map');
 assert.equal(redirect.status,308);assert.equal(redirect.headers.Location,'/03-fleet-monitor/?view=map');
 const page=await response(handler,'/03-fleet-monitor/');assert.equal(page.status,200);assert.match(page.content,/\.\/assets/);
}));

test('development gallery exposes only known apps and explicit notice files',async()=>tempFixture(async directory=>{
 await mkdir(join(directory,'licenses'),{recursive:true});await writeFile(join(directory,'THIRD_PARTY_NOTICES.md'),'notices');await writeFile(join(directory,'licenses','react.txt'),'license');
 await writeFile(join(directory,'package.json'),'private development metadata');
 const handler=createStaticHandler({directory,mode:'dev'});
 assert.equal((await response(handler,'/03-fleet-monitor')).headers.Location,'http://127.0.0.1:5273/');
 assert.equal((await response(handler,'/03-not-an-app')).status,404);
 assert.equal((await response(handler,'/package.json')).status,404);
 const notices=await response(handler,'/THIRD_PARTY_NOTICES.md');assert.equal(notices.status,200);assert.match(notices.headers['Content-Type'],/^text\/plain/);
 assert.equal((await response(handler,'/licenses/react.txt')).content,'license');
 assert.equal((await response(handler,'/licenses/%2e%2e%2fpackage.json')).status,404);
 assert.equal((await response(handler,'/','POST')).status,405);
}));
