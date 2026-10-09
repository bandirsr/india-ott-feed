/**
 * CLI for the third robot -- see src/wikilang.js for the why.
 *
 *   node wikilang.js          check up to 300 Wikipedia pages
 *   node wikilang.js 600      same, with a larger budget (first run)
 *
 * Resumable: every page checked is cached, including the ones with nothing to
 * report, and a page is looked at again only after REFRESH_DAYS, since editors
 * add the streaming line later. Writes data/wikilang.json (the cache) and
 * data/wiki-releases.json (what src/fresh.js's news step merges).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTmdbKey } from './src/tmdb.js';
import { getExtract, rawCall } from './src/wikipedia.js';
import { titlesFromWikitext, matchToTmdb } from './src/gapfill.js';
import { LANGUAGES, YEARS, streamingRows, recordsFromCache } from './src/wikilang.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(HERE, 'data', 'wikilang.json');
const OUT = resolve(HERE, 'data', 'wiki-releases.json');
const REFRESH_DAYS = 14;

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY -- needed to match titles to the catalogue.');
  process.exit(1);
}

const budget = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);
const DAY = 86_400_000;

function load() {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

// Temp file and rename, so an interrupted write cannot leave a truncated cache.
function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

const cache = load();
let spent = 0;
let hits = 0;
let errors = 0;
const firstErrors = [];

/** Work list: never-checked pages first, then the stalest. */
const work = [];
for (const lang of LANGUAGES) {
  for (const year of YEARS) {
    if (spent >= budget) break;
    let wikitext = '';
    try {
      const j = await rawCall({ action: 'parse', page: `List of ${lang.name} films of ${year}`, prop: 'wikitext', redirects: 1 });
      wikitext = j.parse?.wikitext ?? '';
    } catch (e) {
      // A year with no list page yet (Punjabi 2026, say) is normal, not an error.
      if (/missingtitle/.test(e.message)) console.log(`  no list page: List of ${lang.name} films of ${year}`);
      else {
        errors += 1;
        firstErrors.push(`list ${lang.name} ${year}: ${e.message}`);
      }
    }
    spent += 1;
    for (const title of titlesFromWikitext(wikitext)) {
      const key = `${lang.code}|${year}|${title}`;
      const checkedAt = cache[key]?.checkedAt ? Date.parse(cache[key].checkedAt) : 0;
      if (checkedAt && Date.now() - checkedAt < REFRESH_DAYS * DAY) continue;
      work.push({ key, lang, title, checkedAt });
    }
  }
}
work.sort((a, b) => a.checkedAt - b.checkedAt);
console.log(`${work.length} pages due for a check; budget ${budget} requests (${spent} already spent on list pages)\n`);

let sinceSave = 0;
for (const w of work) {
  if (spent >= budget) break;
  try {
    const article = await getExtract(w.title);
    spent += 1;
    const rows = article ? streamingRows(article.text, w.lang.name) : [];
    if (rows.length === 0) {
      cache[w.key] = { checkedAt: new Date().toISOString(), rows: null };
    } else {
      const tmdb = await matchToTmdb(article.title, { language: w.lang.code });
      cache[w.key] = {
        checkedAt: new Date().toISOString(),
        wikiTitle: article.title,
        language: w.lang.name,
        tmdb,
        rows: rows.map((r) => ({ platform: r.platform, date: r.date, evidence: r.evidence })),
      };
      if (tmdb) {
        hits += 1;
        console.log(`  ${w.lang.name.padEnd(9)} ${tmdb.title} -> ${rows.map((r) => `${r.platform} ${r.date}`).join(', ')}`);
      }
    }
  } catch (err) {
    // Left uncached: a transient Wikipedia/TMDB error must not mark a film as
    // having nothing. Counted and reported so it cannot look like a real "0".
    spent += 1;
    errors += 1;
    if (firstErrors.length < 3) firstErrors.push(`${w.title}: ${err.message}`);
  }
  if (++sinceSave >= 40) {
    save(CACHE, cache);
    sinceSave = 0;
  }
}

save(CACHE, cache);
const records = recordsFromCache(cache);
save(OUT, records);

const matchedFilms = Object.values(cache).filter((e) => e?.tmdb).length;
console.log(`\nChecked ${spent} requests: ${hits} films with streaming lines found this run, ${matchedFilms} matched to TMDB overall, ${errors} errors.`);
for (const e of firstErrors) console.log(`  error: ${e}`);
console.log(`Wrote ${records.length} release records to ${OUT}`);
