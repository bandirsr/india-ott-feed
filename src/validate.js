/**
 * Cross-source reconciliation.
 *
 * The reason this file exists: a live check on Hanu-Man found Wikipedia saying
 * 16 March 2024 while news sources said 2 March, 8 March and 22 March. The
 * platform was never in doubt — ZEE5 — but the date was reported four ways.
 *
 * So platform and date get different treatment:
 *
 *   PLATFORM  is stable and verifiable. Two independent mentions is enough to
 *             state it plainly.
 *   DATE      is frequently wrong, because OTT dates are announced, moved and
 *             mis-reported. It is stored with a status and never presented as
 *             fact on one source alone.
 *
 * An app that shows a confident wrong date is worse than one that says
 * "streaming now on ZEE5, date unconfirmed".
 */

/** Domains we treat as independent corroboration for an availability claim. */
const NEWS_DOMAINS = [
  'timesofindia.indiatimes.com',
  'hindustantimes.com',
  'indianexpress.com',
  'deccanchronicle.com',
  'thehindu.com',
  'news18.com',
  'indiatoday.in',
  'pinkvilla.com',
  'ottplay.com',
  '123telugu.com',
  'gulte.com',
  'firstpost.com',
  'freepressjournal.in',
  'abplive.com',
  'moneycontrol.com',
  'financialexpress.com',
];

/** A platform's own site is the strongest evidence the title is really there. */
const PLATFORM_DOMAINS = {
  Netflix: ['netflix.com'],
  'Amazon Prime Video': ['primevideo.com', 'amazon.in', 'amazon.com'],
  ZEE5: ['zee5.com'],
  'Disney+ Hotstar': ['hotstar.com', 'disneyplus.com'],
  JioHotstar: ['hotstar.com', 'jiohotstar.com'],
  JioCinema: ['jiocinema.com'],
  SonyLIV: ['sonyliv.com'],
  'Sun NXT': ['sunnxt.com'],
  'ETV Win': ['etvwin.com'],
  aha: ['aha.video'],
  'Apple TV+': ['tv.apple.com'],
  'MX Player': ['mxplayer.in'],
};

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Counts independent support for each claim using the citations Wikipedia
 * already attached to the article — the second source arrives free with the
 * claim, so this costs no extra network calls.
 */
export function scoreClaims(claims, citationUrls) {
  const domains = citationUrls.map(domainOf).filter(Boolean);

  return claims.map((claim) => {
    const platformDomains = PLATFORM_DOMAINS[claim.platform] ?? [];

    // Evidence 1: Wikipedia's own prose. Always present, by definition.
    // Evidence 2: a news citation on this page that plausibly covers it.
    const newsCitations = domains.filter((d) => NEWS_DOMAINS.includes(d));
    // Evidence 3: the platform's own domain appears among the citations.
    const platformCited = domains.some((d) => platformDomains.some((pd) => d.endsWith(pd)));

    let sources = 1;
    if (newsCitations.length > 0) sources += 1;
    if (platformCited) sources += 1;

    const platformConfidence = sources >= 2 ? 'confirmed' : 'single-source';

    // Dates never reach "confirmed" from Wikipedia alone. Promoting them
    // requires agreement from a second source that actually states the date,
    // which is a per-claim fetch left to the optional deep-verify step.
    let dateStatus;
    if (claim.rightsOnly || !claim.date) dateStatus = 'unknown';
    else if (new Date(claim.date) > new Date()) dateStatus = 'announced';
    else dateStatus = 'reported';

    return {
      ...claim,
      platformConfidence,
      dateStatus,
      sourceCount: sources,
      corroboration: {
        wikipediaProse: true,
        newsCitations: newsCitations.length,
        platformSiteCited: platformCited,
      },
    };
  });
}

/**
 * Collapses many claims into what the app should actually show.
 *
 * One row per (platform, language) — which is the shape Telugu releases
 * genuinely take, since the Hindi dub routinely lands on a different service
 * from the Telugu original. A model with one platform per film is wrong for a
 * large share of the catalogue.
 */
export function reconcile(scoredClaims) {
  const ott = scoredClaims.filter((c) => c.kind === 'ott');
  const rows = new Map();

  for (const claim of ott) {
    const languages = claim.languages.length > 0 ? claim.languages : ['Unknown'];
    for (const language of languages) {
      const key = `${claim.platform}|${language}`;
      const existing = rows.get(key);

      if (!existing) {
        rows.set(key, {
          platform: claim.platform,
          language,
          date: claim.date,
          dateStatus: claim.dateStatus,
          platformConfidence: claim.platformConfidence,
          sourceCount: claim.sourceCount,
          conflictingDates: [],
          evidence: [claim.evidence],
        });
        continue;
      }

      // Same platform and language claimed with a different date — record the
      // conflict rather than silently letting the last one win.
      if (claim.date && existing.date && claim.date !== existing.date) {
        if (!existing.conflictingDates.includes(claim.date)) existing.conflictingDates.push(claim.date);
        existing.dateStatus = 'disputed';
      } else if (claim.date && !existing.date) {
        existing.date = claim.date;
        existing.dateStatus = claim.dateStatus;
      }
      if (!existing.evidence.includes(claim.evidence)) existing.evidence.push(claim.evidence);
    }
  }

  // Drop the "Unknown language" row for a platform we already know languages
  // for. It comes from a second, vaguer sentence about the same release and
  // adds a junk row to every film rather than any information.
  const all = [...rows.values()];
  const platformsWithKnownLanguage = new Set(
    all.filter((r) => r.language !== 'Unknown').map((r) => r.platform)
  );
  const cleaned = all
    .filter((r) => r.language !== 'Unknown' || !platformsWithKnownLanguage.has(r.platform))
    // A row with no language AND no date says only "this platform was mentioned
    // somewhere", which is not availability. These were appearing on nearly
    // every film (usually YouTube) and added nothing but noise.
    .filter((r) => r.date !== null || r.language !== 'Unknown');

  return cleaned.sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.language.localeCompare(b.language);
  });
}

export { NEWS_DOMAINS, PLATFORM_DOMAINS };
