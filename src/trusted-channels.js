/**
 * Which YouTube channels may supply a trailer link: official platforms, music labels and studios only.
 *
 * Trusted = a channel that TMDB's own curated trailer links (the per-language ones in data/trailers.json)
 * already come from, MIN_HITS or more times -- that is how Netflix India, JioHotstar, Zee 5, T-Series,
 * Think Music, Aditya Music, Mythri and the like are known without a hand-kept list -- plus the names in
 * data/trusted-trailer-channels.json (studios and labels added by hand). Our own earlier matches never
 * count towards trust, or a re-uploader would vouch for itself. Matched by channel name, since a search
 * result carries the name; scan state records the id too.
 */
import { readFileSync, existsSync } from 'node:fs';
import { norm } from './youtube-match.js';

export const MIN_HITS = 5;
const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) : d);

export function loadTrusted() {
  const names = new Set();
  const st = read('data/youtube-channel-scan.json', { channels: {} });
  for (const c of Object.values(st.channels ?? {})) if ((c.hits ?? 0) >= MIN_HITS) names.add(norm(c.title));
  for (const n of read('data/trusted-trailer-channels.json', { names: [] }).names) names.add(norm(n));
  return { has: (channelName) => names.has(norm(channelName ?? '')), size: names.size };
}
