(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  let subStatus = 'pending';
  let editingCaseId = null;
  let isNewModel = false;

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function showAdmin(on) {
    $('#login-view').classList.toggle('hidden', on);
    $('#admin-view').classList.toggle('hidden', !on);
  }

  function setPanel(name) {
    $$('.top-actions .tab-btn[data-panel]').forEach((b) =>
      b.setAttribute('aria-selected', b.dataset.panel === name ? 'true' : 'false')
    );
    $$('.panel').forEach((p) => p.classList.add('hidden'));
    $(`#panel-${name}`)?.classList.remove('hidden');
    if (name === 'models') loadModels();
    if (name === 'cases') loadCases();
    if (name === 'submissions') loadSubmissions();
    if (name === 'dashboard') loadStats();
  }

  async function loadStats() {
    const { stats } = await api('/api/admin/stats');
    $('#admin-stats').textContent = `公开题 ${stats.cases} · 待审 ${stats.pendingSubmissions} · 模型 ${stats.publicModels}/${stats.models}`;
    const badge = $('#pending-badge');
    if (stats.pendingSubmissions > 0) {
      badge.textContent = String(stats.pendingSubmissions);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    $('#stat-grid').innerHTML = [
      ['公开题目', stats.cases],
      ['全部题目', stats.allCases],
      ['待审投稿', stats.pendingSubmissions],
      ['模型总数', stats.models],
      ['公开可用模型', stats.publicModels],
      ['贡献结果', stats.contributions],
    ]
      .map(
        ([l, n]) => `<div class="stat-card"><div class="n">${n}</div><div class="l">${escapeHtml(l)}</div></div>`
      )
      .join('');
  }

  async function loadModels() {
    const { models } = await api('/api/admin/models');
    const tb = $('#models-tbody');
    if (!models.length) {
      tb.innerHTML = '<tr><td colspan="7">暂无模型</td></tr>';
      return;
    }
    tb.innerHTML = models
      .map(
        (m) => `<tr>
        <td>${escapeHtml(m.label)}<br><code>${escapeHtml(m.id)}</code></td>
        <td><code>${escapeHtml(m.model)}</code></td>
        <td style="max-width:180px;word-break:break-all">${escapeHtml(m.baseUrl)}</td>
        <td>${m.hasKey ? '✓' : '—'}</td>
        <td>${m.enabled ? '是' : '否'}</td>
        <td>${m.isPublic ? '是' : '否'}</td>
        <td class="actions">
          <button type="button" class="ghost-btn" data-edit-model="${escapeHtml(m.id)}">编辑</button>
          <button type="button" class="ghost-btn" data-del-model="${escapeHtml(m.id)}">删除</button>
        </td>
      </tr>`
      )
      .join('');
    window.__models = models;
  }

  function openModelForm(m) {
    isNewModel = !m;
    $('#model-form').classList.remove('hidden');
    $('#model-form-title').textContent = m ? `编辑：${m.label}` : '新建模型';
    $('#mf-id').value = m?.id || '';
    $('#mf-id-input').value = m?.id || '';
    $('#mf-id-input').disabled = !!m;
    $('#mf-label').value = m?.label || '';
    $('#mf-model').value = m?.model || '';
    $('#mf-base').value = m?.baseUrl || '';
    $('#mf-key').value = '';
    $('#mf-clear-key').checked = false;
    $('#mf-enabled').checked = m ? !!m.enabled : true;
    $('#mf-public').checked = m ? !!m.isPublic : true;
    $('#mf-sort').value = m?.sortOrder ?? 0;
    $('#mf-notes').value = m?.notes || '';
  }

  async function loadCases() {
    const { cases } = await api('/api/admin/cases');
    window.__cases = cases;
    const tb = $('#cases-tbody');
    tb.innerHTML = cases
      .map(
        (c) => `<tr>
        <td><code>${escapeHtml(c.id)}</code></td>
        <td>${escapeHtml(c.title)}</td>
        <td>${escapeHtml(c.category)}</td>
        <td>${escapeHtml(c.difficulty)}</td>
        <td>${escapeHtml(c.status)}</td>
        <td>${escapeHtml(c.source)}</td>
        <td class="actions">
          <button type="button" class="ghost-btn" data-edit-case="${escapeHtml(c.id)}">编辑</button>
          <button type="button" class="ghost-btn" data-del-case="${escapeHtml(c.id)}">删除</button>
        </td>
      </tr>`
      )
      .join('');
  }

  function openCaseForm(c) {
    editingCaseId = c?.id || null;
    $('#case-form').classList.remove('hidden');
    $('#case-form-title').textContent = c ? `编辑：${c.title}` : '新建题目';
    $('#cf-id').value = c?.id || '';
    $('#cf-id').disabled = !!c;
    $('#cf-title').value = c?.title || '';
    $('#cf-category').value = c?.category || 'creative-writing';
    $('#cf-summary').value = c?.summary || '';
    $('#cf-difficulty').value = c?.difficulty || 'medium';
    $('#cf-output').value = c?.outputType || 'text';
    $('#cf-status').value = c?.status || 'published';
    $('#cf-source').value = c?.source || 'official';
    $('#cf-author').value = c?.author || '';
    $('#cf-tags').value = (c?.tags || []).join(', ');
    $('#cf-rubric').value = (c?.rubric || []).join(', ');
    $('#cf-system').value = c?.system || '';
    $('#cf-prompt').value = c?.prompt || '';
    $('#cf-sort').value = c?.sortOrder ?? 0;
  }

  async function loadSubmissions() {
    const { submissions } = await api(`/api/admin/submissions?status=${encodeURIComponent(subStatus)}`);
    const box = $('#submissions-list');
    if (!submissions.length) {
      box.innerHTML = '<div class="empty-state"><strong>没有记录</strong></div>';
      return;
    }
    box.innerHTML = submissions
      .map((s) => {
        const pending = s.status === 'pending';
        return `<article class="sub-card" data-id="${escapeHtml(s.id)}">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="meta">${escapeHtml(s.category)} · ${escapeHtml(s.difficulty)} · ${escapeHtml(s.outputType)} · ${escapeHtml(s.author)} · ${escapeHtml(s.status)} · ${escapeHtml(s.createdAt)}</div>
          <p style="font-size:13px;color:var(--muted);margin:0 0 8px">${escapeHtml(s.summary || '')}</p>
          <pre>${escapeHtml(s.prompt)}</pre>
          ${s.note ? `<p style="font-size:12px;color:var(--muted)">备注：${escapeHtml(s.note)}</p>` : ''}
          ${
            pending
              ? `<div class="actions">
                  <input class="note" data-note placeholder="审核备注（可选）" />
                  <button type="button" class="primary-btn" data-approve="${escapeHtml(s.id)}">通过并收录</button>
                  <button type="button" class="ghost-btn" data-reject="${escapeHtml(s.id)}">拒绝</button>
                </div>`
              : `<p class="hint" style="margin:0">${escapeHtml(s.reviewNote || '')}</p>`
          }
        </article>`;
      })
      .join('');
  }

  function bind() {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#login-error').textContent = '';
      try {
        await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ password: $('#password').value }),
        });
        showAdmin(true);
        setPanel('dashboard');
        toast('登录成功');
      } catch (err) {
        $('#login-error').textContent = err.message;
      }
    });

    $('#btn-logout').addEventListener('click', async () => {
      await api('/api/admin/logout', { method: 'POST', body: '{}' });
      showAdmin(false);
    });

    $$('.top-actions .tab-btn[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => setPanel(btn.dataset.panel));
    });

    $('#btn-new-model').addEventListener('click', () => openModelForm(null));
    $('#mf-cancel').addEventListener('click', () => $('#model-form').classList.add('hidden'));
    $('#model-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = isNewModel ? $('#mf-id-input').value.trim() : $('#mf-id').value;
      if (!id) {
        toast('请填写模型 ID');
        return;
      }
      const payload = {
        id,
        label: $('#mf-label').value.trim(),
        model: $('#mf-model').value.trim(),
        baseUrl: $('#mf-base').value.trim(),
        enabled: $('#mf-enabled').checked,
        isPublic: $('#mf-public').checked,
        sortOrder: Number($('#mf-sort').value || 0),
        notes: $('#mf-notes').value.trim(),
      };
      if ($('#mf-clear-key').checked) payload.apiKey = '';
      else if ($('#mf-key').value) payload.apiKey = $('#mf-key').value;
      try {
        if (isNewModel) await api('/api/admin/models', { method: 'POST', body: JSON.stringify(payload) });
        else await api(`/api/admin/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        $('#model-form').classList.add('hidden');
        toast('模型已保存');
        loadModels();
        loadStats();
      } catch (err) {
        toast(err.message);
      }
    });

    $('#models-tbody').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit-model]');
      const del = e.target.closest('[data-del-model]');
      if (edit) {
        const m = (window.__models || []).find((x) => x.id === edit.dataset.editModel);
        if (m) openModelForm(m);
      }
      if (del) {
        if (!confirm('确认删除该模型？')) return;
        try {
          await api(`/api/admin/models/${encodeURIComponent(del.dataset.delModel)}`, { method: 'DELETE' });
          toast('已删除');
          loadModels();
        } catch (err) {
          toast(err.message);
        }
      }
    });

    $('#btn-new-case').addEventListener('click', () => openCaseForm(null));
    $('#cf-cancel').addEventListener('click', () => $('#case-form').classList.add('hidden'));
    $('#case-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const split = (s) =>
        String(s || '')
          .split(/[,，]/)
          .map((x) => x.trim())
          .filter(Boolean);
      const payload = {
        id: $('#cf-id').value.trim(),
        title: $('#cf-title').value.trim(),
        category: $('#cf-category').value,
        summary: $('#cf-summary').value.trim(),
        difficulty: $('#cf-difficulty').value,
        outputType: $('#cf-output').value,
        status: $('#cf-status').value,
        source: $('#cf-source').value.trim() || 'official',
        author: $('#cf-author').value.trim(),
        tags: split($('#cf-tags').value),
        rubric: split($('#cf-rubric').value),
        system: $('#cf-system').value,
        prompt: $('#cf-prompt').value,
        sortOrder: Number($('#cf-sort').value || 0),
      };
      try {
        if (editingCaseId) {
          await api(`/api/admin/cases/${encodeURIComponent(editingCaseId)}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
        } else {
          await api('/api/admin/cases', { method: 'POST', body: JSON.stringify(payload) });
        }
        $('#case-form').classList.add('hidden');
        toast('题目已保存');
        loadCases();
        loadStats();
      } catch (err) {
        toast(err.message);
      }
    });

    $('#cases-tbody').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit-case]');
      const del = e.target.closest('[data-del-case]');
      if (edit) {
        const c = (window.__cases || []).find((x) => x.id === edit.dataset.editCase);
        if (c) openCaseForm(c);
      }
      if (del) {
        if (!confirm('确认删除该题目？')) return;
        try {
          await api(`/api/admin/cases/${encodeURIComponent(del.dataset.delCase)}`, { method: 'DELETE' });
          toast('已删除');
          loadCases();
          loadStats();
        } catch (err) {
          toast(err.message);
        }
      }
    });

    $('#sub-filters').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-status]');
      if (!btn) return;
      subStatus = btn.dataset.status;
      $$('#sub-filters .chip').forEach((c) =>
        c.setAttribute('aria-pressed', c === btn ? 'true' : 'false')
      );
      loadSubmissions();
    });

    $('#submissions-list').addEventListener('click', async (e) => {
      const approve = e.target.closest('[data-approve]');
      const reject = e.target.closest('[data-reject]');
      const card = e.target.closest('.sub-card');
      const note = card?.querySelector('[data-note]')?.value || '';
      if (approve) {
        try {
          await api(`/api/admin/submissions/${encodeURIComponent(approve.dataset.approve)}/review`, {
            method: 'POST',
            body: JSON.stringify({ action: 'approve', reviewNote: note }),
          });
          toast('已通过并收录');
          loadSubmissions();
          loadStats();
        } catch (err) {
          toast(err.message);
        }
      }
      if (reject) {
        try {
          await api(`/api/admin/submissions/${encodeURIComponent(reject.dataset.reject)}/review`, {
            method: 'POST',
            body: JSON.stringify({ action: 'reject', reviewNote: note }),
          });
          toast('已拒绝');
          loadSubmissions();
          loadStats();
        } catch (err) {
          toast(err.message);
        }
      }
    });

    $('#password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: $('#pw-cur').value,
            newPassword: $('#pw-new').value,
          }),
        });
        toast('密码已更新');
        e.target.reset();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  async function init() {
    bind();
    try {
      const me = await api('/api/admin/me');
      if (me.authenticated) {
        showAdmin(true);
        setPanel('dashboard');
      } else {
        showAdmin(false);
      }
    } catch {
      showAdmin(false);
    }
  }

  init();
})();
