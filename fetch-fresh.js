/**
 * The fast layer's runner.
 *
 * Polls the verified RSS sources, extracts provisional release records, merges
 * them across outlets, and writes data/fresh.json. Cheap enough to run daily —
 * no API key, no quota, a handful of HTTP requests.
 *
 * Everything it writes is provisional. Wikipedia corrects it later; that is the
 * whole point of the two-speed design.
 *
 * Run:  node fetch-fresh.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOURCES } from './src/sources.js';
import { fetchFeeds } from './src/feeds.js';
import { extractFromItem, mergeReleases } from './src/fresh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'data', 'fresh.json');

/** Keeps history across runs so a release seen last week is not forgotten. */
function loadPrevious() {
  if (!existsSync(OUT)) return { releases: [], roundups: [] };
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    return { releases: [], roundups: [] };
  }
}

async function main() {
  const feedSources = SOURCES.filter((s) => s.rss && s.rss !== 'per-channel');
  console.log(`Polling ${feedSources.length} feeds...\n`);

  const results = await fetchFeeds(feedSources, {
    onProgress: (source, result) => {
      const state = result.ok ? `${result.items.length} items` : `FAILED ${result.status || result.error}`;
      console.log(`  ${source.name.padEnd(14)} ${state}`);
    },
  });

  const rawRecords = [];
  const roundups = [];

  for (const { source, items } of results) {
    for (const item of items) {
      for (const record of extractFromItem(item, source)) {
        if (record.kind === 'roundup') roundups.push(record);
        else rawRecords.push(record);
      }
    }
  }

  const previous = loadPrevious();
  const combined = mergeReleases([...(previous.releases ?? []), ...rawRecords]);

  // Dropped rather than kept forever. A dated report more than 60 days past
  // its date has either been confirmed by TMDB/Wikipedia by now (in which
  // case publish.js's own dedupe already stops using it) or was simply wrong
  // -- either way it is not worth a permanent line in this file. An undated
  // lead gets less patience: nothing here ever corrects its date, so one that
  // has sat 21 days without a source adding one is going nowhere.
  const DAY = 86_400_000;
  const now = Date.now();
  const merged = combined.filter((r) => {
    if (r.date) return now - Date.parse(r.date) < 60 * DAY;
    const seenAt = r.firstSeenAt ? Date.parse(r.firstSeenAt) : now;
    return now - seenAt < 21 * DAY;
  });

  // Newest first, undated last — an undated lead is still worth keeping but
  // should never sit above a confirmed date.
  merged.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  const seenRoundups = new Map();
  for (const r of [...(previous.roundups ?? []), ...roundups]) {
    seenRoundups.set(r.link || r.headline, r);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Provisional. Reported by news sources; Wikipedia corrects these later.',
        releases: merged,
        roundups: [...seenRoundups.values()].slice(-40),
      },
      null,
      2
    )
  );

  console.log(`\n--- Fresh layer ---`);
  console.log(`release records      ${merged.length}  (${combined.length - merged.length} pruned as stale)`);
  console.log(`  two or more sources ${merged.filter((r) => r.sourceCount >= 2).length}`);
  console.log(`  with a date         ${merged.filter((r) => r.date).length}`);
  console.log(`round-up posts       ${seenRoundups.size}  (list several titles each; not parsed yet)`);
  console.log(`written to           ${OUT}`);

  const recent = merged.filter((r) => r.date && Date.now() - Date.parse(r.date) < 45 * 86_400_000);
  if (recent.length > 0) {
    console.log(`\nLast 45 days:`);
    for (const r of recent.slice(0, 25)) {
      console.log(`  ${r.date}  ${String(r.title).padEnd(34).slice(0, 34)} ${String(r.platform).padEnd(18)} ${r.confidence}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
