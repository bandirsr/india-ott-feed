/**
 * The source registry — every place worth checking for OTT availability,
 * with what each is actually good for.
 *
 * Built after a real test exposed the problem: a full run over Wikipedia's 2026
 * Telugu list found ONE film with an OTT date in the previous 30 days, while
 * the trade press listed roughly 25. Wikipedia is authoritative and free, and
 * hopeless at recency. Nothing about the parser fixes that — it needs sources
 * that publish the day a title lands.
 *
 * `rssVerified: true` means the feed was fetched and returned items on
 * 2026-09-12. Anything else is a page that must be read rather than subscribed
 * to, which is slower and more fragile, so prefer the feeds.
 */

export const SOURCES = [
  /* ---------------------------------------------------------------- */
  /* Tier 1 — fast, and they publish a feed                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'binged',
    name: 'Binged',
    home: 'https://www.binged.com/',
    rss: 'https://www.binged.com/feed/',
    rssVerified: true,
    tier: 1,
    covers: ['films', 'series', 'all languages', 'dubbed'],
    // Publishes exactly the round-up posts this app needs, on a weekly rhythm:
    // "Top OTT Releases This Weekend (Sept 11 – 13, 2026)" and
    // "Top OTT Titles This Week (Aug 31 – Sept 6, 2026)", plus per-title pieces
    // like "Suriya's Vishwanath and Sons Gets Its OTT Release Date".
    strength: 'Weekly round-ups and per-title release-date announcements.',
    parse: 'round-up posts list title + platform + date in the body',
  },
  {
    id: 'telugu360',
    name: 'Telugu360',
    home: 'https://www.telugu360.com/',
    rss: 'https://www.telugu360.com/feed/',
    rssVerified: true,
    tier: 1,
    covers: ['films', 'Telugu'],
    strength: 'Weekly "OTT releases coming this week" posts.',
    parse: 'general news feed; filter items whose title mentions OTT',
  },
  {
    id: '123telugu',
    name: '123telugu',
    home: 'https://www.123telugu.com/',
    rss: 'https://www.123telugu.com/feed',
    rssVerified: true,
    tier: 1,
    covers: ['films', 'Telugu'],
    strength: 'Has a dedicated OTT updates section; feed is busy but usable.',
    parse: 'general news feed; filter on OTT keywords',
  },

  /* ---------------------------------------------------------------- */
  /* Tier 2 — good lists, no working feed found; must read the page    */
  /* ---------------------------------------------------------------- */
  {
    id: 'filmibeat',
    name: 'FilmiBeat',
    home: 'https://www.filmibeat.com/top-listing/new-ott-releases-this-week-in-telugu-2026-aha-prime-video-netflix-zee5-hotstar-sunnxt-and-sonyliv-6-1079.html',
    rss: null,
    rssVerified: false,
    tier: 2,
    covers: ['films', 'series', 'Telugu', 'dubbed'],
    strength: 'A single maintained page listing this week per language.',
    parse: 'one stable URL per language, re-read weekly',
  },
  {
    id: 'sakshipost',
    name: 'Sakshi Post OTT',
    home: 'https://www.sakshipost.com/news/ott',
    rss: null,
    rssVerified: false,
    tier: 2,
    covers: ['films', 'series', 'all languages'],
    strength: 'Daily "OTT releases today" posts — the most current of any source.',
    parse: 'daily post listing every title landing that day',
  },
  { id: 'ottweek', name: 'OTTweek', home: 'https://ottweek.com/language/telugu', rss: null, tier: 2, covers: ['films', 'series'], strength: 'Per-language listing pages.' },
  { id: 'newrelease', name: 'NewRelease.in', home: 'https://newrelease.in/new-telugu-movies-ott-where-to-watch-2026', rss: null, tier: 2, covers: ['films'], strength: 'Year-long Telugu OTT table with where-to-watch.' },
  { id: 'ottreleasesthisweek', name: 'OTT Releases This Week', home: 'https://ottreleasesthisweek.com/', rss: null, tier: 2, covers: ['films'], strength: 'Dated weekly posts per language.' },

  /* ---------------------------------------------------------------- */
  /* Tier 3 — the rights holders themselves, keyless and authoritative */
  /* ---------------------------------------------------------------- */
  {
    id: 'platform-youtube',
    name: 'Platform & studio YouTube channels',
    home: 'https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID',
    rss: 'per-channel',
    rssVerified: false,
    tier: 3,
    covers: ['films', 'series', 'all languages'],
    // No API key needed: YouTube publishes a plain RSS feed per channel with
    // the latest 15 uploads. Platforms post "streaming now" promos on the day,
    // which makes this the most authoritative fast signal available — it comes
    // from the party that actually made the title available.
    strength: 'Same-day, from the platform itself. No API key, no quota.',
    parse: 'watch uploads whose titles match /streaming (now|from)|out now|on <platform>/',
    channels: {
      aha: 'aha (official)',
      etvwin: 'ETV Win',
      zee5: 'ZEE5 Telugu',
      sonyliv: 'SonyLIV',
      netflixIndia: 'Netflix India South',
      primeVideoIndia: 'Prime Video India',
      jiohotstar: 'JioHotstar',
    },
  },

  /* ---------------------------------------------------------------- */
  /* Tier 4 — slow, authoritative, free: the backstop                  */
  /* ---------------------------------------------------------------- */
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    home: 'https://en.wikipedia.org/w/api.php',
    rss: null,
    tier: 4,
    covers: ['films with an article'],
    strength: 'Exact dates, per language, with citations. Free, no attribution owed on facts.',
    weakness:
      'Roughly a month behind. Editors add the OTT line well after the event, ' +
      'many smaller films never get an article at all, and dubbed releases are ' +
      'absent from the Telugu films list page entirely.',
    parse: 'already implemented — see src/wikipedia.js',
  },
];

