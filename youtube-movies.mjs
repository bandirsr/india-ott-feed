/**
 * Free full movies that APPROVED official YouTube channels publish.
 *
 * For each approved channel this reads its recent uploads and keeps the full-length movies. They are
 * written to data/youtube-movies.json, and publish.js lists them under the YouTube chip straight from
 * here: no TMDB match is needed. The card shows the video's own thumbnail, the play button opens the
 * movie on YouTube, the release date is the day it was posted, and the view and like counts are kept
 * fresh so the app can sort by them.
 *
 * Only channels with "approved": true in data/youtube-movie-channels.json are polled. A channel is
 * approved by a person, because many full-movie uploads on YouTube are not licensed.
 *
 * With YOUTUBE_API_KEY: the uploads playlist (up to 200 videos), keeping any video of 80 minutes or
 * more. That is about 6 quota units per channel. Without a key: the plain feed (latest 15 uploads),
 * keeping titles that say "Full Movie"; no view counts then.
 *
 *   node youtube-movies.mjs                       poll the approved channels
 *   node youtube-movies.mjs --try UC... hi        preview what a channel would add (language te/hi/ta/ml/kn/bn/mr/pa/gu)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { youtubeChannelFeed } from './src/feeds.js';
import { blockReason, childRisk } from './src/safety.js';

const CHANNELS = 'data/youtube-movie-channels.json';
const OUT = 'data/youtube-movies.json';
const KEEP_DAYS = 400;
const MAX_MINUTES = 240; // a longer video is a compilation or a live stream, not one film
const MIN_MINUTES = 80; // a feature film; trailers, clips and compilations are shorter or far longer
const NAMES = { te: 'Telugu', hi: 'Hindi', ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati' };
const UA = { 'user-agent': 'Mozilla/5.0 (OTTwalaYouTubeMovies/1.0)' };
const KEY = process.env.YOUTUBE_API_KEY;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// Reviews, recaps and story explainers run for an hour or more and say "Full Movie" in the title.
const REVIEW_WORDS = /\b(?:reviews?|explained|explanation|recap|story\s*(?:in|line)|facts|breakdown|analysis|reaction|audio\s*(?:launch|release|review|jukebox)|jukebox|pre[-\s]?release|press\s*meet|launch|muhurat(?:am)?|interview|making|behind\s+the\s+scenes|bgm|lyrical|first\s+look|motion\s+poster|glimpse|promo|event|live|ott\s+release|box\s*office|collections?)\b/i;
const NOT_A_MOVIE = /#shorts?\b|\bshorts?\b|streaming now|\bscenes?\b|\bsongs?\b|\btrailer\b|\bteaser\b|\bpromo\b|\bclip\b|\bcomedy\b.*\bscenes?\b|\b(?:on|in)\s+(?:prime video|netflix|zee5|jiohotstar|sun nxt|aha)\b/i;

const FULL_MOVIE = /\bfull\s+(?:hd\s+|length\s+)?(?:movie|film)\b/i;
// Everything from the first descriptor word onwards is not part of the film's name.
const DESCRIPTOR = /\b(?:full\s+(?:hd\s+|length\s+)?(?:movie|film)|(?:hindi|telugu|tamil|malayalam|kannada|bengali|marathi|punjabi|gujarati|south)\s+(?:dubbed|full|movie|film|indian|action|suspense)|dubbed|new(?:ly)?\s+releas\w*|latest|blockbuster|super\s*hit|bollywood|4k|hd|(?:19|20)\d{2}\)?\s+(?:new|latest|south|hindi|full|super))\b.*$/i;

/** "Anurag Kashyap Ki Mystery Thriller | NO SMOKING | Full Movie (HD)" -> "NO SMOKING". Null when no reliable name. */
export function movieName(title) {
  const clean = (x) => x.replace(DESCRIPTOR, '').replace(/#\S+/g, '').replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*$/, '').replace(/\s*[-:,&]\s*$/, '').replace(/\s+/g, ' ').trim();
  const segs = title.split(/\s*[|–—]\s*/);
  let name = null;
  const at = segs.findIndex((x) => FULL_MOVIE.test(x));
  if (at >= 0) {
    name = clean(segs[at]);
    if (name.length < 2 && at > 0) name = clean(segs[at - 1]);
  } else {
    name = clean(segs[0]);
    // "Ravi Teja (2026) New Released ... Movie | Real Title": the words before "New Released" are the star, not the film.
    const cut = DESCRIPTOR.exec(segs[0]);
    if (cut && /^(?:new|latest|(?:19|20)\d{2})/i.test(cut[0])) {
      const next = segs[1] ? clean(segs[1]) : '';
      name = next && next.split(/\s+/).length <= 4 && !/[,&]/.test(next) && !DESCRIPTOR.test(segs[1]) ? next : null;
    }
  }
  if (name) name = name.replace(/\s*[\(\[][^\)\]]*$/, '').trim(); // an unclosed "(HD" left over from the cut
  // "Night Drive - South Suspense Thriller ..." -> "Night Drive"
  if (name && / [-–] /.test(name)) name = name.split(/ [-–] /)[0].trim();
  if (!name || /[,&]/.test(name) || name.length < 2 || name.length > 40 || name.split(/\s+/).length > 6 || /['’]s$/i.test(name) || /\b(?:ki|ka|ke|ko)\s+(?:mystery|action|comedy|thriller|horror|romantic)/i.test(name)) return null;
  return name;
}

const minutes = (iso) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60 : 0;
};

async function api(path, params) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  u.search = new URLSearchParams({ ...params, key: KEY });
  const j = await (await fetch(u, { signal: AbortSignal.timeout(20_000) })).json();
  if (j.error) throw new Error(`YouTube API: ${String(j.error.message).slice(0, 80)}`);
  return j;
}

/** { videoId, title, published } for a channel's recent uploads. */
async function uploads(channelId) {
  if (KEY) {
    // The uploads playlist is "UU" + the channel id without "UC": 1 quota unit per 50 videos.
    const out = [];
    let token;
    for (let page = 0; page < 4; page++) {
      const j = await api('playlistItems', { part: 'snippet', maxResults: '50', playlistId: `UU${channelId.slice(2)}`, ...(token ? { pageToken: token } : {}) });
      for (const it of j.items ?? []) out.push({ videoId: it.snippet.resourceId.videoId, title: it.snippet.title, published: String(it.snippet.publishedAt).slice(0, 10) });
      token = j.nextPageToken;
      if (!token) break;
    }
    return out;
  }
  const xml = await (await fetch(youtubeChannelFeed(channelId), { headers: UA, signal: AbortSignal.timeout(15_000) })).text();
  return [...xml.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<published>([^<]+)<\/published>/g)]
    .map((m) => ({ videoId: m[1], title: decode(m[2]), published: m[3].slice(0, 10) }));
}

