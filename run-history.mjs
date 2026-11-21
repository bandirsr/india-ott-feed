/**
 * Appends one line per sweep to reports/run-history.json: when it ran, how many
 * titles each language has now, and how many that is more (or fewer) than the
 * previous run. The OTTwala analytics dashboard reads this to show the history.
 * Report only: never fails the sweep.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FILE = 'reports/run-history.json';
const MAX = 400;
try {
  const m = JSON.parse(readFileSync('public/manifest.json', 'utf8').replace(/^﻿/, ''));
  const hist = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
  const prev = hist.length ? hist[hist.length - 1] : null;
  const langs = {};
  let total = 0;
  for (const l of m.languages) {
    const before = prev?.langs?.[l.code]?.titles;
    langs[l.code] = { titles: l.titles, added: before == null ? null : l.titles - before };
    total += l.titles;
  }
  const yt = process.env.YT_LINE || '';
  const mt = /(\d+) new, (\d+) kept/.exec(yt);
  hist.push({
    at: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID || null,
    event: process.env.GITHUB_EVENT_NAME || null,
    buildId: m.buildId,
    total,
    added: prev ? total - prev.total : null,
    recent: m.recent?.titles ?? null,
    upcoming: m.upcoming?.titles ?? null,
    ytNew: mt ? Number(mt[1]) : null,
    ytKept: mt ? Number(mt[2]) : null,
    youtube: process.env.OUT_YOUTUBE || null,
    gate: process.env.OUT_PRECHECK || null,
    langs,
  });
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(hist.slice(-MAX)) + '\n');
  console.log(`run-history: ${hist.length} runs, total ${total}`);
} catch (e) {
  console.log('run-history skipped:', e.message);
}
