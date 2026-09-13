/**
 * The second robot: the platforms TMDB cannot see.
 *
 * TMDB covers every India platform an ordinary viewer would name, with one
 * exception that matters enormously in Telugu — ETV Win, a major platform with
 * originals and a large film library, absent from TMDB AND from Watchmode.
 * Anything released only there is invisible to the main sweep.
 *
 * Wikipedia can see it. Editors write "the film began streaming on ETV Win
 * from 5 September 2026" with a citation, and src/extract.js already parses
 * exactly that sentence — ETV Win has been in its platform vocabulary from the
 * start. Nothing new needs inventing; the pieces just need connecting.
 *
 * What this is, honestly:
 *
 *   - It is a month behind. Editors add the streaming line well after the fact.
 *   - It only sees films with an English Wikipedia article, so small releases
 *     are missed entirely.
 *   - It gives an EXACT date with a citation, which is better than the main
 *     sweep can do — TMDB has no arrival date at all, so for these titles
 *     Wikipedia is the only source of one.
 *
 * Partial coverage of a platform nobody else covers beats none. The app must
 * not imply otherwise, which is why these rows are marked with their source.
 */

import { resolveTitle, getExtract, getListWikitext, rawCall as wikiCall } from './wikipedia.js';

/** Wikipedia full-text search. The cheapest way to find pages naming a platform. */
async function searchPages(query, { limit = 50, offset = 0 } = {}) {
  return wikiCall({ action: 'query', list: 'search', srsearch: query, srlimit: limit, sroffset: offset });
}
import { extractAvailability, looksLikeFilm } from './extract.js';
import { rawCall } from './tmdb.js';

/**
 * Platforms worth spending Wikipedia requests on.
 *
 * Deliberately only the ones TMDB cannot see. Re-deriving Netflix availability
 * from prose when the main sweep already has it authoritatively would be slower,
 * less complete and more likely to be wrong.
 *
 * See src/platforms.js for how this list was arrived at.
 */
export const UNCOVERED_PLATFORMS = new Set(['ETV Win']);

/** Film titles out of a yearly list page. Same approach as run.js. */
export function titlesFromWikitext(wikitext) {
  const links = [...wikitext.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());

  // The list pages cite their sources inline, so the link soup contains
  // newspapers, studios and award bodies alongside the films. Resolving
  // "Deccan Herald" costs two requests and can never be a film, and the budget
  // is the scarce thing here.
  const rejected =
    /^(List of|Category:|File:|Image:|Template:|Telugu cinema|Tollywood|Cinema of|India$|Andhra Pradesh|Telangana|Hyderabad|Netflix$|ZEE5$|Amazon Prime Video$|Disney\+|SonyLIV$|aha$|Sun NXT$|ETV Win$|JioHotstar$|JioCinema$)/i;

  const notAFilm =
    /(Herald|Times of India|The Hindu|Indian Express|Deccan|Chronicle|News18|Firstpost|Hindustan Times|NDTV|Sakshi|Eenadu|Gulte|123telugu|Filmfare|Nandi Award|SIIMA|Box office|Rotten Tomatoes|IMDb|Telugu language|Andhra|Cinema|Film Chamber|Productions?$|Entertainments?$|Studios?$|Creations?$|Pictures$|Media$|Arts$|Movies$)/i;

  const seen = new Set();
  const out = [];
  for (const link of links) {
    if (rejected.test(link)) continue;
    if (notAFilm.test(link)) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    out.push(link);
  }
  return out;
}

/**
 * Find the TMDB id for a Wikipedia title, so a gap-filled row can attach to a
 * title the app already has rather than creating a duplicate entry beside it.
 *
 * Returns null when there is no confident match. A wrong match is much worse
 * than none: it would put "on ETV Win" under someone else's film.
 */
export async function matchToTmdb(wikiTitle, { language = 'te' } = {}) {
  // Wikipedia disambiguators are not part of the name anyone searches for.
  const clean = wikiTitle
    .replace(/\s*\((?:\d{4}\s+)?(?:Telugu\s+)?(?:film|movie|TV series|web series)\)\s*$/i, '')
    .trim();

  const json = await rawCall('/search/movie', { query: clean, include_adult: false });
  const results = json.results ?? [];

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(clean);

  // Exact title match in the right language only. Fuzzy matching on Indian film
  // titles produces confident nonsense — dozens of unrelated films share a word.
  const hit = results.find(
    (r) =>
      r.original_language === language &&
      (norm(r.title) === target || norm(r.original_title) === target)
  );

  if (!hit) return null;
  return {
    key: `movie:${hit.id}`,
    title: hit.title,
    date: hit.release_date || null,
    poster: hit.poster_path || null,
  };
}

