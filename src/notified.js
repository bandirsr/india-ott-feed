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

/**
 * Expo answers HTTP 200 for a whole batch even when single messages in it are
 * rejected: each message gets a "ticket", in the same order, and only
 * status "ok" means it was accepted for delivery. Anything else must NOT be
 * remembered as sent, or that arrival is suppressed for the next 10 days (KEEP_DAYS)
 * although nobody was told.
 *
 * deadTokens are devices Expo says no longer exist (DeviceNotRegistered), which
 * the registry should forget.
 *
 * (A ticket "ok" is not yet a delivered notification -- Apple can still reject
 * it later, which only Expo's receipts endpoint reports. Not checked here.)
 */
export function splitTickets(batch, body) {
  const data = body?.data;
  const tickets = Array.isArray(data) ? data : data ? [data] : [];
  const accepted = [];
  const rejected = [];
  const deadTokens = [];
  batch.forEach((msg, i) => {
    const t = tickets[i];
    if (t && t.status === 'ok') {
      accepted.push(msg);
      return;
    }
    const reason = t?.details?.error ?? t?.message ?? 'no ticket returned';
    rejected.push({ msg, reason });
    if (t?.details?.error === 'DeviceNotRegistered') deadTokens.push(msg.to);
  });
  return { accepted, rejected, deadTokens };
}

/** Record that `matches` were pushed to `token` on `today`. Mutates and returns `state`. */
export function markSent(state, token, matches, today) {
  const hash = deviceHash(token);
  for (const m of matches) for (const p of m.platforms) state[keyOf(hash, m.id, p)] = today;
  return state;
}
