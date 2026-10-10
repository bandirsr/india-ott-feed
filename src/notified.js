/**
 * Memory for notify.js, so a title is announced to a device once.
 *
 * The sweep used to run once a day, so "arrived today" was also "arrived
 * since the last run". With several sweeps a day (weekends especially) the
 * same arrival would be pushed again at every run. This file keeps the set of
 * (device, title, platform) pairs already pushed.
 *
 * The repo is public, so a push token is never stored: only the first 16 hex
 * characters of its SHA-256, which cannot be sent to.
 */

import { createHash } from 'node:crypto';

export const KEEP_DAYS = 10;

export function deviceHash(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

const keyOf = (hash, id, platform) => `${hash}|${id}|${platform}`;

/** Drop entries older than KEEP_DAYS so the file stays small. */
export function prune(state, today, days = KEEP_DAYS) {
  const cutoff = Date.parse(today) - days * 86_400_000;
  const out = {};
  for (const [k, day] of Object.entries(state ?? {})) {
    if (Date.parse(day) >= cutoff) out[k] = day;
  }
  return out;
}

/**
 * The part of `matches` ({ id, title, platforms }) this device has not been told
 * about yet. A title already announced for Netflix that reaches Hotstar later
 * the same day is announced again, for Hotstar only.
 */
export function unsentMatches(state, token, matches) {
  const hash = deviceHash(token);
  const out = [];
  for (const m of matches) {
    const platforms = m.platforms.filter((p) => !(keyOf(hash, m.id, p) in state));
    if (platforms.length > 0) out.push({ ...m, platforms });
  }
  return out;
}

/** Record that `matches` were pushed to `token` on `today`. Mutates and returns `state`. */
export function markSent(state, token, matches, today) {
  const hash = deviceHash(token);
  for (const m of matches) for (const p of m.platforms) state[keyOf(hash, m.id, p)] = today;
  return state;
}
