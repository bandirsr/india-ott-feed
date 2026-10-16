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
  'movie:3': t('Baseline', 'te', [532]),
});
const r1 = update(null, day1);

check('bootstrap is flagged', r1.bootstrap, true);
check('bootstrap records every pair', Object.keys(r1.ledger.seen).length, 4);
check('bootstrap reports no arrivals', r1.arrivals.length, 0);
check('bootstrap dates are null', arrivalDate(r1.ledger, 'movie:1', 8), null);
check('bootstrap sets the start date', r1.ledger.startedOn, '2026-09-13');
check('bootstrap counts as run 1', r1.ledger.runs, 1);

/* Day two: one title gains a platform, one brand-new title appears. aha is
   already being watched (movie:3 sat on it on day one) -- a platform the ledger
   has never seen would be undated, per 913a523. */
const day2 = snap('2026-09-14', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
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
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
});
const r3 = update(r2.ledger, day3);

check('one departure detected', r3.departures.length, 1);
check('the departed platform is named', r3.departures[0].providerName, 'Zee5');
check('a departed pair is forgotten', arrivalDate(r3.ledger, 'movie:2', 232), null);
check('the surviving platform is untouched', Object.keys(r3.ledger.seen).includes('movie:2|119'), true);

/* Day four: it comes back after one day. That is a data flap, not an arrival:
   TMDB/JustWatch drop and re-add listings (Mass Jathara, on Netflix since Nov
   2025, "arrived" on Netflix 11 Oct 2026). The pair keeps what we knew before
   it left, and nothing is reported as new. */
const r4 = update(r3.ledger, snap('2026-09-16', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
}));

check('a flapping pair is not reported as an arrival', r4.arrivals.some((a) => a.key === 'movie:2'), false);
check('a flapping pair keeps its earlier (undated) value', arrivalDate(r4.ledger, 'movie:2', 232), null);
check('the tombstone is cleared once it returns', Object.keys(r4.ledger.gone).length, 0);

/* A flap on a pair that WAS dated keeps the original date, not the return date. */
const f1 = update(r4.ledger, snap('2026-09-17', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
}));
const f2 = update(f1.ledger, snap('2026-09-18', {
  'movie:1': t('Peddi', 'te', [8]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
}));
const peddiAha = arrivalDate(f1.ledger, 'movie:1', 532);
const f3 = update(f2.ledger, snap('2026-09-25', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
}));
check('a dated pair that flaps keeps its original date', arrivalDate(f3.ledger, 'movie:1', 532), peddiAha);
check('a dated pair that flaps is not re-announced', f3.arrivals.length, 0);

/* A genuine licence lapse (gone longer than the window) IS a new arrival. */
const g1 = update(f3.ledger, snap('2026-09-26', {
  'movie:1': t('Peddi', 'te', [8]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
}));
const g2 = update(g1.ledger, snap('2027-01-15', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
}));
check('a lapse longer than the window is a fresh arrival', arrivalDate(g2.ledger, 'movie:1', 532), '2027-01-15');

/* Dropping out and back within the same run must not double-count. */
check('run count tracks sweeps', r4.ledger.runs, 4);
check('start date never moves', r4.ledger.startedOn, '2026-09-13');

/* The query the app makes. */
check('arrivalsSince excludes older arrivals', arrivalsSince(r4.ledger, '2026-09-15').length, 0);
const since = arrivalsSince(r4.ledger, '2026-09-14');
check('arrivalsSince returns the dated arrivals', since.length, 2);
check('arrivalsSince returns their dates', since[0].on, '2026-09-14');
check('arrivalsSince ignores undated bootstrap pairs', since.every((x) => x.on !== null), true);

// Two pairs were watched arriving (aha on Peddi, aha on Panchanama); Zee5
// returning to Lenin after a day is a flap, not an arrival. The bootstrap pairs
// stay out however far back the cutoff reaches -- that is why they are null.
const all = arrivalsSince(r4.ledger, '2000-01-01');
check('only watched arrivals surface, never bootstrap pairs', all.length, 2);

/* A title that is present but on zero platforms is not an arrival. */
const r5 = update(r4.ledger, snap('2026-09-17', {
  'movie:1': t('Peddi', 'te', [8, 532]),
  'movie:2': t('Lenin', 'te', [119, 232]),
  'movie:3': t('Baseline', 'te', [532]),
  'tv:9': t('Panchanama', 'te', [532]),
  'movie:77': t('Not streaming yet', 'te', []),
}));
check('a title with no platform produces no arrival', r5.arrivals.length, 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
