import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { LocalStore, recordIds } from '../shared/storage.js';
import { createRuntime } from '../shared/runtime.js';

// Records every key written or deleted through IndexedDB while `task` runs.
async function writesDuring(task) {
  const puts = [], deletes = [];
  const put = IDBObjectStore.prototype.put, remove = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.put = function (value, key) { puts.push(JSON.stringify(key)); return put.call(this, value, key); };
  IDBObjectStore.prototype.delete = function (key) { deletes.push(JSON.stringify(key)); return remove.call(this, key); };
  try { await task(); } finally { IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.delete = remove; }
  return { puts, deletes };
}
const seed = () => ({ rows: [{ id: 1, value: 'a' }, { id: 2, value: 'b' }, { id: 3, value: 'c' }], counter: 3, settings: { mode: 'x' } });
function handle(request, { state }) {
  if (request.method === 'GET') return state;
  if (request.body.edit) { state.rows.find(row => row.id === request.body.edit).value = request.body.value; return state.rows.find(row => row.id === request.body.edit); }
  if (request.body.add) { state.counter += 1; state.rows.push({ id: state.counter, value: request.body.add }); return state.rows.at(-1); }
  if (request.body.remove) { state.rows = state.rows.filter(row => row.id !== request.body.remove); return null; }
  if (request.body.noop) return state.rows[0];
  if (request.body.fail) { state.rows[0].value = 'changed before failing'; throw new Error('Rejected'); }
}
const open = (indexedDB, id = 'diff') => createRuntime({ id, seed, handle, store: new LocalStore(id, { indexedDB, locks: undefined }), environment: {} });

test('recordIds accepts only arrays of objects with unique string or numeric ids', () => {
  assert.deepEqual(recordIds([{ id: 1 }, { id: 'b' }]), [1, 'b']);
  assert.deepEqual(recordIds([]), []);
  assert.equal(recordIds([{ id: 1 }, { id: 1 }]), null);
  assert.equal(recordIds([{ id: 1 }, { name: 'no id' }]), null);
  assert.equal(recordIds([[1], [2]]), null);
  assert.equal(recordIds({ id: 1 }), null);
});

test('a change writes only the changed record, the changed fields and the revision', async () => {
  const runtime = open(new IDBFactory());
  try {
    await runtime.ready;
    const edit = await writesDuring(() => runtime.request('/rows', { method: 'POST', body: { edit: 2, value: 'B' } }));
    assert.deepEqual(edit.puts.sort(), ['"meta"', '["r","rows",2]']);
    assert.deepEqual(edit.deletes, []);

    const add = await writesDuring(() => runtime.request('/rows', { method: 'POST', body: { add: 'd' } }));
    assert.deepEqual(add.puts.sort(), ['"meta"', '["f","counter"]', '["f","rows"]', '["r","rows",4]']);

    const remove = await writesDuring(() => runtime.request('/rows', { method: 'POST', body: { remove: 1 } }));
    assert.deepEqual(remove.puts.sort(), ['"meta"', '["f","rows"]']);
    assert.deepEqual(remove.deletes, ['["r","rows",1]']);

    const noop = await writesDuring(() => runtime.request('/rows', { method: 'POST', body: { noop: true } }));
    assert.deepEqual(noop, { puts: [], deletes: [] });

    const failed = await writesDuring(() => assert.rejects(runtime.request('/rows', { method: 'POST', body: { fail: true } }), /Rejected/));
    assert.deepEqual(failed, { puts: [], deletes: [] });
    assert.deepEqual(runtime.read().rows.map(row => [row.id, row.value]), [[2, 'B'], [3, 'c'], [4, 'd']]);
  } finally { runtime.dispose(); }
});

