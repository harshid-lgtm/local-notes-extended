'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { SearchIndex } = require('../shared/search-index.cjs');

const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Keeps a SearchIndex warm for one vault. Files are only re-read when their
 * size or mtime changes, so typing in the palette does not touch every file.
 */
class VaultSearch {
  constructor() {
    this.index = new SearchIndex();
    this.versions = new Map();
    this.ready = Promise.resolve();
    this.root = null;
  }

  reset(root) {
    this.index = new SearchIndex();
    this.versions.clear();
    this.root = root || null;
  }

  async warm(vault, notes) {
    if (this.root !== vault) this.reset(vault);
    const docs = [];
    for (const note of notes) {
      const full = path.join(vault, note.path);
      const version = `${note.mtime}:${note.size || 0}`;
      const cached = this.versions.get(note.path);
      if (cached && cached.version === version) {
        docs.push(cached.doc);
        continue;
      }
      try {
        const stat = await fsp.stat(full);
        if (stat.size > MAX_FILE_BYTES) {
          docs.push({ id: note.path, title: note.name, body: '', updatedAt: note.mtime, version });
          this.versions.set(note.path, { version, doc: docs[docs.length - 1] });
          continue;
        }
        const raw = await fsp.readFile(full, 'utf8');
        const body = raw.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
        const heading = body.match(/^#\s+(.+?)\s*$/m)?.[1];
        const title = (heading || note.name).trim();
        const doc = {
          id: note.path,
          title,
          body,
          updatedAt: note.mtime,
          version,
          extra: { path: note.path },
        };
        this.versions.set(note.path, { version, doc });
        docs.push(doc);
      } catch {
        // A note can disappear between the tree walk and the read.
      }
    }
    this.index.refresh(docs);
    const present = new Set(docs.map((doc) => doc.id));
    for (const key of [...this.versions.keys()]) {
      if (!present.has(key)) this.versions.delete(key);
    }
  }

  search(query, notes, limit = 40) {
    const byPath = new Map(notes.map((note) => [note.path, note]));
    return this.index.search(query, { limit }).map((result) => {
      const note = byPath.get(result.id);
      return {
        path: result.id,
        title: note?.name || result.title,
        snippet: result.snippet,
        score: result.score,
        mtime: result.updatedAt,
      };
    });
  }

  async refresh(vault, notes, { background = false } = {}) {
    const work = this.warm(vault, notes);
    this.ready = work.catch(() => {});
    if (!background) await work;
    return work;
  }
}

module.exports = { VaultSearch };
