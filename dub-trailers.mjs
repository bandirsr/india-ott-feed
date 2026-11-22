/**
 * Trailers in the viewer's own language for titles listed under a language they
 * were not made in (a Tamil film dubbed into Telugu, "Haiku").
 *
 * trailers.json is filled once per title, for the languages it was listed under
 * AT THAT TIME. When a dub or an "also in" listing arrives later, no trailer in
 * that language was ever looked for, so the Telugu card opened the Tamil
 * trailer. This finds the live feed's rows that carry `ol` (shown under a
 * language other than the original), asks TMDB for a trailer in that language,
 * and stores it in trailers.json under the language code. publish.js already
 * prefers the reader's own language, so nothing else changes and no app update
 * is needed.
 *
 * Each (title, language) pair is asked once, then again after RETRY_DAYS, so a
 * language TMDB has no trailer for does not cost a request every run.
 * Report only on failure: never fails the sweep.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rawCall } from './src/tmdb.js';
import { pickBest, VIDEO_LANGUAGES } from './src/trailers.js';

const BUDGET = Number(process.argv[2] ?? 500);
const RETRY_DAYS = 30;
const FEED = process.env.FEED_BASE || 'https://bandirsr.github.io/india-ott-feed';
const TR = 'data/trailers.json';
const CHK = 'data/trailers-lang-checked.json';

const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) : d);

try {
  const trailers = read(TR, {});
  const checked = read(CHK, {});
  const today = new Date().toISOString().slice(0, 10);
  const stale = (d) => !d || Date.now() - Date.parse(d) > RETRY_DAYS * 86_400_000;

  const todo = [];
  for (const code of VIDEO_LANGUAGES) {
    const res = await fetch(`${FEED}/v1/${code}.json`);
    if (!res.ok) { console.log(`dub-trailers: ${code}.json ${res.status}, skipped`); continue; }
    const j = await res.json();
    for (const e of j.titles ?? []) {
      if (!e.ol || !/^(movie|tv):\d+$/.test(e.id)) continue;
      const t = trailers[e.id];
      if (t && typeof t.key === 'string') continue; // old shape
      if (t && t[code]) continue;
      if (!stale(checked[`${e.id}|${code}`])) continue;
      todo.push({ id: e.id, code, d: e.d ?? '' });
    }
  }
  todo.sort((a, b) => String(b.d).localeCompare(String(a.d)));
  console.log(`dub-trailers: ${todo.length} title/language pairs without their own trailer; doing up to ${BUDGET}`);

  let spent = 0, found = 0;
  for (const p of todo.slice(0, BUDGET)) {
    const [kind, id] = p.id.split(':');
    spent += 1;
    try {
      const j = await rawCall(`/${kind}/${id}/videos`, { language: `${p.code}-IN` });
      const key = pickBest((j.results ?? []).filter((v) => v.iso_639_1 === p.code));
      checked[`${p.id}|${p.code}`] = today;
      if (key) {
        trailers[p.id] = { ...(trailers[p.id] ?? {}), [p.code]: key };
        found += 1;
      }
    } catch (e) {
      // leave unrecorded: retried next run
    }
  }
  writeFileSync(TR, JSON.stringify(trailers));
  writeFileSync(CHK, JSON.stringify(checked));
  console.log(`dub-trailers: asked ${spent}, found a trailer in the viewer's language for ${found}, ${Math.max(0, todo.length - spent)} left`);
} catch (e) {
  console.log('dub-trailers skipped:', e.message);
}