/**
 * Why the last run found 1 release instead of ~25. Four distinct causes, and
 * only the first is about timing — the rest are coverage holes that would
 * persist even if Wikipedia were instant.
 */
export const KNOWN_GAPS = [
  {
    gap: 'Wikipedia lag',
    detail: 'The OTT sentence is added weeks after the release.',
    fixedBy: ['binged', 'sakshipost', 'platform-youtube'],
  },
  {
    gap: 'No article at all',
    detail: 'Smaller Telugu films never get an English Wikipedia page.',
    fixedBy: ['binged', 'filmibeat', 'telugu360'],
  },
  {
    gap: 'Dubbed releases',
    detail:
      'A large share of what lands on Telugu OTT is dubbed from Tamil, Malayalam ' +
      'or Hindi — Jana Nayagan, I Nobody, Kattalan, Makutam. None appear on the ' +
      'List of Telugu films page, so the pipeline cannot see them.',
    fixedBy: ['binged', 'filmibeat', 'sakshipost'],
  },
  {
    gap: 'Web series',
    detail:
      'Panchanama, Aakali Rajyam and similar are series, not films. The pipeline ' +
      'only walks the films list, so series are invisible to it.',
    fixedBy: ['binged', 'sakshipost', 'platform-youtube'],
  },
];

export const RSS_READY = SOURCES.filter((s) => s.rssVerified);


/* ------------------------------------------------------------------ */
/* Tested 2026-09-12 — what actually works, measured not assumed       */
/* ------------------------------------------------------------------ */

/**
 * Every free route to same-day Telugu OTT data was tried. Recorded here so
 * nobody re-walks these dead ends.
 */
