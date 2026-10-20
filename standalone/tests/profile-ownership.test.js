import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as inspections from '../05-infrastructure-inspections/src/local-api.js';
import { BACKUP_FORMAT, USERS, createRuntime } from '../shared/runtime.js';
import { LocalStore } from '../shared/storage.js';

const APP = '05-infrastructure-inspections';
const NOW = '2026-10-20T12:00:00.000Z';
function context(state, user = USERS[0]) {
  const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
  return { state, user, users: USERS, now: () => NOW, fail, requireStaff: () => { if (user.role !== 'staff') fail('Staff role required', 403); } };
}
const request = (ctx, path, method = 'GET', body = {}) => inspections.handle({ path, method, body }, ctx);
const create = (state, user) => request(context(state, user), '/api/profile_runs', 'POST').profile_run;
const ids = (ctx) => request(ctx, '/api/profile_runs').profile_runs.map((run) => run.id);

test('profile lists filter by demo identity before applying the recent-run limit', () => {
  const state = inspections.seed();
  const first = create(state, USERS[0]);
  const reporter = create(state, USERS[1]);
  const newestOther = Array.from({ length: 12 }, () => create(state, USERS[2]).id);
  assert.deepEqual(ids(context(state, USERS[0])), [first.id]);
  assert.deepEqual(ids(context(state, USERS[1])), [reporter.id]);
  assert.deepEqual(ids(context(state, USERS[2])), newestOther.slice(-10).reverse());
});

test('profile creation uses the selected identity and cannot accept a different owner from the body', () => {
  const state = inspections.seed();
  const result = request(context(state, USERS[1]), '/api/profile_runs', 'POST', { user_id: USERS[0].id });
  assert.equal(state.profileRuns[0].user_id, USERS[1].id);
  assert.deepEqual(ids(context(state, USERS[0])), []);
  assert.deepEqual(ids(context(state, USERS[1])), [result.profile_run.id]);
});

test('staff and reporter identities can read and download only their own profiles', () => {
  const state = inspections.seed();
  const runs = USERS.map((owner) => ({ owner, id: create(state, owner).id }));
  const before = structuredClone(state);
  for (const { owner, id } of runs) {
    for (const viewer of USERS) {
      const ctx = context(state, viewer);
      for (const suffix of ['', '/download']) {
        const path = `/api/profile_runs/${id}${suffix}`;
        if (viewer.id === owner.id) {
          const result = request(ctx, path);
          if (suffix) assert.equal(JSON.parse(result.download.content).features.length, 71);
          else assert.equal(result.profile_run.id, id);
        } else {
          assert.throws(() => request(ctx, path), (error) => error.status === 404 && error.message === 'Profile run not found');
        }
      }
    }
  }
  assert.deepEqual(state, before);
});

test('only a failed profile owner can retry it without changing another identity\'s records', () => {
  const state = inspections.seed();
  const runs = USERS.map((owner) => ({ owner, id: create(state, owner).id }));
  state.profileRuns.forEach((run) => { run.status = 'failed'; run.error_message = 'Restored failure'; });
  for (const { owner, id } of runs) {
    const before = structuredClone(state);
    for (const viewer of USERS.filter((user) => user.id !== owner.id)) {
      assert.throws(() => request(context(state, viewer), `/api/profile_runs/${id}/retry`, 'POST'), (error) => error.status === 404);
      assert.deepEqual(state, before);
    }
    const retried = request(context(state, owner), `/api/profile_runs/${id}/retry`, 'POST').profile_run;
    assert.equal(retried.status, 'completed');
    assert.equal(retried.generation, 2);
    assert.deepEqual(state.profileRuns.filter((run) => run.id !== id), before.profileRuns.filter((run) => run.id !== id));
  }
});

