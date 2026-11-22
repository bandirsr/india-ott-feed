/**
 * Trailers in the viewer's own language for dubbed titles, found on YouTube.
 *
 * dub-trailers.mjs asks TMDB first (free). What TMDB has no trailer for in that
 * language is searched here: "<title> <year> Telugu trailer". Newest films
 * first, across all languages, until the day's budget is spent. A search costs
 * 100 quota units, so BUDGET 50 = 5,000 units.
 *
 * A result is accepted only by the same strict rules as youtube-trailers.mjs
 * (title leads the video name, says trailer/teaser, not a reaction, same year)
 * AND the video title or channel must name the language, otherwise it is most
 * likely the original-language trailer we already show. Everything accepted
 * records the video title and channel, so a bad match can be found and removed.
 *
 *   node youtube-dub-trailers.mjs 50      up to 50 searches
 *   node youtube-dub-trailers.mjs --dry   show the queue, no calls
 * Never fails the sweep: no key, quota gone or errors all exit 0.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { accept, decode, norm } from './src/youtube-match.js';

const KEY = process.env.YOUTUBE_API_KEY;
const FEED = process.env.FEED_BASE || 'https://bandirsr.github.io/india-ott-feed';
const TR = 'data/trailers.json';
const OUT = 'data/youtube-trailers-lang.json';
const DRY = process.argv.includes('--dry');
const BUDGET = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 50);
const RETRY_AFTER_DAYS = 45;
const NAMES = { te: 'Telugu', hi: 'Hindi', ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati' };
const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) : d);

if (!KEY && !DRY) {
  console.log('youtube-dub-trailers: no YOUTUBE_API_KEY, skipped');
  process.exit(0);
}

async function search(p) {
  const q = `${p.title} ${p.year ?? ''} ${NAMES[p.code]} trailer`.replace(/\s+/g, ' ').trim();
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '5', q, regionCode: 'IN',
    relevanceLanguage: p.code, videoEmbeddable: 'true', safeSearch: 'strict', key: KEY,
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

try {
  const tr = read(TR, {});
  const done = read(OUT, {});
  const today = new Date().toISOString().slice(0, 10);
  const stale = (e) => e && !e.key && (Date.parse(today) - Date.parse(e.checkedOn)) / 86_400_000 >= RETRY_AFTER_DAYS;

  const todo = [];
  for (const code of Object.keys(NAMES)) {
    const res = await fetch(`${FEED}/v1/${code}.json?t=${Date.now()}`);
    if (!res.ok) continue;
    for (const e of (await res.json()).titles ?? []) {
      if (e.k !== 'movie' || !e.ol) continue; // dubbed / also-in rows only
      if (tr[e.id]?.[code]) continue; // TMDB already has it
      const k = `${e.id}|${code}`;
      if (k in done && !stale(done[k])) continue; // asked already
      todo.push({ k, code, title: e.t, year: e.d ? Number(e.d.slice(0, 4)) : null, d: e.d ?? '' });
    }
  }
  todo.sort((a, b) => b.d.localeCompare(a.d));
  console.log(`youtube-dub-trailers: ${todo.length} dubbed title/language pairs to search; budget ${BUDGET} searches (${BUDGET * 100} units)`);
  if (DRY) {
    for (const p of todo.slice(0, 30)) console.log(`  would search: ${p.title} ${p.year ?? ''} ${NAMES[p.code]} trailer`);
    process.exit(0);
  }

  const save = () => {
    writeFileSync(`${OUT}.tmp`, JSON.stringify(done));
    renameSync(`${OUT}.tmp`, OUT);
  };
  let spent = 0;
  let found = 0;
  for (const p of todo) {
    if (spent >= BUDGET) break;
    try {
      const { q, items } = await search(p);
      spent += 1;
      let hit = null;
      for (const v of items) {
        const verdict = accept({ title: p.title, year: p.year }, v);
        const names = norm(`${decode(v.title)} ${v.channel}`).split(' ').includes(norm(NAMES[p.code]));
        if (verdict.ok && names) {
          hit = { key: v.key, videoTitle: decode(v.title), channel: v.channel, confidence: verdict.confidence };
          break;
        }
      }
      done[p.k] = hit ? { ...hit, query: q, checkedOn: today } : { key: null, query: q, checkedOn: today };
      if (hit) {
        found += 1;
        console.log(`  + ${p.title.slice(0, 30).padEnd(32)} ${p.code} ${hit.videoTitle.slice(0, 60)}`);
      }
    } catch (e) {
      if (e.quota) {
        console.log('Quota exhausted; stopping. Everything found so far is saved.');
        break;
      }
      spent += 1;
      console.log(`  ! ${p.title}: ${e.message}`);
    }
    if (spent % 10 === 0) save();
  }
  save();
  console.log(`youtube-dub-trailers: searched ${spent}, accepted ${found}, ${Math.max(0, todo.length - spent)} left for later days`);
} catch (e) {
  console.log('youtube-dub-trailers skipped:', e.message);
}
