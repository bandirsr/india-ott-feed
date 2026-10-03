/**
 * The day a film reached OTT in India, from TMDB's own release records.
 *
 * TMDB files several kinds of release date per country. Type 3 is the cinema
 * release, which is what `primary_release_date` reports and what this app used
 * to fall back on. Type 4 is the digital release, which for a film that went
 * from cinemas to streaming is the day it became watchable at home. That is the
 * date this app is actually about.
 *
 * The watch-provider ledger only knows arrivals from the day tracking began, so
 * every film already streaming by then had no date at all. This fills that gap
 * with a real one instead of leaving the film undated or borrowing its cinema
 * date.
 *
 * It is the film's first digital release, not a per-platform date: a film that
 * hit Prime on the 1st and Netflix on the 20th carries the 1st. The ledger's
 * own per-platform `on` date, where it exists, still wins in the app.
 *
 * Cached like details.js, with one difference: "no digital date yet" is not a
 * permanent answer for a recent film, because TMDB gains the date after the
 * film lands. Recent films with no date are re-asked weekly; old films with
 * none are left alone.
 */

import { rawCall } from './tmdb.js';

const RECHECK_AFTER_DAYS = 7;
/** A film older than this with no digital date is not going to get one. */
const STILL_PENDING_DAYS = 180;

const DAY = 86_400_000;
const day = (iso) => Date.parse(`${iso}T00:00:00Z`);

/** Earliest India digital release (TMDB type 4) as YYYY-MM-DD, or null. */
export async function digitalFor(tmdbId) {
  const json = await rawCall(`/movie/${tmdbId}/release_dates`);
  const india = (json.results ?? []).find((r) => r.iso_3166_1 === 'IN');
  const dates = (india?.release_dates ?? [])
    .filter((r) => r.type === 4 && r.release_date)
    .map((r) => r.release_date.slice(0, 10))
    .sort();
  return dates[0] ?? null;
}

/** Does this title still need asking about? Pure, so it can be tested. */
export function needsCheck(entry, cinemaDate, todayIso) {
  if (!entry) return true;
  if (entry.g) return false;
  const stillPending = !cinemaDate || (day(todayIso) - day(cinemaDate)) / DAY <= STILL_PENDING_DAYS;
  if (!stillPending) return false;
  return (day(todayIso) - day(entry.c)) / DAY >= RECHECK_AFTER_DAYS;
}

/**
 * Fill in digital dates for movies, newest first, within a budget.
 * Series are skipped: they are placed by network and have no digital release.
 */
export async function enrichDigital(titles, { budget = 600, have = {}, onProgress, onSave, saveEvery = 100, today } = {}) {
  const todayIso = today ?? new Date().toISOString().slice(0, 10);
  const cache = { ...have };
  let spent = 0;
  let found = 0;
  let sinceSave = 0;

  const queue = titles
    .filter((t) => t.key.startsWith('movie:') && needsCheck(cache[t.key], t.date, todayIso))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

  for (const title of queue) {
    if (spent >= budget) break;
    try {
      const g = await digitalFor(title.key.slice(6));
      cache[title.key] = { g, c: todayIso };
      if (g) found += 1;
    } catch {
      // Left uncached, so a transient failure retries on the next run rather
      // than becoming a permanent "no digital date".
    }
    spent += 1;
    sinceSave += 1;
    if (onSave && sinceSave >= saveEvery) {
      onSave(cache);
      sinceSave = 0;
    }
    onProgress?.({ spent, budget, found, title: title.title });
  }

  if (onSave && sinceSave > 0) onSave(cache);
  return { cache, spent, found, remaining: Math.max(0, queue.length - spent) };
}
