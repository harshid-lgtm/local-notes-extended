#!/usr/bin/env node
// Local Notes team server: REST API + live co-editing (Yjs over WebSocket) + the web app.
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi, json, HttpError } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(here, '..', 'data')),
  publicDir: path.resolve(process.env.PUBLIC_DIR || path.join(here, '..', '..', 'public')),
  name: process.env.TEAM_NAME || 'Team',
  signup: process.env.SIGNUP === 'open' ? 'open' : 'invite',
  mirror: process.env.MIRROR !== 'false',
  aiRate: Number(process.env.AI_RATE_LIMIT || 60), // AI requests per person per 10 minutes
  version: pkg.version,
};

const db = openDb(config.dataDir);
let server;
const collab = {
  // drop a removed member's live connections in that workspace
  kick(userId, workspaceId) {
    for (const doc of server?.hocuspocus.documents.values() || []) {
      for (const conn of doc.getConnections()) {
        if (conn.context?.user?.id === userId && conn.context?.workspaceId === workspaceId) recheck(conn);
      }
    }
  },
  // Access to these pages changed: re-check everyone connected. People who lost access are
  // disconnected; everyone else stays connected with their (possibly new) read/write permission.
  reset(pageIds) {
    for (const id of pageIds) {
      const doc = server?.hocuspocus.documents.get(`page:${id}`);
      for (const conn of doc?.getConnections() || []) recheck(conn);
    }
  },
};
function recheck(conn) {
  const ctx = conn.context || {};
  const role = ctx.user && ctx.pageId ? api.pageRole(ctx.user.id, ctx.pageId) : null;
  if (!role) { conn.close(); return; }
  ctx.role = role;
  conn.readOnly = role === 'viewer';
}
const api = createApi({ db, config, collab });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  let file = path.resolve(config.publicDir, rel);
  if (!file.startsWith(config.publicDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(config.publicDir, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': url.pathname.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

server = new Server({
  port: config.port,
  address: config.host,
  quiet: true,
  debounce: 1500,
  maxDebounce: 8000,
  name: 'local-notes',

  async onAuthenticate({ token, documentName, connectionConfig }) {
    const user = api.userForToken(token);
    if (!user) throw new Error('Not signed in');
    const pageId = documentName.replace(/^page:/, '');
    const page = db.get('SELECT id, workspace_id, deleted_at FROM pages WHERE id = ?', pageId);
    if (!page || page.deleted_at) throw new Error('Page not found');
    const role = api.pageRole(user.id, page.id);
    if (!role) throw new Error('No access');
    if (role === 'viewer') connectionConfig.readOnly = true;
    return { user: { id: user.id, name: user.name, color: user.color }, pageId, workspaceId: page.workspace_id, role };
  },

  async onLoadDocument({ documentName, document }) {
    const row = db.get('SELECT state FROM docs WHERE page_id = ?', documentName.replace(/^page:/, ''));
    if (row?.state) Y.applyUpdate(document, new Uint8Array(row.state));
    return document;
  },

  async onStoreDocument({ documentName, document }) {
    const pageId = documentName.replace(/^page:/, '');
    if (!db.get('SELECT 1 AS x FROM pages WHERE id = ?', pageId)) return;
    const state = Y.encodeStateAsUpdate(document);
    db.run('INSERT INTO docs (page_id, state) VALUES (?, ?) ON CONFLICT(page_id) DO UPDATE SET state = excluded.state', pageId, state);
  },

  async onRequest({ request: req, response: res }) {
    // CORS: the desktop app talks to this server from its own local origin with bearer tokens.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      throw null;
    }
    try {
      if (req.url.startsWith('/api/')) {
        if (!(await api.handle(req, res))) json(res, 404, { error: 'Unknown endpoint' });
      } else if (req.method === 'GET') {
        serveStatic(req, res);
      } else {
        json(res, 405, { error: 'Method not allowed' });
      }
    } catch (e) {
      if (!res.headersSent) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error(e);
        json(res, status, { error: status === 500 ? 'Something went wrong on the server' : e.message });
      }
    }
    throw null; // tell Hocuspocus the request was handled
  },
});

await server.listen();
console.log(`\n  Local Notes team server ${config.version}`);
console.log(`  Listening on http://${config.host}:${config.port}`);
console.log(`  Data: ${config.dataDir}`);
console.log(`  Sign-up: ${config.signup === 'open' ? 'open to anyone' : 'first user, then invite links only'}\n`);
