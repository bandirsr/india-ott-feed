/**
 * Wikipedia Action API client.
 *
 * This is deliberately NOT a scraper. It talks to the documented public API,
 * which exists precisely so software can reuse the content. That is why it will
 * keep working: there is no robots.txt to fall foul of, no bot detection to
 * evade, and no terms forbidding reuse of the facts.
 *
 * The obligations are small and we meet all of them here:
 *   1. A descriptive User-Agent with a contact address. Wikimedia blocks
 *      anonymous/generic agents, and that is the single most common reason
 *      people think "Wikipedia blocked me".
 *   2. `maxlag` — tells the servers to reject our call rather than add load
 *      when replication is behind. We back off and retry instead of hammering.
 *   3. Serial requests with a small delay. No concurrency, no bursts.
 */

const API = 'https://en.wikipedia.org/w/api.php';

/** Identify yourself honestly. Change the contact before running at volume. */
const USER_AGENT =
  'TeluguOTTCatalog/0.1 (https://usarajacreatortools.com; contact: bandirsr@gmail.com) node-fetch';

/** Wikimedia asks for politeness, not a specific number. This is well inside it. */
const DELAY_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;

async function call(params, attempt = 0) {
  // Simple serial throttle — never more than one call per DELAY_MS.
  const since = Date.now() - lastCall;
  if (since < DELAY_MS) await sleep(DELAY_MS - since);
  lastCall = Date.now();

  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: 2, maxlag: 5, ...params })) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' } });

  // 429 and the maxlag error both mean "come back later" — honour it rather
  // than retrying immediately, which is what gets clients actually blocked.
  if (res.status === 429 || res.status === 503) {
    if (attempt >= 4) throw new Error(`Wikipedia throttled us (${res.status}) after ${attempt} retries`);
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 2000 * (attempt + 1);
    await sleep(wait);
    return call(params, attempt + 1);
  }

  if (!res.ok) throw new Error(`Wikipedia API ${res.status} ${res.statusText}`);

  const json = await res.json();
  if (json.error?.code === 'maxlag') {
    if (attempt >= 4) throw new Error('Wikipedia maxlag persisted');
    await sleep(2000 * (attempt + 1));
    return call(params, attempt + 1);
  }
  if (json.error) throw new Error(`Wikipedia API error: ${json.error.code} — ${json.error.info}`);

  return json;
}

/**
 * Resolve a film name to a real page title.
 *
 * This step exists because guessing titles fails constantly — "HanuMan (film)"
 * does not exist but "Hanu-Man" does, and "Game Changer (2025 film)" is not
 * the real disambiguator either. Searching first removes that whole class of
 * silent misses.
 */
export async function resolveTitle(name, year) {
  const json = await call({
    action: 'query',
    list: 'search',
    srsearch: `${name} ${year ?? ''} Telugu film`.trim(),
    srlimit: 5,
    srnamespace: 0,
  });
  const hits = json.query?.search ?? [];
  if (hits.length === 0) return null;

  // Prefer a hit whose title looks like the film rather than a list or a person.
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const scored = hits.map((h) => {
    const t = h.title.toLowerCase();
    let score = 0;
    if (t.replace(/[^a-z0-9]/g, '').startsWith(cleaned)) score += 10;
    if (t.includes('film')) score += 3;
    if (t.startsWith('list of')) score -= 20;
    return { title: h.title, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > -10 ? scored[0].title : null;
}

/** Full plain-text article. The OTT sentence lives in the body, not the intro. */
export async function getExtract(title) {
  const json = await call({
    action: 'query',
    prop: 'extracts',
    explaintext: 1,
    redirects: 1,
    titles: title,
  });
  const page = json.query?.pages?.[0];
  if (!page || page.missing) return null;
  return { title: page.title, text: page.extract ?? '' };
}

/**
 * Every external link on the page.
 *
 * These are the citations Wikipedia itself used, which means the second
 * independent source for a claim arrives free with the claim. Confirmed on
 * Hanu-Man: 200+ links including OTTplay, Hindustan Times and Deccan Chronicle
 * pieces specifically about the streaming release.
 */
export async function getCitations(title) {
  const json = await call({ action: 'parse', page: title, prop: 'externallinks', redirects: 1 });
  return json.parse?.externallinks ?? [];
}

/** Raw wikitext of the yearly list page — the source of the film roster. */
export async function getListWikitext(year) {
  const json = await call({
    action: 'parse',
    page: `List of Telugu films of ${year}`,
    prop: 'wikitext',
    redirects: 1,
  });
  return json.parse?.wikitext ?? '';
}

export { call as rawCall, USER_AGENT };
