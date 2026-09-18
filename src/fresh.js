/**
 * The fast layer: turning news feed items into provisional release records.
 *
 * Wikipedia is authoritative but roughly a month late, and blind to dubbed
 * releases and web series entirely. This layer is the opposite — same-day, wide
 * coverage, and far less certain. So everything it produces is marked
 * `dateStatus: 'reported'` and `provisional: true`, and Wikipedia overrides it
 * later when the two disagree.
 *
 * Headlines are terser than Wikipedia prose and use a different grammar:
 *   "Suriya's Vishwanath and Sons Gets Its OTT Release Date"
 *   "Panchanama OTT Release: ZEE5 – September 11, 2026"
 *   "Mister Middle Class premieres on aha on August 19"
 * so this has its own patterns rather than reusing the article parser.
 */

import { PLATFORMS } from './extract.js';
import { rawCall } from './tmdb.js';
import { providerIdForPlatformName } from './platforms.js';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const LANGUAGES = ['Telugu', 'Tamil', 'Malayalam', 'Kannada', 'Hindi', 'English', 'Bengali', 'Marathi'];

/** Only the streaming services — a TV channel premiere is not availability. */
const OTT_PLATFORMS = PLATFORMS.filter((p) => p.kind === 'ott');

function findPlatform(text) {
  const hits = [];
  for (const p of OTT_PLATFORMS) {
    for (const alias of p.aliases) {
      const re = new RegExp(`\\b${alias.replace(/[+.*?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const m = re.exec(text);
      if (m) {
        hits.push({ canonical: p.canonical, index: m.index });
        break;
      }
    }
  }
  return hits.filter(
    (h) => !hits.some((o) => o !== h && o.canonical.length > h.canonical.length && o.canonical.toLowerCase().includes(h.canonical.toLowerCase()))
  );
}

/**
 * Headlines drop the year constantly — "premieres on aha on August 19". The
 * year is inferred from when the item was published, which is nearly always
 * right for a release announcement, and never silently guessed further than
 * that: a date more than 60 days ahead of publication is rejected rather than
 * assumed to be next year.
 */
function findDates(text, publishedAt) {
  const pubDate = publishedAt ? new Date(publishedAt) : new Date();
  const pubYear = Number.isFinite(pubDate.getTime()) ? pubDate.getFullYear() : new Date().getFullYear();
  const found = [];

  const patterns = [
    // 19 August 2026 / 19 August
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s*(\d{4})?\b/g,
    // August 19, 2026 / August 19
    /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})?\b/g,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      let day, monthName, year;
      if (/^\d/.test(m[1])) [, day, monthName, year] = m;
      else [, monthName, day, year] = m;

      const month = MONTHS[String(monthName).toLowerCase()];
      if (!month) continue;
      const d = Number(day);
      if (d < 1 || d > 31) continue;

      let y = year ? Number(year) : pubYear;
      if (!year) {
        // A December article announcing a January date means next year.
        const candidate = new Date(Date.UTC(y, month - 1, d));
        const aheadDays = (candidate.getTime() - pubDate.getTime()) / 86_400_000;
        if (aheadDays < -300) y += 1;
      }
      if (y < 2015 || y > 2100) continue;

      const iso = `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const ahead = (Date.parse(iso) - pubDate.getTime()) / 86_400_000;
      // Announcements look forward a little and back a lot; anything further
      // ahead than two months is almost certainly a different kind of date.
      if (ahead > 60) continue;

      found.push({ iso, index: m.index });
    }
  }

  return found.sort((a, b) => a.index - b.index);
}

function findLanguages(text) {
  return LANGUAGES.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(text));
}

/** Signals the item is about something becoming watchable, not about a deal or a trailer. */
const RELEASE_SIGNALS =
  /\b(ott release|digital release|streaming (?:now|from|on|today)|now streaming|premieres? on|premiered on|starts streaming|out now on|available (?:now )?on|drops on|lands on|watch(?: it)? on)\b/i;

const NOT_A_RELEASE =
  /\b(trailer|teaser|first look|song|lyrical|poster|review|box office|collection|rumou?r|may |could |expected to|likely|shooting|wrapped|announcement of|audio launch)\b/i;

