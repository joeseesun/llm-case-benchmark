'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../public/prompt-library.js'), 'utf8');

function loadLibrary() {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'prompt-library.js' });
  return context.window.CB_PROMPT_LIBRARY;
}

test('prompt library contains 36 complete, balanced, original-use cases', () => {
  const library = loadLibrary();
  assert.equal(Array.isArray(library), true);
  assert.equal(library.length, 36);
  assert.equal(new Set(library.map((item) => item.id)).size, library.length);

  const categoryCounts = new Map();
  library.forEach((item) => {
    assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(item.title.trim());
    assert.ok(item.category.trim());
    assert.ok(item.summary.trim());
    assert.ok(item.prompt.trim().length >= 40);
    assert.ok(Array.isArray(item.tags) && item.tags.length >= 2);
    assert.ok(['text', 'html'].includes(item.outputType));
    assert.ok(Array.isArray(item.inspiredBy) && item.inspiredBy.length >= 1);
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
  });

  assert.equal(categoryCounts.size, 9);
  categoryCounts.forEach((count) => assert.equal(count, 4));
  assert.ok(library.some((item) => item.outputType === 'html'));
  assert.ok(library.some((item) => item.outputType === 'text'));
});
