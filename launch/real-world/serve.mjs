// Static server for the production build, SPA fallback to index.html.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = new URL('./app/build/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const f of [join(root, p), join(root, 'index.html')]) {
    try {
      const data = await readFile(f);
      res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' });
      return res.end(data);
    } catch {
      // try the SPA fallback next
    }
  }
  res.writeHead(404).end();
}).listen(4100, '127.0.0.1', () => console.log('serving on http://127.0.0.1:4100'));
