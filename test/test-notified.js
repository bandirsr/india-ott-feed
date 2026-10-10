import assert from 'node:assert/strict';
import { deviceHash, prune, unsentMatches, markSent } from '../src/notified.js';

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

console.log('test-notified: ok');
