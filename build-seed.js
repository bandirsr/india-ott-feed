/**
 * The catalogue that ships inside the app.
 *
 * Not the data — the data is downloaded. This is the fallback for the one
 * moment the download cannot happen: a first launch with no signal, on a plane
 * or a train or a bad connection. Every launch after that uses the feed.
 *
 * It matters more than it sounds. The old seed was 20 films from the
 * Wikipedia-era pipeline, months stale and Telugu-only, so a first launch
 * without signal showed a nearly empty app built on data we no longer use.
 * Someone forming their first impression there would reasonably delete it.
 *
 * So: the most recent titles per language, enough to look like a real app, cut
 * hard enough to stay small. Posters are URLs rather than bundled images, so
 * they simply do not render offline — the initial-letter tiles cover that.
 *
 *   node build-seed.js
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, 'public');
const OUT = resolve(HERE, '..', 'OTT_APP', 'assets', 'catalog.json');

/**
 * Per language. Enough that the list scrolls and the period tabs have
 * something behind them; not so many that the bundle carries a database it
 * will replace in one second.
 */
const PER_LANGUAGE = 60;

if (!existsSync(join(PUBLIC, 'manifest.json'))) {
  console.error('No published feed. Run "node publish.js" first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.json'), 'utf8'));
const films = [];

for (const lang of manifest.languages) {
  const payload = JSON.parse(readFileSync(join(PUBLIC, lang.path), 'utf8'));

  // Already ordered newest-first by publish.js, so the head of the list is the
  // most recent — exactly what a cold-start reader should see.
  for (const t of payload.titles.slice(0, PER_LANGUAGE)) {
    const rows = t.p
      .map((entry) => ({
        platform: payload.providers[String(entry.id)]?.name ?? `Platform ${entry.id}`,
        language: payload.languageName,
        date: entry.on,
        dateStatus: entry.on ? 'observed' : 'before-tracking',
        platformConfidence: 'justwatch',
      }))
      .filter((r) => r.platform);

    if (rows.length === 0) continue;

    films.push({
      title: t.t,
      theatricalDate: t.d ?? null,
      availability: rows,
      credits: t.dir || t.cast ? { directors: t.dir ? [t.dir] : [], cast: t.cast ?? [] } : null,
      // Poster URLs, not bundled bytes. Offline they will not load and the
      // app falls back to its initial tiles, which is the correct trade: 540
      // posters would be several megabytes for a screen most people never see.
      trailer: t.i
        ? { status: 'ok', thumbnailHigh: `${manifest.imageBase}${manifest.posterSize}${t.i}`, watchUrl: t.y ? `https://www.youtube.com/watch?v=${t.y}` : undefined }
        : null,
    });
  }
}

const seed = {
  generatedAt: new Date().toISOString(),
  // Stamped so the app could one day say how old its fallback is, and so it is
  // obvious in a diff which feed build this came from.
  seededFrom: manifest.version,
  note: 'Offline fallback only. The app downloads the current catalogue on launch.',
  films,
};

writeFileSync(OUT, JSON.stringify(seed));

const kb = (statSync(OUT).size / 1024).toFixed(0);
const byLang = {};
for (const f of films) {
  const l = f.availability[0]?.language ?? '?';
  byLang[l] = (byLang[l] ?? 0) + 1;
}

console.log(`Seed written: ${films.length} titles, ${kb} KB`);
console.log(`From feed ${manifest.version}\n`);
for (const [l, n] of Object.entries(byLang)) console.log(`  ${l.padEnd(11)}${n}`);
console.log(`\n${OUT}`);
