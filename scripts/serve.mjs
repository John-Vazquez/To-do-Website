import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/todo.html' : pathname));
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || relative.split(path.sep).some(part => part.startsWith('.')) || relative.startsWith('node_modules') || relative.startsWith('tests')) throw new Error('Not found');
    if (!(await stat(filename)).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(await readFile(filename));
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}/todo.html (safe demo)`));
