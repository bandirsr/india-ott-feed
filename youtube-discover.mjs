/**
 * Finds YouTube channels that post free full-length movies, for a person to approve one by one.
 * Searches long videos titled "<language> full movie", groups them by channel, then checks each
 * channel's recent uploads the same way youtube-movies.mjs does. Writes reports/youtube-channel-candidates.md.
 * Costs about 100 quota units per language searched plus a few per channel. Approving is a person's call:
 * set "approved": true on the channel in data/youtube-movie-channels.json.
 *
 *   node youtube-discover.mjs
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) { console.log('No YOUTUBE_API_KEY.'); process.exit(1); }
const LANGS = [['te', 'Telugu'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['ml', 'Malayalam'], ['kn', 'Kannada'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['pa', 'Punjabi'], ['gu', 'Gujarati']];
const NOT_A_MOVIE = /#shorts?\b|\bshorts?\b|streaming now|\bscenes?\b|\bsongs?\b|\btrailer\b|\bteaser\b|\bpromo\b|\bclip\b/i;
const known = new Set((existsSync('data/youtube-movie-channels.json') ? JSON.parse(readFileSync('data/youtube-movie-channels.json', 'utf8')).channels : []).map((c) => c.channelId));

async function api(path, params) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  u.search = new URLSearchParams({ ...params, key: KEY });
  const j = await (await fetch(u, { signal: AbortSignal.timeout(20_000) })).json();
  if (j.error) throw new Error(String(j.error.message).slice(0, 100));
  return j;
}
const mins = (iso) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? ''); return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0; };

// 1. who posts long "full movie" videos, per language
const seen = new Map(); // channelId -> { langs:Set, hits }
for (const [code, name] of LANGS) {
  try {
    const j = await api('search', { part: 'snippet', type: 'video', videoDuration: 'long', q: `${name} full movie`, maxResults: '50', regionCode: 'IN', safeSearch: 'strict' });
    for (const it of j.items ?? []) {
      const c = seen.get(it.snippet.channelId) ?? { langs: new Map(), hits: 0 };
      c.langs.set(code, (c.langs.get(code) ?? 0) + 1);
      c.hits += 1;
      seen.set(it.snippet.channelId, c);
    }
  } catch (e) { console.log(`${name}: ${e.message}`); }
}
const ids = [...seen.keys()].filter((id) => !known.has(id));
console.log(`${ids.length} channels found`);

// 2. channel facts
const info = new Map();
for (let i = 0; i < ids.length; i += 50) {
  const j = await api('channels', { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(',') });
  for (const c of j.items ?? []) info.set(c.id, c);
}

// 3. how many real full movies each has among its latest 200 uploads
const rows = [];
for (const id of ids) {
  const c = info.get(id);
  if (!c) continue;
  try {
    const vids = [];
    let token;
    for (let p = 0; p < 4; p++) {
      const j = await api('playlistItems', { part: 'snippet', maxResults: '50', playlistId: `UU${id.slice(2)}`, ...(token ? { pageToken: token } : {}) });
      for (const it of j.items ?? []) vids.push({ id: it.snippet.resourceId.videoId, title: it.snippet.title });
      token = j.nextPageToken; if (!token) break;
    }
    const movies = [];
    for (let i = 0; i < vids.length; i += 50) {
      const j = await api('videos', { part: 'contentDetails,statistics', id: vids.slice(i, i + 50).map((v) => v.id).join(',') });
      for (const v of j.items ?? []) {
        const t = vids.find((x) => x.id === v.id)?.title ?? '';
        if (mins(v.contentDetails?.duration) >= 60 && !NOT_A_MOVIE.test(t) && v.contentDetails?.contentRating?.ytRating !== 'ytAgeRestricted') movies.push({ t, views: Number(v.statistics?.viewCount ?? 0) });
      }
    }
    rows.push({
      id, name: c.snippet.title, handle: c.snippet.customUrl ?? '', subs: Number(c.statistics?.subscriberCount ?? 0), country: c.snippet.country ?? '',
      langs: [...seen.get(id).langs.keys()].join(','), movies: movies.length, views: movies.reduce((a, m) => a + m.views, 0), sample: movies.sort((a, b) => b.views - a.views).slice(0, 3).map((m) => m.t.split('|')[0].trim().slice(0, 50)),
    });
  } catch (e) { console.log(`  ${id}: ${e.message}`); }
}
rows.sort((a, b) => b.movies - a.movies);
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const md = ['# YouTube channels posting free full movies', '', `Checked ${new Date().toISOString().slice(0, 10)}. Full movie = 60+ minutes, not a clip, not age-restricted, among the latest 200 uploads. Approve a channel only if it is the official owner or a licensed distributor.`, '',
  '| Channel | Language | Full movies | Total views | Subscribers | Country | Top titles | channelId |', '|---|---|---|---|---|---|---|---|',
  ...rows.filter((r) => r.movies > 0).map((r) => `| ${r.name} ${r.handle} | ${r.langs} | ${r.movies} | ${fmt(r.views)} | ${fmt(r.subs)} | ${r.country} | ${r.sample.join('; ')} | ${r.id} |`)].join('\n');
mkdirSync('reports', { recursive: true });
writeFileSync('reports/youtube-channel-candidates.md', md + '\n');
console.log(md);
