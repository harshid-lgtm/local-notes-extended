async function req(method, url, body, opts = {}) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || r.statusText);
    err.status = r.status;
    throw err;
  }
  return data;
}

const q = (o) => new URLSearchParams(o).toString();

export const api = {
  state: () => req('GET', '/api/state'),
  setVault: (path) => req('POST', '/api/vault', { path }),
  closeVault: () => req('POST', '/api/vault/close', {}),
  browse: (path) => req('GET', `/api/browse?${q(path ? { path } : {})}`),
  tree: () => req('GET', '/api/tree'),
  note: (path) => req('GET', `/api/note?${q({ path })}`),
  filePreview: (path) => req('GET', `/api/file/preview?${q({ path })}`),
  importFiles: (files, folder = 'Imports') => req('POST', '/api/file/import', { files, folder }),
  importPaths: (paths, folder = 'Imports') => req('POST', '/api/file/import-path', { paths, folder }),
  importUrl: (url, folder = 'Imports') => req('POST', '/api/file/import-url', { url, folder }),
  stat: (path) => req('GET', `/api/stat?${q({ path })}`),
  save: (path, content, keepalive = false) => req('PUT', '/api/note', { path, content }, { keepalive }),
  create: (folder, name, content = '') => req('POST', '/api/note/create', { folder, name, content }),
  createFolder: (parent, name) => req('POST', '/api/folder/create', { parent, name }),
  rename: (from, to) => req('POST', '/api/rename', { from, to }),
  remove: (path) => req('POST', '/api/delete', { path }),
  search: (qstr) => req('GET', `/api/search?${q({ q: qstr })}`),
  links: (path) => req('GET', `/api/links?${q({ path })}`),
  graph: () => req('GET', '/api/graph'),
  templates: () => req('GET', '/api/templates'),
  installTemplates: () => req('POST', '/api/templates/install', {}),
  daily: () => req('GET', '/api/daily'),
  createVault: (parent, name) => req('POST', '/api/vault/create', { parent, name }),
  forgetVault: (path) => req('POST', '/api/vault/forget', { path }),
  fileUrl: (path) => `/api/file?${q({ path })}`,
  exportNote: async (path, format) => {
    const r = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, format }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      const err = new Error(data.error || r.statusText);
      err.status = r.status;
      throw err;
    }
    const disposition = r.headers.get('Content-Disposition') || '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    let filename = '';
    try { filename = encoded ? decodeURIComponent(encoded[1]) : ''; } catch { filename = ''; }
    if (!filename) {
      const plain = disposition.match(/filename="([^"]+)"/i);
      filename = plain ? plain[1] : `note.${format}`;
    }
    return { blob: await r.blob(), filename };
  },
};
