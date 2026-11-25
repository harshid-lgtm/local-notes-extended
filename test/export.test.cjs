'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const exportNote = require('../server/export');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP0yQtjYGBgYgADAAzgARQEHQQUAAAAAElFTkSuQmCC',
  'base64',
);

const markdown = `# Autumn notes

A short note about the **garden** and *slow mornings*.

## Things to do

- Rake the leaves
- Prune the apple tree

1. Make tea
2. Read a page

> A quiet house is not an empty one.

![A small green square](assets/pixel.png)

\`\`\`js
const hello = 'world';
\`\`\`

| Season | Work |
| --- | --- |
| Autumn | Rake |
| Winter | Prune |

[Read more](https://example.com)
`;

const readImage = async (src) => (src.endsWith('pixel.png') ? PNG : null);

for (const format of ['txt', 'html', 'docx', 'pdf', 'md']) {
  test(`exports ${format}`, async () => {
    const result = await exportNote({ title: 'Autumn notes', markdown, format, baseName: 'Autumn notes', readImage });
    assert.ok(result.buffer.length > 20);
    assert.equal(result.filename, `Autumn notes.${format}`);
    if (format === 'pdf') assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
    if (format === 'docx') assert.equal(result.buffer.subarray(0, 2).toString(), 'PK');
    if (format === 'html') {
      const html = result.buffer.toString('utf8');
      assert.match(html, /<h1>Autumn notes<\/h1>/);
      assert.match(html, /data:image\/png;base64/);
      assert.match(html, /Rake the leaves/);
    }
    if (format === 'txt') {
      const text = result.buffer.toString('utf8');
      assert.match(text, /Autumn notes/);
      assert.match(text, /Rake the leaves/);
    }
    if (format === 'md') assert.equal(result.buffer.toString('utf8'), markdown);
  });
}

test('rejects unknown formats with a 400', async () => {
  await assert.rejects(
    exportNote({ title: 'x', markdown: '', format: 'epub', readImage }),
    (error) => error.status === 400,
  );
});

test('sanitizes export filenames', async () => {
  const result = await exportNote({ title: 'A/B: C', markdown: 'hi', format: 'txt', baseName: 'A/B: C', readImage });
  assert.equal(result.filename, 'A B C.txt');
});
