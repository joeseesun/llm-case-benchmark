'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const db = require('./lib/db');
const { enrichCaseFromPrompt } = require('./lib/enrich');

const PORT = Number(process.env.PORT || 3168);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const COOKIE_NAME = 'cb_admin';
const IS_PROD = process.env.NODE_ENV === 'production';
const FINAL_ONLY_RETRY_SYSTEM =
  '你上一轮只返回了推理过程，没有返回最终正文。现在必须跳过分析和推理，直接输出最终答案。不要解释、不要 Markdown 代码围栏、不要输出思考过程；如果任务要求 HTML/SVG，请只输出可直接预览的完整 HTML 或 SVG。';

db.openDb();

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function ipHash(req) {
  return crypto.createHash('sha256').update(clientIp(req) + (db.getSecret() || '')).digest('hex').slice(0, 24);
}

function requireAdmin(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!db.isValidSession(token)) {
    res.status(401).json({ error: '未登录或会话已过期' });
    return;
  }
  next();
}

function sanitizeText(s, max = 120000) {
  if (typeof s !== 'string') return '';
  return s.slice(0, max);
}

/** Strip Bearer prefix, whitespace; reject URL-like keys (common paste mistake). */
function sanitizeApiKey(raw) {
  let key = String(raw || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
  // browsers / password managers sometimes paste full header line
  if (/^authorization:/i.test(key)) {
    key = key.replace(/^authorization:\s*/i, '').replace(/^Bearer\s+/i, '').trim();
  }
  return key;
}

function normalizeOpenAiBase(baseUrl) {
  let base = String(baseUrl || '').trim();
  if (!base) throw Object.assign(new Error('baseUrl 不能为空'), { status: 400 });
  // if user pasted a full chat/completions URL, strip path back to root or /v1
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/i, '');
  base = base.replace(/\/models$/i, '');
  base = base.replace(/\/+$/, '');
  return base;
}

function openAiEndpoint(baseUrl, path) {
  const base = normalizeOpenAiBase(baseUrl);
  // path e.g. "chat/completions" or "models"
  if (/\/v1$/i.test(base)) return `${base}/${path}`;
  // some providers already include /v4 etc — only auto-append /v1 when missing version segment
  if (/\/v\d+$/i.test(base)) return `${base}/${path}`;
  return `${base}/v1/${path}`;
}

function assertUsableApiKey(apiKey) {
  const key = sanitizeApiKey(apiKey);
  if (!key) {
    const err = new Error('API Key 不能为空');
    err.status = 400;
    throw err;
  }
  if (/^https?:\/\//i.test(key) || key.includes('://') || /api\.[a-z0-9.-]+\//i.test(key)) {
    const err = new Error(
      'API Key 看起来像网址（可能误填了 Base URL）。请只粘贴密钥本身，例如 sk-...，不要填 https://...'
    );
    err.status = 400;
    throw err;
  }
  if (key.includes('/v1') || /\/v\d+\//.test(key) || key.endsWith('/v1')) {
    const err = new Error(
      'API Key 含有路径片段（如 /v1），多半是 Base URL 粘贴进了 Key 框。请重新只填 sk- 密钥。'
    );
    err.status = 400;
    throw err;
  }
  return key;
}

function textFromContent(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromContent).join('');
  if (typeof value === 'object') {
    return textFromContent(value.text ?? value.content ?? value.value ?? value.output_text ?? '');
  }
  return String(value);
}

