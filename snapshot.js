/**
 * CLI for the arrival-date engine.
 *
 *   node snapshot.js take [--telugu] [--films]   capture today
 *   node snapshot.js diff                        arrivals since the last snapshot
 *   node snapshot.js arrivals [days]             what landed recently (default 30)
 *   node snapshot.js status                      what the archive holds
 *
 * `take` is the one that must run daily. Everything else reads what it wrote.
 */

import { loadTmdbKey } from './src/tmdb.js';
import { take, save, diff, load, listSnapshots, arrivalsWithin, LANGUAGES, resolveProviders } from './src/snapshot.js';
import { loadLedger, saveLedger, update as updateLedger } from './src/ledger.js';
import { enrichTrailers } from './src/trailers.js';
import { sanityCheck, freshness } from './src/health.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Cached alongside the ledger, and permanent for the same reason. */
const TRAILERS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'data', 'trailers.json');

function loadTrailers() {
  if (!existsSync(TRAILERS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(TRAILERS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env — add it and re-run.');
  process.exit(1);
}

const [, , cmd = 'status', ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const nums = rest.filter((a) => /^\d+$/.test(a));

const LANG_NAME = new Map(LANGUAGES.map((l) => [l.code, l.name]));

function human(ms) {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function cmdTake() {
  const languages = flags.has('--telugu') ? LANGUAGES.filter((l) => l.code === 'te') : LANGUAGES;
  const kinds = flags.has('--films') ? ['movie'] : ['movie', 'tv'];
  const { providers, missing, liveCount } = await resolveProviders();
  const total = languages.length * kinds.length * providers.length;

  console.log(`TMDB lists ${liveCount} providers for India; tracking ${providers.length}`);
  if (missing.length > 0) {
    // Not fatal, but somebody should look: a platform we expect has stopped
    // being listed, which is either a rename or a genuine withdrawal.
    console.log(`WARNING: tracked but no longer listed by TMDB — ${missing.join(', ')}`);
  }
  console.log(`Sweeping ${languages.length} languages x ${kinds.join('+')} x ${providers.length} providers = ${total} sweeps\n`);

  const started = Date.now();
  let done = 0;

  const snapshot = await take({
    languages,
    kinds,
    providers,
    onProgress: ({ language, kind, provider, found }) => {
      done += 1;
      if (found > 0) {
        console.log(`  [${String(done).padStart(3)}/${total}] ${language} ${kind} ${provider}: ${found}`);
      }
    },
  });

  const path = save(snapshot);
  const count = Object.keys(snapshot.titles).length;
  console.log(`\n${count} titles captured in ${human(Date.now() - started)}`);
  console.log(`Written to ${path}`);

  // The ledger, not the snapshot, is what persists. Folding today into it is
  // what turns a sweep into arrival dates.
  //
  // A partial sweep must never touch it: --telugu would see the other eight
  // languages as missing and record nine thousand false departures.
  const partial = languages.length !== LANGUAGES.length || kinds.length !== 2;
  if (partial) {
    console.log('\nPartial sweep — ledger untouched. Run without --telugu/--films to record arrivals.');
    return;
  }

  const before = loadLedger();
  const { ledger, arrivals, departures, bootstrap } = updateLedger(before, snapshot);

  // Nothing is written until the sweep earns it. A TMDB outage returns a small
  // sweep, which without this check would be recorded as twenty thousand
  // titles leaving every platform at once — deleting arrival dates that cannot
  // be recomputed, because TMDB cannot be asked what was true last Tuesday.
  const verdict = sanityCheck(before, snapshot, { departures: departures.length });
  if (!verdict.ok) {
    console.error('\nSWEEP REJECTED — the ledger was NOT modified.\n');
    for (const p of verdict.problems) console.error(`  - ${p}`);
    console.error('\nYesterday\'s data stands. Investigate, then re-run.');
    console.error('Cost of this failure: the arrival dates for anything that landed today.');
    process.exit(1);
  }

  // Recorded so tomorrow's check has a baseline that does not depend on
  // counting a file that may not exist any more.
  ledger.pairCount = Object.keys(ledger.seen).length;
  ledger.titleCount = verdict.titleCount;
  saveLedger(ledger);

  if (bootstrap) {
    console.log(`\nLedger created with ${Object.keys(ledger.seen).length} title-platform pairs.`);
    console.log('They are undated by design — they were already streaming when we started watching.');
    console.log('Real arrivals begin with tomorrow’s run.');
    return;
  }

  console.log(`\nLedger run ${ledger.runs}: ${arrivals.length} arrivals, ${departures.length} departures`);
  for (const a of arrivals.slice(0, 15)) {
    console.log(`  + ${String(a.title).slice(0, 36).padEnd(38)}${a.providerName}`);
  }
}

/**
 * Fill in trailers, newest first, within a budget.
 *
 * Kept separate from the sweep because the two have different rhythms.
 * Availability must be complete every single day or the ledger records false
 * departures; a trailer is a nice-to-have that can take a week to backfill.
 * Results — including "this one has none" — are cached, so a run never re-asks.
 */
async function cmdTrailers() {
  const dates = listSnapshots();
  if (dates.length === 0) {
    console.log('No snapshot yet. Run "node snapshot.js take" first.');
    return;
  }

  const snapshot = load(dates[dates.length - 1]);
  const have = loadTrailers();
  // Each title carries the languages it is listed under, so the trailer
  // fetcher asks for exactly those and no more.
  const titles = Object.entries(snapshot.titles).map(([key, rec]) => ({
    key,
    date: rec.d,
    languages: [...new Set([rec.l, ...(rec.also ?? [])])],
  }));
  const budget = Number(nums[0] ?? 400);

  console.log(`${titles.length} titles, ${Object.keys(have).length} already checked, budget ${budget}\n`);

  mkdirSync(dirname(TRAILERS_PATH), { recursive: true });

  // Written to a temp file and renamed, so an interrupted write cannot leave a
  // truncated cache behind -- losing the file entirely would be worse than
  // losing the run.
  const save = (data) => {
    const tmp = `${TRAILERS_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, TRAILERS_PATH);
  };

  let lastReport = 0;
  const { trailers, spent, added, remaining } = await enrichTrailers(titles, {
    budget,
    have,
    onSave: save,
    onProgress: ({ spent: n, added: a }) => {
      if (n - lastReport >= 500) {
        lastReport = n;
        console.log(`  ${n} checked, ${a} found — saved`);
      }
    },
  });

  save(trailers);

  const withTrailer = Object.values(trailers).filter(Boolean).length;
  console.log(`Checked ${spent}, found ${added} new`);
  console.log(`${withTrailer} of ${Object.keys(trailers).length} checked titles have a trailer`);
  console.log(`${remaining} still unchecked — run again to continue`);
}

function show(list, label) {
  if (list.length === 0) {
    console.log(`  none`);
    return;
  }
  for (const a of list.slice(0, 60)) {
    const lang = LANG_NAME.get(a.language) ?? a.language;
    const kind = a.key.startsWith('tv:') ? 'series' : 'film';
    console.log(`  ${String(a.on).padEnd(12)}${String(a.title).slice(0, 34).padEnd(36)}${String(lang).padEnd(11)}${String(kind).padEnd(8)}${a.providerName}`);
  }
  if (list.length > 60) console.log(`  ... and ${list.length - 60} more ${label}`);
}

function cmdDiff() {
  const dates = listSnapshots();
  if (dates.length < 2) {
    console.log(`Only ${dates.length} snapshot(s). Run "node snapshot.js take" again tomorrow.`);
    return;
  }
  const [prev, latest] = dates.slice(-2);
  const d = diff(load(prev), load(latest));

  console.log(`=== Arrived between ${prev} and ${latest} ===\n`);
  show(d.arrivals, 'arrivals');
  console.log(`\n=== Left between ${prev} and ${latest} ===\n`);
  show(d.departures, 'departures');
}

function cmdArrivals() {
  const days = Number(nums[0] ?? 30);
  const r = arrivalsWithin(days);
  if (r.note) {
    console.log(r.note);
    return;
  }
  console.log(`=== Arrived in the last ${days} days (archive starts ${r.oldest}, ${r.coverage} snapshots) ===\n`);
  show(r.arrivals, 'arrivals');
}

function cmdStatus() {
  // Freshness first: a stale archive is the failure nobody notices, because it
  // looks exactly like a quiet week.
  const f = freshness(loadLedger());
  console.log(f.ok ? f.message : `\n*** ${f.message} ***\n`);

  const dates = listSnapshots();
  console.log(`Snapshots: ${dates.length}`);
  if (dates.length === 0) {
    console.log('\nNothing captured yet. Start with:  node snapshot.js take --telugu');
    return;
  }
  console.log(`Range:     ${dates[0]} to ${dates[dates.length - 1]}`);
  for (const d of dates.slice(-7)) {
    const s = load(d);
    console.log(`  ${d}  ${String(Object.keys(s.titles).length).padStart(6)} titles  ${s.sweeps} sweeps`);
  }
  if (dates.length < 2) console.log('\nArrivals need two snapshots. Run "take" again tomorrow.');
}

const commands = {
  take: cmdTake,
  diff: cmdDiff,
  arrivals: cmdArrivals,
  status: cmdStatus,
  trailers: cmdTrailers,
};

const run = commands[cmd];
if (!run) {
  console.error(`Unknown command "${cmd}". Try: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

await run();
