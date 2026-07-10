/* 乔木 LLM 擂台 client v1.2 — qmreader-style local AI profiles */
(() => {
  'use strict';

  const STORAGE_KEY = 'case-benchmark:v1';
  const PROFILE_KEY = 'case-benchmark:ai-profiles';
  const PRESETS = window.CB_AI_PROVIDER_PRESETS || [];
  const PRESET_MAP = window.CB_AI_PROVIDER_MAP || {};
  const DEFAULT_PRESET = window.CB_DEFAULT_AI_PRESET_ID || 'deepseek';
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
    contributions: [],
    history: [],
    isAdmin: false,
    promptEditing: false,
    caseDraftPrompt: '',
    hasRunOnce: false,
  };
  let runTicker = null;
  const renderQueued = { case: false, test: false };

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
      if (hasRunningRows(state.results)) renderCompare();
      if (hasRunningRows(state.testResults)) renderTestCompare();
      if (!hasRunningRows(state.results) && !hasRunningRows(state.testResults)) {
        clearInterval(runTicker);
        runTicker = null;
      }
    }, 1000);
  }

  function queueResultRender(source) {
    if (renderQueued[source]) return;
    renderQueued[source] = true;
    requestAnimationFrame(() => {
      renderQueued[source] = false;
      if (source === 'test') renderTestCompare();
      else renderCompare();
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

  function inferOutputTypeFromText({ outputType = 'text', category = '', title = '', summary = '', prompt = '', tags = [] } = {}) {
    if (outputType === 'html') return 'html';
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

  function wrapSvgForPreview(svg) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;min-height:100%;background:#fff;}
      body{display:grid;place-items:center;padding:12px;box-sizing:border-box;}
      svg{max-width:100%;height:auto;display:block;}
    </style></head><body>${svg}</body></html>`;
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
    const raw = decodeArtifactEntities(String(text || '').trim());
    const stripped = stripCodeFence(raw);
    const direct = stripped.trim();
    const fenced = firstRenderableFence(raw);
    const code = fenced ? fenced.code : direct;
    const html = extractHtmlMarkup(code) || extractHtmlMarkup(raw);
    if (html && (outputType === 'html' || fenced)) {
      return { source: html, preview: html, kind: 'html' };
    }
    const svg = extractSvgMarkup(code) || extractSvgMarkup(raw);
    if (svg) return { source: svg, preview: wrapSvgForPreview(svg), kind: 'svg' };
    return null;
  }

  function renderTabs({ slotKey, source, artifact, mode, running }) {
    const viewAttr = source === 'test' ? 'data-test-view' : 'data-view';
    const rerunAttr = source === 'test' ? 'data-test-rerun' : 'data-rerun';
    const safeKey = escapeHtml(slotKey);
    const left = artifact
      ? `<button type="button" ${viewAttr}="${safeKey}" data-mode="preview" aria-selected="${mode === 'preview'}">预览</button>
         <button type="button" ${viewAttr}="${safeKey}" data-mode="source" aria-selected="${mode === 'source'}">源码</button>`
      : `<button type="button" ${viewAttr}="${safeKey}" data-mode="md" aria-selected="${mode === 'md'}">Markdown</button>
         <button type="button" ${viewAttr}="${safeKey}" data-mode="raw" aria-selected="${mode === 'raw'}">原文</button>`;
    return `
      <div class="col-tabs">
        <span class="tab-set">${left}</span>
        <button type="button" class="rerun-btn" ${rerunAttr}="${safeKey}" ${running ? 'disabled' : ''}>重新运行</button>
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
          : `<div class="col-body" style="padding:8px"><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtml(artifact.preview)}" title="preview"></iframe></div>`;
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
    const slots = isTest ? configuredSlots({ selectedSiteOnly: false }) : runSlots();
    const m = slots.find((s) => s.key === slotKey);
    const r = isTest ? state.testResults[slotKey] : state.results[slotKey];
    const c = activeCase();
    if (!r?.content) return;
    const content = r.content;
    const outputType = isTest ? state.testOutputType : caseOutputType(c);
    const artifact = renderableArtifact(content, outputType);
    $('#fs-title').textContent = m ? m.label : '预览';
    const body = $('#fs-body');
    if (artifact) {
      body.innerHTML = `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtml(artifact.preview)}" title="fullscreen"></iframe>`;
    } else {
      body.innerHTML = `<div class="col-body md" style="padding:20px;overflow:auto;height:100%;background:var(--surface);color:var(--text)">${renderMarkdown(content)}</div>`;
    }
    openModal('modal-preview-fs');
  }

  function setUrlCase(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set('case', id);
    else u.searchParams.delete('case');
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
    $$('.result-action').forEach((el) => el.classList.toggle('hidden', !caseHasResults));
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
      list.innerHTML =
        '<div class="empty-state" style="padding:20px;border:0"><strong>暂无题目</strong></div>';
      return;
    }
    list.innerHTML = state.cases
      .map((c) => {
        const active = c.id === state.activeId ? 'active' : '';
        return `
          <button type="button" class="case-item ${active}" data-id="${escapeHtml(c.id)}">
            <strong>${escapeHtml(c.title)}</strong>
            <span>${escapeHtml(c.summary || '')}</span>
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

  function renderStage() {
    const c = activeCase();
    if (!c) return;
    $('#case-title').textContent = c.title;
    $('#case-summary').textContent = c.summary || '';
    $('#case-prompt').textContent = c.prompt || '';
    renderAdminPromptEditor(c);
    $('#case-rubric').innerHTML = (c.rubric || [])
      .map((r) => `<i>${escapeHtml(r)}</i>`)
      .join('');
    renderModelStrip();
    renderCompare();
    updateResultActions();
    $('#first-guide').classList.toggle('hidden', state.hasRunOnce);
  }

  function renderModelStrip() {
    const strip = $('#model-strip');
    const slots = runSlots();
    const parts = slots.map((m) => {
      const source = m.kind === 'site' ? '站点' : '本机';
      const chip = `
        <span class="dot"></span>
        <span>${escapeHtml(m.providerName || m.label)}</span>
        <span class="model-chip-model">${escapeHtml(m.model || '')}</span>
        <span class="model-chip-source">${source}</span>`;
      if (m.kind === 'site') {
        return `<button type="button" class="model-chip selected" data-site="${escapeHtml(m.siteModelId)}" title="${escapeHtml(m.label)}">${chip}</button>`;
      }
      return `<div class="model-chip selected" title="${escapeHtml(m.label)}">${chip}</div>`;
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

  function renderCompare() {
    const c = activeCase();
    const box = $('#compare');
    const slots = runSlots();
    const outputType = caseOutputType(c);
    if (!slots.length) {
      box.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <strong>还没有可运行的模型</strong>
        打开「模型设置」，用 DeepSeek / OpenRouter 等模板配置本机 Key（localStorage），或勾选站点模型。
      </div>`;
      return;
    }
    box.innerHTML = slots
      .map((m) => {
        const r = state.results[m.key];
        const mode = state.viewModes[m.key] || 'preview';
        let body = '<div class="col-body empty">等待运行…</div>';
        let stats = '—';
        let tabs = '';
        if (r?.status === 'running') {
          body = renderRunningBody(r, outputType);
          stats = runningStats(r);
        } else if (r?.status === 'error') {
          body = renderErrorBody(r);
          stats = r.latencyMs != null ? `${r.latencyMs}ms` : 'error';
        } else if (r?.status === 'ok') {
          const content = r.content || '';
          const surface = renderResultSurface({
            slotKey: m.key,
            source: 'case',
            content,
            outputType,
            mode,
            running: state.results[m.key]?.status === 'running',
          });
          tabs = surface.tabs;
          body = surface.body;
          const tok = r.usage?.totalTokens != null ? ` · ${r.usage.totalTokens} tok` : '';
          stats = `${r.latencyMs ?? '—'}ms${tok}`;
        }
        const showFs = r?.status === 'ok';
        return `
          <article class="col" data-slot="${escapeHtml(m.key)}">
            <div class="col-head">
              <h3><span class="provider">${escapeHtml(m.providerName || '')}</span>${escapeHtml(m.model || m.label)}</h3>
              <div class="stats">${escapeHtml(stats)}</div>
            </div>
            ${tabs}
            ${body}
            ${r?.status === 'ok' && state.scoreOpen.has(m.key) ? scoreControls(m.key, c?.rubric) : ''}
            ${r?.status === 'ok' ? `<div class="col-actions">
              ${iconAction({ attr: 'data-copy', key: m.key, iconName: 'copy', label: '复制输出' })}
              ${showFs ? iconAction({ attr: 'data-fs', key: m.key, iconName: 'maximize', label: '全屏查看' }) : ''}
              ${iconAction({ attr: 'data-raw', key: m.key, iconName: 'external', label: '新窗口打开原文' })}
              <button type="button" class="score-toggle" data-score-toggle="${escapeHtml(m.key)}" aria-expanded="${state.scoreOpen.has(m.key)}">${state.scoreOpen.has(m.key) ? '收起评分' : '我要打分'}</button>
            </div>` : ''}
          </article>`;
      })
      .join('');
  }

  async function loadCases() {
    const params = new URLSearchParams({
      category: state.filter,
      difficulty: state.difficulty,
      q: state.q,
    });
    const res = await fetch(`/api/cases?${params}`);
    const data = await res.json();
    state.cases = data.cases || [];
    const urlCase = new URL(location.href).searchParams.get('case');
    if (urlCase && state.cases.some((c) => c.id === urlCase)) {
      state.activeId = urlCase;
    } else if (!state.activeId || !state.cases.some((c) => c.id === state.activeId)) {
      state.activeId = state.cases[0]?.id || null;
    }
    if (state.activeId) setUrlCase(state.activeId);
    renderCaseList();
    renderStage();
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
    const finalSystem =
      outputType === 'html'
        ? [HTML_OUTPUT_SYSTEM, system].filter(Boolean).join('\n\n')
        : system;
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
    const runContext = {
      caseId: c.id,
      prompt,
      outputType: caseOutputType(c),
      slots: slots.map((slot) => ({ ...slot, apiKey: undefined })),
    };
    state.running = true;
    state.results = {};
    state.scores = {};
    state.scoreOpen.clear();
    slots.forEach((m) => {
      state.results[m.key] = { status: 'running', content: '', startedAt: Date.now() };
    });
    startRunTicker();
    updateResultActions();
    const btn = $('#btn-run');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '运行中…';
    $('#run-status').textContent = `并行请求 ${slots.length} 个模型…`;
    renderCompare();

    await Promise.all(
      slots.map(async (m) => {
        state.results[m.key] = await requestSlotRun(m, {
          system: c.system || '',
          prompt,
          outputType: runContext.outputType,
          onUpdate: (patch) => {
            state.results[m.key] = { ...state.results[m.key], status: 'running', ...patch };
            queueResultRender('case');
          },
        });
        renderCompare();
        updateResultActions();
      })
    );

    state.running = false;
    state.hasRunOnce = true;
    saveSettings();
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = '运行提示词';
    const ok = Object.values(state.results).filter((r) => r.status === 'ok').length;
    const fail = Object.values(state.results).filter((r) => r.status === 'error').length;
    $('#run-status').textContent = `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
    $('#first-guide').classList.add('hidden');
    updateResultActions();
    const history = ok
      ? await recordCaseRunHistory({
          caseId: runContext.caseId,
          prompt: runContext.prompt,
          outputType: runContext.outputType,
          slots: runContext.slots,
          results: state.results,
        })
      : { ok: false, skipped: true };
    toast(
      ok && !history.ok && !history.skipped
        ? `跑完了，但历史记录保存失败：${history.error}`
        : ok
          ? `跑完了，${ok} 个模型有结果`
          : '全部失败，请检查 Key / 接口'
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
    if (isTest) {
      prompt = $('#test-prompt')?.value?.trim() || '';
      outputType = $('#test-output-type')?.value === 'html' ? 'html' : 'text';
      state.testOutputType = outputType;
      if (!prompt) {
        toast('请先输入提示词');
        return;
      }
      state.testResults[slotKey] = { status: 'running', content: '', startedAt: Date.now() };
      startRunTicker();
      $('#test-run-status').textContent = `正在重新运行 ${slot.label}…`;
      renderTestCompare();
    } else {
      const c = activeCase();
      if (!c) return;
      caseId = c.id;
      prompt = casePromptForRun(c);
      if (!prompt) {
        toast('提示词不能为空');
        return;
      }
      system = c.system || '';
      outputType = caseOutputType(c);
      state.results[slotKey] = { status: 'running', content: '', startedAt: Date.now() };
      startRunTicker();
      $('#run-status').textContent = `正在重新运行 ${slot.label}…`;
      renderCompare();
    }

    const result = await requestSlotRun(slot, {
      system,
      prompt,
      outputType,
      onUpdate: (patch) => {
        if (isTest) {
          state.testResults[slotKey] = { ...state.testResults[slotKey], status: 'running', ...patch };
          queueResultRender('test');
        } else {
          state.results[slotKey] = { ...state.results[slotKey], status: 'running', ...patch };
          queueResultRender('case');
        }
      },
    });
    let history = { ok: false, skipped: true };
    if (isTest) {
      state.testResults[slotKey] = result;
      renderTestCompare();
      const ok = Object.values(state.testResults).filter((r) => r.status === 'ok').length;
      const fail = Object.values(state.testResults).filter((r) => r.status === 'error').length;
      $('#test-run-status').textContent = `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
    } else {
      state.results[slotKey] = result;
      renderCompare();
      const ok = Object.values(state.results).filter((r) => r.status === 'ok').length;
      const fail = Object.values(state.results).filter((r) => r.status === 'error').length;
      $('#run-status').textContent = `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
      if (result.status === 'ok') {
        history = await recordCaseRunHistory({
          caseId,
          prompt,
          outputType,
          slots: [{ ...slot, apiKey: undefined }],
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

  function openModal(id) {
    $(`#${id}`)?.classList.add('open');
  }
  function closeModal(id) {
    $(`#${id}`)?.classList.remove('open');
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
    const slots = runSlots();
    if (!slots.some((m) => state.results[m.key]?.status === 'ok')) {
      toast('没有可导出的成功结果');
      return;
    }
    const lines = [
      `# ${c.title}`,
      '',
      `分类：${categoryLabel(c.category)}`,
      '',
      '## Prompt',
      '',
      casePromptForRun(c),
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

  function successfulCaseRows({ results = state.results, slots = runSlots(), outputType = caseOutputType(activeCase()) } = {}) {
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
          outputType:
            outputType === 'html' || looksLikeHtml(r.content) ? 'html' : 'text',
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

  async function checkAdmin() {
    try {
      const res = await fetch('/api/admin/me');
      const data = await res.json().catch(() => ({}));
      state.isAdmin = !!data.authenticated;
    } catch {
      state.isAdmin = false;
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
      .map((m) => {
        const r = state.testResults[m.key];
        const mode = state.testViewModes[m.key] || 'md';
        let body = '<div class="col-body empty">等待运行…</div>';
        let stats = '—';
        let tabs = '';
        if (r?.status === 'running') {
          body = renderRunningBody(r, state.testOutputType);
          stats = runningStats(r);
        } else if (r?.status === 'error') {
          body = renderErrorBody(r);
          stats = r.latencyMs != null ? `${r.latencyMs}ms` : 'error';
        } else if (r?.status === 'ok') {
          const content = r.content || '';
          const surface = renderResultSurface({
            slotKey: m.key,
            source: 'test',
            content,
            outputType: state.testOutputType,
            mode,
            running: state.testResults[m.key]?.status === 'running',
          });
          tabs = surface.tabs;
          body = surface.body;
          const tok = r.usage?.totalTokens != null ? ` · ${r.usage.totalTokens} tok` : '';
          stats = `${r.latencyMs ?? '—'}ms${tok}`;
        }
        const showFs = r?.status === 'ok';
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
              ${showFs ? iconAction({ attr: 'data-test-fs', key: m.key, iconName: 'maximize', label: '全屏查看' }) : ''}
              ${iconAction({ attr: 'data-test-raw', key: m.key, iconName: 'external', label: '新窗口打开原文' })}
            </div>` : ''}
          </article>`;
      })
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
    state.testResults = {};
    slots.forEach((m) => {
      state.testResults[m.key] = { status: 'running', content: '', startedAt: Date.now() };
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
        state.testResults[m.key] = await requestSlotRun(m, {
          prompt,
          outputType: state.testOutputType,
          onUpdate: (patch) => {
            state.testResults[m.key] = { ...state.testResults[m.key], status: 'running', ...patch };
            queueResultRender('test');
          },
        });
        renderTestCompare();
        updateResultActions();
      })
    );

    state.testRunning = false;
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = '运行提示词';
    const ok = Object.values(state.testResults).filter((r) => r.status === 'ok').length;
    const fail = Object.values(state.testResults).filter((r) => r.status === 'error').length;
    $('#test-run-status').textContent = `完成：${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
    updateResultActions();
    toast(ok ? `对比完成，${ok} 个模型有结果` : '全部失败，请检查模型配置');
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
          outputType: state.testOutputType === 'html' || looksLikeHtml(r.content) ? 'html' : 'text',
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

  function showContribution(id) {
    const c = state.contributions.find((x) => x.id === id);
    if (!c) return;
    $('#detail-title').textContent = c.caseTitle || c.caseId;
    $('#detail-meta').textContent = `${c.author || '匿名'} · ${new Date(c.createdAt).toLocaleString()} · ${categoryLabel(c.category)}`;
    $('#detail-prompt').textContent = c.prompt || '';
    const box = $('#detail-compare');
    box.innerHTML = (c.results || [])
      .map((r) => {
        const outputType = r.outputType === 'html' || looksLikeHtml(r.content) ? 'html' : 'text';
        const artifact = renderableArtifact(r.content, outputType);
        const body = artifact
          ? `<div class="col-body" style="padding:8px"><iframe sandbox="allow-scripts" srcdoc="${escapeHtml(artifact.preview)}"></iframe></div>`
          : `<div class="col-body">${escapeHtml(r.content || '')}</div>`;
        return `
          <article class="col">
            <div class="col-head">
              <h3>${escapeHtml(r.label || r.model)}</h3>
              <div class="stats">${r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</div>
            </div>
            ${body}
          </article>`;
      })
      .join('');
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
        <strong>${escapeHtml(item.caseTitle || item.caseId)}</strong>
        <span>${escapeHtml(new Date(item.createdAt).toLocaleString())}</span>
      </div>
      <pre class="history-prompt">${escapeHtml(item.prompt || '')}</pre>
      <div class="compare history-compare">
        ${(item.results || [])
          .map((r) => {
            const outputType = r.outputType === 'html' || looksLikeHtml(r.content) ? 'html' : 'text';
            const artifact = renderableArtifact(r.content, outputType);
            const body = artifact
              ? `<div class="col-body" style="padding:8px"><iframe sandbox="allow-scripts" srcdoc="${escapeHtml(artifact.preview)}"></iframe></div>`
              : `<div class="col-body md" style="padding:16px;overflow:auto">${renderMarkdown(r.content || '')}</div>`;
            return `
              <article class="col">
                <div class="col-head">
                  <h3>${escapeHtml(r.label || r.model)}</h3>
                  <div class="stats">${r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</div>
                </div>
                ${body}
              </article>`;
          })
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

  async function submitContribution() {
    const isTest = state.contributionContext === 'test';
    const c = activeCase();
    if (!isTest && !c) return;
    const testPrompt = $('#test-prompt')?.value?.trim() || '';
    const results = isTest
      ? successfulTestRows()
      : runSlots()
          .filter((m) => state.results[m.key]?.status === 'ok')
          .map((m) => ({
            model: state.results[m.key].model || m.model,
            label: m.label,
            content: state.results[m.key].content,
            latencyMs: state.results[m.key].latencyMs,
          outputType:
              caseOutputType(c) === 'html' || looksLikeHtml(state.results[m.key].content) ? 'html' : 'text',
          }));
    if (!results.length) {
      toast('没有可贡献的成功结果');
      return;
    }
    const scores = {};
    if (!isTest) {
      runSlots().forEach((m) => {
        if (state.scores[m.key]) scores[m.label] = state.scores[m.key];
      });
    }
    const prompt = isTest ? testPrompt : casePromptForRun(c);
    const title = isTest
      ? `对比测试：${prompt.slice(0, 28)}${prompt.length > 28 ? '…' : ''}`
      : c.title;
    const res = await fetch('/api/contributions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: isTest ? `custom-${Date.now().toString(36)}` : c.id,
        caseTitle: title,
        category: isTest ? (state.testOutputType === 'html' ? 'frontend' : 'custom') : c.category,
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
    const box = $(isTest ? '#test-compare' : '#compare');
    const card = [...box.querySelectorAll('.col')].find((el) => el.dataset.slot === slotKey);
    const row = isTest ? state.testResults[slotKey] : state.results[slotKey];
    if (!card || row?.status !== 'ok') return;
    const mode = isTest ? state.testViewModes[slotKey] : state.viewModes[slotKey];
    const surface = renderResultSurface({
      slotKey,
      source,
      content: row.content || '',
      outputType: isTest ? state.testOutputType : caseOutputType(activeCase()),
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

    $('#case-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      state.activeId = btn.dataset.id;
      state.results = {};
      state.scores = {};
      state.scoreOpen.clear();
      state.promptEditing = false;
      state.caseDraftPrompt = '';
      setUrlCase(state.activeId);
      renderCaseList();
      renderStage();
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
    $('#btn-export').addEventListener('click', exportResults);
    $('#btn-copy-prompt').addEventListener('click', async () => {
      const c = activeCase();
      if (!c) return;
      if (state.isAdmin) {
        if (state.promptEditing) cancelPromptEdit();
        else beginPromptEdit();
        return;
      }
      await navigator.clipboard.writeText(c.prompt);
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

    $('#compare').addEventListener('click', async (e) => {
      const rerun = e.target.closest('[data-rerun]');
      if (rerun) {
        await rerunSlot(rerun.dataset.rerun, 'case');
        return;
      }
      const viewBtn = e.target.closest('[data-view]');
      if (viewBtn) {
        state.viewModes[viewBtn.dataset.view] = viewBtn.dataset.mode;
        updateCardView(viewBtn.dataset.view, 'case');
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
        openFullscreen(fs.dataset.fs);
        return;
      }
      const copy = e.target.closest('[data-copy]');
      const raw = e.target.closest('[data-raw]');
      if (copy) {
        const r = state.results[copy.dataset.copy];
        if (r?.content) {
          await navigator.clipboard.writeText(r.content);
          toast('已复制');
        }
      }
      if (raw) {
        const r = state.results[raw.dataset.raw];
        if (r?.content) {
          const w = window.open('', '_blank');
          if (w) {
            w.document.write(
              `<pre style="white-space:pre-wrap;padding:16px;font:13px/1.6 system-ui">${escapeHtml(r.content)}</pre>`
            );
            w.document.close();
          }
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
      const raw = e.target.closest('[data-test-raw]');
      if (copy) {
        const r = state.testResults[copy.dataset.testCopy];
        if (r?.content) {
          await navigator.clipboard.writeText(r.content);
          toast('已复制');
        }
      }
      if (raw) {
        const r = state.testResults[raw.dataset.testRaw];
        if (r?.content) {
          const w = window.open('', '_blank');
          if (w) {
            w.document.write(
              `<pre style="white-space:pre-wrap;padding:16px;font:13px/1.6 system-ui">${escapeHtml(r.content)}</pre>`
            );
            w.document.close();
          }
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
      if (e.target.classList.contains('overlay')) e.target.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $$('.overlay.open').forEach((o) => o.classList.remove('open'));
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
