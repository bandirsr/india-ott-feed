/**
 * CLI for the second robot — the platforms TMDB cannot see.
 *
 *   node gapfill.js        find and check every page naming an uncovered platform
 *   node gapfill.js 60     same, capped at 60 Wikipedia requests
 *
 * Safe to run repeatedly: every page checked is cached, including the ones with
 * nothing to report, so a second run resumes rather than restarting.
 *
 * The approach is search-first and that is the whole trick. Walking "List of
 * Telugu films of 2026" and opening all 315 entries cost two requests each to
 * find the dozen that mention ETV Win — a 140-request run found nothing because
 * it had not reached them. Wikipedia already knows which pages say "ETV Win";
 * asking it directly turns hundreds of requests into a few dozen.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTmdbKey } from './src/tmdb.js';
import { findPagesMentioning, sweepTitles, toFeedEntries, UNCOVERED_PLATFORMS } from './src/gapfill.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(HERE, 'data', 'gapfill.json');

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env — needed to match titles to the main catalogue.');
  process.exit(1);
}

const budget = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

console.log(`Filling gaps for: ${[...UNCOVERED_PLATFORMS].join(', ')}`);
console.log(`Budget ${budget} Wikipedia requests\n`);

let cache = loadCache();
let totalSpent = 0;

for (const platform of UNCOVERED_PLATFORMS) {
  if (totalSpent >= budget) break;

  const pages = await findPagesMentioning(platform);
  console.log(`"${platform}" is named on ${pages.length} Wikipedia pages`);

  const { found, spent, hits, errors, firstErrors } = await sweepTitles(pages, {
    budget: budget - totalSpent,
    seen: cache,
    year: platform,
    onProgress: ({ spent: s, hits: h, title }) => {
      if (s % 20 === 0) console.log(`  ${s} checked, ${h} found — at "${title}"`);
    },
  });

  cache = found;
  totalSpent += spent;
  console.log(`  ${spent} pages checked, ${hits} with a release to record`);

  if (errors > 0) {
    // Surfaced loudly. A silent catch here once turned a bug affecting every
    // single title into a run that cheerfully reported "0 found".
    console.log(`  ${errors} errors:`);
    for (const e of firstErrors) console.log(`    ${e}`);
  }
}

mkdirSync(dirname(CACHE_PATH), { recursive: true });
writeFileSync(CACHE_PATH, JSON.stringify(cache));

const { attach, standalone } = toFeedEntries(cache);
const checked = Object.keys(cache).length;
const withData = Object.values(cache).filter(Boolean).length;

console.log(`\n${checked} pages checked, ${withData} carry a release on an uncovered platform`);
console.log(`  ${attach.length} attach to a title the main sweep already has`);
console.log(`  ${standalone.length} are titles TMDB has never heard of`);

if (standalone.length > 0) {
  console.log('\n  Titles only this robot can see:');
  for (const s of standalone.slice(0, 15)) {
    console.log(`    ${String(s.arrived ?? 'date unknown').padEnd(14)}${s.title} — ${s.platform}`);
  }
}

console.log(`\nCached to ${CACHE_PATH}`);
console.log('Run "node publish.js" to fold these into the app feed.');
