/**
 * Official trailer lookup via the YouTube Data API v3.
 *
 * Why this is the right source for artwork: the production house uploads the
 * trailer itself, expressly so it gets spread around. We read it through the
 * official API and display the thumbnail as a link back to the video, which is
 * how YouTube intends thumbnails to be used. No scraping, no rights guesswork,
 * and the trailer itself is genuinely useful — people decide what to watch from
 * a trailer far more readily than from a title.
 *
 * Quota: 10,000 units a day, free. A `search.list` costs 100 units, so roughly
 * 100 new films a day; a `videos.list` read costs 1. Everything is cached to
 * disk permanently, because a film's trailer never changes — so the quota is
 * only ever spent on films we have not seen before.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CACHE_PATH = resolve(ROOT, 'data', 'youtube-cache.json');

/* ------------------------------------------------------------------ */
/* Key loading — never hard-coded, never committed                     */
/* ------------------------------------------------------------------ */

/**
 * Reads YOUTUBE_API_KEY from the environment, falling back to a local .env.
 * `.env` is gitignored, so the key stays out of the repo and out of chat logs.
 */
export function loadApiKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY.trim();

  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return null;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== 'YOUTUBE_API_KEY') continue;
    // Strip optional surrounding quotes.
    return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

let cache = null;

function loadCache() {
  if (cache) return cache;
  if (existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    } catch {
      cache = {};
    }
  } else {
    cache = {};
  }
  return cache;
}

