/**
 * The pipeline.
 *
 * Fully automated, no scraping, no manual compiling:
 *
 *   1. resolve each film to its real Wikipedia page (never guess titles)
 *   2. pull the plain-text article  →  availability sentences
 *   3. pull the page's citations    →  the second source, free
 *   4. pull credits from Wikidata   →  CC0, no attribution owed
 *   5. score and reconcile          →  one row per (platform, language)
 *   6. write JSON
 *
 * Run:  node run.js                       (the built-in sample of films)
 *       node run.js --year 2026           (every film on that year's list)
 *       node run.js "Pushpa 2: The Rule"  (one film)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTitle, getExtract, getCitations, getListWikitext } from './src/wikipedia.js';
import { extractAvailability, extractTheatricalDate, looksLikeFilm } from './src/extract.js';
import { getCredits } from './src/wikidata.js';
import { scoreClaims, reconcile } from './src/validate.js';
import { findTrailer, findTrailerKeyless, verifyVideo, loadApiKey } from './src/youtube.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A deliberately mixed sample: multi-platform, single-platform, older, newer. */
const SAMPLE = [
  'Kalki 2898 AD',
  'Devara: Part 1',
  'Pushpa 2: The Rule',
  'Salaar: Part 1 – Ceasefire',
  'Hanu-Man',
  'Guntur Kaaram',
  'RRR',
  'Sita Ramam',
  'Tillu Square',
  'Baahubali 2: The Conclusion',
];

/**
 * Film titles out of a yearly list page's wikitext.
 *
 * The list pages use table rows where the title is a wiki-link in the second
 * or third cell. Rather than trying to parse the table layout — which varies
 * year to year — we take every internal link and drop the obvious non-films.
 */
