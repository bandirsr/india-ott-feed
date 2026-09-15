/**
 * Arrival dates, derived.
 *
 * TMDB will tell you that Peddi is on Netflix. It will not tell you that it
 * ARRIVED on Netflix last Tuesday — no field anywhere records that, and the
 * "this week" view the whole app is built around needs exactly that fact.
 *
 * So we compute it. Record which titles carry which providers today; do the
 * same tomorrow. A provider that appears on a title it was not on yesterday
 * arrived today, to the day. Run it daily and the archive builds itself.
 *
 * The trade is honest: this knows nothing on day one and needs a week before
 * "this week" means anything. Wikipedia and the news layer cover that window.
 * After that it is better than either — it sees dubbed titles, web series and
 * small films that no Telugu list page ever mentions, in every Indian language
 * at once, and no publisher can take it away.
 *
 *   node snapshot.js take            capture today
 *   node snapshot.js diff            arrivals since the previous snapshot
 *   node snapshot.js arrivals 30     everything that landed in the last 30 days
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawCall, watchProviders } from './tmdb.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SNAP_DIR = resolve(HERE, '..', 'data', 'snapshots');

/** Indian languages, in rough order of catalogue size. */
export const LANGUAGES = [
  { code: 'te', name: 'Telugu' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'kn', name: 'Kannada' },
  { code: 'bn', name: 'Bengali' },
  { code: 'mr', name: 'Marathi' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'gu', name: 'Gujarati' },
];

/**
 * The platforms worth tracking, named rather than numbered.
 *
 * An earlier version hardcoded TMDB's numeric ids and got two of them wrong:
 * 2285 was labelled "Amazon MiniTV" when TMDB actually uses it for "JustWatch
 * TV", so every title on one service was published under another's name, and
 * 220 "Jio Cinema" had stopped being an India provider at all after the
 * JioHotstar merger. Neither failed loudly. Both silently published wrong data.
 *
 * So ids are never written down here. Names are matched against the live list
 * at sweep time, which means a rename or a merger surfaces as a warning instead
 * of as a mislabelled platform, and a service that changes id is simply found
 * again at its new one.
 */
export const TRACKED_NAMES = [
  // The reason this project uses TMDB at all: Watchmode omits aha entirely.
  'aha',
  'Netflix',
  'Amazon Prime Video',
  'JioHotstar',
  'Zee5',
  'Sun Nxt',
  'Sony Liv',
  'MX Player',
  'Amazon MX Player', // the former Amazon MiniTV
  'Hoichoi',
  'ManoramaMax',
  'Apple TV', // TMDB's name for Apple TV+; "Apple TV Store" is the separate rental storefront
  'MUBI',
  'Lionsgate Play',
  'Hungama Play',
  'ShemarooMe',
  'EPIC ON',
  'Discovery+',
  'Crunchyroll',
  'Tata Play',
  'VI movies and tv',
  'Chaupal Amazon Channel',
];

/**
 * Anything TMDB ranks this highly for India gets tracked whether or not it is
 * named above. It is how a platform that launches next year, or one this list
 * forgot, gets picked up without anybody editing code.
 */
const AUTO_TRACK_PRIORITY = 25;

/**
 * Resolve the tracked set against the live provider list.
 *
 * Returns the providers to sweep plus `missing` — names we expect and TMDB no
 * longer lists. Missing is not an error: aha could genuinely leave. It is a
 * signal that wants a human's eye, so it is reported rather than swallowed.
 */
export async function resolveProviders(region = 'IN') {
  const [movies, shows] = await Promise.all([watchProviders(region, 'movie'), watchProviders(region, 'tv')]);

  const live = new Map();
  for (const p of [...movies, ...shows]) if (!live.has(p.id)) live.set(p.id, p);

  const byName = new Map([...live.values()].map((p) => [p.name.toLowerCase(), p]));
  const chosen = new Map();

  for (const name of TRACKED_NAMES) {
    const hit = byName.get(name.toLowerCase());
    if (hit) chosen.set(hit.id, { id: hit.id, name: hit.name });
  }

  for (const p of live.values()) {
    if (p.priority <= AUTO_TRACK_PRIORITY) chosen.set(p.id, { id: p.id, name: p.name });
  }

  const missing = TRACKED_NAMES.filter((n) => !byName.has(n.toLowerCase()));

  return { providers: [...chosen.values()], missing, liveCount: live.size };
}

