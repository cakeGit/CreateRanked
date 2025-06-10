import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime';

const PORT = 3000;
const PUBLIC_DIR = path.resolve('public');
const DATA_DIR = path.resolve('data');
const CACHE_ENABLED = false;
const CLICKME_FILE = path.resolve('clickme-count.txt');
let clickmeCount = 0;

// Load count from file at startup
fs.readFile(CLICKME_FILE, 'utf8')
    .then(data => { clickmeCount = parseInt(data, 10) || 0; })
    .catch(() => { clickmeCount = 0; });

const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/mods')) {
        await serveJson(res, 'mods.json');
    } else if (req.url.startsWith('/api/authors')) {
        await serveJson(res, 'authors.json');
    } else if (req.url.startsWith('/api/clickme')) {
        if (req.method === 'POST') {
            clickmeCount++;
            await fs.writeFile(CLICKME_FILE, String(clickmeCount));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ count: clickmeCount }));
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ count: clickmeCount }));
        }
    } else {
        await serveStatic(res, req.url);
    }
});

function serveJson(res, filename) {
    const filePath = path.join(DATA_DIR, filename);
    fs.readFile(filePath, 'utf8')
        .then((data) => {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                ...(CACHE_ENABLED ? { 'Cache-Control': 'max-age=3600' } : {})
            });
            res.end(data);
        })
        .catch(() => {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
        });
}

function serveStatic(res, url) {
    const filePath = path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url);

    fs.readFile(filePath)
        .then((data) => {
            res.writeHead(200, {
                'Content-Type': mime.getType(filePath),
                ...(CACHE_ENABLED ? { 'Cache-Control': 'max-age=3600' } : {})
            });
            res.end(data);
        })
        .catch(() => {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        });
}

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});