/**
 * CLI for India digital release dates.
 *
 *   node digital.js        the default budget
 *   node digital.js 3000   a bigger run, e.g. the first backfill
 *
 * Safe to re-run: answered titles are cached. See src/digital.js for what the
 * date means and when a "none" is asked again.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTmdbKey } from './src/tmdb.js';
import { listSnapshots, load } from './src/snapshot.js';
import { enrichDigital } from './src/digital.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(HERE, 'data', 'digital.json');

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env');
  process.exit(1);
}

const budget = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 600);

const dates = listSnapshots();
if (dates.length === 0) {
  console.error('No snapshot yet. Run "node snapshot.js take" first.');
  process.exit(1);
}

const have = existsSync(CACHE_PATH)
  ? (() => {
      try {
        return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
      } catch {
        return {};
      }
    })()
  : {};

const snapshot = load(dates[dates.length - 1]);
const titles = Object.entries(snapshot.titles).map(([key, rec]) => ({ key, title: rec.t, date: rec.d }));

console.log(`${titles.length} titles, ${Object.keys(have).length} already checked, budget ${budget}\n`);

mkdirSync(dirname(CACHE_PATH), { recursive: true });
const save = (data) => {
  const tmp = `${CACHE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, CACHE_PATH);
};

let lastReport = 0;
const { cache, spent, found, remaining } = await enrichDigital(titles, {
  budget,
  have,
  onSave: save,
  onProgress: ({ spent: n, found: f }) => {
    if (n - lastReport >= 500) {
      lastReport = n;
      console.log(`  ${n} checked, ${f} with a digital date — saved`);
    }
  },
});
save(cache);

const withDate = Object.values(cache).filter((e) => e?.g).length;
console.log(`\nChecked ${spent} this run, ${found} had a date. Cache: ${withDate} of ${Object.keys(cache).length} titles have one. ${remaining} left to check.`);
