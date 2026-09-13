/**
 * The ledger is the only thing that survives a run, so a bug here quietly
 * corrupts every arrival date the app will ever show. Tested against
 * constructed sweeps rather than by waiting days to find out.
 *
 * Run: node test/test-ledger.js
 */

import { update, arrivalDate, arrivalsSince } from '../src/ledger.js';

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
  }
}

/** Names live in the snapshot, not in a module constant. See test-snapshot.js. */
const NAMES = { 8: 'Netflix', 119: 'Amazon Prime Video', 232: 'Zee5', 532: 'aha' };

const snap = (date, titles) => ({ date, region: 'IN', providers: NAMES, titles });
const t = (name, lang, providers) => ({ t: name, l: lang, d: '2026-01-01', i: null, p: providers });

/* The first run cannot date anything, and must not pretend otherwise. */
const day1 = snap('2026-09-13', {
  'movie:1': t('Peddi', 'te', [8]),
  'movie:2': t('Lenin', 'te', [119, 232]),
});
const r1 = update(null, day1);

check('bootstrap is flagged', r1.bootstrap, true);
check('bootstrap records every pair', Object.keys(r1.ledger.seen).length, 3);
check('bootstrap reports no arrivals', r1.arrivals.length, 0);
check('bootstrap dates are null', arrivalDate(r1.ledger, 'movie:1', 8), null);
check('bootstrap sets the start date', r1.ledger.startedOn, '2026-09-13');
check('bootstrap counts as run 1', r1.ledger.runs, 1);

/* Day two: one title gains a platform, one brand-new title appears. */
const day2 = snap('2026-09-14', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'tv:9': t('Panchanama', 'te', [532]),
});
const r2 = update(r1.ledger, day2);

check('second run is not a bootstrap', r2.bootstrap, false);
check('two arrivals detected', r2.arrivals.length, 2);
check('a gained platform is dated', arrivalDate(r2.ledger, 'movie:1', 532), '2026-09-14');
check('an untouched pair keeps its null date', arrivalDate(r2.ledger, 'movie:1', 8), null);
check('a new title is dated', arrivalDate(r2.ledger, 'tv:9', 532), '2026-09-14');
check('arrivals name their platform', r2.arrivals.map((a) => a.providerName).sort(), ['aha', 'aha']);
check('nothing departed', r2.departures.length, 0);

/* Day three: a licence lapses. */
const day3 = snap('2026-09-15', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119]),
  'tv:9': t('Panchanama', 'te', [532]),
});
const r3 = update(r2.ledger, day3);

check('one departure detected', r3.departures.length, 1);
check('the departed platform is named', r3.departures[0].providerName, 'Zee5');
check('a departed pair is forgotten', arrivalDate(r3.ledger, 'movie:2', 232), null);
check('the surviving platform is untouched', Object.keys(r3.ledger.seen).includes('movie:2|119'), true);

/* Day four: it comes back. The return date is the honest one, not the
   original — a viewer looking at it today cares when they can watch it. */
const r4 = update(r3.ledger, snap('2026-09-16', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'tv:9': t('Panchanama', 'te', [532]),
}));

check('a returning title is a fresh arrival', r4.arrivals.length, 1);
check('a returning title dates from its return', arrivalDate(r4.ledger, 'movie:2', 232), '2026-09-16');

/* Dropping out and back within the same run must not double-count. */
check('run count tracks sweeps', r4.ledger.runs, 4);
check('start date never moves', r4.ledger.startedOn, '2026-09-13');

/* The query the app makes. */
const since = arrivalsSince(r4.ledger, '2026-09-15');
check('arrivalsSince excludes older arrivals', since.length, 1);
check('arrivalsSince returns the recent one', since[0].on, '2026-09-16');
check('arrivalsSince ignores undated bootstrap pairs', since.every((x) => x.on !== null), true);

// Three pairs were watched arriving (aha on Peddi, aha on Panchanama, Zee5
// returning to Lenin). The two bootstrap pairs stay out of it however far back
// the cutoff reaches — that is the point of storing them as null.
const all = arrivalsSince(r4.ledger, '2000-01-01');
check('only watched arrivals surface, never bootstrap pairs', all.length, 3);

/* A title that is present but on zero platforms is not an arrival. */
const r5 = update(r4.ledger, snap('2026-09-17', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'tv:9': t('Panchanama', 'te', [532]),
  'movie:77': t('Not streaming yet', 'te', []),
}));
check('a title with no platform produces no arrival', r5.arrivals.length, 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
