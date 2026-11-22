// One-off: calls each YouTube Data API method a different number of times so the Cloud console's
// per-method counts and the "Queries per day" delta show what each kind costs. Nothing is written.
const KEY = process.env.YOUTUBE_API_KEY;
const UPLOADS = 'UUbTLwN10NoCU4WDzLf1JMOA'; // any public uploads playlist
const calls = [
  ['search.list', 1, { path: 'search', q: 'telugu movie trailer', part: 'snippet', type: 'video', maxResults: '5' }],
  ['playlistItems.list', 2, { path: 'playlistItems', part: 'snippet', playlistId: UPLOADS, maxResults: '50' }],
  ['videos.list', 3, { path: 'videos', part: 'snippet,contentDetails,statistics', id: 'dQw4w9WgXcQ' }],
  ['channels.list', 4, { path: 'channels', part: 'snippet,contentDetails', id: 'UCbTLwN10NoCU4WDzLf1JMOA' }],
  ['playlists.list', 5, { path: 'playlists', part: 'snippet', channelId: 'UCbTLwN10NoCU4WDzLf1JMOA', maxResults: '50' }],
  ['commentThreads.list', 6, { path: 'commentThreads', part: 'snippet', videoId: 'dQw4w9WgXcQ', maxResults: '5' }],
];
for (const [name, n, p] of calls) {
  for (let i = 0; i < n; i++) {
    const { path, ...q } = p;
    const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...q, key: KEY })}`);
    const j = await r.json().catch(() => ({}));
    console.log(`${name} #${i + 1}: HTTP ${r.status}, ${(j.items ?? []).length} items${j.error ? ' ERR ' + j.error.message.slice(0, 80) : ''}`);
  }
}
