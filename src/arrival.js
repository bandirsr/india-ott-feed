/**
 * Guards on an arrival date before it ships. Kept out of publish.js so it can
 * be tested without running a publish.
 */
import { providerIdForPlatformName } from './platforms.js';

/**
 * Two guards against the same root cause, at two different confidence levels.
 *
 * TMDB's own metadata (release date, a series' `networks`) and its
 * JustWatch-sourced watch-providers data do not update on the same schedule.
 * When our sweep sees a provider for the first time, the ledger records that
 * moment as the arrival -- which is right the overwhelming majority of the
 * time (that IS what "arrival" means here), and wrong whenever TMDB simply
 * took years to index a listing that was never new.
 *
 * 1. OWN_ORIGINAL_GAP_DAYS (tv only, tight threshold): a platform's own
 *    Original cannot arrive there after the fact -- it was always there.
 *    Caught live: Bāhubali: The Torchbearer, a Netflix Original documentary
 *    that first aired 2026-06-26, "arrived" in the ledger three months later,
 *    the day TMDB finally tagged Netflix as a watch provider for it at all.
 *    This has zero legitimate exceptions, so 14 days is enough margin for
 *    ordinary bootstrap timing without risking a false suppression.
 *
 * 2. LEGACY_CATALOG_GAP_DAYS (any kind, any platform, generous threshold): a
 *    catalogue title surfacing on a genuinely new platform, long after its
 *    own release, is the entire premise of this app and completely ordinary
 *    -- TMDB_FIELD_TEST in src/sources.js measured that window topping out
 *    around 6-12 months even on the slowest platforms. But a multi-YEAR gap
 *    is a different thing entirely. Caught live: 3 Monkeys, released to OTT
 *    2020-02-07, "arrived" on Prime Video in the ledger on 2026-09-17 -- six
 *    and a half years later, the day TMDB finally tagged it at all. Set well
 *    above the normal windowing range specifically so a real, if unusually
 *    slow, licensing deal never gets silently hidden.
 */
export const OWN_ORIGINAL_GAP_DAYS = 14;
export const LEGACY_CATALOG_GAP_DAYS = 400;

/**
 * 3. DIGITAL_GAP_DAYS (any kind, any platform): TMDB's India digital-release
 *    date (`dg`) is when the film first reached streaming. A platform
 *    "arrival" more than this many days AFTER it is almost always the same
 *    listing flickering out of and back into TMDB/JustWatch, not a new
 *    release. Caught live: Mass Jathara, digital 28 Nov 2025 on Netflix,
 *    "arrived" on Netflix 11 Oct 2026 and was shown under THIS WEEK (and could
 *    notify people who had saved it). Undated is true; "arrived this week" is
 *    false. The ledger now ignores short flaps itself (RETURN_WINDOW_DAYS);
 *    this catches the ones already recorded and any it cannot see. The cost is
 *    a genuinely late second-platform deal reads as undated rather than dated.
 */
export const DIGITAL_GAP_DAYS = 120;

export function arrivalOn(kind, rec, pid, on, detail, dg) {
  if (!on) return on;
  if (dg && (Date.parse(on) - Date.parse(dg)) / 86_400_000 > DIGITAL_GAP_DAYS) return null;
  if (!rec.d) return on;
  const gapDays = (Date.parse(on) - Date.parse(rec.d)) / 86_400_000;

  if (
    kind === 'tv' &&
    gapDays > OWN_ORIGINAL_GAP_DAYS &&
    detail?.nw?.some((name) => providerIdForPlatformName(name) === pid)
  ) {
    return null;
  }

  if (gapDays > LEGACY_CATALOG_GAP_DAYS) return null;

  return on;
}
