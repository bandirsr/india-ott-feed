/**
 * Trailers in the viewer's own language, found by reading label channels' upload lists
 * instead of searching. A playlist page of 50 videos costs 1 quota unit, where a search costs
 * one of the 100 searches a day (and finds one title). This spends the spare units.
 *
 * 1. Seeds: the channels that already published trailers we use (TMDB's per-language keys and
 *    every earlier YouTube match), found with videos.list (1 unit per 50 videos).
 * 2. Scan: each channel's uploads, newest first, a few pages a day each, resuming where the last
 *    run stopped. Every video is checked against the dubbed title/language pairs still without a
 *    trailer, with the same strict rule as the searches (title leads the video name, says
 *    trailer/teaser, not a reaction, same year) AND the video title or channel names the language.
 * 3. A match is written to data/youtube-trailers-lang.json, with the video title and channel so a
 *    bad one can be removed. Misses write nothing, so the searches still try those pairs.
 *
 *   node youtube-channel-scan.mjs 7000     spend up to 7,000 units
 *   node youtube-channel-scan.mjs --dry    show the queue, no calls
 * Never fails the sweep: no key, quota gone or errors all exit 0.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { accept, decode, norm } from './src/youtube-match.js';

const KEY = process.env.YOUTUBE_API_KEY;
const FEED = process.env.FEED_BASE || 'https://bandirsr.github.io/india-ott-feed';
const TR = 'data/trailers.json';
const YT = 'data/youtube-trailers.json';
const OUT = 'data/youtube-trailers-lang.json';
const STATE = 'data/youtube-channel-scan.json';
const DRY = process.argv.includes('--dry');
const BUDGET = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 7000);
const PAGES_PER_CHANNEL = 12; // 600 videos a channel a run, so one channel cannot eat the day
const RESCAN_DAYS = 7;
const NAMES = { te: 'Telugu', hi: 'Hindi', ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati' };
const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) : d);
const FOLLOWS = new Set(['official', 'trailer', 'teaser', 'movie', 'film', 'full', 'new', 'final', 'glimpse', 'dubbed', 'hd', 'telugu', 'hindi', 'tamil', 'malayalam', 'kannada', 'bengali', 'marathi', 'punjabi', 'gujarati']);
const PREFIX = /^((official|new|latest|hd|full|movie|film|trailer|teaser)\s+)+/;

if (!KEY && !DRY) {
  console.log('youtube-channel-scan: no YOUTUBE_API_KEY, skipped');
  process.exit(0);
}

let spent = 0;
async function api(path, params) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: KEY })}`);
  spent += 1;
  if (r.status === 403) {
    const body = await r.text();
    if (/quota/i.test(body)) throw Object.assign(new Error('quota exhausted'), { quota: true });
    throw new Error(`403: ${body.slice(0, 120)}`);
  }
  if (r.status === 404) return { items: [], notFound: true };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

try {
  const tr = read(TR, {});
  const yt = read(YT, {});
  const done = read(OUT, {});
  const st = read(STATE, { channels: {}, seen: {} });
  const today = new Date().toISOString().slice(0, 10);

  // The dubbed title/language pairs still without a trailer.
  const pairs = [];
  for (const code of Object.keys(NAMES)) {
    const res = await fetch(`${FEED}/v1/${code}.json?t=${Date.now()}`);
    if (!res.ok) continue;
    for (const e of (await res.json()).titles ?? []) {
      if (e.k !== 'movie' || !e.ol) continue;
      if (tr[e.id]?.[code]) continue;
      const k = `${e.id}|${code}`;
      if (done[k]?.key) continue;
      pairs.push({ k, code, title: e.t, year: e.d ? Number(e.d.slice(0, 4)) : null });
    }
  }
  const byFirst = new Map(); // first word of the normalized title -> pairs
  for (const p of pairs) {
    const w = norm(p.title).split(' ')[0];
    if (!w) continue;
    if (!byFirst.has(w)) byFirst.set(w, []);
    byFirst.get(w).push(p);
  }
  console.log(`youtube-channel-scan: ${pairs.length} dubbed pairs without a trailer; budget ${BUDGET} units`);

  // Video ids of trailers we already use, to learn their channels.
  const seedIds = new Set();
  for (const v of Object.values(tr)) for (const [c, k] of Object.entries(v ?? {})) if (c !== '_' && typeof k === 'string') seedIds.add(k);
  for (const v of Object.values(yt)) if (v?.key) seedIds.add(v.key);
  for (const v of Object.values(done)) if (v?.key) seedIds.add(v.key);
  const unseen = [...seedIds].filter((id) => !(id in st.seen));
  console.log(`  ${seedIds.size} known trailer videos, ${unseen.length} not yet traced to a channel, ${Object.keys(st.channels).length} channels known`);
  if (DRY) process.exit(0);

  const save = () => {
    writeFileSync(`${STATE}.tmp`, JSON.stringify(st));
    renameSync(`${STATE}.tmp`, STATE);
    writeFileSync(`${OUT}.tmp`, JSON.stringify(done));
    renameSync(`${OUT}.tmp`, OUT);
  };
  globalThis.__save = save;

  // 1. Trace seeds to channels (1 unit per 50 videos; at most a quarter of the budget).
  for (let i = 0; i < unseen.length && spent < BUDGET / 4; i += 50) {
    const batch = unseen.slice(i, i + 50);
    const j = await api('videos', { part: 'snippet', id: batch.join(','), maxResults: '50' });
    const got = new Set();
    for (const v of j.items ?? []) {
      got.add(v.id);
      const cid = v.snippet.channelId;
      st.seen[v.id] = cid;
      const c = (st.channels[cid] ??= { title: v.snippet.channelTitle, hits: 0, pages: 0 });
      c.hits += 1;
    }
    for (const id of batch) if (!got.has(id)) st.seen[id] = null; // deleted video
  }

  // 2. Scan channels with the most trailers first.
  const order = Object.entries(st.channels)
    .filter(([, c]) => !c.done || (Date.parse(today) - Date.parse(c.lastScan ?? '2000-01-01')) / 86_400_000 >= RESCAN_DAYS)
    .sort((a, b) => b[1].hits - a[1].hits);
  console.log(`  ${order.length} channels to scan`);
  let found = 0;
  let videos = 0;
  let chScanned = 0;
  for (const [cid, c] of order) {
    if (spent >= BUDGET - 1) break;
    if (c.done) { c.done = false; c.token = null; c.pages = 0; } // weekly rescan starts at the newest
    chScanned += 1;
    for (let pg = 0; pg < PAGES_PER_CHANNEL && spent < BUDGET - 1; pg++) {
      const j = await api('playlistItems', {
        part: 'snippet', maxResults: '50', playlistId: `UU${cid.slice(2)}`, ...(c.token ? { pageToken: c.token } : {}),
      });
      if (j.notFound) { c.done = true; c.lastScan = today; break; }
      for (const it of j.items ?? []) {
        videos += 1;
        const title = decode(it.snippet.title);
        const id = it.snippet.resourceId?.videoId;
        const lead = norm(title).replace(PREFIX, '');
        const cands = byFirst.get(lead.split(' ')[0]);
        if (!cands) continue;
        // Stricter than a search result: a channel's whole upload list holds interviews, speeches and
        // other films whose names merely start the same ("Hero Mouli Speech | ... Teaser Launch").
        // After the film's title only a trailer-ish word, a language or the year may follow; a title
        // of one word must also carry the year or be followed by the viewer's language name; and a video that fits two films is skipped.
        const hits = [];
        for (const p of cands) {
          if (done[p.k]?.key) continue;
          const v = { title, key: id, channel: c.title };
          const verdict = accept({ title: p.title, year: p.year }, v);
          const names = norm(`${title} ${c.title}`).split(' ').includes(norm(NAMES[p.code]));
          if (!verdict.ok || !names) continue;
          const ft = norm(p.title);
          const next = lead.slice(ft.length).trim().split(' ')[0] ?? '';
          if (!(next === '' || FOLLOWS.has(next) || /^(19|20)\d{2}$/.test(next))) continue;
          if (!ft.includes(' ') && !(next === norm(NAMES[p.code]) || (p.year && lead.includes(String(p.year))))) continue; // one-word title: year, or the viewer's language right after it
          hits.push({ p, verdict });
        }
        if (hits.length === 1) {
          const { p, verdict } = hits[0];
          done[p.k] = { key: id, videoTitle: title, channel: c.title, confidence: verdict.confidence, source: 'scan', checkedOn: today };
          found += 1;
          console.log(`  + ${p.title.slice(0, 30).padEnd(32)} ${p.code} ${title.slice(0, 60)}  [${c.title}]`);
        }
      }
      c.pages += 1;
      c.token = j.nextPageToken ?? null;
      if (!c.token) { c.done = true; c.lastScan = today; break; }
    }
    if (chScanned % 10 === 0) save();
  }
  save();
  console.log(`youtube-channel-scan: ${spent} units spent, ${chScanned} channels, ${videos} videos checked, ${found} new matches`);
} catch (e) {
  console.log(e.quota ? 'Quota exhausted; stopping. Everything found so far is saved.' : `youtube-channel-scan skipped: ${e.message}`);
  try { globalThis.__save?.(); } catch { /* ignore */ }
}
