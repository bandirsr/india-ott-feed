/**
 * Is every trailer we show safe to show?
 *
 * Asks YouTube about each trailer key we hold (TMDB's and our own finds):
 * 50 keys per call, 1 quota unit per call. A video that is age-restricted
 * (YouTube's own mature-content flag) is added to data/blocked-trailers.json,
 * which publish.js honours, so it never reaches the app. Results are cached in
 * data/trailer-safety.json, so a daily run only checks keys it has not seen.
 *
 *   node audit-trailers.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.YOUTUBE_API_KEY || readEnv('YOUTUBE_API_KEY');
function readEnv(name) {
  if (!existsSync('.env')) return null;
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : null;
}
if (!KEY) {
  console.log('No YOUTUBE_API_KEY -- trailer safety audit skipped.');
  process.exit(0);
}

const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const tmdb = read('data/trailers.json', {});
const yt = read('data/youtube-trailers.json', {});
const checked = read('data/trailer-safety.json', {});

const keys = new Set();
for (const rec of Object.values(tmdb)) for (const k of Object.values(rec ?? {})) if (typeof k === 'string') keys.add(k);
for (const rec of Object.values(yt)) if (rec?.key) keys.add(rec.key);

const todo = [...keys].filter((k) => !(k in checked));
console.log(`${keys.size} trailer keys, ${todo.length} not yet checked.`);

let restricted = 0;
let gone = 0;
for (let i = 0; i < todo.length; i += 50) {
  const batch = todo.slice(i, i + 50);
  const u = new URL('https://www.googleapis.com/youtube/v3/videos');
  u.search = new URLSearchParams({ part: 'contentDetails,status', id: batch.join(','), key: KEY }).toString();
  const r = await fetch(u);
  if (!r.ok) {
    console.log(`videos.list failed: ${r.status} (stopping; unchecked keys are retried next run)`);
    break;
  }
  const items = new Map(((await r.json()).items ?? []).map((v) => [v.id, v]));
  for (const k of batch) {
    const v = items.get(k);
    if (!v) {
      checked[k] = 'gone'; // deleted or private: the app could not play it anyway
      gone += 1;
    } else if (v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') {
      checked[k] = 'age-restricted';
      restricted += 1;
    } else {
      checked[k] = 'ok';
    }
  }
}
writeFileSync('data/trailer-safety.json', JSON.stringify(checked));
const blocked = Object.entries(checked).filter(([, v]) => v !== 'ok').map(([k]) => k);
writeFileSync('data/blocked-trailers.json', JSON.stringify(blocked));
console.log(`Checked ${todo.length}: ${restricted} age-restricted, ${gone} gone. ${blocked.length} keys blocked in total.`);
