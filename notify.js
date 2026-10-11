/**
 * The last mile of the saved-title feature: tell someone when something
 * they saved actually arrives.
 *
 * Runs after every sweep (several a day at weekends), right after publish.js, and asks a much narrower question
 * than "what changed today" -- it reads the files the app itself downloads
 * and looks for `on` dates equal to today, which is exactly what arrivalOn()
 * in publish.js already decided counts as a genuine arrival. A legacy
 * catalogue title TMDB just got around to tagging (see arrivalOn's own
 * comment, and 3 Monkeys / Bāhubali: The Torchbearer) already reads `on:
 * null` in this same file, so it is invisible here too, for the same reason.
 * A push notification is a worse place to be wrong than a list row -- it
 * interrupts someone -- so this deliberately trusts the already-corrected
 * output rather than re-deriving "new" from the raw ledger.
 *
 * Devices are fetched from the small Cloudflare Pages Function registry (see
 * OTTwalaWebsite/functions/api/) rather than stored here -- this repo has no
 * server of its own for the app to register with directly.
 *
 * Skips cleanly, like every optional step in this pipeline, if PUSH_ADMIN_KEY
 * is not set.
 *
 *   node notify.js
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prune, unsentMatches, markSent, splitTickets } from './src/notified.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, 'public', 'v1');
const DEVICES_URL = 'https://ottwala.usarajacreatortools.com/api/devices';
const UNREGISTER_URL = 'https://ottwala.usarajacreatortools.com/api/unregister';
const STATE_FILE = resolve(HERE, 'data', 'notified.json');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const ADMIN_KEY = process.env.PUSH_ADMIN_KEY;
if (!ADMIN_KEY) {
  console.log('No PUSH_ADMIN_KEY -- skipping notifications.');
  process.exit(0);
}

if (!existsSync(PUBLIC_DIR)) {
  console.error('No public/v1 -- run publish.js first.');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

/**
 * Every title that arrived on some platform today, across every language
 * file -- deduped by id, since the same film can be listed for more than one
 * language (a Tamil film on aha reaches the Telugu list too).
 */
function arrivedToday() {
  const byId = new Map();
  for (const file of readdirSync(PUBLIC_DIR)) {
    if (!file.endsWith('.json')) continue;
    const payload = JSON.parse(readFileSync(join(PUBLIC_DIR, file), 'utf8'));
    for (const title of payload.titles ?? []) {
      const arrivedNow = (title.p ?? []).filter((p) => p.on === today);
      if (arrivedNow.length === 0) continue;
      if (byId.has(title.id)) continue; // first language file to see it wins; platforms are the same title-wide
      const platforms = arrivedNow.map((p) => payload.providers[String(p.id)]?.name ?? `Platform ${p.id}`);
      byId.set(title.id, { title: title.t, platforms });
    }
  }
  return byId;
}

async function fetchDevices() {
  // The registry hands out one small page at a time (a Pages Function can only
  // make so many KV reads per request) and says where the next one starts.
  const all = [];
  let cursor = null;
  for (let page = 0; page < 1000; page += 1) {
    const url = cursor ? `${DEVICES_URL}?cursor=${encodeURIComponent(cursor)}` : DEVICES_URL;
    const res = await fetch(url, { headers: { authorization: `Bearer ${ADMIN_KEY}` } });
    if (!res.ok) throw new Error(`devices fetch failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    all.push(...(body.devices ?? []));
    cursor = body.cursor ?? null;
    if (!cursor) break;
  }
  return all;
}

/** One notification per device, naming up to three titles by name and summarising the rest. */
function messageFor(token, matches) {
  const names = matches.map((m) => m.title);
  const body =
    names.length === 1
      ? `${names[0]} is now on ${matches[0].platforms.join(', ')}.`
      : names.length <= 3
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} just arrived.`
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more just arrived.`;

  return {
    to: token,
    title: names.length === 1 ? `${names[0]} is streaming` : 'From your saved list',
    body,
    data: { ids: matches.map((m) => m.id) },
  };
}

/**
 * Returns the messages Expo accepted (ticket status "ok"), so only those are remembered
 * as sent, plus the tokens Expo says are gone. HTTP 200 alone proves nothing: rejected
 * messages come back inside a 200.
 */
async function sendPush(messages) {
  // Expo accepts up to 100 messages per request.
  const delivered = [];
  const deadTokens = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error(`  Expo push batch failed: ${res.status} ${await res.text()}`);
      continue;
    }
    let body;
    try {
      body = await res.json();
    } catch {
      console.error('  Expo push batch returned a body that is not JSON; treating the batch as not sent.');
      continue;
    }
    const { accepted, rejected, deadTokens: dead } = splitTickets(batch, body);
    delivered.push(...accepted);
    deadTokens.push(...dead);
    for (const r of rejected.slice(0, 5)) console.error(`  Expo rejected a message: ${r.reason}`);
    if (rejected.length > 5) console.error(`  ...and ${rejected.length - 5} more rejected.`);
  }
  return { delivered, deadTokens };
}

/*
 * Best-effort end to end, deliberately never a fatal exit past this point.
 * This step sits between publish.js and the ledger commit in daily.yml --
 * Expo's push service or the device registry having a bad day must never be
 * the reason today's real catalogue update fails to land.
 */
try {
  const arrivals = arrivedToday();
  console.log(`${arrivals.size} title(s) arrived today across all languages.`);

  if (arrivals.size === 0) {
    console.log('Nothing to notify.');
    process.exit(0);
  }

  const devices = await fetchDevices();
  console.log(`${devices.length} registered device(s).`);

  // What was already pushed today (or recently). Several sweeps a day would
  // otherwise announce the same arrival at every run.
  let state = {};
  try {
    if (existsSync(STATE_FILE)) state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = {};
  }
  state = prune(state, today);

  const messages = [];
  const matchesByToken = new Map();
  for (const { token, savedIds } of devices) {
    const matches = unsentMatches(
      state,
      token,
      (savedIds ?? []).filter((id) => arrivals.has(id)).map((id) => ({ id, ...arrivals.get(id) })),
    );
    if (matches.length > 0) {
      messages.push(messageFor(token, matches));
      matchesByToken.set(token, matches);
    }
  }

  console.log(`${messages.length} device(s) have a saved title in today's arrivals not yet announced.`);

  if (messages.length > 0) {
    const { delivered, deadTokens } = await sendPush(messages);
    console.log(`Sent ${delivered.length} of ${messages.length} push notification(s).`);
    for (const msg of delivered) markSent(state, msg.to, matchesByToken.get(msg.to), today);
    // Expo says these devices no longer exist: drop them from the registry (best effort).
    for (const token of [...new Set(deadTokens)].slice(0, 50)) {
      try {
        await fetch(UNREGISTER_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
      } catch {
        // The registry's own 120-day expiry is the backstop.
      }
    }
  }
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
} catch (err) {
  console.error(`Notify step failed, continuing anyway: ${err.message}`);
}
