import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { LocalStore } from '../shared/storage.js';
import { createRuntime } from '../shared/runtime.js';

const initialState = () => ({ items: [], total: 0 });
function adapter(request, context) {
  if (request.method === 'GET') return context.state;
  context.state.items.push({ owner: context.user.id, value: request.body.value });
  context.state.total += 1;
  if (request.body.reject) context.fail('Invalid domain input');
  if (request.body.staffOnly) context.requireStaff();
  return context.state.items.at(-1);
}
function setup({ id = 'runtime', indexedDB = new IDBFactory(), environment = {}, handle = adapter, store } = {}) {
  const storage = store || new LocalStore(id, { indexedDB, locks: undefined });
  const runtime = createRuntime({ id, seed: initialState, handle, store: storage, environment });
  return { runtime, storage, indexedDB };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('committed browser state survives a close/reopen and returned objects are detached', async () => {
  const { runtime, indexedDB } = setup();
  await runtime.ready;
  assert.equal(runtime.meta.persistent, true);
  const result = await runtime.request('/items', { method: 'POST', body: { value: 'persisted' } });
  result.value = 'caller mutation';
  const read = await runtime.request('/items');
  assert.equal(read.items[0].value, 'persisted');
  read.items.length = 0;
  assert.equal(runtime.read().items.length, 1);
  runtime.dispose();

  const reopened = setup({ indexedDB }).runtime;
  try {
    await reopened.ready;
    assert.deepEqual((await reopened.request('/items')).items, [{ owner: 1, value: 'persisted' }]);
    assert.equal(reopened.meta.error, '');
  } finally { reopened.dispose(); }
});

test('failed domain mutations roll back and the queue accepts a later successful write', async () => {
  const { runtime } = setup();
  try {
    await runtime.ready;
    let broadcasts = 0;
    runtime.subscribe(type => { if (type === 'data') broadcasts += 1; });
    await assert.rejects(runtime.request('/items', { method: 'POST', body: { value: 'rejected', reject: true } }), /Invalid domain input/);
    assert.deepEqual(await runtime.request('/items'), initialState());
    assert.equal(broadcasts, 0);
    assert.match(runtime.meta.error, /Invalid domain input/);
    await runtime.request('/items', { method: 'POST', body: { value: 'accepted' } });
    assert.equal((await runtime.request('/items')).total, 1);
    assert.equal(broadcasts, 1);
    assert.equal(runtime.meta.error, '');
  } finally { runtime.dispose(); }
});

test('a storage write failure does not report success or replace the committed state', async () => {
  const indexedDB = new IDBFactory();
  const base = new LocalStore('failure', { indexedDB, locks: undefined });
  let rejectNextWrite = false;
  const store = {
    get: () => base.get(), close: () => base.close(), exclusive: fn => base.exclusive(fn),
    async put(value, options) {
      if (rejectNextWrite) { rejectNextWrite = false; throw new Error('Quota exceeded'); }
      return base.put(value, options);
    }
  };
  const { runtime } = setup({ id: 'failure', store });
  try {
    await runtime.ready;
    rejectNextWrite = true;
    await assert.rejects(runtime.request('/items', { method: 'POST', body: { value: 'unsaved' } }), /Changes were not saved: Quota exceeded/);
    assert.deepEqual(runtime.read(), initialState());
    assert.deepEqual((await base.get()).state, initialState());
    await runtime.request('/items', { method: 'POST', body: { value: 'retry' } });
    assert.equal((await base.get()).state.items[0].value, 'retry');
  } finally { runtime.dispose(); }
});

test('queued requests retain the initiating actor and staff check when the selected demo role changes', async () => {
  const { runtime } = setup();
  try {
    await runtime.ready;
    const entered = deferred(), release = deferred();
    const blocker = runtime.mutate(async (_draft, context) => {
      entered.resolve();
      await release.promise;
      context.requireStaff();
      assert.equal(context.user.id, 1);
    });
    await entered.promise;
    const queuedAsStaff = runtime.request('/items', { method: 'POST', body: { value: 'owned by initiator', staffOnly: true } });
    await runtime.selectUser(2);
    release.resolve();
    await blocker;
    assert.deepEqual(await queuedAsStaff, { owner: 1, value: 'owned by initiator' });
    assert.equal(runtime.user.id, 2);
    assert.equal((await runtime.request('/items')).items[0].owner, 1);
    await assert.rejects(runtime.request('/items', { method: 'POST', body: { staffOnly: true } }), /staff demonstration role/);
    assert.equal((await runtime.request('/items')).total, 1);
  } finally { runtime.dispose(); }
});

test('separate store connections reject a stale revision atomically without Web Locks', async () => {
  const indexedDB = new IDBFactory();
  const first = new LocalStore('cas', { indexedDB, locks: undefined });
  const second = new LocalStore('cas', { indexedDB, locks: undefined });
  try {
    await first.put({ _revision: 1, state: { value: 'baseline' } }, { expectedRevision: 0 });
    const [snapshotA, snapshotB] = await Promise.all([first.get(), second.get()]);
    // Direct store writes bypass in-realm queue serialization, representing two tabs.
    const results = await Promise.allSettled([
      first.put({ _revision: 2, state: { value: 'first writer' } }, { expectedRevision: snapshotA._revision }),
      second.put({ _revision: 2, state: { value: 'second writer' } }, { expectedRevision: snapshotB._revision })
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const failed = results.find(result => result.status === 'rejected');
    assert.equal(failed.reason.status, 409);
    assert.match(failed.reason.message, /Another tab changed/);
    const committed = await first.get();
    assert.equal(committed._revision, 2);
    assert.equal(committed.state.value, results[0].status === 'fulfilled' ? 'first writer' : 'second writer');
    await assert.rejects(second.put({ _revision: 2, state: { value: 'late overwrite' } }, { expectedRevision: 1 }), error => error.status === 409);
    assert.deepEqual(await second.get(), committed);
    await second.put({ _revision: 3, state: { value: 'explicit retry' } }, { expectedRevision: 2 });
    assert.equal((await first.get()).state.value, 'explicit retry');
  } finally { first.close(); second.close(); }
});

test('application databases and resets are isolated; backup includes the committed app identity', async () => {
  const indexedDB = new IDBFactory();
  const first = setup({ id: 'app-one', indexedDB }).runtime;
  const second = setup({ id: 'app-two', indexedDB }).runtime;
  try {
    await Promise.all([first.ready, second.ready]);
    await first.request('/items', { method: 'POST', body: { value: 'one' } });
    await second.request('/items', { method: 'POST', body: { value: 'two' } });
    const backup = await second.backup();
    assert.equal(backup.format, 'geospatial-web-lab-standalone-backup');
    assert.equal(backup.app, 'app-two');
    assert.equal(backup.state.items[0].value, 'two');
    assert.ok(backup.exportedAt);
    backup.state.items[0].value = 'changed outside runtime';
    await first.reset();
    assert.deepEqual(await first.request('/items'), initialState());
    assert.equal(first.revision, 1);
    assert.equal((await second.request('/items')).items[0].value, 'two');
  } finally { first.dispose(); second.dispose(); }
});

test('an incompatible saved envelope can be backed up, a logged-out role can be selected, and reset recovers it', async () => {
  const indexedDB = new IDBFactory();
  const storage = new LocalStore('corrupt', { indexedDB, locks: undefined });
  await storage.put({ version: 999, app: 'corrupt', state: { legacy: true }, _revision: 7 });
  const roles = new Map([['geolab-standalone-corrupt:role', '0']]);
  const environment = { sessionStorage: { getItem: key => roles.get(key) ?? null, setItem: (key, value) => roles.set(key, value) } };
  const { runtime } = setup({ id: 'corrupt', indexedDB, store: storage, environment });
  try {
    await runtime.ready;
    assert.equal(runtime.meta.loading, false);
    assert.match(runtime.meta.error, /incompatible/);
    assert.equal(runtime.user, null);
    assert.equal((await runtime.backup()).version, 999);
    await assert.rejects(runtime.request('/items'), error => error.status === 503);
    assert.equal((await runtime.request('/api/session', { method: 'POST', body: { user_id: 2 } })).user.id, 2);
    await runtime.reset();
    assert.equal(runtime.meta.error, '');
    assert.deepEqual(await runtime.request('/items'), initialState());
    assert.equal((await storage.get())._revision, 8);
    assert.equal((await storage.get()).version, 1);
  } finally { runtime.dispose(); }
});

test('GET handler mutations are disposable and cannot change persisted data', async () => {
  const { runtime } = setup({ handle: (_request, { state }) => { state.total = 500; return state; } });
  try {
    await runtime.ready;
    assert.equal((await runtime.request('/read')).total, 500);
    assert.equal(runtime.read().total, 0);
    assert.equal((await runtime.backup()).state.total, 0);
  } finally { runtime.dispose(); }
});

test('BFCache restoration reloads and disposal removes lifecycle listeners', async () => {
  const listeners = new Map();
  let reloads = 0;
  const environment = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
    location: { reload: () => { reloads += 1; } }
  };
  const { runtime } = setup({ environment });
  await runtime.ready;
  listeners.get('pageshow')({ persisted: false });
  assert.equal(reloads, 0);
  listeners.get('pagehide')({ persisted: true });
  listeners.get('pageshow')({ persisted: true });
  assert.equal(reloads, 1);
  runtime.dispose();
  assert.equal(listeners.size, 0);
});

test('a backup restores into a fresh database as a new revision and notifies other tabs', async () => {
  const source = setup({ id: 'restore' }).runtime;
  const listeners = [];
  class Channel { constructor() { this.onmessage = null; listeners.push(this); } postMessage() { for (const other of listeners) if (other !== this) other.onmessage?.({}); } close() {} }
  const indexedDB = new IDBFactory();
  const target = setup({ id: 'restore', indexedDB, environment: { BroadcastChannel: Channel } }).runtime;
  const otherTab = setup({ id: 'restore', indexedDB, environment: { BroadcastChannel: Channel } }).runtime;
  try {
    await Promise.all([source.ready, target.ready, otherTab.ready]);
    await source.request('/items', { method: 'POST', body: { value: 'backed up' } });
    const backup = JSON.parse(JSON.stringify(await source.backup()));
    await target.request('/items', { method: 'POST', body: { value: 'local edit' } });
    await target.request('/items', { method: 'POST', body: { value: 'second local edit' } });
    const before = await new LocalStore('restore', { indexedDB, locks: undefined }).get();
    let otherTabUpdated = false;
    otherTab.subscribe(type => { if (type === 'data') otherTabUpdated = true; });
    await target.restore(backup);
    assert.deepEqual(target.read(), { items: [{ owner: 1, value: 'backed up' }], total: 1 });
    assert.equal(target.revision, 1);
    const after = await new LocalStore('restore', { indexedDB, locks: undefined }).get();
    assert.equal(after._revision, before._revision + 1);
    assert.equal(after.version, 1);
    assert.equal(after.app, 'restore');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(otherTabUpdated, true);
    assert.equal(otherTab.read().items[0].value, 'backed up');
  } finally { source.dispose(); target.dispose(); otherTab.dispose(); }
});

test('restore rejects foreign, unsupported, malformed or mismatched backups without changing stored data', async () => {
  const { runtime, storage } = setup({ id: 'guarded' });
  try {
    await runtime.ready;
    await runtime.request('/items', { method: 'POST', body: { value: 'keep me' } });
    const good = await runtime.backup();
    const committed = await storage.get();
    const cases = [
      [null, /not a standalone backup/],
      [{ ...good, format: 'something-else' }, /not a standalone backup/],
      [{ ...good, app: 'other-app' }, /belongs to other-app/],
      [{ ...good, version: 2 }, /version 2 is not supported/],
      [{ ...good, state: [] }, /no stored state/],
      [{ ...good, state: { items: [] } }, /"total" should be number, not missing/],
      [{ ...good, state: { items: {}, total: 0 } }, /"items" should be array, not object/],
      [{ ...good, state: { items: ['text'], total: 1 } }, /"items" contains invalid records/],
      [{ ...good, state: { items: [], total: null } }, /"total" should be number, not null/]
    ];
    for (const [value, message] of cases) await assert.rejects(runtime.restore(value), message);
    assert.deepEqual(await storage.get(), committed);
    assert.equal(runtime.revision, 0);
  } finally { runtime.dispose(); }
});

test('restore enforces a matching schema_version and recovers an incompatible saved envelope', async () => {
  const indexedDB = new IDBFactory();
  const storage = new LocalStore('schema', { indexedDB, locks: undefined });
  await storage.put({ version: 999, app: 'schema', state: { legacy: true }, _revision: 4 });
  const runtime = createRuntime({ id: 'schema', seed: () => ({ schema_version: 2, rows: [] }), handle: adapter, store: storage, environment: {} });
  try {
    await runtime.ready;
    assert.match(runtime.meta.error, /incompatible/);
    const backup = { format: 'geospatial-web-lab-standalone-backup', app: 'schema', version: 1, state: { schema_version: 1, rows: [] } };
    await assert.rejects(runtime.restore(backup), /schema 1 does not match this edition's schema 2/);
    await runtime.restore({ ...backup, state: { schema_version: 2, rows: [{ id: 1 }] } });
    assert.deepEqual((await storage.get()).state, { schema_version: 2, rows: [{ id: 1 }] });
    assert.equal((await storage.get())._revision, 5);
  } finally { runtime.dispose(); }
});

test('each standalone app restores its own backup and rejects a backup from another app', async () => {
  const apps = ['01-service-requests', '02-data-quality-portal', '03-fleet-monitor', '04-parcel-scenarios', '05-infrastructure-inspections'];
  const backups = new Map();
  for (const app of apps) {
    const { seed, handle } = await import(`../${app}/src/local-api.js`);
    const runtime = createRuntime({ id: app, seed, handle, store: new LocalStore(app, { indexedDB: new IDBFactory(), locks: undefined }), environment: {} });
    try {
      await runtime.ready;
      const backup = JSON.parse(JSON.stringify(await runtime.backup()));
      await runtime.restore(backup);
      assert.deepEqual(runtime.read(), backup.state, app);
      backups.set(app, backup);
    } finally { runtime.dispose(); }
  }
  const { seed, handle } = await import('../04-parcel-scenarios/src/local-api.js');
  const parcels = createRuntime({ id: '04-parcel-scenarios', seed, handle, store: new LocalStore('parcels-cross', { indexedDB: new IDBFactory(), locks: undefined }), environment: {} });
  try {
    await parcels.ready;
    await assert.rejects(parcels.restore(backups.get('05-infrastructure-inspections')), /belongs to 05-infrastructure-inspections/);
    // Relabelling another app's file still fails the shape check against this app's seed.
    await assert.rejects(parcels.restore({ ...backups.get('05-infrastructure-inspections'), app: '04-parcel-scenarios' }), /"parcels" should be array, not missing/);
  } finally { parcels.dispose(); }
});
