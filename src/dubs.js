/**
 * Dubbed releases on multi-language platforms.
 *
 * The gap this closes, measured: of ten titles the trade press listed as
 * Telugu OTT releases in September 2026, we had three. Five of the seven
 * misses were Tamil or Malayalam films released with a Telugu track on
 * Netflix, Prime or Sun NXT — and TMDB files those under their ORIGINAL
 * language, so a Telugu viewer never saw them.
 *
 * src/snapshot.js already handles this for single-language platforms: if it is
 * on aha, it is watchable in Telugu, because that is what aha is. Netflix
 * carries no such implication — most Tamil films on Netflix have no Telugu
 * audio at all — so the same rule applied there would fill the Telugu list
 * with films nobody can watch in Telugu. That is a worse failure than missing
 * them, because it is a claim rather than an absence.
 *
 * So this asks TMDB per title instead. Three signals were tested against four
 * known dubbed releases:
 *
 *   film            te spoken   te translation   Telugu alt title
 *   DC              yes         yes              yes   డిసి [తెలుగు]
 *   Magudam         no          yes              yes   మకుటం [Telugu]
 *   GDN             no          no               no
 *   Ananthan Kaadu  no          no               no
 *
 * The India-region alternative title is the signal worth using. Someone
 * entered a Telugu-script name for the Indian market, which happens because a
 * Telugu release exists. A `translations` entry is much weaker — TMDB has
 * translations for films that never had a dub — so it is not trusted alone.
 *
 * This recovers about half the dubbed gap. GDN and Ananthan Kaadu carry no
 * Telugu marker anywhere in TMDB, and no amount of cleverness invents one.
 * Half of a real gap, with no false claims, is the trade being made here.
 */

import { rawCall } from './tmdb.js';

/**
 * Language names as TMDB writes them in an alternative title's `type`, in
 * English and in the language's own script. Both appear in the wild: DC's
 * Telugu title is typed "తెలుగు", Magudam's is typed "Telugu".
 */
const LANGUAGE_MARKERS = {
  te: ['telugu', 'తెలుగు'],
  ta: ['tamil', 'தமிழ்'],
  ml: ['malayalam', 'മലയാളം'],
  kn: ['kannada', 'ಕನ್ನಡ'],
  hi: ['hindi', 'हिंदी', 'हिन्दी'],
  bn: ['bengali', 'bangla', 'বাংলা'],
  mr: ['marathi', 'मराठी'],
  pa: ['punjabi', 'ਪੰਜਾਬੀ'],
  gu: ['gujarati', 'ગુજરાતી'],
};

/** Source languages worth checking for dubs into other Indian languages. */
export const DUB_SOURCE_LANGUAGES = ['ta', 'ml', 'kn', 'hi'];

/**
 * Which Indian languages a film appears to be available in, beyond its own.
 *
 * Returns an array of codes, possibly empty. Empty is a real answer and is
 * cached as such — most films are not dubbed, and re-asking every day about
 * the ones that are not would be the bulk of the cost.
 */
export async function dubLanguagesFor(movieId) {
  const full = await rawCall(`/movie/${movieId}`, { append_to_response: 'alternative_titles' });
  const original = full.original_language;
  const found = new Set();

  // The strong signal: someone entered a title for the Indian market and
  // labelled which language it is in.
  for (const alt of full.alternative_titles?.titles ?? []) {
    if (alt.iso_3166_1 !== 'IN') continue;
    const type = String(alt.type ?? '').toLowerCase();
    if (!type) continue;
    for (const [code, markers] of Object.entries(LANGUAGE_MARKERS)) {
      if (code === original) continue;
      if (markers.some((m) => type.includes(m))) found.add(code);
    }
  }

  // A secondary signal, and only ever confirmatory: a language actually spoken
  // in the film that is not its original. DC has Telugu here; Magudam does not,
  // which is why this cannot stand alone.
  for (const lang of full.spoken_languages ?? []) {
    const code = lang.iso_639_1;
    if (code && code !== original && LANGUAGE_MARKERS[code]) found.add(code);
  }

  return [...found];
}

/**
 * Recent films on one platform in one source language.
 *
 * Scoped to recent releases because a dub follows its original within months,
 * and checking the whole back catalogue would cost thousands of calls to find
 * films nobody is asking about this week.
 */
export async function recentOn(providerId, languageCode, sinceISO) {
  const out = [];
  let page = 1;
  let totalPages = 1;

  while (page <= Math.min(totalPages, 5)) {
    const json = await rawCall('/discover/movie', {
      with_original_language: languageCode,
      watch_region: 'IN',
      with_watch_providers: providerId,
      'primary_release_date.gte': sinceISO,
      sort_by: 'primary_release_date.desc',
      include_adult: false,
      page,
    });
    totalPages = json.total_pages ?? 1;
    for (const r of json.results ?? []) {
      out.push({ id: r.id, title: r.title, date: r.release_date || null, poster: r.poster_path || null, original: r.original_language });
    }
    page += 1;
  }
  return out;
}

/**
 * Find dubbed releases across multi-language platforms.
 *
 * `known` is the cache of previous answers, keyed "movie:123". Pass it back in
 * and a run only pays for titles it has never seen.
 */
export async function findDubs({
  providers,
  days = 120,
  budget = 300,
  known = {},
  onProgress,
} = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const cache = { ...known };

  // Gather candidates first, deduplicated: the same Tamil film sits on three
  // platforms and must only be asked about once.
  const candidates = new Map();
  let sweeps = 0;

  for (const prov of providers) {
    for (const lang of DUB_SOURCE_LANGUAGES) {
      const films = await recentOn(prov.id, lang, since);
      sweeps += 1;
      for (const f of films) {
        const key = `movie:${f.id}`;
        if (!candidates.has(key)) candidates.set(key, f);
      }
    }
  }

  let spent = 0;
  let dubbed = 0;

  for (const [key, film] of candidates) {
    if (key in cache) {
      if (cache[key]?.length) dubbed += 1;
      continue;
    }
    if (spent >= budget) break;
    try {
      const langs = await dubLanguagesFor(film.id);
      cache[key] = langs;
      spent += 1;
      if (langs.length) dubbed += 1;
    } catch {
      // Uncached so the next run retries. A transient failure must not
      // permanently record a film as having no dub.
      spent += 1;
    }
    onProgress?.({ spent, budget, dubbed, title: film.title });
  }

  return { cache, candidates, sweeps, spent, dubbed, unchecked: Math.max(0, candidates.size - Object.keys(cache).length) };
}
