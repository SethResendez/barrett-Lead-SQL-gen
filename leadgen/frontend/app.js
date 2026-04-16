// ─── CONFIG ───────────────────────────────────────────────────────────────────
// This gets replaced by deploy.sh with your actual API Gateway URL
const API_BASE = window.LEADGEN_API_BASE || 'https://REPLACE_WITH_API_GATEWAY_URL';

// ─── BATCHDATA HARDCODED FIELD MAP ────────────────────────────────────────────
const BD = {
  firstName: 'Skiptrace:name.first',
  lastName:  'Skiptrace:name.last',
  phone:     'Skiptrace:phoneNumbers.0.number',
  phoneDNC:  'Skiptrace:phoneNumbers.0.dnc',
  email:     'Skiptrace:emails.0.email',
  addrIn:    'Input Data:ADDRESS'
};

const EXTRA_FIELDS = [
  'HC_VALUE_ESTIMATE','PRINCIPAL_OUTSTANDING_TOTAL','LIEN_AMOUNT_TOTAL',
  'PRINCIPAL_PAID_TOTAL','DEFAULT_YN','DEFAULT_DATE_LAST',
  'HC_CONDITION_CLASS','BUILDING_CONDITION_CODE','OWNER_OCCUPIED_YN',
  'LAST_CLOSE_DATE','LAST_CLOSE_PRICE','DEED_DATE','DEED_PRICE',
  'LIEN1_LOAN_TYPE','LIEN1_AMOUNT','LIEN1_CONTRACT_DATE','LIEN1_LOAN_TERM',
  'LIEN1_INTEREST_RATE_USED','LIEN1_LENDER_NAME','YEAR_BUILT','LIVING_AREA',
  'LOT_SIZE','PROPERTY_TYPE','BEDROOMS','BATHROOMS_TOTAL','COUNTY',
  'OWNER_NAME','LIEN1_BORROWER1_NAME','LIEN1_BORROWER2_NAME'
];

// ─── STATE ────────────────────────────────────────────────────────────────────
let S = newStateObj();

function newStateObj() {
  return {
    id: null, loName: '', listLabel: '', inputMode: 'paste',
    versions: [], approvedVersion: null,
    rawRecords: [], skipHeadersCSV: '', rawCount: 0,
    mergedRecords: [], mergedCount: 0, phoneCount: 0, emailCount: 0, dncCount: 0,
    selectedFields: new Set(), customFields: [],
    excelData: null, propensityStats: null, completedStages: new Set(),
    createdAt: null, updatedAt: null
  };
}

function sid() { return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }
function ts()  { return new Date().toISOString(); }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── API CALLS ────────────────────────────────────────────────────────────────
async function apiCall(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`API error ${r.status}: ${txt}`);
  }
  return r.json();
}

async function generateSQLFromAPI(request, mode) {
  const data = await apiCall('/generate-sql', { request, mode });
  return data.sql;
}

async function refineSQLFromAPI(existingSQL, change) {
  const data = await apiCall('/refine-sql', { sql: existingSQL, change });
  return data.sql;
}

async function saveToSharePoint(sessionData) {
  await apiCall('/save-session', { session: sessionData });
}