test('records reassemble in order after reopening, and a value or record field can change mode', async () => {
  const indexedDB = new IDBFactory();
  const runtime = open(indexedDB);
  try {
    await runtime.ready;
    await runtime.request('/rows', { method: 'POST', body: { remove: 2 } });
    await runtime.request('/rows', { method: 'POST', body: { add: 'last' } });
    await runtime.mutate(state => { state.settings = [{ id: 'a', on: true }]; state.rows = 'no longer records'; });
  } finally { runtime.dispose(); }
  const reopened = open(indexedDB);
  try {
    await reopened.ready;
    assert.deepEqual(reopened.read(), { rows: 'no longer records', counter: 4, settings: [{ id: 'a', on: true }] });
    const store = new LocalStore('diff', { indexedDB, locks: undefined });
    const db = await store.open();
    const keys = await new Promise(resolve => { const request = db.transaction('data').objectStore('data').getAllKeys(); request.onsuccess = () => resolve(request.result.map(key => JSON.stringify(key))); });
    assert.deepEqual(keys.sort(), ['"meta"', '["f","counter"]', '["f","rows"]', '["f","settings"]', '["r","settings","a"]']);
    store.close();
  } finally { reopened.dispose(); }
});

test('a version 1 database is migrated into fields and records without losing its revision', async () => {
  const indexedDB = new IDBFactory();
  const legacy = { version: 1, app: 'legacy', state: { rows: [{ id: 7, value: 'kept' }], counter: 7, settings: { mode: 'old' } }, _revision: 12, savedAt: '2026-09-30T00:00:00.000Z' };
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('geolab-standalone-legacy-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(legacy, 'state'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    request.onerror = () => reject(request.error);
  });
  const runtime = open(indexedDB, 'legacy');
  try {
    await runtime.ready;
    assert.equal(runtime.meta.error, '');
    assert.deepEqual(runtime.read(), legacy.state);
    const backup = await runtime.backup();
    assert.equal(backup._revision, 12);
    assert.equal(backup.savedAt, legacy.savedAt);
    await runtime.request('/rows', { method: 'POST', body: { edit: 7, value: 'edited' } });
    assert.equal((await new LocalStore('legacy', { indexedDB, locks: undefined }).get())._revision, 13);
  } finally { runtime.dispose(); }
});

test('a tab reloads only after another tab commits, and a stale diff is rejected without writing', async () => {
  const indexedDB = new IDBFactory();
  const first = open(indexedDB), second = open(indexedDB);
  try {
    await Promise.all([first.ready, second.ready]);
    await first.request('/rows', { method: 'POST', body: { edit: 1, value: 'from first' } });
    // The second tab checks the revision before its next request and picks up the change.
    assert.equal((await second.request('/rows')).rows[0].value, 'from first');
    await second.request('/rows', { method: 'POST', body: { edit: 3, value: 'from second' } });
    assert.deepEqual((await first.request('/rows')).rows.map(row => row.value), ['from first', 'b', 'from second']);
    const store = new LocalStore('diff', { indexedDB, locks: undefined });
    const committed = await store.get();
    await assert.rejects(store.put({ ...committed, state: { ...committed.state, counter: 99 }, _revision: committed._revision + 1 }, { expectedRevision: committed._revision - 1, base: committed.state }), error => error.status === 409);
    assert.deepEqual(await store.get(), committed);
    store.close();
  } finally { first.dispose(); second.dispose(); }
});

test('changes made through records reached by array methods are tracked and saved', async () => {
  const indexedDB = new IDBFactory();
  const sortedHandle = (request, { state }) => { const [first] = state.rows.toSorted((a, b) => b.id - a.id); first.value = 'updated via toSorted'; return first; };
  const runtime = createRuntime({ id: 'derived', seed, handle: sortedHandle, store: new LocalStore('derived', { indexedDB, locks: undefined }), environment: {} });
  try {
    await runtime.ready;
    const writes = await writesDuring(() => runtime.request('/rows', { method: 'POST', body: {} }));
    assert.deepEqual(writes.puts.sort(), ['"meta"', '["r","rows",3]']);
    assert.equal((await new LocalStore('derived', { indexedDB, locks: undefined }).get()).state.rows[2].value, 'updated via toSorted');
  } finally { runtime.dispose(); }
});
