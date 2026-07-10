'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt, randomToken } = require('./crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.BENCHMARK_DB || path.join(DATA_DIR, 'benchmark.db');
const CASES_SEED = path.join(DATA_DIR, 'cases.json');

let db;
let appSecret;

function getSecret() {
  return appSecret;
}

function jsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function ensureSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      model_id TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_enc TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      difficulty TEXT DEFAULT 'medium',
      tags_json TEXT DEFAULT '[]',
      system_prompt TEXT DEFAULT '',
      prompt TEXT NOT NULL,
      rubric_json TEXT DEFAULT '[]',
      output_type TEXT NOT NULL DEFAULT 'text',
      status TEXT NOT NULL DEFAULT 'published',
      source TEXT NOT NULL DEFAULT 'official',
      author TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS case_submissions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT DEFAULT '',
      difficulty TEXT DEFAULT 'medium',
      tags_json TEXT DEFAULT '[]',
      system_prompt TEXT DEFAULT '',
      prompt TEXT NOT NULL,
      rubric_json TEXT DEFAULT '[]',
      output_type TEXT NOT NULL DEFAULT 'text',
      author TEXT DEFAULT '匿名',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT DEFAULT '',
      reviewed_at TEXT,
      ip_hash TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY,
      case_id TEXT,
      case_title TEXT,
      category TEXT,
      prompt TEXT,
      author TEXT,
      note TEXT,
      results_json TEXT NOT NULL,
      scores_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_history (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      case_title TEXT,
      category TEXT,
      prompt TEXT NOT NULL,
      results_json TEXT NOT NULL,
      source TEXT DEFAULT 'case',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    );
  `);
}

function nowIso() {
  return new Date().toISOString();
}

function seedAdmin(database) {
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get('admin_password_hash');
  const initial = process.env.BENCHMARK_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!row && initial) {
    const hash = bcrypt.hashSync(initial, 10);
    database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('admin_password_hash', hash);
  }
}

function seedSecret(database) {
  let row = database.prepare('SELECT value FROM meta WHERE key = ?').get('app_secret');
  if (process.env.BENCHMARK_SECRET) {
    appSecret = process.env.BENCHMARK_SECRET;
    if (!row) {
      database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('app_secret', appSecret);
    }
    return;
  }
  if (!row) {
    appSecret = randomToken(32);
    database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('app_secret', appSecret);
  } else {
    appSecret = row.value;
  }
}

function seedCases(database) {
  if (!fs.existsSync(CASES_SEED)) return;
  const list = jsonParse(fs.readFileSync(CASES_SEED, 'utf8'), []);
  if (!Array.isArray(list) || !list.length) return;
  const t = nowIso();
  const upsert = database.prepare(`
    INSERT INTO cases (
      id, category, title, summary, difficulty, tags_json, system_prompt, prompt,
      rubric_json, output_type, status, source, author, sort_order, created_at, updated_at
    ) VALUES (
      @id, @category, @title, @summary, @difficulty, @tags_json, @system_prompt, @prompt,
      @rubric_json, @output_type, 'published', 'official', '向阳乔木', @sort_order, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      category=excluded.category,
      title=excluded.title,
      summary=excluded.summary,
      difficulty=excluded.difficulty,
      tags_json=excluded.tags_json,
      system_prompt=cases.system_prompt,
      prompt=cases.prompt,
      rubric_json=cases.rubric_json,
      output_type=cases.output_type,
      status='published',
      sort_order=excluded.sort_order,
      updated_at=excluded.updated_at
  `);
  runTx(database, () => {
    list.forEach((c, i) => {
      upsert.run({
        id: c.id,
        category: c.category,
        title: c.title,
        summary: c.summary || '',
        difficulty: c.difficulty || 'medium',
        tags_json: JSON.stringify(c.tags || []),
        system_prompt: c.system || '',
        prompt: c.prompt,
        rubric_json: JSON.stringify(c.rubric || []),
        output_type: inferCaseOutputType({
          output_type: c.outputType || 'text',
          category: c.category,
          title: c.title,
          summary: c.summary,
          prompt: c.prompt,
          tags_json: JSON.stringify(c.tags || []),
        }),
        sort_order: i,
        created_at: t,
        updated_at: t,
      });
    });
  });
}

function findEnrichCredentials() {
  // 1) env
  if (process.env.BENCHMARK_ENRICH_API_KEY) {
    return {
      apiKey: process.env.BENCHMARK_ENRICH_API_KEY,
      baseUrl: process.env.BENCHMARK_ENRICH_BASE_URL || 'https://api.deepseek.com/v1',
      model: process.env.BENCHMARK_ENRICH_MODEL || 'deepseek-chat',
    };
  }
  // 2) any enabled site model with key (prefer deepseek in label/model)
  const database = openDb();
  const rows = database.prepare('SELECT * FROM models WHERE enabled = 1').all();
  const mapped = rows.map((r) => ({
    apiKey: decrypt(r.api_key_enc, appSecret),
    baseUrl: r.base_url,
    model: r.model_id,
    label: r.label,
  })).filter((r) => r.apiKey);
  if (!mapped.length) return null;
  return (
    mapped.find((m) => /deepseek/i.test(m.model + m.label + m.baseUrl)) ||
    mapped[0]
  );
}

function seedDefaultModels(database) {
  const count = database.prepare('SELECT COUNT(*) AS c FROM models').get().c;
  if (count > 0) return;
  const t = nowIso();
  const defaults = [
    {
      id: 'site-claude',
      label: 'Claude',
      model_id: 'claude-sonnet-4-6',
      base_url: 'https://api.aigocode.com',
      enabled: 0,
      is_public: 1,
      sort_order: 0,
      notes: '在后台填入 API Key 并启用后，访客可直接 Run',
    },
    {
      id: 'site-gpt',
      label: 'GPT',
      model_id: 'gpt-5-mini',
      base_url: 'https://api.aigocode.com',
      enabled: 0,
      is_public: 1,
      sort_order: 1,
      notes: '',
    },
    {
      id: 'site-deepseek',
      label: 'DeepSeek',
      model_id: 'deepseek-chat',
      base_url: 'https://api.deepseek.com',
      enabled: 0,
      is_public: 1,
      sort_order: 2,
      notes: '',
    },
  ];
  const ins = database.prepare(`
    INSERT INTO models (
      id, label, model_id, base_url, api_key_enc, enabled, is_public, sort_order, notes, created_at, updated_at
    ) VALUES (
      @id, @label, @model_id, @base_url, '', @enabled, @is_public, @sort_order, @notes, @created_at, @updated_at
    )
  `);
  runTx(database, () => {
    defaults.forEach((r) =>
      ins.run({
        ...r,
        created_at: t,
        updated_at: t,
      })
    );
  });
}

function openDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  try { db.exec('PRAGMA journal_mode = WAL;'); } catch {}
  ensureSchema(db);
  seedSecret(db);
  seedAdmin(db);
  seedCases(db);
  seedDefaultModels(db);
  return db;
}

function runTx(database, fn) {
  database.exec('BEGIN');
  try {
    fn();
    database.exec('COMMIT');
  } catch (e) {
    try { database.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

function caseRowToPublic(row) {
  if (!row) return null;
  const outputType = inferCaseOutputType(row);
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    summary: row.summary,
    difficulty: row.difficulty,
    tags: jsonParse(row.tags_json, []),
    system: row.system_prompt,
    prompt: row.prompt,
    rubric: jsonParse(row.rubric_json, []),
    outputType,
    status: row.status,
    source: row.source,
    author: row.author,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inferCaseOutputType(row) {
  if ((row.output_type || '').toLowerCase() === 'html') return 'html';
  const blob = `${row.category || ''} ${row.title || ''} ${row.summary || ''} ${row.prompt || ''} ${row.tags_json || ''}`;
  if ((row.category || '').toLowerCase() === 'frontend') return 'html';
  if (/完整\s*html|输出\s*html|html\s*文件|网页|前端|three\.?js|webgl|canvas|svg|纯\s*css|css\s+art|loading\s*动画/i.test(blob)) {
    return 'html';
  }
  return 'text';
}

function modelRowPublic(row, { includeKeyHint = false, includeSecret = false } = {}) {
  if (!row) return null;
  const hasKey = !!(row.api_key_enc && decrypt(row.api_key_enc, appSecret));
  const out = {
    id: row.id,
    label: row.label,
    model: row.model_id,
    baseUrl: row.base_url,
    enabled: !!row.enabled,
    isPublic: !!row.is_public,
    sortOrder: row.sort_order,
    notes: row.notes || '',
    hasKey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeKeyHint) out.apiKeyMasked = hasKey ? '••••••••' : '';
  if (includeSecret) out.apiKey = decrypt(row.api_key_enc, appSecret);
  return out;
}

function listPublishedCases({ q = '', category = 'all', difficulty = 'all' } = {}) {
  const database = openDb();
  let rows = database
    .prepare(`SELECT * FROM cases WHERE status = 'published' ORDER BY sort_order ASC, updated_at DESC`)
    .all();
  if (category && category !== 'all') rows = rows.filter((r) => r.category === category);
  if (difficulty && difficulty !== 'all') rows = rows.filter((r) => r.difficulty === difficulty);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => {
      const blob = `${r.title} ${r.summary} ${r.prompt} ${r.tags_json}`.toLowerCase();
      return blob.includes(needle);
    });
  }
  return rows.map(caseRowToPublic);
}

function listAllCases() {
  return openDb()
    .prepare(`SELECT * FROM cases ORDER BY sort_order ASC, updated_at DESC`)
    .all()
    .map(caseRowToPublic);
}

function getCase(id) {
  const row = openDb().prepare('SELECT * FROM cases WHERE id = ?').get(id);
  return caseRowToPublic(row);
}

function upsertCase(input) {
  const database = openDb();
  const t = nowIso();
  const existing = database.prepare('SELECT id FROM cases WHERE id = ?').get(input.id);
  const payload = {
    id: input.id,
    category: input.category,
    title: input.title,
    summary: input.summary || '',
    difficulty: input.difficulty || 'medium',
    tags_json: JSON.stringify(input.tags || []),
    system_prompt: input.system || input.system_prompt || '',
    prompt: input.prompt,
    rubric_json: JSON.stringify(input.rubric || []),
    output_type: inferCaseOutputType({
      output_type: input.outputType || input.output_type || 'text',
      category: input.category,
      title: input.title,
      summary: input.summary,
      prompt: input.prompt,
      tags_json: JSON.stringify(input.tags || []),
    }),
    status: input.status || 'published',
    source: input.source || 'official',
    author: input.author || '',
    sort_order: Number(input.sortOrder ?? input.sort_order ?? 0),
    updated_at: t,
  };
  if (existing) {
    database
      .prepare(
        `UPDATE cases SET
          category=@category, title=@title, summary=@summary, difficulty=@difficulty,
          tags_json=@tags_json, system_prompt=@system_prompt, prompt=@prompt,
          rubric_json=@rubric_json, output_type=@output_type, status=@status,
          source=@source, author=@author, sort_order=@sort_order, updated_at=@updated_at
        WHERE id=@id`
      )
      .run(payload);
  } else {
    database
      .prepare(
        `INSERT INTO cases (
          id, category, title, summary, difficulty, tags_json, system_prompt, prompt,
          rubric_json, output_type, status, source, author, sort_order, created_at, updated_at
        ) VALUES (
          @id, @category, @title, @summary, @difficulty, @tags_json, @system_prompt, @prompt,
          @rubric_json, @output_type, @status, @source, @author, @sort_order, @created_at, @updated_at
        )`
      )
      .run({ ...payload, created_at: t });
  }
  return getCase(input.id);
}

function deleteCase(id) {
  openDb().prepare('DELETE FROM cases WHERE id = ?').run(id);
}

function listModels({ publicOnly = false, admin = false } = {}) {
  const database = openDb();
  let sql = 'SELECT * FROM models';
  if (publicOnly) sql += ' WHERE enabled = 1 AND is_public = 1';
  sql += ' ORDER BY sort_order ASC, label ASC';
  return database.prepare(sql).all().map((r) => modelRowPublic(r, { includeKeyHint: admin }));
}

function getModel(id, { withSecret = false } = {}) {
  const row = openDb().prepare('SELECT * FROM models WHERE id = ?').get(id);
  return modelRowPublic(row, { includeKeyHint: true, includeSecret: withSecret });
}

function getModelSecret(id) {
  const row = openDb().prepare('SELECT * FROM models WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...modelRowPublic(row),
    apiKey: decrypt(row.api_key_enc, appSecret),
    model: row.model_id,
    baseUrl: row.base_url,
  };
}

function upsertModel(input) {
  const database = openDb();
  const t = nowIso();
  const existing = database.prepare('SELECT * FROM models WHERE id = ?').get(input.id);
  let api_key_enc = existing?.api_key_enc || '';
  if (typeof input.apiKey === 'string') {
    if (input.apiKey === '') {
      api_key_enc = '';
    } else if (!input.apiKey.includes('•')) {
      api_key_enc = encrypt(input.apiKey, appSecret);
    }
  }
  const payload = {
    id: input.id,
    label: input.label || input.model || input.model_id,
    model_id: input.model || input.model_id,
    base_url: input.baseUrl || input.base_url,
    api_key_enc,
    enabled: input.enabled === false || input.enabled === 0 ? 0 : 1,
    is_public: input.isPublic === false || input.is_public === 0 ? 0 : 1,
    sort_order: Number(input.sortOrder ?? input.sort_order ?? 0),
    notes: input.notes || '',
    updated_at: t,
  };
  if (existing) {
    database
      .prepare(
        `UPDATE models SET
          label=@label, model_id=@model_id, base_url=@base_url, api_key_enc=@api_key_enc,
          enabled=@enabled, is_public=@is_public, sort_order=@sort_order, notes=@notes, updated_at=@updated_at
        WHERE id=@id`
      )
      .run(payload);
  } else {
    database
      .prepare(
        `INSERT INTO models (
          id, label, model_id, base_url, api_key_enc, enabled, is_public, sort_order, notes, created_at, updated_at
        ) VALUES (
          @id, @label, @model_id, @base_url, @api_key_enc, @enabled, @is_public, @sort_order, @notes, @created_at, @updated_at
        )`
      )
      .run({ ...payload, created_at: t });
  }
  return getModel(input.id);
}

function deleteModel(id) {
  openDb().prepare('DELETE FROM models WHERE id = ?').run(id);
}

function createSubmission(input, ipHash = '') {
  const database = openDb();
  const id = `sub_${Date.now().toString(36)}_${randomToken(4)}`;
  const t = nowIso();
  database
    .prepare(
      `INSERT INTO case_submissions (
        id, title, category, summary, difficulty, tags_json, system_prompt, prompt,
        rubric_json, output_type, author, note, status, ip_hash, created_at
      ) VALUES (
        @id, @title, @category, @summary, @difficulty, @tags_json, @system_prompt, @prompt,
        @rubric_json, @output_type, @author, @note, 'pending', @ip_hash, @created_at
      )`
    )
    .run({
      id,
      title: input.title,
      category: input.category,
      summary: input.summary || '',
      difficulty: input.difficulty || 'medium',
      tags_json: JSON.stringify(input.tags || []),
      system_prompt: input.system || '',
      prompt: input.prompt,
      rubric_json: JSON.stringify(input.rubric || []),
      output_type: inferCaseOutputType({
        output_type: input.outputType || 'text',
        category: input.category,
        title: input.title,
        summary: input.summary,
        prompt: input.prompt,
        tags_json: JSON.stringify(input.tags || []),
      }),
      author: input.author || '匿名',
      note: input.note || '',
      ip_hash: ipHash,
      created_at: t,
    });
  return { id, status: 'pending', createdAt: t };
}

function listSubmissions(status = 'all') {
  const database = openDb();
  let rows;
  if (status === 'all') {
    rows = database.prepare('SELECT * FROM case_submissions ORDER BY created_at DESC').all();
  } else {
    rows = database
      .prepare('SELECT * FROM case_submissions WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    summary: r.summary,
    difficulty: r.difficulty,
    tags: jsonParse(r.tags_json, []),
    system: r.system_prompt,
    prompt: r.prompt,
    rubric: jsonParse(r.rubric_json, []),
    outputType: inferCaseOutputType(r),
    author: r.author,
    note: r.note,
    status: r.status,
    reviewNote: r.review_note,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  }));
}

function reviewSubmission(id, { action, reviewNote = '', caseId } = {}) {
  const database = openDb();
  const row = database.prepare('SELECT * FROM case_submissions WHERE id = ?').get(id);
  if (!row) return null;
  const t = nowIso();
  if (action === 'reject') {
    database
      .prepare(
        `UPDATE case_submissions SET status='rejected', review_note=?, reviewed_at=? WHERE id=?`
      )
      .run(reviewNote, t, id);
    return { id, status: 'rejected' };
  }
  if (action === 'approve') {
    const newId =
      caseId ||
      `c_${row.title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)}_${Date.now().toString(36)}`;
    upsertCase({
      id: newId,
      category: row.category,
      title: row.title,
      summary: row.summary,
      difficulty: row.difficulty,
      tags: jsonParse(row.tags_json, []),
      system: row.system_prompt,
      prompt: row.prompt,
      rubric: jsonParse(row.rubric_json, []),
      outputType: row.output_type,
      status: 'published',
      source: 'community',
      author: row.author || '社区',
      sortOrder: 1000,
    });
    database
      .prepare(
        `UPDATE case_submissions SET status='approved', review_note=?, reviewed_at=? WHERE id=?`
      )
      .run(reviewNote || `收录为 ${newId}`, t, id);
    return { id, status: 'approved', caseId: newId };
  }
  return null;
}

function addContribution(entry) {
  const database = openDb();
  const id = entry.id || `c_${Date.now().toString(36)}_${randomToken(3)}`;
  database
    .prepare(
      `INSERT INTO contributions (
        id, case_id, case_title, category, prompt, author, note, results_json, scores_json, created_at
      ) VALUES (
        @id, @case_id, @case_title, @category, @prompt, @author, @note, @results_json, @scores_json, @created_at
      )`
    )
    .run({
      id,
      case_id: entry.caseId || '',
      case_title: entry.caseTitle || '',
      category: entry.category || '',
      prompt: entry.prompt || '',
      author: entry.author || '匿名贡献者',
      note: entry.note || '',
      results_json: JSON.stringify(entry.results || []),
      scores_json: JSON.stringify(entry.scores || {}),
      created_at: entry.createdAt || nowIso(),
    });
  return id;
}

function listContributions(limit = 100) {
  return openDb()
    .prepare('SELECT * FROM contributions ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map((r) => ({
      id: r.id,
      caseId: r.case_id,
      caseTitle: r.case_title,
      category: r.category,
      prompt: r.prompt,
      author: r.author,
      note: r.note,
      results: jsonParse(r.results_json, []),
      scores: jsonParse(r.scores_json, {}),
      createdAt: r.created_at,
    }));
}

function deleteContribution(id) {
  openDb().prepare('DELETE FROM contributions WHERE id = ?').run(id);
}

function addRunHistory(entry) {
  const database = openDb();
  const id = entry.id || `run_${Date.now().toString(36)}_${randomToken(3)}`;
  database
    .prepare(
      `INSERT INTO run_history (
        id, case_id, case_title, category, prompt, results_json, source, created_at
      ) VALUES (
        @id, @case_id, @case_title, @category, @prompt, @results_json, @source, @created_at
      )`
    )
    .run({
      id,
      case_id: entry.caseId || '',
      case_title: entry.caseTitle || '',
      category: entry.category || '',
      prompt: entry.prompt || '',
      results_json: JSON.stringify(entry.results || []),
      source: entry.source || 'case',
      created_at: entry.createdAt || nowIso(),
    });
  return id;
}

function listRunHistory({ caseId = '', limit = 30 } = {}) {
  const database = openDb();
  const capped = Math.max(1, Math.min(100, Number(limit) || 30));
  let rows;
  if (caseId) {
    rows = database
      .prepare('SELECT * FROM run_history WHERE case_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(caseId, capped);
  } else {
    rows = database.prepare('SELECT * FROM run_history ORDER BY created_at DESC LIMIT ?').all(capped);
  }
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    caseTitle: r.case_title,
    category: r.category,
    prompt: r.prompt,
    results: jsonParse(r.results_json, []),
    source: r.source,
    createdAt: r.created_at,
  }));
}

function verifyAdminPassword(password) {
  const row = openDb().prepare('SELECT value FROM meta WHERE key = ?').get('admin_password_hash');
  if (!row) return false;
  return bcrypt.compareSync(String(password || ''), row.value);
}

function setAdminPassword(password) {
  const hash = bcrypt.hashSync(String(password), 10);
  openDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES ('admin_password_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(hash);
}

function createSession(ttlHours = 24 * 7) {
  const { hashToken, randomToken: rt } = require('./crypto');
  const token = rt(24);
  const token_hash = hashToken(token);
  const created = nowIso();
  const expires = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  openDb()
    .prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(token_hash, created, expires);
  return { token, expiresAt: expires };
}

function destroySession(token) {
  if (!token) return;
  const { hashToken } = require('./crypto');
  openDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function isValidSession(token) {
  if (!token) return false;
  const { hashToken } = require('./crypto');
  const row = openDb().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    openDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return false;
  }
  return true;
}

function rateLimit(key, limit, windowMs) {
  const database = openDb();
  const now = Date.now();
  const row = database.prepare('SELECT * FROM rate_limits WHERE key = ?').get(key);
  if (!row || now - row.window_start > windowMs) {
    database
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count=1, window_start=excluded.window_start`
      )
      .run(key, now);
    return { ok: true, remaining: limit - 1 };
  }
  if (row.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - row.window_start) };
  }
  database.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
  return { ok: true, remaining: limit - row.count - 1 };
}