/** Length and counts for up to many videos, 50 per call (1 unit each). Empty without a key. */
async function stats(ids) {
  const out = new Map();
  if (!KEY) return out;
  for (let i = 0; i < ids.length; i += 50) {
    const j = await api('videos', { part: 'contentDetails,statistics,snippet,status', id: ids.slice(i, i + 50).join(',') });
    for (const v of j.items ?? []) out.set(v.id, { minutes: minutes(v.contentDetails?.duration), views: Number(v.statistics?.viewCount ?? 0), likes: v.statistics?.likeCount == null ? null : Number(v.statistics.likeCount), ageRestricted: v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted', blocked: v.status?.privacyStatus !== 'public' || v.status?.embeddable === false || v.status?.uploadStatus !== 'processed' || (v.contentDetails?.regionRestriction?.blocked ?? []).includes('IN') || ((v.contentDetails?.regionRestriction?.allowed ?? ['IN']).includes('IN') === false), audio: String(v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage ?? '').slice(0, 2).toLowerCase() });
  }
  return out;
}

async function channelIdFor(handle) {
  if (/^UC[\w-]{22}$/.test(handle)) return handle;
  const html = await (await fetch(`https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`, { headers: UA })).text();
  return html.match(/"channelId":"(UC[\w-]{22})"/)?.[1] ?? null;
}

/** The movies in a channel's uploads, with why each was kept or not. */
async function movies(ch, list) {
  const st = await stats(list.map((v) => v.videoId));
  const out = [];
  for (const v of list) {
    const name = movieName(v.title);
    const s = st.get(v.videoId);
    let why = null;
    if (!name) why = 'no usable title';
    else if (NOT_A_MOVIE.test(v.title)) why = 'clip, song, trailer or platform promo';
    else if (REVIEW_WORDS.test(v.title)) why = 'review, recap or explainer';
    else if (s?.blocked) why = 'not public, not embeddable, or not available in India';
    else if (s?.ageRestricted) why = 'age-restricted on YouTube';
    else if (KEY ? !s || s.minutes < MIN_MINUTES || s.minutes > MAX_MINUTES : !/\bfull\s+(movie|film)\b/i.test(v.title)) why = KEY ? `only ${Math.round(s?.minutes ?? 0)} min` : 'title does not say Full Movie';
    else if (childRisk(v.title) || blockReason({ id: '', t: name, syn: '', p: [] }, {}, { certs: {}, manual: {} })) why = 'trips the safety rules';
    // A channel that posts in several languages (Eros South) is only trusted when the video states its own audio language.
    const stated = NAMES[s?.audio];
    const lang = ch.multiLanguage ? stated : (ch.language ?? stated);
    out.push({
      v, name, why: why ?? (lang ? null : 'language not stated on a multi-language channel'),
      record: why || !lang ? null : {
        id: `yt:${v.videoId}`, videoId: v.videoId, title: name, language: lang, date: v.published, channel: ch.name,
        minutes: s ? Math.round(s.minutes) : null, views: s?.views ?? null, likes: s?.likes ?? null, uploadTitle: v.title,
      },
    });
  }
  return out;
}

const tryIdx = process.argv.indexOf('--try');
if (tryIdx > -1) {
  const id = await channelIdFor(process.argv[tryIdx + 1]);
  if (!id) { console.log('Could not resolve that channel.'); process.exit(1); }
  const code = process.argv[tryIdx + 2] ?? 'hi';
  const list = await uploads(id);
  const found = await movies({ name: id, language: NAMES[code] }, list);
  const kept = found.filter((f) => f.record);
  console.log(`${id}: ${list.length} recent uploads, ${kept.length} would be listed as free full movies${KEY ? '' : ' (no API key: titles only, no length or counts)'}:`);
  for (const f of kept) console.log(`  + ${f.name}  (${f.record.date}, ${f.record.minutes ?? '?'} min, ${f.record.views?.toLocaleString() ?? '?'} views, ${f.record.likes?.toLocaleString() ?? '?'} likes)  <- ${f.v.title}`);
  const skipped = found.filter((f) => !f.record);
  console.log(`${skipped.length} skipped. A sample:`);
  for (const f of skipped.slice(0, 8)) console.log(`  - ${f.why}: ${f.v.title.slice(0, 90)}`);
  process.exit(0);
}

const cfg = existsSync(CHANNELS) ? JSON.parse(readFileSync(CHANNELS, 'utf8')) : { channels: [] };
const kept = new Map((existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).releases ?? [] : []).map((r) => [r.videoId, r]));
const approved = cfg.channels.filter((c) => c.approved && c.channelId);
let added = 0;
for (const ch of approved) {
  try {
    const fresh = (await movies(ch, (await uploads(ch.channelId)).filter((v) => !kept.has(v.videoId)))).filter((f) => f.record);
    for (const f of fresh) { kept.set(f.record.videoId, f.record); added++; }
  } catch (e) { console.log(`  ${ch.name}: ${e.message} -- skipped`); }
}
// Refresh view and like counts on everything kept, and drop videos YouTube no longer serves.
try {
  const st = await stats([...kept.keys()]);
  if (KEY) for (const [id, r] of kept) {
    const s = st.get(id);
    if (!s || s.ageRestricted || s.blocked) { kept.delete(id); continue; } // removed, made private, restricted or blocked in India: gone from the app on this run
    // The rules tighten over time, so everything kept is re-judged on its upload title and length every run.
    const name = movieName(r.uploadTitle ?? '');
    if (!name) { kept.delete(id); continue; }
    r.title = name;
    if (REVIEW_WORDS.test(r.uploadTitle ?? '') || NOT_A_MOVIE.test(r.uploadTitle ?? '') || s.minutes < MIN_MINUTES || s.minutes > MAX_MINUTES) { kept.delete(id); continue; }
    r.views = s.views; r.likes = s.likes;
  }
} catch (e) { console.log(`  counts not refreshed: ${e.message}`); }
// The same film posted by several channels (the DRJ channels, for one) is listed once, from the copy with most views.
const best = new Map();
for (const r of kept.values()) {
  const key = `${r.language}|${r.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')}`;
  if (!best.has(key) || (r.views ?? 0) > (best.get(key).views ?? 0)) best.set(key, r);
}
for (const [id, r] of kept) if (best.get(`${r.language}|${r.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')}`) !== r) kept.delete(id);
const now = Date.now();
const releases = [...kept.values()].filter((r) => now - Date.parse(r.date) < KEEP_DAYS * 86_400_000).sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), releases }, null, 1) + '\n');
console.log(`YouTube free movies: ${added} new, ${releases.length} kept from ${approved.length} approved channel(s)`);
