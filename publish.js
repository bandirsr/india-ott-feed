/**
 * Turns the snapshot archive into the files the phone app downloads.
 *
 * The app cannot talk to TMDB directly — the key would have to ship inside it,
 * and every install would burn quota. So the pipeline publishes plain static
 * JSON instead, and the app only ever reads that. No server, no key on the
 * device, no rate limit that scales with users.
 *
 * Output, all under public/:
 *
 *   manifest.json      ~1 KB. Version, and one line per language with its size
 *                      and how many titles it holds. The app fetches this on
 *                      launch and downloads a language file only when its
 *                      version has moved.
 *   v1/te.json         One file per language. A Telugu-only user never
 *                      downloads the Hindi catalogue.
 *
 * Splitting by language is the whole point of the layout: the full India
 * catalogue is 1.3 MB, and almost nobody wants all of it.
 *
 *   node publish.js
 */

import { writeFileSync, mkdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { listSnapshots, load, LANGUAGES } from './src/snapshot.js';
import { loadLedger, arrivalDate } from './src/ledger.js';
import { toFeedEntries } from './src/gapfill.js';
import { resolveFreshReports } from './src/fresh.js';
import { providerIdForPlatformName } from './src/platforms.js';
import { trailerKeyFor } from './src/trailers.js';

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
const OWN_ORIGINAL_GAP_DAYS = 14;
const LEGACY_CATALOG_GAP_DAYS = 400;

function arrivalOn(kind, rec, pid, on, detail) {
  if (!on || !rec.d) return on;
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

/**
 * Platforms with no TMDB id get a synthetic negative one.
 *
 * Negative so it can never collide with a real TMDB provider id, now or after
 * TMDB adds the platform itself. If ETV Win ever appears in TMDB, the main
 * sweep picks it up under its real id and this entry simply stops being used.
 */
const SYNTHETIC_PROVIDERS = {
  'ETV Win': { id: -1, color: '#E4572E' },
  // Not a TMDB provider either, but it turns up as a `networks` entry on
  // series, which is the only reason we can see it at all.
  Ullu: { id: -2, color: '#B5179E' },
};

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'public');

/** Brand colours, so the app does not need a table it has to keep in sync. */
const COLORS = {
  532: '#FF6A00', // aha
  8: '#E50914', // Netflix
  119: '#00A8E1', // Prime Video
  2336: '#0E63E4', // JioHotstar
  232: '#8230C6', // Zee5
  309: '#E0642C', // Sun NXT
  237: '#0B57D0', // Sony Liv
  515: '#2ABF9E', // MX Player
  315: '#D7263D', // Hoichoi
  482: '#1B998B', // ManoramaMax
  350: '#8E8E93', // Apple TV
  11: '#000000', // MUBI
  1898: '#00C3FF', // Amazon MX Player (formerly MiniTV)
};

/**
 * Colours are keyed by id and only cosmetic — an unknown id falls back to grey.
 * NAMES are never taken from here; those come from the snapshot, which is what
 * stops a reassigned id from inheriting the wrong brand.
 */

/**
 * Detail fields, omitted entirely when empty.
 *
 * Spelling them out rather than spreading the cached object keeps nulls out of
 * the payload: `"dir": null` on ten thousand titles is dead weight in a file
 * that ships to phones over mobile data.
 */
function detailFields(d) {
  if (!d) return {};
  const out = {};
  if (d.d) out.dir = d.d;
  if (d.c?.length) out.cast = d.c;
  if (d.o) out.syn = d.o;
  if (d.r) out.run = d.r;
  if (d.v) out.rate = d.v;
  return out;
}

function main(freshReports) {
  const dates = listSnapshots();
  if (dates.length === 0) {
    console.error('No snapshots yet. Run "node snapshot.js take" first.');
    process.exit(1);
  }

  const latestDate = dates[dates.length - 1];
  const latest = load(latestDate);

  /** One timestamp for the whole publish, so manifest and payloads agree. */
  const builtAt = new Date().toISOString();

  // Arrival dates come from the ledger, which is the only thing that outlives
  // a run. A pair it has never recorded has no knowable date and gets null
  // rather than a guess — the app then shows "on aha" with no date, which is
  // true, instead of claiming it landed the day we started watching.
  const ledger = loadLedger();
  if (!ledger) {
    console.error('No ledger yet. Run a full "node snapshot.js take" first.');
    process.exit(1);
  }

  // Wikipedia fills the ETV Win gap. Optional in exactly the same way trailers
  // are: if the robot has never run, the feed is simply TMDB-only.
  const gapPath = resolve(HERE, 'data', 'gapfill.json');
  const gaps = existsSync(gapPath)
    ? toFeedEntries(JSON.parse(readFileSync(gapPath, 'utf8')))
    : { attach: [], standalone: [] };

  // Dubs found on multi-language platforms. Optional like everything else here:
  // if the finder has never run, the feed is simply what the sweep saw.
  const dubPath = resolve(HERE, 'data', 'dubs.json');
  const dubs = existsSync(dubPath) ? JSON.parse(readFileSync(dubPath, 'utf8')) : {};

  // Web series placed by their network. JustWatch tags providers for almost no
  // Indian series -- 2 of 10 sampled -- while TMDB records a network for 8 of
  // 10, and for a streaming original the network IS where you watch it.
  const seriesPath = resolve(HERE, 'data', 'series.json');
  const series = existsSync(seriesPath) ? JSON.parse(readFileSync(seriesPath, 'utf8')) : {};

  // Director, cast, synopsis, runtime, rating. Optional like the rest; a title
  // not yet detailed simply ships without them.
  const detailsPath = resolve(HERE, 'data', 'details.json');
  const details = existsSync(detailsPath) ? JSON.parse(readFileSync(detailsPath, 'utf8')) : {};

  // Trailers are optional. They backfill over days on their own budget, so a
  // publish must never wait for them or fail without them.
  const trailerPath = resolve(HERE, 'data', 'trailers.json');
  const trailers = existsSync(trailerPath) ? JSON.parse(readFileSync(trailerPath, 'utf8')) : {};
  // Second source, for films TMDB has no video for at all. Only ever a
  // fallback: a TMDB trailer is linked to the film by id, a YouTube one by a
  // title match, so TMDB wins whenever it has anything.
  const ytPath = resolve(HERE, 'data', 'youtube-trailers.json');
  const youtube = existsSync(ytPath) ? JSON.parse(readFileSync(ytPath, 'utf8')) : {};
  const trailerFor = (key, code, ol) => trailerKeyFor(trailers[key], code, ol) ?? youtube[key]?.key ?? null;

  mkdirSync(join(OUT, 'v1'), { recursive: true });

  const byLanguage = new Map(LANGUAGES.map((l) => [l.code, []]));

  for (const [key, rec] of Object.entries(latest.titles)) {
    const kind = key.startsWith('tv:') ? 'tv' : 'movie';
    const entry = {
      id: key,
      t: rec.t,
      d: rec.d, // theatrical / first-air date
      i: rec.i, // poster path, relative to imageBase
      k: kind,
      // YouTube video key, or absent. The app builds both the watch URL and the
      // still from it, so one short string carries both.
      // Filled in per language below -- a Tamil viewer and a Telugu viewer
      // looking at the same film get different trailers.
      y: null,
      p: rec.p.map((pid) => ({ id: pid, on: arrivalOn(kind, rec, pid, arrivalDate(ledger, key, pid), details[key]) })),
      ...detailFields(details[key]),
    };

    // A title appears under its own language AND under any language a
    // single-language platform implies. A Tamil film on aha is listed for a
    // Telugu viewer, tagged `ol: 'ta'` so the app can say where it came from
    // rather than passing it off as a Telugu original.
    // Three ways a title reaches a language list: it was made in it; a
    // single-language platform implies it (aha); or TMDB records a
    // language-tagged Indian title for it, which is how a Tamil film on
    // Netflix reaches a Telugu viewer.
    const buckets = new Set([rec.l, ...(rec.also ?? []), ...(dubs[key] ?? [])]);
    for (const code of buckets) {
      const bucket = byLanguage.get(code);
      if (!bucket) continue;
      const ol = rec.ol ?? (code !== rec.l ? rec.l : null);
      // `ol` is passed so a dubbed title can fall back to a trailer in the
      // language it was actually made in, rather than to nothing.
      const y = trailerFor(key, code, ol ?? undefined);
      const forLanguage = { ...entry, ...(y ? { y } : {}), ...(ol ? { ol } : {}) };
      bucket.push(forLanguage);
    }
  }

  // --- fold in the platforms TMDB cannot see -----------------------------
  //
  // Two shapes. `attach` rows add a platform to a title the main sweep already
  // found, so the app shows "also on ETV Win" on an existing entry rather than
  // a duplicate beside it. `standalone` rows are films TMDB has never heard of
  // — small releases that went only to ETV Win — and those are the ones that
  // genuinely would not exist in the app without this robot.
  //
  // Their dates come from Wikipedia with a citation, which is better than the
  // main sweep can manage: TMDB records no arrival date at all, so for these
  // titles a cited date is the only one there is.
  const byKey = new Map();
  for (const [, bucket] of byLanguage) for (const t of bucket) byKey.set(t.id, t);

  let attached = 0;
  for (const row of gaps.attach) {
    const target = byKey.get(row.key);
    const synth = SYNTHETIC_PROVIDERS[row.platform];
    if (!target || !synth) continue;
    if (target.p.some((x) => x.id === synth.id)) continue;
    target.p.push({ id: synth.id, on: row.date, src: 'wikipedia' });
    attached += 1;
  }

  let added = 0;
  for (const row of gaps.standalone) {
    const synth = SYNTHETIC_PROVIDERS[row.platform];
    if (!synth) continue;
    // Telugu only for now: ETV Win is a Telugu platform, and the extractor
    // does not reliably attribute a language when the article does not state
    // one. Guessing would put films under the wrong chip.
    const bucket = byLanguage.get('te');
    if (!bucket) continue;
    bucket.push({
      id: row.key,
      t: row.title,
      d: null,
      i: null,
      k: 'movie',
      y: null,
      p: [{ id: synth.id, on: row.arrived, src: 'wikipedia' }],
    });
    added += 1;
  }

  // --- fold in same-day news reports, ahead of TMDB's own catch-up --------
  //
  // TMDB's watch-provider data lags the platforms themselves by anywhere from
  // hours to several days -- a title can be "Recently Added" in the Netflix
  // app while TMDB still shows no provider for it at all. Trade press posts
  // "X lands on Netflix" the same day. Matched here to a real TMDB id (never
  // invented -- see matchFreshTitle), and tagged `src: 'reported'` rather than
  // folded in as though JustWatch had confirmed it, because it has not.
  //
  // Self-healing by construction: the row is keyed by the real TMDB id, so
  // the day the main sweep or JustWatch itself catches up and adds the same
  // provider id, the dedupe check below simply stops adding this one -- no
  // separate cleanup pass is needed.
  let reportedAttached = 0;
  let reportedAdded = 0;
  for (const row of freshReports ?? []) {
    const existingTarget = byKey.get(row.key);
    if (existingTarget) {
      if (existingTarget.p.some((x) => x.id === row.providerId)) continue;
      existingTarget.p.push({ id: row.providerId, on: null, src: 'reported', by: row.sourceName });
      reportedAttached += 1;
      continue;
    }

    // Genuinely new to today's dataset: TMDB knows the film (that is how the
    // match happened) but no sweep has ever seen a provider for it, so it
    // never reached byLanguage through the main loop above.
    const bucket = byLanguage.get(row.language);
    if (!bucket) continue; // an untracked language -- dropped, not guessed at

    const created = {
      id: row.key,
      t: row.title,
      d: row.date,
      i: row.poster,
      k: 'movie',
      y: null,
      p: [{ id: row.providerId, on: null, src: 'reported', by: row.sourceName }],
    };
    bucket.push(created);
    byKey.set(row.key, created);
    reportedAdded += 1;
  }

  // Names come from the snapshot that produced this data, never from a
  // constant in this file. A provider that changed id between runs then reads
  // correctly instead of inheriting whatever name once sat at that number.
  const providers = {};
  for (const [id, name] of Object.entries(latest.providers ?? {})) {
    providers[id] = { name, color: COLORS[id] ?? '#6E6E80' };
  }
  for (const [name, synth] of Object.entries(SYNTHETIC_PROVIDERS)) {
    providers[synth.id] = { name, color: synth.color };
  }

  // --- web series, placed by their network -------------------------------
  //
  // Most of these are not in the sweep at all, because the sweep finds titles
  // through providers and these have none. So they are added rather than
  // amended, and they are the reason the app can show a Telugu web series at
  // all — Panchanama, Aakali Rajyam and everything on ETV Win reach the app
  // only through this path.
  const idByName = new Map(Object.entries(providers).map(([id, p]) => [p.name, Number(id)]));

  let seriesAdded = 0;
  let seriesAmended = 0;

  for (const [key, rec] of Object.entries(series)) {
    if (!rec?.platform) continue;
    const pid = idByName.get(rec.platform);
    if (pid === undefined) continue;

    const bucket = byLanguage.get(rec.language);
    if (!bucket) continue;

    const existing = byKey.get(key);
    if (existing) {
      if (!existing.p.some((x) => x.id === pid)) {
        existing.p.push({ id: pid, on: null, src: 'network' });
        seriesAmended += 1;
      }
      continue;
    }

    bucket.push({
      id: key,
      t: rec.title,
      d: rec.date,
      i: rec.poster,
      k: 'tv',
      y: trailerFor(key, rec.language),
      p: [{ id: pid, on: null, src: 'network' }],
    });
    seriesAdded += 1;
  }

  const languages = [];

  for (const lang of LANGUAGES) {
    const titles = byLanguage.get(lang.code) ?? [];

    /**
     * Newest first, on ONE date axis.
     *
     * This used to sort by arrival date and only fall back to release date as a
     * tiebreak, which quietly put every arrival-dated title above every
     * release-dated one regardless of age: a film that reached ETV Win in
     * October 2025 sat above one released in September 2026. The app judges
     * periods on whichever date it has, so the feed has to order by the same
     * thing or the list reads as shuffled.
     */
    const effective = (t) => {
      const arrived = t.p.reduce((m, x) => (x.on && x.on > m ? x.on : m), '');
      return arrived || t.d || '';
    };
    titles.sort((a, b) => {
      const ae = effective(a);
      const be = effective(b);
      if (ae !== be) return ae < be ? 1 : -1;
      return String(a.t).localeCompare(String(b.t));
    });

    const payload = {
      version: latestDate,
      buildId: builtAt,
      language: lang.code,
      languageName: lang.name,
      // How far back arrival dates are actually known. The app uses this to say
      // "tracking since 13 Sep" rather than implying nothing launched before it.
      trackingSince: ledger.startedOn,
      providers,
      titles,
    };

    const file = join(OUT, 'v1', `${lang.code}.json`);
    writeFileSync(file, JSON.stringify(payload));

    const bytes = statSync(file).size;
    const gz = gzipSync(JSON.stringify(payload)).length;
    const withDate = titles.filter((t) => t.p.some((x) => x.on)).length;

    languages.push({
      code: lang.code,
      name: lang.name,
      titles: titles.length,
      withArrivalDate: withDate,
      bytes,
      gzipBytes: gz,
      path: `v1/${lang.code}.json`,
    });
  }

  const manifest = {
    // What the data is AS OF. Human-meaningful, and the same across every
    // publish made from one day's sweep.
    version: latestDate,
    // What the app actually compares against its cache.
    //
    // `version` alone was used for this and it was wrong: two publishes on the
    // same day produce the same date, so the app decided it was already current
    // and kept serving stale data. That is invisible in normal daily operation
    // and bites on exactly the occasions that matter -- a manual re-run, or a
    // fix pushed the same afternoon.
    buildId: builtAt,
    generatedAt: builtAt,
    region: 'IN',
    trackingSince: ledger.startedOn,
    snapshots: dates.length,
    imageBase: 'https://image.tmdb.org/t/p/',
    posterSize: 'w342',
    attribution: {
      tmdb: 'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
      justwatch: 'Streaming availability data provided by JustWatch.',
    },
    languages,
  };

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`Published version ${latestDate} from ${dates.length} snapshot(s)\n`);
  for (const l of languages) {
    console.log(
      `  ${l.name.padEnd(11)} ${String(l.titles).padStart(5)} titles  ` +
        `${String(l.withArrivalDate).padStart(5)} dated  ` +
        `${String(Math.round(l.gzipBytes / 1024)).padStart(4)} KB gz`
    );
  }
  const totalGz = languages.reduce((s, l) => s + l.gzipBytes, 0);
  console.log(`\n  manifest ${statSync(join(OUT, 'manifest.json')).size} bytes`);
  console.log(`  all languages ${Math.round(totalGz / 1024)} KB gzipped`);
  if (reportedAttached || reportedAdded) {
    console.log(`  news layer: ${reportedAttached} attached, ${reportedAdded} new titles (unconfirmed, pending TMDB)`);
  }
  console.log(`\nOutput: ${OUT}`);
}

// Same optional-file pattern as gapfill/dubs/series/trailers above: if the
// fast layer has never run, freshPath simply does not exist yet and the feed
// is exactly what it was before this layer existed.
const freshPath = resolve(HERE, 'data', 'fresh.json');
const freshReports = existsSync(freshPath)
  ? await resolveFreshReports(JSON.parse(readFileSync(freshPath, 'utf8')).releases)
  : [];

main(freshReports);
