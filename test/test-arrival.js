/**
 * Guards on what an arrival date is allowed to say. Each case below is a real
 * title that shipped a wrong date, so a regression fails here, not in the app.
 *
 * Run: node test/test-arrival.js
 */
import { arrivalOn, DIGITAL_GAP_DAYS, LEGACY_CATALOG_GAP_DAYS } from '../src/arrival.js';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  }
}

const NETFLIX = 8;

/* Mass Jathara: cinema 2025-10-31, digital 2025-11-28 on Netflix, ledger
   "arrival" 2026-10-11 after the listing flickered. Must come out undated. */
check('Mass Jathara: a flicker 10 months after digital is undated',
  arrivalOn('movie', { d: '2025-10-31' }, NETFLIX, '2026-10-11', undefined, '2025-11-28'), null);

/* A genuine fresh arrival close to the digital date keeps its date. */
check('arrival within a week of digital is kept',
  arrivalOn('movie', { d: '2026-09-01' }, NETFLIX, '2026-10-03', undefined, '2026-10-01'), '2026-10-03');
check('arrival just inside the window is kept',
  arrivalOn('movie', { d: '2026-01-01' }, NETFLIX, '2026-07-01', undefined, '2026-03-05'), '2026-07-01');
check('arrival just outside the window is undated',
  arrivalOn('movie', { d: '2026-01-01' }, NETFLIX, '2026-07-10', undefined, '2026-03-05'), null);
check('the window is a documented number', DIGITAL_GAP_DAYS, 120);

/* No digital date known: the older guards still apply, nothing new is invented. */
check('no digital date and a small gap keeps the arrival',
  arrivalOn('movie', { d: '2026-09-01' }, NETFLIX, '2026-10-03', undefined, undefined), '2026-10-03');
check('3 Monkeys: multi-year gap is still undated',
  arrivalOn('movie', { d: '2020-02-07' }, 119, '2026-09-17', undefined, undefined), null);
check('legacy window unchanged', LEGACY_CATALOG_GAP_DAYS, 400);

/* An undated pair stays undated, with or without a digital date. */
check('null stays null', arrivalOn('movie', { d: '2025-10-31' }, NETFLIX, null, undefined, '2025-11-28'), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
