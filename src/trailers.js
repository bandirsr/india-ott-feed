/**
 * Trailers, one per language.
 *
 * Two things were wrong with the first version, and the second was invisible.
 *
 * It asked /videos with no language parameter, which quietly means en-US. For
 * an Indian catalogue that returns the wrong trailer: Kalki 2898 AD carries
 * five separate release trailers -- Telugu, Tamil, Hindi, Malayalam, Kannada --
 * and a Tamil viewer was getting an English-subtitled cut.
 *
 * The fix looked like `include_video_language`, which promises every language
 * in one request. It does not deliver reliably. With the list ordered one way
 * TMDB returned zero videos and no error; ordered another way it returned only
 * English. Nothing in the response says a request was ignored, so coverage
 * quietly collapsed -- 11 of 12 sampled "this title has no trailer" records
 * turned out to have one sitting there.
 *
 * So this makes plain requests instead: one for TMDB's default (English in
 * practice), plus one `language=xx-IN` per language the title is actually
 * listed under. A title in one language costs two calls, the handful in four
 * cost five, and every call either works or throws. Predictable beats clever,
 * especially when the clever version fails silently.
 */

import { rawCall } from './tmdb.js';

/** Ranked worst to best, so a higher index wins. */
const TYPE_RANK = ['Clip', 'Featurette', 'Behind the Scenes', 'Teaser', 'Trailer'];

/** The languages the app has lists for, plus English and untagged as fallback. */
export const VIDEO_LANGUAGES = ['te', 'hi', 'ta', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu'];

/** Best of a set of candidates: official first, then type, then most recent. */
export function pickBest(videos) {
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
export async function trailersFor(kind, tmdbId, languages = []) {
  /*
   * Two kinds of request, because `include_video_language` cannot be trusted.
   *
   * Passing every language in one call looked elegant and behaved erratically:
   * with the list ordered one way TMDB returned zero videos and no error, the
   * other way it returned only English. It silently cost coverage on titles
   * that plainly had trailers -- 11 of 12 sampled "no trailer" records turned
   * out to have one.
   *
   * So: one plain request for whatever TMDB considers default (English, in
   * practice), plus one `language=xx-IN` request per language the title is
   * actually listed under. A title in one language costs two calls; the
   * handful in four cost five. Predictable beats clever.
   */
  const out = {};

  const base = await rawCall(`/${kind}/${tmdbId}/videos`);
  const fallback = pickBest(base.results ?? []);
  if (fallback) out._ = fallback;

  for (const lang of languages) {
    if (!VIDEO_LANGUAGES.includes(lang)) continue;
    try {
      const j = await rawCall(`/${kind}/${tmdbId}/videos`, { language: `${lang}-IN` });
      const key = pickBest((j.results ?? []).filter((v) => v.iso_639_1 === lang));
      if (key) out[lang] = key;
    } catch {
      // One language failing must not lose the others, or the fallback.
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The right key for a language, in order of preference.
 *
 * The first version stopped at `entry._` and returned null after that, which
 * threw away trailers we had already fetched and cached. It cost 52 published
 * rows: every one a dubbed title whose only trailer is tagged with its ORIGINAL
 * language. "Vishwanath & Sons" is Tamil, listed under Telugu, and TMDB has one
 * trailer for it -- in Tamil. We had the key in the cache and published null.
 *
 * Preference order, and why:
 *   1. the reader's own language      -- obviously best
 *   2. the film's original language   -- for a Tamil film dubbed into Telugu, a
 *                                        Tamil trailer beats an English one
 *   3. `_`, TMDB's default            -- English or untagged
 *   4. anything at all                -- a trailer in the wrong language still
 *                                        shows you the film; nothing shows you
 *                                        nothing. Sorted, so the choice is
 *                                        stable between builds rather than
 *                                        depending on key insertion order.
 */
export function trailerKeyFor(entry, languageCode, originLanguage) {
  if (!entry) return null;
  // Tolerates the old shape, where an entry was a single { key } object, so a
  // half-migrated cache degrades rather than throwing.
  if (typeof entry.key === 'string') return entry.key;

  if (entry[languageCode]) return entry[languageCode];
  if (originLanguage && entry[originLanguage]) return entry[originLanguage];
  if (entry._) return entry._;

  const rest = Object.keys(entry).filter((k) => k !== '_').sort();
  return rest.length > 0 ? entry[rest[0]] : null;
}

/**
 * Fill in trailers for a set of titles, newest first, within a budget.
 *
 * Newest first because those are the titles someone is about to look at, and
 * the back catalogue fills in over subsequent days. Results — including "this
 * one has none" — are cached so a run never re-asks.
 */
export async function enrichTrailers(titles, { budget = 400, have = {}, onProgress, onSave, saveEvery = 100 } = {}) {
  const found = { ...have };
  let spent = 0;
  let added = 0;
  let sinceSave = 0;

  const queue = [...titles]
    .filter((t) => !(t.key in found))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

  for (const title of queue) {
    if (spent >= budget) break;
    const [kind, id] = title.key.split(':');
    if (kind !== 'movie' && kind !== 'tv') continue;

    try {
      const entry = await trailersFor(kind, id, title.languages ?? []);
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

    /*
     * Save as we go, not at the end.
     *
     * A full pass is ~27,000 requests over forty minutes. Writing only on
     * completion meant a crash, a network drop or a Ctrl-C at minute
     * thirty-nine threw away every one of them -- and this runs unattended in
     * CI, where nobody is watching to restart it.
     *
     * Every hundred titles costs one file write and caps the loss at a hundred
     * requests. The cache is keyed by title, so a half-finished run simply
     * resumes where it stopped.
     */
    sinceSave += 1;
    if (onSave && sinceSave >= saveEvery) {
      onSave(found);
      sinceSave = 0;
    }

    onProgress?.({ spent, budget, added });
  }

  if (onSave && sinceSave > 0) onSave(found);

  return { trailers: found, spent, added, remaining: Math.max(0, queue.length - spent) };
}
