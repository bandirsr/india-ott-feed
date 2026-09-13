/**
 * Adds trailers to an already-built catalogue file.
 *
 * Separate from `run.js` because the expensive part of a year build is the 330
 * Wikipedia and Wikidata round trips, and those results do not change when you
 * simply want trailers for more of the films. This reads the JSON, fills in the
 * gaps, and writes it back.
 *
 * Only the API search is available here — the keyless route mines the article's
 * citations, and those are stripped from the saved file because they run to
 * hundreds of URLs per film.
 *
 * Run:  node add-trailers.js data/telugu-2026.json [--limit 25]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTrailer, verifyVideo, loadApiKey, QUOTA } from './src/youtube.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const file = resolve(HERE, args.find((a) => !a.startsWith('--')) ?? 'data/telugu-2026.json');
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 40;

if (!loadApiKey()) {
  console.error('No YOUTUBE_API_KEY in .env — nothing to do.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf8'));

const needing = (data.films ?? []).filter(
  (f) => f.status === 'ok' && f.trailer?.status !== 'ok'
);

console.log(`${needing.length} films without a trailer; doing up to ${limit}.`);
console.log(`Estimated cost: ${Math.min(needing.length, limit) * (QUOTA.searchCost + 1)} of ${QUOTA.dailyFree} daily units.\n`);

let done = 0;
let rejected = 0;

for (const film of needing.slice(0, limit)) {
  const year = film.theatricalDate ? film.theatricalDate.slice(0, 4) : undefined;
  try {
    let trailer = await findTrailer(film.title, { year });

    if (trailer.status === 'ok') {
      trailer.via = 'api-search';
      const check = await verifyVideo(trailer.videoId, film.title);
      trailer.verification = check;
      if (check.verified === false && check.reason !== 'no-key') {
        trailer = {
          status: 'rejected-by-verification',
          rejected: { videoId: trailer.videoId, title: trailer.title, channelTitle: trailer.channelTitle },
          verification: check,
        };
        rejected += 1;
      } else {
        done += 1;
      }
    }

    film.trailer = trailer;

    const mark =
      trailer.status === 'ok'
        ? `${trailer.verification?.confidence ?? '?'}  ${Math.round((trailer.verification?.durationSec ?? 0))}s  [${trailer.verification?.channelTitle ?? trailer.channelTitle}]`
        : trailer.status;
    console.log(`  ${String(film.title).padEnd(36).slice(0, 36)} ${mark}`);

    if (trailer.status === 'quota-exceeded') {
      console.log('\nQuota exhausted — stopping. Re-run tomorrow; everything so far is cached.');
      break;
    }
  } catch (err) {
    console.log(`  ${film.title} — ERROR ${err.message}`);
  }
}

writeFileSync(file, JSON.stringify(data, null, 2));
console.log(`\n${done} trailers added, ${rejected} rejected by verification.`);
console.log(`Written to ${file}`);
