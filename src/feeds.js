/**
 * RSS reading, with no dependencies.
 *
 * RSS exists to be syndicated — that is the entire point of publishing one — so
 * reading a feed is neither scraping nor a terms problem. And the facts we take
 * from it (this title, on this platform, on this date) are facts, which nobody
 * owns. We never reproduce article text.
 *
 * A real XML parser would be nicer, but feeds are regular enough that a few
 * regexes handle them, and it keeps this project dependency-free.
 */

const UA = 'TeluguOTTCatalog/0.1 (https://usarajacreatortools.com; contact: bandirsr@gmail.com)';

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function pick(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? m[1] : '';
}

/**
 * Fetches and parses one feed. Returns [] rather than throwing — one dead feed
 * must never take down a run across a dozen sources.
 */
export async function fetchFeed(url, { timeoutMs = 20000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, items: [] };

    const xml = await res.text();
    // RSS uses <item>, Atom uses <entry>.
    const blocks = [
      ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
      ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
    ].map((m) => m[0]);

    const items = blocks.map((block) => {
      const linkTag = pick(block, 'link');
      const hrefMatch = /<link[^>]*href=["']([^"']+)["']/i.exec(block);
      return {
        title: stripTags(pick(block, 'title')),
        link: stripTags(linkTag) || (hrefMatch ? hrefMatch[1] : ''),
        description: stripTags(pick(block, 'description') || pick(block, 'summary')),
        content: stripTags(pick(block, 'content:encoded') || pick(block, 'content')),
        publishedAt:
          stripTags(pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated')) || null,
      };
    });

    return { ok: true, status: res.status, items };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, items: [] };
  }
}

/** Fetches several feeds one after another, politely. */
export async function fetchFeeds(sources, { onProgress } = {}) {
  const out = [];
  for (const source of sources) {
    if (!source.rss || source.rss === 'per-channel') continue;
    const result = await fetchFeed(source.rss);
    onProgress?.(source, result);
    out.push({ source, ...result });
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

/**
 * A YouTube channel's uploads, with no API key and no quota.
 * Platforms post "streaming now" promos the day a title lands, which makes this
 * the fastest authoritative signal there is — it comes from the party that
 * actually published the title.
 */
export function youtubeChannelFeed(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}
