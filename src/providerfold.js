/**
 * One platform, one provider id.
 *
 * TMDB lists some services more than once (ManoramaMax is 482 and, from the
 * YouTube source, 2177 spelled "ManoramaMAX"; MUBI, Crunchyroll, Hoichoi and
 * Lionsgate Play each sit under several ids) and brands that have merged keep
 * their old entry (Amazon MX Player is MX Player). The app groups by name, so
 * each spelling showed as a separate platform. This folds them at publish time,
 * after the ledger, so arrival history and notification keys are untouched.
 *
 * Deliberately NOT folded: "Amazon Video" (id 10). That is the rent-or-buy
 * storefront, not Prime Video's subscription catalogue; merging would claim a
 * film is included with Prime when it is only for hire.
 *
 * Display names of services that already have a single spelling (Zee5, Sony
 * Liv, Sun Nxt) are left alone: installed apps rank and colour by those exact
 * strings, so renaming them would silently demote them until the next store
 * build.
 */

/** normalised name -> normalised name of the service it really is */
export const NAME_ALIASES = {
  amazonmxplayer: 'mxplayer',
  amazonminitv: 'mxplayer',
};

const norm = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
const groupKey = (name) => NAME_ALIASES[norm(name)] ?? norm(name);

/**
 * @param providers {[id]: {name, color}}
 * @param titles    feed rows, each with p: [{id, on, ...}]
 * @returns {{providers, merged, idMap}} providers is a new object; titles are
 *          updated in place.
 */
export function foldProviders(providers, titles) {
  const groups = new Map();
  for (const [id, v] of Object.entries(providers)) {
    const k = groupKey(v.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }

  const grey = (id) => (providers[id].color === '#6E6E80' ? 1 : 0);
  const idMap = new Map();
  const out = {};
  for (const [k, ids] of groups) {
    ids.sort((a, b) => {
      const an = norm(providers[a].name) === k ? 0 : 1;
      const bn = norm(providers[b].name) === k ? 0 : 1;
      return an - bn || grey(a) - grey(b) || Number(a) - Number(b);
    });
    const keep = ids[0];
    out[keep] = providers[keep];
    for (const id of ids.slice(1)) idMap.set(Number(id), Number(keep));
  }
  // Keep original id order so output stays stable.
  const ordered = {};
  for (const id of Object.keys(providers)) if (out[id]) ordered[id] = out[id];

  let merged = 0;
  for (const t of titles) {
    if (!t.p?.some((e) => idMap.has(e.id))) continue;
    const byId = new Map();
    for (const e of t.p) {
      const id = idMap.get(e.id) ?? e.id;
      const next = { ...e, id };
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, next);
        continue;
      }
      // Same service listed twice: keep the earlier known arrival date.
      if (next.on && (!prev.on || next.on < prev.on)) byId.set(id, { ...prev, on: next.on, src: next.src ?? prev.src });
      merged += 1;
    }
    t.p = [...byId.values()];
  }
  return { providers: ordered, merged: merged + idMap.size, idMap };
}