export const FIELD_TEST = {
  testedOn: '2026-09-12',
  verdict:
    'There is no free, automated route to COMPREHENSIVE Telugu OTT coverage. ' +
    'Partial coverage is achievable; completeness is what the paid data providers sell.',

  results: [
    {
      source: 'en.wikipedia.org',
      works: true,
      detail: 'Exact per-language dates with citations, but about a month late, and blind to dubbed releases and web series.',
    },
    {
      source: 'binged.com RSS + article bodies',
      works: 'partly',
      detail:
        'Feed and articles both fetch cleanly. But the round-ups are curated "Top OTT" lists ' +
        'spanning all languages — the 11-13 Sept 2026 edition contained Hindi, Spanish, Marathi ' +
        'and Korean titles and not one Telugu film. No Telugu category feed exists (404).',
    },
    { source: 'filmibeat.com Telugu weekly page', works: false, detail: 'HTTP 403 — blocks automated fetching.' },
    { source: 'telugu360.com article pages', works: false, detail: 'HTTP 403 — blocks automated fetching. Its RSS works but carries general news.' },
    { source: '123telugu.com RSS', works: 'partly', detail: 'Fetches fine; general film news, no structured release data. No OTT category feed.' },
    { source: 'gulte.com RSS', works: false, detail: 'HTTP 410 Gone.' },
    {
      source: 'YouTube channel RSS — JioHotstar (UC0PTktRYpZXb6On0_zFKWIg)',
      works: true,
      detail:
        'The best free same-day signal found. Highly regular titles: "Cocaine | Now Streaming | ' +
        'JioHotstar", "Lee Cronin The Mummy | 17th September | JioHotstar". Keyless, no quota.',
    },
    {
      source: 'YouTube channel RSS — ZEE5 national (UCXOgAl4w-FQero1ERbGHpXQ)',
      works: 'partly',
      detail: 'Usable: "Ghamasaan | Launch Trailer | Hindi Zee 5 Original Film", "Varavu | Promo | Watch on Malayalam Zee 5".',
    },
    {
      source: 'YouTube channel RSS — the Telugu-specific platform channels',
      works: false,
      detail:
        'Checked aha videoIN (UCmO-jDLU-KUcweCzktuDsbg), ETV WIN (UCOOMBVOrtgBGfy2FGTUHFZA), ' +
        'Telugu Zee5 (UCVjaSUMfHkPcmJr5SKLVDTg), Sun NXT Telugu (UCo3J37dmHuiL7L0klvO1KKA), ' +
        'SonyLIV and Prime Video India. They post scene clips, shorts and daily TV serial episode ' +
        'previews — not release announcements. The national JioHotstar channel is the exception, ' +
        'not the rule.',
    },
  ],

  /** Where to go from here, in the order worth trying. */
  nextOptions: [
    {
      option: 'Test Watchmode coverage for India',
      cost: 'free tier: 2,500 calls/month, 3 countries',
      why:
        'Never actually tested. One call to /v1/sources/?regions=IN answers whether aha, ETV Win ' +
        'and Sun NXT are covered. If they are, this entire problem is solved for nothing.',
      effort: 'minutes',
    },
    {
      option: 'Crowdsource from users',
      cost: 'free, and becomes an asset nobody can revoke',
      why: 'One tap: "still on aha? yes/no". Needs users first, so it cannot be the launch answer.',
      effort: 'moderate',
    },
    {
      option: 'Ship partial, and say so',
      cost: 'free',
      why:
        'Wikipedia depth for anything over a month old, JioHotstar/ZEE5 signals for some of the rest, ' +
        'and an honest in-app note that the newest week is incomplete.',
      effort: 'small',
    },
  ],
};


/* ------------------------------------------------------------------ */
/* TMDB tested live 2026-09-12 — the result that reshapes the design   */
/* ------------------------------------------------------------------ */

/**
 * TMDB (carrying JustWatch availability) was probed against the two things
 * that actually matter: does it know the native Telugu platforms, and does it
 * know WHEN something landed.
 *
 * It answers the first completely and the second not at all. That split is the
 * whole architecture.
 */
