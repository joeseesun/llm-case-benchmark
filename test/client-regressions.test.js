const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
const adminSource = fs.readFileSync(path.resolve(__dirname, '../public/admin.js'), 'utf8');
const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf8');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const tail = source.slice(start + 10);
  const next = /\n  (?:async )?function [A-Za-z_$]/.exec(tail);
  const end = next ? start + 10 + next.index : source.length;
  return source.slice(start, end);
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
  const renderCard = functionBody('renderCaseResultCard');
  assert.match(infer, /if \(explicit === 'html' \|\| explicit === 'text'\) return explicit/);
  assert.match(renderable, /if \(outputType !== 'html'\) return null/);
  assert.match(renderCard, /const resultOutputType = published \? outputType/);
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
  assert.match(rerun, /caseRunToken = joinedCaseRun \? state\.caseRunToken : beginCaseRun\(caseId\)/);
  assert.match(rerun, /isCurrentCaseSlotRun\(slotKey, caseSlotRunToken, caseRunToken, caseId\)/);
  assert.match(publish, /system: state\.liveRunContext\.system/);
});

test('public HTML previews use a narrow network allowlist', () => {
  const body = functionBody('applyPreviewCsp');
  assert.match(body, /connect-src 'none'/);
  assert.match(body, /script-src 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com/);
  assert.doesNotMatch(body, /img-src[^;]*https:/);
  assert.doesNotMatch(body, /script-src[^;]* https:;/);
});

test('fullscreen HTML previews receive keyboard focus without weakening isolation', () => {
  const fullscreen = functionBody('openFullscreen');
  const modal = functionBody('openModal');
  assert.match(fullscreen, /<iframe[^>]*tabindex="0"[^>]*>/);
  assert.match(fullscreen, /sandbox="allow-scripts"/);
  assert.match(fullscreen, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(fullscreen, /allow-same-origin|allow-popups|allow-modals|allow-forms/);
  assert.match(fullscreen, /openModal\('modal-preview-fs',\s*[^)]+\)/);
  assert.match(modal, /function openModal\(id,\s*initialFocus\s*=\s*null\)/);
  assert.match(modal, /initialFocus\s*&&\s*overlay\.contains\(initialFocus\)[\s\S]*\?\s*initialFocus[\s\S]*:\s*overlay\.querySelector/);
});