test('retention removes only the selected identity\'s oldest completed profiles', () => {
  const state = inspections.seed();
  const protectedRuns = [];
  for (const owner of USERS.slice(1)) {
    for (let index = 0; index < inspections.PROFILE_RUN_LIMIT; index++) create(state, owner);
  }
  const template = state.profileRuns[0];
  for (const owner of [999, null, undefined]) {
    const run = { ...structuredClone(template), id: state.nextProfileId++, user_id: owner };
    if (owner === undefined) delete run.user_id;
    state.profileRuns.push(run);
  }
  protectedRuns.push(...structuredClone(state.profileRuns));
  const unfinished = ['failed', 'pending', 'processing'].map((status) => {
    const created = create(state, USERS[0]);
    const run = state.profileRuns.find((entry) => entry.id === created.id);
    run.status = status;
    return structuredClone(run);
  });
  const completed = Array.from({ length: inspections.PROFILE_RUN_LIMIT }, () => create(state, USERS[0]).id);
  // Backups can retain a different array order; the limit still follows run IDs.
  state.profileRuns.reverse();
  const latest = create(state, USERS[0]);
  assert.deepEqual(state.profileRuns.filter((run) => run.user_id === USERS[0].id && run.status === 'completed').map((run) => run.id).sort((a, b) => a - b), [...completed.slice(1), latest.id]);
  for (const expected of [...protectedRuns, ...unfinished]) {
    assert.deepEqual(state.profileRuns.find((run) => run.id === expected.id), expected);
  }
  assert.throws(() => request(context(state), `/api/profile_runs/${completed[0]}`), (error) => error.status === 404);
  assert.equal(state.profileRuns.filter((run) => run.user_id === USERS[0].id && run.status === 'completed').length, inspections.PROFILE_RUN_LIMIT);
});

test('retry completion enforces the owner limit without pruning another identity', () => {
  const state = inspections.seed();
  for (let index = 0; index < inspections.PROFILE_RUN_LIMIT; index++) create(state, USERS[1]);
  const other = structuredClone(state.profileRuns);
  const completed = Array.from({ length: inspections.PROFILE_RUN_LIMIT - 1 }, () => create(state, USERS[0]).id);
  const failed = create(state, USERS[0]);
  Object.assign(state.profileRuns.find((run) => run.id === failed.id), { status: 'failed', error_message: 'Interrupted profile' });
  completed.push(create(state, USERS[0]).id);
  request(context(state, USERS[0]), `/api/profile_runs/${failed.id}/retry`, 'POST');
  const ownCompleted = state.profileRuns.filter((run) => run.user_id === USERS[0].id && run.status === 'completed');
  assert.equal(ownCompleted.length, inspections.PROFILE_RUN_LIMIT);
  assert.equal(ownCompleted.some((run) => run.id === completed[0]), false);
  assert.equal(ownCompleted.some((run) => run.id === failed.id), true);
  assert.deepEqual(state.profileRuns.filter((run) => run.user_id === USERS[1].id), other);
});

test('version-one backups keep existing profile owners through restore, identity changes and reopen', async () => {
  const legacyState = inspections.seed();
  const profiles = USERS.map((owner) => ({ owner, id: create(legacyState, owner).id }));
  const backup = JSON.parse(JSON.stringify({ format: BACKUP_FORMAT, version: 1, app: APP, state: legacyState, _revision: 1, savedAt: NOW, exportedAt: NOW }));
  const indexedDB = new IDBFactory();
  const open = async () => {
    const runtime = createRuntime({ id: APP, ...inspections, store: new LocalStore(APP, { indexedDB, locks: undefined }), environment: {} });
    await runtime.ready;
    return runtime;
  };
  let runtime = await open();
  try {
    await runtime.restore(backup);
    assert.deepEqual(runtime.read(), legacyState);
    for (const { owner, id } of profiles) {
      await runtime.selectUser(owner.id);
      assert.deepEqual((await runtime.request('/api/profile_runs')).profile_runs.map((run) => run.id), [id]);
      const foreign = profiles.find((entry) => entry.owner.id !== owner.id);
      await assert.rejects(runtime.request(`/api/profile_runs/${foreign.id}/download`), (error) => error.status === 404);
      assert.deepEqual((await runtime.backup()).state, legacyState);
    }
    runtime.dispose();
    runtime = await open();
    assert.deepEqual(runtime.read(), legacyState);
    assert.deepEqual((await runtime.request('/api/profile_runs')).profile_runs.map((run) => run.id), [profiles[0].id]);
  } finally { runtime.dispose(); }
});
