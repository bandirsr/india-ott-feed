/**
 * Free full movies that APPROVED official YouTube channels publish.
 *
 * Reads each approved channel's upload feed (no key, no quota, the latest ~15 uploads), keeps the
 * uploads titled "... Full Movie", and writes them to data/youtube-movies.json as fresh-layer
 * records (platform YouTube). fetch-fresh.js merges them; the usual TMDB title match and the
 * safety rules in publish.js then decide whether each one is shown, so an upload TMDB cannot
 * match, or one that trips the rules, never reaches the app.
 *
 * Only channels with "approved": true in data/youtube-movie-channels.json are polled. A channel
 * is approved by a person, because many full-movie uploads on YouTube are not licensed.
 *
 *   node youtube-movies.mjs                      poll the approved channels
 *   node youtube-movies.mjs --try @handle hi     dry run: what a channel would add (Hindi), nothing saved
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { youtubeChannelFeed } from './src/feeds.js';
import { matchFreshTitle } from './src/fresh.js';
import { loadTmdbKey } from './src/tmdb.js';

const CHANNELS = 'data/youtube-movie-channels.json';
const OUT = 'data/youtube-movies.json';
const KEEP_DAYS = 400;
const NAMES = { te: 'Telugu', hi: 'Hindi', ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati' };
const UA = { 'user-agent': 'Mozilla/5.0 (OTTwalaYouTubeMovies/1.0)' };

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** "Hyderabad Nawabs Hindi Full Movie | Saleem Pheku | Superhit Movies" -> "Hyderabad Nawabs" */
export function movieName(title) {
  if (!/\bfull\s+(movie|film)\b/i.test(title)) return null;
  // Clips, shorts and platform promos that merely say "Full Movie ... streaming on Prime Video" are not free movies.
  if (/#shorts?\b|\bshorts?\b|streaming now|\bscenes?\b|\bsongs?\b|\btrailer\b|\bteaser\b|\bpromo\b|\bclip\b|\b(?:on|in)\s+(?:prime video|netflix|zee5|jiohotstar|sun nxt|aha)\b/i.test(title)) return null;
  let t = title.split(/\s*[|–—]\s*/)[0];
  t = t.replace(/\b(?:(?:telugu|hindi|tamil|malayalam|kannada|bengali|marathi|punjabi|gujarati|dubbed|hd|4k|new|latest|blockbuster|superhit|super hit)\s+)*full\s+(?:movie|film)\b.*$/i, '');
  t = t.replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*$/, '').replace(/\s*[-:]\s*$/, '').trim();
  return t.length >= 2 ? t : null;
}

async function uploads(channelId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    // The uploads playlist (UU + the channel id without "UC"): 1 quota unit per 50 videos, up to 4 pages.
    // A channel that posts many clips buries its full movies past the 15 the plain feed shows.
    const out = [];
    let token = '';
    for (let page = 0; page < 4; page++) {
      const u = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=UU${channelId.slice(2)}&key=${key}${token ? '&pageToken=' + token : ''}`;
      const j = await (await fetch(u, { signal: AbortSignal.timeout(15_000) })).json();
      if (j.error) throw new Error(`YouTube API: ${j.error.message?.slice(0, 80)}`);
      for (const it of j.items ?? []) out.push({ videoId: it.snippet.resourceId.videoId, title: it.snippet.title, published: String(it.snippet.publishedAt).slice(0, 10) });
      token = j.nextPageToken ?? '';
      if (!token) break;
    }
    return out;
  }
  const xml = await (await fetch(youtubeChannelFeed(channelId), { headers: UA, signal: AbortSignal.timeout(15_000) })).text();
  return [...xml.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<published>([^<]+)<\/published>/g)]
    .map((m) => ({ videoId: m[1], title: decode(m[2]), published: m[3].slice(0, 10) }));
}

async function channelIdFor(handle) {
  if (/^UC[\w-]{22}$/.test(handle)) return handle;
  const html = await (await fetch(`https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`, { headers: UA })).text();
  return html.match(/"channelId":"(UC[\w-]{22})"/)?.[1] ?? html.match(/channel_id=(UC[\w-]{22})/)?.[1] ?? null;
}

async function toRecord(ch, v) {
  const name = movieName(v.title);
  if (!name) return null;
  let match = await matchFreshTitle(name, [ch.language], { strict: true });
  // A year in the upload title ("Patang (2026) ...") must agree with the TMDB film, or it is a different film of the same name.
  const year = Number(v.title.match(/[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]/)?.[1]);
  if (match && year && Math.abs(Number(String(match.date ?? '').slice(0, 4)) - year) > 1) match = null;
  return {
    match,
    record: {
      title: name, platform: 'YouTube', languages: [ch.language], date: v.published, keep: true, strictLanguage: true, source: 'youtube-channel',
      sourceName: `YouTube: ${ch.name}`, headline: `${name} is free to watch on YouTube (${ch.name})`, link: `https://www.youtube.com/watch?v=${v.videoId}`, videoId: v.videoId,
    },
  };
}

if (!loadTmdbKey()) { console.log('No TMDB_API_KEY -- skipped.'); process.exit(0); }

const tryIdx = process.argv.indexOf('--try');
if (tryIdx > -1) {
  const handle = process.argv[tryIdx + 1];
  const code = process.argv[tryIdx + 2] ?? 'hi';
  const id = await channelIdFor(handle);
  if (!id) { console.log(`Could not resolve ${handle}`); process.exit(1); }
  console.log(`${handle} -> ${id}`);
  const ch = { name: handle, language: NAMES[code] };
  const list = await uploads(id);
  console.log(`${list.length} recent uploads, ${list.filter((v) => movieName(v.title)).length} look like full movies:`);
  for (const v of list) {
    const r = await toRecord(ch, v);
    console.log(`  ${r ? (r.match ? 'MATCHES ' + r.match.key + ' ' + r.match.title : 'no TMDB match') : 'skip (not a full movie)'}  <- ${v.title}`);
  }
  process.exit(0);
}

const cfg = existsSync(CHANNELS) ? JSON.parse(readFileSync(CHANNELS, 'utf8')) : { channels: [] };
const kept = new Map((existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).releases : []).map((r) => [r.videoId, r]));
let added = 0;
for (const ch of cfg.channels.filter((c) => c.approved && c.channelId)) {
  try {
    for (const v of await uploads(ch.channelId)) {
      if (kept.has(v.videoId)) continue;
      const r = await toRecord(ch, v);
      if (r?.match) { kept.set(v.videoId, r.record); added++; }
    }
  } catch (e) { console.log(`  ${ch.name}: ${e.message} -- skipped`); }
}
const now = Date.now();
const releases = [...kept.values()].filter((r) => now - Date.parse(r.date) < KEEP_DAYS * 86_400_000).sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), releases }, null, 1) + '\n');
console.log(`YouTube free movies: ${added} new, ${releases.length} kept from ${cfg.channels.filter((c) => c.approved).length} approved channel(s)`);
