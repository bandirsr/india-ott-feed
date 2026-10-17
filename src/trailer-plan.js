/**
 * Splits the day's YouTube search budget across languages.
 *
 * Weights follow where the audience is (Telugu, Tamil, Hindi first, then
 * Malayalam and Kannada). A language with a short queue gives its unused share
 * to the others, highest weight first, so the whole budget is always spent
 * while there is anything left to search. Within a language the queue order is
 * kept (newest first). The result is round-robin across languages so a quota
 * stop part-way through still leaves every language served.
 */
export const WEIGHTS = { te: 25, ta: 20, hi: 15, ml: 10, kn: 6, bn: 4, mr: 1, pa: 1, gu: 1 };

/** @param queues Map<langCode, film[]>  @param budget number */
export function planOrder(queues, budget) {
  const codes = [...queues.keys()].sort((a, b) => (WEIGHTS[b] ?? 1) - (WEIGHTS[a] ?? 1));
  const total = codes.reduce((n, c) => n + (WEIGHTS[c] ?? 1), 0);
  const take = new Map(codes.map((c) => [c, Math.min(queues.get(c).length, Math.floor((budget * (WEIGHTS[c] ?? 1)) / total))]));

  let left = budget - [...take.values()].reduce((n, v) => n + v, 0);
  while (left > 0) {
    let gave = false;
    for (const c of codes) {
      if (left > 0 && take.get(c) < queues.get(c).length) {
        take.set(c, take.get(c) + 1);
        left -= 1;
        gave = true;
      }
    }
    if (!gave) break;
  }

  const order = [];
  const seen = new Set();
  for (let i = 0; codes.some((c) => i < take.get(c)); i += 1) {
    for (const c of codes) {
      const f = i < take.get(c) ? queues.get(c)[i] : null;
      if (f && !seen.has(f.id)) {
        seen.add(f.id);
        order.push(f);
      }
    }
  }
  return order;
}
