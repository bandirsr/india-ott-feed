/**
 * The diff engine decides what the app shows in "This week", so it gets tested
 * against constructed snapshots rather than by waiting a day to see.
 *
 * Run: node test/test-snapshot.js
 */

import { diff } from '../src/snapshot.js';

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
  }
}

/**
 * Provider names travel inside the snapshot rather than coming from a module
 * constant, because a constant is what let id 2285 print as "Amazon MiniTV"
 * when TMDB had reassigned it to "JustWatch TV". Fixtures carry them too.
 */
const NAMES = { 8: 'Netflix', 119: 'Amazon Prime Video', 232: 'Zee5', 532: 'aha' };

const snap = (date, titles) => ({ date, region: 'IN', providers: NAMES, titles });

/* A title that gains a provider it did not have. */
{
  const before = snap('2026-09-12', { 'movie:1': { t: 'Peddi', l: 'te', d: '2026-06-03', i: null, p: [] } });
  const after = snap('2026-09-13', { 'movie:1': { t: 'Peddi', l: 'te', d: '2026-06-03', i: null, p: [8] } });
  const d = diff(before, after);
  check('gaining a provider is one arrival', d.arrivals.length, 1);
  check('arrival names the provider', d.arrivals[0].providerName, 'Netflix');
  check('arrival is dated by the snapshot, not the release', d.arrivals[0].on, '2026-09-13');
  check('release date is carried through', d.arrivals[0].released, '2026-06-03');
  check('gaining a provider is not a departure', d.departures.length, 0);
}

/* A title TMDB had never seen before — the direct-to-OTT case. */
{
  const before = snap('2026-09-12', {});
  const after = snap('2026-09-13', { 'tv:9': { t: 'Panchanama', l: 'te', d: '2026-09-11', i: null, p: [532] } });
  const d = diff(before, after);
  check('a wholly new title is an arrival', d.arrivals.length, 1);
  check('new title keeps its aha provider', d.arrivals[0].providerName, 'aha');
  check('series keep their tv: key', d.arrivals[0].key, 'tv:9');
}

/* Nothing changed. The common case, and it must be silent. */
{
  const t = { 'movie:1': { t: 'Peddi', l: 'te', d: '2026-06-03', i: null, p: [8, 119] } };
  const d = diff(snap('2026-09-12', t), snap('2026-09-13', JSON.parse(JSON.stringify(t))));
  check('an unchanged title produces no arrival', d.arrivals.length, 0);
  check('an unchanged title produces no departure', d.departures.length, 0);
}

/* A licence lapsing. Showing a stale platform is worse than showing none. */
{
  const before = snap('2026-09-12', { 'movie:1': { t: 'Peddi', l: 'te', d: '2026-06-03', i: null, p: [8, 119] } });
  const after = snap('2026-09-13', { 'movie:1': { t: 'Peddi', l: 'te', d: '2026-06-03', i: null, p: [119] } });
  const d = diff(before, after);
  check('losing one provider is one departure', d.departures.length, 1);
  check('the departed provider is named', d.departures[0].providerName, 'Netflix');
  check('the retained provider is not an arrival', d.arrivals.length, 0);
}

/* A title vanishing entirely still counts as leaving every platform. */
{
  const before = snap('2026-09-12', { 'movie:1': { t: 'Gone', l: 'ta', d: '2024-01-01', i: null, p: [8, 532] } });
  const d = diff(before, snap('2026-09-13', {}));
  check('a removed title departs from each platform', d.departures.length, 2);
}

/* Landing on two platforms at once is two rows — the app lists per platform. */
{
  const before = snap('2026-09-12', { 'movie:5': { t: 'Lenin', l: 'te', d: '2026-07-10', i: null, p: [] } });
  const after = snap('2026-09-13', { 'movie:5': { t: 'Lenin', l: 'te', d: '2026-07-10', i: null, p: [119, 232] } });
  const d = diff(before, after);
  check('a simultaneous two-platform launch is two arrivals', d.arrivals.length, 2);
  check('both platforms are named', d.arrivals.map((a) => a.providerName).sort(), ['Amazon Prime Video', 'Zee5']);
}

/* The very first run has no predecessor, and must not report the whole
   catalogue as having arrived today. */
{
  const after = snap('2026-09-13', {
    'movie:1': { t: 'A', l: 'te', d: null, i: null, p: [8] },
    'movie:2': { t: 'B', l: 'hi', d: null, i: null, p: [119] },
  });
  const d = diff(null, after);
  check('a first snapshot reports no departures', d.departures.length, 0);
  check('a first snapshot records no previous date', d.from, null);
  check('a first snapshot does treat everything as new', d.arrivals.length, 2);
}

/* An unknown provider id must still render as something. */
{
  const after = snap('2026-09-13', { 'movie:7': { t: 'X', l: 'kn', d: null, i: null, p: [99999] } });
  const d = diff(snap('2026-09-12', {}), after);
  check('an untracked provider falls back to its id', d.arrivals[0].providerName, '99999');
}

/* Names must come from the snapshot, never from a table in the code. */
{
  const renamed = { date: '2026-09-13', region: 'IN', providers: { 2285: 'JustWatch TV' }, titles: { 'movie:1': { t: 'X', l: 'te', d: null, i: null, p: [2285] } } };
  const d = diff({ date: '2026-09-12', region: 'IN', providers: {}, titles: {} }, renamed);
  check('a reassigned id uses the name the snapshot recorded', d.arrivals[0].providerName, 'JustWatch TV');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
