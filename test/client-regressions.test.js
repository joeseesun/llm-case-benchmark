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
  const policy = functionBody('previewCspPolicy');
  assert.match(body, /const policy = previewCspPolicy\(\)/);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /script-src 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com/);
  assert.doesNotMatch(policy, /img-src[^;]*https:/);
  assert.doesNotMatch(policy, /script-src[^;]* https:;/);
  assert.match(body, /new DOMParser\(\)\.parseFromString\(html, 'text\/html'\)/);
  assert.match(body, /doc\.head\.prepend\(meta\)/);
  assert.doesNotMatch(body, /replace\(\/<head|test\(html\)[\s\S]*<head/i);
});

test('fullscreen HTML previews receive keyboard focus without weakening isolation', () => {
  const fullscreen = functionBody('presentFullscreen');
  const iframe = functionBody('renderArtifactIframe');
  const modal = functionBody('openModal');
  assert.match(fullscreen, /renderArtifactIframe\(resolvedArtifact,\s*\{[^}]*focusable:\s*true/);
  assert.match(iframe, /sandbox="allow-scripts"/);
  assert.match(iframe, /referrerpolicy="no-referrer"/);
  assert.match(iframe, /focusable \? ' tabindex="0"'/);
  assert.doesNotMatch(iframe, /allow-same-origin|allow-popups|allow-modals|allow-forms/);
  assert.match(fullscreen, /openModal\('modal-preview-fs',\s*[^)]+\)/);
  assert.match(modal, /function openModal\(id,\s*initialFocus\s*=\s*null\)/);
  assert.match(modal, /initialFocus\s*&&\s*overlay\.contains\(initialFocus\)[\s\S]*\?\s*initialFocus[\s\S]*:\s*overlay\.querySelector/);
});

