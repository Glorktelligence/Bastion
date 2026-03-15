// ---------------------------------------------------------------------------
// Project Bastion — Admin UI Static Server
//
// Serves the built relay-admin-ui SvelteKit app on localhost:9445.
// Uses Node's built-in http module — zero external dependencies.
//
// ACCESS: This server should ONLY be accessed via SSH tunnel.
//   ssh -L 9445:127.0.0.1:9445 -L 9444:127.0.0.1:9444 relay-host
//
// The admin UI makes API calls to the admin server on localhost:9444.
// Both ports must be tunnelled for full functionality.
//
// Build the admin UI first:
//   pnpm --filter @bastion/relay-admin-ui run build:app
// ---------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const PORT = parseInt(process.env.BASTION_ADMIN_UI_PORT || '9445');
const HOST = '127.0.0.1';
const BUILD_DIR = resolve(__dirname, 'packages/relay-admin-ui/build');

// ---------------------------------------------------------------------------
// MIME type mapping
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Startup checks
// ---------------------------------------------------------------------------

if (!existsSync(BUILD_DIR)) {
  console.error(`[!] Build directory not found: ${BUILD_DIR}`);
  console.error('[!] Run: pnpm --filter @bastion/relay-admin-ui run build:app');
  process.exit(1);
}

const indexPath = join(BUILD_DIR, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`[!] index.html not found in build directory`);
  console.error('[!] Run: pnpm --filter @bastion/relay-admin-ui run build:app');
  process.exit(1);
}

console.log('=== Project Bastion — Admin UI Server ===');
console.log(`Serving: ${BUILD_DIR}`);
console.log(`Address: http://${HOST}:${PORT}`);
console.log('Access:  SSH tunnel only');
console.log('');

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  // Only allow GET and HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  // Parse URL, strip query string
  const url = new URL(req.url || '/', `http://${HOST}`);
  let pathname = decodeURIComponent(url.pathname);

  // Security: prevent directory traversal
  if (pathname.includes('..') || pathname.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  // Resolve file path
  let filePath = join(BUILD_DIR, pathname);

  // If path ends with /, serve index.html
  if (pathname.endsWith('/')) {
    filePath = join(filePath, 'index.html');
  }

  // Try to serve the file
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });

    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(data);
    }
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      // SPA fallback: serve index.html for client-side routing
      try {
        const fallback = await readFile(indexPath);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': fallback.length,
          'Cache-Control': 'no-cache',
        });
        res.end(req.method === 'HEAD' ? undefined : fallback);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, HOST, () => {
  console.log(`[★] Admin UI serving on http://${HOST}:${PORT}`);
  console.log('[★] SSH tunnel: ssh -L 9445:127.0.0.1:9445 -L 9444:127.0.0.1:9444 relay-host');
  console.log('[★] Then open: http://localhost:9445');
});
