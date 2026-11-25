// REST API for the team server. JSON in/out, Bearer-token auth.
import fs from 'node:fs';
import path from 'node:path';
import { newId, now } from './db.js';
import { hashPassword, checkPassword, newToken, hashToken, pickColor, rateLimit } from './auth.js';
import { subscribe, sendTo } from './events.js';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { ROLES, RANK, isManager, canAssignRole, canRemoveMember, roleError } from './permissions.js';

// The provider layer is shared with the desktop app (server/ai.js in the repository).
const requireFromHere = createRequire(import.meta.url);
const aiLib = requireFromHere('../../server/ai.js');
const aiClient = aiLib.createAI({ Anthropic });
const exportNote = requireFromHere('../../server/export.js');
const { SearchIndex } = requireFromHere('../../shared/search-index.cjs');

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const VERSION_EVERY = 10 * 60 * 1000;
const MAX_VERSIONS = 300;

export function createApi({ db, config, collab }) {
  const pageSearch = new SearchIndex();
  const refreshSearch = () => {
    const pages = db.all('SELECT id, workspace_id, title, markdown, updated_at FROM pages WHERE deleted_at IS NULL');
    pageSearch.refresh(pages.map((page) => ({
      id: page.id,
      title: page.title,
      body: page.markdown,
      updatedAt: page.updated_at,
      version: page.updated_at,
      extra: { workspaceId: page.workspace_id },
    })));
  };
  const searchResults = (user, q, allowed) => {
    refreshSearch();
    return pageSearch.search(q, { limit: 40, allowed }).map((result) => ({
      id: result.id,
      title: result.title,
      snippet: result.snippet,
      score: result.score,
      updatedAt: result.updatedAt,
      workspaceId: result.extra?.workspaceId || null,
    }));
  };

  // ---------------------------------------------------------------- helpers
  const userPublic = (u) => u && ({ id: u.id, name: u.name, email: u.email, color: u.color, isAdmin: !!u.is_admin });
  const userById = (id) => db.get('SELECT * FROM users WHERE id = ?', id);

  function authUser(req, { optional = false } = {}) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url, 'http://x').searchParams.get('token');
    if (!token) { if (optional) return null; fail(401, 'Please sign in'); }
    const s = db.get('SELECT * FROM sessions WHERE token = ?', hashToken(token));
    if (!s) { if (optional) return null; fail(401, 'Your session has expired. Please sign in again.'); }
    if (now() - s.last_seen > 60_000) db.run('UPDATE sessions SET last_seen = ? WHERE token = ?', now(), s.token);
    return userById(s.user_id);
  }
  // used by the collaboration hooks
  const userForToken = (token) => {
    const s = token && db.get('SELECT * FROM sessions WHERE token = ?', hashToken(token));
    return s ? userById(s.user_id) : null;
  };

  const roleIn = (userId, wsId) => db.get('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?', wsId, userId)?.role || null;
  function requireRole(user, wsId, min = 'viewer') {
    const role = roleIn(user.id, wsId);
    if (!role) fail(404, 'Workspace not found');
    if ((RANK[role] || 0) < (RANK[min] || 0)) fail(403, roleError(min));
    return role;
  }
  // ---------------------------------------------------------------- page access
  // A page is visible to: workspace owners; other workspace members unless the page (or an
  // ancestor) is restricted, in which case only its creator keeps member access; and anyone the
  // page or an ancestor is shared with. The nearest share wins; roles never go below a member's.
  const best = (a, b) => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);
  const pageById = (id) => db.get('SELECT * FROM pages WHERE id = ?', id);
  function chainOf(page, lookup = pageById) {
    const out = [];
    const seen = new Set();
    for (let p = page; p && !seen.has(p.id); p = p.parent_id ? lookup(p.parent_id) : null) { seen.add(p.id); out.push(p); }
    return out;
  }
  function accessFor(userId, page, { chain = chainOf(page), wsRole = roleIn(userId, page.workspace_id), shares = null } = {}) {
    if (wsRole === 'owner') return 'owner';
    let shareRole = null;
    for (const p of chain) {
      const s = shares ? shares.get(p.id) : db.get('SELECT role FROM page_shares WHERE page_id = ? AND user_id = ?', p.id, userId)?.role;
      if (s) { shareRole = s; break; }
    }
    const restrictedBy = chain.find((p) => p.access === 'restricted');
    if (wsRole && !restrictedBy) return best(wsRole, shareRole);
    if (wsRole && restrictedBy.created_by === userId) return best(wsRole === 'viewer' ? 'editor' : wsRole, shareRole);
    return shareRole;
  }
  const pageRole = (userId, pageId) => { const p = pageById(pageId); return p && !p.deleted_at ? accessFor(userId, p) : null; };
  const canManage = (userId, page, role = accessFor(userId, page)) => isManager(role) || (role === 'editor' && chainOf(page).some((p) => p.created_by === userId));

  function pageFor(user, pageId, min = 'viewer') {
    const p = pageById(pageId);
    if (!p) fail(404, 'Page not found');
    const role = accessFor(user.id, p);
    if (!role) fail(404, 'Page not found');
    if (RANK[role] < RANK[min]) fail(403, 'You have view-only access to this page');
    return { page: p, role };
  }

  // Every page of a workspace this person may see, with their role on each (one pass, no N+1).
  function visiblePages(userId, wsId) {
    const all = db.all('SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY position', wsId);
    const byId = new Map(all.map((p) => [p.id, p]));
    const shares = new Map(db.all('SELECT s.page_id, s.role FROM page_shares s JOIN pages p ON p.id = s.page_id WHERE s.user_id = ? AND p.workspace_id = ?', userId, wsId).map((r) => [r.page_id, r.role]));
    const shared = new Set(db.all('SELECT DISTINCT s.page_id FROM page_shares s JOIN pages p ON p.id = s.page_id WHERE p.workspace_id = ?', wsId).map((r) => r.page_id));
    const wsRole = roleIn(userId, wsId);
    const out = [];
    for (const p of all) {
      const chain = chainOf(p, (id) => byId.get(id));
      const role = accessFor(userId, p, { chain, wsRole, shares });
      if (role) out.push({ page: p, role, restricted: chain.some((x) => x.access === 'restricted'), shared: shared.has(p.id) });
    }
    return out;
  }

  const memberIds = (wsId) => db.all('SELECT user_id FROM members WHERE workspace_id = ?', wsId).map((r) => r.user_id);
  const shareUserIds = (wsId) => db.all('SELECT DISTINCT s.user_id FROM page_shares s JOIN pages p ON p.id = s.page_id WHERE p.workspace_id = ?', wsId).map((r) => r.user_id);
  // events carry ids only, so members and people with shared pages can all be told to refresh
  const broadcast = (wsId, event) => sendTo([...memberIds(wsId), ...shareUserIds(wsId)], { workspaceId: wsId, ...event });

  const pagePublic = (p) => ({
    id: p.id, workspaceId: p.workspace_id, parentId: p.parent_id, title: p.title, position: p.position,
    createdAt: p.created_at, createdBy: p.created_by, updatedAt: p.updated_at, updatedBy: p.updated_by, deletedAt: p.deleted_at,
    access: p.access || 'workspace',
  });

  function createSession(user) {
    const token = newToken();
    db.run('INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)', hashToken(token), user.id, now(), now());
    return token;
  }

  function createWorkspace(user, name, kind = 'team') {
    const id = newId(9);
    db.run('INSERT INTO workspaces (id, name, kind, owner_id, created_at) VALUES (?, ?, ?, ?, ?)', id, name, kind, user.id, now());
    db.run('INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', id, user.id, 'owner', now());
    return id;
  }

  function addPage(wsId, user, { title = 'Untitled', parentId = null, markdown = '' }) {
    const id = newId(10);
    const pos = (db.get('SELECT MAX(position) AS m FROM pages WHERE workspace_id = ? AND parent_id IS ?', wsId, parentId)?.m ?? 0) + 1;
    db.run(`INSERT INTO pages (id, workspace_id, parent_id, title, position, created_by, created_at, updated_at, updated_by, markdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, wsId, parentId, cleanTitle(title), pos, user.id, now(), now(), user.id, markdown);
    mirror(id);
    return db.get('SELECT * FROM pages WHERE id = ?', id);
  }

  const cleanTitle = (t) => String(t || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || 'Untitled';

  function descendants(pageId) {
    const out = [];
    const walk = (id) => {
      for (const c of db.all('SELECT id FROM pages WHERE parent_id = ?', id)) { out.push(c.id); walk(c.id); }
    };
    walk(pageId);
    return out;
  }

  // ---------------------------------------------------------------- markdown mirror (DATA_DIR/vault)
  // Every page is also written as a .md file, using the same "Page.md + Page/" layout as the
  // desktop app, so the server folder can be opened in Local Notes or Obsidian.
  const vaultRoot = path.join(config.dataDir, 'vault');
  const safe = (s) => String(s).replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/^\.+/, '').trim().slice(0, 120) || 'Untitled';

  function mirrorPathOf(p) {
    const ws = db.get('SELECT * FROM workspaces WHERE id = ?', p.workspace_id);
    const owner = ws.kind === 'private' ? userById(ws.owner_id) : null;
    const wsDir = ws.kind === 'private' ? `Private - ${safe(owner?.name || owner?.email || ws.id)}` : safe(ws.name);
    const parts = [];
    let cur = p;
    while (cur) {
      const dup = db.get('SELECT COUNT(*) AS n FROM pages WHERE workspace_id = ? AND parent_id IS ? AND lower(title) = lower(?) AND deleted_at IS NULL', cur.workspace_id, cur.parent_id, cur.title).n > 1;
      parts.unshift(dup ? `${safe(cur.title)} (${cur.id.slice(0, 4)})` : safe(cur.title));
      cur = cur.parent_id ? db.get('SELECT * FROM pages WHERE id = ?', cur.parent_id) : null;
    }
    return path.join(vaultRoot, `${wsDir} (${ws.id.slice(0, 4)})`, ...parts) + '.md';
  }

  function mirror(pageId, { remove = false } = {}) {
    if (!config.mirror) return;
    const p = db.get('SELECT * FROM pages WHERE id = ?', pageId);
    if (!p) return;
    try {
      if (remove || p.deleted_at) {
        if (p.mirror_path && fs.existsSync(p.mirror_path)) fs.rmSync(p.mirror_path);
        db.run('UPDATE pages SET mirror_path = NULL WHERE id = ?', pageId);
        return;
      }
      const target = mirrorPathOf(p);
      if (p.mirror_path && p.mirror_path !== target && fs.existsSync(p.mirror_path)) fs.rmSync(p.mirror_path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, p.markdown ? `${p.markdown.replace(/\s+$/, '')}\n` : '');
      if (p.mirror_path !== target) db.run('UPDATE pages SET mirror_path = ? WHERE id = ?', target, pageId);
    } catch (e) {
      console.warn('mirror failed for', pageId, e.message);
    }
  }
  const mirrorTree = (pageId, opts) => { mirror(pageId, opts); for (const d of descendants(pageId)) mirror(d, opts); };

  // ---------------------------------------------------------------- links
  const WIKI = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;
  function linkIndex(wsId, userId) {
    const pages = visiblePages(userId, wsId).map((v) => v.page);
    const byTitle = new Map();
    for (const p of pages) if (!byTitle.has(p.title.toLowerCase())) byTitle.set(p.title.toLowerCase(), p.id);
    const links = new Map();
    for (const p of pages) {
      const out = [];
      for (const m of p.markdown.matchAll(WIKI)) {
        const target = m[1].trim().split('/').pop().toLowerCase();
        out.push({ to: byTitle.get(target) || null, name: m[1].trim(), index: m.index });
      }
      links.set(p.id, out);
    }
    return { pages, links };
  }
  const snippet = (text, index) => {
    const s = text.lastIndexOf('\n', index) + 1;
    let e = text.indexOf('\n', index);
    if (e < 0) e = text.length;
    return text.slice(s, e).trim().replace(/^(?:[-*+]\s+\[.\]\s+|[-*+>#]+\s*|\d+\.\s+)+/, '').slice(0, 240);
  };

  // ---------------------------------------------------------------- versions
  function snapshot(page, authors, label = null) {
    db.run('INSERT INTO versions (page_id, markdown, title, authors, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      page.id, page.markdown, page.title, JSON.stringify([...authors]), label, now());
    const extra = db.get('SELECT COUNT(*) AS n FROM versions WHERE page_id = ?', page.id).n - MAX_VERSIONS;
    if (extra > 0) db.run('DELETE FROM versions WHERE id IN (SELECT id FROM versions WHERE page_id = ? ORDER BY created_at ASC LIMIT ?)', page.id, extra);
  }
  const pendingAuthors = new Map(); // pageId -> Set<userId> since last version

  // ---------------------------------------------------------------- notifications
  function notify(userIds, n) {
    const ids = [...new Set(userIds)].filter((id) => id && id !== n.actorId);
    for (const id of ids) {
      db.run('INSERT INTO notifications (user_id, kind, workspace_id, page_id, thread_id, actor_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, n.kind, n.workspaceId || null, n.pageId || null, n.threadId || null, n.actorId || null, n.text || '', now());
    }
    sendTo(ids, { type: 'notification' });
  }

  function threadPublic(t) {
    const comments = db.all('SELECT * FROM comments WHERE thread_id = ? ORDER BY created_at', t.id);
    return {
      id: t.id, pageId: t.page_id, quote: t.quote, createdAt: t.created_at, createdBy: t.created_by,
      resolvedAt: t.resolved_at, resolvedBy: t.resolved_by,
      comments: comments.map((c) => ({ id: c.id, userId: c.user_id, body: c.body, createdAt: c.created_at, editedAt: c.edited_at })),
    };
  }

  function mentionTargets(page, mentions) {
    return (Array.isArray(mentions) ? mentions : []).filter((id) => typeof id === 'string' && accessFor(id, page));
  }
  // Everyone who can open this page: for @mentions, avatars and the share dialog.
  function pagePeople(page) {
    const chain = chainOf(page);
    const ids = new Set([...memberIds(page.workspace_id), ...db.all(`SELECT user_id FROM page_shares WHERE page_id IN (${chain.map(() => '?').join(',')})`, ...chain.map((p) => p.id)).map((r) => r.user_id)]);
    return [...ids].map((id) => ({ user: userById(id), role: accessFor(id, page, { chain }) })).filter((x) => x.user && x.role);
  }

  // ---------------------------------------------------------------- routes
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler, opts });
  };

  route('GET', '/api/team/info', () => ({
    name: config.name,
    version: config.version,
    hasUsers: !!db.get('SELECT 1 AS x FROM users LIMIT 1'),
    signup: config.signup,
  }), { public: true });

  route('POST', '/api/auth/signup', ({ body, req }) => {
    if (!rateLimit(`signup:${req.socket.remoteAddress}`, 20)) fail(429, 'Too many attempts. Try again in a few minutes.');
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 80);
    const pw = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (!name) fail(400, 'Enter your name');
    if (pw.length < 8) fail(400, 'Use at least 8 characters for your password');
    const first = !db.get('SELECT 1 AS x FROM users LIMIT 1');
    const invite = body.invite ? db.get('SELECT * FROM invites WHERE token = ? AND expires_at > ?', body.invite, now()) : null;
    if (!first && config.signup !== 'open' && !invite) fail(403, 'Sign-up on this server is by invitation. Ask a teammate for an invite link.');
    if (db.get('SELECT 1 AS x FROM users WHERE email = ?', email)) fail(409, 'An account with that email already exists. Sign in instead.');
    const user = db.tx(() => {
      const id = newId(9);
      db.run('INSERT INTO users (id, email, name, pw, color, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, email, name, hashPassword(pw), pickColor(id), first ? 1 : 0, now());
      const u = userById(id);
      const priv = createWorkspace(u, 'Private', 'private');
      addPage(priv, u, { title: 'Getting started', markdown: GETTING_STARTED });
      if (first) {
        const team = createWorkspace(u, config.name || 'Team');
        addPage(team, u, { title: 'Team home', markdown: TEAM_HOME });
      }
      if (invite) acceptInvite(u, invite);
      return u;
    });
    return { token: createSession(user), user: userPublic(user) };
  }, { public: true });

  route('POST', '/api/auth/login', ({ body, req }) => {
    const email = String(body.email || '').trim().toLowerCase();
    if (!rateLimit(`login:${email}`, 10) || !rateLimit(`login-ip:${req.socket.remoteAddress}`, 40)) fail(429, 'Too many attempts. Try again in a few minutes.');
    const u = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!u || !checkPassword(String(body.password || ''), u.pw)) fail(401, 'Wrong email or password');
    if (body.invite) {
      const inv = db.get('SELECT * FROM invites WHERE token = ? AND expires_at > ?', body.invite, now());
      if (inv) acceptInvite(u, inv);
    }
    return { token: createSession(u), user: userPublic(u) };
  }, { public: true });

  route('POST', '/api/auth/logout', ({ req }) => {
    const t = (req.headers.authorization || '').slice(7);
    db.run('DELETE FROM sessions WHERE token = ?', hashToken(t));
    return { ok: true };
  });

  route('GET', '/api/me', ({ user }) => {
    const workspaces = db.all(`SELECT w.id, w.name, w.kind, m.role, (SELECT COUNT(*) FROM members x WHERE x.workspace_id = w.id) AS members
      FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.kind = 'private' DESC, w.created_at`, user.id);
    const unread = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', user.id).n;
    return { user: userPublic(user), workspaces, unread };
  });

  route('PATCH', '/api/me', ({ user, body }) => {
    if (body.name) db.run('UPDATE users SET name = ? WHERE id = ?', String(body.name).trim().slice(0, 80), user.id);
    if (body.newPassword) {
      if (!checkPassword(String(body.password || ''), user.pw)) fail(401, 'Your current password is incorrect');
      if (String(body.newPassword).length < 8) fail(400, 'Use at least 8 characters');
      db.run('UPDATE users SET pw = ? WHERE id = ?', hashPassword(String(body.newPassword)), user.id);
    }
    return { user: userPublic(userById(user.id)) };
  });

  // workspaces & members
  route('POST', '/api/workspaces', ({ user, body }) => {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) fail(400, 'Give the workspace a name');
    const id = createWorkspace(user, name);
    addPage(id, user, { title: 'Welcome', markdown: TEAM_HOME });
    return { id };
  });
  route('PATCH', '/api/workspaces/:id', ({ user, params, body }) => {
    requireRole(user, params.id, 'owner');
    const name = String(body.name || '').trim().slice(0, 80);
    if (name) db.run("UPDATE workspaces SET name = ? WHERE id = ? AND kind = 'team'", name, params.id);
    broadcast(params.id, { type: 'workspace' });
    return { ok: true };
  });
  route('DELETE', '/api/workspaces/:id', ({ user, params }) => {
    requireRole(user, params.id, 'owner');
    const ws = db.get('SELECT * FROM workspaces WHERE id = ?', params.id);
    if (ws.kind === 'private') fail(400, 'Your private space can’t be deleted');
    const members = memberIds(params.id);
    for (const p of db.all('SELECT id FROM pages WHERE workspace_id = ?', params.id)) mirror(p.id, { remove: true });
    db.run('DELETE FROM workspaces WHERE id = ?', params.id);
    sendTo(members, { type: 'workspace', workspaceId: params.id });
    return { ok: true };
  });
  route('GET', '/api/workspaces/:id/members', ({ user, params }) => {
    requireRole(user, params.id);
    return {
      members: db.all(`SELECT u.id, u.name, u.email, u.color, m.role, m.joined_at AS joinedAt FROM members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.name`, params.id),
    };
  });
  route('PATCH', '/api/workspaces/:id/members/:uid', ({ user, params, body }) => {
    const actorRole = requireRole(user, params.id, 'admin');
    if (!ROLES.includes(body.role)) fail(400, 'Unknown role');
    const target = db.get('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?', params.id, params.uid);
    if (!target) fail(404, 'Person is not in this workspace');
    const ownerCount = db.get("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'", params.id).n;
    if (!canAssignRole({ actorRole, targetRole: target.role, nextRole: body.role })) {
      fail(403, target.role === 'owner' || body.role === 'owner' ? 'Only owners can change ownership' : 'Only workspace admins can change roles');
    }
    if (target.role === 'owner' && body.role !== 'owner' && ownerCount < 2) {
      fail(400, 'A workspace needs at least one owner');
    }
    db.run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', body.role, params.id, params.uid);
    collab.kick(params.uid, params.id);
    broadcast(params.id, { type: 'members' });
    return { ok: true, role: body.role };
  });
  route('DELETE', '/api/workspaces/:id/members/:uid', ({ user, params }) => {
    const actorRole = roleIn(user.id, params.id);
    if (!actorRole) fail(404, 'Workspace not found');
    const isSelf = params.uid === user.id;
    if (!isSelf) requireRole(user, params.id, 'admin');
    const ws = db.get('SELECT * FROM workspaces WHERE id = ?', params.id);
    if (ws?.kind === 'private') fail(400, 'You can’t leave your private space');
    const targetRole = roleIn(params.uid, params.id);
    if (!targetRole) fail(404, 'Person is not in this workspace');
    const ownerCount = db.get("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'", params.id).n;
    if (!canRemoveMember({ actorRole, targetRole, ownerCount, isSelf })) {
      fail(403, targetRole === 'owner' ? 'Only owners can remove an owner' : 'Only workspace admins can remove members');
    }
    if (targetRole === 'owner' && ownerCount <= 1) fail(400, 'Make someone else an owner first');
    const before = memberIds(params.id);
    db.run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', params.id, params.uid);
    collab.kick(params.uid, params.id);
    sendTo(before, { type: 'members', workspaceId: params.id });
    return { ok: true };
  });

  // invites
  route('POST', '/api/workspaces/:id/invites', ({ user, params, body }) => {
    requireRole(user, params.id, 'admin');
    const ws = db.get('SELECT * FROM workspaces WHERE id = ?', params.id);
    if (ws.kind === 'private') fail(400, 'Private spaces can’t be shared');
    const role = ROLES.includes(body.role) && body.role !== 'owner' ? body.role : 'editor';
    const token = newToken().slice(0, 24);
    db.run('INSERT INTO invites (token, workspace_id, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      token, params.id, role, user.id, now(), now() + 14 * 24 * 3600 * 1000);
    return { token, role, expiresAt: now() + 14 * 24 * 3600 * 1000 };
  });
  route('GET', '/api/invites/:token', ({ params }) => {
    const inv = db.get('SELECT * FROM invites WHERE token = ? AND expires_at > ?', params.token, now());
    if (!inv) fail(404, 'This invite link has expired or is invalid');
    const ws = db.get('SELECT name FROM workspaces WHERE id = ?', inv.workspace_id);
    const by = userById(inv.created_by);
    return { workspace: ws?.name, role: inv.role, invitedBy: by?.name };
  }, { public: true });
  function acceptInvite(user, inv) {
    if (!roleIn(user.id, inv.workspace_id)) {
      db.run('INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', inv.workspace_id, user.id, inv.role, now());
      db.run('UPDATE invites SET uses = uses + 1 WHERE token = ?', inv.token);
      notify(memberIds(inv.workspace_id), { kind: 'joined', workspaceId: inv.workspace_id, actorId: user.id, text: `${user.name} joined` });
      broadcast(inv.workspace_id, { type: 'members' });
    }
    return inv.workspace_id;
  }
  route('POST', '/api/invites/:token/accept', ({ user, params }) => {
    const inv = db.get('SELECT * FROM invites WHERE token = ? AND expires_at > ?', params.token, now());
    if (!inv) fail(404, 'This invite link has expired or is invalid');
    return { workspaceId: acceptInvite(user, inv) };
  });

  // pages
  route('GET', '/api/workspaces/:id/pages', ({ user, params }) => {
    const role = requireRole(user, params.id);
    const pages = visiblePages(user.id, params.id).map((v) => ({ ...pagePublic(v.page), role: v.role, restricted: v.restricted, shared: v.shared }));
    return { role, pages };
  });
  route('POST', '/api/workspaces/:id/pages', ({ user, params, body }) => {
    requireRole(user, params.id, 'editor');
    if (body.parentId) {
      const parent = db.get('SELECT * FROM pages WHERE id = ? AND workspace_id = ?', body.parentId, params.id);
      if (!parent) fail(400, 'Parent page not found');
    }
    const p = addPage(params.id, user, { title: body.title, parentId: body.parentId || null, markdown: String(body.markdown || '') });
    broadcast(params.id, { type: 'tree', actorId: user.id });
    return { page: pagePublic(p), markdown: p.markdown };
  });
  route('GET', '/api/pages/:id', ({ user, params }) => {
    const { page, role } = pageFor(user, params.id);
    const ws = db.get('SELECT id, name, kind FROM workspaces WHERE id = ?', page.workspace_id);
    return { page: pagePublic(page), role, workspace: ws, markdown: page.markdown, updatedByName: userById(page.updated_by)?.name || null };
  });
  route('PATCH', '/api/pages/:id', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id, 'editor');
    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === page.id || descendants(page.id).includes(body.parentId)) fail(400, 'Can’t move a page inside itself');
      if (!db.get('SELECT 1 AS x FROM pages WHERE id = ? AND workspace_id = ?', body.parentId, page.workspace_id)) fail(400, 'Parent not found');
    }
    const title = body.title !== undefined ? cleanTitle(body.title) : page.title;
    const parentId = body.parentId !== undefined ? body.parentId : page.parent_id;
    const position = typeof body.position === 'number' ? body.position : page.position;
    db.run('UPDATE pages SET title = ?, parent_id = ?, position = ?, updated_at = ?, updated_by = ? WHERE id = ?', title, parentId, position, now(), user.id, page.id);
    mirrorTree(page.id);
    broadcast(page.workspace_id, { type: 'tree', actorId: user.id, pageId: page.id });
    return { page: pagePublic(db.get('SELECT * FROM pages WHERE id = ?', page.id)) };
  });
  route('DELETE', '/api/pages/:id', ({ user, params }) => {
    const { page } = pageFor(user, params.id, 'editor');
    const ids = [page.id, ...descendants(page.id)];
    for (const id of ids) { db.run('UPDATE pages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now(), id); mirror(id, { remove: true }); }
    broadcast(page.workspace_id, { type: 'tree', actorId: user.id, deleted: ids });
    return { ok: true, deleted: ids.length };
  });
  route('GET', '/api/workspaces/:id/trash', ({ user, params }) => {
    requireRole(user, params.id);
    return { pages: db.all('SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200', params.id).map(pagePublic) };
  });
  route('POST', '/api/pages/:id/restore', ({ user, params }) => {
    const { page } = pageFor(user, params.id, 'editor');
    let parent = page.parent_id && db.get('SELECT * FROM pages WHERE id = ?', page.parent_id);
    const parentId = parent && !parent.deleted_at ? parent.id : null;
    const ids = [page.id, ...descendants(page.id)].filter((id) => db.get('SELECT deleted_at FROM pages WHERE id = ?', id)?.deleted_at >= page.deleted_at);
    for (const id of ids) db.run('UPDATE pages SET deleted_at = NULL WHERE id = ?', id);
    db.run('UPDATE pages SET parent_id = ? WHERE id = ?', parentId, page.id);
    mirrorTree(page.id);
    broadcast(page.workspace_id, { type: 'tree', actorId: user.id });
    return { ok: true };
  });

  // Clients send their markdown rendering of the shared doc; it powers search, links,
  // history and the .md mirror. The Yjs document stays the source of truth.
  route('PUT', '/api/pages/:id/markdown', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id, 'editor');
    const markdown = String(body.markdown ?? '').slice(0, 5_000_000);
    if (markdown === page.markdown) return { ok: true, unchanged: true };
    db.run('UPDATE pages SET markdown = ?, updated_at = ?, updated_by = ? WHERE id = ?', markdown, now(), user.id, page.id);
    const fresh = db.get('SELECT * FROM pages WHERE id = ?', page.id);
    mirror(page.id);
    if (!pendingAuthors.has(page.id)) pendingAuthors.set(page.id, new Set());
    pendingAuthors.get(page.id).add(user.id);
    const last = db.get('SELECT created_at FROM versions WHERE page_id = ? ORDER BY created_at DESC LIMIT 1', page.id);
    if (!last || now() - last.created_at > VERSION_EVERY) {
      snapshot(fresh, pendingAuthors.get(page.id));
      pendingAuthors.delete(page.id);
    }
    broadcast(page.workspace_id, { type: 'page', pageId: page.id, updatedAt: fresh.updated_at, updatedBy: user.id });
    return { ok: true, updatedAt: fresh.updated_at };
  });

  // history
  route('GET', '/api/pages/:id/versions', ({ user, params }) => {
    pageFor(user, params.id);
    return {
      versions: db.all('SELECT id, title, authors, label, created_at AS createdAt, length(markdown) AS size FROM versions WHERE page_id = ? ORDER BY created_at DESC', params.id)
        .map((v) => ({ ...v, authors: JSON.parse(v.authors) })),
    };
  });
  route('GET', '/api/versions/:vid', ({ user, params }) => {
    const v = db.get('SELECT * FROM versions WHERE id = ?', Number(params.vid));
    if (!v) fail(404, 'Version not found');
    pageFor(user, v.page_id);
    return { id: v.id, pageId: v.page_id, title: v.title, markdown: v.markdown, label: v.label, createdAt: v.created_at, authors: JSON.parse(v.authors) };
  });
  route('POST', '/api/pages/:id/versions', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id, 'editor');
    snapshot(page, new Set([user.id, ...(pendingAuthors.get(page.id) || [])]), String(body.label || '').slice(0, 120) || null);
    pendingAuthors.delete(page.id);
    return { ok: true };
  });

  // links, graph, search
  route('GET', '/api/pages/:id/links', ({ user, params }) => {
    const { page } = pageFor(user, params.id);
    const { pages, links } = linkIndex(page.workspace_id, user.id);
    const linked = [];
    for (const p of pages) {
      if (p.id === page.id) continue;
      const hits = links.get(p.id).filter((l) => l.to === page.id);
      if (hits.length) linked.push({ id: p.id, title: p.title, snippets: [...new Set(hits.slice(0, 3).map((h) => snippet(p.markdown, h.index)))] });
    }
    const children = db.all('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position', page.id).filter((c) => accessFor(user.id, c)).map((c) => ({ id: c.id, title: c.title }));
    return { linked, children };
  });
  route('GET', '/api/workspaces/:id/graph', ({ user, params }) => {
    requireRole(user, params.id);
    const { pages, links } = linkIndex(params.id, user.id);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const top = (p) => { let c = p; while (c.parent_id && byId.get(c.parent_id)) c = byId.get(c.parent_id); return c === p ? '' : c.title; };
    const nodes = pages.map((p) => ({ id: p.id, name: p.title, folder: top(p), mtime: p.updated_at / 1000 }));
    const edges = [];
    const unresolved = new Map();
    for (const [from, ls] of links) {
      const seen = new Set();
      for (const l of ls) {
        const to = l.to || `?${l.name.toLowerCase()}`;
        if (to === from || seen.has(to)) continue;
        seen.add(to);
        if (!l.to && !unresolved.has(to)) unresolved.set(to, { id: to, name: l.name, unresolved: true });
        edges.push({ source: from, target: to });
      }
      const p = byId.get(from);
      if (p.parent_id && byId.has(p.parent_id) && !seen.has(p.parent_id)) edges.push({ source: from, target: p.parent_id });
    }
    return { nodes: [...nodes, ...unresolved.values()], edges };
  });
  route('GET', '/api/workspaces/:id/search', ({ user, params, query }) => {
    requireRole(user, params.id);
    const q = String(query.q || '').trim();
    if (!q) return { results: [] };
    const allowed = new Set(visiblePages(user.id, params.id).map((v) => v.page.id));
    return { results: searchResults(user, q, allowed) };
  });

  // One ranked search across every workspace and every page shared with this person.
  route('GET', '/api/search', ({ user, query }) => {
    const q = String(query.q || '').trim();
    if (!q) return { results: [] };
    const allowed = new Set();
    for (const w of db.all('SELECT workspace_id AS id FROM members WHERE user_id = ?', user.id)) {
      for (const v of visiblePages(user.id, w.id)) allowed.add(v.page.id);
    }
    for (const v of sharedWithMe(user)) allowed.add(v.page.id);
    return { results: searchResults(user, q, allowed), source: 'index' };
  });

  route('POST', '/api/pages/:id/export', async ({ user, params, body }) => {
    const { page } = pageFor(user, params.id);
    const baseDir = page.mirror_path ? path.dirname(page.mirror_path) : null;
    const readImage = (src) => {
      if (/^(?:[a-z]+:)?\/\//i.test(src) || /^data:/i.test(src)) return null;
      let rel = String(src).split(/[?#]/)[0];
      try { rel = decodeURIComponent(rel); } catch { /* literal */ }
      const candidates = [
        baseDir ? path.resolve(baseDir, rel) : null,
        path.resolve(vaultRoot, rel),
      ].filter(Boolean);
      for (const candidate of candidates) {
        if (!candidate.startsWith(vaultRoot + path.sep) && candidate !== vaultRoot) continue;
        try { if (fs.existsSync(candidate)) return fs.readFileSync(candidate); } catch { /* next */ }
      }
      return null;
    };
    const result = await exportNote({
      title: page.title,
      markdown: page.markdown,
      format: body.format,
      baseName: page.title,
      readImage,
    });
    return { __download: true, ...result };
  });

  // comments
  route('GET', '/api/pages/:id/threads', ({ user, params }) => {
    const { page } = pageFor(user, params.id);
    return { threads: db.all('SELECT * FROM threads WHERE page_id = ? ORDER BY created_at', page.id).map(threadPublic) };
  });
  route('POST', '/api/pages/:id/threads', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id, 'editor');
    const text = String(body.body || '').trim().slice(0, 10000);
    if (!text) fail(400, 'Write a comment first');
    const id = /^[\w-]{6,40}$/.test(body.id || '') ? body.id : newId(9);
    db.tx(() => {
      db.run('INSERT INTO threads (id, page_id, quote, created_by, created_at) VALUES (?, ?, ?, ?, ?)', id, page.id, String(body.quote || '').slice(0, 500), user.id, now());
      db.run('INSERT INTO comments (id, thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', newId(9), id, user.id, text, now());
    });
    const mentioned = mentionTargets(page, body.mentions);
    notify(mentioned, { kind: 'mention', workspaceId: page.workspace_id, pageId: page.id, threadId: id, actorId: user.id, text: text.slice(0, 200) });
    broadcast(page.workspace_id, { type: 'comments', pageId: page.id });
    return { thread: threadPublic(db.get('SELECT * FROM threads WHERE id = ?', id)) };
  });
  route('POST', '/api/threads/:id/comments', ({ user, params, body }) => {
    const t = db.get('SELECT * FROM threads WHERE id = ?', params.id);
    if (!t) fail(404, 'Thread not found');
    const { page } = pageFor(user, t.page_id, 'editor');
    const text = String(body.body || '').trim().slice(0, 10000);
    if (!text) fail(400, 'Write a reply first');
    db.run('INSERT INTO comments (id, thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', newId(9), t.id, user.id, text, now());
    db.run('UPDATE threads SET resolved_at = NULL, resolved_by = NULL WHERE id = ?', t.id);
    const participants = db.all('SELECT DISTINCT user_id FROM comments WHERE thread_id = ?', t.id).map((r) => r.user_id);
    const mentioned = mentionTargets(page, body.mentions);
    notify(mentioned, { kind: 'mention', workspaceId: page.workspace_id, pageId: page.id, threadId: t.id, actorId: user.id, text: text.slice(0, 200) });
    notify(participants.filter((p) => !mentioned.includes(p)), { kind: 'reply', workspaceId: page.workspace_id, pageId: page.id, threadId: t.id, actorId: user.id, text: text.slice(0, 200) });
    broadcast(page.workspace_id, { type: 'comments', pageId: page.id });
    return { thread: threadPublic(db.get('SELECT * FROM threads WHERE id = ?', t.id)) };
  });
  route('PATCH', '/api/threads/:id', ({ user, params, body }) => {
    const t = db.get('SELECT * FROM threads WHERE id = ?', params.id);
    if (!t) fail(404, 'Thread not found');
    const { page } = pageFor(user, t.page_id, 'editor');
    if (body.resolved) db.run('UPDATE threads SET resolved_at = ?, resolved_by = ? WHERE id = ?', now(), user.id, t.id);
    else db.run('UPDATE threads SET resolved_at = NULL, resolved_by = NULL WHERE id = ?', t.id);
    broadcast(page.workspace_id, { type: 'comments', pageId: page.id });
    return { thread: threadPublic(db.get('SELECT * FROM threads WHERE id = ?', t.id)) };
  });
  route('DELETE', '/api/comments/:id', ({ user, params }) => {
    const c = db.get('SELECT * FROM comments WHERE id = ?', params.id);
    if (!c) fail(404, 'Comment not found');
    const t = db.get('SELECT * FROM threads WHERE id = ?', c.thread_id);
    const { page, role } = pageFor(user, t.page_id, 'editor');
    if (c.user_id !== user.id && role !== 'owner') fail(403, 'You can only delete your own comments');
    db.run('DELETE FROM comments WHERE id = ?', c.id);
    if (!db.get('SELECT 1 AS x FROM comments WHERE thread_id = ?', t.id)) db.run('DELETE FROM threads WHERE id = ?', t.id);
    broadcast(page.workspace_id, { type: 'comments', pageId: page.id });
    return { ok: true };
  });

  // people lookup for @mentions and avatars
  route('GET', '/api/pages/:id/people', ({ user, params }) => {
    const { page } = pageFor(user, params.id);
    return { people: pagePeople(page).map(({ user: u }) => ({ id: u.id, name: u.name, color: u.color })).sort((a, b) => a.name.localeCompare(b.name)) };
  });
  route('GET', '/api/workspaces/:id/people', ({ user, params }) => {
    requireRole(user, params.id);
    return { people: db.all('SELECT u.id, u.name, u.color FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name', params.id) };
  });

  // notifications
  route('GET', '/api/notifications', ({ user }) => ({
    notifications: db.all(`SELECT n.id, n.kind, n.workspace_id AS workspaceId, n.page_id AS pageId, n.thread_id AS threadId, n.text,
        n.created_at AS createdAt, n.read_at AS readAt, u.name AS actorName, u.color AS actorColor, p.title AS pageTitle, w.name AS workspaceName
      FROM notifications n LEFT JOIN users u ON u.id = n.actor_id LEFT JOIN pages p ON p.id = n.page_id LEFT JOIN workspaces w ON w.id = n.workspace_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 60`, user.id),
  }));
  route('POST', '/api/notifications/read', ({ user, body }) => {
    if (Array.isArray(body.ids)) for (const id of body.ids) db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', now(), Number(id), user.id);
    else db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), user.id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- people, teams & sharing
  route('GET', '/api/users', ({ query }) => {
    const q = `%${String(query.q || '').trim().toLowerCase()}%`;
    return { users: db.all('SELECT id, name, email, color FROM users WHERE lower(name) LIKE ? OR lower(email) LIKE ? ORDER BY name LIMIT 20', q, q) };
  });

  route('POST', '/api/workspaces/:id/members', ({ user, params, body }) => {
    const actorRole = requireRole(user, params.id, 'admin');
    const ws = db.get('SELECT * FROM workspaces WHERE id = ?', params.id);
    if (ws.kind === 'private') fail(400, 'Private spaces can’t have members. Share individual pages instead.');
    const target = userById(String(body.userId || ''));
    if (!target) fail(404, 'Person not found');
    const role = ROLES.includes(body.role) ? body.role : 'editor';
    const existing = roleIn(target.id, ws.id);
    if (!canAssignRole({ actorRole, targetRole: existing, nextRole: role })) {
      fail(403, existing === 'owner' || role === 'owner' ? 'Only owners can change ownership' : 'Only workspace admins can add members');
    }
    const ownerCount = db.get("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'", params.id).n;
    if (existing === 'owner' && role !== 'owner' && ownerCount < 2) fail(400, 'A workspace needs at least one owner');
    if (existing) db.run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, ws.id, target.id);
    else {
      db.run('INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', ws.id, target.id, role, now());
      notify([target.id], { kind: 'added', workspaceId: ws.id, actorId: user.id, text: `${user.name} added you to ${ws.name}` });
    }
    collab.kick(target.id, ws.id);
    sendTo([target.id], { type: 'workspace', workspaceId: ws.id });
    broadcast(ws.id, { type: 'members' });
    return { ok: true, role };
  });

  const nearestShares = (chain) => {
    const map = new Map();
    for (const p of chain) {
      for (const r of db.all('SELECT user_id, role FROM page_shares WHERE page_id = ?', p.id)) if (!map.has(r.user_id)) map.set(r.user_id, { role: r.role, pageId: p.id, title: p.title });
    }
    return map;
  };

  route('GET', '/api/pages/:id/access', ({ user, params }) => {
    const { page, role } = pageFor(user, params.id);
    const chain = chainOf(page);
    const ws = db.get('SELECT id, name, kind FROM workspaces WHERE id = ?', page.workspace_id);
    const restrictedBy = chain.find((p) => p.access === 'restricted');
    const shares = nearestShares(chain);
    const people = pagePeople(page).map(({ user: u, role: r }) => {
      const s = shares.get(u.id);
      const wsRole = roleIn(u.id, page.workspace_id);
      return {
        id: u.id, name: u.name, email: u.email, color: u.color, role: r,
        via: s ? 'share' : wsRole === 'owner' ? 'owner' : 'member',
        inheritedFrom: s && s.pageId !== page.id ? s.title : null,
        removable: !!s && s.pageId === page.id,
      };
    }).sort((a, b) => (RANK[b.role] - RANK[a.role]) || a.name.localeCompare(b.name));
    return {
      mode: page.access || 'workspace',
      restrictedBy: restrictedBy && restrictedBy.id !== page.id ? { id: restrictedBy.id, title: restrictedBy.title } : null,
      workspace: { id: ws.id, name: ws.name, kind: ws.kind, members: memberIds(ws.id).length },
      canManage: canManage(user.id, page, role),
      role,
      people,
    };
  });

  function requireManage(user, page) {
    if (!canManage(user.id, page)) fail(403, 'Only the page’s creator or a workspace owner/admin can change who has access');
  }
  const subtree = (page) => [page.id, ...descendants(page.id)];

  route('PUT', '/api/pages/:id/access', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id);
    requireManage(user, page);
    const ws = db.get('SELECT kind FROM workspaces WHERE id = ?', page.workspace_id);
    if (ws.kind === 'private') fail(400, 'Pages in your private space are already private. Share them with people instead.');
    const mode = body.mode === 'restricted' ? 'restricted' : 'workspace';
    db.run('UPDATE pages SET access = ? WHERE id = ?', mode, page.id);
    collab.reset(subtree(page));
    broadcast(page.workspace_id, { type: 'tree', actorId: user.id });
    return { ok: true, mode };
  });

  route('POST', '/api/pages/:id/shares', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id);
    requireManage(user, page);
    const target = userById(String(body.userId || ''));
    if (!target) fail(404, 'Person not found');
    if (target.id === user.id) fail(400, 'You already have access');
    const role = body.role === 'viewer' ? 'viewer' : 'editor';
    const existed = db.get('SELECT 1 AS x FROM page_shares WHERE page_id = ? AND user_id = ?', page.id, target.id);
    db.run('INSERT INTO page_shares (page_id, user_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(page_id, user_id) DO UPDATE SET role = excluded.role', page.id, target.id, role, user.id, now());
    if (!existed) notify([target.id], { kind: 'shared', workspaceId: page.workspace_id, pageId: page.id, actorId: user.id, text: `${user.name} shared “${page.title}” with you` });
    sendTo([target.id], { type: 'shared' });
    collab.reset(subtree(page));
    broadcast(page.workspace_id, { type: 'tree', actorId: user.id });
    return { ok: true };
  });

  route('PATCH', '/api/pages/:id/shares/:uid', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id);
    requireManage(user, page);
    db.run('UPDATE page_shares SET role = ? WHERE page_id = ? AND user_id = ?', body.role === 'viewer' ? 'viewer' : 'editor', page.id, params.uid);
    collab.reset(subtree(page));
    sendTo([params.uid], { type: 'shared' });
    return { ok: true };
  });

  route('DELETE', '/api/pages/:id/shares/:uid', ({ user, params }) => {
    const { page } = pageFor(user, params.id);
    if (params.uid !== user.id) requireManage(user, page);
    db.run('DELETE FROM page_shares WHERE page_id = ? AND user_id = ?', page.id, params.uid);
    collab.reset(subtree(page));
    sendTo([params.uid], { type: 'shared' });
    broadcast(page.workspace_id, { type: 'tree', actorId: user.id });
    return { ok: true };
  });

  // Pages shared with this person that they don't already see through their own workspaces.
  function sharedWithMe(user) {
    const out = new Map();
    const rows = db.all('SELECT s.page_id, s.created_by FROM page_shares s JOIN pages p ON p.id = s.page_id WHERE s.user_id = ? AND p.deleted_at IS NULL ORDER BY s.created_at DESC', user.id);
    for (const r of rows) {
      const root = pageById(r.page_id);
      if (roleIn(user.id, root.workspace_id)) continue; // already in their sidebar under that workspace
      const walk = (p, isRoot) => {
        if (out.has(p.id)) return;
        const role = accessFor(user.id, p);
        if (!role) return;
        out.set(p.id, { page: p, role, root: isRoot, sharedBy: r.created_by });
        for (const c of db.all('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position', p.id)) walk(c, false);
      };
      walk(root, true);
    }
    for (const v of out.values()) if (v.root && v.page.parent_id && out.has(v.page.parent_id)) v.root = false;
    return [...out.values()];
  }

  route('GET', '/api/shared', ({ user }) => ({
    pages: sharedWithMe(user).map((v) => ({
      ...pagePublic(v.page), role: v.role, root: v.root,
      workspaceName: db.get('SELECT name FROM workspaces WHERE id = ?', v.page.workspace_id)?.name,
      sharedBy: userById(v.sharedBy)?.name || null,
    })),
  }));

  route('POST', '/api/pages/:id/move', ({ user, params, body }) => {
    const { page } = pageFor(user, params.id, 'editor');
    const target = String(body.workspaceId || '');
    requireRole(user, target, 'editor');
    if (target === page.workspace_id) return { ok: true };
    const from = page.workspace_id;
    const ids = subtree(page);
    const pos = (db.get('SELECT MAX(position) AS m FROM pages WHERE workspace_id = ? AND parent_id IS NULL', target)?.m ?? 0) + 1;
    db.tx(() => {
      for (const id of ids) db.run('UPDATE pages SET workspace_id = ?, updated_at = ? WHERE id = ?', target, now(), id);
      db.run('UPDATE pages SET parent_id = NULL, position = ? WHERE id = ?', pos, page.id);
    });
    mirrorTree(page.id);
    collab.reset(ids);
    broadcast(from, { type: 'tree', actorId: user.id, deleted: ids });
    broadcast(target, { type: 'tree', actorId: user.id });
    return { ok: true, page: pagePublic(pageById(page.id)) };
  });

  route('GET', '/api/events', ({ user, res }) => { subscribe(user.id, res); return undefined; }, { stream: true });

  // ---------------------------------------------------------------- AI (admin picks the provider; members use it)
  const aiSettings = () => { try { return JSON.parse(db.get("SELECT value FROM settings WHERE key = 'ai'")?.value || '{}'); } catch { return {}; } };
  const saveAISettings = (v) => db.run("INSERT INTO settings (key, value) VALUES ('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(v));
  const requireAdmin = (user) => { if (!user.is_admin) fail(403, 'Only the server admin can change AI settings'); };
  const override = (b = {}) => Object.fromEntries(['provider', 'apiKey', 'baseUrl', 'model'].filter((k) => b[k]).map((k) => [k, b[k]]));
  const aiFail = (e) => fail(e.status || 502, e.message);

  route('GET', '/api/ai/status', () => {
    const p = aiLib.publicSettings(aiSettings());
    return { enabled: p.enabled, provider: p.provider, model: p.model, label: p.providers.find((x) => x.id === p.provider)?.label || null };
  });
  route('GET', '/api/ai/settings', ({ user }) => { requireAdmin(user); return aiLib.publicSettings(aiSettings()); });
  route('PUT', '/api/ai/settings', ({ user, body }) => {
    requireAdmin(user);
    try { saveAISettings(aiLib.applySettings(aiSettings(), body)); } catch (e) { aiFail(e); }
    return aiLib.publicSettings(aiSettings());
  });
  route('POST', '/api/ai/models', async ({ user, body }) => {
    requireAdmin(user);
    try { return { models: await aiClient.listModels(aiSettings(), override(body)) }; } catch (e) { return aiFail(e); }
  });
  route('POST', '/api/ai/test', async ({ user, body }) => {
    requireAdmin(user);
    try { return { reply: await aiClient.test(aiSettings(), override(body)) }; } catch (e) { return aiFail(e); }
  });

  async function streamAI(res, start, head) {
    const ac = new AbortController();
    let iterator;
    try { iterator = start(ac.signal); } catch (e) { return aiFail(e); }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    if (head) res.write(`${JSON.stringify(head)}\n`);
    try {
      for await (const t of iterator) res.write(`${JSON.stringify({ delta: t })}\n`);
      res.write('{"done":true}\n');
    } catch (e) {
      if (e.name !== 'AbortError') res.write(`${JSON.stringify({ error: e.message || 'The AI request failed' })}\n`);
    }
    res.end();
    return undefined;
  }
  const aiAllowed = (user) => { if (!rateLimit(`ai:${user.id}`, config.aiRate, 10 * 60 * 1000)) fail(429, 'You’ve reached the AI limit for now. Try again in a few minutes.'); };

  route('POST', '/api/ai/complete', ({ user, body, res }) => {
    aiAllowed(user);
    return streamAI(res, (signal) => aiClient.stream(aiSettings(), {
      system: String(body.system || ''), messages: [{ role: 'user', content: String(body.prompt || '').slice(0, 400000) }],
      effort: ['low', 'medium', 'high'].includes(body.effort) ? body.effort : 'low', maxTokens: 16000, signal,
    }));
  }, { stream: true });

  route('POST', '/api/ai/ask', ({ user, body, res }) => {
    aiAllowed(user);
    // only pages from workspaces this person belongs to (their private space included)
    const docs = [];
    for (const w of db.all('SELECT workspace_id AS id FROM members WHERE user_id = ?', user.id)) {
      for (const v of visiblePages(user.id, w.id)) docs.push({ id: v.page.id, title: v.page.title, text: v.page.markdown, updatedAt: v.page.updated_at });
    }
    for (const sp of sharedWithMe(user)) docs.push({ id: sp.page.id, title: sp.page.title, text: sp.page.markdown, updatedAt: sp.page.updated_at });
    docs.sort((a, b) => b.updatedAt - a.updatedAt).splice(3000);
    const picked = aiLib.pickNotes(String(body.question || ''), docs, { currentId: body.currentPath || null });
    const history = (Array.isArray(body.history) ? body.history : []).slice(-8).filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string');
    return streamAI(res, (signal) => aiClient.stream(aiSettings(), {
      ...aiLib.askPrompt(picked, config.name), messages: [...history, { role: 'user', content: String(body.question || '') }], effort: 'medium', maxTokens: 16000, signal,
    }), { sources: picked.map((p) => ({ id: p.id, title: p.title })) });
  }, { stream: true });

  // ---------------------------------------------------------------- dispatch
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') body = await readJson(req);
      const user = r.opts.public ? authUser(req, { optional: true }) : authUser(req);
      const out = await r.handler({ req, res, user, params, body, query: Object.fromEntries(url.searchParams) });
      if (r.opts.stream) return true;
      if (out && out.__download) {
        const asciiName = out.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
        res.writeHead(200, {
          'Content-Type': out.mime,
          'Content-Length': out.buffer.length,
          'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(out.buffer);
        return true;
      }
      json(res, 200, out);
      return true;
    }
    return false;
  }

  return { handle, userForToken, roleIn, pageRole, mirror, broadcast, db };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? {}));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

const GETTING_STARTED = `This is your **private space**. Only you can see pages here.

> [!tip] Working with your team
> Team workspaces appear in the sidebar. Open one to edit pages together in real time — you'll see each other's cursors as you type.

- [ ] Write something just for you
- [ ] Open your team workspace and say hello
`;

const TEAM_HOME = `Welcome to your team's shared space. Everyone in this workspace can see and edit these pages together.

## Get going

- [ ] Invite teammates with **Share** in the top-right corner
- [ ] Create a page for your next project
- [ ] Select some text and press **Comment** to start a discussion
`;
