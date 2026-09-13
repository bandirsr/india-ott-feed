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
 * Pulls a title out of a headline.
 *
 * Deliberately conservative: these become provisional records that Wikipedia
 * later confirms or corrects, so a missed title is cheap and a wrong one is not.
 */
function guessTitle(headline) {
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

  for (const r of records) {
    if (r.kind !== 'release') continue;
    const key = `${r.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${r.platform}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...r, sources: [r.source], dates: r.date ? [r.date] : [] });
      continue;
    }

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

export { guessTitle, findDates, findPlatform };