test('result cards bound long output without truncating the generated content', () => {
  const cardRule = /\n\.col\s*\{([^}]*)\}/.exec(stylesSource)?.[1] || '';
  const bodyRule = /\n\.col-body\s*\{([^}]*)\}/.exec(stylesSource)?.[1] || '';
  const renderSurface = functionBody('renderResultSurface');
  const renderRunning = functionBody('renderRunningBody');
  const renderError = functionBody('renderErrorBody');

  assert.match(stylesSource, /--result-card-max-height:\s*clamp\(/);
  assert.match(cardRule, /max-height:\s*var\(--result-card-max-height\)/);
  assert.match(bodyRule, /min-height:\s*0/);
  assert.match(bodyRule, /overflow:\s*auto/);
  assert.match(bodyRule, /scrollbar-gutter:\s*stable/);
  assert.doesNotMatch(bodyRule, /line-clamp|text-overflow/);
  assert.match(renderSurface, /class="col-body preview-body"/);
  assert.match(renderSurface, /escapeHtml\(artifact\.source\)/);
  assert.match(renderSurface, /escapeHtml\(content\)/);
  assert.match(renderSurface, /renderMarkdown\(content\)/);
  assert.match(renderRunning, /escapeHtml\(content\)/);
  assert.match(renderError, /escapeHtml\(partial\)/);
  assert.doesNotMatch(renderSurface, /\.slice\(|\.substring\(|\.substr\(/);
  assert.doesNotMatch(renderRunning + renderError, /\.slice\(|\.substring\(|\.substr\(/);
});

test('failed live cards expose the correct per-source rerun action', () => {
  const control = functionBody('renderRerunButton');
  const caseCard = functionBody('renderCaseResultCard');
  const testCard = functionBody('renderTestResultCard');
  const caseError = /else if \(r\?\.status === 'error'\) \{([\s\S]*?)\n    \} else if \(r\?\.status === 'ok'\)/.exec(caseCard)?.[1] || '';
  const testError = /else if \(r\?\.status === 'error'\) \{([\s\S]*?)\n    \} else if \(r\?\.status === 'ok'\)/.exec(testCard)?.[1] || '';

  assert.match(control, /source === 'test' \? 'data-test-rerun' : 'data-rerun'/);
  assert.match(control, /if \(source === 'published'\) return ''/);
  assert.match(control, />重新运行<\/button>/);
  assert.match(caseError, /if \(!published\) tabs = renderErrorRerun\(m\.key, 'case'\)/);
  assert.match(testError, /tabs = renderErrorRerun\(m\.key, 'test'\)/);
  assert.match(source, /closest\('\[data-rerun\]'\)[\s\S]{0,220}rerunSlot\(rerun\.dataset\.rerun, 'case'\)/);
  assert.match(source, /closest\('\[data-test-rerun\]'\)[\s\S]{0,220}rerunSlot\(rerun\.dataset\.testRerun, 'test'\)/);
});

test('case card reruns join an active batch without invalidating sibling requests', () => {
  const beginSlot = functionBody('beginCaseSlotRun');
  const currentSlot = functionBody('isCurrentCaseSlotRun');
  const finishSlot = functionBody('finishCaseSlotRun');
  const runAll = functionBody('runAll');
  const rerun = functionBody('rerunSlot');

  assert.match(beginSlot, /caseSlotRunTokens\.set\(slotKey, token\)/);
  assert.match(currentSlot, /isCurrentCaseRun\(runToken, caseId\)/);
  assert.match(currentSlot, /caseSlotRunTokens\.get\(slotKey\) === slotToken/);
  assert.match(finishSlot, /caseSlotRunTokens\.delete\(slotKey\)/);
  assert.match(runAll, /slotRunTokens = new Map\(slots\.map/);
  assert.match(runAll, /isCurrentCaseSlotRun\(m\.key, slotRunToken, runToken, c\.id\)/);
  assert.match(runAll, /while \(isCurrentCaseRun\(runToken, c\.id\) && caseSlotRunTokens\.size\)/);
  assert.match(runAll, /requestSystem: baseSystem/);
  assert.doesNotMatch(rerun, /if \(!isTest && state\.running\)/);
  assert.match(rerun, /const activeRunContext = isCurrentCaseRun\(state\.caseRunToken, caseId\)/);
  assert.match(rerun, /prompt = activeRunContext\?\.prompt \|\| casePromptForRun\(c\)/);
  assert.match(rerun, /system = activeRunContext\?\.requestSystem \?\? c\.system \?\? ''/);
  assert.match(rerun, /caseResults = sameContext \? state\.results : \{\}/);
  assert.match(rerun, /joinedCaseRun = !!activeRunContext && sameContext/);
  assert.match(rerun, /caseRunToken = joinedCaseRun \? state\.caseRunToken : beginCaseRun\(caseId\)/);
  assert.match(rerun, /caseSlotRunToken = beginCaseSlotRun\(slotKey\)/);
  assert.match(rerun, /isCurrentCaseSlotRun\(slotKey, caseSlotRunToken, caseRunToken, caseId\)/);
});

test('free-compare batch waits for any per-card rerun before unlocking', () => {
  const begin = functionBody('beginTestSlotRun');
  const finish = functionBody('finishTestSlotRun');
  const wait = functionBody('waitForTestSlotsIdle');
  const runTest = functionBody('runPromptTest');
  const rerun = functionBody('rerunSlot');

  assert.match(begin, /state\.testRunning = true/);
  assert.match(finish, /state\.testRunning = testRunTokens\.size > 0/);
  assert.match(finish, /testRunIdleWaiters\.forEach\(\(resolve\) => resolve\(\)\)/);
  assert.match(wait, /if \(!testRunTokens\.size\) return Promise\.resolve\(\)/);
  assert.match(runTest, /while \(testRunTokens\.size\) \{[\s\S]*await waitForTestSlotsIdle\(\)/);
  assert.match(rerun, /testRunButton\.disabled = true/);
  assert.match(rerun, /if \(!state\.testRunning\) \{[\s\S]*testRunButton\.disabled = false/);
});

test('running result updates stay local to their source and slot', () => {
  const ticker = functionBody('startRunTicker');
  const queue = functionBody('queueResultRender');
  const updateCard = functionBody('updateResultCard');
  const runAll = functionBody('runAll');
  const rerun = functionBody('rerunSlot');
  const runTest = functionBody('runPromptTest');

  assert.match(queue, /function queueResultRender\(source,\s*slotKey\)/);
  assert.match(queue, /renderQueued\[source\]/);
  assert.match(queue, /queued\.has\(slotKey\)/);
  assert.match(queue, /queued\.add\(slotKey\)/);
  assert.match(queue, /queued\.delete\(slotKey\)/);
  assert.match(queue, /updateResultCard\(slotKey,\s*source\)/);
  assert.doesNotMatch(queue, /renderCompare\(|renderTestCompare\(/);
  assert.equal((updateCard.match(/card\.outerHTML\s*=/g) || []).length, 2);
  assert.doesNotMatch(updateCard, /box\.innerHTML\s*=|renderCompare\(|renderTestCompare\(/);
  assert.doesNotMatch(ticker, /renderCompare\(|renderTestCompare\(/);
  assert.match(ticker, /queueResultRender\('case',\s*slotKey\)/);
  assert.match(ticker, /queueResultRender\('test',\s*slotKey\)/);

  assert.match(runAll, /runResults\[m\.key\]\s*=\s*\{[^;]*\.\.\.patch[^;]*\};[\s\S]{0,160}queueResultRender\('case',\s*m\.key\)/);
  assert.match(runAll, /runResults\[m\.key\]\s*=\s*result;[\s\S]{0,160}queueResultRender\('case',\s*m\.key\)/);
  assert.doesNotMatch(runAll, /runResults\[m\.key\]\s*=\s*result;[\s\S]{0,160}renderCompare\(\)/);

  assert.match(rerun, /state\.testResults\[slotKey\]\s*=\s*\{[^;]*\.\.\.patch[^;]*\};[\s\S]{0,120}queueResultRender\('test',\s*slotKey\)/);
  assert.match(rerun, /caseResults\[slotKey\]\s*=\s*\{[^;]*\.\.\.patch[^;]*\};[\s\S]{0,160}queueResultRender\('case',\s*slotKey\)/);
  assert.match(rerun, /state\.testResults\[slotKey\]\s*=\s*\{\s*\.\.\.result,\s*outputType\s*\};[\s\S]{0,160}queueResultRender\('test',\s*slotKey\)/);
  assert.match(rerun, /caseResults\[slotKey\]\s*=\s*result;[\s\S]{0,360}queueResultRender\('case',\s*slotKey\)/);
  assert.doesNotMatch(rerun, /state\.testResults\[slotKey\]\s*=\s*result;[\s\S]{0,160}renderTestCompare\(\)/);
  assert.doesNotMatch(rerun, /caseResults\[slotKey\]\s*=\s*result;[\s\S]{0,260}renderCompare\(\)/);

  assert.match(runTest, /state\.testResults\[m\.key\]\s*=\s*\{[^;]*\.\.\.patch[^;]*\};[\s\S]{0,120}queueResultRender\('test',\s*m\.key\)/);
  assert.match(runTest, /const result\s*=\s*await requestSlotRun/);
  assert.match(runTest, /testRunTokens\.clear\(\)/);
  assert.match(runTest, /beginTestSlotRun\(m\.key\)/);
  assert.match(runTest, /isCurrentTestSlotRun\(m\.key,\s*testRunToken\)/);
  assert.match(runTest, /state\.testResults\[m\.key\]\s*=\s*\{\s*\.\.\.result,\s*outputType\s*\}/);
  assert.match(rerun, /testRunToken\s*=\s*beginTestSlotRun\(slotKey\)/);
  assert.match(rerun, /isCurrentTestSlotRun\(slotKey,\s*testRunToken\)/);
  assert.equal((runTest.match(/queueResultRender\('test',\s*m\.key\)/g) || []).length, 2);
  assert.doesNotMatch(runTest, /\}\);\s*renderTestCompare\(\)/);
});

test('free-compare results keep the output type captured by their own request', () => {
  const resolveType = functionBody('testResultOutputType');
  const renderCard = functionBody('renderTestResultCard');
  const fullscreen = functionBody('openFullscreen');
  const updateView = functionBody('updateCardView');
  const rows = functionBody('successfulTestRows');
  assert.match(resolveType, /row\?\.outputType === 'html' \|\| row\?\.outputType === 'text'/);
  assert.match(renderCard, /const outputType = testResultOutputType\(r\)/);
  assert.match(fullscreen, /\? testResultOutputType\(r\)/);
  assert.match(updateView, /\? testResultOutputType\(row\)/);
  assert.match(rows, /outputType: testResultOutputType\(r\)/);
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