test('late-selected free-compare models expose a first-run action', () => {
  const card = functionBody('renderTestResultCard');
  const rerunButton = functionBody('renderRerunButton');
  const rerun = functionBody('rerunSlot');
  assert.match(card, /尚未运行/);
  assert.match(card, /renderRerunButton\(m\.key, 'test', false, '运行此模型'\)/);
  assert.match(rerunButton, /label = '重新运行'/);
  assert.match(rerunButton, /data-test-rerun/);
  assert.match(rerun, /const isFirstTestRun = isTest && !current/);
  assert.match(rerun, /isFirstTestRun \? '正在运行' : '正在重新运行'/);
  assert.match(rerun, /isFirstTestRun \? '已生成' : '已重新生成'/);
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
  assert.match(control, /label = '重新运行'/);
  assert.match(control, />\$\{escapeHtml\(label\)\}<\/button>/);
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

test('community and run-history cards share independent sandboxed preview surfaces', () => {
  const contribution = functionBody('showContribution');
  const history = functionBody('renderHistoryDetail');
  const card = functionBody('renderArchivedResultCard');
  const surface = functionBody('renderArchivedResultSurface');
  const switchView = functionBody('handleArchivedResultClick');
  const keyboard = functionBody('handleArchivedResultKeydown');
  const actions = functionBody('renderArchivedActions');
  const archivedFullscreen = functionBody('openArchivedFullscreen');
  const iframe = functionBody('renderArtifactIframe');

  assert.match(contribution, /renderArchivedResultCard\(r,\s*`contribution-result-\$\{index\}`,[\s\S]*textPreview:\s*'plain'/);
  assert.match(contribution, /--compare-cols[\s\S]*Math\.min\(3,\s*Math\.max\(1,/);
  assert.match(history, /renderArchivedResultCard\(r,\s*`history-result-\$\{index\}`,\s*\{/);
  assert.match(card, /row\?\.outputType === 'html' \? 'html' : 'text'/);
  assert.match(surface, /renderableArtifact\(content, outputType\)/);
  assert.match(surface, /!artifact && textPreview === 'plain'[\s\S]*escapeHtml\(content\)/);
  assert.match(surface, /data-archive-panel="preview"/);
  assert.match(surface, /data-archive-panel="source" hidden/);
  assert.match(surface, /role="tabpanel" aria-labelledby=/);
  assert.match(surface, /renderArtifactIframe\(artifact,[\s\S]*loading:\s*true/);
  assert.match(iframe, /loading \? ' loading="lazy"'/);
  assert.match(actions, /data-archive-fs/);
  assert.match(actions, /iconLinkAction\(\{ href: previewUrl/);
  assert.match(archivedFullscreen, /presentFullscreen\(/);
  assert.match(archivedFullscreen, /iframe\?\.srcdoc/);
  assert.match(switchView, /closest\('\[data-archive-card\]'\)/);
  assert.match(switchView, /panel\.hidden = panel\.dataset\.archivePanel !== mode/);
  assert.match(keyboard, /'ArrowLeft', 'ArrowRight', 'Home', 'End'/);
  assert.match(keyboard, /event\.preventDefault\(\)[\s\S]*next\.focus\(\)[\s\S]*next\.click\(\)/);
  assert.match(source, /#detail-compare'\)\.addEventListener\('keydown', handleArchivedResultKeydown\)/);
  assert.match(source, /#history-detail'\)\.addEventListener\('keydown', handleArchivedResultKeydown\)/);
  assert.doesNotMatch(contribution, /默认只展示源码/);
  assert.doesNotMatch(history, /默认只展示源码/);
});

test('persisted results use stable shareable preview paths and a sandboxed server shell', () => {
  const pathBuilder = functionBody('sharedPreviewPath');
  const caseCard = functionBody('renderCaseResultCard');
  const contribution = functionBody('showContribution');
  const history = functionBody('renderHistoryDetail');
  assert.match(pathBuilder, /\/preview\/case\//);
  assert.match(pathBuilder, /\/preview\/\$\{source\}\//);
  assert.match(caseCard, /sharedPreviewPath\('case'/);
  assert.match(caseCard, /iconLinkAction\(\{ href: previewUrl/);
  assert.match(contribution, /sharedPreviewPath\('contribution', c\.id, index\)/);
  assert.match(history, /sharedPreviewPath\('history', item\.id, index\)/);
  assert.match(serverSource, /app\.get\('\/preview\/case\/:caseId\/:version\/:index'/);
  assert.match(serverSource, /app\.get\('\/preview\/contribution\/:id\/:index'/);
  assert.match(serverSource, /app\.get\('\/preview\/history\/:id\/:index'/);
  assert.match(serverSource, /<iframe sandbox="\$\{artifact \? 'allow-scripts' : ''\}" referrerpolicy="no-referrer" srcdoc=/);
  assert.doesNotMatch(serverSource, /<iframe[^>]*allow-same-origin/);
});

test('nested preview dialogs hide the underlying contribution dialog from focus', () => {
  const sync = functionBody('syncModalStack');
  const open = functionBody('openModal');
  const close = functionBody('closeModal');
  assert.match(indexSource, /id="modal-detail"[^>]*aria-labelledby="detail-title"/);
  assert.match(indexSource, /id="modal-preview-fs"[^>]*aria-labelledby="fs-title"/);
  assert.match(sync, /\[\.\.\.document\.body\.children\]/);
  assert.match(sync, /topOverlay && element !== topOverlay/);
  assert.match(sync, /element\.setAttribute\('inert', ''\)/);
  assert.match(sync, /element\.removeAttribute\('inert'\)/);
  assert.match(sync, /element\.dataset\.modalInert/);
  assert.match(open, /syncModalStack\(\)/);
  assert.match(close, /syncModalStack\(\)/);
});

test('new-window HTML actions open an isolated rendered preview instead of top-level model code', () => {
  const wrapper = functionBody('openIsolatedPreviewDocument');
  const openResult = functionBody('openResultInNewWindow');
  const caseCard = functionBody('renderCaseResultCard');
  const testCard = functionBody('renderTestResultCard');
  const archiveClick = functionBody('handleArchivedResultClick');

  assert.match(openResult, /artifact \? artifact\.preview : renderTextPreviewDocument\(content\)/);
  assert.match(wrapper, /previewUrl = URL\.createObjectURL\(new Blob\(\[previewDocument\]/);
  assert.match(wrapper, /new Blob\(\[wrapper\]/);
  assert.match(wrapper, /wrapperCsp = previewCspPolicy\('blob:'\)/);
  assert.match(wrapper, /<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="\$\{escapeHtml\(previewUrl\)\}"/);
  assert.match(wrapper, /anchor\.target = '_blank'/);
  assert.match(wrapper, /anchor\.rel = 'noopener noreferrer'/);
  assert.match(wrapper, /URL\.revokeObjectURL\(url\)/);
  assert.match(wrapper, /URL\.revokeObjectURL\(previewUrl\)/);
  assert.doesNotMatch(wrapper, /srcdoc=/);
  assert.doesNotMatch(wrapper, /<script[\s>]/);
  assert.doesNotMatch(wrapper, /allow-same-origin|allow-popups|allow-modals|allow-forms/);
  assert.match(caseCard, /data-open-result/);
  assert.match(testCard, /data-test-open-result/);
  assert.match(caseCard, /新窗口打开预览/);
  assert.match(testCard, /新窗口打开预览/);
  assert.match(archiveClick, /openIsolatedPreviewDocument\(iframe\.srcdoc, title\)/);
  assert.doesNotMatch(source, /window\.open\('',\s*'_blank'\)|document\.write\(/);
});

test('free compare prompt library replaces prompt state without retaining stale results', () => {
  const openLibrary = functionBody('openPromptLibrary');
  const applyCase = functionBody('applyPromptLibraryCase');
  const renderLibrary = functionBody('renderPromptLibrary');
  assert.match(indexSource, /id="btn-prompt-library"[^>]*aria-label="打开测试案例库"/);
  assert.match(indexSource, /id="modal-prompt-library"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(indexSource, /id="prompt-library-count"[^>]*aria-live="polite"/);
  assert.doesNotMatch(indexSource, /id="prompt-library-list"[^>]*aria-live/);
  assert.ok(indexSource.indexOf('/providers.js') < indexSource.indexOf('/prompt-library.js'));
  assert.ok(indexSource.indexOf('/prompt-library.js') < indexSource.indexOf('/app.js'));
  assert.match(openLibrary, /openModal\('modal-prompt-library', search\)/);
  assert.match(applyCase, /if \(state\.testRunning\)/);
  assert.match(applyCase, /prompt\.value = item\.prompt/);
  assert.match(applyCase, /outputType\.value = item\.outputType === 'html' \? 'html' : 'text'/);
  assert.match(applyCase, /state\.testResults = \{\}/);
  assert.match(applyCase, /state\.testViewModes = \{\}/);
  assert.match(applyCase, /#test-run-status/);
  assert.match(renderLibrary, /escapeHtml\(item\.prompt\)/);
});

test('administrator record deletion uses authenticated routes and a custom confirmation dialog', () => {
  const history = functionBody('renderHistoryDetail');
  const openDelete = functionBody('openDeleteRecordDialog');
  const confirmDelete = functionBody('confirmDeleteRecord');
  assert.match(history, /state\.isAdmin[\s\S]*data-delete-history/);
  assert.match(indexSource, /id="btn-delete-contribution"/);
  assert.match(indexSource, /id="modal-delete-record"[^>]*role="dialog"/);
  assert.match(openDelete, /state\.pendingDelete = \{ kind, id, label \}/);
  assert.match(confirmDelete, /\/api\/admin\/contributions/);
  assert.match(confirmDelete, /\/api\/admin\/run-history/);
  assert.match(confirmDelete, /method: 'DELETE'/);
  assert.doesNotMatch(source, /\b(?:window\.)?confirm\s*\(/);
});

test('site quota excludes caller-owned keys and authenticated administrators', () => {
  assert.match(serverSource, /if \(target\?\.source !== 'site'\)[\s\S]*caller-key-exempt/);
  assert.match(serverSource, /if \(isAdminRequest\(req\)\)[\s\S]*admin-exempt/);
  assert.match(serverSource, /code: 'site_rate_limit'/);
  assert.match(serverSource, /res\.setHeader\('Retry-After'/);
  assert.match(serverSource, /async function assertSafeCustomBaseUrl/);
  assert.match(serverSource, /privateNetworkBlockList/);
  assert.match(serverSource, /new Agent\([\s\S]*lookup\(_hostname, options, callback\)/);
  assert.match(serverSource, /undiciFetch\(endpoint,[\s\S]*dispatcher: dispatcher \|\| undefined/);
  assert.match(serverSource, /await closeDispatcher\(customDispatcher\)/);
  assert.match(serverSource, /function acquireCustomRun/);
  assert.match(serverSource, /code: 'caller_concurrency_limit'/);
  assert.match(serverSource, /redirect: 'error'/);
  assert.doesNotMatch(serverSource, /调用过于频繁，请稍后再试/);
});
