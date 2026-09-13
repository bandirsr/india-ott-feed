/**
 * The guard that stops a bad day from becoming permanent damage.
 *
 * The ledger works by treating "in yesterday's record, missing from today's
 * sweep" as a departure. That is correct when the sweep is correct, and
 * catastrophic when it is not. If TMDB has an outage, rate-limits us halfway,
 * revokes the key, renames a field, or simply returns empty pages, the sweep
 * comes back small — and the ledger dutifully records that twenty thousand
 * titles left every platform on the same morning, deleting the arrival dates
 * that took months to accumulate. There is no way to recompute them: TMDB
 * cannot be asked what was true last Tuesday.
 *
 * So a sweep has to earn the right to be believed before it is written. A run
 * that fails these checks exits non-zero, which fails the GitHub Action, which
 * emails the account owner. Nothing is written. Tomorrow's run picks up as if
 * today had not happened — one lost day, not a lost archive.
 *
 * Losing a day costs the arrival dates for titles that landed that day and
 * nothing else. That is the cheap failure, and it is the one worth designing
 * for.
 */

/** Below this share of the previous run's titles, a sweep is presumed broken. */
const MIN_TITLE_RATIO = 0.7;

/** More departures than this in one day is not a licensing event. */
const MAX_DEPARTURE_RATIO = 0.2;

/** A sweep that found nothing at all is always wrong. */
const MIN_ABSOLUTE_TITLES = 500;

/**
 * Decide whether today's sweep can be trusted.
 *
 * `ledger` may be null on the very first run, when there is nothing to compare
 * against and only the absolute floor applies.
 */
export function sanityCheck(ledger, snapshot, { departures = 0 } = {}) {
  const titleCount = Object.keys(snapshot.titles ?? {}).length;
  const pairCount = Object.values(snapshot.titles ?? {}).reduce((n, r) => n + r.p.length, 0);
  const problems = [];

  if (titleCount < MIN_ABSOLUTE_TITLES) {
    problems.push(
      `Only ${titleCount} titles swept (floor is ${MIN_ABSOLUTE_TITLES}). TMDB is almost certainly failing or the key has been revoked.`
    );
  }

  if (!snapshot.providers || Object.keys(snapshot.providers).length === 0) {
    problems.push('No providers resolved. The provider endpoint failed, so every title would look orphaned.');
  }

  if (ledger) {
    const before = ledger.pairCount ?? Object.keys(ledger.seen ?? {}).length;

    if (before > 0 && pairCount < before * MIN_TITLE_RATIO) {
      const pct = Math.round((1 - pairCount / before) * 100);
      problems.push(
        `Title-platform pairs fell ${pct}% (${before} to ${pairCount}). A real catalogue does not shrink like that in a day.`
      );
    }

    if (before > 0 && departures > before * MAX_DEPARTURE_RATIO) {
      const pct = Math.round((departures / before) * 100);
      problems.push(
        `${departures} departures, ${pct}% of the archive. Licences lapse a few at a time, not in thousands.`
      );
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    titleCount,
    pairCount,
    departures,
  };
}

/**
 * Is the published data still being refreshed?
 *
 * Separate from the sweep guard because it catches the opposite failure: not a
 * bad run, but no run at all. A cancelled schedule, an expired key, a repo gone
 * private — all of them look like silence, and silence is invisible unless
 * something checks for it.
 *
 * The app also reads this idea: the feed carries its version date, so a client
 * can tell the user the list is stale rather than quietly showing old data
 * forever.
 */
export function freshness(ledger, { today = new Date().toISOString().slice(0, 10), staleAfterDays = 3 } = {}) {
  if (!ledger?.updatedOn) return { ok: false, ageDays: null, message: 'No ledger — nothing has ever run.' };

  const ageDays = Math.round((Date.parse(today) - Date.parse(ledger.updatedOn)) / 86_400_000);
  const ok = ageDays <= staleAfterDays;

  return {
    ok,
    ageDays,
    lastRun: ledger.updatedOn,
    runs: ledger.runs ?? 0,
    message: ok
      ? `Last swept ${ageDays} day(s) ago.`
      : `STALE: last swept ${ageDays} days ago (${ledger.updatedOn}). The daily job is not running.`,
  };
}
