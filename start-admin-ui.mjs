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
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const PORT = parseInt(process.env.BASTION_ADMIN_UI_PORT || '9445');
const HOST = '127.0.0.1';
const ADMIN_API_PORT = parseInt(process.env.BASTION_ADMIN_PORT || '9444');
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
console.log(`API proxy: /api/* → https://127.0.0.1:${ADMIN_API_PORT}`);
console.log('Access:  SSH tunnel only');
console.log('');

// ---------------------------------------------------------------------------
// API proxy — forward /api/* to the admin HTTPS server
// ---------------------------------------------------------------------------

function proxyApiRequest(req, res) {
  const body = [];
  req.on('data', (chunk) => body.push(chunk));
  req.on('end', () => {
    const proxyReq = httpsRequest(
      {
        hostname: '127.0.0.1',
        port: ADMIN_API_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${ADMIN_API_PORT}`,
        },
        rejectUnauthorized: false, // Accept self-signed certs
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      console.error(`[!] API proxy error: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin API unreachable', detail: err.message }));
    });

    if (body.length > 0) {
      proxyReq.write(Buffer.concat(body));
    }
    proxyReq.end();
  });
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  // Proxy /api/* requests to the admin HTTPS server
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath.startsWith('/api/')) {
    proxyApiRequest(req, res);
    return;
  }

  // Only allow GET and HEAD for static files
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
  console.log(`[★] API proxy: /api/* → https://127.0.0.1:${ADMIN_API_PORT} (self-signed OK)`);
  console.log('[★] SSH tunnel: ssh -L 9445:127.0.0.1:9445 relay-host');
  console.log('[★] Only one tunnel needed — API requests are proxied server-side');
  console.log('[★] Open: http://localhost:9445');
});