async function loadAllSessions() {
  const data = await apiCall('/load-sessions', {});
  return data.sessions || [];
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
function toStorable() {
  return {
    id: S.id, loName: S.loName, listLabel: S.listLabel, inputMode: S.inputMode,
    versions: S.versions, approvedVersion: S.approvedVersion,
    rawCount: S.rawCount, mergedCount: S.mergedCount,
    phoneCount: S.phoneCount, emailCount: S.emailCount, dncCount: S.dncCount,
    selectedFields: [...S.selectedFields], customFields: S.customFields,
    completedStages: [...S.completedStages],
    createdAt: S.createdAt, updatedAt: S.updatedAt
  };
}

function showSaveError(msg) {
  let el = document.getElementById('save-error-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-error-toast';
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#c0392b;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;z-index:9999;max-width:360px;';
    document.body.appendChild(el);
  }
  el.textContent = 'Save failed: ' + msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

async function save() {
  if (!S.id) return;
  S.updatedAt = ts();
  try {
    await saveToSharePoint(toStorable());
    updateSummary();
  } catch (e) {
    console.error('Save failed:', e);
    showSaveError(e.message);
  }
}

// ─── SESSION MANAGEMENT ───────────────────────────────────────────────────────
function newSession() {
  S = newStateObj();
  S.id = sid();
  S.createdAt = ts();
  document.getElementById('lo-name').value = '';
  document.getElementById('list-label').value = '';
  document.getElementById('request-input').value = '';
  document.getElementById('sql-display').textContent = '—';
  document.getElementById('ver-list').innerHTML = '';
  document.getElementById('ver-history-card').style.display = 'none';
  document.getElementById('approved-banner').style.display = 'none';
  document.getElementById('st-preview').style.display = 'none';
  document.getElementById('st-merged').style.display = 'none';
  document.getElementById('export-result').style.display = 'none';
  hideSessions();
  goStage(0);
  setMode('paste');
  updateTopLabel();
  updateSummary();
}

async function showSessions() {
  document.getElementById('sessions-panel').style.display = 'block';
  const el = document.getElementById('sessions-list');
  el.innerHTML = '<p class="muted">Loading...</p>';
  try {
    const sessions = await loadAllSessions();
    if (!sessions.length) {
      el.innerHTML = '<p class="muted">No saved sessions yet.</p>';
      return;
    }
    el.innerHTML = '';
    sessions.forEach(e => {
      const stages = ['Request', 'SQL', 'Raw', 'Skip', 'Export'];
      const dots = stages.map((s, i) =>
        `<span class="stage-dot ${e.completedStages && e.completedStages.includes(i) ? 'done' : ''}" title="${s}"></span>`
      ).join('');
      const row = document.createElement('div');
      row.className = 'session-row';
      row.innerHTML = `
        <div class="session-info">
          <div class="session-name">
            ${e.listLabel || 'Untitled'}
            ${e.approvedVersion ? `<span class="badge badge-success">v${e.approvedVersion} approved</span>` : ''}
          </div>
          <div class="session-meta">${e.loName || 'No LO'} · Updated ${fmtDate(e.updatedAt)}</div>
          <div class="session-dots">${dots}</div>
        </div>
        <div class="session-actions">
          <button class="btn btn-sm btn-primary" onclick="resumeSession('${e.id}')">Resume</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSession('${e.id}', this)">Delete</button>
        </div>`;
      el.appendChild(row);
    });
  } catch (e) {
    el.innerHTML = `<p class="muted" style="color:var(--red);">Could not load sessions: ${e.message}</p>`;
  }
}

function hideSessions() { document.getElementById('sessions-panel').style.display = 'none'; }

async function resumeSession(id) {
  const el = document.getElementById('sessions-list');
  el.innerHTML = '<p class="muted">Loading session...</p>';
  try {
    const sessions = await loadAllSessions();
    const d = sessions.find(s => s.id === id);
    if (!d) { alert('Session not found.'); return; }
    Object.assign(S, {
      id: d.id, loName: d.loName || '', listLabel: d.listLabel || '',
      inputMode: d.inputMode || 'paste', versions: d.versions || [],
      approvedVersion: d.approvedVersion || null, rawCount: d.rawCount || 0,
      mergedCount: d.mergedCount || 0, phoneCount: d.phoneCount || 0,
      emailCount: d.emailCount || 0, dncCount: d.dncCount || 0,
      selectedFields: new Set(d.selectedFields || []),
      customFields: d.customFields || [],
      completedStages: new Set((d.completedStages || []).map(Number)),
      createdAt: d.createdAt, updatedAt: d.updatedAt,
      rawRecords: [], mergedRecords: [], skipHeadersCSV: '', excelData: null
    });
    hideSessions();
    document.getElementById('lo-name').value = S.loName;
    document.getElementById('list-label').value = S.listLabel;
    setMode(S.inputMode);
    if (S.versions.length) renderSQL();
    if (S.approvedVersion) document.getElementById('approved-banner').style.display = 'block';
    if (S.rawCount > 0) {
      document.getElementById('st-count-badge').textContent = S.rawCount.toLocaleString() + ' records';
      document.getElementById('st-preview').style.display = 'block';
    }
    if (S.mergedCount > 0) {
      document.getElementById('mc').textContent = S.mergedCount.toLocaleString();
      document.getElementById('pc').textContent = S.phoneCount.toLocaleString();
      document.getElementById('ec').textContent = S.emailCount.toLocaleString();
      document.getElementById('dc').textContent = S.dncCount.toLocaleString();
      document.getElementById('st-merged').style.display = 'block';
    }
    const hi = S.completedStages.size ? Math.max(...S.completedStages) : 0;
    goStage(hi);
    updateTopLabel();
    updateSummary();
  } catch (e) {
    alert('Could not load session: ' + e.message);
  }
}

async function deleteSession(id, btn) {
  if (!confirm('Delete this session? This cannot be undone.')) return;
  try {
    await apiCall('/delete-session', { id });
    btn.closest('.session-row').remove();
    if (S.id === id) newSession();
  } catch (e) {
    alert('Could not delete: ' + e.message);
  }
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function updateTopLabel() {
  document.getElementById('top-session-label').textContent =
    S.listLabel ? `${S.loName || '?'} — ${S.listLabel}` : 'No active session';
}

function updateSummary() {
  const bar = document.getElementById('summary-bar');
  if (!S.id || (!S.loName && !S.listLabel)) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const stages = ['Request', 'SQL', 'Raw', 'Skip Trace', 'Export'];
  document.getElementById('stage-progress').innerHTML = stages.map((s, i) => {
    const done = S.completedStages.has(i);
    return `<div class="stage-progress-item ${done ? 'done' : ''}"><span class="stage-dot ${done ? 'done' : ''}"></span>${s}</div>` +
      (i < stages.length - 1 ? '<span class="stage-progress-sep">›</span>' : '');
  }).join('');
  const av = S.approvedVersion;
  document.getElementById('summary-grid').innerHTML = [
    { label: 'LO', val: S.loName || '—' },
    { label: 'List', val: S.listLabel || '—' },
    { label: 'SQL versions', val: S.versions.length || 0 },
    { label: 'Approved', val: av ? `v${av.v}` : 'Pending', cls: av ? 'green' : '' },
    { label: 'Approved count', val: av && av.count != null ? Number(av.count).toLocaleString() : '—', cls: 'blue' },
    { label: 'Merged records', val: S.mergedCount ? S.mergedCount.toLocaleString() : '—' },
    { label: 'With phone', val: S.phoneCount ? S.phoneCount.toLocaleString() : '—' },
    { label: 'With email', val: S.emailCount ? S.emailCount.toLocaleString() : '—' },
    { label: 'DNC flagged', val: S.dncCount ? S.dncCount.toLocaleString() : '—' },
    ...(S.propensityStats && S.propensityStats.hasData ? [
      { label: 'Avg sell propensity', val: S.propensityStats.sellAvg !== null ? S.propensityStats.sellAvg : '—', cls: 'blue' },
      { label: 'Avg refi propensity', val: S.propensityStats.refiAvg !== null ? S.propensityStats.refiAvg : '—', cls: 'blue' },
    ] : []),
    { label: 'Updated', val: fmtDate(S.updatedAt) },
  ].map(c => `<div class="sum-cell"><div class="s-label">${c.label}</div><div class="s-val${c.cls ? ' ' + c.cls : ''}">${c.val}</div></div>`).join('');
}

function goStage(n) {
  document.querySelectorAll('.step-section').forEach((s, i) => s.classList.toggle('visible', i === n));
  document.querySelectorAll('.stage-btn').forEach((b, i) => {
    b.classList.toggle('active', i === n);
    b.classList.toggle('done', S.completedStages.has(i) && i !== n);
  });
  S.completedStages.add(n);
  if (n === 4) renderFieldGrid();
  save();
}

function setMode(m) {
  S.inputMode = m;
  document.getElementById('mode-paste').classList.toggle('active-mode', m === 'paste');
  document.getElementById('mode-free').classList.toggle('active-mode', m === 'free');
  document.getElementById('mode-hint').textContent = m === 'paste'
    ? 'Paste a row from your Excel tracker (tab-separated)'
    : 'Describe the list in plain language — target, geography, criteria';
  document.getElementById('request-input').placeholder = m === 'paste'
    ? 'Paste Excel row here...'
    : 'e.g. "Non-owner-occupied, Hennepin + Anoka, loan 100k–500k, in default"';
}

function showError(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.style.display = 'block'; }
function hideError(id) { document.getElementById(id).style.display = 'none'; }

// ─── STAGE 1: GENERATE SQL ────────────────────────────────────────────────────
async function generateSQL() {
  const req = document.getElementById('request-input').value.trim();
  if (!req) { showError('s1-error', 'Enter a request first.'); return; }
  hideError('s1-error');
  S.loName = document.getElementById('lo-name').value.trim() || 'Unknown LO';
  S.listLabel = document.getElementById('list-label').value.trim() || 'Untitled list';
  document.getElementById('s1-loading').style.display = 'flex';
  try {
    const sql = await generateSQLFromAPI(req, S.inputMode);
    S.versions = [{ v: 1, sql: sql.trim(), count: null, change: 'Initial generation', approved: false }];
    document.getElementById('s1-loading').style.display = 'none';
    renderSQL();
    updateTopLabel();
    updateSummary();
    await save();
    goStage(1);
  } catch (e) {
    document.getElementById('s1-loading').style.display = 'none';
    showError('s1-error', 'Error generating SQL: ' + e.message);
  }
}

// ─── STAGE 2: SQL REFINEMENT ──────────────────────────────────────────────────
function renderSQL() {
  const cur = S.versions[S.versions.length - 1];
  document.getElementById('sql-display').textContent = fmtSQL(cur.sql);
  document.getElementById('ver-label').textContent = `v${cur.v}`;
  renderVerHistory();
}

function renderVerHistory() {
  const list = document.getElementById('ver-list');
  const card = document.getElementById('ver-history-card');
  if (!S.versions.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  list.innerHTML = '';
  [...S.versions].reverse().forEach(v => {
    const row = document.createElement('div');
    row.className = 'version-row' + (v.approved ? ' approved' : '');
    row.innerHTML = `<span class="badge badge-info">v${v.v}</span>
      <span class="version-change">${v.change}</span>
      ${v.count != null ? `<span class="version-count">${Number(v.count).toLocaleString()}</span>` : '<span class="version-count" style="color:var(--text-hint);">—</span>'}
      ${v.approved ? '<span class="badge badge-success">approved</span>' : ''}`;
    list.appendChild(row);
  });
}

async function submitChange() {
  const countRaw = document.getElementById('count-input').value.trim();
  const change = document.getElementById('change-input').value.trim();
  if (!change) return;
  hideError('s2-error');
  const cur = S.versions[S.versions.length - 1];
  if (countRaw) cur.count = parseInt(countRaw);
  if (change.toLowerCase().includes('approv')) {
    cur.approved = true;
    S.approvedVersion = cur;
    document.getElementById('count-input').value = '';
    document.getElementById('change-input').value = '';
    renderSQL();
    document.getElementById('approved-banner').style.display = 'block';
    updateSummary();
    await save();
    return;
  }
  document.getElementById('s2-loading').style.display = 'flex';
  try {
    const newSQL = await refineSQLFromAPI(cur.sql, change);
    S.versions.push({ v: S.versions.length + 1, sql: newSQL.trim(), count: null, change, approved: false });
    document.getElementById('s2-loading').style.display = 'none';
    document.getElementById('count-input').value = '';
    document.getElementById('change-input').value = '';
    renderSQL();
    updateSummary();
    await save();
  } catch (e) {
    document.getElementById('s2-loading').style.display = 'none';
    showError('s2-error', 'Error refining SQL: ' + e.message);
  }
}

function fmtSQL(sql) {
  try {
    return sqlFormatter.format(sql, { language: 'sql', keywordCase: 'upper', indentStyle: 'standard' });
  } catch (e) {
    return sql;
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}

function copySQL() {
  copyToClipboard(fmtSQL(S.versions[S.versions.length - 1].sql));
  const btn = document.getElementById('copy-sql-btn');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy SQL', 1500);
}

// ─── PROPENSITY HIGHLIGHTS ───────────────────────────────────────────────────
function renderPropensityHighlights() {
  const el = document.getElementById('propensity-highlights');
  if (!el) return;
  const p = S.propensityStats;
  if (!p || !p.hasData) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const fmt = v => v !== null ? v : '—';
  const fmtN = v => v !== null ? Number(v).toLocaleString() : '—';
  el.innerHTML = `
    <div class="card-label" style="margin-bottom:10px;">Propensity scores (ZIP-level percentiles)</div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-val blue">${fmt(p.sellAvg)}</div><div class="stat-lbl">Avg sell propensity</div></div>
      <div class="stat-card"><div class="stat-val blue">${fmt(p.refiAvg)}</div><div class="stat-lbl">Avg refi propensity</div></div>
      <div class="stat-card"><div class="stat-val">${fmtN(p.sellHigh)}</div><div class="stat-lbl">High sell score (≥75th)</div></div>
      <div class="stat-card"><div class="stat-val">${fmtN(p.refiHigh)}</div><div class="stat-lbl">High refi score (≥75th)</div></div>
    </div>`;
}

// ─── STAGE 3: RAW OUTPUT ──────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const parse = line => {
    const res = []; let cur = '', inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === delim && !inQ) { res.push(cur); cur = ''; }
      else { cur += c; }
    }
    res.push(cur);
    return res;
  };
  const headers = parse(lines[0]);
  return lines.slice(1).map(l => {
    const vals = parse(l);
    const r = {};
    headers.forEach((h, i) => r[h.trim()] = (vals[i] || '').trim());
    return r;
  });
}

function processRaw() {
  const raw = document.getElementById('raw-output').value.trim();
  if (!raw) return;
  hideError('s3-error');
  document.getElementById('s3-loading').style.display = 'flex';
  setTimeout(async () => {
    try {
      const records = parseCSV(raw);
      S.rawRecords = records;
      S.rawCount = records.length;
      const sellVals = records.map(r => parseFloat(r['PROPENSITY_SELL_PERCENTILE_ZIP'])).filter(v => !isNaN(v));
      const refiVals = records.map(r => parseFloat(r['PROPENSITY_REFINANCE_PERCENTILE_ZIP'])).filter(v => !isNaN(v));
      const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;
      S.propensityStats = {
        sellAvg: avg(sellVals), refiAvg: avg(refiVals),
        sellHigh: sellVals.length ? sellVals.filter(v => v >= 75).length : null,
        refiHigh: refiVals.length ? refiVals.filter(v => v >= 75).length : null,
        hasData: sellVals.length > 0 || refiVals.length > 0
      };
      renderPropensityHighlights();
      const q = v => `"${(v || '').replace(/"/g, '""')}"`;
      const lines = ['OWNER_NAME,ADDRESS,CITY,STATE,ZIPCODE'];
      records.forEach(r => lines.push([
        q(r['OWNER_NAME'] || r['LIEN1_BORROWER1_NAME'] || ''),
        q(r['ADDRESS'] || ''), q(r['CITY'] || ''), q(r['STATE'] || ''), q(r['ZIPCODE'] || '')
      ].join(',')));
      S.skipHeadersCSV = lines.join('\n');
      document.getElementById('st-count-badge').textContent = records.length.toLocaleString() + ' records';
      document.getElementById('st-display').textContent = lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n... (${records.length} total)` : '');
      document.getElementById('st-preview').style.display = 'block';
      document.getElementById('s3-loading').style.display = 'none';
      updateSummary();
      await save();
    } catch (e) {
      document.getElementById('s3-loading').style.display = 'none';
      showError('s3-error', 'Could not parse output: ' + e.message);
    }
  }, 100);
}

function copySkipTrace() {
  copyToClipboard(S.skipHeadersCSV);
  const btn = document.getElementById('copy-st-btn');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy list', 1500);
}

// ─── STAGE 4: SKIP TRACE ──────────────────────────────────────────────────────
function processSkipTrace() {
  const raw = document.getElementById('st-input').value.trim();
  if (!raw) return;
  hideError('s4-error');
  document.getElementById('s4-loading').style.display = 'flex';
  setTimeout(async () => {
    try {
      const stRows = parseCSV(raw);
      const stByAddr = {};
      stRows.forEach(r => {
        const k = (r[BD.addrIn] || '').toUpperCase().trim();
        stByAddr[k] = r;
      });
      const merged = S.rawRecords.map(raw => {
        const addr = (raw['ADDRESS'] || '').toUpperCase().trim();
        return { raw, bd: stByAddr[addr] || null };
      });
      S.mergedRecords = merged;
      S.mergedCount = merged.length;
      S.phoneCount = merged.filter(({ bd }) => bd && (bd[BD.phone] || '').trim()).length;
      S.emailCount = merged.filter(({ bd }) => bd && (bd[BD.email] || '').trim()).length;
      S.dncCount = merged.filter(({ bd }) => bd && String(bd[BD.phoneDNC] || '').toLowerCase() === 'true').length;
      document.getElementById('mc').textContent = S.mergedCount.toLocaleString();
      document.getElementById('pc').textContent = S.phoneCount.toLocaleString();
      document.getElementById('ec').textContent = S.emailCount.toLocaleString();
      document.getElementById('dc').textContent = S.dncCount.toLocaleString();
      document.getElementById('st-merged').style.display = 'block';
      document.getElementById('s4-loading').style.display = 'none';
      updateSummary();
      await save();
    } catch (e) {
      document.getElementById('s4-loading').style.display = 'none';
      showError('s4-error', 'Could not parse skip trace: ' + e.message);
    }
  }, 100);
}

// ─── STAGE 5: EXPORT ──────────────────────────────────────────────────────────
function renderFieldGrid() {
  const grid = document.getElementById('field-grid');
  grid.innerHTML = '';
  [...EXTRA_FIELDS, ...S.customFields].forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'field-chip' + (S.selectedFields.has(f) ? ' selected' : '');
    chip.textContent = f;
    chip.onclick = () => {
      S.selectedFields.has(f) ? S.selectedFields.delete(f) : S.selectedFields.add(f);
      renderFieldGrid();
      save();
    };
    grid.appendChild(chip);
  });
}

function addCustomField() {
  const val = document.getElementById('custom-col').value.trim().toUpperCase();
  if (!val) return;
  if (!S.customFields.includes(val) && !EXTRA_FIELDS.includes(val)) S.customFields.push(val);
  S.selectedFields.add(val);
  document.getElementById('custom-col').value = '';
  renderFieldGrid();
  save();
}

function buildExport() {
  document.getElementById('export-loading').style.display = 'flex';
  document.getElementById('export-result').style.display = 'none';
  hideError('export-error');
  setTimeout(() => {
    try {
      const wb = XLSX.utils.book_new();
      const extraCols = [...S.selectedFields];
      const headers = ['Name', 'Phone', 'Email', 'Address', 'DNC', ...extraCols];
      const rows = [headers];
      const src = S.mergedRecords.length > 0 ? S.mergedRecords : S.rawRecords.map(r => ({ raw: r, bd: null }));
      src.forEach(({ raw, bd }) => {
        const firstName = bd ? (bd[BD.firstName] || '') : '';
        const lastName  = bd ? (bd[BD.lastName] || '') : '';
        const name = [firstName, lastName].filter(Boolean).join(' ') || raw['OWNER_NAME'] || raw['LIEN1_BORROWER1_NAME'] || '';
        const phone = bd ? (bd[BD.phone] || '') : '';
        const email = bd ? (bd[BD.email] || '') : '';
        const addr  = raw['ADDRESS_SLUG'] || raw['ADDRESS'] || '';
        const dnc   = bd ? String(bd[BD.phoneDNC] || '') : '';
        rows.push([name, phone, email, addr, dnc, ...extraCols.map(f => raw[f] || '')]);
      });
      const cs = XLSX.utils.aoa_to_sheet(rows);
      cs['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 28 }, { wch: 42 }, { wch: 6 }, ...extraCols.map(() => ({ wch: 20 }))];
      XLSX.utils.book_append_sheet(wb, cs, 'Contacts');
      if (S.rawRecords.length) {
        const sfHeaders = Object.keys(S.rawRecords[0]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sfHeaders, ...S.rawRecords.map(r => sfHeaders.map(h => r[h] || ''))]), 'Raw Snowflake Data');
      }
      const meta = [
        ['Barrett Financial — Lead Gen Export'], [],
        ['LO', S.loName], ['List', S.listLabel],
        ['Export date', new Date().toLocaleDateString()],
        ['Total records', S.mergedCount || S.rawCount],
        ['With phone', S.phoneCount], ['With email', S.emailCount], ['DNC flagged', S.dncCount], [],
        ['Approved SQL', 'v' + (S.approvedVersion ? S.approvedVersion.v : 'n/a')], [],
        ['Version History'], ['Version', 'Change Request', 'Count', 'Approved']
      ];
      S.versions.forEach(v => meta.push([`v${v.v}`, v.change, v.count != null ? v.count : '', v.approved ? 'Yes' : '']));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), 'Session Log');
      const approvedSQL = S.approvedVersion ? S.approvedVersion.sql : (S.versions.length ? S.versions[S.versions.length - 1].sql : '');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Approved SQL'], [], [approvedSQL]]), 'SQL');
      S.excelData = wb;
      document.getElementById('export-loading').style.display = 'none';
      document.getElementById('export-result').style.display = 'block';
    } catch (e) {
      document.getElementById('export-loading').style.display = 'none';
      showError('export-error', 'Export failed: ' + e.message);
    }
  }, 200);
}

function downloadExcel() {
  if (!S.excelData) return;
  const label = (S.listLabel || 'lead-list').replace(/\s+/g, '-').toLowerCase();
  XLSX.writeFile(S.excelData, `${label}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
setMode('paste');
