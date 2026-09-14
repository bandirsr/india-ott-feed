/**
 * Web series, via the network that made them.
 *
 * The pipeline has been nearly blind to Telugu web series and this is why:
 * it finds everything through `with_watch_providers`, and JustWatch barely
 * tags Indian series. Measured on the ten most recent Telugu series TMDB
 * knows about:
 *
 *   have an India watch provider    2 of 10
 *   have a `networks` entry         8 of 10
 *
 * For a streaming original the network IS where you watch it. Panchanama's
 * network is ZEE5, Aakali Rajyam's is aha, Gurthukosthunnayi's is ETV Win —
 * the platform no aggregator covers at all. Four times the coverage, from a
 * field already in the response.
 *
 * The catch, and the reason this is a separate module rather than a flag: a
 * network is not always a streaming service. Telugu series also air on Star
 * Maa, Zee Telugu and Gemini TV, which are broadcast channels. Treating those
 * as "where to stream it" would tell someone to watch a show on a service that
 * does not exist. So only networks that ARE streaming platforms count, and the
 * list is explicit rather than inferred.
 */

import { rawCall } from './tmdb.js';

/**
 * Network names as TMDB writes them, mapped to the provider names this project
 * already uses. Only streaming services appear here.
 */
export const NETWORK_TO_PLATFORM = {
  zee5: 'Zee5',
  aha: 'aha',
  'etv win': 'ETV Win',
  jiohotstar: 'JioHotstar',
  'disney+ hotstar': 'JioHotstar',
  hotstar: 'JioHotstar',
  jiocinema: 'JioHotstar',
  'prime video': 'Amazon Prime Video',
  'amazon prime video': 'Amazon Prime Video',
  netflix: 'Netflix',
  sonyliv: 'Sony Liv',
  'sony liv': 'Sony Liv',
  'sun nxt': 'Sun Nxt',
  hoichoi: 'Hoichoi',
  manoramamax: 'ManoramaMax',
  'mx player': 'MX Player',
  'amazon minitv': 'Amazon MX Player',
  'amazon mx player': 'Amazon MX Player',
  ullu: 'Ullu',
  'aha video': 'aha',
};

/**
 * Broadcast channels, listed so they are excluded deliberately rather than by
 * happening to be absent from the map above. A Telugu serial on Star Maa is on
 * television; saying it streams somewhere would be a fabrication.
 */
export const BROADCAST_ONLY = new Set([
  'star maa',
  'zee telugu',
  'gemini tv',
  'etv',
  'etv telugu',
  'star vijay',
  'colors',
  'sun tv',
  'udaya tv',
  'asianet',
  'maa tv',
  'dd national',
]);

/** The streaming platform a series is on, from its networks. Null if none is. */
export function platformFromNetworks(networks = []) {
  for (const net of networks) {
    const name = String(net?.name ?? '').trim().toLowerCase();
    if (!name || BROADCAST_ONLY.has(name)) continue;
    const platform = NETWORK_TO_PLATFORM[name];
    if (platform) return platform;
  }
  return null;
}

/**
 * A weaker fallback: the production company.
 *
 * Veerabhadruni Rahasyam has no network at all but lists "ZEE5" as a producer,
 * which in practice means a ZEE5 original. Used only when networks give
 * nothing, because a production company is genuinely a different thing from a
 * distributor and the two coincide less often than they look like they do.
 */
export function platformFromCompanies(companies = []) {
  for (const c of companies) {
    const name = String(c?.name ?? '').trim().toLowerCase();
    const platform = NETWORK_TO_PLATFORM[name];
    if (platform) return platform;
  }
  return null;
}

/** Every series TMDB has in one language, newest first. */
export async function seriesIn(languageCode, { since, maxPages = 15 } = {}) {
  const out = [];
  let page = 1;
  let totalPages = 1;

  while (page <= Math.min(totalPages, maxPages)) {
    const json = await rawCall('/discover/tv', {
      with_original_language: languageCode,
      'first_air_date.gte': since,
      sort_by: 'first_air_date.desc',
      include_adult: false,
      page,
    });
    totalPages = json.total_pages ?? 1;
    for (const r of json.results ?? []) {
      out.push({
        id: r.id,
        title: r.name,
        date: r.first_air_date || null,
        poster: r.poster_path || null,
        language: languageCode,
      });
    }
    page += 1;
  }
  return out;
}

/**
 * Resolve series to platforms, within a budget.
 *
 * `known` caches previous answers including the misses, so a re-run only pays
 * for series it has never seen.
 */
export async function findSeriesPlatforms({
  languages,
  since,
  budget = 300,
  known = {},
  onProgress,
} = {}) {
  const cache = { ...known };
  const seen = new Map();

  for (const lang of languages) {
    for (const s of await seriesIn(lang.code, { since })) {
      const key = `tv:${s.id}`;
      if (!seen.has(key)) seen.set(key, s);
    }
  }

  let spent = 0;
  let found = 0;

  for (const [key, series] of seen) {
    if (key in cache) {
      if (cache[key]?.platform) found += 1;
      continue;
    }
    if (spent >= budget) break;

    try {
      const full = await rawCall(`/tv/${series.id}`);
      spent += 1;

      const platform =
        platformFromNetworks(full.networks) ?? platformFromCompanies(full.production_companies);

      cache[key] = platform
        ? {
            platform,
            title: full.name,
            date: full.first_air_date || null,
            poster: full.poster_path || null,
            language: full.original_language,
            via: platformFromNetworks(full.networks) ? 'network' : 'company',
          }
        : null;

      if (platform) found += 1;
    } catch {
      // Uncached so the next run retries rather than recording a permanent miss.
      spent += 1;
    }

    onProgress?.({ spent, budget, found, title: series.title });
  }

  return { cache, series: seen, spent, found, total: seen.size };
}
