const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
const adminSource = fs.readFileSync(path.resolve(__dirname, '../public/admin.js'), 'utf8');
const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

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
  const promptBoxStart = indexSource.indexOf('id="case-prompt-panel"');
  const editorStart = indexSource.indexOf('id="admin-prompt-editor"');
  const promptBoxEnd = indexSource.indexOf('id="rubric-details"', promptBoxStart);
  assert.ok(promptBoxStart >= 0 && editorStart > promptBoxStart && editorStart < promptBoxEnd);
  assert.doesNotMatch(indexSource, />管理员编辑</);
});

test('public case library loads only cases with published results', () => {
  const body = functionBody('loadCases');
  assert.match(body, /ready: state\.isAdmin \? 'all' : 'only'/);
  assert.match(body, /await loadPublishedRuns\(state\.activeId\)/);
});

test('published results load before relying on locally configured model slots', () => {
  const body = functionBody('renderCompare');
  assert.match(body, /const slots = displaySlots\(\)/);
  assert.match(body, /state\.publishedRun/);
  assert.match(indexSource, /id="snapshot-strip"/);
  assert.ok(indexSource.indexOf('id="case-title"') < indexSource.indexOf('id="case-prompt-panel"'));
  assert.ok(indexSource.indexOf('id="case-prompt-panel"') < indexSource.indexOf('id="snapshot-strip"'));
  assert.ok(indexSource.indexOf('id="snapshot-strip"') < indexSource.indexOf('id="compare"'));
  assert.doesNotMatch(indexSource, /id="prompt-details"/);
});

test('case prompt is always visible while scoring criteria remain secondary', () => {
  const panelStart = indexSource.indexOf('id="case-prompt-panel"');
  const promptStart = indexSource.indexOf('id="case-prompt"', panelStart);
  const rubricStart = indexSource.indexOf('<details class="rubric-disclosure', panelStart);
  assert.ok(panelStart >= 0 && promptStart > panelStart && rubricStart > promptStart);
  assert.doesNotMatch(indexSource.slice(panelStart, promptStart), /<details/);
  assert.match(functionBody('renderNoCaseStage'), /case-prompt-panel.*classList\.add\('hidden'\)/s);
  assert.match(functionBody('renderStage'), /case-prompt-panel.*classList\.remove\('hidden'\)/s);
});

test('administrator explicitly publishes a completed run', () => {
  const body = functionBody('publishLiveResults');
  assert.match(body, /\/api\/admin\/cases\/\$\{encodeURIComponent\(c\.id\)\}\/published-runs/);
  assert.match(indexSource, /id="modal-publish"/);
  assert.match(adminSource, /运行 \/ 发布/);
});

test('text output is never upgraded into executable HTML by content sniffing', () => {
  const infer = functionBody('inferOutputTypeFromText');
  const renderable = functionBody('renderableArtifact');
  const renderCompare = functionBody('renderCompare');
  assert.match(infer, /if \(explicit === 'html' \|\| explicit === 'text'\) return explicit/);
  assert.match(renderable, /if \(outputType !== 'html'\) return null/);
  assert.match(renderCompare, /const resultOutputType = published \? outputType/);
  assert.doesNotMatch(source, /r\.outputType === 'html' \|\| looksLikeHtml/);
});

test('published runs record effective request metadata and ignore stale case callbacks', () => {
  const buildPayload = functionBody('buildRunPayload');
  const runAll = functionBody('runAll');
  const rerun = functionBody('rerunSlot');
  const publish = functionBody('publishLiveResults');
  assert.match(buildPayload, /effectiveRunSystem\(system, outputType\)/);
  assert.match(runAll, /slots\.map\(\(slot\) => runSlotSnapshot\(slot, requestContext\)\)/);
  assert.match(runAll, /system: effectiveRunSystem\(baseSystem, outputType\)/);
  assert.match(runAll, /if \(!isCurrentCaseRun\(runToken, c\.id\)\) return/);
  assert.match(runAll, /results: runResults/);
  assert.match(rerun, /caseRunToken = beginCaseRun\(caseId\)/);
  assert.match(rerun, /if \(!isCurrentCaseRun\(caseRunToken, caseId\)\) return/);
  assert.match(publish, /system: state\.liveRunContext\.system/);
});

test('public HTML previews use a narrow network allowlist', () => {
  const body = functionBody('applyPreviewCsp');
  assert.match(body, /connect-src 'none'/);
  assert.match(body, /script-src 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com/);
  assert.doesNotMatch(body, /img-src[^;]*https:/);
  assert.doesNotMatch(body, /script-src[^;]* https:;/);
});

test('login rate limits trust only loopback proxy chains and use the last forwarded address', () => {
  const start = serverSource.indexOf('function clientIp(');
  const end = serverSource.indexOf('\nfunction ipHash(', start);
  const body = serverSource.slice(start, end);
  assert.match(body, /fromLoopback/);
  assert.match(body, /\.at\(-1\)/);
  assert.doesNotMatch(body, /split\(','\)\[0\]/);
});

test('unreviewed community and run-history HTML is source-only', () => {
  const contribution = functionBody('showContribution');
  const history = functionBody('renderHistoryDetail');
  assert.match(contribution, /社区贡献未经管理员审核/);
  assert.match(history, /普通运行历史未经发布审核/);
  assert.doesNotMatch(contribution, /<iframe/);
  assert.doesNotMatch(history, /<iframe/);
});
