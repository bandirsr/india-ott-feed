/**
 * The third robot: Kannada, Marathi, Gujarati and Punjabi arrivals from Wikipedia.
 *
 * Why this exists. TMDB's India streaming data is the backbone of the feed, and
 * for these four languages it lags badly: TMDB lists KD - The Devil and Jindagi
 * Once More, but has no India provider for either, so the main sweep never sees
 * them arrive. No trade-press feed covers these languages either (src/sources.js).
 * Wikipedia editors do write "the film began streaming on ZEE5 from 5 June 2026",
 * with a date, on the film's own page -- and src/extract.js already parses that
 * sentence.
 *
 * What it does. Walks "List of <Language> films of <year>", reads each film page,
 * keeps the dated streaming lines, and matches the film to a real TMDB id in the
 * right language. Anything it cannot match is dropped, never invented. The
 * result is a list of release records in exactly the shape src/fresh.js builds
 * from news items, so it travels the same tested path into the feed (shown as
 * "reported", with the date) and corrects itself the day TMDB catches up.
 *
 * Honest limits: Wikipedia runs weeks behind and only has films with an English
 * article. This narrows the gap; it does not close it.
 */

import { extractAvailability, looksLikeFilm } from './extract.js';

export const LANGUAGES = [
  { code: 'kn', name: 'Kannada' },
  { code: 'mr', name: 'Marathi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'pa', name: 'Punjabi' },
];

/** Years whose list pages can hold a title that reaches OTT this year. */
export const YEARS = [2026, 2025];

/** Earliest streaming date worth keeping. Older lines are history, not news. */
export const EARLIEST = '2026-01-01';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The dated streaming lines on one article that belong to `languageName`.
 *
 * A line qualifies when it names a platform, carries an exact date inside the
 * window, is not a rights-only announcement, and either names the film's own
 * language or names none. "Dubbed Hindi version on Netflix" on a Kannada film
 * is a Hindi release, so it is skipped here rather than filed under Kannada.
 */
export function streamingRows(articleText, languageName, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!articleText || !looksLikeFilm(articleText)) return [];
  const seen = new Set();
  const out = [];
  for (const r of extractAvailability(articleText)) {
    if (r.kind !== 'ott' || r.rightsOnly) continue;
    if (!r.date || !ISO.test(r.date)) continue;
    if (r.date < EARLIEST || r.date > today) continue;
    const langs = r.languages ?? [];
    if (langs.length > 0 && !langs.includes(languageName)) continue;
    const key = `${r.platform}|${r.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ platform: r.platform, date: r.date, evidence: r.evidence ?? '' });
  }
  return out;
}

/** Wikipedia article URL for a title. */
export function wikiLink(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

/**
 * Cache -> release records for src/fresh.js's pipeline.
 *
 * Only entries that matched a TMDB film in the right language are used; the
 * match is what stops a Wikipedia title from landing on someone else's film.
 */
export function recordsFromCache(cache) {
  const records = [];
  for (const entry of Object.values(cache)) {
    if (!entry || !entry.tmdb || !Array.isArray(entry.rows)) continue;
    for (const row of entry.rows) {
      records.push({
        kind: 'release',
        title: entry.tmdb.title,
        platform: row.platform,
        languages: [entry.language],
        date: row.date,
        dateStatus: 'reported',
        provisional: false,
        confidence: 'wikipedia',
        source: 'wikipedia',
        sourceName: `Wikipedia: ${entry.wikiTitle}`,
        headline: String(row.evidence || '').replace(/^=+\s*[^=\n]+=+\s*/, '').slice(0, 200),
        link: wikiLink(entry.wikiTitle),
        publishedAt: `${row.date}T00:00:00.000Z`,
      });
    }
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}