/**
 * Platforms that exist to serve one language, and which language that is.
 *
 * Sweeping only by TMDB's `original_language` hides a third of what these
 * platforms carry. aha holds 198 films; 126 are Telugu originals and the other
 * 72 are Tamil, Malayalam and Kannada films sitting on a Telugu service — which
 * is exactly what aha is for. Filed by original language, none of those 72 ever
 * appeared when a Telugu viewer tapped "Telugu", even though aha is the most
 * Telugu thing in the app.
 *
 * So for these platforms the question changes from "what was made in Telugu" to
 * "what can I watch in Telugu", which is the question people are actually
 * asking. Titles found this way keep their real original language in `ol`, and
 * the app labels them, so nothing is passed off as something it is not.
 *
 * Deliberately NOT Sun NXT, Netflix, Prime or JioHotstar: those are genuinely
 * multi-language, and a Tamil film on Sun NXT carries no implication that a
 * Telugu track exists.
 */
export const PLATFORM_LANGUAGE = {
  aha: 'te',
  'ETV Win': 'te',
  Hoichoi: 'bn',
  ManoramaMax: 'ml',
  'ManoramaMAX Amazon Channel': 'ml',
  'Hoichoi Amazon Channel': 'bn',
  // Punjabi. The only other tracked platform that serves one language; Sun Nxt,
  // Zee5 and ShemarooMe all carry several, so sweeping them without a language
  // filter would file Hindi and English titles under whichever language asked.
  'Chaupal Amazon Channel': 'pa',
};

const MAX_PAGES = 60; // 1,200 titles per provider per language per kind

/**
 * Every title a provider carries in one language. `kind` is 'movie' or 'tv',
 * which TMDB models as two separate endpoints using different field names for
 * the same two concepts.
 */
async function sweep(kind, languageCode, providerId) {
  // A null languageCode means "every language on this platform" -- the pass
  // that finds dubbed titles. TMDB omits the filter entirely when the param
  // is undefined.

  const out = [];
  let page = 1;
  let totalPages = 1;

  while (page <= Math.min(totalPages, MAX_PAGES)) {
    const json = await rawCall(`/discover/${kind}`, {
      with_original_language: languageCode ?? undefined,
      watch_region: 'IN',
      with_watch_providers: providerId,
      sort_by: kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      include_adult: false,
      page,
    });
    totalPages = json.total_pages ?? 1;
    for (const r of json.results ?? []) {
      out.push({
        id: r.id,
        title: kind === 'movie' ? r.title : r.name,
        date: (kind === 'movie' ? r.release_date : r.first_air_date) || null,
        poster: r.poster_path || null,
        original: r.original_language || null,
      });
    }
    page += 1;
  }
  return out;
}

/** Today, as TMDB dates are written. */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * One full pass. Returns a map of "movie:1234" -> record, where `p` is the set
 * of provider ids currently carrying it.
 */