function normalizeUsage(usage = {}) {
  return {
    promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    completionTokens: usage.completion_tokens ?? usage.output_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
}

function completionEmptyError({ finishReason, reasoningChars = 0, latencyMs = null }) {
  const suffix = finishReason ? `（finish_reason=${finishReason}）` : '';
  const err = new Error(
    reasoningChars
      ? `模型只返回了推理过程，没有返回最终正文；本次收到约 ${reasoningChars} 字推理内容${suffix}。请重新运行，或换非推理/更稳定的模型。`
      : `模型返回了空内容${suffix}。请重新运行，或检查该模型是否支持当前输出类型。`
  );
  err.status = 502;
  err.latencyMs = latencyMs;
  return err;
}

function shouldRetryFinalOnly({ finishReason, reasoningChars = 0, retried = false }) {
  if (retried || !reasoningChars) return false;
  return !finishReason || /length|max_tokens|stop/i.test(String(finishReason));
}

function finalOnlySystem(system) {
  return [FINAL_ONLY_RETRY_SYSTEM, system].filter(Boolean).join('\n\n');
}

function fallbackMaxTokens(maxTokens) {
  return Math.min(32768, Math.max(Number(maxTokens) || 2048, 12000));
}

function isDeepSeekTarget({ baseUrl = '', model = '' } = {}) {
  return /deepseek/i.test(`${baseUrl} ${model}`);
}

function shouldDisableThinking({ baseUrl, model, disableThinking } = {}) {
  if (disableThinking === true) return true;
  if (disableThinking === false) return false;
  return isDeepSeekTarget({ baseUrl, model });
}

function chatCompletionBody({
  model,
  messages,
  temperature,
  maxTokens,
  stream = false,
  disableThinking = false,
  omitTemperature = false,
}) {
  const body = {
    model: String(model),
    messages,
    max_tokens: Number(maxTokens),
  };
  if (!omitTemperature && Number.isFinite(Number(temperature))) {
    body.temperature = Number(temperature);
  }
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  if (disableThinking) body.thinking = { type: 'disabled' };
  return body;
}

function extractCompletion(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const content = textFromContent(
    message.content ??
      message.output_text ??
      message.text ??
      choice.text ??
      data?.output_text ??
      data?.output ??
      data?.response?.output_text ??
      data?.response?.output ??
      data?.content ??
      ''
  );
  const reasoning = textFromContent(
    message.reasoning_content ?? message.reasoning ?? choice.reasoning_content ?? ''
  );
  return {
    content,
    reasoning,
    finishReason: choice.finish_reason ?? choice.finishReason ?? null,
    usage: normalizeUsage(data?.usage || {}),
  };
}

function extractStreamDelta(data) {
  const choice = data?.choices?.[0] || {};
  const delta = choice.delta || {};
  return {
    content: textFromContent(
      delta.content ??
        delta.output_text ??
        choice.text ??
        data?.output_text ??
        (/output_text\.delta$/i.test(String(data?.type || '')) ? data?.delta : '') ??
        ''
    ),
    reasoning: textFromContent(delta.reasoning_content ?? delta.reasoning ?? ''),
    finishReason: choice.finish_reason ?? choice.finishReason ?? null,
    usage: data?.usage ? normalizeUsage(data.usage) : null,
  };
}

function isUnsupportedTemperatureError(message) {
  const text = String(message || '');
  return (
    /temperature.{0,80}(deprecated|not supported|unsupported|not allowed|unknown|invalid)/i.test(text) ||
    /(deprecated|not supported|unsupported|not allowed|unknown).{0,80}temperature/i.test(text)
  );
}

function shouldRetryEmptyCompletion({ finishReason, retried = false }) {
  if (retried) return false;
  return !finishReason || /stop|length|max_tokens/i.test(String(finishReason));
}

function buildMessages(system, prompt) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  messages.push({ role: 'user', content: String(prompt) });
  return messages;
}