export const TMDB_FIELD_TEST = {
  testedOn: '2026-09-12',

  covers: {
    aha: 'YES — provider id 532, 126 Telugu films and 6 Telugu series. This is the gap Watchmode could not fill.',
    etvWin: 'NO — absent from TMDB and from Watchmode. Uncovered by every source tested so far.',
    series: 'YES — 257 Telugu series, 65 India TV providers. Panchanama (2026-09-11) and Aakali Rajyam ' +
            '(2026-08-28) are both present, and both are named in KNOWN_GAPS as invisible to the ' +
            'Wikipedia pipeline. The web-series gap is closed.',
    languages:
      'All-India in one API. Titles / of which streaming now: Hindi 10471/3308, Tamil 6142/1973, ' +
      'Malayalam 4957/1779, Telugu 3937/1693, Bengali 4590/778, Kannada 2441/905, Punjabi 1047/515, ' +
      'Marathi 1601/365, Gujarati 392/180. Roughly 11,500 titles streaming across the nine.',
  },

  /**
   * Depth is a function of how well-known a title is, not of its age.
   * Sorting by date surfaces the long tail and looks like total failure;
   * sorting by popularity shows the truth.
   */
  depth: {
    byPopularity: '11/20 of the most popular Telugu films of the last 180 days carry a provider.',
    byDate: '0/15 of the most recent by release date carry one — tiny films TMDB has a stub for and nothing more.',
    reading: 'TMDB tags what people search for. The long tail stays empty and probably always will.',
  },

  /**
   * THE LIMITATION, and it is the important one.
   *
   * TMDB exposes no "date added to platform" field anywhere. primary_release_date
   * is the THEATRICAL date. So TMDB answers "where can I watch this" perfectly
   * and "what is new on OTT this week" not at all — which is precisely the
   * question this app exists to answer.
   *
   * Freshest Telugu title per platform by theatrical date, measured on 2026-09-12:
   *   Prime Video 2026-08-14 · Netflix 2026-08-06 · Sun NXT 2026-07-17
   *   JioHotstar 2026-07-10 · Zee5 2026-07-10 · aha 2026-06-19 · Sony Liv 2023-10-27
   * Sony Liv's Telugu catalogue is 26 titles and three years stale; treat it as
   * unmaintained rather than empty.
   */
  noArrivalDate: {
    problem: 'No field records when a title reached a platform.',
    consequence: 'TMDB alone cannot drive a "this week" view. That axis needs another source.',
    solution: 'Derive it. See ARRIVAL_STRATEGY below.',
  },
};

/**
 * How to get arrival dates without scraping anyone.
 *
 * Snapshot which titles carry which providers, every day. The first day a title
 * appears with a provider it did not have yesterday IS its arrival date, to the
 * day. Nobody publishes this; we compute it from a source we are licensed to read.
 *
 * Three properties make this the right answer rather than a workaround:
 *   - It is our own derived dataset. No feed to break, no robots.txt to respect,
 *     no publisher who can revoke it.
 *   - It covers everything TMDB covers — every language, films and series,
 *     including the dubbed titles that never reach the Telugu films list page.
 *   - It improves with age. The archive only ever grows.
 *
 * The cost is that it starts empty: day one knows nothing, and the first useful
 * "this week" view is seven days out. Wikipedia and the news layer cover that
 * window, and stay useful afterwards for anything older than the snapshot history.
 *
 * Size is not a concern. A title needs id, providers and a date — well under
 * 100 bytes. Eleven thousand streaming titles is roughly 1 MB for a full
 * snapshot, and a daily diff is a few kilobytes. A rolling twelve-month window
 * ships inside the app; the archive sits on static hosting. No server.
 */
export const ARRIVAL_STRATEGY = {
  method: 'daily provider snapshot + diff',
  gives: 'exact arrival date, per title, per platform, per language, films and series',
  startsEmpty: true,
  firstUsefulWeek: 7,
  bridgedBy: ['wikipedia', 'binged', 'platform-youtube'],
  sizePerSnapshot: '~1 MB all-India, ~150 KB Telugu-only',
  sizePerDailyDiff: 'a few KB',
};
