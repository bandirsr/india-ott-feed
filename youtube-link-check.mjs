/**
 * Is every trailer link we show still alive? A weekly re-check of ALL trailer keys: TMDB's, the YouTube
 * ones found for a film, and the per-language ones. 50 videos per call = 1 quota unit, so all ~6,000 links
 * cost about 120 units.
 *
 * audit-trailers.mjs checks a key once, ever (age restriction, removed). A link that works today can be
 * deleted, made private, stop allowing embedding or be blocked in India next month. This looks again at
 * every key not checked in the last 7 days and records:
 *   ok | gone (deleted/private) | age-restricted | unembeddable | region-blocked (blocked in India)
 * Anything not ok goes into data/blocked-trailers.json (publish.js never shows those and falls back to the next
 * trailer for that film); a key that comes back to ok leaves the list again.
 *
 *   node youtube-link-check.mjs          check and write
 *   node youtube-link-check.mjs --dry    check, print counts, write nothing
 * Never fails the sweep.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.YOUTUBE_API_KEY;
const DRY = process.argv.includes('--dry');
const RECHECK_DAYS = 7;
const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) : d);
if (!KEY) { console.log('youtube-link-check: no YOUTUBE_API_KEY, skipped'); process.exit(0); }

try {
  const keys = new Set();
  for (const rec of Object.values(read('data/trailers.json', {}))) for (const k of Object.values(rec ?? {})) if (typeof k === 'string') keys.add(k);
  for (const rec of Object.values(read('data/youtube-trailers.json', {}))) if (rec?.key) keys.add(rec.key);
  for (const rec of Object.values(read('data/youtube-trailers-lang.json', {}))) if (rec?.key) keys.add(rec.key);

  const safety = read('data/trailer-safety.json', {}); // key -> status, shared with audit-trailers.mjs
  const when = read('data/trailer-links.json', {}); // key -> date last checked
  const today = new Date().toISOString().slice(0, 10);
  const due = [...keys].filter((k) => !(k in when) || (Date.parse(today) - Date.parse(when[k])) / 86_400_000 >= RECHECK_DAYS);
  console.log(`youtube-link-check: ${keys.size} trailer links, ${due.length} due for a check (${Math.ceil(due.length / 50)} units)`);

  const tally = {};
  for (let i = 0; i < due.length; i += 50) {
    const batch = due.slice(i, i + 50);
    const u = new URL('https://www.googleapis.com/youtube/v3/videos');
    u.search = new URLSearchParams({ part: 'contentDetails,status', id: batch.join(','), key: KEY }).toString();
    const r = await fetch(u);
    if (!r.ok) { console.log(`videos.list failed: ${r.status}; stopping, the rest is retried next run`); break; }
    const items = new Map(((await r.json()).items ?? []).map((v) => [v.id, v]));
    for (const k of batch) {
      const v = items.get(k);
      let s = 'ok';
      if (!v) s = 'gone';
      else if (v.status?.privacyStatus === 'private') s = 'gone';
      else if (v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') s = 'age-restricted';
      else if (v.status?.embeddable === false) s = 'unembeddable';
      else {
        const rr = v.contentDetails?.regionRestriction;
        if (rr?.blocked?.includes('IN') || (rr?.allowed && !rr.allowed.includes('IN'))) s = 'region-blocked';
      }
      tally[s] = (tally[s] ?? 0) + (safety[k] === s ? 0 : 1);
      safety[k] = s;
      when[k] = today;
    }
  }
  console.log('  changed or new:', JSON.stringify(tally));
  const bad = Object.entries(safety).filter(([, v]) => v !== 'ok').map(([k]) => k);
  console.log(`  ${bad.length} links blocked in total`);
  if (!DRY) {
    writeFileSync('data/trailer-safety.json', JSON.stringify(safety));
    writeFileSync('data/trailer-links.json', JSON.stringify(when));
    writeFileSync('data/blocked-trailers.json', JSON.stringify(bad));
  }
} catch (e) {
  console.log('youtube-link-check skipped:', e.message);
}
