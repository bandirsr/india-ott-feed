/**
 * The India OTT landscape, and what this pipeline can actually see.
 *
 * Written because "is aha covered?" turned out to be the question that decided
 * the whole data source — Watchmode lists 29 India services and omits aha, the
 * flagship Telugu platform, which ruled it out on its own. A list like this is
 * the only way to notice a hole before a user does.
 *
 * Checked against TMDB's live India provider list on 2026-09-13: 92 distinct
 * providers across movies and TV.
 *
 *   covered      TMDB lists it and tags real titles to it
 *   channel-only TMDB has it only as an Amazon/Apple add-on channel, not as a
 *                standalone service — so a direct subscriber is not represented
 *   absent       TMDB does not list it at all; invisible to this pipeline
 *
 * `absent` is not a bug to fix in code. It is a list of what a second robot
 * would have to cover, and the reason the app must never claim its catalogue
 * is complete.
 */

export const PLATFORMS = [
  /* ---- national, covered ---------------------------------------- */
  { name: 'Netflix', tmdbId: 8, status: 'covered', reach: 'national', languages: ['all'] },
  { name: 'Amazon Prime Video', tmdbId: 119, status: 'covered', reach: 'national', languages: ['all'] },
  { name: 'JioHotstar', tmdbId: 2336, status: 'covered', reach: 'national', languages: ['all'], note: 'JioCinema merged into this; the old JioCinema id 220 is no longer an India provider.' },
  { name: 'Zee5', tmdbId: 232, status: 'covered', reach: 'national', languages: ['all'] },
  { name: 'Sony Liv', tmdbId: 237, status: 'covered', reach: 'national', languages: ['all'], note: 'Telugu catalogue is 26 titles and three years stale. Listed, but effectively unmaintained for South content.' },
  { name: 'MX Player', tmdbId: 515, status: 'covered', reach: 'national', languages: ['all'] },
  { name: 'Amazon MX Player', tmdbId: 1898, status: 'covered', reach: 'national', languages: ['all'], note: 'The former Amazon MiniTV.' },
  { name: 'Apple TV', tmdbId: 350, status: 'covered', reach: 'national', languages: ['all'], note: 'TMDB calls Apple TV+ simply "Apple TV"; "Apple TV Store" is the separate rental storefront.' },
  { name: 'Lionsgate Play', tmdbId: 561, status: 'covered', reach: 'national' },
  { name: 'MUBI', tmdbId: 11, status: 'covered', reach: 'national' },
  { name: 'Crunchyroll', tmdbId: 283, status: 'covered', reach: 'national', languages: ['anime'] },
  { name: 'Discovery+', tmdbId: 510, status: 'covered', reach: 'national' },
  { name: 'Hungama Play', tmdbId: 437, status: 'covered', reach: 'national' },
  { name: 'ShemarooMe', tmdbId: 474, status: 'covered', reach: 'national' },
  { name: 'EPIC ON', tmdbId: 476, status: 'covered', reach: 'national' },
  { name: 'Tata Play', tmdbId: 502, status: 'covered', reach: 'national' },
  { name: 'VI movies and tv', tmdbId: 614, status: 'covered', reach: 'national' },
  { name: 'BookMyShow', tmdbId: 124, status: 'covered', reach: 'national', note: 'Rental/transactional.' },

  /* ---- regional, covered ----------------------------------------- */
  {
    name: 'aha',
    tmdbId: 532,
    status: 'covered',
    reach: 'regional',
    languages: ['Telugu', 'Tamil'],
    note: 'The single reason this project uses TMDB rather than Watchmode, which omits it entirely. 126 Telugu films and 6 series at first sweep.',
  },
  { name: 'Sun NXT', tmdbId: 309, status: 'covered', reach: 'regional', languages: ['Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Bengali'] },
  { name: 'Hoichoi', tmdbId: 315, status: 'covered', reach: 'regional', languages: ['Bengali'] },
  { name: 'ManoramaMax', tmdbId: 482, status: 'covered', reach: 'regional', languages: ['Malayalam'] },

  /* ---- present only as a reseller channel ------------------------ */
  {
    name: 'Chaupal',
    tmdbId: 2178,
    status: 'channel-only',
    reach: 'regional',
    languages: ['Punjabi', 'Haryanvi', 'Bhojpuri'],
    note: 'Only as "Chaupal Amazon Channel". Someone subscribing to Chaupal directly is not represented.',
  },
  {
    name: 'Eros Now',
    tmdbId: 2059,
    status: 'channel-only',
    reach: 'national',
    note: 'Only as "Eros Now Select Apple TV channel".',
  },

  /* ---- absent: invisible to this pipeline ------------------------ */
  {
    name: 'ETV Win',
    tmdbId: null,
    status: 'absent',
    reach: 'regional',
    languages: ['Telugu'],
    note: 'The significant one. A major Telugu platform with originals and a large film library, absent from BOTH TMDB and Watchmode. Anything released only here is invisible. Needs its own robot.',
    priority: 'high',
  },
  {
    name: 'Airtel Xstream Play',
    tmdbId: null,
    status: 'absent',
    reach: 'national',
    note: 'Aggregator bundling other services; its own exclusives are unseen.',
    priority: 'medium',
  },
  { name: 'Stage', tmdbId: null, status: 'absent', reach: 'regional', languages: ['Haryanvi', 'Rajasthani', 'Bhojpuri'], note: 'Dialect-first, not language-first. No overlap with anything TMDB carries.', priority: 'medium' },
  { name: 'Ullu', tmdbId: null, status: 'absent', reach: 'national', priority: 'low' },
  { name: 'Atrangii', tmdbId: null, status: 'absent', reach: 'national', priority: 'low' },
  { name: 'AaoNXT', tmdbId: null, status: 'absent', reach: 'regional', languages: ['Odia'], priority: 'low' },
  { name: 'Planet Marathi', tmdbId: null, status: 'absent', reach: 'regional', languages: ['Marathi'], priority: 'medium' },
  { name: 'Saina Play', tmdbId: null, status: 'absent', reach: 'regional', languages: ['Malayalam'], priority: 'low' },
  { name: 'Simply South', tmdbId: null, status: 'absent', reach: 'regional', languages: ['Tamil', 'Telugu', 'Malayalam', 'Kannada'], priority: 'low' },
  { name: 'Koode', tmdbId: null, status: 'absent', reach: 'regional', languages: ['Malayalam'], priority: 'low' },
  { name: 'FanCode', tmdbId: null, status: 'absent', reach: 'national', note: 'Sports only — out of scope for a film and series app.', priority: 'none' },
];

