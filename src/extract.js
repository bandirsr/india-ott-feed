/**
 * Turns Wikipedia prose into structured availability records.
 *
 * The facts only exist as English sentences, e.g.
 *   "The film began streaming on Netflix from 8 November 2024 in Telugu and
 *    dubbed versions of Tamil, Malayalam and Kannada languages."
 *
 * This is deterministic rather than AI-driven, on purpose: the sentences are
 * formulaic, a regex parser is testable against known cases, it costs nothing,
 * and it never invents a platform that was not in the text. An AI pass is a
 * sensible *fallback* for the unusual phrasings this misses — not the default.
 *
 * The parser records the exact sentence it drew each claim from, so every field
 * in the output can be traced back to its evidence.
 */

/**
 * Platform vocabulary. Order matters: longer names are matched first so
 * "Disney+ Hotstar" never gets mis-read as bare "Hotstar".
 */
const PLATFORMS = [
  { canonical: 'Amazon Prime Video', kind: 'ott', aliases: ['Amazon Prime Video', 'Prime Video', 'Amazon Prime'] },
  { canonical: 'Disney+ Hotstar', kind: 'ott', aliases: ['Disney+ Hotstar', 'Disney Plus Hotstar', 'Disney+ Hotstar'] },
  { canonical: 'JioHotstar', kind: 'ott', aliases: ['JioHotstar', 'Jio Hotstar'] },
  { canonical: 'JioCinema', kind: 'ott', aliases: ['JioCinema', 'Jio Cinema'] },
  { canonical: 'Netflix', kind: 'ott', aliases: ['Netflix'] },
  { canonical: 'ZEE5', kind: 'ott', aliases: ['ZEE5', 'Zee5', 'Zee 5'] },
  { canonical: 'SonyLIV', kind: 'ott', aliases: ['SonyLIV', 'Sony LIV', 'Sony Liv'] },
  { canonical: 'Sun NXT', kind: 'ott', aliases: ['Sun NXT', 'SunNXT', 'Sun Nxt'] },
  { canonical: 'ETV Win', kind: 'ott', aliases: ['ETV Win', 'ETVWin'] },
  { canonical: 'aha', kind: 'ott', aliases: ['aha video', 'Aha Video', 'Aha'] },
  { canonical: 'Apple TV+', kind: 'ott', aliases: ['Apple TV+', 'Apple TV Plus'] },
  { canonical: 'MX Player', kind: 'ott', aliases: ['MX Player'] },
  { canonical: 'Hotstar', kind: 'ott', aliases: ['Hotstar'] },
  { canonical: 'YouTube', kind: 'ott', aliases: ['YouTube'] },
  // Satellite/TV premieres show up in the same paragraphs and must NOT be
  // reported as streaming availability — a TV premiere is not "where to watch".
  { canonical: 'Star Maa', kind: 'tv', aliases: ['Star Maa'] },
  { canonical: 'Star Gold', kind: 'tv', aliases: ['Star Gold'] },
  { canonical: 'Colors Cineplex', kind: 'tv', aliases: ['Colors Cineplex'] },
  { canonical: 'Gemini TV', kind: 'tv', aliases: ['Gemini TV'] },
  { canonical: 'Zee Telugu', kind: 'tv', aliases: ['Zee Telugu'] },
];

const LANGUAGES = ['Telugu', 'Tamil', 'Malayalam', 'Kannada', 'Hindi', 'English', 'Bengali', 'Marathi'];

/** Verbs that actually indicate availability, not a rights deal or a rumour. */
const AVAILABILITY_VERBS = [
  'began streaming',
  'started streaming',
  'begin streaming',
  'premiered',
  'premiere',
  'was released',
  'released on',
  'streaming on',
  'available on',
  'digital premiere',
];

/**
 * Phrases that mean a deal was signed, not that anyone can watch it.
 * Treated as evidence of the PLATFORM but never as a release date.
 */