function saveCache() {
  if (!cache) return;
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/* ------------------------------------------------------------------ */
/* Trailer selection                                                   */
/* ------------------------------------------------------------------ */

/**
 * Scores a candidate so we pick the real trailer, not a reaction video.
 *
 * The search results for any popular film are full of reactions, fan edits,
 * "trailer breakdown" commentary and full-movie piracy uploads. Showing one of
 * those as the film's artwork would look careless, so candidates are scored
 * rather than taken in rank order.
 */
function scoreCandidate(item, filmTitle) {
  const title = (item.snippet?.title ?? '').toLowerCase();
  const channel = (item.snippet?.channelTitle ?? '').toLowerCase();
  const film = filmTitle.toLowerCase();
  let score = 0;

  if (title.includes('trailer')) score += 30;
  if (title.includes('official')) score += 20;
  if (title.includes('teaser')) score += 8;

  // The film's name should actually be in there.
  const words = film.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const matched = words.filter((w) => title.includes(w)).length;
  score += Math.min(25, matched * 8);

  // Channels that are plausibly the rights holder.
  if (/(movies|cinemas?|entertainment|productions?|studios?|music|films?|creations)\b/.test(channel)) score += 10;
  if (/^(t-?series|aditya music|saregama|zee|sony|netflix|prime video|goldmines)/.test(channel)) score += 8;

  // Things we specifically do not want as the film's artwork.
  if (/(reaction|review|breakdown|explained|fan[- ]?made|spoof|parody|edit|status|whatsapp|ringtone|full movie|full film|shorts)/.test(title)) score -= 60;
  if (/(reaction|review|tamil dubbed movies|telugu movies online)/.test(channel)) score -= 25;

  return score;
}

/**
 * Finds the official trailer for a film.
 *
 * Returns null rather than a poor guess — a wrong trailer is worse than none.
 */
export async function findTrailer(filmTitle, { year, language = 'Telugu', apiKey, force = false } = {}) {
  const key = apiKey ?? loadApiKey();
  if (!key) return { status: 'no-api-key' };

  const c = loadCache();
  const cacheKey = `${filmTitle}|${language}`;
  if (!force && Object.prototype.hasOwnProperty.call(c, cacheKey)) {
    return { ...c[cacheKey], fromCache: true };
  }

  const q = `${filmTitle} ${language} official trailer${year ? ` ${year}` : ''}`;
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '8');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('key', key);

  const res = await fetch(url);

  if (res.status === 403) {
    const body = await res.text();
    const quota = /quota/i.test(body);
    return { status: quota ? 'quota-exceeded' : 'forbidden', detail: body.slice(0, 300) };
  }
  if (!res.ok) return { status: 'error', detail: `${res.status} ${res.statusText}` };

  const json = await res.json();
  const items = json.items ?? [];
  if (items.length === 0) {
    const miss = { status: 'not-found' };
    c[cacheKey] = miss;
    saveCache();
    return miss;
  }

  const ranked = items
    .map((item) => ({ item, score: scoreCandidate(item, filmTitle) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  // A low best score means nothing in the results looked like the real trailer.
  if (best.score < 35) {
    const miss = { status: 'no-confident-match', bestScore: best.score, bestTitle: best.item.snippet?.title };
    c[cacheKey] = miss;
    saveCache();
    return miss;
  }

  const s = best.item.snippet;
  const videoId = best.item.id?.videoId;
  const thumbs = s?.thumbnails ?? {};

  const record = {
    status: 'ok',
    videoId,
    title: s?.title ?? null,
    channelTitle: s?.channelTitle ?? null,
    channelId: s?.channelId ?? null,
    publishedAt: s?.publishedAt ?? null,
    score: best.score,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    thumbnail:
      thumbs.maxres?.url ??
      thumbs.standard?.url ??
      thumbs.high?.url ??
      thumbs.medium?.url ??
      thumbs.default?.url ??
      null,
    // i.ytimg.com serves these sizes for any video id without an API call,
    // which is handy for a poster-style crop at display time.
    thumbnailHigh: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
    thumbnailMax: videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : null,
    runnerUp: ranked[1] ? { title: ranked[1].item.snippet?.title, score: ranked[1].score } : null,
  };

  c[cacheKey] = record;
  saveCache();
  return record;
}

/* ------------------------------------------------------------------ */
/* Keyless path — no API key, no quota, no cost                        */
/* ------------------------------------------------------------------ */

/**
 * Two facts make thumbnails possible with no API key at all:
 *
 *   1. `i.ytimg.com/vi/{id}/hqdefault.jpg` is a plain static image. Given a
 *      video id, the thumbnail needs no key and no request to any API.
 *   2. `youtube.com/oembed` resolves a video id to its title and channel with
 *      no key either — enough to tell a real trailer from a reaction video.
 *
 * The only missing piece is where the video ids come from, and they are already
 * in hand: Wikipedia's own citations include YouTube links, and we fetch those
 * anyway to corroborate the availability claims. Verified live — RRR's citations
 * yield "RRR Trailer (Telugu)" by DVV Entertainment, the actual producer, and
 * Devara's yield "Devara Release Trailer" by NTR Arts.
 *
 * So the whole trailer feature costs nothing and the API key is only ever a
 * fallback for the films this misses.
 */

const OEMBED = 'https://www.youtube.com/oembed';

export function extractVideoIds(urls) {
  const ids = [];
  for (const url of urls) {
    const m = String(url).match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** Title and channel for a video id, with no key. Returns null if unavailable. */
export async function resolveViaOEmbed(videoId) {
  const url = `${OEMBED}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  try {
    const res = await fetch(url);
    // 404 means private, deleted or region-blocked — a dead id, not an error.
    if (!res.ok) return null;
    const j = await res.json();
    return {
      videoId,
      title: j.title ?? null,
      channelTitle: j.author_name ?? null,
      channelUrl: j.author_url ?? null,
      thumbnail: j.thumbnail_url ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Picks a trailer out of the YouTube ids found in a page's citations.
 *
 * Reuses the same scorer as the API path, so a reaction video or an event
 * interview is rejected here too — and those are exactly what Wikipedia
 * citations are full of, so the bar matters.
 */
export async function findTrailerKeyless(filmTitle, citationUrls) {
  const ids = extractVideoIds(citationUrls);
  if (ids.length === 0) return { status: 'no-candidates' };

  const c = loadCache();
  const cacheKey = `keyless|${filmTitle}`;
  if (Object.prototype.hasOwnProperty.call(c, cacheKey)) return { ...c[cacheKey], fromCache: true };

  const resolved = [];
  for (const id of ids.slice(0, 10)) {
    const meta = await resolveViaOEmbed(id);
    if (meta) resolved.push(meta);
  }
  if (resolved.length === 0) {
    const miss = { status: 'all-ids-dead' };
    c[cacheKey] = miss;
    saveCache();
    return miss;
  }

  const ranked = resolved
    .map((meta) => ({
      meta,
      score: scoreCandidate({ snippet: { title: meta.title, channelTitle: meta.channelTitle } }, filmTitle),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (best.score < 35) {
    const miss = {
      status: 'no-confident-match',
      bestScore: best.score,
      bestTitle: best.meta.title,
      candidatesChecked: resolved.length,
    };
    c[cacheKey] = miss;
    saveCache();
    return miss;
  }

  const record = {
    status: 'ok',
    via: 'keyless',
    videoId: best.meta.videoId,
    title: best.meta.title,
    channelTitle: best.meta.channelTitle,
    channelUrl: best.meta.channelUrl,
    score: best.score,
    watchUrl: `https://www.youtube.com/watch?v=${best.meta.videoId}`,
    embedUrl: `https://www.youtube.com/embed/${best.meta.videoId}`,
    thumbnail: best.meta.thumbnail,
    thumbnailHigh: `https://i.ytimg.com/vi/${best.meta.videoId}/hqdefault.jpg`,
    thumbnailMax: `https://i.ytimg.com/vi/${best.meta.videoId}/maxresdefault.jpg`,
    candidatesChecked: resolved.length,
  };

  c[cacheKey] = record;
  saveCache();
  return record;
}


/* ------------------------------------------------------------------ */
/* Verification — is this really the official trailer?                 */
/* ------------------------------------------------------------------ */

/**
 * Channels we treat as unambiguously legitimate for Telugu cinema.
 *
 * Two kinds: the streaming platforms themselves, and the production houses and
 * music labels that hold the audio/promo rights and therefore publish the real
 * trailers. Matched loosely because channels rename themselves.
 */
const TRUSTED_CHANNEL_PATTERNS = [
  /^netflix/i, /^prime ?video/i, /^(disney\+?)? ?hotstar/i, /^jiohotstar/i, /^zee5/i, /^sonyliv/i,
  /^aha/i, /^sun ?nxt/i, /^etv ?win/i, /^amazon/i,
  /aditya music/i, /^t-?series/i, /saregama/i, /lahari/i, /^sony music south/i, /^think music/i,
  /mythri movie/i, /geetha arts/i, /^ntr arts/i, /dvv entertainment/i, /vyjayanthi/i,
  /sithara entertainments/i, /haarika/i, /^ug media/i, /primeshow entertainment/i,
  /people media factory/i, /^suresh productions/i, /annapurna studios/i, /^sri venkateswara creations/i,
  /dharma productions/i, /^yash raj/i, /^vfc/i, /^ak entertainments/i, /matinee entertainment/i,
  /^fortune four/i, /shine screens/i, /^allu entertainment/i, /^konidela/i,
];

/** Trailers run roughly half a minute to four minutes. */
const TRAILER_MIN_SEC = 25;
const TRAILER_MAX_SEC = 400;

function parseISODuration(iso) {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  const [, d, h, mi, sec] = m.map((x) => (x ? Number(x) : 0));
  return d * 86400 + h * 3600 + mi * 60 + sec;
}

/**
 * Confirms a candidate really is the trailer, using videos.list — which costs
 * ONE quota unit, against 100 for a search, so this is nearly free.
 *
 * Checks three things a search result cannot tell you:
 *   - the real duration (a 90-minute "trailer" is a pirated full film)
 *   - the exact channel title (search snippets can lag renames)
 *   - view count, as a weak signal that this is the one everyone watched
 */
export async function verifyVideo(videoId, filmTitle, apiKey) {
  const key = apiKey ?? loadApiKey();
  if (!key || !videoId) return { verified: false, reason: 'no-key' };

  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,contentDetails,statistics');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', key);

  try {
    const res = await fetch(url);
    if (!res.ok) return { verified: false, reason: `http-${res.status}` };
    const json = await res.json();
    const item = (json.items ?? [])[0];
    if (!item) return { verified: false, reason: 'video-gone' };

    const durationSec = parseISODuration(item.contentDetails?.duration);
    const channel = item.snippet?.channelTitle ?? '';
    const title = item.snippet?.title ?? '';
    const views = Number(item.statistics?.viewCount ?? 0);

    const trustedChannel = TRUSTED_CHANNEL_PATTERNS.some((re) => re.test(channel));
    const lengthOk = durationSec !== null && durationSec >= TRAILER_MIN_SEC && durationSec <= TRAILER_MAX_SEC;
    const saysTrailer = /trailer|teaser/i.test(title);

    const reasons = [];
    if (!trustedChannel) reasons.push('channel-not-in-trusted-list');
    if (!lengthOk) reasons.push(durationSec === null ? 'no-duration' : `length-${durationSec}s`);
    if (!saysTrailer) reasons.push('title-lacks-trailer');

    // A full-length upload is the dangerous case: it is piracy, and showing it
    // as the film's artwork would be indefensible. Never accept it.
    const looksLikeFullFilm = durationSec !== null && durationSec > 1800;

    return {
      verified: lengthOk && saysTrailer && !looksLikeFullFilm,
      trustedChannel,
      lengthOk,
      saysTrailer,
      looksLikeFullFilm,
      durationSec,
      channelTitle: channel,
      verifiedTitle: title,
      views,
      reasons,
      // Trusted channel AND a sane length AND it says trailer.
      confidence: trustedChannel && lengthOk && saysTrailer ? 'high' : lengthOk && saysTrailer ? 'medium' : 'low',
    };
  } catch (err) {
    return { verified: false, reason: err.message };
  }
}

export { TRUSTED_CHANNEL_PATTERNS };

/** Rough quota accounting so a big run doesn't fail halfway through. */
export const QUOTA = { searchCost: 100, dailyFree: 10000 };
