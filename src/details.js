/**
 * Director, cast, synopsis, runtime and rating.
 *
 * All of it is one TMDB call per title with `append_to_response=credits`, and
 * it is the cheapest enrichment in the project — unlike availability it never
 * changes, so a title checked once never needs checking again. A film's
 * director in 2019 is still its director.
 *
 * That permanence is why this is budgeted and cached rather than swept: the
 * cache only grows, each run pays for titles it has never seen, and the whole
 * catalogue fills in over a couple of weeks of ordinary daily runs without any
 * single run being expensive.
 *
 * Deliberately kept small. TMDB returns a large object per title and shipping
 * all of it would multiply the feed size for fields nobody reads on a list
 * row — so this takes one director, three cast members, a trimmed synopsis,
 * the runtime and the rating, and drops everything else.
 */

import { rawCall } from './tmdb.js';

/** Synopses run to several paragraphs; a list row shows two lines. */
const MAX_OVERVIEW = 400;

/**
 * Everything worth showing about one title.
 *
 * Returns null only when TMDB has no record. A title with no director or no
 * synopsis still returns an object with those fields empty — "asked, and there
 * is nothing" has to be cacheable, or every run re-asks about the same
 * thousands of sparse entries.
 */
export async function detailsFor(kind, tmdbId) {
  const full = await rawCall(`/${kind}/${tmdbId}`, { append_to_response: 'credits' });
  if (!full || full.success === false) return null;

  const crew = full.credits?.crew ?? [];
  const cast = full.credits?.cast ?? [];

  // Series credit their director per episode rather than on the show, so
  // `created_by` is the closer equivalent of a film's director.
  const director =
    kind === 'movie'
      ? (crew.find((c) => c.job === 'Director')?.name ?? null)
      : ((full.created_by ?? [])[0]?.name ?? crew.find((c) => c.job === 'Director')?.name ?? null);

  const overview = String(full.overview ?? '').trim();

  return {
    d: director,
    // Three names. A list row cannot show more, and the fourth name is the
    // one nobody recognises anyway.
    c: cast.slice(0, 3).map((p) => p.name).filter(Boolean),
    o: overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW - 1).trimEnd()}…` : overview || null,
    // Minutes. A series reports per-episode runtime, which is the useful
    // number for deciding whether to start one tonight.
    r: kind === 'movie' ? (full.runtime || null) : ((full.episode_run_time ?? [])[0] ?? null),
    // TMDB's user rating out of 10, one decimal. Suppressed below a handful of
    // votes: "10.0 from one vote" is noise wearing the costume of information.
    v: (full.vote_count ?? 0) >= 5 ? Math.round((full.vote_average ?? 0) * 10) / 10 : null,
    n: full.vote_count ?? 0,
    // Who made it, for a series -- already sitting in the same TMDB response
    // this call already pays for, so free to carry along. publish.js uses it
    // to catch a specific, otherwise-invisible mistake: a platform's own
    // Original cannot "arrive" there after the fact, so if the ledger's first
    // sighting of e.g. Netflix lands weeks after a Netflix Original's own
    // first-air date, that gap is TMDB's provider data catching up, not a
    // real later launch. Never shipped to the app -- publish-time-only.
    nw: kind === 'tv' ? (full.networks ?? []).map((n) => n.name).filter(Boolean) : undefined,
  };
}

/**
 * Fill in details for a set of titles, newest first, within a budget.
 *
 * Newest first because those are the titles someone is about to look at, and
 * because the back catalogue will get there on its own given a fortnight.
 */
export async function enrichDetails(titles, { budget = 400, have = {}, onProgress, onSave, saveEvery = 100 } = {}) {
  const cache = { ...have };
  let spent = 0;
  let added = 0;
  let sinceSave = 0;

  const queue = [...titles]
    .filter((t) => !(t.key in cache))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

  for (const title of queue) {
    if (spent >= budget) break;
    const [kind, id] = title.key.split(':');
    if (kind !== 'movie' && kind !== 'tv') continue; // wiki: entries have no TMDB record

    try {
      const details = await detailsFor(kind, id);
      cache[title.key] = details;
      spent += 1;
      if (details?.d || details?.c?.length || details?.o) added += 1;
    } catch {
      // Uncached, so a transient failure retries rather than becoming a
      // permanent "this film has no director".
      spent += 1;
    }
    /*
      Save as we go. This pass had the same defect the trailer pass did: one
      write after the loop, so an interruption at minute fifty threw away every
      request. With 11,000 titles outstanding that is an hour of work and
      11,000 API calls riding on nothing going wrong.
    */
    sinceSave += 1;
    if (onSave && sinceSave >= saveEvery) {
      onSave(cache);
      sinceSave = 0;
    }

    onProgress?.({ spent, budget, added, title: title.title });
  }

  if (onSave && sinceSave > 0) onSave(cache);

  return { cache, spent, added, remaining: Math.max(0, queue.length - spent) };
}