const RIGHTS_ONLY = ['rights were acquired', 'rights of the film were acquired', 'acquired the rights', 'rights was acquired', 'digital distribution rights'];

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "8 November 2024" and "November 8, 2024" both appear on Wikipedia. */
const DATE_PATTERNS = [
  /\b(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})\b/g,
  /\b([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\b/g,
];

function parseDates(text) {
  const found = [];
  for (const re of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      let day, monthName, year;
      if (/^\d/.test(m[1])) [, day, monthName, year] = m;
      else [, monthName, day, year] = m;
      const month = MONTHS[String(monthName).toLowerCase()];
      if (!month) continue;
      const d = Number(day);
      const y = Number(year);
      if (d < 1 || d > 31 || y < 1930 || y > 2100) continue;
      found.push({
        iso: `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        raw: m[0],
        index: m.index,
      });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function splitSentences(text) {
  // Protect the abbreviations and initials that otherwise split mid-sentence.
  const guarded = text
    .replace(/\b([A-Z])\.\s/g, '$1<DOT> ')
    .replace(/\b(No|Mr|Mrs|Dr|Rs|vs|etc|Jr|Sr)\.\s/gi, '$1<DOT> ');
  return guarded
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/<DOT>/g, '.').trim())
    .filter((s) => s.length > 0);
}

function findPlatforms(sentence) {
  const hits = [];
  for (const p of PLATFORMS) {
    for (const alias of p.aliases) {
      const re = new RegExp(`\\b${alias.replace(/[+.*?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const m = re.exec(sentence);
      if (m) {
        hits.push({ canonical: p.canonical, kind: p.kind, index: m.index, matched: m[0] });
        break;
      }
    }
  }
  // Drop a shorter platform name that sits inside a longer one we also matched
  // (bare "Hotstar" inside "Disney+ Hotstar").
  return hits.filter(
    (h) => !hits.some((o) => o !== h && o.canonical.length > h.canonical.length && o.canonical.toLowerCase().includes(h.canonical.toLowerCase()))
  );
}

function findLanguages(sentence) {
  return LANGUAGES.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(sentence));
}

function hasAvailabilityVerb(sentence) {
  const lower = sentence.toLowerCase();
  return AVAILABILITY_VERBS.some((v) => lower.includes(v));
}

function isRightsOnly(sentence) {
  const lower = sentence.toLowerCase();
  return RIGHTS_ONLY.some((v) => lower.includes(v)) && !/(began|started|premiered|from)\s/i.test(sentence);
}

/**
 * Pull every availability claim out of an article.
 *
 * Returns one record per (platform, date) pair found, each carrying the
 * sentence it came from so a human — or a validator — can check it.
 */
/** Sentences about a trailer or a song are not about the film's availability. */
const NOT_THE_FILM = /\b(trailer|teaser|first look|song|lyrical|promo|glimpse|making of|behind the scenes|soundtrack|audio launch|poster)\b/i;

/**
 * Splits a sentence into clauses so languages attach to the right platform.
 *
 * This exists because of a real, bad failure. For Kalki 2898 AD the sentence is
 *   "It premiered on Amazon Prime Video on 22 August 2024 in Telugu along with
 *    the Tamil, Malayalam and Kannada dubbed versions, while the Hindi dubbed
 *    version was released simultaneously on Netflix."
 * Taking languages at sentence level gave Netflix all five languages, when the
 * text plainly gives it only Hindi. Since "which platform for which language"
 * is the single most important field in this dataset, that is not a rounding
 * error — it is the answer being wrong.
 */
function splitClauses(sentence) {
  const parts = sentence.split(/\b(?:while|whereas|whilst)\b|;/i);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export function extractAvailability(articleText) {
  const claims = [];
  const sentences = splitSentences(articleText);

  for (const sentence of sentences) {
    if (findPlatforms(sentence).length === 0) continue;
    if (!hasAvailabilityVerb(sentence) && !isRightsOnly(sentence)) continue;
    if (NOT_THE_FILM.test(sentence)) continue;

    const rightsOnly = isRightsOnly(sentence);
    const sentenceDates = parseDates(sentence);
    const evidence = sentence.length > 400 ? `${sentence.slice(0, 397)}...` : sentence;

    for (const clause of splitClauses(sentence)) {
      const platforms = findPlatforms(clause);
      if (platforms.length === 0) continue;

      const clauseDates = parseDates(clause);
      const clauseLanguages = findLanguages(clause);

      for (const p of platforms) {
        // Nearest date to the platform's left within its own clause, then the
        // clause's first date, then the sentence's — "released on the same day
        // on Netflix" carries no date of its own and inherits the sentence's.
        const before = clauseDates.filter((d) => d.index < p.index);
        const chosen = before.length > 0 ? before[before.length - 1] : (clauseDates[0] ?? sentenceDates[0]);

        claims.push({
          platform: p.canonical,
          kind: p.kind,
          date: rightsOnly ? null : (chosen?.iso ?? null),
          dateRaw: rightsOnly ? null : (chosen?.raw ?? null),
          languages: clauseLanguages,
          rightsOnly,
          evidence,
        });
      }
    }
  }

  return dedupe(claims);
}

function dedupe(claims) {
  const seen = new Map();
  for (const c of claims) {
    const key = `${c.platform}|${c.date ?? 'nodate'}|${c.languages.join(',')}`;
    // Prefer a dated claim over an undated one for the same platform.
    const existing = seen.get(key);
    if (!existing || (existing.date === null && c.date !== null)) seen.set(key, c);
  }
  return [...seen.values()];
}

/** Theatrical release: the first date associated with a theatrical phrase. */
export function extractTheatricalDate(articleText) {
  const sentences = splitSentences(articleText);
  for (const sentence of sentences) {
    if (!/theatrical|released in theatres|released in theaters|released worldwide|hit the screens|released on/i.test(sentence)) continue;
    if (findPlatforms(sentence).length > 0) continue; // that's a streaming sentence
    const dates = parseDates(sentence);
    if (dates.length > 0) return { date: dates[0].iso, evidence: sentence.slice(0, 300) };
  }
  return null;
}

export { PLATFORMS, LANGUAGES };


/**
 * Is this article actually about a film?
 *
 * The yearly list pages link to everything — directors, actors, studios — and a
 * run over the 2026 list produced availability rows for Rashmika Mandanna,
 * Sunny Leone and Anand Deverakonda. Their biographies contain perfectly real
 * sentences like "the film premiered on Netflix", so the extractor was working
 * correctly on the wrong pages.
 *
 * English Wikipedia's opening sentence is highly regular, which makes this
 * cheap and reliable:
 *   film   — "Peddi is a 2026 Indian Telugu-language action film directed by..."
 *   person — "Rashmika Mandanna is an Indian actress who works in..."
 */
export function looksLikeFilm(articleText) {
  const opening = (articleText ?? '').slice(0, 400).replace(/\s+/g, ' ');
  if (!opening) return false;

  // A person's article says what they are, usually within the first clause.
  const person =
    /\bis an?\s+(?:[A-Za-z-]+\s+){0,3}(?:actor|actress|director|producer|singer|composer|lyricist|cinematographer|editor|writer|screenwriter|politician|businessman|businesswoman|entrepreneur|model|dancer|comedian|presenter|host)\b/i;
  if (person.test(opening)) return false;
  if (/\b(?:was|is) born\b/i.test(opening)) return false;

  // A film or series article names itself as one, nearly always up front.
  if (/\bis an?\b[^.]{0,140}\b(?:film|movie)\b/i.test(opening)) return true;
  if (/\bis an?\b[^.]{0,140}\b(?:web series|television series|miniseries|series)\b/i.test(opening)) return true;

  // Nothing marked it as a person, so a plain early mention of "film" will do.
  return /\bfilm\b/i.test(opening);
}