async function callChatCompletions({
  baseUrl,
  apiKey,
  model,
  system,
  prompt,
  temperature = 0.7,
  maxTokens = 2048,
  disableThinking = false,
  retriedFinalOnly = false,
  omitTemperature = false,
}) {
  const key = assertUsableApiKey(apiKey);
  const endpoint = openAiEndpoint(baseUrl, 'chat/completions');
  const messages = buildMessages(system, prompt);

  const started = Date.now();
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(
      chatCompletionBody({ model, messages, temperature, maxTokens, disableThinking, omitTemperature })
    ),
  });
  const rawText = await r.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }
  const latencyMs = Date.now() - started;
  if (!r.ok) {
    let msg =
      (data && (data.error?.message || data.message || (typeof data.error === 'string' ? data.error : null))) ||
      rawText.slice(0, 400) ||
      `HTTP ${r.status}`;
    // friendlier auth hint
    if (r.status === 401 || /api key|authentication|unauthorized|invalid.*key/i.test(String(msg))) {
      msg = `${msg}（请确认 Key 正确、未把 Base URL 填进 Key 栏；DeepSeek 官方 Base 一般为 https://api.deepseek.com 或 …/v1）`;
    }
    if (!omitTemperature && isUnsupportedTemperatureError(msg)) {
      return callChatCompletions({
        baseUrl,
        apiKey,
        model,
        system,
        prompt,
        temperature,
        maxTokens,
        disableThinking,
        retriedFinalOnly,
        omitTemperature: true,
      });
    }
    const err = new Error(String(msg));
    err.status = r.status;
    err.latencyMs = latencyMs;
    throw err;
  }
  const completion = extractCompletion(data);
  const content = sanitizeText(completion.content);
  if (!content.trim()) {
    if (
      shouldRetryFinalOnly({
        finishReason: completion.finishReason,
        reasoningChars: completion.reasoning.length,
        retried: retriedFinalOnly,
      }) ||
      shouldRetryEmptyCompletion({ finishReason: completion.finishReason, retried: retriedFinalOnly })
    ) {
      return callChatCompletions({
        baseUrl,
        apiKey,
        model,
        system: finalOnlySystem(system),
        prompt,
        temperature: Math.min(Number(temperature) || 0.7, 0.2),
        maxTokens: completion.reasoning.length ? fallbackMaxTokens(maxTokens) : maxTokens,
        disableThinking,
        retriedFinalOnly: true,
        omitTemperature: true,
      });
    }
    throw completionEmptyError({
      finishReason: completion.finishReason,
      reasoningChars: completion.reasoning.length,
      latencyMs,
    });
  }
  return {
    model: String(model),
    content,
    latencyMs,
    usage: completion.usage,
    finishReason: completion.finishReason,
  };
}

