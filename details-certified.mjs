/**
 * Descriptions for A-certified films, ahead of publishing.
 *
 * src/safety.js hides an A-certified film that has no description, because it
 * has nothing to judge the film by. That is right for a film TMDB truly has no
 * text for, and wrong for one we simply have not looked at yet: details.js
 * works newest-first on a budget and caches an empty answer forever, so a new
 * film (e.g. The Paradise, Oct 2026) or one whose text TMDB added later stayed
 * hidden indefinitely.
 *
 * This runs after certs.js and before publish.js and asks TMDB again for every
 * A-certified film whose cached details are missing or have no synopsis. It
 * never touches the rest of the cache, and costs one call per such film (a
 * couple of dozen).
 *
 *   node details-certified.mjs
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTmdbKey } from './src/tmdb.js';
import { detailsFor } from './src/details.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DETAILS = resolve(HERE, 'data', 'details.json');
const CERTS = resolve(HERE, 'data', 'certifications.json');

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env');
  process.exit(1);
}

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const cache = read(DETAILS);
const certs = read(CERTS);

const todo = Object.keys(certs).filter((k) => certs[k]?.c === 'A' && !cache[k]?.o && /^(movie|tv):\d+$/.test(k));
console.log(`${todo.length} A-certified titles without a synopsis`);

let filled = 0;
for (const key of todo) {
  const [kind, id] = key.split(':');
  try {
    const d = await detailsFor(kind, id);
    if (d) {
      cache[key] = { ...(cache[key] ?? {}), ...d };
      if (d.o) filled += 1;
    }
  } catch {
    // leave as is; tried again tomorrow
  }
}

const tmp = `${DETAILS}.tmp`;
writeFileSync(tmp, JSON.stringify(cache));
renameSync(tmp, DETAILS);
console.log(`${filled} now have a synopsis, ${todo.length - filled} still have none (kept hidden by the safety rule)`);
