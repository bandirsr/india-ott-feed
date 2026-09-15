/**
 * One-off repair: un-date the arrivals that widening the provider set invented.
 *
 * On 2026-09-15 the sweep went from 46 providers to 72. Every title on the new
 * ones had never been recorded, so the ledger stamped 3,540 pairs with that
 * day's date -- including films from 2004. They were not arrivals; we had just
 * started looking at the platform.
 *
 * This resets exactly those pairs to null (undated, "already there when we
 * started watching"), which is what the fixed ledger would have written. Pairs
 * on platforms we were already sweeping are left alone: those 27 are real.
 *
 *   node repair-arrivals.mjs [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BEFORE = '47c85c0'; // the last ledger commit before the widening
const DAY = '2026-09-15';

const cur = JSON.parse(readFileSync('data/arrivals.json', 'utf8'));
const old = JSON.parse(execSync(`git show ${BEFORE}:data/arrivals.json`, { maxBuffer: 1e9 }).toString());

const providerOf = (pair) => pair.split('|').pop();
const watchedBefore = new Set(Object.keys(old.seen).map(providerOf));

let cleared = 0, kept = 0;
for (const [pair, on] of Object.entries(cur.seen)) {
  if (on !== DAY) continue;
  if (watchedBefore.has(providerOf(pair))) { kept += 1; continue; }
  cur.seen[pair] = null;
  cleared += 1;
}

// Carry the fixed shape forward so the next run knows what has been watched.
cur.providers = [...new Set(Object.keys(cur.seen).map(providerOf))];

console.log(`  ${cleared} false arrivals reset to undated`);
console.log(`  ${kept} genuine arrivals on already-watched platforms kept`);
console.log(`  ledger now records ${cur.providers.length} watched providers`);

if (process.argv.includes('--apply')) {
  writeFileSync('data/arrivals.json', JSON.stringify(cur));
  console.log('\n  written to data/arrivals.json');
} else {
  console.log('\n  dry run — pass --apply to write');
}