async function callChatCompletionsStream(
  {
    baseUrl,
    apiKey,
    model,
    system,
    prompt,
    temperature = 0.7,
    maxTokens = 2048,
    disableThinking = false,
    retriedFinalOnly = false,
    omitTemperature = false,
  },
  onEvent
) {
  const key = assertUsableApiKey(apiKey);
  const endpoint = openAiEndpoint(baseUrl, 'chat/completions');
  const messages = buildMessages(system, prompt);
  const started = Date.now();
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(
      chatCompletionBody({
        model,
        messages,
        temperature,
        maxTokens,
        stream: true,
        disableThinking,
        omitTemperature,
      })
    ),
  });
  const contentType = r.headers.get('content-type') || '';
  if (!r.ok) {
    const rawText = await r.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
    let msg =
      (data && (data.error?.message || data.message || (typeof data.error === 'string' ? data.error : null))) ||
      rawText.slice(0, 400) ||
      `HTTP ${r.status}`;
    if (r.status === 401 || /api key|authentication|unauthorized|invalid.*key/i.test(String(msg))) {
      msg = `${msg}（请确认 Key 正确、未把 Base URL 填进 Key 栏）`;
    }
    if (!omitTemperature && isUnsupportedTemperatureError(msg)) {
      return callChatCompletionsStream(
        {
          baseUrl,
          apiKey,
          model,
          system,
          prompt,
          temperature,
          maxTokens,
          disableThinking,
          retriedFinalOnly,
          omitTemperature: true,
        },
        onEvent
      );
    }
    const err = new Error(String(msg));
    err.status = r.status;
    err.latencyMs = Date.now() - started;
    throw err;
  }

  if (!r.body || (!/event-stream|text\/event-stream|text\/plain/i.test(contentType) && /json/i.test(contentType))) {
    const rawText = await r.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
    const completion = extractCompletion(data || {});
    const content = sanitizeText(completion.content);
    if (content) onEvent({ type: 'delta', text: content });
    if (completion.reasoning) {
      onEvent({ type: 'reasoning', chars: completion.reasoning.length, total: completion.reasoning.length });
    }
    const latencyMs = Date.now() - started;
    if (!content.trim()) {
      if (
        shouldRetryFinalOnly({
          finishReason: completion.finishReason,
          reasoningChars: completion.reasoning.length,
          retried: retriedFinalOnly,
        }) ||
        shouldRetryEmptyCompletion({ finishReason: completion.finishReason, retried: retriedFinalOnly })
      ) {
        onEvent({
          type: 'retry',
          reason: completion.reasoning.length ? 'reasoning_only' : 'empty_completion',
          reasoningChars: completion.reasoning.length,
          finishReason: completion.finishReason,
        });
        return callChatCompletionsStream(
          {
            baseUrl,
            apiKey,
            model,
            system: finalOnlySystem(system),
            prompt,
            temperature: Math.min(Number(temperature) || 0.7, 0.2),
            maxTokens: completion.reasoning.length ? fallbackMaxTokens(maxTokens) : maxTokens,
            disableThinking,
            retriedFinalOnly: true,
            omitTemperature: true,
          },
          onEvent
        );
      }
      throw completionEmptyError({
        finishReason: completion.finishReason,
        reasoningChars: completion.reasoning.length,
        latencyMs,
      });
    }
    return {
      model: String(model),
      content,
      latencyMs,
      usage: completion.usage,
      finishReason: completion.finishReason,
    };
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoningChars = 0;
  let finishReason = null;
  let usage = {};

  function handleSseData(line) {
    const dataLine = line.replace(/^data:\s*/i, '').trim();
    if (!dataLine || dataLine === '[DONE]') return;
    let data;
    try {
      data = JSON.parse(dataLine);
    } catch {
      return;
    }
    const delta = extractStreamDelta(data);
    if (delta.finishReason) finishReason = delta.finishReason;
    if (delta.usage) usage = delta.usage;
    if (delta.reasoning) {
      reasoningChars += delta.reasoning.length;
      onEvent({ type: 'reasoning', chars: delta.reasoning.length, total: reasoningChars });
    }
    if (delta.content) {
      content += delta.content;
      onEvent({ type: 'delta', text: delta.content, total: content.length });
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach((line) => {
      if (/^data:/i.test(line)) handleSseData(line);
    });
  }
  if (buffer.trim() && /^data:/i.test(buffer.trim())) handleSseData(buffer.trim());

  const latencyMs = Date.now() - started;
  content = sanitizeText(content);
  if (!content.trim()) {
    if (
      shouldRetryFinalOnly({ finishReason, reasoningChars, retried: retriedFinalOnly }) ||
      shouldRetryEmptyCompletion({ finishReason, retried: retriedFinalOnly })
    ) {
      onEvent({
        type: 'retry',
        reason: reasoningChars ? 'reasoning_only' : 'empty_completion',
        reasoningChars,
        finishReason,
      });
      return callChatCompletionsStream(
        {
          baseUrl,
          apiKey,
          model,
          system: finalOnlySystem(system),
          prompt,
          temperature: Math.min(Number(temperature) || 0.7, 0.2),
          maxTokens: reasoningChars ? fallbackMaxTokens(maxTokens) : maxTokens,
          disableThinking,
          retriedFinalOnly: true,
          omitTemperature: true,
        },
        onEvent
      );
    }
    throw completionEmptyError({ finishReason, reasoningChars, latencyMs });
  }
  return {
    model: String(model),
    content,
    latencyMs,
    usage,
    finishReason,
  };
}

async function listRemoteModels({ baseUrl, apiKey }) {
  const key = assertUsableApiKey(apiKey);
  const endpoint = openAiEndpoint(baseUrl, 'models');
  const started = Date.now();
  const r = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
  const rawText = await r.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }
  const latencyMs = Date.now() - started;
  if (!r.ok) {
    let msg =
      (data && (data.error?.message || data.message || data.error)) ||
      rawText.slice(0, 400) ||
      `HTTP ${r.status}`;
    if (r.status === 401 || /api key|authentication|unauthorized|invalid.*key/i.test(String(msg))) {
      msg = `${msg}（鉴权失败：请检查 API Key，不要把 Base URL 填进 Key）`;
    }
    const err = new Error(String(msg));
    err.status = r.status;
    err.latencyMs = latencyMs;
    throw err;
  }
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const models = rows
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || ''))
    .filter(Boolean)
    .map(String)
    .sort((a, b) => a.localeCompare(b));
  return { models, latencyMs, endpoint };
}

