/**
 * Trailers, one per language.
 *
 * The first version of this asked TMDB for /movie/{id}/videos with no language
 * parameter, which quietly means "en-US". For an Indian catalogue that is the
 * wrong question twice over:
 *
 *   - Coverage collapsed. Only English-tagged videos came back, so a film with
 *     a perfectly good Telugu trailer and no English one looked like it had
 *     none. Measured on ten popular Telugu titles: 6/10 had a trailer the old
 *     way, 7/10 the new way, and the ones that had any got two to four times
 *     as many candidates.
 *
 *   - The language was wrong. Kalki 2898 AD carries five separate release
 *     trailers — Telugu, Tamil, Hindi, Malayalam, Kannada. Asking without a
 *     language returned an English-subtitled cut, so a Tamil viewer tapping
 *     "trailer" on the Tamil list got the wrong one.
 *
 * `include_video_language` fixes both in a single request: pass every language
 * the app supports and TMDB returns the lot, each tagged with its own
 * iso_639_1. The result is stored per language, and publish.js hands each
 * language file the trailer that belongs to it.
 *
 * Still one call per title, so the cost is unchanged.
 */

import { rawCall } from './tmdb.js';

/** Ranked worst to best, so a higher index wins. */
const TYPE_RANK = ['Clip', 'Featurette', 'Behind the Scenes', 'Teaser', 'Trailer'];

/** The languages the app has lists for, plus English and untagged as fallback. */
export const VIDEO_LANGUAGES = ['te', 'hi', 'ta', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu'];
const REQUEST_LANGUAGES = [...VIDEO_LANGUAGES, 'en', 'null'].join(',');

/** Best of a set of candidates: official first, then type, then most recent. */
function pickBest(videos) {
  const pool = videos.filter((v) => v.site === 'YouTube' && v.key && TYPE_RANK.includes(v.type));
  if (pool.length === 0) return null;

  pool.sort((a, b) => {
    // Official beats unofficial before type is considered: an unofficial
    // "Trailer" is very often a fan cut, while an official "Teaser" is genuinely
    // from the studio.
    if (a.official !== b.official) return a.official ? -1 : 1;
    const rank = TYPE_RANK.indexOf(b.type) - TYPE_RANK.indexOf(a.type);
    if (rank !== 0) return rank;
    return String(b.published_at ?? '').localeCompare(String(a.published_at ?? ''));
  });

  return pool[0].key;
}

/**
 * Trailer keys for one title, keyed by language.
 *
 * `_` is the fallback used when a language has no trailer of its own — an
 * English or untagged one, which is better than showing nothing. A language
 * key is only set when a trailer genuinely exists in that language, so the app
 * can tell the difference if it ever needs to.
 */
export async function trailersFor(kind, tmdbId) {
  const json = await rawCall(`/${kind}/${tmdbId}`, {
    append_to_response: 'videos',
    include_video_language: REQUEST_LANGUAGES,
  });

  const all = json.videos?.results ?? [];
  if (all.length === 0) return null;

  const out = {};
  for (const lang of VIDEO_LANGUAGES) {
    const key = pickBest(all.filter((v) => v.iso_639_1 === lang));
    if (key) out[lang] = key;
  }

  const fallback = pickBest(all.filter((v) => !VIDEO_LANGUAGES.includes(v.iso_639_1)));
  if (fallback) out._ = fallback;

  return Object.keys(out).length > 0 ? out : null;
}

/** The right key for a language: its own, else the fallback. */
export function trailerKeyFor(entry, languageCode) {
  if (!entry) return null;
  // Tolerates the old shape, where an entry was a single { key } object, so a
  // half-migrated cache degrades rather than throwing.
  if (typeof entry.key === 'string') return entry.key;
  return entry[languageCode] ?? entry._ ?? null;
}

/**
 * Fill in trailers for a set of titles, newest first, within a budget.
 *
 * Newest first because those are the titles someone is about to look at, and
 * the back catalogue fills in over subsequent days. Results — including "this
 * one has none" — are cached so a run never re-asks.
 */
export async function enrichTrailers(titles, { budget = 400, have = {}, onProgress } = {}) {
  const found = { ...have };
  let spent = 0;
  let added = 0;

  const queue = [...titles]
    .filter((t) => !(t.key in found))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

  for (const title of queue) {
    if (spent >= budget) break;
    const [kind, id] = title.key.split(':');
    if (kind !== 'movie' && kind !== 'tv') continue;

    try {
      const entry = await trailersFor(kind, id);
      spent += 1;
      // A null result is cached too. Without that, every run would re-ask about
      // the same thousands of titles that will never have one.
      found[title.key] = entry;
      if (entry) added += 1;
    } catch {
      // Leave it unrecorded so the next run retries; a transient failure should
      // not permanently mark a title as having no trailer.
      spent += 1;
    }
    onProgress?.({ spent, budget, added });
  }

  return { trailers: found, spent, added, remaining: Math.max(0, queue.length - spent) };
}