/**
 * Every page on English Wikipedia that mentions the platform.
 *
 * This replaced walking "List of Telugu films of <year>" and checking all 315
 * entries one at a time. That approach cost two requests per film to find the
 * handful that mention ETV Win at all — 630 requests to maybe a dozen hits,
 * and a 140-request run found nothing because it had not reached them yet.
 *
 * Searching for the platform inverts it: Wikipedia already knows which pages
 * say "ETV Win", and there are 43 of them. Ask the question the right way round
 * and the whole job is a few dozen requests instead of hundreds, with none of
 * them wasted on films that were never going to match.
 */
export async function findPagesMentioning(platform, { limit = 200 } = {}) {
  const titles = [];
  let offset = 0;

  while (titles.length < limit) {
    const json = await searchPages(`"${platform}"`, { limit: 50, offset });
    const batch = json.query?.search ?? [];
    if (batch.length === 0) break;
    for (const hit of batch) titles.push(hit.title);
    offset += batch.length;
    if (!json.continue) break;
  }

  return titles;
}

/**
 * Check a specific set of pages for uncovered-platform releases.
 *
 * `budget` caps Wikipedia requests. Results are cached by the caller, including
 * the misses, so a second run resumes rather than restarting.
 */
export async function sweepTitles(titles, { budget = 400, seen = {}, onProgress, year = null } = {}) {

  const found = { ...seen };
  let spent = 0;
  let hits = 0;
  let errors = 0;
  const firstErrors = [];

  for (const wikiTitle of titles) {
    if (spent >= budget) break;
    const cacheKey = `${year}|${wikiTitle}`;
    if (cacheKey in found) continue;

    try {
      // Search already returned canonical page titles, so there is nothing to
      // resolve. That halves the request cost per candidate.
      const resolved = wikiTitle;

      // getExtract returns { title, text }, not a string. Passing the object
      // straight through made every single call throw inside the extractor,
      // which the catch below then swallowed as a transient error — so the
      // first run spent 121 requests, cached nothing and reported zero hits
      // while looking like it had simply found nothing.
      const article = await getExtract(resolved);
      spent += 1;
      const text = article?.text ?? '';
      if (!text || !looksLikeFilm(text)) {
        found[cacheKey] = null;
        continue;
      }

      const rows = extractAvailability(text).filter(
        (r) => r.kind === 'ott' && UNCOVERED_PLATFORMS.has(r.platform)
      );

      if (rows.length === 0) {
        // Cached as "checked, nothing here" so the next run skips it.
        found[cacheKey] = null;
        continue;
      }

      const match = await matchToTmdb(resolved);
      found[cacheKey] = {
        wikiTitle: resolved,
        year,
        // Null when TMDB has never heard of it — which is common for the small
        // films that only ever go to ETV Win, and exactly the gap being filled.
        tmdb: match,
        rows: rows.map((r) => ({
          platform: r.platform,
          language: r.language ?? 'Telugu',
          date: r.date ?? null,
        })),
      };
      hits += 1;
    } catch (err) {
      // Left uncached so the next run retries. A transient Wikipedia error must
      // not permanently mark a film as having no ETV Win release.
      //
      // Counted and reported, though. This catch silently ate a programming
      // error — an object passed where a string was expected — on every single
      // title, and the run still exited zero saying "0 found", which reads
      // exactly like a genuine absence. A swallowed error that looks like a
      // real answer is worse than a crash.
      spent += 1;
      errors += 1;
      if (errors <= 3) firstErrors.push(`${wikiTitle}: ${err.message}`);
    }

    onProgress?.({ spent, budget, hits, title: wikiTitle });
  }

  return { found, spent, hits, errors, firstErrors, total: titles.length };
}

/**
 * Turn the cache into rows the publisher can merge.
 *
 * Titles TMDB knows get attached to their existing entry. Titles it does not
 * become standalone entries keyed `wiki:<title>`, which is what makes this
 * genuinely additive rather than a footnote on data we already had.
 */
export function toFeedEntries(cache) {
  const attach = [];
  const standalone = [];

  for (const entry of Object.values(cache)) {
    if (!entry) continue;
    for (const row of entry.rows) {
      if (entry.tmdb) {
        attach.push({ key: entry.tmdb.key, platform: row.platform, date: row.date, source: 'wikipedia' });
      } else {
        standalone.push({
          key: `wiki:${entry.wikiTitle.replace(/\s+/g, '_')}`,
          title: entry.wikiTitle.replace(/\s*\([^)]*\)\s*$/, '').trim(),
          date: null,
          platform: row.platform,
          arrived: row.date,
          language: row.language,
          source: 'wikipedia',
        });
      }
    }
  }

  return { attach, standalone };
}
