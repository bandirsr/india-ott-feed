/**
 * Trailers TMDB does not have, found on YouTube.
 *
 * TMDB is the first source and it is exhausted for about half the catalogue:
 * re-asking it across eleven language views filled 1 of the 69 missing
 * trailers in the newest-20 lists. What remains has no video record on TMDB at
 * all. Most of those trailers exist -- on the studio's or music label's YouTube
 * channel -- they were just never linked.
 *
 * The constraint is quota, not access. YouTube's search call is expensive
 * against the default daily allowance, which works out to roughly a hundred
 * searches a day. So this is a daily pass on a budget, not a backfill: the
 * newest films in each language first, then the back catalogue, a few dozen a
 * day until it is done.
 *
 * The risk is matching, and the rules below exist because of it. Searching
 * "<title> <year> trailer" and taking the top hit returns fan edits, reaction
 * videos and the wrong film with the same name. A result is only accepted when
 * its video title contains the film's title AND says trailer or teaser, and
 * does not name a different year. Everything accepted records the video title
 * and channel it matched on, so a bad match can be found and removed rather
 * than silently published.
 *
 * Needs YOUTUBE_API_KEY. Without one it prints how to add it and exits 0, so
 * the daily workflow does not fail while the key does not exist yet.
 *
 *   node youtube-trailers.mjs              up to 90 searches
 *   node youtube-trailers.mjs 40           up to 40
 *   node youtube-trailers.mjs --dry        show what it would search, no calls
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { accept, decode } from './src/youtube-match.js';

const KEY = process.env.YOUTUBE_API_KEY || readEnv('YOUTUBE_API_KEY');
const FEED = 'https://bandirsr.github.io/india-ott-feed';
const TMDB_CACHE = 'data/trailers.json';
const YT_CACHE = 'data/youtube-trailers.json';
const DRY = process.argv.includes('--dry');
const budgetArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
// Ninety, not a hundred: leaves headroom so a rerun on the same day does not
// hit the quota wall halfway through a title.
const BUDGET = Number(budgetArg ?? 90);
// Days before a "found nothing" is worth asking about again. Trailers do get
// uploaded late, but not often enough to spend quota re-asking weekly.
const RETRY_AFTER_DAYS = 45;

const LANGUAGE_NAME = { te: 'Telugu', hi: 'Hindi', ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati' };

function readEnv(name) {
  if (!existsSync('.env')) return null;
  const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : null;
}

async function search(film) {
  const q = `${film.title} ${film.year ?? ''} ${LANGUAGE_NAME[film.lang] ?? ''} trailer`.replace(/\s+/g, ' ').trim();
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '5',
    q,
    regionCode: 'IN',
    relevanceLanguage: film.lang,
    videoEmbeddable: 'true',
    key: KEY,
  });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (r.status === 403) {
    const body = await r.text();
    if (/quota/i.test(body)) throw Object.assign(new Error('quota exhausted'), { quota: true });
    throw new Error(`403: ${body.slice(0, 120)}`);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return { q, items: (j.items ?? []).map((i) => ({ key: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle })) };
}

// ---------------------------------------------------------------------------

if (!KEY && !DRY) {
  console.log('No YOUTUBE_API_KEY, so the YouTube trailer pass is skipped.');
  console.log('To turn it on: Google Cloud Console -> new project -> enable "YouTube Data API v3"');
  console.log('-> Credentials -> Create API key, then add it as the repo secret YOUTUBE_API_KEY.');
  process.exit(0);
}

const get = async (path) => {
  const r = await fetch(`${FEED}/${path}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};

const tmdb = existsSync(TMDB_CACHE) ? JSON.parse(readFileSync(TMDB_CACHE, 'utf8')) : {};
const yt = existsSync(YT_CACHE) ? JSON.parse(readFileSync(YT_CACHE, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const stale = (entry) =>
  entry && !entry.key && (Date.parse(today) - Date.parse(entry.checkedOn)) / 86_400_000 >= RETRY_AFTER_DAYS;

// Newest first in every language, interleaved so one language cannot spend
// the whole day's budget before another gets a turn.
const manifest = await get('manifest.json');
const queues = [];
for (const lang of manifest.languages) {
  const p = await get(lang.path);
  queues.push(
    p.titles
      .filter((t) => t.k === 'movie' && !t.y)
      .filter((t) => !tmdb[t.id] || Object.keys(tmdb[t.id] ?? {}).length === 0)
      .filter((t) => !(t.id in yt) || stale(yt[t.id]))
      .map((t) => ({ id: t.id, title: t.t, year: t.d ? Number(t.d.slice(0, 4)) : null, lang: lang.code }))
  );
}
const order = [];
const seen = new Set();
for (let i = 0; queues.some((q) => i < q.length); i++) {
  for (const q of queues) {
    const f = q[i];
    if (f && !seen.has(f.id)) {
      seen.add(f.id);
      order.push(f);
    }
  }
}

console.log(`${order.length} films with no trailer anywhere yet; budget ${BUDGET} searches today.\n`);

if (DRY) {
  for (const f of order.slice(0, Math.min(BUDGET, 30))) {
    console.log(`  would search: ${f.title} ${f.year ?? ''} ${LANGUAGE_NAME[f.lang]} trailer`);
  }
  process.exit(0);
}

let spent = 0;
let found = 0;
const save = () => {
  writeFileSync(`${YT_CACHE}.tmp`, JSON.stringify(yt, null, 0));
  renameSync(`${YT_CACHE}.tmp`, YT_CACHE);
};

for (const film of order) {
  if (spent >= BUDGET) break;
  try {
    const { q, items } = await search(film);
    spent += 1;
    let hit = null;
    for (const v of items) {
      const verdict = accept(film, v);
      if (verdict.ok) {
        hit = { key: v.key, videoTitle: decode(v.title), channel: v.channel, confidence: verdict.confidence };
        break;
      }
    }
    yt[film.id] = hit ? { ...hit, query: q, checkedOn: today } : { key: null, query: q, checkedOn: today };
    if (hit) {
      found += 1;
      console.log(`  + ${film.title.slice(0, 32).padEnd(34)} ${hit.confidence.padEnd(6)} ${hit.videoTitle.slice(0, 60)}`);
    }
  } catch (e) {
    if (e.quota) {
      console.log('\nQuota exhausted for today; stopping. Everything found so far is saved.');
      break;
    }
    spent += 1;
    console.log(`  ! ${film.title}: ${e.message}`);
  }
  if (spent % 10 === 0) save();
}
save();

console.log(`\nSearched ${spent}, accepted ${found}. ${Math.max(0, order.length - spent)} still to search on later days.`);
