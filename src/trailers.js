/**
 * Trailers, from TMDB rather than from YouTube search.
 *
 * This project already has a YouTube trailer finder (src/youtube.js) that
 * searches, then verifies the channel against a trusted list, then checks the
 * duration to weed out pirated full films. It works — 10/10 on the sample set —
 * and it costs 101 quota units per title against a 10,000/day budget. That caps
 * a run at roughly 99 titles. There are 11,388.
 *
 * TMDB publishes the trailer itself on /movie/{id}/videos: a YouTube key, a
 * type, and an `official` flag set by TMDB's editors. One call, no quota, no
 * channel verification needed because the flag already carries it, and the same
 * licence the rest of the pipeline runs under.
 *
 * Coverage is partial and skewed the same way everything else in TMDB is —
 * about 5 in 8 of the popular Telugu titles sampled had one, and the long tail
 * mostly has none. A missing trailer is fine: the poster still renders.
 *
 * src/youtube.js stays for the cases TMDB misses. It is the right tool for
 * enriching a hundred titles that matter, and the wrong one for eleven thousand.
 */

import { rawCall } from './tmdb.js';

/** Ranked worst to best, so a higher index wins. */
const TYPE_RANK = ['Clip', 'Featurette', 'Behind the Scenes', 'Teaser', 'Trailer'];

/**
 * The best trailer for one title, or null.
 *
 * Official beats unofficial before type is considered: an unofficial upload
 * calling itself a "Trailer" is very often a fan cut or a re-upload, while an
 * official "Teaser" is genuinely from the studio.
 */
export async function trailerFor(kind, tmdbId) {
  const json = await rawCall(`/${kind}/${tmdbId}/videos`);

  const candidates = (json.results ?? []).filter(
    (v) => v.site === 'YouTube' && v.key && TYPE_RANK.includes(v.type)
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    const rank = TYPE_RANK.indexOf(b.type) - TYPE_RANK.indexOf(a.type);
    if (rank !== 0) return rank;
    // Same official flag and type: prefer the most recently published, which
    // for a re-release is usually the one people mean.
    return String(b.published_at ?? '').localeCompare(String(a.published_at ?? ''));
  });

  const best = candidates[0];
  return {
    key: best.key,
    type: best.type,
    official: Boolean(best.official),
    // Built by the app rather than stored, but recorded here so the shape is
    // obvious: https://www.youtube.com/watch?v={key}
    // and the still: https://i.ytimg.com/vi/{key}/hqdefault.jpg
  };
}

/**
 * Fill in trailers for a set of titles, newest first, up to a budget.
 *
 * Deliberately budgeted rather than exhaustive. Every title costs one request,
 * and spending 11,388 of them daily to re-confirm that a 2019 film still has
 * the same trailer is waste. Newest-first with a cap means the titles someone
 * is actually about to look at get covered, and the rest fill in over days
 * because results are cached in the ledger between runs.
 */
export async function enrichTrailers(titles, { budget = 400, have = {}, onProgress } = {}) {
  const found = { ...have };
  let spent = 0;
  let added = 0;

  // Newest first — a trailer matters most for something that just landed.
  const queue = [...titles]
    .filter((t) => !(t.key in found))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

  for (const title of queue) {
    if (spent >= budget) break;
    const [kind, id] = title.key.split(':');
    try {
      const trailer = await trailerFor(kind, id);
      spent += 1;
      // A null result is cached too. Without that, every run would re-ask about
      // the same thousands of titles that will never have one.
      found[title.key] = trailer;
      if (trailer) added += 1;
    } catch {
      // Leave it unrecorded so the next run retries; a transient 500 should not
      // permanently mark a title as having no trailer.
      spent += 1;
    }
    onProgress?.({ spent, budget, added });
  }

  return { trailers: found, spent, added, remaining: queue.length - spent };
}