function stats() {
  const database = openDb();
  return {
    cases: database.prepare(`SELECT COUNT(*) AS c FROM cases WHERE status='published'`).get().c,
    allCases: database.prepare(`SELECT COUNT(*) AS c FROM cases`).get().c,
    pendingSubmissions: database
      .prepare(`SELECT COUNT(*) AS c FROM case_submissions WHERE status='pending'`)
      .get().c,
    models: database.prepare(`SELECT COUNT(*) AS c FROM models`).get().c,
    publicModels: database
      .prepare(`SELECT COUNT(*) AS c FROM models WHERE enabled=1 AND is_public=1`)
      .get().c,
    contributions: database.prepare(`SELECT COUNT(*) AS c FROM contributions`).get().c,
    runHistory: database.prepare(`SELECT COUNT(*) AS c FROM run_history`).get().c,
  };
}

module.exports = {
  findEnrichCredentials,
  openDb,
  getSecret,
  listPublishedCases,
  listAllCases,
  getCase,
  upsertCase,
  deleteCase,
  listModels,
  getModel,
  getModelSecret,
  upsertModel,
  deleteModel,
  createSubmission,
  listSubmissions,
  reviewSubmission,
  addContribution,
  listContributions,
  deleteContribution,
  addRunHistory,
  listRunHistory,
  verifyAdminPassword,
  setAdminPassword,
  createSession,
  destroySession,
  isValidSession,
  rateLimit,
  stats,
  caseRowToPublic,
};