// ---------- public ----------
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok\n'));

app.get('/api/meta', (_req, res) => {
  res.json({
    name: '乔木 LLM 擂台',
    domain: 'benchmark.qiaomu.ai',
    version: '1.2.0',
    stats: db.stats(),
  });
});

app.get('/api/cases', (req, res) => {
  const cases = db.listPublishedCases({
    q: String(req.query.q || ''),
    category: String(req.query.category || 'all'),
    difficulty: String(req.query.difficulty || 'all'),
  });
  res.json({ cases });
});

app.get('/api/cases/:id', (req, res) => {
  const c = db.getCase(req.params.id);
  if (!c || c.status !== 'published') {
    res.status(404).json({ error: '题目不存在' });
    return;
  }
  res.json({ case: c });
});

app.get('/api/site-models', (_req, res) => {
  // public models for run — never expose keys
  const models = db.listModels({ publicOnly: true }).map((m) => ({
    id: m.id,
    label: m.label,
    model: m.model,
    baseUrl: m.baseUrl,
    hasKey: m.hasKey,
    enabled: m.enabled,
  }));
  res.json({ models });
});

app.get('/api/contributions', (_req, res) => {
  res.json({ contributions: db.listContributions(100) });
});

app.post('/api/contributions', (req, res) => {
  const body = req.body || {};
  const rl = db.rateLimit(`contrib:${ipHash(req)}`, 20, 60 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: '提交过于频繁，请稍后再试' });
    return;
  }
  const results = Array.isArray(body.results) ? body.results : [];
  if (!body.caseId || !body.prompt || !results.length) {
    res.status(400).json({ error: 'caseId、prompt、results 不能为空' });
    return;
  }
  const cleanResults = sanitizeRunResults(results, 6);
  if (cleanResults.some((r) => !r.model || !r.content)) {
    res.status(400).json({ error: '每个结果需要 model 与 content' });
    return;
  }
  const id = db.addContribution({
    caseId: sanitizeText(body.caseId, 80),
    caseTitle: sanitizeText(body.caseTitle, 120),
    category: sanitizeText(body.category, 40),
    prompt: sanitizeText(body.prompt, 8000),
    author: sanitizeText(body.author || '匿名贡献者', 40),
    note: sanitizeText(body.note || '', 400),
    results: cleanResults,
    scores: body.scores && typeof body.scores === 'object' ? body.scores : {},
  });
  res.status(201).json({ ok: true, id });
});

app.get('/api/run-history', (req, res) => {
  res.json({
    history: db.listRunHistory({
      caseId: sanitizeText(req.query.caseId || '', 80),
      limit: Number(req.query.limit) || 30,
    }),
  });
});

app.post('/api/run-history', (req, res) => {
  const body = req.body || {};
  const rl = db.rateLimit(`history:${ipHash(req)}`, 120, 60 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: '记录过于频繁，请稍后再试' });
    return;
  }
  const c = db.getCase(sanitizeText(body.caseId, 80));
  if (!c || c.status !== 'published') {
    res.status(404).json({ error: '题目不存在' });
    return;
  }
  const cleanResults = sanitizeRunResults(body.results, 8).filter((r) => r.model && r.content);
  if (!cleanResults.length) {
    res.status(400).json({ error: '没有可记录的成功结果' });
    return;
  }
  const id = db.addRunHistory({
    caseId: c.id,
    caseTitle: c.title,
    category: c.category,
    prompt: sanitizeText(body.prompt || c.prompt, 12000),
    results: cleanResults,
    source: 'case',
  });
  res.status(201).json({ ok: true, id });
});

