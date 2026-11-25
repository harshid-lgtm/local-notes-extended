'use strict';

// A small, dependency-free full-text index used by the local vault server and the
// team server. It is deliberately plain JavaScript so the same ranking and typo
// behaviour can be reused by the mobile web client later if needed.

const K1 = 1.25;
const B = 0.72;
const MAX_BODY_CHARS = 120000;
const MAX_PREFIX_SCAN = 80000;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have',
  'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of',
  'on', 'or', 'our', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
  'will', 'with', 'you', 'your',
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokensOf(value) {
  return normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function meaningfulTokens(value) {
  return tokensOf(value).filter((token) => token.length > 1 || /[\u3400-\u9fff]/.test(token));
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (i === a.length) return true;
    // A single substitution.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    // A single adjacent transposition ("gardne" → "garden").
    return i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  return a.slice(i) === b.slice(i + 1);
}

function stripMarkdownSnippet(text) {
  return String(text || '')
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class SearchIndex {
  constructor({ maxBodyChars = MAX_BODY_CHARS } = {}) {
    this.docs = new Map();
    this.postings = new Map();
    this.titlePostings = new Map();
    this.vocab = new Set();
    this.totalLength = 0;
    this.maxBodyChars = maxBodyChars;
  }

  get size() {
    return this.docs.size;
  }

  _addPosting(map, token, id, count) {
    let posting = map.get(token);
    if (!posting) {
      posting = new Map();
      map.set(token, posting);
    }
    posting.set(id, count);
  }

  _removePosting(map, token, id) {
    const posting = map.get(token);
    if (!posting) return;
    posting.delete(id);
    if (!posting.size) map.delete(token);
  }

  _removeFromIndex(id, doc) {
    for (const token of new Set(doc.tokens)) this._removePosting(this.postings, token, id);
    for (const token of new Set(doc.titleTokens)) this._removePosting(this.titlePostings, token, id);
    for (const token of new Set([...doc.tokens, ...doc.titleTokens])) {
      if (!this.postings.has(token) && !this.titlePostings.has(token)) this.vocab.delete(token);
    }
    this.totalLength -= doc.length;
  }

  upsert(input) {
    const id = String(input.id);
    const previous = this.docs.get(id);
    if (previous) this._removeFromIndex(id, previous);
    const title = String(input.title || input.name || 'Untitled').replace(/\.md$/i, '');
    const body = String(input.body ?? input.text ?? '').slice(0, this.maxBodyChars);
    const normalizedTitle = normalize(title);
    const normalizedBody = normalize(body);
    const titleTokens = meaningfulTokens(title);
    const bodyTokens = meaningfulTokens(body);
    const tokens = [...titleTokens, ...bodyTokens];
    const counts = new Map();
    for (const token of bodyTokens) counts.set(token, (counts.get(token) || 0) + 1);
    const titleCounts = new Map();
    for (const token of titleTokens) titleCounts.set(token, (titleCounts.get(token) || 0) + 1);
    const doc = {
      id,
      title,
      body,
      normalizedTitle,
      normalizedBody,
      titleTokens,
      tokens,
      counts,
      titleCounts,
      length: Math.max(1, bodyTokens.length),
      updatedAt: Number(input.updatedAt || input.mtime || 0),
      version: input.version ?? input.updatedAt ?? input.mtime ?? '',
      extra: input.extra || null,
    };
    this.docs.set(id, doc);
    for (const [token, count] of counts) {
      this._addPosting(this.postings, token, id, count);
      this.vocab.add(token);
    }
    for (const [token, count] of titleCounts) {
      this._addPosting(this.titlePostings, token, id, count);
      this.vocab.add(token);
    }
    this.totalLength += doc.length;
    return doc;
  }

  remove(id) {
    const doc = this.docs.get(String(id));
    if (!doc) return false;
    this._removeFromIndex(doc.id, doc);
    this.docs.delete(doc.id);
    return true;
  }

  refresh(inputs) {
    const seen = new Set();
    let changed = 0;
    for (const input of inputs) {
      const id = String(input.id);
      seen.add(id);
      const existing = this.docs.get(id);
      const version = input.version ?? input.updatedAt ?? input.mtime ?? '';
      if (!existing || String(existing.version) !== String(version)) {
        this.upsert(input);
        changed += 1;
      }
    }
    for (const id of [...this.docs.keys()]) {
      if (!seen.has(id)) {
        this.remove(id);
        changed += 1;
      }
    }
    return changed;
  }

  _prefixes(token, limit = MAX_PREFIX_SCAN) {
    const out = [];
    if (!token) return out;
    let checked = 0;
    for (const candidate of this.vocab) {
      checked += 1;
      if (checked > limit) break;
      if (candidate !== token && candidate.startsWith(token)) out.push(candidate);
    }
    return out;
  }

  _fuzzy(token) {
    if (token.length < 4) return [];
    const out = [];
    let checked = 0;
    for (const candidate of this.vocab) {
      checked += 1;
      if (checked > 30000) break;
      if (candidate === token) continue;
      if (candidate.length < token.length - 1 || candidate.length > token.length + 1) continue;
      if (editDistanceAtMostOne(token, candidate)) out.push(candidate);
      if (out.length >= 12) break;
    }
    return out;
  }

  _snippet(doc, queryTokens) {
    const raw = doc.body;
    for (const token of queryTokens) {
      const match = raw.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      if (!match || match.index == null) continue;
      const start = Math.max(0, match.index - 90);
      const end = Math.min(raw.length, match.index + token.length + 150);
      let snippet = stripMarkdownSnippet(raw.slice(start, end));
      if (start > 0) snippet = `…${snippet}`;
      if (end < raw.length) snippet = `${snippet}…`;
      return snippet;
    }
    return stripMarkdownSnippet(raw).slice(0, 220);
  }

  search(rawQuery, { limit = 30, allowed = null, fuzzy = true } = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) return [];
    const queryTokens = meaningfulTokens(query);
    if (!queryTokens.length) return [];
    const allowedSet = allowed ? (allowed instanceof Set ? allowed : new Set(allowed)) : null;
    const queryNorm = normalize(query);
    const terms = new Map();

    for (const token of queryTokens) {
      const term = terms.get(token) || { candidates: new Map([[token, 1]]) };
      term.candidates.set(token, 1);
      for (const prefix of this._prefixes(token)) {
        term.candidates.set(prefix, Math.max(term.candidates.get(prefix) || 0, 0.62));
      }
      if (fuzzy) {
        const exactCount = this.postings.get(token)?.size || 0;
        if (exactCount < 3) {
          for (const variant of this._fuzzy(token)) {
            term.candidates.set(variant, Math.max(term.candidates.get(variant) || 0, 0.48));
          }
        }
      }
      terms.set(token, term);
    }

    const scores = new Map();
    const vocabularySize = Math.max(1, this.vocab.size);
    const avgLength = Math.max(1, this.totalLength / Math.max(1, this.docs.size));

    for (const [queryToken, term] of terms) {
      const postings = new Map();
      const titlePostings = new Map();
      for (const [candidate, weight] of term.candidates) {
        for (const [id, count] of this.postings.get(candidate) || []) {
          postings.set(id, (postings.get(id) || 0) + count * weight);
        }
        for (const [id, count] of this.titlePostings.get(candidate) || []) {
          titlePostings.set(id, (titlePostings.get(id) || 0) + count * weight);
        }
      }
      const df = new Set([...postings.keys(), ...titlePostings.keys()]).size;
      const idf = Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
      for (const [id, tf] of postings) {
        if (allowedSet && !allowedSet.has(id)) continue;
        const doc = this.docs.get(id);
        if (!doc) continue;
        const denom = tf + K1 * (1 - B + (B * doc.length) / avgLength);
        const score = idf * ((tf * (K1 + 1)) / denom);
        scores.set(id, (scores.get(id) || 0) + score);
      }
      for (const [id, tf] of titlePostings) {
        if (allowedSet && !allowedSet.has(id)) continue;
        const doc = this.docs.get(id);
        if (!doc) continue;
        const score = (idf * 2.1 + 3.4) * (1 + Math.log1p(tf));
        scores.set(id, (scores.get(id) || 0) + score);
      }
    }

    const results = [];
    for (const [id, score] of scores) {
      const doc = this.docs.get(id);
      if (!doc) continue;
      let finalScore = score;
      if (doc.normalizedTitle === queryNorm) finalScore += 40;
      else if (doc.normalizedTitle.startsWith(queryNorm)) finalScore += 12;
      else if (doc.normalizedTitle.includes(queryNorm)) finalScore += 6;
      if (doc.normalizedBody.includes(queryNorm)) finalScore += 4;
      const ageDays = doc.updatedAt ? Math.max(0, (Date.now() - doc.updatedAt) / 86400000) : 999;
      if (ageDays < 7) finalScore += 1.5;
      results.push({
        id,
        title: doc.title,
        snippet: this._snippet(doc, queryTokens),
        score: Math.round(finalScore * 1000) / 1000,
        updatedAt: doc.updatedAt,
        ...(doc.extra ? { extra: doc.extra } : {}),
      });
    }
    results.sort((a, b) => b.score - a.score || (b.updatedAt || 0) - (a.updatedAt || 0) || a.title.localeCompare(b.title));
    return results.slice(0, Math.max(1, Math.min(100, limit)));
  }
}

module.exports = { SearchIndex, tokenize: tokensOf, normalize };
