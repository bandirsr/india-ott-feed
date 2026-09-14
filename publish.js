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

/**
 * Platforms with no TMDB id get a synthetic negative one.
 *
 * Negative so it can never collide with a real TMDB provider id, now or after
 * TMDB adds the platform itself. If ETV Win ever appears in TMDB, the main
 * sweep picks it up under its real id and this entry simply stops being used.
 */
const SYNTHETIC_PROVIDERS = {
  'ETV Win': { id: -1, color: '#E4572E' },
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

function main() {
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

  // Trailers are optional. They backfill over days on their own budget, so a
  // publish must never wait for them or fail without them.
  const trailerPath = resolve(HERE, 'data', 'trailers.json');
  const trailers = existsSync(trailerPath) ? JSON.parse(readFileSync(trailerPath, 'utf8')) : {};

  mkdirSync(join(OUT, 'v1'), { recursive: true });

  const byLanguage = new Map(LANGUAGES.map((l) => [l.code, []]));

  for (const [key, rec] of Object.entries(latest.titles)) {
    const entry = {
      id: key,
      t: rec.t,
      d: rec.d, // theatrical / first-air date
      i: rec.i, // poster path, relative to imageBase
      k: key.startsWith('tv:') ? 'tv' : 'movie',
      // YouTube video key, or absent. The app builds both the watch URL and the
      // still from it, so one short string carries both.
      y: trailers[key]?.key ?? null,
      p: rec.p.map((pid) => ({ id: pid, on: arrivalDate(ledger, key, pid) })),
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
      bucket.push(ol ? { ...entry, ol } : entry);
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

  const languages = [];

  for (const lang of LANGUAGES) {
    const titles = byLanguage.get(lang.code) ?? [];

    // Newest first, so a truncated read still shows the useful end.
    titles.sort((a, b) => {
      const an = a.p.reduce((m, x) => (x.on && x.on > m ? x.on : m), '');
      const bn = b.p.reduce((m, x) => (x.on && x.on > m ? x.on : m), '');
      if (an !== bn) return an < bn ? 1 : -1;
      return (b.d ?? '') < (a.d ?? '') ? -1 : 1;
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
      tmdb: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
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
  console.log(`\nOutput: ${OUT}`);
}

main();
