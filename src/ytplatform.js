/**
 * Release announcements from the platforms' own YouTube channels.
 *
 * TMDB/JustWatch trail aha (and others) by weeks to months, and no news feed
 * covers every title. The platforms themselves post the same-day signal as a
 * video title: "Vasudheva Sutham - Watch Now | ...", "Na Wife Missing |
 * Premieres On Oct 22nd | ...", "Kappi Squad | Now Streaming | JioHotstar".
 *
 * Reads each channel's uploads playlist (YouTube Data API `playlistItems.list`,
 * ONE quota unit a call -- not the 100-unit `search.list` the trailer pass
 * uses), turns qualifying titles into the same record shape the news layer
 * produces, and lets the existing matching decide whether a record is a real
 * TMDB film. Records are language-strict (see matchFreshTitle): a generic title
 * must match a film in the channel's own language or it is dropped.
 *
 * A dated "premieres on" title is only reported once that day has arrived, so a
 * promo posted a week ahead cannot show a film as streaming early.
 */

/** Channel id -> what a video there says about where a film is. Ids verified 2026-10-16. */
export const PLATFORM_CHANNELS = [
  { id: 'UCmO-jDLU-KUcweCzktuDsbg', name: 'aha videoIN', platform: 'aha', languages: ['Telugu', 'Tamil'] },
  { id: 'UCqyZfPcrNtfbpmygFSRj-_A', name: 'aha Tamil', platform: 'aha', languages: ['Tamil'] },
  { id: 'UC2DDhRE75LKKPjAxC-zsGRg', name: 'JioHotstar Telugu', platform: 'JioHotstar', languages: ['Telugu'] },
  { id: 'UC8lPjTzRiG37n1Q2kpz3Rfg', name: 'JioHotstar Tamil', platform: 'JioHotstar', languages: ['Tamil'] },
  { id: 'UCA09ogM92UefGEHtSZy5zkw', name: 'JioHotstar Malayalam', platform: 'JioHotstar', languages: ['Malayalam'] },
  // Prime Video India is deliberately absent: it posts every language, so a title cannot be
  // matched language-strictly, and a bare title match put a 1973 film on "The Traitors".
  { id: 'UCz1ht-a2eKE_s1vMh3OHtIg', name: 'manoramaMAX', platform: 'ManoramaMAX', languages: ['Malayalam'] },
  { id: 'UC-ybzIsgchcx7PHqOSxn5OQ', name: 'Sony LIV Telugu', platform: 'SonyLIV', languages: ['Telugu'] },
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Episodes, shows and clips of shows: not a film becoming watchable. */
const NOT_A_FILM =
  /\b(ep(?:isode)?s?\.?\s*\d*|latest episode|week\s*\d+|promo\s*\d*|wrap[- ]?up|mash-?up|recap|highlights|behind the scenes|reaction|review|lyrical|song|first look|glimpse|shorts?|interview|launch event|press meet|web series|series|season\s*\d*|show|specials?|serial|reality)\b/i;

const NOW = /(?:watch now(?: on \w+)?|(?:is )?now streaming(?: on [\w ]+)?|streaming now(?: on [\w ]+)?|out now)/i;
const MON = MONTHS.join('|');
const DATED = new RegExp(
  String.raw`(?:premieres?|streaming|releasing|starts streaming|from)\s+(?:on\s+|from\s+)?(?:(${MON})[a-z]*\.?\s+(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)?\s+(${MON})[a-z]*)`,
  'i'
);
/** Wording anywhere in the video title that marks a clip of a show, not a film. */
const RAW_SKIP = /(wrap[- ]?up|mash-?up|recap|promo|highlights|episode|\bep\s*\d+|week\s*\d+)/i;
/** A label the platform puts where a title would go. */
const LABEL = /^(watch|hotstar specials|aha originals?|an aha original|watch now|now streaming|streaming now|love & romance|collection)$/i;

const isoDay = (d) => d.toISOString().slice(0, 10);

/** "Oct 22nd" / "22nd October" in a title -> an ISO day, year taken from when it was posted. */
export function parseTitleDate(title, postedISO) {
  const m = DATED.exec(title);
  if (!m) return null;
  const mon = MONTHS.indexOf((m[1] ?? m[4]).toLowerCase().slice(0, 3));
  const day = Number(m[2] ?? m[3]);
  if (mon < 0 || day < 1 || day > 31) return null;
  const posted = new Date(`${postedISO}T00:00:00Z`);
  const year = posted.getUTCFullYear();
  let d = new Date(Date.UTC(year, mon, day));
  // A "Dec 5" promo posted in late November belongs to this year; a "Jan 3" one to the next.
  if (d.getTime() < posted.getTime() - 45 * 86_400_000) d = new Date(Date.UTC(year + 1, mon, day));
  return isoDay(d);
}

/** Tidy a title fragment: drop hashtags, "Movie Scenes", language and trailer words. */
function clean(fragment) {
  let t = String(fragment ?? '');
  t = t.replace(/#\w+|@\w+/g, '').replace(/["“”]/g, '');
  t = t.replace(/\s*[-–—]\s*$/, '');
  t = t.replace(/\s+(?:official\s+)?(?:movie\s+)?(?:trailer|teaser)\b.*$/i, '');
  t = t.replace(/\s+(?:movie\s+)?scenes?\b.*$/i, '');
  t = t.replace(/\s+(?:telugu|tamil|malayalam|hindi|kannada)?\s*(?:full\s+)?(?:movie|film)\b.*$/i, '');
  t = t.replace(/\s+(?:telugu|tamil|malayalam|hindi|kannada)$/i, '');
  // "Anbe Diana, Ultimate rom-com laughter ride" -> the title before the tagline
  t = t.replace(/,.*$/, '');
  t = t.replace(/\s+on\s+(?:sony\s*liv|aha|jio\s*hotstar|zee\s*5|prime video|netflix)\b.*$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * The film title out of a platform video title, plus which wording marked it as
 * available. The signal has to sit in the first two "|" segments: later ones are
 * cast lists and show names ("Good News for Sammy | Batchmates | Streaming Now"
 * is a clip of a series, not a title).
 */
export function readTitle(videoTitle) {
  const segs = String(videoTitle ?? '').split(/\s+\|\s+/);
  for (let i = 0; i < Math.min(2, segs.length); i += 1) {
    const seg = segs[i];
    const hit = NOW.exec(seg) ?? DATED.exec(seg);
    if (!hit) continue;
    const before = clean(seg.slice(0, hit.index));
    const candidate = before || (i > 0 ? clean(segs[i - 1]) : '');
    return { title: candidate, kind: NOW.test(seg) ? 'now' : 'dated' };
  }
  return null;
}

/** Kept for callers that only want the title. */
export function titleFrom(videoTitle) {
  return readTitle(videoTitle)?.title || null;
}

/**
 * One uploaded video -> a release record, or null.
 * `today` is injectable so the "not before its day" rule is testable.
 */
export function recordFromVideo(video, channel, today = isoDay(new Date())) {
  const raw = video.title ?? '';
  const read = readTitle(raw);
  if (!read) return null;
  const film = read.title;
  if (!film || film.length < 2 || film.length > 60) return null;
  if (LABEL.test(film) || NOT_A_FILM.test(film) || RAW_SKIP.test(raw)) return null;
  // Emoji banter ("Weekend plans planned") is a social post, not a title.
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(film)) return null;

  const posted = String(video.publishedAt ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(posted)) return null;
  const date = read.kind === 'dated' ? parseTitleDate(raw, posted) : posted;
  if (!date || date > today) return null; // nothing yet, or not before its day

  return {
    kind: 'release',
    title: film,
    platform: channel.platform,
    languages: channel.languages,
    strictLanguage: channel.languages.length > 0,
    date,
    dateStatus: 'reported',
    provisional: true,
    // "Watch Now" on a clip says the film is ON the platform, not that it just arrived;
    // resolveFreshReports drops the date for an old film. Kept 120 days from the last sighting.
    catalog: read.kind === 'now',
    keepDays: 120,
    source: `yt-${channel.id}`,
    sourceName: `${channel.name} on YouTube`,
    headline: raw,
    link: `https://www.youtube.com/watch?v=${video.videoId}`,
    publishedAt: `${posted}T00:00:00.000Z`,
  };
}

/** Recent uploads of one channel through the uploads playlist (1 quota unit). */
export async function fetchUploads(channel, key, { maxResults = 50, fetchImpl = fetch } = {}) {
  const playlist = 'UU' + channel.id.slice(2);
  const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  u.search = new URLSearchParams({ part: 'snippet', playlistId: playlist, maxResults: String(maxResults), key }).toString();
  const res = await fetchImpl(u);
  if (!res.ok) return { ok: false, status: res.status, items: [] };
  const j = await res.json();
  const items = (j.items ?? []).map((i) => ({
    title: i.snippet?.title ?? '',
    publishedAt: i.snippet?.publishedAt ?? '',
    videoId: i.snippet?.resourceId?.videoId ?? '',
  }));
  return { ok: true, items };
}

/** All channels -> release records. One dead channel never fails the rest. */
export async function pollPlatformChannels(key, opts = {}) {
  const records = [];
  const report = [];
  for (const channel of PLATFORM_CHANNELS) {
    try {
      const { ok, status, items } = await fetchUploads(channel, key, opts);
      if (!ok) { report.push(`${channel.name}: HTTP ${status}`); continue; }
      const found = items.map((v) => recordFromVideo(v, channel, opts.today)).filter(Boolean);
      records.push(...found);
      report.push(`${channel.name}: ${items.length} uploads, ${found.length} release titles`);
    } catch (e) {
      report.push(`${channel.name}: ${e.message}`);
    }
  }
  return { records, report };
}