/** User-submitted test cases (pending review). Prompt-only allowed; AI enriches the rest. */
app.post('/api/case-submissions', async (req, res) => {
  const body = req.body || {};
  // honeypot
  if (body.website || body.hp) {
    res.status(201).json({ ok: true, id: 'ok', status: 'pending' });
    return;
  }
  const rl = db.rateLimit(`submit:${ipHash(req)}`, 5, 60 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: '提交过于频繁，每小时最多 5 次' });
    return;
  }
  const prompt = sanitizeText(body.prompt, 12000);
  if (!prompt || prompt.length < 8) {
    res.status(400).json({ error: '至少填写 Prompt（建议完整可跑的评测题）' });
    return;
  }

  let title = sanitizeText(body.title || '', 120);
  let category = sanitizeText(body.category || '', 40);
  let summary = sanitizeText(body.summary || '', 400);
  let difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';
  let tags = Array.isArray(body.tags)
    ? body.tags.map((t) => sanitizeText(String(t), 40)).filter(Boolean).slice(0, 8)
    : String(body.tags || '')
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8);
  let system = sanitizeText(body.system || '', 4000);
  let rubric = Array.isArray(body.rubric)
    ? body.rubric.map((t) => sanitizeText(String(t), 80)).filter(Boolean).slice(0, 10)
    : String(body.rubric || '')
        .split(/[,，\n]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10);
  let outputType = body.outputType === 'html' ? 'html' : 'text';
  let enriched = false;
  let enrichNote = '';

  const needEnrich = !title || !category || !summary || !rubric.length;
  if (needEnrich) {
    const cred = db.findEnrichCredentials();
    if (cred) {
      try {
        const meta = await enrichCaseFromPrompt({
          prompt,
          callChatCompletions,
          credentials: cred,
        });
        if (meta) {
          title = title || meta.title;
          category = category || meta.category;
          summary = summary || meta.summary;
          difficulty = body.difficulty || meta.difficulty;
          if (!tags.length) tags = meta.tags;
          if (!system) system = meta.system;
          if (!rubric.length) rubric = meta.rubric;
          if (!body.outputType) outputType = meta.outputType;
          enriched = true;
          enrichNote = `字段由 ${meta.enrichedBy || cred.model} 自动补全`;
        }
      } catch (err) {
        enrichNote = `自动补全失败：${err.message || 'unknown'}，已用兜底字段`;
      }
    } else {
      enrichNote = '未配置自动补全模型（后台启用带 Key 的站点模型，或设置 BENCHMARK_ENRICH_API_KEY）';
    }
  }

  // fallbacks so review queue always has usable fields
  if (!title) title = prompt.slice(0, 24).replace(/\s+/g, ' ') + (prompt.length > 24 ? '…' : '');
  if (!category) {
    category = /html|网页|three|canvas|css|前端|svg/i.test(prompt) ? 'frontend' : 'creative-writing';
  }
  if (!summary) summary = '用户投稿（待审）';
  if (!rubric.length) rubric = ['完整性', '质量', '可运行/可读'];

  const result = db.createSubmission(
    {
      title,
      category,
      summary,
      difficulty,
      tags,
      system,
      prompt,
      rubric,
      outputType,
      author: sanitizeText(body.author || '匿名', 40),
      note: [sanitizeText(body.note || '', 400), enrichNote].filter(Boolean).join(' · '),
    },
    ipHash(req)
  );
  res.status(201).json({
    ok: true,
    ...result,
    enriched,
    message: enriched
      ? '已提交：标题等字段已自动补全，等待管理员审核'
      : '已提交，等待管理员审核后收录',
  });
});

/** List models from user-provided OpenAI-compatible endpoint (key only in request body). */
app.post('/api/list-models', async (req, res) => {
  const body = req.body || {};
  const rl = db.rateLimit(`list-models:${ipHash(req)}`, 30, 60 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    return;
  }
  if (!body.baseUrl || !body.apiKey) {
    res.status(400).json({ error: 'baseUrl、apiKey 必填' });
    return;
  }
  try {
    const out = await listRemoteModels({ baseUrl: body.baseUrl, apiKey: body.apiKey });
    res.json(out);
  } catch (err) {
    res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: err.message || '拉取模型失败',
      latencyMs: err.latencyMs || null,
    });
  }
});

/**
 * Run models:
 * - mode site: use server-configured model id(s)
 * - mode custom: client provides baseUrl/apiKey/model
 */
