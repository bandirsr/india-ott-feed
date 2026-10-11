import assert from 'node:assert/strict';
import { deviceHash, prune, unsentMatches, markSent, splitTickets } from '../src/notified.js';

const TOKEN = 'ExponentPushToken[abc123]';
const m = (id, platforms) => ({ id, title: id, platforms });

// the raw token is never what gets stored
assert.notEqual(deviceHash(TOKEN), TOKEN);
assert.equal(deviceHash(TOKEN).length, 16);
assert.equal(deviceHash(TOKEN), deviceHash(TOKEN));

// first run: everything is new
let state = {};
let todo = unsentMatches(state, TOKEN, [m('movie:1', ['Netflix']), m('movie:2', ['ZEE5'])]);
assert.equal(todo.length, 2);
markSent(state, TOKEN, todo, '2026-10-10');
assert.ok(!JSON.stringify(state).includes('abc123'));

// second run the same day: nothing is sent again
assert.deepEqual(unsentMatches(state, TOKEN, [m('movie:1', ['Netflix']), m('movie:2', ['ZEE5'])]), []);

// a new platform for an already-announced title is announced, for that platform only
todo = unsentMatches(state, TOKEN, [m('movie:1', ['Netflix', 'JioHotstar'])]);
assert.equal(todo.length, 1);
assert.deepEqual(todo[0].platforms, ['JioHotstar']);

// another device is unaffected
assert.equal(unsentMatches(state, 'ExponentPushToken[other]', [m('movie:1', ['Netflix'])]).length, 1);

// pruning keeps recent entries and drops old ones
const pruned = prune({ a: '2026-09-01', b: '2026-10-08' }, '2026-10-10');
assert.deepEqual(Object.keys(pruned), ['b']);

// Expo tickets: only status "ok" counts as sent, even inside an HTTP 200
{
  const batch = [{ to: 'ExponentPushToken[a]' }, { to: 'ExponentPushToken[b]' }, { to: 'ExponentPushToken[c]' }, { to: 'ExponentPushToken[d]' }];
  const body = {
    data: [
      { status: 'ok', id: '1' },
      { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
      // fourth ticket missing entirely
    ],
  };
  const r = splitTickets(batch, body);
  assert.deepEqual(r.accepted.map((m) => m.to), ['ExponentPushToken[a]']);
  assert.equal(r.rejected.length, 3);
  assert.deepEqual(r.deadTokens, ['ExponentPushToken[b]']);
  assert.equal(r.rejected[2].reason, 'no ticket returned');
  // a single-object answer and an unreadable one
  assert.equal(splitTickets([batch[0]], { data: { status: 'ok' } }).accepted.length, 1);
  assert.equal(splitTickets([batch[0]], null).accepted.length, 0);
}

console.log('test-notified: ok');