/**
 * A platform TMDB has no id for at all — ETV Win and Ullu, which reach the
 * app only through their own robots (gapfill.js, series.js), never through
 * TMDB's provider list. Publish.js assigns each a negative synthetic id so it
 * can be carried through the feed the same way a real provider is.
 */
export const SYNTHETIC_PROVIDER_IDS = { 'ETV Win': -1, Ullu: -2 };

/**
 * The fast news layer names platforms the way extract.js's PLATFORMS list
 * spells them (ZEE5, Sony Liv as "SonyLIV", Apple TV+), which is not always
 * how this registry spells the same service. Resolved here once rather than
 * wherever a report needs a provider id.
 */
const NAME_ALIASES = {
  ZEE5: 'Zee5',
  SonyLIV: 'Sony Liv',
  'Apple TV+': 'Apple TV',
  Hotstar: 'JioHotstar',
  JioCinema: 'JioHotstar',
};

/**
 * A canonical platform name (however the caller spells it) to the id it
 * should carry on the wire — a real TMDB provider id, or the synthetic one
 * for the handful of platforms TMDB does not list. Null means genuinely
 * untracked: a real platform, but not one this app renders availability for.
 */
export function providerIdForPlatformName(name) {
  if (name in SYNTHETIC_PROVIDER_IDS) return SYNTHETIC_PROVIDER_IDS[name];
  const lookup = NAME_ALIASES[name] ?? name;
  const p = PLATFORMS.find((p) => p.name === lookup);
  if (p?.tmdbId != null) return p.tmdbId;
  return SYNTHETIC_PROVIDER_IDS[lookup] ?? null;
}

export const COVERAGE = {
  checkedOn: '2026-09-13',
  tmdbProvidersForIndia: 92,
  tracked: 43,
  covered: PLATFORMS.filter((p) => p.status === 'covered').length,
  channelOnly: PLATFORMS.filter((p) => p.status === 'channel-only').length,
  absent: PLATFORMS.filter((p) => p.status === 'absent').length,

  /**
   * The honest summary for anyone deciding whether to trust this data.
   *
   * Every platform an ordinary viewer would name is covered, with one
   * exception that matters a great deal in Telugu.
   */
  verdict:
    'All the majors are covered, including aha. ETV Win is the one significant ' +
    'gap and is high priority. The rest of the absent list is small, regional ' +
    'and mostly outside the languages the app leads with.',
};

/** What a second robot would need to do, and why the obvious routes do not work. */
export const ETV_WIN_PLAN = {
  problem: 'No aggregator carries ETV Win. Not TMDB, not JustWatch, not Watchmode.',
  triedAlready: [
    'Watchmode India source list — 29 services, no ETV Win (tested 2026-09-12).',
    'TMDB India providers — 92 services, no ETV Win (tested 2026-09-13).',
    'ETV Win YouTube channel RSS — posts clips and serial episode previews, not release announcements (tested 2026-09-12, see FIELD_TEST in sources.js).',
  ],
  options: [
    {
      route: 'Wikipedia',
      cost: 'free, already built',
      viable: true,
      detail:
        'The existing pipeline already extracts "streaming on ETV Win" sentences with citations. It is a month behind and misses films with no article, but it is real coverage at zero extra cost and needs no new permission.',
    },
    {
      route: 'Trade press already in the registry',
      cost: 'free',
      viable: 'partly',
      detail:
        'Binged, Sakshi Post and 123telugu all name ETV Win in round-ups. Needs the round-up body parser that is still unbuilt.',
    },
    {
      route: 'ETV Win sitemap or public catalogue page',
      cost: 'free',
      viable: 'unknown',
      detail:
        'Not yet checked. Must respect robots.txt — the whole project is built on not scraping anything that asks not to be. If it disallows crawling, this route is closed and stays closed.',
    },
    {
      route: 'Ask users',
      cost: 'free, and becomes an asset nobody can revoke',
      viable: true,
      detail: 'One tap: "is this on ETV Win?". Needs users first, so it cannot be the launch answer.',
    },
  ],
};