function resolveRunTarget(body) {
  if (body.siteModelId) {
    const m = db.getModelSecret(body.siteModelId);
    if (!m || !m.enabled || !m.isPublic) {
      const err = new Error('站点模型不可用');
      err.status = 400;
      throw err;
    }
    if (!m.apiKey) {
      const err = new Error('该站点模型尚未配置 API Key，请用自带 Key 或联系管理员');
      err.status = 400;
      throw err;
    }
    return {
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      model: m.model,
      source: 'site',
      label: m.label,
    };
  }

  const { baseUrl, apiKey, model } = body;
  if (!baseUrl || !apiKey || !model) {
    const err = new Error('baseUrl、apiKey、model 均为必填（或传 siteModelId）');
    err.status = 400;
    throw err;
  }
  return { baseUrl, apiKey, model, source: 'custom' };
}

function sanitizeRunResults(results, limit = 8) {
  return (Array.isArray(results) ? results : []).slice(0, limit).map((r) => ({
    model: sanitizeText(r.model, 80),
    label: sanitizeText(r.label || r.model, 80),
    providerName: sanitizeText(r.providerName, 80),
    profileName: sanitizeText(r.profileName, 80),
    keySource: r.keySource === 'admin' ? 'admin' : r.keySource === 'browser' ? 'browser' : '',
    reportedModel: sanitizeText(r.reportedModel, 80),
    content: sanitizeText(r.content, 40000),
    latencyMs: Number.isFinite(Number(r.latencyMs)) ? Math.round(Number(r.latencyMs)) : null,
    outputType: r.outputType === 'html' ? 'html' : 'text',
  }));
}

app.post('/api/run', async (req, res) => {
  const body = req.body || {};
  const { system, prompt, temperature = 0.7, maxTokens = 2048 } = body;
  if (!prompt) {
    res.status(400).json({ error: 'prompt 必填' });
    return;
  }

  const rl = db.rateLimit(`run:${ipHash(req)}`, 60, 60 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: '调用过于频繁，请稍后再试' });
    return;
  }

  try {
    const target = resolveRunTarget(body);
    const disableThinking = shouldDisableThinking({
      baseUrl: target.baseUrl,
      model: target.model,
      disableThinking: body.disableThinking,
    });
    const out = await callChatCompletions({
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      model: target.model,
      system,
      prompt,
      temperature,
      maxTokens,
      disableThinking,
    });
    res.json({ ...out, source: target.source, label: target.label });
  } catch (err) {
    res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: err.message || '上游请求失败',
      latencyMs: err.latencyMs || null,
    });
  }
});

function writeRunEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
  if (typeof res.flush === 'function') res.flush();
}

app.post('/api/run-stream', async (req, res) => {
  const body = req.body || {};
  const { system, prompt, temperature = 0.7, maxTokens = 2048 } = body;
  if (!prompt) {
    res.status(400).json({ error: 'prompt 必填' });
    return;
  }

  const rl = db.rateLimit(`run:${ipHash(req)}`, 60, 60 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: '调用过于频繁，请稍后再试' });
    return;
  }

  let target;
  try {
    target = resolveRunTarget(body);
  } catch (err) {
    res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 400).json({
      error: err.message || '模型配置不可用',
    });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  writeRunEvent(res, { type: 'start', model: target.model, source: target.source, label: target.label });

  try {
    const disableThinking = shouldDisableThinking({
      baseUrl: target.baseUrl,
      model: target.model,
      disableThinking: body.disableThinking,
    });
    const out = await callChatCompletionsStream(
      {
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        model: target.model,
        system,
        prompt,
        temperature,
        maxTokens,
        disableThinking,
      },
      (event) => writeRunEvent(res, event)
    );
    writeRunEvent(res, { type: 'done', data: { ...out, source: target.source, label: target.label } });
  } catch (err) {
    writeRunEvent(res, {
      type: 'error',
      error: err.message || '上游请求失败',
      latencyMs: err.latencyMs || null,
    });
  } finally {
    res.end();
  }
});

// ---------- admin auth ----------
app.post('/api/admin/login', (req, res) => {
  const password = req.body?.password;
  const rl = db.rateLimit(`login:${ipHash(req)}`, 20, 15 * 60 * 1000);
  if (!rl.ok) {
    res.status(429).json({ error: '登录尝试过多' });
    return;
  }
  if (!db.verifyAdminPassword(password)) {
    res.status(401).json({ error: '密码错误' });
    return;
  }
  const { token, expiresAt } = db.createSession();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  res.json({ ok: true, expiresAt });
});