function titlesFromWikitext(wikitext) {
  const links = [...wikitext.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());

  const rejected =
    /^(List of|Category:|File:|Image:|Template:|Telugu cinema|Tollywood|Cinema of|India$|Andhra Pradesh|Telangana|Hyderabad|Netflix$|ZEE5$|Amazon Prime Video$|Disney\+|SonyLIV$|aha$|Sun NXT$|ETV Win$|JioHotstar$|JioCinema$)/i;

  const seen = new Set();
  const out = [];
  for (const link of links) {
    if (rejected.test(link)) continue;
    if (link.length < 2) continue;
    const key = link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

async function buildFilm(name) {
  const title = await resolveTitle(name);
  if (!title) return { input: name, status: 'not-found' };

  const article = await getExtract(title);
  if (!article || !article.text) return { input: name, title, status: 'no-article' };

  // Yearly list pages link to cast and crew as well as films, and a biography
  // contains real streaming sentences about other people's work. Reject those
  // before extracting anything from them.
  if (!looksLikeFilm(article.text)) {
    return { input: name, title: article.title, status: 'not-a-film' };
  }

  const rawClaims = extractAvailability(article.text);
  const theatrical = extractTheatricalDate(article.text);

  // Citations are only worth fetching when there is a claim to corroborate.
  let citations = [];
  if (rawClaims.length > 0) {
    try {
      citations = await getCitations(title);
    } catch (err) {
      console.error(`    citations failed for ${title}: ${err.message}`);
    }
  }

  const scored = scoreClaims(rawClaims, citations);
  const availability = reconcile(scored);

  let credits = null;
  try {
    credits = await getCredits(article.title);
  } catch (err) {
    console.error(`    credits failed for ${title}: ${err.message}`);
  }

  return {
    input: name,
    title: article.title,
    status: availability.length > 0 ? 'ok' : 'no-ott-found',
    theatricalDate: theatrical?.date ?? null,
    availability,
    tvPremieres: scored.filter((c) => c.kind === 'tv').map((c) => ({ channel: c.platform, date: c.date })),
    credits,
    trailer: { status: 'pending' },
    citations,
    citationCount: citations.length,
    sources: ['en.wikipedia.org (Action API)', 'query.wikidata.org (SPARQL, CC0)'],
    fetchedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (loadApiKey()) {
    console.log('YouTube API key found — trailers and thumbnails enabled.');
  } else {
    console.log('No YouTube API key (set YOUTUBE_API_KEY in .env) — skipping trailers.');
  }

  let films = SAMPLE;
  let label = 'sample';

  if (args[0] === '--year') {
    const year = args[1] ?? String(new Date().getFullYear());
    console.log(`Fetching the film roster for ${year}...`);
    const wikitext = await getListWikitext(year);
    films = titlesFromWikitext(wikitext);
    label = `telugu-${year}`;
    console.log(`  ${films.length} candidate titles found on the list page`);
  } else if (args.length > 0) {
    films = args;
    label = 'adhoc';
  }

  const results = [];
  let index = 0;

  for (const name of films) {
    index += 1;
    process.stdout.write(`[${index}/${films.length}] ${name} ... `);
    try {
      const film = await buildFilm(name);
      results.push(film);
      if (film.status === 'ok') {
        const summary = film.availability
          .map((a) => `${a.platform}/${a.language}`)
          .slice(0, 4)
          .join(', ');
        console.log(`${film.availability.length} rows — ${summary}`);
      } else {
        console.log(film.status);
      }
    } catch (err) {
      console.log(`ERROR ${err.message}`);
      results.push({ input: name, status: 'error', error: err.message });
    }
  }

  // ---- which films actually need a trailer ----
  //
  // Trailers are the only step that costs quota, so they run AFTER the filter
  // rather than for every film on a yearly list. Building a whole year and
  // searching for 150 trailers would consume the entire day's allowance on
  // films nobody asked about.
  const sinceDays = args.includes('--since') ? Number(args[args.indexOf('--since') + 1]) : null;
  const cutoff = sinceDays ? Date.now() - sinceDays * 86_400_000 : null;

  const selected = results.filter((film) => {
    if (film.status !== 'ok') return false;
    if (!cutoff) return true;
    return film.availability.some((a) => a.date && Date.parse(a.date) >= cutoff);
  });

  if (cutoff) {
    console.log(`
${selected.length} of ${results.length} films have an OTT date in the last ${sinceDays} days`);
  }

  const hasKey = !!loadApiKey();
  console.log(`
Finding trailers for ${selected.length} films...`);

  for (const film of selected) {
    let trailer = { status: 'no-candidates' };
    try {
      if (film.citations?.length > 0) {
        trailer = await findTrailerKeyless(film.title, film.citations);
      }
      if (trailer.status !== 'ok' && hasKey) {
        const year = film.theatricalDate ? film.theatricalDate.slice(0, 4) : undefined;
        const viaApi = await findTrailer(film.title, { year });
        if (viaApi.status === 'ok') trailer = { ...viaApi, via: 'api-search' };
        else trailer = { ...trailer, apiFallback: viaApi.status };
      }

      // Verify the actual video, not just the search snippet. One quota unit.
      if (trailer.status === 'ok' && hasKey) {
        const check = await verifyVideo(trailer.videoId, film.title);
        trailer.verification = check;
        // Reject anything that fails the hard checks — a full-length upload is
        // piracy, and a 9-second clip is not a trailer.
        if (check.verified === false && check.reason !== 'no-key') {
          trailer = {
            status: 'rejected-by-verification',
            rejected: { videoId: trailer.videoId, title: trailer.title, channelTitle: trailer.channelTitle },
            verification: check,
          };
        }
      }
    } catch (err) {
      trailer = { status: 'error', detail: err.message };
    }
    film.trailer = trailer;

    const mark =
      trailer.status === 'ok'
        ? `${trailer.verification?.confidence ?? '?'}  [${trailer.verification?.channelTitle ?? trailer.channelTitle}]`
        : trailer.status;
    console.log(`  ${film.title.padEnd(34).slice(0, 34)} ${mark}`);
  }

  // Citations were only needed for corroboration and trailer mining; they are
  // hundreds of URLs per film and have no place in the shipped dataset.
  for (const film of results) delete film.citations;

  mkdirSync(resolvePath(HERE, 'data'), { recursive: true });
  const outPath = resolvePath(HERE, 'data', `${label}.json`);
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), films: results }, null, 2));

  const ok = results.filter((r) => r.status === 'ok');
  const rows = ok.reduce((s, f) => s + f.availability.length, 0);
  const confirmed = ok.reduce(
    (s, f) => s + f.availability.filter((a) => a.platformConfidence === 'confirmed').length,
    0
  );

  console.log('\n--- Summary ---');
  console.log(`films processed        ${results.length}`);
  console.log(`with OTT availability  ${ok.length}`);
  console.log(`availability rows      ${rows}`);
  console.log(`platform confirmed     ${confirmed}/${rows}`);
  const tOk = results.filter((r) => r.trailer?.status === 'ok');
  const highConf = tOk.filter((r) => r.trailer.verification?.confidence === 'high').length;
  const rejected = results.filter((r) => r.trailer?.status === 'rejected-by-verification').length;
  console.log(`trailers found         ${tOk.length}/${selected.length} selected  (keyless ${tOk.filter((r) => r.trailer.via === 'keyless').length}, api ${tOk.filter((r) => r.trailer.via === 'api-search').length})`);
  console.log(`  verified trusted     ${highConf}/${tOk.length}`);
  if (rejected > 0) console.log(`  rejected by checks   ${rejected}`);
  console.log(`written to             ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