/**
 * A title set off in quotes somewhere inside the headline -- "OTT Alert: Ravi
 * Teja's Blockbuster 'Irumudi' Lands on Netflix in 5 Languages". Entertainment
 * headlines quote the film name constantly, in front of arbitrary framing text
 * (an outlet name, "Alert:", an actor credit) that the verb-stripping approach
 * below cannot anticipate every shape of. A quoted span is unambiguous where
 * guessing the sentence structure is not, so it is tried first.
 */
function quotedTitle(headline) {
  const m = /['‘’"“”]([A-Z][^'‘’"“”]{1,45}?)['‘’"“”]/.exec(headline);
  if (!m) return null;
  const candidate = m[1].trim();
  // A whole clause in quotes ("... says the film 'will release on Netflix'")
  // is a quotation, not a title -- five-plus words is treated as prose.
  if (candidate.split(/\s+/).length > 4) return null;
  return candidate;
}

/**
 * Pulls a title out of a headline.
 *
 * Deliberately conservative: these become provisional records that Wikipedia
 * later confirms or corrects, so a missed title is cheap and a wrong one is not.
 * Wrong is still guarded against even when a title is guessed here -- see
 * matchFreshTitle, which only ever accepts an exact match against a real TMDB
 * title, so a bad guess simply fails to match rather than attaching to the
 * wrong film.
 */
