// One-off quota probe: KIND=search|playlistItems|videos|channels  N=<count>. Nothing is written.
const KEY = process.env.YOUTUBE_API_KEY;
const kind = process.env.KIND; const n = Number(process.env.N || 1);
const U = 'UUbTLwN10NoCU4WDzLf1JMOA';
const defs = {
  search: ['search', { q: 'telugu movie trailer', part: 'snippet', type: 'video', maxResults: '5' }],
  playlistItems: ['playlistItems', { part: 'snippet', playlistId: U, maxResults: '50' }],
  videos: ['videos', { part: 'snippet,contentDetails,statistics', id: 'dQw4w9WgXcQ' }],
  channels: ['channels', { part: 'snippet,contentDetails', id: 'UCbTLwN10NoCU4WDzLf1JMOA' }],
};
const [path, q] = defs[kind];
for (let i = 0; i < n; i++) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...q, key: KEY })}`);
  console.log(`${kind} #${i + 1}: HTTP ${r.status}`);
}
