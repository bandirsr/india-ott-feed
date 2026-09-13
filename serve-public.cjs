// Serves public/ so the app can be tested against the real feed before it is
// ever deployed. Same files GitHub Pages will serve, same paths.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.json': 'application/json', '.html': 'text/html' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel || 'manifest.json');
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(buf);
  });
}).listen(8797, () => console.log('feed on http://localhost:8797'));
