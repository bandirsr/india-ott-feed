/**
 * CLI for title details — director, cast, synopsis, runtime, rating.
 *
 *   node details.js        fill in as many as the default budget allows
 *   node details.js 800    a bigger run
 *
 * Safe to re-run: every title checked is cached, including the sparse ones,
 * so a second run only pays for titles it has never seen. Details do not
 * change, so a title is never re-checked once answered.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTmdbKey } from './src/tmdb.js';
import { listSnapshots, load } from './src/snapshot.js';
import { enrichDetails } from './src/details.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(HERE, 'data', 'details.json');

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env');
  process.exit(1);
}

const budget = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 400);

const dates = listSnapshots();
if (dates.length === 0) {
  console.error('No snapshot yet. Run "node snapshot.js take" first.');
  process.exit(1);
}

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

const snapshot = load(dates[dates.length - 1]);
const titles = Object.entries(snapshot.titles).map(([key, rec]) => ({ key, title: rec.t, date: rec.d }));
const have = loadCache();

console.log(`${titles.length} titles, ${Object.keys(have).length} already detailed, budget ${budget}\n`);

const { cache, spent, added, remaining } = await enrichDetails(titles, { budget, have });

mkdirSync(dirname(CACHE_PATH), { recursive: true });
writeFileSync(CACHE_PATH, JSON.stringify(cache));

const entries = Object.values(cache).filter(Boolean);
const withDirector = entries.filter((e) => e.d).length;
const withCast = entries.filter((e) => e.c?.length).length;
const withOverview = entries.filter((e) => e.o).length;
const withRuntime = entries.filter((e) => e.r).length;
const withRating = entries.filter((e) => e.v).length;

console.log(`Checked ${spent}, ${added} came back with something`);
console.log(`${remaining} still unchecked — run again to continue\n`);
console.log(`Of ${entries.length} detailed titles:`);
console.log(`  director  ${withDirector}`);
console.log(`  cast      ${withCast}`);
console.log(`  synopsis  ${withOverview}`);
console.log(`  runtime   ${withRuntime}`);
console.log(`  rating    ${withRating}`);

const sample = Object.entries(cache).filter(([, v]) => v?.d && v?.c?.length)[0];
if (sample) {
  const [key, v] = sample;
  console.log(`\nExample (${key}):`);
  console.log(`  dir. ${v.d} · ${v.c.join(', ')}`);
  console.log(`  ${v.r ?? '?'} min · ${v.v ?? 'unrated'}${v.v ? `/10 from ${v.n} votes` : ''}`);
  if (v.o) console.log(`  ${v.o.slice(0, 120)}...`);
}

console.log(`\nCached to ${CACHE_PATH}`);
console.log('Run "node publish.js" to fold these into the app feed.');
