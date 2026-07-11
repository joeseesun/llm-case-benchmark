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

test('prompt library Chinese is unambiguous and free of translation-shaped wording', () => {
  const library = loadLibrary();
  const byId = new Map(library.map((item) => [item.id, item]));
  assert.equal(byId.get('reasoning-coffee-cause').title, '换音乐让销量涨了 42% 吗');
  assert.match(byId.get('instruction-table-total').prompt, /除表头和分隔线外，必须恰好有 4 行数据/);
  assert.match(byId.get('code-csv-line').prompt, /闭合引号后只能是逗号或行尾/);
  assert.match(byId.get('data-weighted-ranking').prompt, /模型 B[^；]*成本 75/);
  assert.match(byId.get('data-calendar-ics').prompt, /SUMMARY 分别为“例会”和“发布复盘”/);
  assert.match(byId.get('data-contact-dedupe').prompt, /按 email 升序排列/);
  const prose = library.map((item) => `${item.title}\n${item.summary}\n${item.prompt}`).join('\n');
  assert.doesNotMatch(prose, /有机数据|双端布局|standalone SVG|自定义胜利层|keys 固定/);
});
