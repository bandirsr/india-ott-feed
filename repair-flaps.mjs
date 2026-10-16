/**
 * One-off repair: undo the false arrivals that listing flaps already wrote.
 *
 * Before the ledger learned to tombstone departures (RETURN_WINDOW_DAYS), a
 * pair that dropped out of TMDB/JustWatch data for a run or two was deleted,
 * and when it came back it was stamped with the RETURN date as a new arrival.
 * 11-12 Oct and 16 Oct 2026 had mass drops (hundreds of pairs) that did this.
 *
 * This replays the ledger's git history, finds every pair that vanished and
 * reappeared within the window, and restores the value it had before it left.
 * Only touches a pair whose current value is still the false return date.
 *
 *   node repair-flaps.mjs           dry run, prints what would change
 *   node repair-flaps.mjs --apply   writes data/arrivals.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { RETURN_WINDOW_DAYS } from './src/ledger.js';

const apply = process.argv.includes('--apply');
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const git = (c) => execSync(`git ${c}`, { maxBuffer: 1 << 30 }).toString();

const commits = git('log --reverse --format=%H -- data/arrivals.json').trim().split('\n');
let prev = null;
const tomb = {}; // pair -> { on, left }
const fixes = {}; // pair -> { restore, falseOn }

for (const c of commits) {
  let led;
  try { led = JSON.parse(git(`show ${c}:data/arrivals.json`)); } catch { continue; }
  const date = led.updatedOn;
  const seen = led.seen ?? {};
  if (prev) {
    for (const [pair, on] of Object.entries(prev)) {
      if (!(pair in seen)) tomb[pair] = tomb[pair] ?? { on, left: date };
    }
    for (const [pair, on] of Object.entries(seen)) {
      if (pair in prev) { delete tomb[pair]; continue; }
      const t = tomb[pair];
      if (t) {
        if (days(t.left, date) <= RETURN_WINDOW_DAYS && on !== t.on) fixes[pair] = { restore: t.on, falseOn: on };
        delete tomb[pair];
      }
    }
  }
  prev = seen;
}

const cur = JSON.parse(readFileSync('data/arrivals.json', 'utf8'));
let changed = 0, skipped = 0;
const byDay = {};
const sample = [];
for (const [pair, f] of Object.entries(fixes)) {
  if (!(pair in cur.seen)) continue;
  if (cur.seen[pair] !== f.falseOn) { skipped += 1; continue; }
  if (apply) cur.seen[pair] = f.restore;
  changed += 1;
  byDay[f.falseOn] = (byDay[f.falseOn] ?? 0) + 1;
  if (sample.length < 15 && f.restore === null) sample.push(`${pair}: ${f.falseOn} -> undated`);
}
console.log(`${commits.length} ledger versions replayed; ${Object.keys(fixes).length} flaps found; ${changed} ${apply ? 'repaired' : 'would be repaired'}, ${skipped} already changed since.`);
console.log('by false date:', JSON.stringify(Object.fromEntries(Object.entries(byDay).sort())));
console.log(sample.join('\n'));
if (apply) writeFileSync('data/arrivals.json', JSON.stringify(cur));
