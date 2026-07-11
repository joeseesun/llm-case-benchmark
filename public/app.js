/* 乔木 LLM 擂台 client v1.2 — qmreader-style local AI profiles */
(() => {
  'use strict';

  const STORAGE_KEY = 'case-benchmark:v1';
  const PROFILE_KEY = 'case-benchmark:ai-profiles';
  const PRESETS = window.CB_AI_PROVIDER_PRESETS || [];
  const PRESET_MAP = window.CB_AI_PROVIDER_MAP || {};
  const DEFAULT_PRESET = window.CB_DEFAULT_AI_PRESET_ID || 'deepseek';
  const PROMPT_LIBRARY = Array.isArray(window.CB_PROMPT_LIBRARY) ? window.CB_PROMPT_LIBRARY : [];
  const HTML_MIN_TOKENS = 8192;
  const HTML_OUTPUT_SYSTEM =
    '只输出一个可直接放进 iframe 预览的完整 HTML 或 SVG。不要解释、不要 Markdown、不要代码围栏。若用户要求 SVG 动画，优先输出一个完整 <svg ...>...</svg>，包含必要的 <style>、<animate> 或 <animateTransform>，必须闭合所有标签。';
  const STREAM_ENDPOINT = '/api/run-stream';
  const VIEW_PATHS = { cases: '/', test: '/compare', gallery: '/gallery', history: '/history', submit: '/submit' };

  const state = {
    cases: [],
    filter: 'all',
    difficulty: 'all',
    q: '',
    activeId: null,
    profiles: [],
    activeProfileId: '',
    siteModels: [],
    selectedSiteIds: new Set(),
    results: {},
    resultOrigin: 'published',
    resultSlots: [],
    liveSlots: [],
    liveRunContext: null,
    publishedRun: null,
    publishedHistory: [],
    publishedLoading: false,
    publishedError: '',
    publishedCaseId: '',
    scores: {},
    scoreOpen: new Set(),
    viewModes: {},
    testSelectedKeys: new Set(),
    testSelectionTouched: false,
    testResults: {},
    testViewModes: {},
    testRunning: false,
    testOutputType: 'text',
    contributionContext: 'case',
    view: 'cases',
    theme: 'light',
    running: false,
    caseRunToken: '',
    contributions: [],
    history: [],
    isAdmin: false,
    promptEditing: false,
    caseDraftPrompt: '',
    hasRunOnce: false,
    promptLibraryCategory: '全部',
    promptLibraryQuery: '',
    selectedContributionId: '',
    pendingDelete: null,
  };
  let runTicker = null;
  const modalReturnFocus = new Map();
  const renderQueued = { case: new Set(), test: new Set() };
  const caseSlotRunTokens = new Map();
  const caseRunIdleWaiters = new Set();
  const testRunTokens = new Map();
  const testRunIdleWaiters = new Set();

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function icon(name) {
    const paths = {
      copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
      external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  function iconAction({ attr, key, iconName, label }) {
    return `<button type="button" class="card-icon-btn" ${attr}="${escapeHtml(key)}" aria-label="${label}" data-tooltip="${label}">${icon(iconName)}</button>`;
  }

  function hasRunningRows(results) {
    return Object.values(results || {}).some((r) => r?.status === 'running');
  }

  function startRunTicker() {
    if (runTicker) return;
    runTicker = setInterval(() => {
      Object.entries(state.results).forEach(([slotKey, row]) => {
        if (row?.status === 'running') queueResultRender('case', slotKey);
      });
      Object.entries(state.testResults).forEach(([slotKey, row]) => {
        if (row?.status === 'running') queueResultRender('test', slotKey);
      });
      if (!hasRunningRows(state.results) && !hasRunningRows(state.testResults)) {
        clearInterval(runTicker);
        runTicker = null;
      }
    }, 1000);
  }

  function queueResultRender(source, slotKey) {
    const queued = renderQueued[source];
    if (!queued || !slotKey || queued.has(slotKey)) return;
    queued.add(slotKey);
    requestAnimationFrame(() => {
      queued.delete(slotKey);
      updateResultCard(slotKey, source);
    });
  }

  function createId(prefix = 'ai') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function normalizeBaseUrl(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    s = s.replace(/\/+$/, '');
    s = s.replace(/\/chat\/completions$/i, '');
    s = s.replace(/\/models$/i, '');
    s = s.replace(/\/+$/, '');
    return s;
  }

  function sanitizeApiKey(raw) {
    let key = String(raw || '')
      .trim()
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (/^authorization:/i.test(key)) {
      key = key.replace(/^authorization:\s*/i, '').replace(/^Bearer\s+/i, '').trim();
    }
    return key;
  }

  function validateApiKeyClient(key) {
    const k = sanitizeApiKey(key);
    if (!k) return { ok: false, error: 'API Key 不能为空' };
    if (/^https?:\/\//i.test(k) || k.includes('://') || /\/v\d+(\/|$)/.test(k)) {
      return {
        ok: false,
        error: 'API Key 不能是网址或带 /v1 路径。请只粘贴 sk-… 密钥（Base URL 单独填在上一栏）',
      };
    }
    return { ok: true, key: k };
  }

  function presetById(id) {
    return PRESET_MAP[id] || PRESET_MAP[DEFAULT_PRESET] || PRESETS[0] || null;
  }

  function createProfileFromPreset(presetId = DEFAULT_PRESET, overrides = {}) {
    const preset = presetById(presetId) || {
      id: 'custom',
      name: '自定义',
      providerType: 'openai_compatible',
      category: '',
      baseUrl: '',
      defaultModel: '',
      apiKeyUrl: '',
    };
    const now = Date.now();
    return {
      id: createId('ai'),
      name: preset.name,
      provider: preset.id,
      providerName: preset.name,
      providerType: preset.providerType || 'openai_compatible',
      providerCategory: preset.category || '',
      apiKeyUrl: preset.apiKeyUrl || '',
      baseUrl: preset.baseUrl || '',
      model: preset.defaultModel || '',
      temperature: 0.7,
      maxTokens: 2048,
      apiKey: '',
      enabled: true,
      isDefault: false,
      selectedModels: preset.defaultModel ? [preset.defaultModel] : [],
      availableModels: Array.isArray(preset.quickModels) ? [...preset.quickModels] : [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function normalizeProfile(raw, index = 0) {
    const provider = String((raw && raw.provider) || DEFAULT_PRESET).trim() || DEFAULT_PRESET;
    const preset = PRESET_MAP[provider];
    return {
      id: String((raw && raw.id) || createId('ai')),
      name: String((raw && raw.name) || (preset ? preset.name : '自定义模型')).trim(),
      provider,
      providerName: String((raw && (raw.providerName || raw.provider_name)) || (preset ? preset.name : provider)).trim(),
      providerType: String((raw && (raw.providerType || raw.provider_type)) || (preset ? preset.providerType : 'openai_compatible')).trim(),
      providerCategory: String((raw && (raw.providerCategory || raw.provider_category)) || (preset ? preset.category : '')).trim(),
      apiKeyUrl: String((raw && (raw.apiKeyUrl || raw.api_key_url)) || (preset ? preset.apiKeyUrl || '' : '')).trim(),
      baseUrl: normalizeBaseUrl(raw && (raw.baseUrl || raw.base_url || (preset ? preset.baseUrl : ''))),
      model: String((raw && raw.model) || (preset ? preset.defaultModel : '')).trim(),
      temperature: Math.min(2, Math.max(0, Number(raw && raw.temperature != null ? raw.temperature : 0.7) || 0.7)),
      maxTokens: Math.min(16384, Math.max(256, Number(raw && (raw.maxTokens || raw.max_tokens)) || 2048)),
      apiKey: String((raw && (raw.apiKey || raw.api_key)) || '').trim(),
      enabled: raw && raw.enabled === false ? false : true,
      isDefault: !!(raw && (raw.isDefault || raw.is_default)) || index === 0,
      selectedModels: Array.isArray(raw && raw.selectedModels)
        ? raw.selectedModels.map(String).filter(Boolean)
        : (raw && raw.model ? [String(raw.model)] : []),
      availableModels: Array.isArray(raw && raw.availableModels)
        ? raw.availableModels.map(String).filter(Boolean)
        : [],
      createdAt: Number(raw && raw.createdAt) || Date.now(),
      updatedAt: Number(raw && raw.updatedAt) || Date.now(),
    };
  }

  function ensureSingleDefault(profiles) {
    if (!profiles.length) return [];
    const idx = Math.max(0, profiles.findIndex((p) => p.isDefault));
    return profiles.map((p, i) => ({ ...p, isDefault: i === idx }));
  }

  function migrateLegacyModels(models) {
    if (!Array.isArray(models) || !models.length) return [];
    return models.map((m, i) =>
      normalizeProfile(
        {
          id: m.id || createId('ai'),
          name: m.label || m.model || `模型 ${i + 1}`,
          provider: 'custom',
          providerName: m.label || '自定义',
          baseUrl: m.baseUrl,
          model: m.model,
          apiKey: m.apiKey,
          enabled: !!m.enabled,
          isDefault: i === 0,
        },
        i
      )
    );
  }

  function loadProfiles() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      let list = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(list) || !list.length) {
        // migrate from v1 models field
        const legacy = localStorage.getItem(STORAGE_KEY);
        const data = legacy ? JSON.parse(legacy) : {};
        list = migrateLegacyModels(data.models);
      }
      if (!list.length) {
        list = [createProfileFromPreset(DEFAULT_PRESET, { isDefault: true, enabled: true })];
      }
      state.profiles = ensureSingleDefault(list.map((p, i) => normalizeProfile(p, i)));
      const active = localStorage.getItem(PROFILE_KEY + ':active');
      state.activeProfileId = state.profiles.some((p) => p.id === active)
        ? active
        : (state.profiles.find((p) => p.isDefault) || state.profiles[0]).id;
    } catch {
      state.profiles = [createProfileFromPreset(DEFAULT_PRESET, { isDefault: true, enabled: true })];
      state.activeProfileId = state.profiles[0].id;
    }
  }

  function saveProfiles() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profiles));
    localStorage.setItem(PROFILE_KEY + ':active', state.activeProfileId || '');
  }

  function loadSettings() {
    loadProfiles();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state.theme = 'light';
        return;
      }
      const data = JSON.parse(raw);
      state.theme = data.theme === 'dark' ? 'dark' : 'light';
      if (Array.isArray(data.selectedSiteIds)) {
        state.selectedSiteIds = new Set(data.selectedSiteIds);
      }
      state.hasRunOnce = !!data.hasRunOnce;
    } catch {
      state.theme = 'light';
    }
  }

  function saveSettings() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: state.theme,
        selectedSiteIds: [...state.selectedSiteIds],
        hasRunOnce: state.hasRunOnce,
      })
    );
    saveProfiles();
  }

  function activeProfile() {
    return (
      state.profiles.find((p) => p.id === state.activeProfileId) ||
      state.profiles.find((p) => p.isDefault) ||
      state.profiles[0] ||
      null
    );
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
  }

  function activeCase() {
    return state.cases.find((c) => c.id === state.activeId) || state.cases[0] || null;
  }

  function categoryLabel(cat) {
    if (cat === 'creative-writing') return '创意写作';
    if (cat === 'frontend') return '前端网页';
    return cat || '其他';
  }

  function inferOutputTypeFromText({ outputType, output_type: outputTypeSnake, category = '', title = '', summary = '', prompt = '', tags = [] } = {}) {
    const explicit = outputType ?? outputTypeSnake;
    if (explicit === 'html' || explicit === 'text') return explicit;
    const blob = `${category} ${title} ${summary} ${prompt} ${Array.isArray(tags) ? tags.join(' ') : tags || ''}`;
    if (String(category).toLowerCase() === 'frontend') return 'html';
    if (/完整\s*html|输出\s*html|html\s*文件|网页|前端|three\.?js|webgl|canvas|svg|纯\s*css|css\s+art|loading\s*动画/i.test(blob)) {
      return 'html';
    }
    return 'text';
  }

  function caseOutputType(c) {
    return inferOutputTypeFromText(c || {});
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripCodeFence(text) {
    const t = String(text || '').trim();
    const m = t.match(/^```[\w+-]*\s*\n([\s\S]*?)\n```\s*$/);
    return m ? m[1].trim() : t;
  }

  function decodeArtifactEntities(text) {
    return String(text || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function stripDanglingFence(text) {
    return String(text || '')
      .replace(/\n?```[\s\S]*$/g, '')
      .trim();
  }

  function looksLikeSvg(text) {
    return /<svg[\s>]/i.test(decodeArtifactEntities(text));
  }

  function extractSvgMarkup(text) {
    const decoded = decodeArtifactEntities(text);
    const complete = decoded.match(/<svg[\s>][\s\S]*?<\/svg>/i);
    if (complete) return complete[0].trim();
    const start = decoded.search(/<svg[\s>]/i);
    if (start < 0) return '';
    const partial = stripDanglingFence(decoded.slice(start));
    if (!partial) return '';
    return /<\/svg>\s*$/i.test(partial) ? partial : `${partial}\n</svg>`;
  }

  function extractHtmlMarkup(text) {
    const decoded = decodeArtifactEntities(text);
    const complete = decoded.match(/(?:<!doctype\s+html[^>]*>\s*)?<html[\s\S]*?<\/html>/i);
    if (complete) return complete[0].trim();

    const start = decoded.search(/<!doctype\s+html|<html[\s>]/i);
    if (start >= 0) return stripDanglingFence(decoded.slice(start));

    const body = decoded.match(/<body[\s>][\s\S]*?<\/body>/i);
    if (body) return body[0].trim();

    const component = decoded.match(/<(?:div|main|section|article|canvas)[\s>][\s\S]*<\/(?:div|main|section|article|canvas)>/i);
    return component ? component[0].trim() : '';
  }

  function looksLikeHtml(text) {
    const t = decodeArtifactEntities(stripCodeFence(text)).trim();
    return (
      !!extractHtmlMarkup(t) ||
      (/<!DOCTYPE html|<html[\s>]|<body[\s>]|<div[\s>]/i.test(t) && /<\/[a-z]+>/i.test(t)) ||
      looksLikeSvg(t)
    );
  }

  function renderMarkdown(src) {
    try {
      const raw = String(src || '');
      if (window.marked && window.DOMPurify) {
        const html = window.marked.parse(raw, { breaks: true });
        return window.DOMPurify.sanitize(html);
      }
    } catch {}
    return escapeHtml(src).replace(/\n/g, '<br>');
  }

  function previewCspPolicy(frameSource = "'none'") {
    return `default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-src ${frameSource}; connect-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com;`;
  }

  function applyPreviewCsp(markup) {
    const policy = previewCspPolicy();
    const html = String(markup || '');
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const meta = doc.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = policy;
      doc.head.prepend(meta);
      return `<!doctype html>${doc.documentElement.outerHTML}`;
    } catch {
      return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>${html}</body></html>`;
    }
  }

  function wrapSvgForPreview(svg) {
    return applyPreviewCsp(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;min-height:100%;background:#fff;}
      body{display:grid;place-items:center;padding:12px;box-sizing:border-box;}
      svg{max-width:100%;height:auto;display:block;}
    </style></head><body>${svg}</body></html>`);
  }

  function firstRenderableFence(text) {
    const raw = decodeArtifactEntities(text);
    const fenceRe = /```([\w+-]*)\s*\n([\s\S]*?)\n```/g;
    let match;
    while ((match = fenceRe.exec(raw))) {
      const lang = String(match[1] || '').toLowerCase();
      const code = String(match[2] || '').trim();
      if (['html', 'xhtml', 'svg', 'xml'].includes(lang) || looksLikeHtml(code)) {
        return { lang, code };
      }
    }
    return null;
  }

  function renderableArtifact(text, outputType = 'text') {
    if (outputType !== 'html') return null;
    const raw = decodeArtifactEntities(String(text || '').trim());
    const stripped = stripCodeFence(raw);
    const direct = stripped.trim();
    const fenced = firstRenderableFence(raw);
    const code = fenced ? fenced.code : direct;
    const html = extractHtmlMarkup(code) || extractHtmlMarkup(raw);
    if (html) {
      return { source: html, preview: applyPreviewCsp(html), kind: 'html' };
    }
    const svg = extractSvgMarkup(code) || extractSvgMarkup(raw);
    if (svg) return { source: svg, preview: wrapSvgForPreview(svg), kind: 'svg' };
    return null;
  }

  function renderArtifactIframe(artifact, { title = 'HTML 预览', loading = false, focusable = false } = {}) {
    if (!artifact?.preview) return '';
    return `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtml(artifact.preview)}" title="${escapeHtml(title)}"${loading ? ' loading="lazy"' : ''}${focusable ? ' tabindex="0"' : ''}></iframe>`;
  }

  function renderTextPreviewDocument(content) {
    const csp = "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; style-src 'unsafe-inline'; script-src 'none'";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>模型输出原文</title><style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:20px;background:#fff;color:#18181b;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}@media(prefers-color-scheme:dark){body{background:#171b24;color:#e8eaef}}
    </style></head><body><pre>${escapeHtml(content)}</pre></body></html>`;
  }

  function openIsolatedPreviewDocument(previewDocument, title = '模型输出预览') {
    const wrapperCsp = previewCspPolicy('blob:');
    const safeTitle = escapeHtml(title);
    const previewUrl = URL.createObjectURL(new Blob([previewDocument], { type: 'text/html;charset=utf-8' }));
    const wrapper = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${wrapperCsp}"><title>${safeTitle}</title><style>
      html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#fff}iframe{display:block;width:100%;height:100%;border:0;background:#fff}
    </style></head><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="${escapeHtml(previewUrl)}" title="${safeTitle}"></iframe></body></html>`;
    const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(previewUrl);
    }, 60_000);
  }

  function openResultInNewWindow(content, outputType, title = '模型输出预览') {
    const artifact = renderableArtifact(content, outputType);
    openIsolatedPreviewDocument(
      artifact ? artifact.preview : renderTextPreviewDocument(content),
      artifact ? title : `${title} · 原文`
    );
  }

  function testResultOutputType(row) {
    if (row?.outputType === 'html' || row?.outputType === 'text') return row.outputType;
    return state.testOutputType;
  }

  function renderRerunButton(slotKey, source, running = false) {
    const rerunAttr = source === 'test' ? 'data-test-rerun' : 'data-rerun';
    if (source === 'published') return '';
    const safeKey = escapeHtml(slotKey);
    return `<button type="button" class="rerun-btn" ${rerunAttr}="${safeKey}" ${running ? 'disabled' : ''}>重新运行</button>`;
  }

  function renderErrorRerun(slotKey, source) {
    const button = renderRerunButton(slotKey, source);
    return button ? `<div class="col-tabs recovery-tabs">${button}</div>` : '';
  }

  function renderTabs({ slotKey, source, artifact, mode, running }) {
    const viewAttr = source === 'test' ? 'data-test-view' : 'data-view';
    const safeKey = escapeHtml(slotKey);
    const left = artifact
      ? `<button type="button" ${viewAttr}="${safeKey}" data-mode="preview" aria-selected="${mode === 'preview'}">预览</button>
         <button type="button" ${viewAttr}="${safeKey}" data-mode="source" aria-selected="${mode === 'source'}">源码</button>`
      : `<button type="button" ${viewAttr}="${safeKey}" data-mode="md" aria-selected="${mode === 'md'}">Markdown</button>
         <button type="button" ${viewAttr}="${safeKey}" data-mode="raw" aria-selected="${mode === 'raw'}">原文</button>`;
    return `
      <div class="col-tabs">
        <span class="tab-set">${left}</span>
        ${renderRerunButton(slotKey, source, running)}
      </div>`;
  }

  function renderResultSurface({ slotKey, source, content, outputType, mode, running = false }) {
    const artifact = renderableArtifact(content, outputType);
    const normalizedMode = artifact
      ? (mode === 'source' ? 'source' : 'preview')
      : (mode === 'raw' ? 'raw' : 'md');
    const tabs = renderTabs({ slotKey, source, artifact, mode: normalizedMode, running });
    if (artifact) {
      const body =
        normalizedMode === 'source'
          ? `<div class="col-body"><pre class="source">${escapeHtml(artifact.source)}</pre></div>`
          : `<div class="col-body preview-body">${renderArtifactIframe(artifact)}</div>`;
      return { tabs, body };
    }
    const body =
      normalizedMode === 'raw'
        ? `<div class="col-body">${escapeHtml(content)}</div>`
        : `<div class="col-body md">${outputType === 'html' ? '<div class="artifact-note">未检测到可预览的 HTML / SVG，已按 Markdown 显示。</div>' : ''}${renderMarkdown(content)}</div>`;
    return { tabs, body };
  }

  function elapsedSeconds(row) {
    const started = Number(row?.startedAt) || Date.now();
    const ended = Number(row?.finishedAt) || Date.now();
    return Math.max(0, Math.floor((ended - started) / 1000));
  }

  function runningStats(row) {
    const parts = [`${elapsedSeconds(row)}s`];
    const chars = String(row?.content || '').length;
    if (chars) parts.push(`${chars} 字`);
    if (row?.retrying) parts.push('自动重试');
    if (row?.reasoningChars) parts.push(`推理 ${row.reasoningChars} 字`);
    return `运行中 · ${parts.join(' · ')}`;
  }

  function renderRunningBody(row, outputType) {
    const content = String(row?.content || '');
    const waitingText = row?.retrying
      ? row.retryReason === 'empty_completion'
        ? '模型返回了空结果，正在自动重试最终正文…'
        : '上一轮只返回推理过程，正在自动重试最终正文…'
      : row?.reasoningChars
      ? `模型正在推理，尚未返回最终正文 · 推理 ${row.reasoningChars} 字`
      : '等待模型返回首个片段…';
    const status = content
      ? `正在接收输出 · ${content.length} 字 · ${elapsedSeconds(row)}s`
      : `${waitingText} · ${elapsedSeconds(row)}s`;
    const preview = content
      ? `<pre class="source">${escapeHtml(content)}</pre>`
      : `<div class="stream-placeholder">${escapeHtml(waitingText)}</div>`;
    return `
      <div class="col-body stream-body ${outputType === 'html' ? 'html-stream' : ''}">
        <div class="stream-status">
          <span class="stream-dot"></span>
          <span>${escapeHtml(status)}</span>
        </div>
        ${preview}
      </div>`;
  }

  function renderErrorBody(row) {
    const partial = String(row?.content || '').trim();
    return `<div class="col-body error">
      <div>${escapeHtml(row?.error || '失败')}</div>
      ${partial ? `<pre class="source partial-source">${escapeHtml(partial)}</pre>` : ''}
    </div>`;
  }

  function openFullscreen(slotKey, source = 'case') {
    const isTest = source === 'test';
    const isPublished = source === 'published';
    const slots = isTest
      ? configuredSlots({ selectedSiteOnly: false })
      : isPublished
        ? displaySlots()
        : (state.liveSlots.length ? state.liveSlots : runSlots());
    const m = slots.find((s) => s.key === slotKey);
    const r = isTest ? state.testResults[slotKey] : state.results[slotKey];
    const c = activeCase();
    if (!r?.content) return;
    const content = r.content;
    const outputType = isTest
      ? testResultOutputType(r)
      : isPublished
        ? (r.outputType === 'html' ? 'html' : state.publishedRun?.outputType || 'text')
        : caseOutputType(c);
    const artifact = renderableArtifact(content, outputType);
    $('#fs-title').textContent = m ? m.label : '预览';
    const body = $('#fs-body');
    let initialFocus = null;
    if (artifact) {
      body.innerHTML = renderArtifactIframe(artifact, { title: '全屏 HTML 预览', focusable: true });
      initialFocus = body.querySelector('iframe');
    } else {
      body.innerHTML = `<div class="col-body md" tabindex="0" style="padding:20px;overflow:auto;height:100%;background:var(--surface);color:var(--text)">${renderMarkdown(content)}</div>`;
      initialFocus = body.firstElementChild;
    }
    openModal('modal-preview-fs', initialFocus);
    if (initialFocus?.tagName === 'IFRAME') {
      initialFocus.addEventListener('load', () => {
        const overlay = $('#modal-preview-fs');
        const active = document.activeElement;
        const trigger = modalReturnFocus.get('modal-preview-fs');
        if (
          overlay?.classList.contains('open') &&
          (active === initialFocus || active === document.body || active === overlay || active === trigger)
        ) {
          initialFocus.focus({ preventScroll: true });
        }
      }, { once: true });
    }
  }

  function setUrlCase(id) {
    const u = new URL(location.href);
    const previous = u.searchParams.get('case');
    if (id) {
      u.searchParams.set('case', id);
      if (previous && previous !== id) u.searchParams.delete('run');
    } else {
      u.searchParams.delete('case');
      u.searchParams.delete('run');
    }
    history.replaceState(null, '', u);
  }

  function setUrlPublishedVersion(version, isFeatured = false) {
    const u = new URL(location.href);
    if (isFeatured || !version) u.searchParams.delete('run');
    else u.searchParams.set('run', String(version));
    history.replaceState(null, '', u);
  }

  function formatSlotLabel(providerName, modelId) {
    const p = String(providerName || '').trim();
    const m = String(modelId || '').trim();
    if (p && m && p.toLowerCase() !== m.toLowerCase()) return `${p} · ${m}`;
    return m || p || 'model';
  }

  function configuredSlots({ selectedSiteOnly = true } = {}) {
    const site = state.siteModels
      .filter((m) => (selectedSiteOnly ? state.selectedSiteIds.has(m.id) : true) && m.hasKey)
      .map((m) => ({
        key: `site:${m.id}`,
        providerKey: `site:${m.id}`,
        kind: 'site',
        siteModelId: m.id,
        providerName: m.label,
        profileName: m.label,
        keySource: 'admin',
        label: formatSlotLabel(m.label, m.model),
        model: m.model,
        temperature: 0.7,
        maxTokens: 2048,
      }));
    const local = [];
    state.profiles
      .filter((p) => p.enabled && p.apiKey && p.baseUrl)
      .forEach((p) => {
        const keyOk = sanitizeApiKey(p.apiKey);
        if (!keyOk || /^https?:/i.test(keyOk) || keyOk.includes('/v1')) return;
        let models = Array.isArray(p.selectedModels) ? p.selectedModels.filter(Boolean) : [];
        if (!models.length && p.model) models = [p.model];
        // unique
        models = [...new Set(models)];
        models.forEach((mid) => {
          local.push({
            key: `local:${p.id}::${mid}`,
            providerKey: `local:${p.id}`,
            kind: 'custom',
            id: p.id,
            providerName: p.providerName || p.name,
            profileName: p.name || p.providerName,
            keySource: 'browser',
            label: formatSlotLabel(p.providerName || p.name, mid),
            model: mid,
            baseUrl: normalizeBaseUrl(p.baseUrl),
            apiKey: keyOk,
            temperature: p.temperature,
            maxTokens: p.maxTokens,
          });
        });
      });
    return [...site, ...local];
  }

  function runSlots() {
    return configuredSlots({ selectedSiteOnly: true });
  }

  function slotSnapshot(slot) {
    return {
      key: slot.key,
      kind: slot.kind,
      siteModelId: slot.siteModelId || '',
      providerName: slot.providerName || '',
      profileName: slot.profileName || '',
      keySource: slot.keySource || '',
      label: slot.label || slot.model || '',
      model: slot.model || '',
      temperature: slot.temperature,
      maxTokens: slot.maxTokens,
    };
  }

  function effectiveRunSystem(system = '', outputType = 'text') {
    return outputType === 'html'
      ? [HTML_OUTPUT_SYSTEM, system].filter(Boolean).join('\n\n')
      : system;
  }

  function runSlotSnapshot(slot, context) {
    const payload = buildRunPayload(slot, context);
    return {
      ...slotSnapshot(slot),
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
    };
  }

  function beginCaseRun(caseId) {
    caseSlotRunTokens.clear();
    caseRunIdleWaiters.forEach((resolve) => resolve());
    caseRunIdleWaiters.clear();
    const token = `${caseId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    state.caseRunToken = token;
    state.running = true;
    return token;
  }

  function isCurrentCaseRun(token, caseId) {
    return !!token && state.caseRunToken === token && state.activeId === caseId && state.resultOrigin === 'live';
  }

  function beginCaseSlotRun(slotKey) {
    const token = `${slotKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    caseSlotRunTokens.set(slotKey, token);
    state.running = true;
    return token;
  }

  function isCurrentCaseSlotRun(slotKey, slotToken, runToken, caseId) {
    return isCurrentCaseRun(runToken, caseId) && caseSlotRunTokens.get(slotKey) === slotToken;
  }

  function finishCaseSlotRun(slotKey, slotToken) {
    if (caseSlotRunTokens.get(slotKey) !== slotToken) return;
    caseSlotRunTokens.delete(slotKey);
    state.running = caseSlotRunTokens.size > 0;
    if (!state.running) {
      caseRunIdleWaiters.forEach((resolve) => resolve());
      caseRunIdleWaiters.clear();
    }
  }

  function waitForCaseSlotsIdle() {
    if (!caseSlotRunTokens.size) return Promise.resolve();
    return new Promise((resolve) => caseRunIdleWaiters.add(resolve));
  }

  function cancelCaseRun() {
    if (!state.caseRunToken && !state.running && !caseSlotRunTokens.size) return;
    state.caseRunToken = '';
    caseSlotRunTokens.clear();
    caseRunIdleWaiters.forEach((resolve) => resolve());
    caseRunIdleWaiters.clear();
    state.running = false;
    const button = $('#btn-run');
    if (button) {
      button.disabled = false;
      button.classList.remove('loading');
    }
    updateResultActions();
  }

  function beginTestSlotRun(slotKey) {
    const token = `${slotKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    testRunTokens.set(slotKey, token);
    state.testRunning = true;
    return token;
  }

  function isCurrentTestSlotRun(slotKey, token) {
    return !!token && testRunTokens.get(slotKey) === token;
  }

  function finishTestSlotRun(slotKey, token) {
    if (!isCurrentTestSlotRun(slotKey, token)) return;
    testRunTokens.delete(slotKey);
    state.testRunning = testRunTokens.size > 0;
    if (!state.testRunning) {
      testRunIdleWaiters.forEach((resolve) => resolve());
      testRunIdleWaiters.clear();
    }
  }

  function waitForTestSlotsIdle() {
    if (!testRunTokens.size) return Promise.resolve();
    return new Promise((resolve) => testRunIdleWaiters.add(resolve));
  }

  function displaySlots() {
    if (state.resultOrigin === 'published') return state.resultSlots;
    return state.liveSlots.length ? state.liveSlots : runSlots().map(slotSnapshot);
  }

  function publishedResultKey(run, index) {
    return `published:${run?.version || 'latest'}:${index}`;
  }

  function applyPublishedRun(run) {
    cancelCaseRun();
    state.publishedRun = run || null;
    state.resultOrigin = 'published';
    state.results = {};
    state.resultSlots = [];
    state.scores = {};
    state.scoreOpen.clear();
    (run?.results || []).forEach((result, index) => {
      const key = publishedResultKey(run, index);
      state.resultSlots.push({
        key,
        kind: 'published',
        providerName: result.providerName || '',
        profileName: result.profileName || '',
        label: result.label || result.model || `模型 ${index + 1}`,
        model: result.model || '',
        keySource: 'published',
      });
      state.results[key] = {
        ...result,
        status: result.status === 'error' ? 'error' : 'ok',
      };
    });
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function casePublishedSummary(c) {
    return c?.publishedRunSummary || c?.publishedRun || c?.featuredRunSummary || null;
  }

  function syncTestSelection(slots) {
    const liveKeys = new Set(slots.map((m) => m.key));
    [...state.testSelectedKeys].forEach((key) => {
      if (!liveKeys.has(key)) state.testSelectedKeys.delete(key);
    });
    if (!state.testSelectionTouched && slots.length && !state.testSelectedKeys.size) {
      slots.slice(0, 4).forEach((m) => state.testSelectedKeys.add(m.key));
    }
  }

  function testSlots() {
    const slots = configuredSlots({ selectedSiteOnly: false });
    syncTestSelection(slots);
    return slots.filter((m) => state.testSelectedKeys.has(m.key));
  }

  function hasSuccessfulResult(results) {
    return Object.values(results || {}).some((r) => r?.status === 'ok');
  }

  function updateResultActions() {
    const caseHasResults = hasSuccessfulResult(state.results);
    $('#btn-export')?.classList.toggle('hidden', !caseHasResults);
    $('#btn-contribute')?.classList.toggle('hidden', !caseHasResults || state.resultOrigin !== 'live');
    $('#btn-publish')?.classList.toggle(
      'hidden',
      !state.isAdmin || state.resultOrigin !== 'live' || !caseHasResults || state.running
    );
    $('#btn-view-published')?.classList.toggle(
      'hidden',
      !(
        (state.resultOrigin === 'live' && state.publishedRun) ||
        (state.resultOrigin === 'published' && state.publishedRun && !state.publishedRun.isFeatured)
      )
    );
    const runButton = $('#btn-run');
    if (runButton && !state.running) {
      runButton.textContent = state.resultOrigin === 'live' && Object.keys(state.results).length
        ? '重新运行本题'
        : state.isAdmin && !state.publishedRun
          ? '运行并生成结果'
          : '用本题复跑';
    }
    const testHasResults = hasSuccessfulResult(state.testResults);
    $$('.test-result-action').forEach((el) => el.classList.toggle('hidden', !testHasResults));
  }

  function casePromptForRun(c = activeCase()) {
    if (!c) return '';
    if (state.isAdmin && state.promptEditing) {
      return ($('#case-prompt-edit')?.value ?? state.caseDraftPrompt ?? c.prompt).trim();
    }
    return c.prompt || '';
  }

  function renderAdminPromptEditor(c) {
    const box = $('#admin-prompt-editor');
    if (!box) return;
    const prompt = $('#case-prompt');
    box.classList.toggle('hidden', !state.isAdmin || !state.promptEditing);
    prompt?.classList.toggle('hidden', state.isAdmin && state.promptEditing);
    if (!state.isAdmin) {
      $('#btn-copy-prompt').textContent = '复制提示词';
      return;
    }
    const textarea = $('#case-prompt-edit');
    if (!state.promptEditing) {
      state.caseDraftPrompt = c.prompt || '';
      if (textarea) textarea.value = state.caseDraftPrompt;
    }
    $('#btn-copy-prompt').textContent = state.promptEditing ? '取消编辑' : '编辑提示词';
  }

  function renderCaseList() {
    const list = $('#case-list');
    if (!state.cases.length) {
      list.innerHTML = `<div class="empty-state rail-empty" style="padding:20px;border:0">
        <strong>${state.isAdmin ? '没有匹配的题目' : '首批实测结果准备中'}</strong>
        <span>${state.isAdmin ? '调整搜索或筛选条件。' : '题目会在管理员完成并发布结果后出现在这里。'}</span>
      </div>`;
      return;
    }
    list.innerHTML = state.cases
      .map((c) => {
        const active = c.id === state.activeId ? 'active' : '';
        const published = casePublishedSummary(c);
        const successCount = published?.successCount ?? published?.successfulResultCount ?? 0;
        const publishedAt = formatDateTime(published?.publishedAt);
        return `
          <button type="button" class="case-item ${active}" data-id="${escapeHtml(c.id)}">
            <strong>${escapeHtml(c.title)}</strong>
            <span>${escapeHtml(c.summary || '')}</span>
            <span class="case-result-meta ${published ? 'ready' : 'pending'}">
              ${published
                ? `${escapeHtml(String(successCount))} 个模型 · ${escapeHtml(publishedAt || '已发布')}`
                : '待发布结果'}
            </span>
            <div class="meta">
              <span class="tag">${escapeHtml(categoryLabel(c.category))}</span>
              <span class="tag">${escapeHtml(c.difficulty || '')}</span>
              ${(c.tags || [])
                .slice(0, 2)
                .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
                .join('')}
            </div>
          </button>`;
      })
      .join('');
  }

  function renderSnapshotMeta() {
    const strip = $('#snapshot-strip');
    const title = $('#snapshot-title');
    const facts = $('#snapshot-facts');
    const runStatus = $('#run-status');
    if (!strip || !title || !facts) return;

    if (state.resultOrigin === 'live') {
      const rows = Object.values(state.results);
      const ok = rows.filter((r) => r?.status === 'ok').length;
      const fail = rows.filter((r) => r?.status === 'error').length;
      const running = rows.filter((r) => r?.status === 'running').length;
      strip.dataset.state = 'live';
      title.textContent = running ? '本次运行 · 尚未发布' : '本次运行已完成 · 尚未发布';
      facts.innerHTML = [
        `<span class="snapshot-fact">${ok} 成功${fail ? ` / ${fail} 失败` : ''}</span>`,
        running ? `<span class="snapshot-fact">${running} 运行中</span>` : '',
        `<span class="snapshot-fact">仅当前浏览器可见</span>`,
      ].join('');
      return;
    }

    if (state.publishedLoading) {
      strip.dataset.state = 'loading';
      title.textContent = '正在读取精选结果…';
      facts.innerHTML = '';
      if (runStatus) runStatus.textContent = '正在读取题库结果…';
      return;
    }

    if (state.publishedError) {
      strip.dataset.state = 'error';
      title.textContent = '精选结果读取失败';
      facts.innerHTML = '<span class="snapshot-fact">可重新加载</span>';
      if (runStatus) runStatus.textContent = '结果暂时不可用，题目内容仍可查看。';
      return;
    }

    const run = state.publishedRun;
    if (!run) {
      strip.dataset.state = 'empty';
      title.textContent = '暂无已发布结果';
      facts.innerHTML = state.isAdmin
        ? '<span class="snapshot-fact">运行完成后可手动发布</span>'
        : '<span class="snapshot-fact">尚未进入公开题库</span>';
      if (runStatus) {
        runStatus.textContent = state.isAdmin
          ? '跑完并检查结果后，再手动发布为精选结果。'
          : '这道题尚未发布实测结果。';
      }
      return;
    }

    strip.dataset.state = 'published';
    title.textContent = `${run.isFeatured === false ? '历史结果' : '精选结果'} v${run.version}${run.note ? ` · ${run.note}` : ''}`;
    const success = run.successfulResultCount ?? (run.results || []).filter((r) => r.status !== 'error').length;
    const failed = Math.max(0, (run.resultCount ?? run.results?.length ?? 0) - success);
    facts.innerHTML = [
      `<span class="snapshot-fact">${escapeHtml(formatDateTime(run.publishedAt))}</span>`,
      `<span class="snapshot-fact">${success} 成功${failed ? ` / ${failed} 失败` : ''}</span>`,
      `<span class="snapshot-fact">${run.outputType === 'html' ? 'HTML / SVG' : '文本 / Markdown'}</span>`,
    ].join('');
    if (runStatus) runStatus.textContent = '管理员确认发布的固定快照，可查看历史版本或自行复跑。';
  }

  function renderSnapshotHistory() {
    const section = $('#snapshot-history');
    const list = $('#snapshot-version-list');
    const history = state.publishedHistory || [];
    section.classList.toggle('hidden', history.length < 2);
    if (history.length < 2) {
      list.innerHTML = '';
      return;
    }
    $('#snapshot-history-meta').textContent = `${history.length} 个公开版本`;
    list.innerHTML = history
      .map((run) => {
        const active = Number(run.version) === Number(state.publishedRun?.version);
        return `<button type="button" class="snapshot-version" data-published-version="${escapeHtml(String(run.version))}" aria-current="${active}">
          <b>v${escapeHtml(String(run.version))}</b>
          <span>${escapeHtml(run.note || `${run.successfulResultCount ?? run.successCount ?? 0} 个成功结果`)}</span>
          <time>${escapeHtml(formatDateTime(run.publishedAt))}</time>
        </button>`;
      })
      .join('');
  }

  function renderNoCaseStage() {
    $('#case-title').textContent = state.isAdmin ? '没有匹配的题目' : '首批实测结果准备中';
    $('#case-summary').textContent = state.isAdmin
      ? '调整搜索或筛选条件后继续。'
      : '管理员完成标准题目运行并确认发布后，结果会自动出现在这里。';
    $('#case-heading-tags').innerHTML = '';
    $('#case-prompt-panel').classList.add('hidden');
    $('#case-prompt').textContent = '';
    $('#case-rubric').innerHTML = '';
    $('#rubric-details').classList.add('hidden');
    state.publishedRun = null;
    state.publishedHistory = [];
    state.publishedLoading = false;
    state.publishedError = '';
    applyPublishedRun(null);
    renderSnapshotMeta();
    renderSnapshotHistory();
    renderModelStrip();
    renderCompare();
    updateResultActions();
  }

  function renderStage() {
    const c = activeCase();
    if (!c) {
      renderNoCaseStage();
      return;
    }
    $('#case-title').textContent = c.title;
    $('#case-summary').textContent = c.summary || '';
    $('#case-prompt-panel').classList.remove('hidden');
    $('#case-heading-tags').innerHTML = [
      categoryLabel(c.category),
      c.difficulty || '',
      ...(c.tags || []).slice(0, 2),
    ]
      .filter(Boolean)
      .map((value) => `<span class="tag">${escapeHtml(value)}</span>`)
      .join('');
    const visiblePrompt = state.resultOrigin === 'published' && state.publishedRun
      ? state.publishedRun.prompt || c.prompt
      : c.prompt || '';
    const visibleRubric = state.resultOrigin === 'published' && state.publishedRun
      ? state.publishedRun.rubric || c.rubric || []
      : c.rubric || [];
    $('#case-prompt').textContent = visiblePrompt;
    renderAdminPromptEditor(c);
    $('#case-rubric').innerHTML = visibleRubric
      .map((r) => `<i>${escapeHtml(r)}</i>`)
      .join('');
    $('#case-rubric-meta').textContent = `${visibleRubric.length} 个评测维度`;
    $('#rubric-details').classList.toggle('hidden', visibleRubric.length === 0);
    renderSnapshotMeta();
    renderSnapshotHistory();
    renderModelStrip();
    renderCompare();
    updateResultActions();
  }

  function renderModelStrip() {
    const strip = $('#model-strip');
    if (state.resultOrigin !== 'live') {
      strip.classList.add('hidden');
      strip.innerHTML = '';
      return;
    }
    strip.classList.remove('hidden');
    const slots = state.liveSlots.length ? state.liveSlots : runSlots();
    const parts = slots.map((m) => {
      const source = m.kind === 'site' ? '站点' : '本机';
      const chip = `
        <span class="dot"></span>
        <span>${escapeHtml(m.providerName || m.label)}</span>
        <span class="model-chip-model">${escapeHtml(m.model || '')}</span>
        <span class="model-chip-source">${source}</span>`;
      if (m.kind === 'site') {
        return `<button type="button" class="model-chip selected" data-site="${escapeHtml(m.siteModelId)}" aria-label="切换模型 ${escapeHtml(m.label)}">${chip}</button>`;
      }
      return `<div class="model-chip selected">${chip}</div>`;
    });
    if (!parts.length) {
      strip.innerHTML =
        '<span style="font-size:12px;color:var(--muted)">尚未选择可用模型，请打开「模型设置」</span>';
      return;
    }
    strip.innerHTML = parts.join('');
  }

  function scoreControls(slotKey, rubric) {
    if (!rubric?.length) return '';
    const scores = state.scores[slotKey] || {};
    return `
      <div class="score-row">
        ${rubric
          .map((dim) => {
            const v = scores[dim] ?? '';
            return `<div class="score-control">
              <span>${escapeHtml(dim)}</span>
              <div class="score-segments" role="group" aria-label="${escapeHtml(dim)}评分">
                ${[1, 2, 3, 4, 5]
                  .map((n) => `<button type="button" data-score-slot="${escapeHtml(slotKey)}" data-dim="${escapeHtml(dim)}" data-score-value="${n}" aria-pressed="${String(v) === String(n)}">${n}</button>`)
                  .join('')}
              </div>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  function renderCaseResultCard(m, { c, published, outputType }) {
    const r = state.results[m.key];
    const mode = state.viewModes[m.key] || 'preview';
    let newWindowOutputType = outputType;
    let body = '<div class="col-body empty">等待运行…</div>';
    let stats = '—';
    let tabs = '';
    if (r?.status === 'running') {
      body = renderRunningBody(r, outputType);
      stats = runningStats(r);
    } else if (r?.status === 'error') {
      body = renderErrorBody(r);
      stats = r.latencyMs != null ? `${r.latencyMs} ms · error` : 'error';
      if (!published) tabs = renderErrorRerun(m.key, 'case');
    } else if (r?.status === 'ok') {
      const content = r.content || '';
      const resultOutputType = published ? outputType : (r.outputType === 'html' ? 'html' : outputType);
      newWindowOutputType = resultOutputType;
      const surface = renderResultSurface({
        slotKey: m.key,
        source: published ? 'published' : 'case',
        content,
        outputType: resultOutputType,
        mode,
        running: false,
      });
      tabs = surface.tabs;
      body = surface.body;
      const tok = r.usage?.totalTokens != null ? ` · ${r.usage.totalTokens} tok` : '';
      stats = r.latencyMs != null ? `${r.latencyMs} ms${tok}` : `—${tok}`;
    }
    const opensArtifactPreview = r?.status === 'ok' && !!renderableArtifact(r.content, newWindowOutputType);
    return `
      <article class="col ${published ? 'published-col' : ''} ${opensArtifactPreview ? 'artifact-col' : 'text-col'}" data-slot="${escapeHtml(m.key)}">
        <div class="col-head">
          <h3><span class="provider">${escapeHtml(m.providerName || '')}</span>${escapeHtml(m.model || m.label)}</h3>
          <div class="stats">${escapeHtml(stats)}</div>
        </div>
        ${tabs}
        ${body}
        ${!published && r?.status === 'ok' && state.scoreOpen.has(m.key) ? scoreControls(m.key, c?.rubric) : ''}
        ${r?.status === 'ok' ? `<div class="col-actions">
          ${iconAction({ attr: 'data-copy', key: m.key, iconName: 'copy', label: '复制输出' })}
          ${iconAction({ attr: 'data-fs', key: m.key, iconName: 'maximize', label: '全屏查看' })}
          ${iconAction({ attr: 'data-open-result', key: m.key, iconName: 'external', label: opensArtifactPreview ? '新窗口打开预览' : '新窗口打开原文' })}
          ${published ? '' : `<button type="button" class="score-toggle" data-score-toggle="${escapeHtml(m.key)}" aria-expanded="${state.scoreOpen.has(m.key)}">${state.scoreOpen.has(m.key) ? '收起评分' : '我要打分'}</button>`}
        </div>` : ''}
      </article>`;
  }

  function renderTestResultCard(m) {
    const r = state.testResults[m.key];
    const outputType = testResultOutputType(r);
    const mode = state.testViewModes[m.key] || 'md';
    let body = '<div class="col-body empty">等待运行…</div>';
    let stats = '—';
    let tabs = '';
    if (r?.status === 'running') {
      body = renderRunningBody(r, outputType);
      stats = runningStats(r);
    } else if (r?.status === 'error') {
      body = renderErrorBody(r);
      stats = r.latencyMs != null ? `${r.latencyMs} ms · error` : 'error';
      tabs = renderErrorRerun(m.key, 'test');
    } else if (r?.status === 'ok') {
      const surface = renderResultSurface({
        slotKey: m.key,
        source: 'test',
        content: r.content || '',
        outputType,
        mode,
        running: false,
      });
      tabs = surface.tabs;
      body = surface.body;
      const tok = r.usage?.totalTokens != null ? ` · ${r.usage.totalTokens} tok` : '';
      stats = `${r.latencyMs ?? '—'}ms${tok}`;
    }
    const opensArtifactPreview = r?.status === 'ok' && !!renderableArtifact(r.content, outputType);
    return `
      <article class="col" data-slot="${escapeHtml(m.key)}">
        <div class="col-head">
          <h3><span class="provider">${escapeHtml(m.providerName || '')}</span>${escapeHtml(m.model || m.label)}</h3>
          <div class="stats">${escapeHtml(stats)}</div>
        </div>
        ${tabs}
        ${body}
        ${r?.status === 'ok' ? `<div class="col-actions">
          ${iconAction({ attr: 'data-test-copy', key: m.key, iconName: 'copy', label: '复制输出' })}
          ${iconAction({ attr: 'data-test-fs', key: m.key, iconName: 'maximize', label: '全屏查看' })}
          ${iconAction({ attr: 'data-test-open-result', key: m.key, iconName: 'external', label: opensArtifactPreview ? '新窗口打开预览' : '新窗口打开原文' })}
        </div>` : ''}
      </article>`;
  }

  function findResultCard(box, slotKey) {
    return [...(box?.querySelectorAll('article.col[data-slot]') || [])]
      .find((card) => card.dataset.slot === slotKey);
  }

  function updateResultCard(slotKey, source = 'case') {
    if (source === 'test') {
      const box = $('#test-compare');
      const card = findResultCard(box, slotKey);
      const slot = configuredSlots({ selectedSiteOnly: false })
        .find((item) => item.key === slotKey && state.testSelectedKeys.has(item.key));
      if (card && slot) card.outerHTML = renderTestResultCard(slot);
      return;
    }
    const box = $('#compare');
    const card = findResultCard(box, slotKey);
    const slot = displaySlots().find((item) => item.key === slotKey);
    const c = activeCase();
    const published = state.resultOrigin === 'published';
    if (!card || !slot || !c || (source === 'published') !== published) return;
    const outputType = published ? (state.publishedRun?.outputType || caseOutputType(c)) : caseOutputType(c);
    card.outerHTML = renderCaseResultCard(slot, { c, published, outputType });
  }

  function renderCompare() {
    const c = activeCase();
    const box = $('#compare');
    const slots = displaySlots();
    const published = state.resultOrigin === 'published';
    const outputType = published ? (state.publishedRun?.outputType || caseOutputType(c)) : caseOutputType(c);
    box.style.setProperty('--compare-cols', String(Math.min(3, Math.max(1, slots.length))));

    if (published && state.publishedLoading) {
      box.innerHTML = `<div class="result-skeleton" aria-label="正在读取精选结果"></div><div class="result-skeleton" aria-hidden="true"></div>`;
      return;
    }
    if (published && state.publishedError) {
      box.innerHTML = `<div class="published-empty"><div>
        <strong>精选结果读取失败</strong>
        <span>${escapeHtml(state.publishedError)}。已有题目内容仍可查看，你可以重新加载结果。</span>
        <button type="button" class="ghost-btn" data-retry-published>重新加载</button>
      </div></div>`;
      return;
    }
    if (published && !state.publishedRun) {
      box.innerHTML = `<div class="published-empty"><div>
        <strong>这道题还没有公开结果</strong>
        <span>${state.isAdmin ? '选择模型跑完本题，检查输出后再发布为题库结果。' : '管理员确认发布后，这里会直接展示多模型实测输出。'}</span>
        ${state.isAdmin ? '<button type="button" class="ghost-btn" data-start-run>运行并生成结果</button>' : ''}
      </div></div>`;
      return;
    }
    if (!slots.length) {
      box.innerHTML = `<div class="published-empty"><div>
        <strong>还没有可运行的模型</strong>
        <span>打开「模型设置」，配置本机 Key 或勾选管理员模型后继续。</span>
        <button type="button" class="ghost-btn" data-open-settings>打开模型设置</button>
      </div></div>`;
      return;
    }
    box.innerHTML = slots
      .map((m) => renderCaseResultCard(m, { c, published, outputType }))
      .join('');
  }

  async function loadPublishedRuns(caseId, { version = null } = {}) {
    if (!caseId) return;
    state.publishedCaseId = caseId;
    state.publishedLoading = true;
    state.publishedError = '';
    state.publishedHistory = [];
    applyPublishedRun(null);
    renderStage();
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/published-runs?limit=20`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (state.activeId !== caseId || state.publishedCaseId !== caseId) return;
      state.publishedHistory = data.history || [];
      let selectedRun = data.featuredRun || null;
      const requested = Number(version ?? new URL(location.href).searchParams.get('run'));
      if (Number.isInteger(requested) && requested > 0 && requested !== Number(selectedRun?.version)) {
        const versionRes = await fetch(`/api/cases/${encodeURIComponent(caseId)}/published-runs/${requested}`);
        const versionData = await versionRes.json().catch(() => ({}));
        if (!versionRes.ok) throw new Error(versionData.error || `HTTP ${versionRes.status}`);
        selectedRun = versionData.publishedRun;
      }
      state.publishedLoading = false;
      applyPublishedRun(selectedRun);
      renderStage();
    } catch (err) {
      if (state.activeId !== caseId || state.publishedCaseId !== caseId) return;
      state.publishedLoading = false;
      state.publishedError = err?.message || '网络错误';
      applyPublishedRun(null);
      renderStage();
    }
  }

  async function loadPublishedVersion(version) {
    const c = activeCase();
    if (!c || !Number.isInteger(Number(version))) return;
    const numericVersion = Number(version);
    state.publishedLoading = true;
    state.publishedError = '';
    renderStage();
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(c.id)}/published-runs/${numericVersion}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (state.activeId !== c.id) return;
      state.publishedLoading = false;
      applyPublishedRun(data.publishedRun);
      setUrlPublishedVersion(numericVersion, data.publishedRun?.isFeatured);
      renderStage();
    } catch (err) {
      state.publishedLoading = false;
      state.publishedError = '';
      renderStage();
      toast(err?.message || '历史版本读取失败');
    }
  }

  async function loadCases() {
    const params = new URLSearchParams({
      category: state.filter,
      difficulty: state.difficulty,
      q: state.q,
      ready: state.isAdmin ? 'all' : 'only',
    });
    const res = await fetch(`/api/cases?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.cases = data.cases || [];
    const urlCase = new URL(location.href).searchParams.get('case');
    if (urlCase && state.cases.some((c) => c.id === urlCase)) {
      state.activeId = urlCase;
    } else if (!state.activeId || !state.cases.some((c) => c.id === state.activeId)) {
      state.activeId = state.cases[0]?.id || null;
    }
    if (state.activeId) setUrlCase(state.activeId);
    renderCaseList();
    if (state.activeId) await loadPublishedRuns(state.activeId);
    else renderStage();
  }

  async function loadSiteModels() {
    const res = await fetch('/api/site-models');
    const data = await res.json();
    state.siteModels = data.models || [];
    // auto-select models that have keys if none selected
    if (!state.selectedSiteIds.size) {
      state.siteModels.filter((m) => m.hasKey).forEach((m) => state.selectedSiteIds.add(m.id));
    }
    // drop selected ids that no longer exist
    [...state.selectedSiteIds].forEach((id) => {
      if (!state.siteModels.some((m) => m.id === id)) state.selectedSiteIds.delete(id);
    });
    saveSettings();
    renderModelStrip();
    renderCompare();
    renderTestModelPicker();
  }

  function buildRunPayload(m, { system = '', prompt, outputType = 'text' }) {
    const finalSystem = effectiveRunSystem(system, outputType);
    return m.kind === 'site'
      ? {
          siteModelId: m.siteModelId,
          system: finalSystem,
          prompt,
          temperature: 0.7,
          maxTokens: outputType === 'html' ? HTML_MIN_TOKENS : 2048,
        }
      : {
          baseUrl: m.baseUrl,
          apiKey: m.apiKey,
          model: m.model,
          system: finalSystem,
          prompt,
          temperature: m.temperature != null ? m.temperature : 0.7,
          maxTokens:
            outputType === 'html'
              ? Math.max(m.maxTokens || 2048, HTML_MIN_TOKENS)
              : (m.maxTokens || 2048),
        };
  }

  async function requestSlotRunPlain(m, payload, startedAt) {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        status: 'error',
        error: data.error || `HTTP ${res.status}`,
        errorCode: data.code || '',
        retryAfterMs: data.retryAfterMs || null,
        latencyMs: data.latencyMs,
        startedAt,
        finishedAt: Date.now(),
      };
    }
    const content = data.content || '';
    if (!String(content).trim()) {
      return {
        status: 'error',
        error: '模型返回了空内容。请重新运行，或检查该模型是否支持当前输出类型。',
        latencyMs: data.latencyMs,
        startedAt,
        finishedAt: Date.now(),
      };
    }
    return {
      status: 'ok',
      content,
      latencyMs: data.latencyMs,
      usage: data.usage || {},
      model: m.model,
      reportedModel: data.model && data.model !== m.model ? data.model : '',
      label: m.label,
      startedAt,
      finishedAt: Date.now(),
    };
  }

  async function requestSlotRunStream(m, payload, { startedAt, onUpdate }) {
    const res = await fetch(STREAM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 404 || res.status === 405) return requestSlotRunPlain(m, payload, startedAt);
      return {
        status: 'error',
        error: data.error || `HTTP ${res.status}`,
        errorCode: data.code || '',
        retryAfterMs: data.retryAfterMs || null,
        latencyMs: data.latencyMs,
        startedAt,
        finishedAt: Date.now(),
      };
    }
    if (!res.body) return requestSlotRunPlain(m, payload, startedAt);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoningChars = 0;
    let doneData = null;
    let streamError = null;

    function applyEvent(event) {
      if (!event || typeof event !== 'object') return;
      if (event.type === 'delta') {
        content += event.text || '';
        onUpdate?.({ content, streamedChars: content.length, retrying: false, updatedAt: Date.now() });
      } else if (event.type === 'reasoning') {
        reasoningChars = Number(event.total || reasoningChars + Number(event.chars || 0));
        onUpdate?.({ content, reasoningChars, updatedAt: Date.now() });
      } else if (event.type === 'retry') {
        content = '';
        reasoningChars = 0;
        onUpdate?.({
          content,
          reasoningChars,
          retrying: true,
          retryReason: event.reason || 'reasoning_only',
          updatedAt: Date.now(),
        });
      } else if (event.type === 'done') {
        doneData = event.data || {};
      } else if (event.type === 'error') {
        streamError = {
          error: event.error || '上游请求失败',
          latencyMs: event.latencyMs,
        };
      }
    }

    function consumeLine(line) {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      try {
        applyEvent(JSON.parse(trimmed));
      } catch {}
    }

    onUpdate?.({ content: '', reasoningChars: 0, startedAt });
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(consumeLine);
      if (streamError) break;
    }
    if (streamError) {
      try {
        await reader.cancel();
      } catch {}
    }
    if (buffer) consumeLine(buffer);

    if (streamError) {
      return {
        status: 'error',
        error: streamError.error,
        latencyMs: streamError.latencyMs,
        content,
        reasoningChars,
        startedAt,
        finishedAt: Date.now(),
      };
    }

    const finalContent = doneData?.content || content;
    if (!String(finalContent).trim()) {
      return {
        status: 'error',
        error: reasoningChars
          ? `模型只返回了推理过程，没有返回最终正文；本次收到约 ${reasoningChars} 字推理内容。请重新运行，或换非推理/更稳定的模型。`
          : '模型返回了空内容。请重新运行，或检查该模型是否支持当前输出类型。',
        content,
        reasoningChars,
        latencyMs: doneData?.latencyMs,
        startedAt,
        finishedAt: Date.now(),
      };
    }

    return {
      status: 'ok',
      content: finalContent,
      latencyMs: doneData?.latencyMs,
      usage: doneData?.usage || {},
      model: m.model,
      reportedModel: doneData?.model && doneData.model !== m.model ? doneData.model : '',
      label: m.label,
      startedAt,
      finishedAt: Date.now(),
    };
  }

  async function requestSlotRun(m, { system = '', prompt, outputType = 'text', onUpdate } = {}) {
    const startedAt = Date.now();
    const payload = buildRunPayload(m, { system, prompt, outputType });
    try {
      if (!window.ReadableStream || !window.TextDecoder) {
        return requestSlotRunPlain(m, payload, startedAt);
      }
      return await requestSlotRunStream(m, payload, { startedAt, onUpdate });
    } catch (err) {
      return {
        status: 'error',
        error: err?.message || '网络错误',
        startedAt,
        finishedAt: Date.now(),
      };
    }
  }

  function batchRunFailureMessage(results, fallback) {
    const errors = Object.values(results || {}).filter((row) => row?.status === 'error');
    const siteLimit = errors.find((row) => row.errorCode === 'site_rate_limit');
    return siteLimit?.error || fallback;
  }

  async function runAll() {
    const c = activeCase();
    if (!c || state.running) return;
    const slots = runSlots();
    if (!slots.length) {
      toast('请先选择可用模型');
      openModal('modal-settings');
      return;
    }
    const prompt = casePromptForRun(c);
    if (!prompt) {
      toast('提示词不能为空');
      return;
    }
    const outputType = caseOutputType(c);
    const baseSystem = c.system || '';
    const requestContext = { system: baseSystem, prompt, outputType };
    const runContext = {
      caseId: c.id,
      prompt,
      requestSystem: baseSystem,
      system: effectiveRunSystem(baseSystem, outputType),
      outputType,
      slots: slots.map((slot) => runSlotSnapshot(slot, requestContext)),
    };
    const runToken = beginCaseRun(c.id);
    const runResults = {};
    state.resultOrigin = 'live';
    state.liveSlots = runContext.slots;
    state.liveRunContext = runContext;
    setUrlPublishedVersion(null, true);
    state.results = runResults;
    state.scores = {};
    state.scoreOpen.clear();
    slots.forEach((m) => {
      runResults[m.key] = { status: 'running', content: '', startedAt: Date.now() };
    });
    const slotRunTokens = new Map(slots.map((m) => [m.key, beginCaseSlotRun(m.key)]));
    startRunTicker();
    updateResultActions();
    const btn = $('#btn-run');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '运行中…';
    $('#run-status').textContent = `并行请求 ${slots.length} 个模型…`;
    renderSnapshotMeta();
    renderModelStrip();
    renderCompare();

    await Promise.all(
      slots.map(async (m) => {
        const slotRunToken = slotRunTokens.get(m.key);
        const result = await requestSlotRun(m, {
          system: baseSystem,
          prompt,
          outputType: runContext.outputType,
          onUpdate: (patch) => {
            if (!isCurrentCaseSlotRun(m.key, slotRunToken, runToken, c.id)) return;
            runResults[m.key] = { ...runResults[m.key], status: 'running', ...patch };
            state.results = runResults;
            queueResultRender('case', m.key);
          },
        });
        if (!isCurrentCaseSlotRun(m.key, slotRunToken, runToken, c.id)) return;
        runResults[m.key] = result;
        state.results = runResults;
        finishCaseSlotRun(m.key, slotRunToken);
        renderSnapshotMeta();
        queueResultRender('case', m.key);
        updateResultActions();
      })
    );

    while (isCurrentCaseRun(runToken, c.id) && caseSlotRunTokens.size) {
      await waitForCaseSlotsIdle();
    }
    if (!isCurrentCaseRun(runToken, c.id)) return;
    state.caseRunToken = '';
    state.running = caseSlotRunTokens.size > 0;
    state.hasRunOnce = true;
    saveSettings();
    btn.disabled = false;
    btn.classList.remove('loading');
    const ok = Object.values(runResults).filter((r) => r.status === 'ok').length;
    const fail = Object.values(runResults).filter((r) => r.status === 'error').length;
    $('#run-status').textContent = `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
    renderSnapshotMeta();
    updateResultActions();
    const history = ok
      ? await recordCaseRunHistory({
          caseId: runContext.caseId,
          prompt: runContext.prompt,
          outputType: runContext.outputType,
          slots: runContext.slots,
          results: runResults,
        })
      : { ok: false, skipped: true };
    toast(
      ok && !history.ok && !history.skipped
        ? `跑完了，但历史记录保存失败：${history.error}`
        : ok
          ? `跑完了，${ok} 个模型有结果`
          : batchRunFailureMessage(runResults, '全部失败，请检查 Key / 接口')
    );
  }

  async function rerunSlot(slotKey, source = 'case') {
    const isTest = source === 'test';
    const slots = isTest ? configuredSlots({ selectedSiteOnly: false }) : runSlots();
    const slot = slots.find((m) => m.key === slotKey);
    if (!slot) {
      toast('这个模型配置已经不可用');
      return;
    }
    const current = isTest ? state.testResults[slotKey] : state.results[slotKey];
    if (current?.status === 'running') return;

    let prompt = '';
    let system = '';
    let outputType = 'text';
    let caseId = '';
    let caseRunToken = '';
    let caseSlotRunToken = '';
    let joinedCaseRun = false;
    let testRunToken = '';
    let caseResults = null;
    let effectiveSlot = null;
    if (isTest) {
      prompt = $('#test-prompt')?.value?.trim() || '';
      outputType = $('#test-output-type')?.value === 'html' ? 'html' : 'text';
      state.testOutputType = outputType;
      if (!prompt) {
        toast('请先输入提示词');
        return;
      }
      testRunToken = beginTestSlotRun(slotKey);
      state.testResults[slotKey] = {
        status: 'running',
        content: '',
        outputType,
        startedAt: Date.now(),
      };
      const testRunButton = $('#btn-test-run');
      testRunButton.disabled = true;
      testRunButton.classList.add('loading');
      testRunButton.textContent = '运行中…';
      startRunTicker();
      $('#test-run-status').textContent = `正在重新运行 ${slot.label}…`;
      queueResultRender('test', slotKey);
    } else {
      const c = activeCase();
      if (!c) return;
      caseId = c.id;
      const activeRunContext = isCurrentCaseRun(state.caseRunToken, caseId)
        ? state.liveRunContext
        : null;
      prompt = activeRunContext?.prompt || casePromptForRun(c);
      if (!prompt) {
        toast('提示词不能为空');
        return;
      }
      system = activeRunContext?.requestSystem ?? c.system ?? '';
      outputType = activeRunContext
        ? (activeRunContext.outputType === 'html' ? 'html' : 'text')
        : caseOutputType(c);
      const effectiveSystem = effectiveRunSystem(system, outputType);
      const previousContext = state.liveRunContext;
      const sameContext =
        previousContext?.caseId === caseId &&
        previousContext.prompt === prompt &&
        previousContext.system === effectiveSystem &&
        previousContext.outputType === outputType;
      caseResults = sameContext ? state.results : {};
      effectiveSlot = runSlotSnapshot(slot, { system, prompt, outputType });
      joinedCaseRun = !!activeRunContext && sameContext;
      state.resultOrigin = 'live';
      state.liveSlots = sameContext
        ? [
            ...state.liveSlots.filter((item) => item.key !== slotKey),
            effectiveSlot,
          ]
        : [effectiveSlot];
      state.liveRunContext = {
        caseId,
        prompt,
        requestSystem: system,
        system: effectiveSystem,
        outputType,
        slots: state.liveSlots,
      };
      caseRunToken = joinedCaseRun ? state.caseRunToken : beginCaseRun(caseId);
      caseSlotRunToken = beginCaseSlotRun(slotKey);
      state.results = caseResults;
      caseResults[slotKey] = { status: 'running', content: '', startedAt: Date.now() };
      const runButton = $('#btn-run');
      runButton.disabled = true;
      runButton.classList.add('loading');
      runButton.textContent = '运行中…';
      startRunTicker();
      $('#run-status').textContent = `正在重新运行 ${slot.label}…`;
      renderSnapshotMeta();
      if (sameContext && findResultCard($('#compare'), slotKey)) {
        queueResultRender('case', slotKey);
      } else {
        renderCompare();
      }
    }

    const result = await requestSlotRun(slot, {
      system,
      prompt,
      outputType,
      onUpdate: (patch) => {
        if (isTest) {
          if (!isCurrentTestSlotRun(slotKey, testRunToken)) return;
          state.testResults[slotKey] = { ...state.testResults[slotKey], status: 'running', ...patch };
          queueResultRender('test', slotKey);
        } else if (isCurrentCaseSlotRun(slotKey, caseSlotRunToken, caseRunToken, caseId)) {
          caseResults[slotKey] = { ...caseResults[slotKey], status: 'running', ...patch };
          state.results = caseResults;
          queueResultRender('case', slotKey);
        }
      },
    });
    let history = { ok: false, skipped: true };
    if (isTest) {
      if (!isCurrentTestSlotRun(slotKey, testRunToken)) return;
      state.testResults[slotKey] = { ...result, outputType };
      finishTestSlotRun(slotKey, testRunToken);
      queueResultRender('test', slotKey);
      const ok = Object.values(state.testResults).filter((r) => r.status === 'ok').length;
      const fail = Object.values(state.testResults).filter((r) => r.status === 'error').length;
      const running = Object.values(state.testResults).filter((r) => r.status === 'running').length;
      $('#test-run-status').textContent = running
        ? `${ok} 成功 · ${running} 运行中${fail ? ` · ${fail} 失败` : ''}`
        : `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
      if (!state.testRunning) {
        const testRunButton = $('#btn-test-run');
        testRunButton.disabled = false;
        testRunButton.classList.remove('loading');
        testRunButton.textContent = '运行提示词';
      }
    } else {
      if (!isCurrentCaseSlotRun(slotKey, caseSlotRunToken, caseRunToken, caseId)) return;
      caseResults[slotKey] = result;
      state.results = caseResults;
      finishCaseSlotRun(slotKey, caseSlotRunToken);
      if (!joinedCaseRun) state.caseRunToken = '';
      const runButton = $('#btn-run');
      if (!state.running && !joinedCaseRun) {
        runButton.disabled = false;
        runButton.classList.remove('loading');
      }
      renderSnapshotMeta();
      queueResultRender('case', slotKey);
      const ok = Object.values(caseResults).filter((r) => r.status === 'ok').length;
      const fail = Object.values(caseResults).filter((r) => r.status === 'error').length;
      const running = Object.values(caseResults).filter((r) => r.status === 'running').length;
      $('#run-status').textContent = running
        ? `${ok} 成功 · ${running} 运行中${fail ? ` · ${fail} 失败` : ''}`
        : `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
      if (result.status === 'ok' && !joinedCaseRun) {
        history = await recordCaseRunHistory({
          caseId,
          prompt,
          outputType,
          slots: [effectiveSlot],
          results: { [slotKey]: result },
        });
      }
    }
    updateResultActions();
    toast(
      result.status === 'ok' && !history.ok && !history.skipped
        ? `${slot.label} 已生成，但历史记录保存失败：${history.error}`
        : result.status === 'ok'
          ? `${slot.label} 已重新生成`
          : `${slot.label} 重新运行失败`
    );
  }

  function openModal(id, initialFocus = null) {
    const overlay = $(`#${id}`);
    if (!overlay) return;
    modalReturnFocus.set(id, document.activeElement);
    overlay.classList.add('open');
    requestAnimationFrame(() => {
      const preferred = initialFocus && overlay.contains(initialFocus)
        ? initialFocus
        : overlay.querySelector('[autofocus], input:not([type="hidden"]), textarea, select, button, a[href]');
      preferred?.focus({ preventScroll: true });
    });
  }
  function closeModal(id) {
    const overlay = $(`#${id}`);
    if (!overlay) return;
    overlay.classList.remove('open');
    if (id === 'modal-delete-record') state.pendingDelete = null;
    const trigger = modalReturnFocus.get(id);
    modalReturnFocus.delete(id);
    if (trigger && document.contains(trigger)) trigger.focus();
  }

  function trapModalFocus(event) {
    if (event.key !== 'Tab') return;
    const overlay = $$('.overlay.open').at(-1);
    if (!overlay) return;
    const focusable = $$('button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', overlay)
      .filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderSettingsEditor() {
    const siteBox = $('#site-models-list');
    if (!state.siteModels.length) {
      siteBox.innerHTML =
        '<p class="hint" style="margin:0">暂无站点模型。管理员可在后台配置 Key 后，访客无需自备 Key 也能运行。</p>';
    } else {
      siteBox.innerHTML = state.siteModels
        .map((m) => {
          const checked = state.selectedSiteIds.has(m.id) ? 'checked' : '';
          return `<label class="check-line">
            <input type="checkbox" data-site-toggle="${escapeHtml(m.id)}" ${checked} ${m.hasKey ? '' : 'disabled'} />
            <span><b>${escapeHtml(m.label)}</b>
              <span style="color:var(--muted);font-family:var(--font-mono);font-size:11px"> ${escapeHtml(m.model)} · ${m.hasKey ? '可用' : '未配 Key'}</span>
            </span>
          </label>`;
        })
        .join('');
    }

    // templates
    const tpl = $('#ai-template-list');
    const active = activeProfile();
    tpl.innerHTML = PRESETS.map((p) => {
      const on = active && active.provider === p.id ? 'active' : '';
      return `<button type="button" class="${on}" data-preset="${escapeHtml(p.id)}" title="${escapeHtml(p.description || '')}">${escapeHtml(p.name)}${p.recommended ? ' ★' : ''}</button>`;
    }).join('');

    // profile list
    const list = $('#ai-profile-list');
    list.innerHTML = state.profiles
      .map((p) => {
        const on = p.id === state.activeProfileId ? 'active' : '';
        return `<button type="button" class="ai-profile-item ${on}" data-profile="${escapeHtml(p.id)}">
          <strong>${escapeHtml(p.name)}</strong>
          <div class="sub">${escapeHtml((p.selectedModels && p.selectedModels.length) ? p.selectedModels.slice(0,3).join(', ') + (p.selectedModels.length>3?'…':'') : (p.model || '未选模型'))}</div>
          <div class="flags">
            ${p.enabled ? '<span class="tag">参与对比</span>' : ''}
            <span class="tag">${(p.selectedModels||[]).length || 0} 模型</span>
            ${p.apiKey ? '<span class="tag">key✓</span>' : '<span class="tag">缺key</span>'}
            ${p.isDefault ? '<span class="tag">默认</span>' : ''}
          </div>
        </button>`;
      })
      .join('');

    fillProfileForm(active);
  }

  function fillProfileForm(p) {
    if (!p) return;
    $('#ai-name').value = p.name || '';
    $('#ai-provider-name').value = p.providerName || '';
    $('#ai-provider-id').value = p.provider || '';
    $('#ai-api-key').value = p.apiKey || '';
    $('#ai-base-url').value = p.baseUrl || '';
    $('#ai-model').value = p.model || '';
    $('#ai-temperature').value = p.temperature != null ? p.temperature : 0.7;
    $('#ai-max-tokens').value = p.maxTokens || 2048;
    $('#ai-enabled').checked = p.enabled !== false;
    $('#ai-default').checked = !!p.isDefault;

    const preset = PRESET_MAP[p.provider];
    const availableModels = Array.isArray(p.availableModels) && p.availableModels.length
      ? p.availableModels
      : (preset?.quickModels || []);
    fillModelSelect(availableModels, p.selectedModels || (p.model ? [p.model] : []), p.model);
    const link = $('#ai-key-link');
    if (preset && preset.apiKeyUrl) {
      link.href = preset.apiKeyUrl;
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }

    const qm = $('#ai-quick-models');
    const models = (preset && preset.quickModels) || [];
    qm.innerHTML = models.length
      ? models
          .map(
            (m) =>
              `<button type="button" data-quick-model="${escapeHtml(m)}">${escapeHtml(m)}</button>`
          )
          .join('')
      : '<span class="hint" style="margin:0">无快捷模型，可手填 Model ID</span>';

    $('#ai-form-note').textContent = preset
      ? preset.description || ''
      : 'Key 与配置仅保存在本浏览器，可随时删除。';
  }

  function readProfileForm() {
    const cur = activeProfile() || createProfileFromPreset(DEFAULT_PRESET);
    const provider = $('#ai-provider-id').value.trim() || 'custom';
    return normalizeProfile(
      {
        ...cur,
        id: cur.id,
        name: $('#ai-name').value.trim() || '未命名配置',
        provider,
        providerName: $('#ai-provider-name').value.trim() || provider,
        baseUrl: $('#ai-base-url').value.trim(),
        model: $('#ai-model').value.trim(),
        apiKey: sanitizeApiKey($('#ai-api-key').value),
        temperature: Number($('#ai-temperature').value || 0.7),
        maxTokens: Number($('#ai-max-tokens').value || 2048),
        enabled: $('#ai-enabled').checked,
        isDefault: $('#ai-default').checked,
        selectedModels: readSelectedModelsFromDom(),
        availableModels: (activeProfile()?.availableModels || []).slice(),
        updatedAt: Date.now(),
      },
      0
    );
  }

  function upsertActiveProfileFromForm() {
    const next = readProfileForm();
    if (next.apiKey) {
      const chk = validateApiKeyClient(next.apiKey);
      if (!chk.ok) {
        toast(chk.error);
        throw new Error(chk.error);
      }
      next.apiKey = chk.key;
    }
    const idx = state.profiles.findIndex((p) => p.id === next.id);
    if (idx >= 0) state.profiles[idx] = next;
    else state.profiles.push(next);
    if (next.isDefault) {
      state.profiles = state.profiles.map((p) => ({ ...p, isDefault: p.id === next.id }));
    }
    state.profiles = ensureSingleDefault(state.profiles);
    state.activeProfileId = next.id;
    saveProfiles();
    return next;
  }

  function applyPresetToForm(presetId) {
    const preset = presetById(presetId);
    if (!preset) return;
    const cur = activeProfile() || createProfileFromPreset(presetId);
    // Always apply preset Base URL (user asked for preset base url when adding models)
    const next = {
      ...cur,
      name: cur.apiKey && cur.name && cur.name !== '未命名配置' ? cur.name : preset.name,
      provider: preset.id,
      providerName: preset.name,
      providerType: preset.providerType,
      providerCategory: preset.category,
      apiKeyUrl: preset.apiKeyUrl || '',
      baseUrl: preset.baseUrl || '',
      model: preset.defaultModel || '',
      selectedModels: preset.defaultModel ? [preset.defaultModel] : [],
      availableModels: Array.isArray(preset.quickModels) ? [...preset.quickModels] : [],
    };
    const idx = state.profiles.findIndex((p) => p.id === cur.id);
    if (idx >= 0) state.profiles[idx] = normalizeProfile(next, idx);
    else {
      state.profiles.push(normalizeProfile(next, state.profiles.length));
    }
    state.activeProfileId = cur.id;
    renderSettingsEditor();
    toast(`已应用 ${preset.name} 预设 Base URL`);
  }

  function fillModelSelect(models, selectedList, defaultModel = '') {
    const box = $('#ai-model-checks');
    const list = $('#ai-model-list');
    if (!box) return;
    const ids = Array.isArray(models) ? [...new Set(models.map(String))] : [];
    if (list) {
      list.innerHTML = ids.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
    }
    const selected = new Set(
      Array.isArray(selectedList) && selectedList.length
        ? selectedList
        : []
    );
    if (!ids.length) {
      box.innerHTML =
        '<p class="hint" style="margin:0">先点「拉取模型」，再勾选多个模型用于前台对比（同一 API Key）。</p>';
      return;
    }
    box.innerHTML = ids
      .map((m) => {
        const checked =
          selected.has(m) ||
          (selected.size === 0 && m === (defaultModel || ids[0]));
        return `<label class="model-check-row"><input type="checkbox" data-model-check="${escapeHtml(m)}" ${checked ? 'checked' : ''}/><span class="model-id">${escapeHtml(m)}</span></label>`;
      })
      .join('');
  }

  function readSelectedModelsFromDom() {
    const checks = $$('#ai-model-checks [data-model-check]:checked');
    const selected = checks.map((el) => el.getAttribute('data-model-check')).filter(Boolean);
    if (selected.length) return selected;
    const single = $('#ai-model')?.value?.trim();
    return single ? [single] : [];
  }

  function setAllModelChecks(on) {
    $$('#ai-model-checks [data-model-check]').forEach((el) => {
      el.checked = !!on;
    });
  }

  async function fetchRemoteModels() {
    const baseUrl = normalizeBaseUrl($('#ai-base-url').value);
    const keyCheck = validateApiKeyClient($('#ai-api-key').value);
    if (!baseUrl) {
      toast('请先填写 Base URL（可选快捷模板自动填）');
      return;
    }
    if (!keyCheck.ok) {
      toast(keyCheck.error);
      return;
    }
    const btn = $('#ai-fetch-models');
    btn.disabled = true;
    btn.textContent = '拉取中…';
    try {
      const res = await fetch('/api/list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: keyCheck.key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const models = data.models || [];
      if (!models.length) {
        toast('接口未返回模型列表，请手填模型 ID 或点快捷模型');
        fillModelSelect([]);
        return;
      }
      const cur = activeProfile();
      if (cur) {
        cur.availableModels = models;
        // keep previous selection if still valid, else select first 3 useful
        let sel = (cur.selectedModels || []).filter((m) => models.includes(m));
        if (!sel.length) {
          const preset = PRESET_MAP[cur.provider];
          const prefer = [cur.model, ...(preset?.quickModels || [])].filter(Boolean);
          sel = prefer.filter((m) => models.includes(m)).slice(0, 3);
          if (!sel.length) sel = models.slice(0, Math.min(3, models.length));
        }
        cur.selectedModels = sel;
        if (!cur.model || !models.includes(cur.model)) cur.model = sel[0] || models[0];
        $('#ai-model').value = cur.model;
        saveProfiles();
      }
      fillModelSelect(models, cur?.selectedModels || []);
      toast(`已拉取 ${models.length} 个模型，已勾选 ${(cur?.selectedModels || []).length} 个 · ${data.latencyMs ?? '—'}ms`);
    } catch (err) {
      toast(err.message || '拉取失败');
    } finally {
      btn.disabled = false;
      btn.textContent = '拉取模型';
    }
  }


  function exportResults() {
    const c = activeCase();
    if (!c) return;
    const slots = displaySlots();
    if (!slots.some((m) => state.results[m.key]?.status === 'ok')) {
      toast('没有可导出的成功结果');
      return;
    }
    const exportedPrompt = state.resultOrigin === 'published'
      ? state.publishedRun?.prompt || c.prompt
      : state.liveRunContext?.prompt || casePromptForRun(c);
    const lines = [
      `# ${c.title}`,
      '',
      `分类：${categoryLabel(c.category)}`,
      ...(state.resultOrigin === 'published' && state.publishedRun
        ? [`公开版本：v${state.publishedRun.version} · ${formatDateTime(state.publishedRun.publishedAt)}`, '']
        : []),
      '',
      '## Prompt',
      '',
      exportedPrompt,
      '',
      '## Results',
      '',
    ];
    slots.forEach((m) => {
      const r = state.results[m.key];
      lines.push(`### ${m.label}`);
      if (!r || r.status !== 'ok') {
        lines.push(r?.error || '无结果');
      } else {
        lines.push(`latency: ${r.latencyMs ?? '—'}ms`);
        lines.push('');
        lines.push(r.content);
        const sc = state.scores[m.key];
        if (sc && Object.keys(sc).length) {
          lines.push('');
          lines.push('scores: ' + JSON.stringify(sc));
        }
      }
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${c.id || 'case'}-results.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 Markdown');
  }

  function successfulCaseRows({ results = state.results, slots = displaySlots(), outputType = caseOutputType(activeCase()) } = {}) {
    const slotMap = new Map(slots.map((m) => [m.key, m]));
    return Object.entries(results)
      .filter(([, r]) => r?.status === 'ok')
      .map(([key, r]) => {
        const slot = slotMap.get(key);
        return {
          model: slot?.model || r.model || key,
          label: slot?.label || r.label || r.model || key,
          providerName: slot?.providerName || '',
          profileName: slot?.profileName || '',
          keySource: slot?.keySource || '',
          reportedModel: r.reportedModel || '',
          content: r.content || '',
          latencyMs: r.latencyMs,
          outputType: outputType === 'html' ? 'html' : 'text',
        };
      });
  }

  async function recordCaseRunHistory({ caseId, prompt, outputType, slots, results = state.results } = {}) {
    const rows = successfulCaseRows({ results, slots, outputType });
    if (!caseId || !rows.length) return { ok: false, skipped: true };
    try {
      const res = await fetch('/api/run-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          prompt,
          results: rows,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return { ok: true, id: data.id };
    } catch (err) {
      return { ok: false, error: err?.message || '网络错误' };
    }
  }

  function publishedRowsFromLive() {
    const outputType = state.liveRunContext?.outputType === 'html' ? 'html' : 'text';
    const slotMap = new Map((state.liveSlots || []).map((slot) => [slot.key, slot]));
    return Object.entries(state.results)
      .filter(([, result]) => result?.status === 'ok' || result?.status === 'error')
      .map(([key, result]) => {
        const slot = slotMap.get(key) || {};
        return {
          status: result.status,
          model: slot.model || result.model || key,
          label: slot.label || result.label || result.model || key,
          providerName: slot.providerName || '',
          profileName: slot.profileName || '',
          reportedModel: result.reportedModel || '',
          content: result.content || '',
          error: result.error || '',
          latencyMs: result.latencyMs,
          usage: result.usage || {},
          outputType,
          scores: state.scores[key] || {},
          parameters: {
            temperature: slot.temperature,
            maxTokens: slot.maxTokens,
          },
        };
      });
  }

  function openPublishDialog() {
    const c = activeCase();
    const rows = publishedRowsFromLive();
    const ok = rows.filter((row) => row.status === 'ok' && row.content.trim()).length;
    const failed = rows.filter((row) => row.status === 'error').length;
    if (!state.isAdmin || !c || state.liveRunContext?.caseId !== c.id || !ok) {
      toast('请先以管理员身份完成本题运行');
      return;
    }
    $('#publish-summary').textContent = `「${c.title}」本次 ${ok} 个模型成功${failed ? `、${failed} 个失败` : ''}。确认后将成为访客默认看到的精选结果，旧版本继续保留。`;
    $('#publish-checklist').innerHTML = [
      `<span>Prompt 与当前题目一致</span>`,
      `<span>${ok} 个成功结果将公开${failed ? `，并保留 ${failed} 个失败状态` : ''}</span>`,
      `<span>API Key 与 Base URL 不会写入快照</span>`,
    ].join('');
    $('#publish-note').value = '';
    openModal('modal-publish');
  }

  async function publishLiveResults() {
    const c = activeCase();
    const rows = publishedRowsFromLive();
    if (!state.isAdmin || !c || state.liveRunContext?.caseId !== c.id) return;
    const button = $('#btn-confirm-publish');
    button.disabled = true;
    button.textContent = '发布中…';
    try {
      const firstSlot = state.liveSlots[0] || {};
      const res = await fetch(`/api/admin/cases/${encodeURIComponent(c.id)}/published-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: state.liveRunContext.prompt,
          system: state.liveRunContext.system,
          results: rows,
          runConfig: {
            temperature: firstSlot.temperature,
            maxTokens: firstSlot.maxTokens,
          },
          note: $('#publish-note').value.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      closeModal('modal-publish');
      state.publishedRun = data.publishedRun;
      state.publishedHistory = [
        data.publishedRun,
        ...state.publishedHistory.filter((run) => run.version !== data.publishedRun.version),
      ];
      applyPublishedRun(data.publishedRun);
      setUrlPublishedVersion(null, true);
      renderStage();
      toast(`已发布精选结果 v${data.publishedRun.version}`);
      await loadCases();
    } catch (err) {
      toast(err?.message || '发布失败');
    } finally {
      button.disabled = false;
      button.textContent = '确认发布';
    }
  }

  async function restorePublishedResults() {
    const c = activeCase();
    if (!c) return;
    setUrlPublishedVersion(null, true);
    await loadPublishedRuns(c.id);
  }

  async function checkAdmin() {
    try {
      const res = await fetch('/api/admin/me');
      const data = await res.json().catch(() => ({}));
      state.isAdmin = !!data.authenticated;
      $('#admin-entry')?.classList.toggle('hidden', !state.isAdmin);
    } catch {
      state.isAdmin = false;
      $('#admin-entry')?.classList.add('hidden');
    }
  }

  function beginPromptEdit() {
    const c = activeCase();
    if (!state.isAdmin || !c) return;
    state.promptEditing = true;
    state.caseDraftPrompt = c.prompt || '';
    renderStage();
    $('#case-prompt-edit')?.focus();
  }

  function cancelPromptEdit() {
    state.promptEditing = false;
    state.caseDraftPrompt = '';
    renderStage();
  }

  async function saveCurrentCasePrompt({ runAfter = false } = {}) {
    const c = activeCase();
    if (!c || !state.isAdmin) return false;
    const prompt = casePromptForRun(c);
    if (!prompt) {
      toast('提示词不能为空');
      return false;
    }
    const payload = { ...c, prompt, outputType: caseOutputType({ ...c, prompt }) };
    const res = await fetch(`/api/admin/cases/${encodeURIComponent(c.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || '保存失败');
      return false;
    }
    const next = data.case || payload;
    state.cases = state.cases.map((item) => (item.id === c.id ? next : item));
    state.activeId = next.id;
    state.promptEditing = false;
    state.caseDraftPrompt = '';
    renderCaseList();
    renderStage();
    toast(runAfter ? '已保存，开始运行' : '提示词已保存');
    return true;
  }

  function normalizePromptLibraryText(value) {
    return String(value || '').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
  }

  function promptLibraryMatches(item) {
    if (state.promptLibraryCategory !== '全部' && item.category !== state.promptLibraryCategory) return false;
    const query = normalizePromptLibraryText(state.promptLibraryQuery);
    if (!query) return true;
    return normalizePromptLibraryText([
      item.title,
      item.category,
      item.summary,
      ...(item.tags || []),
      item.prompt,
    ].join(' ')).includes(query);
  }

  function renderPromptLibrary() {
    const filters = $('#prompt-library-filters');
    const list = $('#prompt-library-list');
    if (!filters || !list) return;
    const categories = ['全部', ...new Set(PROMPT_LIBRARY.map((item) => item.category).filter(Boolean))];
    filters.innerHTML = categories
      .map((category) => `<button type="button" class="chip" data-prompt-category="${escapeHtml(category)}" aria-pressed="${category === state.promptLibraryCategory ? 'true' : 'false'}">${escapeHtml(category)}</button>`)
      .join('');

    const matches = PROMPT_LIBRARY.filter(promptLibraryMatches);
    $('#prompt-library-count').textContent = `${matches.length} / ${PROMPT_LIBRARY.length} 个案例`;
    if (!matches.length) {
      list.innerHTML = `<div class="prompt-library-empty">
        <strong>没有匹配的案例</strong>
        <span>换个关键词，或清除分类与搜索条件。</span>
        <button type="button" class="ghost-btn mini" data-clear-prompt-filters>清除筛选</button>
      </div>`;
      return;
    }
    list.innerHTML = matches
      .map((item) => `<button type="button" class="prompt-library-card" data-prompt-case="${escapeHtml(item.id)}" ${state.testRunning ? 'disabled' : ''}>
        <span class="prompt-library-card-head">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="tag">${item.outputType === 'html' ? 'HTML' : '文本'}</span>
        </span>
        <span class="prompt-library-card-summary">${escapeHtml(item.summary)}</span>
        <span class="prompt-library-card-prompt">${escapeHtml(item.prompt)}</span>
        <span class="prompt-library-card-foot">
          <span>${escapeHtml(item.category)} · ${escapeHtml((item.tags || []).slice(0, 2).join(' / '))}</span>
          <span class="prompt-library-use">使用此案例</span>
        </span>
      </button>`)
      .join('');
  }

  function openPromptLibrary() {
    state.promptLibraryQuery = '';
    state.promptLibraryCategory = '全部';
    const search = $('#prompt-library-search');
    if (search) search.value = '';
    renderPromptLibrary();
    openModal('modal-prompt-library', search);
  }

  function applyPromptLibraryCase(id) {
    if (state.testRunning) {
      toast('模型运行中，完成后再更换测试案例');
      return;
    }
    const item = PROMPT_LIBRARY.find((entry) => entry.id === id);
    if (!item) return;
    const prompt = $('#test-prompt');
    const outputType = $('#test-output-type');
    prompt.value = item.prompt;
    outputType.value = item.outputType === 'html' ? 'html' : 'text';
    state.testOutputType = outputType.value;
    state.testResults = {};
    state.testViewModes = {};
    $('#test-run-status').textContent = `已载入「${item.title}」，可选择模型运行`;
    renderTestCompare();
    updateResultActions();
    closeModal('modal-prompt-library');
    prompt.focus({ preventScroll: true });
    toast(`已插入「${item.title}」`);
  }

  function renderTestModelPicker() {
    const list = $('#test-model-list');
    if (!list) return;
    const slots = configuredSlots({ selectedSiteOnly: false });
    syncTestSelection(slots);
    if (!slots.length) {
      list.innerHTML = `<div class="empty-state slim"><strong>暂无可用模型</strong>打开「模型设置」添加本机 Key，或让管理员配置站点模型。</div>`;
      renderTestCompare();
      updateResultActions();
      return;
    }
    const groups = new Map();
    slots.forEach((slot) => {
      const key = slot.providerKey || slot.key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slot);
    });
    list.innerHTML = [...groups.entries()]
      .map(([providerKey, children]) => {
        const selectedCount = children.filter((m) => state.testSelectedKeys.has(m.key)).length;
        const allSelected = selectedCount === children.length;
        const first = children[0];
        const source = first.keySource === 'admin' ? '管理员' : '本机 Key';
        const profile = first.profileName || first.providerName || first.label;
        const provider = first.providerName && first.providerName !== profile ? first.providerName : '';
        return `<section class="test-provider-group">
          <label class="test-provider-head ${selectedCount ? 'selected' : ''}">
            <input type="checkbox" data-test-provider="${escapeHtml(providerKey)}" ${allSelected ? 'checked' : ''} />
            <span class="test-provider-title"><b>${escapeHtml(profile)}</b>${provider ? `<span>${escapeHtml(provider)}</span>` : ''}</span>
            <span class="tag">${source}</span>
          </label>
          <div class="test-provider-models">
            ${children.map((m) => {
              const checked = state.testSelectedKeys.has(m.key);
              return `<label class="test-model-row ${checked ? 'selected' : ''}">
                <input type="checkbox" data-test-model="${escapeHtml(m.key)}" ${checked ? 'checked' : ''} />
                <span class="test-model-main"><span>${escapeHtml(m.model || '')}</span></span>
              </label>`;
            }).join('')}
          </div>
        </section>`;
      })
      .join('');
    renderTestCompare();
    updateResultActions();
  }

  function renderTestCompare() {
    const box = $('#test-compare');
    if (!box) return;
    state.testOutputType = $('#test-output-type')?.value === 'html' ? 'html' : 'text';
    const all = configuredSlots({ selectedSiteOnly: false });
    syncTestSelection(all);
    const slots = all.filter((m) => state.testSelectedKeys.has(m.key));
    if (!all.length) {
      box.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><strong>暂无可运行模型</strong>先在「模型设置」里添加或启用模型。</div>`;
      return;
    }
    if (!slots.length) {
      box.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><strong>未选择模型</strong>请至少勾选一个模型。</div>`;
      return;
    }
    box.innerHTML = slots
      .map((m) => renderTestResultCard(m))
      .join('');
  }

  async function runPromptTest() {
    if (state.testRunning) return;
    const prompt = $('#test-prompt').value.trim();
    if (!prompt) {
      toast('请先输入提示词');
      return;
    }
    state.testOutputType = $('#test-output-type').value === 'html' ? 'html' : 'text';
    const outputType = state.testOutputType;
    const slots = testSlots();
    if (!configuredSlots({ selectedSiteOnly: false }).length) {
      toast('请先配置可用模型');
      openModal('modal-settings');
      return;
    }
    if (!slots.length) {
      toast('请至少选择一个模型');
      return;
    }
    state.testRunning = true;
    testRunTokens.clear();
    testRunIdleWaiters.forEach((resolve) => resolve());
    testRunIdleWaiters.clear();
    state.testResults = {};
    slots.forEach((m) => {
      state.testResults[m.key] = {
        status: 'running',
        content: '',
        outputType,
        startedAt: Date.now(),
      };
    });
    startRunTicker();
    updateResultActions();
    const btn = $('#btn-test-run');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '运行中…';
    $('#test-run-status').textContent = `并行请求 ${slots.length} 个模型…`;
    renderTestCompare();

    await Promise.all(
      slots.map(async (m) => {
        const testRunToken = beginTestSlotRun(m.key);
        const result = await requestSlotRun(m, {
          prompt,
          outputType,
          onUpdate: (patch) => {
            if (!isCurrentTestSlotRun(m.key, testRunToken)) return;
            state.testResults[m.key] = { ...state.testResults[m.key], status: 'running', ...patch };
            queueResultRender('test', m.key);
          },
        });
        if (!isCurrentTestSlotRun(m.key, testRunToken)) return;
        state.testResults[m.key] = { ...result, outputType };
        finishTestSlotRun(m.key, testRunToken);
        queueResultRender('test', m.key);
        updateResultActions();
      })
    );

    while (testRunTokens.size) {
      await waitForTestSlotsIdle();
    }
    state.testRunning = false;
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = '运行提示词';
    const ok = Object.values(state.testResults).filter((r) => r.status === 'ok').length;
    const fail = Object.values(state.testResults).filter((r) => r.status === 'error').length;
    const running = Object.values(state.testResults).filter((r) => r.status === 'running').length;
    $('#test-run-status').textContent = running
      ? `${ok} 成功 · ${running} 运行中${fail ? ` · ${fail} 失败` : ''}`
      : `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
    updateResultActions();
    toast(ok
      ? `对比完成，${ok} 个模型有结果`
      : batchRunFailureMessage(state.testResults, '全部失败，请检查模型配置'));
  }

  function successfulTestRows() {
    const slotMap = new Map(configuredSlots({ selectedSiteOnly: false }).map((m) => [m.key, m]));
    return Object.entries(state.testResults)
      .filter(([, r]) => r?.status === 'ok')
      .map(([key, r]) => {
        const slot = slotMap.get(key);
        return {
          model: r.model || slot?.model || key,
          label: slot?.label || r.label || r.model || key,
          content: r.content || '',
          latencyMs: r.latencyMs,
          outputType: testResultOutputType(r),
        };
      });
  }

  function exportPromptTestResults() {
    const prompt = $('#test-prompt').value.trim();
    const rows = successfulTestRows();
    if (!rows.length) {
      toast('没有可导出的成功结果');
      return;
    }
    const lines = ['# 对比测试', '', '## Prompt', '', prompt, '', '## Results', ''];
    rows.forEach((r) => {
      lines.push(`### ${r.label}`);
      lines.push(`latency: ${r.latencyMs ?? '—'}ms`);
      lines.push('');
      lines.push(r.content);
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `compare-test-${Date.now().toString(36)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 Markdown');
  }

  async function loadGallery() {
    const grid = $('#gallery-grid');
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = '<div class="empty-state slim" style="grid-column:1/-1"><strong>正在加载贡献结果…</strong></div>';
    let data;
    try {
      const res = await fetch('/api/contributions');
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
      grid.removeAttribute('aria-busy');
      grid.innerHTML = `<div class="empty-state slim" style="grid-column:1/-1"><strong>加载失败</strong><span>${escapeHtml(err.message || '')}</span><button type="button" class="ghost-btn mini" data-gallery-retry>重新加载</button></div>`;
      return;
    }
    grid.removeAttribute('aria-busy');
    state.contributions = data.contributions || [];
    if (!state.contributions.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><strong>还没有贡献</strong>跑完一组后点「贡献本次结果」。</div>`;
      return;
    }
    grid.innerHTML = state.contributions
      .map((c) => {
        const results = c.results || [];
        const models = results.map((r) => r.label || r.model).filter(Boolean);
        const preview =
          c.note ||
          results.find((r) => r.content)?.content?.replace(/\s+/g, ' ').slice(0, 120) ||
          c.prompt?.replace(/\s+/g, ' ').slice(0, 120) ||
          '';
        const when = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '';
        return `
          <button type="button" class="tile contrib-card" data-contrib="${escapeHtml(c.id)}">
            <div class="contrib-head">
              <h3>${escapeHtml(c.caseTitle || c.caseId)}</h3>
              <span class="tag result-count">${escapeHtml(String(results.length || 0))} 个模型</span>
            </div>
            <p class="contrib-preview">${escapeHtml(preview)}</p>
            <div class="row contrib-meta">
              <span>${escapeHtml(categoryLabel(c.category))}</span>
              <span>${escapeHtml(c.author || '匿名')}</span>
              ${when ? `<time>${escapeHtml(when)}</time>` : ''}
            </div>
            <div class="model-pill-row">
              ${models
                .slice(0, 4)
                .map((m) => `<span class="model-pill">${escapeHtml(m)}</span>`)
                .join('')}
              ${models.length > 4 ? `<span class="model-pill more">+${models.length - 4}</span>` : ''}
            </div>
          </button>`;
      })
      .join('');
  }

  function renderArchivedResultSurface({ archiveKey, content, outputType, previewTitle, textPreview = 'markdown' }) {
    const artifact = renderableArtifact(content, outputType);
    if (!artifact && textPreview === 'plain') {
      return {
        artifact: null,
        tabs: '',
        body: `<div class="col-body" data-archive-panel="raw">${escapeHtml(content)}</div>`,
        actions: `<div class="col-actions archive-actions">
          ${iconAction({ attr: 'data-archive-open-result', key: archiveKey, iconName: 'external', label: '新窗口打开原文' })}
        </div>`,
      };
    }
    const previewMode = artifact ? 'preview' : 'md';
    const sourceMode = artifact ? 'source' : 'raw';
    const previewLabel = artifact ? '预览' : 'Markdown';
    const sourceLabel = artifact ? '源码' : '原文';
    const previewPanelId = `${archiveKey}-${previewMode}`;
    const sourcePanelId = `${archiveKey}-${sourceMode}`;
    const previewTabId = `${previewPanelId}-tab`;
    const sourceTabId = `${sourcePanelId}-tab`;
    const previewBody = artifact
      ? `<div class="col-body preview-body" id="${escapeHtml(previewPanelId)}" role="tabpanel" aria-labelledby="${escapeHtml(previewTabId)}" data-archive-panel="preview">${renderArtifactIframe(artifact, { title: `${previewTitle} HTML 预览`, loading: true })}</div>`
      : `<div class="col-body md" id="${escapeHtml(previewPanelId)}" role="tabpanel" aria-labelledby="${escapeHtml(previewTabId)}" data-archive-panel="md">${outputType === 'html' ? '<div class="artifact-note">未检测到可预览的 HTML / SVG，已按 Markdown 显示。</div>' : ''}${renderMarkdown(content)}</div>`;
    const sourceBody = artifact
      ? `<div class="col-body" id="${escapeHtml(sourcePanelId)}" role="tabpanel" aria-labelledby="${escapeHtml(sourceTabId)}" data-archive-panel="source" hidden><pre class="source">${escapeHtml(artifact.source)}</pre></div>`
      : `<div class="col-body" id="${escapeHtml(sourcePanelId)}" role="tabpanel" aria-labelledby="${escapeHtml(sourceTabId)}" data-archive-panel="raw" hidden>${escapeHtml(content)}</div>`;
    return {
      artifact,
      tabs: `<div class="col-tabs archive-tabs">
        <span class="tab-set" role="tablist" aria-label="结果展示方式">
          <button type="button" id="${escapeHtml(previewTabId)}" role="tab" data-archive-view="${escapeHtml(archiveKey)}" data-mode="${previewMode}" aria-controls="${escapeHtml(previewPanelId)}" aria-selected="true">${previewLabel}</button>
          <button type="button" id="${escapeHtml(sourceTabId)}" role="tab" data-archive-view="${escapeHtml(archiveKey)}" data-mode="${sourceMode}" aria-controls="${escapeHtml(sourcePanelId)}" aria-selected="false" tabindex="-1">${sourceLabel}</button>
        </span>
      </div>`,
      body: `${previewBody}${sourceBody}`,
      actions: `<div class="col-actions archive-actions">
        ${iconAction({ attr: 'data-archive-open-result', key: archiveKey, iconName: 'external', label: artifact ? '新窗口打开预览' : '新窗口打开原文' })}
      </div>`,
    };
  }

  function renderArchivedResultCard(row, archiveKey, { textPreview = 'markdown' } = {}) {
    const outputType = row?.outputType === 'html' ? 'html' : 'text';
    const title = row?.label || row?.model || '模型输出';
    const surface = renderArchivedResultSurface({
      archiveKey,
      content: row?.content || '',
      outputType,
      previewTitle: title,
      textPreview,
    });
    return `
      <article class="col ${surface.artifact ? 'artifact-col' : 'text-col'}" data-archive-card="${escapeHtml(archiveKey)}">
        <div class="col-head">
          <h3>${escapeHtml(title)}</h3>
          <div class="stats">${row?.latencyMs != null ? `${escapeHtml(row.latencyMs)}ms` : '—'}</div>
        </div>
        ${surface.tabs}
        ${surface.body}
        ${surface.actions}
      </article>`;
  }

  function handleArchivedResultClick(event) {
    const viewButton = event.target.closest('[data-archive-view]');
    if (viewButton) {
      const card = viewButton.closest('[data-archive-card]');
      if (!card) return;
      const mode = viewButton.dataset.mode;
      card.querySelectorAll('[data-archive-view]').forEach((button) => {
        const selected = button.dataset.mode === mode;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      card.querySelectorAll('[data-archive-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.archivePanel !== mode;
      });
      return;
    }

    const openButton = event.target.closest('[data-archive-open-result]');
    if (!openButton) return;
    const card = openButton.closest('[data-archive-card]');
    if (!card) return;
    const title = card.querySelector('.col-head h3')?.textContent?.trim() || '模型输出预览';
    const iframe = card.querySelector('[data-archive-panel="preview"] iframe');
    if (iframe?.srcdoc) {
      openIsolatedPreviewDocument(iframe.srcdoc, title);
      return;
    }
    const raw = card.querySelector('[data-archive-panel="raw"]')?.textContent || '';
    openResultInNewWindow(raw, 'text', title);
  }

  function handleArchivedResultKeydown(event) {
    const current = event.target.closest('[data-archive-view]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const card = current.closest('[data-archive-card]');
    const tabs = [...(card?.querySelectorAll('[data-archive-view]') || [])];
    const index = tabs.indexOf(current);
    if (index < 0 || tabs.length < 2) return;
    const next = event.key === 'Home'
      ? tabs[0]
      : event.key === 'End'
        ? tabs.at(-1)
        : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    event.preventDefault();
    next.focus();
    next.click();
  }

  function showContribution(id) {
    const c = state.contributions.find((x) => x.id === id);
    if (!c) return;
    state.selectedContributionId = c.id;
    $('#detail-title').textContent = c.caseTitle || c.caseId;
    $('#detail-meta').textContent = `${c.author || '匿名'} · ${new Date(c.createdAt).toLocaleString()} · ${categoryLabel(c.category)}`;
    $('#detail-prompt').textContent = c.prompt || '';
    const box = $('#detail-compare');
    box.style.setProperty('--compare-cols', String(Math.min(3, Math.max(1, (c.results || []).length))));
    box.innerHTML = (c.results || [])
      .map((r, index) => renderArchivedResultCard(r, `contribution-result-${index}`, { textPreview: 'plain' }))
      .join('');
    $('#btn-delete-contribution')?.classList.toggle('hidden', !state.isAdmin);
    openModal('modal-detail');
  }

  function renderHistoryDetail(item) {
    const detail = $('#history-detail');
    if (!item) {
      detail.innerHTML = '<div class="empty-state history-empty"><strong>选择一条记录</strong><span>在这里查看当时的提示词与模型输出。</span></div>';
      return;
    }
    detail.innerHTML = `
      <div class="history-detail-head">
        <span class="history-detail-title">
          <strong>${escapeHtml(item.caseTitle || item.caseId)}</strong>
          <span>${escapeHtml(new Date(item.createdAt).toLocaleString())}</span>
        </span>
        ${state.isAdmin ? `<span class="history-detail-actions">
          <button type="button" class="history-delete-btn" data-delete-history="${escapeHtml(item.id)}" aria-label="删除这条测试记录" data-tooltip="删除测试记录">${icon('trash')}</button>
        </span>` : ''}
      </div>
      <pre class="history-prompt">${escapeHtml(item.prompt || '')}</pre>
      <div class="compare history-compare">
        ${(item.results || [])
          .map((r, index) => renderArchivedResultCard(r, `history-result-${index}`))
          .join('')}
      </div>`;
  }

  function renderHistoryList() {
    const list = $('#history-list');
    $('#history-meta').textContent = `${state.history.length} 条历史记录`;
    if (!state.history.length) {
      list.innerHTML = '<div class="empty-state slim"><strong>暂无历史</strong>运行标准题库提示词后会自动保存成功结果。</div>';
      renderHistoryDetail(null);
      return;
    }
    list.innerHTML = state.history
      .map((item, i) => `
        <button type="button" class="history-item ${i === 0 ? 'active' : ''}" data-history="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.caseTitle || item.caseId)}</strong>
          <time>${escapeHtml(new Date(item.createdAt).toLocaleString())}</time>
          <span>${escapeHtml(String((item.results || []).length))} 个模型</span>
        </button>`)
      .join('');
    renderHistoryDetail(state.history[0]);
  }

  async function loadHistory(caseId = '') {
    $('#history-list').innerHTML = '<div class="empty-state slim"><strong>加载中…</strong></div>';
    $('#history-detail').innerHTML = '';
    try {
      const suffix = caseId ? `?caseId=${encodeURIComponent(caseId)}&limit=50` : '?limit=50';
      const res = await fetch(`/api/run-history${suffix}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      state.history = data.history || [];
      renderHistoryList();
    } catch (err) {
      $('#history-list').innerHTML = `<div class="empty-state slim"><strong>加载失败</strong><span>${escapeHtml(err.message || '')}</span><button type="button" class="ghost-btn mini" data-history-retry>重新加载</button></div>`;
      renderHistoryDetail(null);
    }
  }

  function openDeleteRecordDialog({ kind, id, label }) {
    if (!state.isAdmin || !id) return;
    const isContribution = kind === 'contribution';
    state.pendingDelete = { kind, id, label };
    $('#delete-record-title').textContent = isContribution ? '删除这条贡献？' : '删除这条测试记录？';
    $('#delete-record-description').textContent = `将永久删除「${label || id}」及其中的全部模型结果。此操作无法恢复。`;
    const confirmButton = $('#btn-confirm-delete-record');
    confirmButton.textContent = isContribution ? '删除贡献' : '删除记录';
    confirmButton.disabled = false;
    openModal('modal-delete-record', $('#btn-cancel-delete-record'));
  }

  async function confirmDeleteRecord() {
    const target = state.pendingDelete;
    if (!state.isAdmin || !target) return;
    const button = $('#btn-confirm-delete-record');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = '删除中…';
    const endpoint = target.kind === 'contribution'
      ? `/api/admin/contributions/${encodeURIComponent(target.id)}`
      : `/api/admin/run-history/${encodeURIComponent(target.id)}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          state.isAdmin = false;
          $('#admin-entry')?.classList.add('hidden');
          $('#btn-delete-contribution')?.classList.add('hidden');
        }
        const error = new Error(data.error || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      closeModal('modal-delete-record');
      state.pendingDelete = null;
      if (target.kind === 'contribution') {
        closeModal('modal-detail');
        state.selectedContributionId = '';
        await loadGallery();
        toast('贡献已删除');
      } else {
        await loadHistory();
        toast('测试记录已删除');
      }
    } catch (err) {
      if (err.status === 401) {
        closeModal('modal-delete-record');
        if (target.kind === 'history') renderHistoryList();
      }
      if (err.status === 404) {
        closeModal('modal-delete-record');
        state.pendingDelete = null;
        if (target.kind === 'contribution') {
          closeModal('modal-detail');
          await loadGallery();
        } else {
          await loadHistory();
        }
      }
      toast(err?.message || '删除失败');
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  async function submitContribution() {
    const isTest = state.contributionContext === 'test';
    const c = activeCase();
    if (!isTest && !c) return;
    const testPrompt = $('#test-prompt')?.value?.trim() || '';
    const results = isTest
      ? successfulTestRows()
      : (state.liveSlots.length ? state.liveSlots : runSlots())
          .filter((m) => state.results[m.key]?.status === 'ok')
          .map((m) => ({
            model: state.results[m.key].model || m.model,
            label: m.label,
            content: state.results[m.key].content,
            latencyMs: state.results[m.key].latencyMs,
          outputType: caseOutputType(c) === 'html' ? 'html' : 'text',
          }));
    if (!results.length) {
      toast('没有可贡献的成功结果');
      return;
    }
    const scores = {};
    if (!isTest) {
      (state.liveSlots.length ? state.liveSlots : runSlots()).forEach((m) => {
        if (state.scores[m.key]) scores[m.label] = state.scores[m.key];
      });
    }
    const prompt = isTest ? testPrompt : state.liveRunContext?.prompt || casePromptForRun(c);
    const title = isTest
      ? `对比测试：${prompt.slice(0, 28)}${prompt.length > 28 ? '…' : ''}`
      : c.title;
    const res = await fetch('/api/contributions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: isTest ? `custom-${Date.now().toString(36)}` : c.id,
        caseTitle: title,
        category: isTest ? (results.some((r) => r.outputType === 'html') ? 'frontend' : 'custom') : c.category,
        prompt,
        author: $('#contrib-author').value.trim() || '匿名贡献者',
        note: $('#contrib-note').value.trim(),
        results,
        scores,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || '贡献失败');
      return;
    }
    closeModal('modal-contribute');
    toast('已贡献到网站');
    if (state.view === 'gallery') loadGallery();
  }

  function viewFromLocation() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    return Object.entries(VIEW_PATHS).find(([, value]) => value === path)?.[0] || 'cases';
  }

  function setView(view, { push = true } = {}) {
    state.view = view;
    $('#view-cases').classList.toggle('hidden', view !== 'cases');
    $('#view-test').classList.toggle('hidden', view !== 'test');
    $('#view-gallery').classList.toggle('hidden', view !== 'gallery');
    $('#view-submit').classList.toggle('hidden', view !== 'submit');
    $('#view-history').classList.toggle('hidden', view !== 'history');
    $('#tab-cases').setAttribute('aria-selected', view === 'cases' ? 'true' : 'false');
    $('#tab-test').setAttribute('aria-selected', view === 'test' ? 'true' : 'false');
    $('#tab-gallery').setAttribute('aria-selected', view === 'gallery' ? 'true' : 'false');
    $('#tab-submit').setAttribute('aria-selected', view === 'submit' ? 'true' : 'false');
    $('#tab-history').setAttribute('aria-selected', view === 'history' ? 'true' : 'false');
    if (push && location.pathname !== VIEW_PATHS[view]) history.pushState({ view }, '', VIEW_PATHS[view]);
    if (view === 'test') renderTestModelPicker();
    if (view === 'gallery') loadGallery();
    if (view === 'history') loadHistory();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function updateCardView(slotKey, source) {
    const isTest = source === 'test';
    const isPublished = source === 'published';
    const box = $(isTest ? '#test-compare' : '#compare');
    const card = [...box.querySelectorAll('.col')].find((el) => el.dataset.slot === slotKey);
    const row = isTest ? state.testResults[slotKey] : state.results[slotKey];
    if (!card || row?.status !== 'ok') return;
    const mode = isTest ? state.testViewModes[slotKey] : state.viewModes[slotKey];
    const surface = renderResultSurface({
      slotKey,
      source,
      content: row.content || '',
      outputType: isTest
        ? testResultOutputType(row)
        : isPublished
          ? (row.outputType === 'html' ? 'html' : state.publishedRun?.outputType || 'text')
          : caseOutputType(activeCase()),
      mode,
    });
    card.querySelector('.col-tabs')?.remove();
    card.querySelector('.col-body')?.remove();
    card.querySelector('.col-head').insertAdjacentHTML('afterend', surface.tabs + surface.body);
  }

  function bind() {
    $('#filters-cat').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      state.filter = btn.dataset.filter;
      $$('#filters-cat .chip').forEach((c) =>
        c.setAttribute('aria-pressed', c === btn ? 'true' : 'false')
      );
      loadCases();
    });

    $('#filters-diff').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-diff]');
      if (!btn) return;
      state.difficulty = btn.dataset.diff;
      $$('#filters-diff .chip').forEach((c) =>
        c.setAttribute('aria-pressed', c === btn ? 'true' : 'false')
      );
      loadCases();
    });

    let searchT;
    $('#case-search').addEventListener('input', (e) => {
      clearTimeout(searchT);
      searchT = setTimeout(() => {
        state.q = e.target.value.trim();
        loadCases();
      }, 200);
    });

    $('#case-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      state.activeId = btn.dataset.id;
      state.results = {};
      state.resultSlots = [];
      state.liveSlots = [];
      state.liveRunContext = null;
      state.scores = {};
      state.scoreOpen.clear();
      state.promptEditing = false;
      state.caseDraftPrompt = '';
      setUrlCase(state.activeId);
      renderCaseList();
      await loadPublishedRuns(state.activeId);
    });

    $('#model-strip').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-site]');
      if (!btn) return;
      const id = btn.dataset.site;
      if (state.selectedSiteIds.has(id)) state.selectedSiteIds.delete(id);
      else state.selectedSiteIds.add(id);
      saveSettings();
      renderModelStrip();
      renderCompare();
      renderTestModelPicker();
    });

    $('#test-model-list').addEventListener('change', (e) => {
      const providerInput = e.target.closest('[data-test-provider]');
      if (providerInput) {
        state.testSelectionTouched = true;
        configuredSlots({ selectedSiteOnly: false })
          .filter((slot) => (slot.providerKey || slot.key) === providerInput.dataset.testProvider)
          .forEach((slot) => {
            if (providerInput.checked) state.testSelectedKeys.add(slot.key);
            else state.testSelectedKeys.delete(slot.key);
          });
        renderTestModelPicker();
        return;
      }
      const input = e.target.closest('[data-test-model]');
      if (!input) return;
      state.testSelectionTouched = true;
      if (input.checked) state.testSelectedKeys.add(input.dataset.testModel);
      else state.testSelectedKeys.delete(input.dataset.testModel);
      renderTestModelPicker();
    });

    $('#test-select-all').addEventListener('click', () => {
      configuredSlots({ selectedSiteOnly: false }).forEach((m) => state.testSelectedKeys.add(m.key));
      state.testSelectionTouched = true;
      renderTestModelPicker();
    });

    $('#test-select-none').addEventListener('click', () => {
      state.testSelectedKeys.clear();
      state.testSelectionTouched = true;
      renderTestModelPicker();
    });

    $('#test-output-type').addEventListener('change', () => {
      state.testOutputType = $('#test-output-type').value === 'html' ? 'html' : 'text';
      renderTestCompare();
    });

    $('#btn-prompt-library').addEventListener('click', openPromptLibrary);
    $('#prompt-library-search').addEventListener('input', (e) => {
      state.promptLibraryQuery = e.target.value;
      renderPromptLibrary();
    });
    $('#prompt-library-filters').addEventListener('click', (e) => {
      const button = e.target.closest('[data-prompt-category]');
      if (!button) return;
      state.promptLibraryCategory = button.dataset.promptCategory;
      renderPromptLibrary();
    });
    $('#prompt-library-list').addEventListener('click', (e) => {
      const clear = e.target.closest('[data-clear-prompt-filters]');
      if (clear) {
        state.promptLibraryCategory = '全部';
        state.promptLibraryQuery = '';
        $('#prompt-library-search').value = '';
        renderPromptLibrary();
        $('#prompt-library-search').focus();
        return;
      }
      const button = e.target.closest('[data-prompt-case]');
      if (button) applyPromptLibraryCase(button.dataset.promptCase);
    });

    $('#btn-test-run').addEventListener('click', runPromptTest);
    $('#btn-test-export').addEventListener('click', exportPromptTestResults);
    $('#btn-test-contribute').addEventListener('click', () => {
      if (!hasSuccessfulResult(state.testResults)) {
        toast('请先成功跑完至少一列');
        return;
      }
      state.contributionContext = 'test';
      openModal('modal-contribute');
    });

    $('#btn-run').addEventListener('click', runAll);
    $('#btn-publish').addEventListener('click', openPublishDialog);
    $('#btn-confirm-publish').addEventListener('click', publishLiveResults);
    $('#btn-view-published').addEventListener('click', restorePublishedResults);
    $('#btn-export').addEventListener('click', exportResults);
    $('#btn-copy-prompt').addEventListener('click', async () => {
      const c = activeCase();
      if (!c) return;
      if (state.isAdmin) {
        if (state.promptEditing) cancelPromptEdit();
        else beginPromptEdit();
        return;
      }
      const prompt = state.resultOrigin === 'published' && state.publishedRun
        ? state.publishedRun.prompt || c.prompt
        : c.prompt;
      await navigator.clipboard.writeText(prompt);
      toast('提示词已复制');
    });
    $('#btn-run-edited-prompt')?.addEventListener('click', runAll);
    $('#btn-save-prompt')?.addEventListener('click', () => saveCurrentCasePrompt());
    $('#btn-save-run-prompt')?.addEventListener('click', async () => {
      if (await saveCurrentCasePrompt({ runAfter: true })) await runAll();
    });
    $('#case-prompt-edit')?.addEventListener('input', (e) => {
      state.caseDraftPrompt = e.target.value;
    });

    $('#btn-theme').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      saveSettings();
    });

    $('#btn-settings').addEventListener('click', () => {
      renderSettingsEditor();
      openModal('modal-settings');
    });

    $('#btn-add-profile').addEventListener('click', () => {
      // New profile starts from recommended preset so Base URL is prefilled
      const p = createProfileFromPreset(DEFAULT_PRESET, {
        name: `配置 ${state.profiles.length + 1}`,
        enabled: true,
        isDefault: state.profiles.length === 0,
      });
      state.profiles.push(p);
      state.profiles = ensureSingleDefault(state.profiles);
      state.activeProfileId = p.id;
      saveProfiles();
      fillModelSelect([]);
      renderSettingsEditor();
      renderModelStrip();
      renderCompare();
      renderTestModelPicker();
      toast(`${presetById(DEFAULT_PRESET)?.name || 'DeepSeek'} 预设已填入 Base URL，请粘贴 API Key`);
    });

    $('#ai-profile-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-profile]');
      if (!btn) return;
      // save current form first
      try { upsertActiveProfileFromForm(); } catch {}
      state.activeProfileId = btn.dataset.profile;
      saveProfiles();
      renderSettingsEditor();
    });

    $('#ai-template-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      applyPresetToForm(btn.dataset.preset);
    });

    $('#ai-quick-models').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick-model]');
      if (!btn) return;
      $('#ai-model').value = btn.dataset.quickModel;
    });

    $('#ai-profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      upsertActiveProfileFromForm();
      renderSettingsEditor();
      renderModelStrip();
      renderCompare();
      renderTestModelPicker();
      toast('已保存到本机 localStorage');
    });

    $('#ai-delete').addEventListener('click', () => {
      if (state.profiles.length <= 1) {
        toast('至少保留一个配置');
        return;
      }
      const id = state.activeProfileId;
      state.profiles = state.profiles.filter((p) => p.id !== id);
      state.profiles = ensureSingleDefault(state.profiles);
      state.activeProfileId = (state.profiles.find((p) => p.isDefault) || state.profiles[0]).id;
      saveProfiles();
      renderSettingsEditor();
      renderModelStrip();
      renderCompare();
      renderTestModelPicker();
      toast('已删除本机配置');
    });

    $('#ai-test').addEventListener('click', async () => {
      const p = readProfileForm();
      const keyCheck = validateApiKeyClient(p.apiKey);
      if (!p.baseUrl || !p.model) {
        toast('请先填写 Base URL / Model');
        return;
      }
      if (!keyCheck.ok) {
        toast(keyCheck.error);
        return;
      }
      const btn = $('#ai-test');
      btn.disabled = true;
      btn.textContent = '测试中…';
      try {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: p.baseUrl,
            apiKey: keyCheck.key,
            model: p.model,
            system: '只回复 ok',
            prompt: 'ping',
            temperature: 0,
            maxTokens: 16,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        toast(`连接成功 · ${data.latencyMs ?? '—'}ms`);
        $('#ai-api-key').value = keyCheck.key;
        upsertActiveProfileFromForm();
        renderSettingsEditor();
      } catch (err) {
        toast(err.message || '测试失败');
      } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
      }
    });

    $('#ai-fetch-models')?.addEventListener('click', fetchRemoteModels);
    $('#ai-select-all')?.addEventListener('click', () => setAllModelChecks(true));
    $('#ai-select-none')?.addEventListener('click', () => setAllModelChecks(false));
    $('#ai-model-checks')?.addEventListener('change', (e) => {
      if (!e.target.matches('[data-model-check]')) return;
      // live update selectedModels on profile
      try {
        const p = activeProfile();
        if (!p) return;
        p.selectedModels = readSelectedModelsFromDom();
        if (p.selectedModels[0]) {
          p.model = p.selectedModels[0];
          $('#ai-model').value = p.model;
        }
        saveProfiles();
        renderModelStrip();
        renderTestModelPicker();
      } catch {}
    });

    // when closing settings, refresh chips
    document.querySelectorAll('[data-close="modal-settings"]').forEach((el) => {
      el.addEventListener('click', () => {
        try { upsertActiveProfileFromForm(); } catch {}
        renderModelStrip();
        renderCompare();
        renderTestModelPicker();
      });
    });

    $('#site-models-list').addEventListener('change', (e) => {
      const t = e.target.closest('[data-site-toggle]');
      if (!t) return;
      if (t.checked) state.selectedSiteIds.add(t.dataset.siteToggle);
      else state.selectedSiteIds.delete(t.dataset.siteToggle);
      saveSettings();
      renderModelStrip();
      renderCompare();
      renderTestModelPicker();
    });

    $('#btn-contribute').addEventListener('click', () => {
      if (!Object.values(state.results).some((r) => r?.status === 'ok')) {
        toast('请先成功跑完至少一列');
        return;
      }
      state.contributionContext = 'case';
      openModal('modal-contribute');
    });
    $('#btn-submit-contrib').addEventListener('click', submitContribution);

    $('#brand-home').addEventListener('click', (e) => { e.preventDefault(); setView('cases'); });
    $('#tab-cases').addEventListener('click', (e) => { e.preventDefault(); setView('cases'); });
    ['test', 'gallery', 'history', 'submit'].forEach((view) => {
      $(`#tab-${view}`).addEventListener('click', (e) => { e.preventDefault(); setView(view); });
    });
    window.addEventListener('popstate', () => setView(viewFromLocation(), { push: false }));
    $('#btn-refresh-gallery').addEventListener('click', loadGallery);
    $('#gallery-grid').addEventListener('click', (e) => {
      if (e.target.closest('[data-gallery-retry]')) {
        loadGallery();
        return;
      }
      const t = e.target.closest('[data-contrib]');
      if (t) showContribution(t.dataset.contrib);
    });
    $('#detail-compare').addEventListener('click', handleArchivedResultClick);
    $('#detail-compare').addEventListener('keydown', handleArchivedResultKeydown);
    $('#history-detail').addEventListener('click', handleArchivedResultClick);
    $('#history-detail').addEventListener('keydown', handleArchivedResultKeydown);
    $('#btn-delete-contribution').addEventListener('click', () => {
      const contribution = state.contributions.find((item) => item.id === state.selectedContributionId);
      if (!contribution) return;
      openDeleteRecordDialog({
        kind: 'contribution',
        id: contribution.id,
        label: contribution.caseTitle || contribution.caseId || contribution.id,
      });
    });
    $('#btn-confirm-delete-record').addEventListener('click', confirmDeleteRecord);
    $('#history-detail').addEventListener('click', (e) => {
      const button = e.target.closest('[data-delete-history]');
      if (!button) return;
      const item = state.history.find((entry) => entry.id === button.dataset.deleteHistory);
      if (!item) return;
      openDeleteRecordDialog({
        kind: 'history',
        id: item.id,
        label: item.caseTitle || item.caseId || item.id,
      });
    });

    $('#history-list')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-history-retry]')) {
        loadHistory();
        return;
      }
      const btn = e.target.closest('[data-history]');
      if (!btn) return;
      $$('#history-list [data-history]').forEach((el) => el.classList.toggle('active', el === btn));
      renderHistoryDetail(state.history.find((item) => item.id === btn.dataset.history));
    });

    $('#snapshot-version-list').addEventListener('click', (e) => {
      const button = e.target.closest('[data-published-version]');
      if (button) loadPublishedVersion(Number(button.dataset.publishedVersion));
    });

    $('#compare').addEventListener('click', async (e) => {
      if (e.target.closest('[data-retry-published]')) {
        await restorePublishedResults();
        return;
      }
      if (e.target.closest('[data-start-run]')) {
        await runAll();
        return;
      }
      if (e.target.closest('[data-open-settings]')) {
        renderSettingsEditor();
        openModal('modal-settings');
        return;
      }
      const rerun = e.target.closest('[data-rerun]');
      if (rerun) {
        await rerunSlot(rerun.dataset.rerun, 'case');
        return;
      }
      const viewBtn = e.target.closest('[data-view]');
      if (viewBtn) {
        state.viewModes[viewBtn.dataset.view] = viewBtn.dataset.mode;
        updateCardView(viewBtn.dataset.view, state.resultOrigin === 'published' ? 'published' : 'case');
        return;
      }
      const scoreToggle = e.target.closest('[data-score-toggle]');
      if (scoreToggle) {
        const slot = scoreToggle.dataset.scoreToggle;
        const card = scoreToggle.closest('.col');
        const open = !state.scoreOpen.has(slot);
        if (open) {
          state.scoreOpen.add(slot);
          scoreToggle.closest('.col-actions').insertAdjacentHTML('beforebegin', scoreControls(slot, activeCase()?.rubric));
        } else {
          state.scoreOpen.delete(slot);
          card.querySelector('.score-row')?.remove();
        }
        scoreToggle.textContent = open ? '收起评分' : '我要打分';
        scoreToggle.setAttribute('aria-expanded', String(open));
        return;
      }
      const fs = e.target.closest('[data-fs]');
      if (fs) {
        openFullscreen(fs.dataset.fs, state.resultOrigin === 'published' ? 'published' : 'case');
        return;
      }
      const copy = e.target.closest('[data-copy]');
      const openResult = e.target.closest('[data-open-result]');
      if (copy) {
        const r = state.results[copy.dataset.copy];
        if (r?.content) {
          await navigator.clipboard.writeText(r.content);
          toast('已复制');
        }
      }
      if (openResult) {
        const r = state.results[openResult.dataset.openResult];
        if (r?.content) {
          const published = state.resultOrigin === 'published';
          const fallbackOutputType = published
            ? state.publishedRun?.outputType || caseOutputType(activeCase())
            : caseOutputType(activeCase());
          const outputType = r.outputType === 'html' ? 'html' : fallbackOutputType;
          const title = openResult.closest('.col')?.querySelector('.col-head h3')?.textContent?.trim() || '模型输出预览';
          openResultInNewWindow(r.content, outputType, title);
        }
      }
    });

    $('#compare').addEventListener('click', (e) => {
      const score = e.target.closest('[data-score-value]');
      if (!score) return;
      const slot = score.dataset.scoreSlot;
      const dim = score.dataset.dim;
      if (!state.scores[slot]) state.scores[slot] = {};
      const value = Number(score.dataset.scoreValue);
      if (state.scores[slot][dim] === value) delete state.scores[slot][dim];
      else state.scores[slot][dim] = value;
      score.closest('.score-segments').querySelectorAll('button').forEach((button) => {
        button.setAttribute('aria-pressed', String(state.scores[slot][dim] === Number(button.dataset.scoreValue)));
      });
    });

    $('#test-compare').addEventListener('click', async (e) => {
      const rerun = e.target.closest('[data-test-rerun]');
      if (rerun) {
        await rerunSlot(rerun.dataset.testRerun, 'test');
        return;
      }
      const viewBtn = e.target.closest('[data-test-view]');
      if (viewBtn) {
        state.testViewModes[viewBtn.dataset.testView] = viewBtn.dataset.mode;
        updateCardView(viewBtn.dataset.testView, 'test');
        return;
      }
      const fs = e.target.closest('[data-test-fs]');
      if (fs) {
        openFullscreen(fs.dataset.testFs, 'test');
        return;
      }
      const copy = e.target.closest('[data-test-copy]');
      const openResult = e.target.closest('[data-test-open-result]');
      if (copy) {
        const r = state.testResults[copy.dataset.testCopy];
        if (r?.content) {
          await navigator.clipboard.writeText(r.content);
          toast('已复制');
        }
      }
      if (openResult) {
        const r = state.testResults[openResult.dataset.testOpenResult];
        if (r?.content) {
          const title = openResult.closest('.col')?.querySelector('.col-head h3')?.textContent?.trim() || '模型输出预览';
          openResultInNewWindow(r.content, testResultOutputType(r), title);
        }
      }
    });

    $('#submit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      const res = await fetch('/api/case-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      const out = $('#submit-result');
      if (!res.ok) {
        out.textContent = data.error || '提交失败';
        out.style.color = 'var(--danger)';
        return;
      }
      out.textContent = data.message || '已提交，等待审核';
      out.style.color = 'var(--success)';
      e.target.reset();
      toast('题目已提交审核');
    });

    $('#btn-reward').addEventListener('click', () => openModal('modal-reward'));
    $('#btn-follow').addEventListener('click', () => openModal('modal-follow'));

    document.addEventListener('click', (e) => {
      const closer = e.target.closest('[data-close]');
      if (closer) closeModal(closer.dataset.close);
      if (e.target.classList.contains('overlay')) closeModal(e.target.id);
    });
    document.addEventListener('keydown', (e) => {
      trapModalFocus(e);
      if (e.key === 'Escape') {
        const overlay = $$('.overlay.open').at(-1);
        if (overlay) closeModal(overlay.id);
      }
    });
  }

  async function init() {
    loadSettings();
    applyTheme();
    bind();
    try {
      await checkAdmin();
      await Promise.all([loadCases(), loadSiteModels()]);
      setView(viewFromLocation(), { push: false });
    } catch (err) {
      $('#case-title').textContent = '加载失败';
      $('#case-summary').textContent = err?.message || '';
      toast('题库加载失败');
    }
  }

  init();
})();
