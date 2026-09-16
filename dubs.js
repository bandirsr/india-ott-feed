/**
 * CLI for the dub finder.
 *
 *   node dubs.js          check candidates from today's snapshot
 *   node dubs.js 150      same, capped at 150 TMDB detail calls
 *
 * Safe to re-run: every film checked is cached, including the ones with no
 * dub, so a second run only pays for titles it has never seen. Saves as it
 * goes, every 100 checks, so an interrupted run keeps its work.
 *
 * Candidates come from the LATEST LOCAL SNAPSHOT, not a fresh TMDB search --
 * see src/dubs.js for why: the old search found 50 candidates, ever; the
 * snapshot already holds thousands. Run this after `snapshot.js take` on the
 * same day, same as details.js and series.js.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTmdbKey } from './src/tmdb.js';
import { resolveProviders, PLATFORM_LANGUAGE, LANGUAGES, listSnapshots, load } from './src/snapshot.js';
import { findDubs, DUB_SOURCE_LANGUAGES } from './src/dubs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(HERE, 'data', 'dubs.json');

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env');
  process.exit(1);
}

const budget = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);
const NAME = new Map(LANGUAGES.map((l) => [l.code, l.name]));

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

const dates = listSnapshots();
if (dates.length === 0) {
  console.log('No snapshot yet. Run "node snapshot.js take" first.');
  process.exit(1);
}
const snapshot = load(dates[dates.length - 1]);

const { providers } = await resolveProviders();

/**
 * Only the multi-language platforms. The single-language ones are already
 * handled in the sweep itself — everything on aha is Telugu by definition, and
 * asking TMDB about each of those titles would be paying for an answer we
 * already have.
 */
const multi = providers.filter((p) => !PLATFORM_LANGUAGE[p.name]);
const multiLangProviderIds = new Set(multi.map((p) => p.id));

console.log(`Snapshot ${dates[dates.length - 1]}: ${Object.keys(snapshot.titles).length} titles`);
console.log(`${multi.length} multi-language platforms tracked`);
console.log(`Budget ${budget} detail calls\n`);

const known = loadCache();

// Temp file and rename, so an interrupted write cannot leave a truncated
// cache -- losing the file would be worse than losing the run.
const save = (data) => {
  const tmp = `${CACHE_PATH}.tmp`;
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, CACHE_PATH);
};

let lastReport = 0;
const { cache, candidates, spent, dubbed, unchecked } = await findDubs({
  snapshot,
  multiLangProviderIds,
  known,
  budget,
  onSave: save,
  onProgress: ({ spent: s, dubbed: d }) => {
    if (s - lastReport >= 100) {
      lastReport = s;
      console.log(`  ${s} checked, ${d} dubbed — saved`);
    }
  },
});

save(cache);

console.log(`\n${candidates.size} Tamil/Malayalam/Kannada/Hindi films already on a multi-language platform`);
console.log(`${spent} newly checked, ${unchecked} still unchecked`);

const hits = Object.entries(cache).filter(([, v]) => v?.length);
console.log(`\n${hits.length} of ${Object.keys(cache).length} checked films carry another Indian language\n`);

const byLang = {};
for (const [, langs] of hits) for (const l of langs) byLang[l] = (byLang[l] ?? 0) + 1;
for (const [code, n] of Object.entries(byLang).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(NAME.get(code) ?? code).padEnd(12)} ${n}`);
}

console.log('\nExamples:');
for (const [key, langs] of hits.slice(0, 12)) {
  const film = candidates.get(key);
  console.log(`  ${String(film?.title ?? key).slice(0, 34).padEnd(36)}${film?.original} -> ${langs.join(', ')}`);
}

console.log(`\nCached to ${CACHE_PATH}`);
console.log('Run "node publish.js" to fold these into the app feed.');
