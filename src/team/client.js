// Team server connections: REST client + saved sign-ins.
import { store } from '../ui.js';

export function teamClient(conn, { onAuthLost } = {}) {
  const base = conn.url.replace(/\/+$/, '');
  async function req(method, path, body) {
    let r;
    try {
      r = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(conn.token ? { Authorization: `Bearer ${conn.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      const e = new Error('Can’t reach the team server. Check your connection.');
      e.offline = true;
      throw e;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.error || r.statusText);
      e.status = r.status;
      if (r.status === 401 && conn.token) onAuthLost?.();
      throw e;
    }
    return j;
  }
  return {
    base,
    wsUrl: `${base.replace(/^http/, 'ws')}/collab`,
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    patch: (p, b) => req('PATCH', p, b),
    del: (p) => req('DELETE', p),
    async download(p, b = {}) {
      let r;
      try {
        r = await fetch(base + p, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(conn.token ? { Authorization: `Bearer ${conn.token}` } : {}) },
          body: JSON.stringify(b),
        });
      } catch {
        const e = new Error('Can’t reach the team server. Check your connection.');
        e.offline = true;
        throw e;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const e = new Error(j.error || r.statusText);
        e.status = r.status;
        if (r.status === 401 && conn.token) onAuthLost?.();
        throw e;
      }
      const disposition = r.headers.get('Content-Disposition') || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      let filename = '';
      try { filename = encoded ? decodeURIComponent(encoded[1]) : ''; } catch { filename = ''; }
      if (!filename) {
        const plain = disposition.match(/filename="([^"]+)"/i);
        filename = plain ? plain[1] : 'export';
      }
      return { blob: await r.blob(), filename };
    },
  };
}

export const normalizeUrl = (u) => {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) {
    const host = s.replace(/^\/\//, '').split(/[/:]/)[0];
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(host) || /\.local$/i.test(host);
    s = `${local ? 'http' : 'https'}://${s}`;
  }
  return s;
};

// Saved sign-ins: desktop keeps a list (one per server); the hosted web app keeps one.
export const savedTeams = () => store.get('ln:teams', []);
export function saveTeam(conn) {
  const list = savedTeams().filter((c) => c.url !== conn.url);
  store.set('ln:teams', [conn, ...list].slice(0, 8));
}
export function forgetTeam(url) {
  store.set('ln:teams', savedTeams().filter((c) => c.url !== url));
}
