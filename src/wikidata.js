/**
 * Wikidata via the public SPARQL endpoint.
 *
 * Used for credits — director, producers, cast, production company — because
 * Wikidata is CC0, which is a public-domain dedication and therefore requires
 * NO attribution at all. That matters: it is the only substantial film dataset
 * you can use freely with no credit line and no licence obligations.
 *
 * It is NOT used for streaming availability. A live query of 26 Telugu films
 * on 2026-09-12 returned zero Netflix / Disney+ / Apple TV identifiers, so the
 * availability data simply is not in there. Wikipedia prose carries it instead.
 */

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'TeluguOTTCatalog/0.1 (https://usarajacreatortools.com; contact: bandirsr@gmail.com) node-fetch';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

/** The endpoint is shared and rate-limited; one query at a time, spaced out. */
async function query(sparql, attempt = 0) {
  const since = Date.now() - lastCall;
  if (since < 1000) await sleep(1000 - since);
  lastCall = Date.now();

  const url = new URL(ENDPOINT);
  url.searchParams.set('query', sparql);
  url.searchParams.set('format', 'json');

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
  });

  if (res.status === 429 || res.status === 503) {
    if (attempt >= 3) throw new Error(`Wikidata throttled (${res.status})`);
    await sleep(3000 * (attempt + 1));
    return query(sparql, attempt + 1);
  }
  if (!res.ok) throw new Error(`Wikidata ${res.status} ${res.statusText}`);

  const json = await res.json();
  return json.results?.bindings ?? [];
}

function escapeLiteral(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Credits for a film, looked up by its English Wikipedia article title.
 *
 * Going in through the sitelink rather than by label avoids matching a
 * different work with the same name — the article title is already unique.
 */
export async function getCredits(wikipediaTitle) {
  const sparql = `
SELECT ?film ?role ?personLabel WHERE {
  ?sitelink schema:about ?film ;
            schema:isPartOf <https://en.wikipedia.org/> ;
            schema:name "${escapeLiteral(wikipediaTitle)}"@en .
  {
    ?film wdt:P57 ?person . BIND("director" AS ?role)
  } UNION {
    ?film wdt:P162 ?person . BIND("producer" AS ?role)
  } UNION {
    ?film wdt:P161 ?person . BIND("cast" AS ?role)
  } UNION {
    ?film wdt:P272 ?person . BIND("production_company" AS ?role)
  } UNION {
    ?film wdt:P86 ?person . BIND("music" AS ?role)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,te" . }
}
LIMIT 80`.trim();

  const rows = await query(sparql);
  if (rows.length === 0) return null;

  const credits = {
    qid: rows[0].film?.value?.split('/').pop() ?? null,
    directors: [],
    producers: [],
    cast: [],
    productionCompanies: [],
    music: [],
  };

  const bucket = {
    director: 'directors',
    producer: 'producers',
    cast: 'cast',
    production_company: 'productionCompanies',
    music: 'music',
  };

  for (const row of rows) {
    const role = row.role?.value;
    const name = row.personLabel?.value;
    if (!role || !name) continue;
    // A bare Q-id means the label service found no English label — that is not
    // a name, so it is dropped rather than shown to a user.
    if (/^Q\d+$/.test(name)) continue;
    const key = bucket[role];
    if (key && !credits[key].includes(name)) credits[key].push(name);
  }

  return credits;
}

export { query as rawQuery };
