/**
 * Every language's newest films should have a trailer.
 *
 * The main trailer pass checks each title once and caches the answer --
 * including "no trailer". That is right for the back catalogue and wrong for
 * new releases: a film added the week it hits a platform often has no video on
 * TMDB yet, the trailer is uploaded a few days later, and the cached "none"
 * means we never look again. The newest titles are exactly the ones people
 * open, and exactly the ones most likely to be stale.
 *
 * So this re-asks about the newest N films per language whatever the cache
 * says, and asks more widely than the main pass: TMDB's default, English, and
 * all nine Indian languages, not only the languages the title is listed under.
 * A Telugu film whose only trailer TMDB has tagged Hindi still gets it.
 *
 *   node top-trailers.mjs              count the gaps, change nothing
 *   node top-trailers.mjs --fill       re-query the gaps and update the cache
 *   node top-trailers.mjs --n 30       look at the newest 30 instead of 20
 *
 * Reads the LIVE feed to decide what is "newest", because that is the order a
 * reader sees.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { loadTmdbKey, rawCall } from './src/tmdb.js';
import { pickBest, VIDEO_LANGUAGES } from './src/trailers.js';

const FEED = 'https://bandirsr.github.io/india-ott-feed';
const CACHE = 'data/trailers.json';
const argN = process.argv.indexOf('--n');
const N = argN > 0 ? Number(process.argv[argN + 1]) : 20;
const FILL = process.argv.includes('--fill');

const get = async (path) => {
  const r = await fetch(`${FEED}/${path}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};

const manifest = await get('manifest.json');
const perLanguage = [];
for (const lang of manifest.languages) {
  const p = await get(lang.path);
  // Feed order is newest first, which is the order the app shows.
  const newest = p.titles.filter((t) => t.k === 'movie').slice(0, N);
  perLanguage.push({
    name: p.languageName,
    code: lang.code,
    newest,
    missing: newest.filter((t) => !t.y),
  });
}

console.log(`\nNewest ${N} films per language, feed ${manifest.version}\n`);
console.log('  language     have  missing');
for (const l of perLanguage) {
  console.log(`  ${l.name.padEnd(12)} ${String(l.newest.length - l.missing.length).padStart(4)}  ${String(l.missing.length).padStart(7)}`);
}
const allMissing = [...new Map(perLanguage.flatMap((l) => l.missing).map((t) => [t.id, t])).values()];
console.log(`  ${'TOTAL'.padEnd(12)} ${''.padStart(4)}  ${String(perLanguage.reduce((a, l) => a + l.missing.length, 0)).padStart(7)}  (${allMissing.length} distinct films)`);

if (!FILL) {
  console.log('\nDry run. Pass --fill to re-query these.');
  process.exit(0);
}

loadTmdbKey();
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const found = new Set();

for (const t of allMissing) {
  const [kind, id] = t.id.split(':');
  const pool = [];
  // Default, then English, then every Indian language -- not just the ones the
  // title is filed under, which is the main pass's blind spot.
  const asks = [null, 'en-US', ...VIDEO_LANGUAGES.map((c) => `${c}-IN`)];
  for (const language of asks) {
    try {
      const j = await rawCall(`/${kind}/${id}/videos`, language ? { language } : {});
      pool.push(...(j.results ?? []));
    } catch {
      // One language failing must not lose the others.
    }
  }

  const unique = [...new Map(pool.map((v) => [v.key, v])).values()];
  const entry = {};
  const any = pickBest(unique);
  if (any) entry._ = any;
  for (const code of [...VIDEO_LANGUAGES, 'en']) {
    const k = pickBest(unique.filter((v) => v.iso_639_1 === code));
    if (k) entry[code] = k;
  }

  if (Object.keys(entry).length > 0) {
    cache[t.id] = entry;
    found.add(t.id);
  }
}

const tmp = `${CACHE}.tmp`;
writeFileSync(tmp, JSON.stringify(cache));
renameSync(tmp, CACHE);

console.log(`\nRe-queried ${allMissing.length} films across ${asks_count()} TMDB language views each.\n`);
console.log('  language     missing  filled  still missing');
let totalFilled = 0;
let totalStill = 0;
for (const l of perLanguage) {
  const filled = l.missing.filter((t) => found.has(t.id)).length;
  totalFilled += filled;
  totalStill += l.missing.length - filled;
  console.log(`  ${l.name.padEnd(12)} ${String(l.missing.length).padStart(7)}  ${String(filled).padStart(6)}  ${String(l.missing.length - filled).padStart(13)}`);
}
console.log(`  ${'TOTAL'.padEnd(12)} ${String(totalFilled + totalStill).padStart(7)}  ${String(totalFilled).padStart(6)}  ${String(totalStill).padStart(13)}`);

const still = allMissing.filter((t) => !found.has(t.id));
if (still.length > 0) {
  console.log('\nStill no trailer anywhere on TMDB:');
  for (const t of still) console.log(`  ${t.t}  (${t.d ?? '?'})`);
}
console.log('\nCache updated. Run "node publish.js" (or the workflow) to put these in the feed.');

function asks_count() {
  return 2 + VIDEO_LANGUAGES.length;
}