app.post('/api/admin/logout', (req, res) => {
  db.destroySession(req.cookies[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  const ok = db.isValidSession(req.cookies[COOKIE_NAME]);
  res.json({ authenticated: ok, stats: ok ? db.stats() : null });
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!db.verifyAdminPassword(currentPassword)) {
    res.status(400).json({ error: '当前密码不正确' });
    return;
  }
  if (!newPassword || String(newPassword).length < 8) {
    res.status(400).json({ error: '新密码至少 8 位' });
    return;
  }
  db.setAdminPassword(newPassword);
  res.json({ ok: true });
});

// ---------- admin CRUD ----------
app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  res.json({ stats: db.stats() });
});

app.get('/api/admin/cases', requireAdmin, (_req, res) => {
  res.json({ cases: db.listAllCases() });
});

app.post('/api/admin/cases', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.id || !body.title || !body.prompt || !body.category) {
    res.status(400).json({ error: 'id、title、category、prompt 必填' });
    return;
  }
  const c = db.upsertCase({
    id: sanitizeText(body.id, 80),
    category: sanitizeText(body.category, 40),
    title: sanitizeText(body.title, 120),
    summary: sanitizeText(body.summary || '', 400),
    difficulty: body.difficulty || 'medium',
    tags: body.tags || [],
    system: sanitizeText(body.system || '', 8000),
    prompt: sanitizeText(body.prompt, 20000),
    rubric: body.rubric || [],
    outputType: body.outputType === 'html' ? 'html' : 'text',
    status: body.status || 'published',
    source: body.source || 'official',
    author: sanitizeText(body.author || '', 40),
    sortOrder: body.sortOrder ?? 0,
  });
  res.json({ case: c });
});

app.put('/api/admin/cases/:id', requireAdmin, (req, res) => {
  const body = { ...(req.body || {}), id: req.params.id };
  if (!body.title || !body.prompt || !body.category) {
    res.status(400).json({ error: 'title、category、prompt 必填' });
    return;
  }
  const c = db.upsertCase(body);
  res.json({ case: c });
});

app.delete('/api/admin/cases/:id', requireAdmin, (req, res) => {
  db.deleteCase(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/models', requireAdmin, (_req, res) => {
  res.json({ models: db.listModels({ admin: true }) });
});

app.post('/api/admin/models', requireAdmin, (req, res) => {
  const body = req.body || {};
  const id = sanitizeText(body.id || `model_${Date.now().toString(36)}`, 80);
  if (!body.label || !(body.model || body.model_id) || !(body.baseUrl || body.base_url)) {
    res.status(400).json({ error: 'label、model、baseUrl 必填' });
    return;
  }
  const m = db.upsertModel({ ...body, id });
  res.json({ model: m });
});

app.put('/api/admin/models/:id', requireAdmin, (req, res) => {
  const m = db.upsertModel({ ...(req.body || {}), id: req.params.id });
  res.json({ model: m });
});

app.delete('/api/admin/models/:id', requireAdmin, (req, res) => {
  db.deleteModel(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  res.json({ submissions: db.listSubmissions(String(req.query.status || 'all')) });
});

app.post('/api/admin/submissions/:id/review', requireAdmin, (req, res) => {
  const { action, reviewNote, caseId } = req.body || {};
  if (!['approve', 'reject'].includes(action)) {
    res.status(400).json({ error: 'action 须为 approve 或 reject' });
    return;
  }
  const result = db.reviewSubmission(req.params.id, { action, reviewNote, caseId });
  if (!result) {
    res.status(404).json({ error: '投稿不存在' });
    return;
  }
  res.json(result);
});

app.delete('/api/admin/contributions/:id', requireAdmin, (req, res) => {
  db.deleteContribution(req.params.id);
  res.json({ ok: true });
});

// static
app.use(
  express.static(path.join(ROOT, 'public'), {
    extensions: ['html'],
    maxAge: IS_PROD ? '5m' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`llm-case-benchmark v1.1 listening on http://${HOST}:${PORT}`);
});
