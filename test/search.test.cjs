'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SearchIndex } = require('../shared/search-index.cjs');

const docs = [
  { id: 'garden', title: 'A garden in autumn', body: 'The garden is full of seed heads. The beds are resting.', updatedAt: 5 },
  { id: 'garden-notes', title: 'Garden notes', body: 'A practical list of jobs for the garden in autumn.', updatedAt: 3 },
  { id: 'cooking', title: 'Cooking with apples', body: 'An apple cake for a cold afternoon. Use the tart apples from the garden.', updatedAt: 4 },
  { id: 'archive', title: 'Old gardening book', body: 'A scanned notebook about vegetables and soil.', updatedAt: 1 },
];

function index() {
  const idx = new SearchIndex();
  idx.refresh(docs);
  return idx;
}

test('finds title and body matches and ranks title matches first', () => {
  const results = index().search('garden');
  assert.deepEqual(new Set(results.slice(0, 2).map((r) => r.id)), new Set(['garden', 'garden-notes']));
  assert.ok(results.some((r) => r.id === 'cooking'));
});

test('supports incremental prefixes', () => {
  const results = index().search('gard');
  assert.ok(results.length >= 2);
  assert.ok(['garden', 'garden-notes'].includes(results[0].id));
});

test('tolerates a single typo in longer terms', () => {
  const results = index().search('gardne');
  assert.ok(results.some((r) => r.id === 'garden'), JSON.stringify(results));
});

test('keeps phrases ahead of scattered terms', () => {
  const idx = index();
  idx.upsert({ id: 'phrase', title: 'Garden in autumn', body: 'A short note.', updatedAt: 10 });
  idx.upsert({ id: 'scatter', title: 'Autumn observations', body: 'The garden gate, the in-between weeks, a long autumn.', updatedAt: 11 });
  const results = idx.search('garden in autumn');
  assert.equal(results[0].id, 'phrase');
});

test('filters by an allowed set without leaking other documents', () => {
  const results = index().search('garden', { allowed: new Set(['cooking']) });
  assert.deepEqual(results.map((r) => r.id), ['cooking']);
});

test('updates and removes documents without stale vocabulary', () => {
  const idx = index();
  idx.upsert({ id: 'garden', title: 'A garden in winter', body: 'Bare branches.', updatedAt: 20 });
  assert.equal(idx.search('autumn').some((r) => r.id === 'garden'), false);
  assert.equal(idx.search('winter').some((r) => r.id === 'garden'), true);
  idx.remove('garden');
  assert.equal(idx.search('winter').length, 0);
});

test('returns an empty result for punctuation-only queries', () => {
  assert.deepEqual(index().search('… !!!'), []);
});

test('stays responsive on a larger collection', () => {
  const idx = new SearchIndex();
  const many = Array.from({ length: 2500 }, (_, i) => ({
    id: `n${i}`,
    title: `Project note ${i}`,
    body: `This is a note about ${i % 7 === 0 ? 'gardening' : 'writing'} and the work of the day.`,
    updatedAt: i,
  }));
  const started = Date.now();
  idx.refresh(many);
  const results = idx.search('garden');
  assert.ok(results.length > 0);
  assert.ok(Date.now() - started < 5000);
});
