/**
 * The guard that protects the archive, tested against the failures it exists
 * to catch. If this is wrong, one bad morning silently deletes months of
 * arrival dates that cannot be recomputed from any source.
 *
 * Run: node test/test-health.js
 */

import { sanityCheck, freshness } from '../src/health.js';

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  }
}

/** A snapshot of n titles, each on one platform. */
function bigSnapshot(n) {
  const titles = {};
  for (let i = 0; i < n; i += 1) {
    titles[`movie:${i}`] = { t: `T${i}`, l: 'te', d: null, i: null, p: [8] };
  }
  return { date: '2026-09-14', region: 'IN', providers: { 8: 'Netflix' }, titles };
}

const healthyLedger = { startedOn: '2026-01-01', updatedOn: '2026-09-13', runs: 200, seen: {}, pairCount: 20000 };

/* A normal day passes. */
{
  const r = sanityCheck(healthyLedger, bigSnapshot(20050), { departures: 12 });
  check('a normal sweep is accepted', r.ok, true);
  check('a normal sweep reports no problems', r.problems.length, 0);
  check('pair count is measured', r.pairCount, 20050);
}

/* TMDB down: the sweep comes back nearly empty. This is the one that matters. */
{
  const r = sanityCheck(healthyLedger, bigSnapshot(40), { departures: 19960 });
  check('a collapsed sweep is rejected', r.ok, false);
  check('a collapsed sweep says why', r.problems.length > 0, true);
}

/* A partial outage: half the sweep succeeded. Still not believable. */
{
  const r = sanityCheck(healthyLedger, bigSnapshot(9000), { departures: 11000 });
  check('a half-failed sweep is rejected', r.ok, false);
}

/* Just above the floor. A real catalogue does shrink slowly. */
{
  const r = sanityCheck(healthyLedger, bigSnapshot(19000), { departures: 1000 });
  check('a small genuine decline is accepted', r.ok, true);
}

/* Mass departures with a healthy title count — a licence apocalypse that is
   far more likely to be a bug in our own diff. */
{
  const r = sanityCheck(healthyLedger, bigSnapshot(20000), { departures: 9000 });
  check('implausible mass departures are rejected', r.ok, false);
}

/* The provider endpoint failed, so nothing can be named. */
{
  const snap = bigSnapshot(20000);
  snap.providers = {};
  const r = sanityCheck(healthyLedger, snap, { departures: 0 });
  check('a sweep with no providers is rejected', r.ok, false);
}

/* First run: nothing to compare against, only the absolute floor applies. */
{
  check('a healthy first run is accepted', sanityCheck(null, bigSnapshot(13000)).ok, true);
  check('an empty first run is still rejected', sanityCheck(null, bigSnapshot(10)).ok, false);
}

/* Growth is never suspicious. */
{
  const r = sanityCheck(healthyLedger, bigSnapshot(40000), { departures: 5 });
  check('a large increase is accepted', r.ok, true);
}

/* --- freshness: the failure where nothing runs at all --- */
{
  const fresh = freshness(healthyLedger, { today: '2026-09-14' });
  check('yesterday is fresh', fresh.ok, true);
  check('age is reported in days', fresh.ageDays, 1);

  const stale = freshness(healthyLedger, { today: '2026-09-30' });
  check('seventeen days is stale', stale.ok, false);
  check('a stale report names the last run', stale.lastRun, '2026-09-13');
  check('a stale report says the job is not running', /not running/.test(stale.message), true);

  check('no ledger at all is not ok', freshness(null).ok, false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
