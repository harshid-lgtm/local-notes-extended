// SQLite storage (node:sqlite, no native modules). One file: DATA_DIR/team.db
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

export const newId = (n = 12) => randomBytes(n).toString('base64url');
export const now = () => Date.now();

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw TEXT NOT NULL,
  color TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, joined_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id TEXT, title TEXT NOT NULL, position REAL NOT NULL DEFAULT 0,
  created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT,
  deleted_at INTEGER, markdown TEXT NOT NULL DEFAULT '', mirror_path TEXT
);
CREATE INDEX IF NOT EXISTS pages_ws ON pages(workspace_id, deleted_at);
CREATE TABLE IF NOT EXISTS docs ( page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE, state BLOB NOT NULL );
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  markdown TEXT NOT NULL, title TEXT NOT NULL, authors TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_page ON versions(page_id, created_at);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  quote TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  resolved_at INTEGER, resolved_by TEXT
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, workspace_id TEXT, page_id TEXT, thread_id TEXT, actor_id TEXT,
  text TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, read_at);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS page_shares (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, user_id)
);
CREATE INDEX IF NOT EXISTS shares_user ON page_shares(user_id);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'team.db'));
  db.exec(SCHEMA);
  // migrations for databases created by earlier versions
  const cols = db.prepare('PRAGMA table_info(pages)').all().map((c) => c.name);
  if (!cols.includes('access')) db.exec("ALTER TABLE pages ADD COLUMN access TEXT NOT NULL DEFAULT 'workspace'");
  const cache = new Map();
  const prep = (sql) => {
    if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
    return cache.get(sql);
  };
  return {
    raw: db,
    get: (sql, ...a) => prep(sql).get(...a),
    all: (sql, ...a) => prep(sql).all(...a),
    run: (sql, ...a) => prep(sql).run(...a),
    tx(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
