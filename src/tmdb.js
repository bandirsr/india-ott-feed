/**
 * TMDB client — availability data, which is JustWatch's under a partnership.
 *
 * Chosen over Watchmode for one concrete reason: a live check of Watchmode's
 * India source list on 2026-09-12 returned 29 services WITHOUT aha, the flagship
 * native Telugu platform. JustWatch lists aha. For a Telugu-first app that
 * single gap decides it.
 *
 * THE TERMS, because they shape the whole product:
 *
 *   - The free tier is NON-COMMERCIAL ONLY. No ads, no subscription, no
 *     in-app purchases. Monetising at all requires their commercial licence
 *     ($149/month under $1M revenue).
 *   - Attribution is required: TMDB as the data source, and JustWatch
 *     specifically wherever provider/availability data is displayed.
 *   - NO DEEP LINKS. The TMDB–JustWatch agreement lets them say WHO has a
 *     title, not link to it. Plan the UI around "on aha" rather than an
 *     "Open in aha" button.
 *   - TMDB's terms bar use of their API in AI/ML applications. Any
 *     recommendation feature must not be built on this data.
 *
 * Neither provider covers ETV Win. That gap needs filling another way.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const BASE = 'https://api.themoviedb.org/3';

/** Shown wherever availability appears. Not optional under the licence. */
export const ATTRIBUTION = {
  data: 'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
  providers: 'Streaming availability data provided by JustWatch.',
};

export function loadTmdbKey() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY.trim();

  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return null;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== 'TMDB_API_KEY') continue;
    return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

let lastCall = 0;

/**
 * TMDB allows generous throughput but rate-limits bursts, so calls are spaced.
 * Supports both auth styles: a v4 read token (Bearer) or a v3 key (query param).
 */
async function call(path, params = {}, attempt = 0) {
  const key = loadTmdbKey();
  if (!key) throw new Error('No TMDB_API_KEY in .env');

  const since = Date.now() - lastCall;
  if (since < 60) await new Promise((r) => setTimeout(r, 60 - since));
  lastCall = Date.now();

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  // A v4 token is a long JWT; a v3 key is 32 hex characters.
  const isV4 = key.split('.').length === 3;
  const headers = { Accept: 'application/json' };
  if (isV4) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);

  const res = await fetch(url, { headers });

  if (res.status === 429) {
    if (attempt >= 3) throw new Error('TMDB rate limit persisted');
    const wait = Number(res.headers.get('retry-after') ?? 1) * 1000 || 1500;
    await new Promise((r) => setTimeout(r, wait));
    return call(path, params, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TMDB ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.json();
}

/** Every provider TMDB knows about in a region, with its id and logo path. */
export async function watchProviders(region = 'IN', kind = 'movie') {
  const json = await call(`/watch/providers/${kind}`, { watch_region: region });
  return (json.results ?? []).map((p) => ({
    id: p.provider_id,
    name: p.provider_name,
    priority: p.display_priority,
    logoPath: p.logo_path,
  }));
}

/**
 * Films by original language and region — the language-first axis the app is
 * built around. `with_original_language: 'te'` is Telugu.
 */
export async function discoverByLanguage({
  language = 'te',
  region = 'IN',
  providers,
  fromDate,
  toDate,
  page = 1,
  sortBy = 'primary_release_date.desc',
} = {}) {
  const json = await call('/discover/movie', {
    with_original_language: language,
    watch_region: region,
    with_watch_providers: providers,
    'primary_release_date.gte': fromDate,
    'primary_release_date.lte': toDate,
    sort_by: sortBy,
    page,
    include_adult: false,
  });
  return {
    page: json.page,
    totalPages: json.total_pages,
    totalResults: json.total_results,
    films: (json.results ?? []).map((f) => ({
      id: f.id,
      title: f.title,
      originalTitle: f.original_title,
      releaseDate: f.release_date || null,
      overview: f.overview,
      posterPath: f.poster_path,
      popularity: f.popularity,
    })),
  };
}

/** Where one film streams, per country. Providers only — never a deep link. */
export async function movieProviders(movieId, region = 'IN') {
  const json = await call(`/movie/${movieId}/watch/providers`);
  const r = json.results?.[region];
  if (!r) return { region, flatrate: [], rent: [], buy: [], free: [] };
  const names = (list) => (list ?? []).map((p) => ({ id: p.provider_id, name: p.provider_name }));
  return {
    region,
    flatrate: names(r.flatrate),
    rent: names(r.rent),
    buy: names(r.buy),
    free: names(r.free),
  };
}

export { call as rawCall };
