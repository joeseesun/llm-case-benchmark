const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf('\n  function ', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

test('switching profiles refreshes the child-model list from that profile', () => {
  const body = functionBody('fillProfileForm');
  assert.match(body, /fillModelSelect\(availableModels, p\.selectedModels/);
});

test('switching provider presets cannot inherit another provider model list', () => {
  const body = functionBody('applyPresetToForm');
  assert.match(body, /selectedModels: preset\.defaultModel \? \[preset\.defaultModel\] : \[\]/);
  assert.match(body, /availableModels: Array\.isArray\(preset\.quickModels\)/);
});

test('history writes surface non-success HTTP responses', () => {
  const body = functionBody('recordCaseRunHistory');
  assert.match(body, /if \(!res\.ok\) throw new Error/);
  assert.match(body, /return \{ ok: false, error:/);
});

test('result identity keeps the configured model authoritative', () => {
  const plain = functionBody('requestSlotRunPlain');
  const stream = functionBody('requestSlotRunStream');
  assert.match(plain, /model: m\.model/);
  assert.match(stream, /model: m\.model/);
  assert.doesNotMatch(plain, /model: data\.model \|\| m\.model/);
});

test('administrator edits the original prompt panel in place', () => {
  const promptBoxStart = indexSource.indexOf('<div class="prompt-box">');
  const editorStart = indexSource.indexOf('id="admin-prompt-editor"');
  const promptBoxEnd = indexSource.indexOf('<div class="rubric"', promptBoxStart);
  assert.ok(promptBoxStart >= 0 && editorStart > promptBoxStart && editorStart < promptBoxEnd);
  assert.doesNotMatch(indexSource, />管理员编辑</);
});
