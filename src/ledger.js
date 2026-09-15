/**
 * The permanent record of when each title reached each platform.
 *
 * The obvious design is to keep every daily snapshot and diff consecutive
 * pairs. It works, and it costs 1.3 MB a day forever — in git, where deleting
 * the file later does not reclaim anything, that is ~170 MB a year to store one
 * date per title.
 *
 * The ledger replaces the whole archive. It holds one line per (title,
 * platform) pair: the day it first appeared. That line IS the previous state —
 * a pair in the ledger but missing from today's sweep has departed, and a pair
 * in today's sweep but missing from the ledger has just arrived. No snapshot
 * history is needed to compute a diff, only the ledger and today.
 *
 * It settles at a few hundred KB for all of India and changes by a few KB a
 * day, so it can be committed forever without thought.
 *
 * The first run is the one honest exception: 11,000 titles are "new" that day
 * but obviously did not all launch that morning. Those are written with a null
 * date and the app shows them without one, rather than claiming a launch date
 * that is really just the day we started watching.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';


const HERE = dirname(fileURLToPath(import.meta.url));
export const LEDGER_PATH = resolve(HERE, '..', 'data', 'arrivals.json');

/**
 * Shape on disk:
 *   {
 *     startedOn: '2026-09-13',
 *     updatedOn: '2026-09-14',
 *     runs: 2,
 *     seen: { 'movie:123|8': '2026-09-14', 'movie:9|532': null }
 *   }
 * A null value means "already there when we started"; a date means we watched
 * it appear.
 */
export function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return null;
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
}

export function saveLedger(ledger) {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger));
  return LEDGER_PATH;
}

const pairKey = (titleKey, providerId) => `${titleKey}|${providerId}`;

/** Every (title, provider) pair present in a snapshot. */
function pairsIn(snapshot) {
  const pairs = new Set();
  for (const [key, rec] of Object.entries(snapshot.titles)) {
    for (const pid of rec.p) pairs.add(pairKey(key, pid));
  }
  return pairs;
}

function describe(pairString, snapshot, on) {
  const [titleKey, pidRaw] = pairString.split('|');
  const rec = snapshot.titles[titleKey];
  const pid = Number(pidRaw);
  return {
    key: titleKey,
    title: rec?.t ?? titleKey,
    language: rec?.l ?? null,
    released: rec?.d ?? null,
    poster: rec?.i ?? null,
    provider: pid,
    providerName: snapshot.providers?.[pid] ?? String(pid),
    on,
  };
}

/**
 * Fold today's sweep into the ledger.
 *
 * Returns what changed, so a run can report itself without a second pass.
 * Departures delete their line rather than marking it — if a licence lapses and
 * the title returns in March, March is the honest arrival date, not the
 * original one.
 */
export function update(ledger, snapshot) {
  const bootstrap = ledger === null;
  const next = bootstrap
    ? { startedOn: snapshot.date, updatedOn: snapshot.date, runs: 0, seen: {} }
    : { ...ledger, seen: { ...ledger.seen } };

  const todayPairs = pairsIn(snapshot);
  const arrivals = [];
  const departures = [];

  /*
   * Providers this ledger has watched before.
   *
   * A pair is only an arrival if we were ALREADY watching the platform it is
   * on. The day the sweep widened from 46 providers to 72, every title on the
   * 26 new ones looked new -- and 3,540 pairs were stamped with that day's
   * date. Aarya (2004) and 96 (2018) were recorded as arriving in September
   * 2026. They had been on those platforms for years; we had simply not been
   * looking.
   *
   * That is the same situation as the very first run, and it takes the same
   * answer: undated. "We do not know when this arrived" is true and useful.
   * "It arrived today" is false, and false on the one field the whole app is
   * built to report.
   */
  const knownProviders = new Set(
    bootstrap ? [] : (ledger.providers ?? Object.keys(ledger.seen).map((k) => k.split('|').pop()))
  );
  const sweptProviders = new Set([...todayPairs].map((k) => k.split('|').pop()));

  for (const pair of todayPairs) {
    if (Object.prototype.hasOwnProperty.call(next.seen, pair)) continue;
    const providerId = pair.split('|').pop();
    // Undated on the first run, and undated the first time we see a platform.
    const firstSightOfProvider = !bootstrap && !knownProviders.has(providerId);
    const on = bootstrap || firstSightOfProvider ? null : snapshot.date;
    next.seen[pair] = on;
    if (on) arrivals.push(describe(pair, snapshot, on));
  }

  // Recorded explicitly so the next run knows what was watched, rather than
  // inferring it from surviving pairs -- a platform whose last title left
  // would otherwise look new again the day it gets one back.
  next.providers = [...new Set([...knownProviders, ...sweptProviders])];

  for (const pair of Object.keys(next.seen)) {
    if (todayPairs.has(pair)) continue;
    departures.push(describe(pair, snapshot, snapshot.date));
    delete next.seen[pair];
  }

  next.updatedOn = snapshot.date;
  next.runs = (next.runs ?? 0) + 1;

  return { ledger: next, arrivals, departures, bootstrap };
}

/** Arrival date for one pair, or null if it predates our watching. */
export function arrivalDate(ledger, titleKey, providerId) {
  return ledger?.seen?.[pairKey(titleKey, providerId)] ?? null;
}

/** Everything that landed on or after a cutoff date, newest first. */
export function arrivalsSince(ledger, cutoffISO) {
  const out = [];
  for (const [pair, on] of Object.entries(ledger?.seen ?? {})) {
    if (on && on >= cutoffISO) {
      const [key, pid] = pair.split('|');
      out.push({ key, provider: Number(pid), on });
    }
  }
  out.sort((a, b) => (a.on < b.on ? 1 : -1));
  return out;
}
