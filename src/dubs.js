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
 * Candidates from the pipeline's OWN sweep, not a fresh TMDB search.
 *
 * The first version ran `/discover/movie` per platform per source language,
 * scoped to films released in the last 120 days. Measured against a live
 * catalogue: 71 multi-language platforms x 4 source languages ever produced
 * 50 unique candidates, total, in the entire time this ran. Ten turned out to
 * be dubbed -- which is why "This month" for Telugu showed one title. The
 * question was never whether the check was accurate; it barely ever ran.
 *
 * The main sweep in snapshot.js already discovers every Tamil, Malayalam,
 * Kannada and Hindi film on every tracked platform, because that is what
 * building the Tamil/Malayalam/Kannada/Hindi lists requires. Checked against
 * that same data: the Tamil feed alone holds 1,830 Tamil-original films
 * already sitting on a multi-language platform. The candidates were never
 * missing. A second, narrower search was going looking for them instead of
 * reading the pipeline's own snapshot.
 *
 * `rec.l` is reliable as "this film's original language" for exactly the
 * films this needs: anything the main sweep found via `with_original_language`
 * carries that language in `l`, and a title only reaches `also`/`ol` when it
 * was found under a DIFFERENT language than its own -- so `l` unfiltered by
 * either of those is the original.
 *
 * Movies only, matching dubLanguagesFor below, which calls `/movie/{id}`. Web
 * series would need the equivalent `/tv/{id}` call and are left for later
 * rather than guessed at.
 */
export function candidatesFromSnapshot(snapshot, multiLangProviderIds) {
  const candidates = new Map();
  for (const [key, rec] of Object.entries(snapshot.titles)) {
    if (!key.startsWith('movie:')) continue;
    if (!DUB_SOURCE_LANGUAGES.includes(rec.l)) continue;
    if (!rec.p.some((id) => multiLangProviderIds.has(id))) continue;
    candidates.set(key, {
      id: Number(key.slice('movie:'.length)),
      title: rec.t,
      date: rec.d,
      original: rec.l,
    });
  }
  return candidates;
}

/**
 * Find dubbed releases across multi-language platforms.
 *
 * `known` is the cache of previous answers, keyed "movie:123". Pass it back in
 * and a run only pays for titles it has never seen. Newest releases first, the
 * same ordering every other pass in this pipeline uses -- a fresh release is
 * what someone is looking for today, and the back catalogue fills in over
 * subsequent runs.
 */
export async function findDubs({
  snapshot,
  multiLangProviderIds,
  budget = 300,
  known = {},
  onProgress,
  onSave,
  saveEvery = 100,
} = {}) {
  const cache = { ...known };
  const candidates = candidatesFromSnapshot(snapshot, multiLangProviderIds);

  const ordered = [...candidates.entries()].sort(
    (a, b) => String(b[1].date ?? '').localeCompare(String(a[1].date ?? ''))
  );

  let spent = 0;
  let dubbed = 0;
  let sinceSave = 0;

  for (const [key, film] of ordered) {
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

    // Save as we go. The candidate pool went from 50 to several thousand with
    // this change, so a run can now be long enough that losing it all to an
    // interruption is a real cost rather than a theoretical one -- the same
    // lesson the trailer and details passes already paid for today.
    sinceSave += 1;
    if (onSave && sinceSave >= saveEvery) {
      onSave(cache);
      sinceSave = 0;
    }

    onProgress?.({ spent, budget, dubbed, title: film.title });
  }

  if (onSave && sinceSave > 0) onSave(cache);

  return { cache, candidates, spent, dubbed, unchecked: Math.max(0, candidates.size - Object.keys(cache).length) };
}