function guessTitle(headline) {
  const quoted = quotedTitle(headline);
  if (quoted) return quoted;

  let t = headline;

  // "Panchanama OTT Release: ZEE5 – September 11, 2026" -> "Panchanama"
  t = t.replace(/\s*(?:ott|digital)\s*release.*$/i, '');
  // "Suriya's Vishwanath and Sons Gets Its OTT Release Date" -> before the verb
  t = t.replace(/\s+(?:gets|to get|confirmed|announced|is now|now)\b.*$/i, '');
  // "Mister Middle Class premieres on aha on August 19" -> before the verb
  t = t.replace(/\s+(?:premieres?|premiered|starts? streaming|now streaming|streaming|drops?|lands?|available|out)\b.*$/i, '');
  // Strip a leading possessive attribution: "Suriya's X" -> "X"
  t = t.replace(/^[A-Z][\w.]*(?:\s+[A-Z][\w.]*)?['’]s\s+/, '');
  // Trailing punctuation and separators
  t = t.replace(/\s*[–—:|-]\s*$/, '').replace(/["“”]/g, '').trim();

  return t;
}

/**
 * Extracts release records from one feed item.
 *
 * Returns [] for round-up posts — "Top OTT Releases This Weekend (Sept 11–13)"
 * names no title in its headline and its body is an article, not data. Those
 * are flagged separately for a human or an AI pass rather than guessed at.
 */
export function extractFromItem(item, source) {
  const headline = item.title ?? '';
  const body = `${headline}. ${item.description ?? ''}`;

  if (NOT_A_RELEASE.test(headline)) return [];

  const isRoundup = /\b(top ott|ott releases this|releases this week|titles this week|this weekend|new releases|what to watch)\b/i.test(headline);
  if (isRoundup) {
    return [
      {
        kind: 'roundup',
        source: source.id,
        headline,
        link: item.link,
        publishedAt: item.publishedAt,
      },
    ];
  }

  if (!RELEASE_SIGNALS.test(body)) return [];

  const platforms = findPlatform(body);
  if (platforms.length === 0) return [];

  const dates = findDates(body, item.publishedAt);
  const languages = findLanguages(body);
  const title = guessTitle(headline);
  if (!title || title.length < 2) return [];

  return platforms.map((p) => ({
    kind: 'release',
    title,
    platform: p.canonical,
    // Headlines often omit it; Telugu is not assumed, it is left unknown.
    languages: languages.length > 0 ? languages : [],
    date: dates[0]?.iso ?? null,
    dateStatus: 'reported',
    provisional: true,
    source: source.id,
    sourceName: source.name,
    headline,
    link: item.link,
    publishedAt: item.publishedAt,
  }));
}

/**
 * Merges records that describe the same thing.
 *
 * Two outlets reporting the same release is the corroboration this layer needs,
 * so agreement is counted rather than deduplicated away.
 */
export function mergeReleases(records) {
  const byKey = new Map();
  const now = new Date().toISOString();

  for (const r of records) {
    if (r.kind !== 'release') continue;
    const key = `${r.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${r.platform}`;
    const existing = byKey.get(key);

    if (!existing) {
      // Set once, from whichever record created the entry -- carried forward
      // untouched on every later update, so it always answers "when did we
      // first hear about this" rather than "when did we last see it repeated".
      byKey.set(key, {
        ...r,
        sources: [r.source],
        dates: r.date ? [r.date] : [],
        firstSeenAt: r.firstSeenAt ?? r.publishedAt ?? now,
        lastSeenAt: now,
      });
      continue;
    }

    existing.lastSeenAt = now;
    if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
    if (r.date && !existing.dates.includes(r.date)) existing.dates.push(r.date);
    for (const l of r.languages) if (!existing.languages.includes(l)) existing.languages.push(l);
  }

  return [...byKey.values()].map((r) => {
    const agreed = r.dates.length === 1;
    return {
      ...r,
      date: r.dates[0] ?? null,
      conflictingDates: r.dates.slice(1),
      sourceCount: r.sources.length,
      // Two independent outlets naming the same platform is enough to state it;
      // one is a lead worth keeping but not worth asserting.
      confidence: r.sources.length >= 2 ? (agreed ? 'high' : 'platform-only') : 'single-source',
    };
  });
}

const LANGUAGE_CODES = {
  Telugu: 'te', Tamil: 'ta', Malayalam: 'ml', Kannada: 'kn', Hindi: 'hi',
  Bengali: 'bn', Marathi: 'mr', English: 'en',
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A headline's guessed title to a real TMDB film, the same way gapfill.js
 * confirms a Wikipedia title: an exact normalised match on title OR
 * original_title, never a fuzzy one.
 *
 * This is the safety valve for the whole fast layer. guessTitle() regularly
 * produces junk from a headline it could not fully parse -- "#Love on OTT:
 * Netflix Reveals Release Date and" is not a film title -- and junk simply
 * fails to match anything on TMDB and is dropped here. A wrong match would be
 * far worse than a missed one: it would attach someone else's platform to
 * this film's page.
 */
export async function matchFreshTitle(title, languages = []) {
  const clean = String(title ?? '').trim();
  if (clean.length < 2) return null;

  const json = await rawCall('/search/movie', { query: clean, include_adult: false });
  const results = json.results ?? [];
  const target = norm(clean);
  const candidates = results.filter((r) => norm(r.title) === target || norm(r.original_title) === target);
  if (candidates.length === 0) return null;

  const codes = languages.map((l) => LANGUAGE_CODES[l]).filter(Boolean);
  const byLanguage = codes.length > 0 ? candidates.find((r) => codes.includes(r.original_language)) : null;
  const hit = byLanguage ?? [...candidates].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];

  return {
    key: `movie:${hit.id}`,
    title: hit.title,
    date: hit.release_date || null,
    poster: hit.poster_path || null,
    language: hit.original_language,
  };
}

/**
 * News reports to rows publish.js can fold into the catalogue.
 *
 * Deliberately does not assert an arrival date. "Premieres on aha on August
 * 19" and "now streaming on Netflix" both produce a date here, but neither
 * is the confirmed day the ledger records for everything else -- one is an
 * announcement of a future date, the other just means "when this was
 * written". Claiming either as an arrival date risks a wrong one sitting
 * next to the ledger's exact ones with no visible difference. This layer's
 * job is to say "reported, not yet confirmed" a few days before TMDB agrees;
 * the date always lands from the source of record.
 */
export async function resolveFreshReports(releases) {
  const out = [];
  for (const r of releases ?? []) {
    if (!r.title || !r.platform) continue;
    const providerId = providerIdForPlatformName(r.platform);
    if (providerId == null) continue;

    const match = await matchFreshTitle(r.title, r.languages ?? []);
    if (!match) continue;

    out.push({
      key: match.key,
      title: match.title,
      date: match.date,
      poster: match.poster,
      language: match.language,
      platform: r.platform,
      providerId,
      sourceName: r.sourceCount >= 2 ? `${r.sourceCount} sources` : (r.sourceName ?? r.source),
    });
  }
  return out;
}

export { guessTitle, findDates, findPlatform };
