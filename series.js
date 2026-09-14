/**
 * CLI for the web-series finder.
 *
 *   node series.js         series first aired in the last two years
 *   node series.js 400     same, capped at 400 detail calls
 *
 * Safe to re-run: every series checked is cached, misses included.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTmdbKey } from './src/tmdb.js';
import { LANGUAGES } from './src/snapshot.js';
import { findSeriesPlatforms } from './src/networks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(HERE, 'data', 'series.json');

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env');
  process.exit(1);
}

const budget = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 400);

// Two years. Older series are already well covered by the provider sweep, and
// the gap this closes is specifically recent web series.
const since = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

console.log(`Series first aired since ${since}, ${LANGUAGES.length} languages`);
console.log(`Budget ${budget} detail calls\n`);

const { cache, series, spent, found, total } = await findSeriesPlatforms({
  languages: LANGUAGES,
  since,
  budget,
  known: loadCache(),
  onProgress: ({ spent: s, found: f, title }) => {
    if (s % 40 === 0) console.log(`  ${s} checked, ${f} placed — at "${title}"`);
  },
});

mkdirSync(dirname(CACHE_PATH), { recursive: true });
writeFileSync(CACHE_PATH, JSON.stringify(cache));

const placed = Object.entries(cache).filter(([, v]) => v?.platform);
console.log(`\n${total} series found, ${spent} newly checked`);
console.log(`${placed.length} of ${Object.keys(cache).length} checked have a streaming platform\n`);

const byPlatform = {};
const byVia = {};
for (const [, v] of placed) {
  byPlatform[v.platform] = (byPlatform[v.platform] ?? 0) + 1;
  byVia[v.via] = (byVia[v.via] ?? 0) + 1;
}
for (const [p, n] of Object.entries(byPlatform).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p.padEnd(22)}${n}`);
}
console.log(`\n  via networks: ${byVia.network ?? 0} · via production company: ${byVia.company ?? 0}`);

const telugu = placed.filter(([, v]) => v.language === 'te').sort((a, b) => String(b[1].date).localeCompare(String(a[1].date)));
console.log(`\nNewest Telugu series placed (${telugu.length} total):`);
for (const [, v] of telugu.slice(0, 12)) {
  console.log(`  ${String(v.date ?? '?').padEnd(12)}${String(v.title).slice(0, 34).padEnd(36)}${v.platform}`);
}

console.log(`\nCached to ${CACHE_PATH}`);
console.log('Run "node publish.js" to fold these into the app feed.');