export async function take({ languages = LANGUAGES, providers, kinds = ['movie', 'tv'], onProgress } = {}) {
  const titles = {};
  let sweeps = 0;

  // Resolved live unless a caller supplies its own set, so a sweep always uses
  // today's ids rather than ids that were right when the code was written.
  const resolved = providers ?? (await resolveProviders()).providers;

  for (const lang of languages) {
    for (const kind of kinds) {
      for (const prov of resolved) {
        const found = await sweep(kind, lang.code, prov.id);
        sweeps += 1;
        for (const f of found) {
          const key = `${kind}:${f.id}`;
          if (!titles[key]) {
            titles[key] = { t: f.title, l: lang.code, d: f.date, i: f.poster, p: [] };
          }
          if (!titles[key].p.includes(prov.id)) titles[key].p.push(prov.id);
        }
        onProgress?.({ language: lang.name, kind, provider: prov.name, found: found.length });
      }
    }
  }

  // --- second pass: single-language platforms, every original language -----
  //
  // A title already found above keeps its own `l`; this only adds the extra
  // language it should ALSO appear under, in `also`. Keeping `l` untouched
  // matters because the ledger is keyed on the title, not the language — a
  // film must not change identity between runs.
  let dubbed = 0;

  for (const prov of resolved) {
    const langCode = PLATFORM_LANGUAGE[prov.name];
    if (!langCode) continue;

    for (const kind of kinds) {
      const found = await sweep(kind, null, prov.id);
      sweeps += 1;

      for (const f of found) {
        const key = `${kind}:${f.id}`;

        if (!titles[key]) {
          titles[key] = { t: f.title, l: langCode, d: f.date, i: f.poster, p: [] };
          if (f.original && f.original !== langCode) {
            titles[key].ol = f.original;
            dubbed += 1;
          }
        } else if (titles[key].l !== langCode) {
          const also = titles[key].also ?? [];
          if (!also.includes(langCode)) {
            also.push(langCode);
            titles[key].also = also;
            dubbed += 1;
          }
        }

        if (!titles[key].p.includes(prov.id)) titles[key].p.push(prov.id);
      }

      onProgress?.({ language: `${langCode} (all originals)`, kind, provider: prov.name, found: found.length });
    }
  }

  // Names travel WITH the snapshot. Reading them from a module constant at
  // publish time is what let a stale id print the wrong platform name.
  const providerNames = {};
  for (const p of resolved) providerNames[p.id] = p.name;

  return { date: today(), region: 'IN', takenAt: new Date().toISOString(), sweeps, dubbed, providers: providerNames, titles };
}

export function save(snapshot) {
  mkdirSync(SNAP_DIR, { recursive: true });
  const path = join(SNAP_DIR, `${snapshot.date}.json`);
  writeFileSync(path, JSON.stringify(snapshot));
  return path;
}

/** Snapshot filenames are ISO dates, so lexical order is chronological. */
export function listSnapshots() {
  if (!existsSync(SNAP_DIR)) return [];
  return readdirSync(SNAP_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => f.slice(0, -5));
}

export function load(date) {
  const path = join(SNAP_DIR, `${date}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * What changed between two snapshots.
 *
 * An `arrival` is a (title, provider) pair present in `after` and absent from
 * `before` — including a title that is wholly new, which is the common case for
 * a direct-to-OTT release. A `departure` is the reverse, and matters more than
 * it sounds: licences lapse, and an app that still claims a film is on Netflix
 * a month after it left is worse than one that says nothing.
 */
export function diff(before, after) {
  const arrivals = [];
  const departures = [];
  const nameOf = (pid) => after.providers?.[pid] ?? before?.providers?.[pid] ?? String(pid);

  for (const [key, rec] of Object.entries(after.titles)) {
    const was = before?.titles?.[key]?.p ?? [];
    for (const pid of rec.p) {
      if (!was.includes(pid)) {
        arrivals.push({
          key,
          title: rec.t,
          language: rec.l,
          released: rec.d,
          poster: rec.i,
          provider: pid,
          providerName: nameOf(pid),
          on: after.date,
        });
      }
    }
  }

  if (before) {
    for (const [key, rec] of Object.entries(before.titles)) {
      const now = after.titles?.[key]?.p ?? [];
      for (const pid of rec.p) {
        if (!now.includes(pid)) {
          departures.push({
            key,
            title: rec.t,
            language: rec.l,
            provider: pid,
            providerName: nameOf(pid),
            on: after.date,
          });
        }
      }
    }
  }

  return { from: before?.date ?? null, to: after.date, arrivals, departures };
}

/**
 * The app's actual query: what landed in the last N days, newest first.
 * Walks every consecutive pair of snapshots, so it is only ever as deep as the
 * archive is old.
 */
export function arrivalsWithin(days) {
  const dates = listSnapshots();
  if (dates.length < 2) {
    return {
      arrivals: [],
      coverage: dates.length,
      note: 'Need at least two snapshots before arrivals can be derived.',
    };
  }

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const all = [];

  for (const date of dates.filter((d) => d >= cutoff)) {
    const idx = dates.indexOf(date);
    if (idx === 0) continue;
    all.push(...diff(load(dates[idx - 1]), load(date)).arrivals);
  }

  all.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
  return { arrivals: all, coverage: dates.length, oldest: dates[0] };
}
