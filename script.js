(() => {
'use strict';
const CFG = window.TB_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtBytes = b => { if (b == null) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const fmtUp = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm'; };

/* ===================================================== settings storage === */
const store = {
  get apiUrl() { return (localStorage.getItem('tb_api_url') || CFG.API_URL || '').replace(/\/+$/, ''); },
  set apiUrl(v) { v ? localStorage.setItem('tb_api_url', v) : localStorage.removeItem('tb_api_url'); },
  get token() { return sessionStorage.getItem('tb_token') || localStorage.getItem('tb_token') || ''; },
  setToken(v, remember) {
    sessionStorage.removeItem('tb_token'); localStorage.removeItem('tb_token');
    if (v) (remember ? localStorage : sessionStorage).setItem('tb_token', v);
  },
};

/* ============================================================ API layer === */
class ApiError extends Error {
  constructor(status, detail) {
    const msg = Array.isArray(detail) ? detail.map(d => d.msg).join('; ') : typeof detail === 'string' ? detail : (detail && detail.message) || 'Request failed';
    super(msg); this.status = status; this.detail = detail;
  }
}
async function api(path, { method = 'GET', body } = {}) {
  if (!store.apiUrl) throw new ApiError(0, 'Backend API URL is not set.');
  const headers = { Authorization: 'Bearer ' + store.token };
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(store.apiUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError(0, 'Cannot reach the backend. On Render free tier it may be waking up (up to ~60s). Check the URL and try again.'); }
  let data = null; try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.detail) || res.statusText);
  return data;
}
function xhrUpload(path, fd, onProg) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', store.apiUrl + path);
    x.setRequestHeader('Authorization', 'Bearer ' + store.token);
    x.upload.onprogress = e => e.lengthComputable && onProg(e.loaded / e.total);
    x.upload.onload = () => onProg(1);
    x.onload = () => { let d = null; try { d = JSON.parse(x.responseText); } catch { /* */ } x.status < 300 ? resolve(d) : reject(new ApiError(x.status, (d && d.detail) || x.statusText)); };
    x.onerror = () => reject(new ApiError(0, 'Network error during upload.'));
    x.send(fd);
  });
}
const API = {
  vpsStatus: () => api('/api/vps/status'),
  connect: b => api('/api/vps/connect', { method: 'POST', body: b }),
  disconnect: () => api('/api/vps/disconnect', { method: 'POST' }),
  stats: () => api('/api/server/stats'),
  bots: () => api('/api/bots'),
  action: (id, a) => api(`/api/bots/${encodeURIComponent(id)}/${a}`, { method: 'POST' }),
  remove: id => api(`/api/bots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  install: id => api(`/api/bots/${encodeURIComponent(id)}/install`, { method: 'POST' }),
  installStatus: id => api(`/api/bots/${encodeURIComponent(id)}/install`),
  logs: (id, cursor) => api(`/api/bots/${encodeURIComponent(id)}/logs?lines=300${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`),
};

/* ================================================================ UI kit === */
const state = { vps: null, bots: [], view: 'dashboard', timer: null };

function toast(msg, kind = 'ok') {
  const t = document.createElement('div'); t.className = 'toast ' + (kind === 'ok' ? '' : kind); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4000);
}
function confirmDialog({ title, text, okText = 'Confirm', danger = false, hideCancel = false, pre = false }) {
  const d = $('#dlg'), ok = $('#dlgOk'), cancel = $('#dlgCancel');
  $('#dlgTitle').textContent = title; const t = $('#dlgText'); t.textContent = text; t.className = pre ? 'pre' : '';
  ok.textContent = okText; ok.className = 'btn ' + (danger ? 'danger' : 'primary'); cancel.hidden = hideCancel;
  return new Promise(res => {
    const done = v => { d.close(); res(v); };
    ok.onclick = () => done(true); cancel.onclick = () => done(false);
    d.addEventListener('close', () => res(false), { once: true });
    d.showModal();
  });
}
function banner(kind, html) {
  const b = $('#banner'); if (!kind) { b.hidden = true; return; }
  b.className = 'banner ' + kind; b.innerHTML = ico('alert') + `<div>${html}</div>`; b.hidden = false;
}
function setPill(kind, text) {
  const p = $('#pill'); p.className = 'pill ' + kind; $('span', p).textContent = text;
  $('#sideDot').className = 'dot ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : ''); $('#sideText').textContent = text;
}
function diagnose(e) {
  setPill('err', e.status === 401 ? 'Token rejected' : 'Backend error');
  if (e.status === 401) banner('err', 'The access token was rejected. <a href="#settings">Update it in Settings</a>.');
  else banner('err', esc(e.message));
}
async function busy(btn, fn) {
  btn.disabled = true; btn.classList.add('busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); }
}
const configured = () => store.apiUrl && store.token;

/* ============================================================= navigation === */
const VIEWS = {
  dashboard: ['Dashboard', 'Live overview of your VPS and bots', 'dashboard'],
  vps: ['VPS connection', 'Enter your server login to link it', 'plug'],
  bots: ['Bots', 'Start, stop and inspect your Telegram bots', 'bot'],
  upload: ['Upload bot', 'Add a project to your VPS', 'upload'],
  logs: ['Live logs', 'Output from your running bots', 'terminal'],
  settings: ['Settings', 'Backend URL and access token', 'sliders'],
};
function buildNav() {
  $('#bottomNav').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<a href="#${k}" data-view="${k}">${ico(v[2])}<span>${v[0].split(' ')[0]}</span></a>`).join('');
}
function go(view) {
  if (!VIEWS[view]) view = 'dashboard';
  state.view = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('#title').textContent = VIEWS[view][0]; $('#subtitle').textContent = VIEWS[view][1];
  clearInterval(state.timer); stopLogs();
  refresh();
  if (view === 'dashboard') state.timer = setInterval(() => !document.hidden && refresh(true), 15000);
  if (view === 'bots') state.timer = setInterval(() => !document.hidden && refresh(true), 8000);
}
async function refresh(quiet) {
  const btn = $('#refreshBtn'); if (!quiet) btn.classList.add('spin');
  try {
    ({ dashboard: loadDashboard, vps: loadVps, bots: loadBots, upload: async () => { }, logs: loadLogsView, settings: loadSettings })[state.view]();
  } finally { setTimeout(() => btn.classList.remove('spin'), 600); }
}

/* ============================================================== dashboard === */
function statCard(icon, label, value, sub, pct) {
  const meter = pct != null ? `<div class="meter"><i class="${pct > 85 ? 'hot' : ''}" style="width:${Math.min(100, pct)}%"></i></div>` : '';
  return `<div class="card stat"><div class="hd">${ico(icon)}${esc(label)}</div><div class="v">${value}</div><div class="s">${sub || ''}</div>${meter}</div>`;
}
function statsHtml(v, s, bots) {
  const on = v && v.connected, dash = '—', n = k => on ? bots.filter(b => b.status === k).length : dash;
  return [
    statCard('server', 'VPS', on ? '<span class="t-ok">Connected</span>' : '<span class="t-err">Disconnected</span>', on ? esc(`${v.username}@${v.host}:${v.port}`) : 'Open VPS connection'),
    statCard('box', 'Total bots', on ? bots.length : dash, 'Projects on the VPS'),
    statCard('play', 'Running', n('running'), 'Active now'),
    statCard('stop', 'Stopped', n('stopped'), 'Not running'),
    statCard('alert', 'Failed', n('failed'), 'Crashed or restarting'),
    statCard('cpu', 'CPU', s ? s.cpu_percent + '%' : dash, s ? `${s.cpu_cores} cores · load ${esc(s.load)}` : '', s && s.cpu_percent),
    statCard('db', 'RAM', s ? s.ram.percent + '%' : dash, s ? `${fmtBytes(s.ram.used)} of ${fmtBytes(s.ram.total)}` : '', s && s.ram.percent),
    statCard('disk', 'Disk', s ? s.disk.percent + '%' : dash, s ? `${fmtBytes(s.disk.used)} of ${fmtBytes(s.disk.total)}` : '', s && s.disk.percent),
    statCard('clock', 'Uptime', s ? fmtUp(s.uptime_seconds) : dash, s ? esc(s.hostname) : ''),
  ].join('');
}
async function loadDashboard() {
  const grid = $('#statGrid');
  if (!configured()) { banner('warn', 'Add your backend URL and access token in <a href="#settings">Settings</a> to get started.'); setPill('off', 'Not configured'); grid.innerHTML = statsHtml(null, null, []); return; }
  try {
    const v = state.vps = await API.vpsStatus();
    if (!v.connected) {
      setPill('off', 'VPS offline');
      banner('warn', (v.last_error ? esc(v.last_error) + ' ' : 'The VPS is not connected. Enter your server login to continue. ') + '<a href="#vps">Open VPS connection</a>.');
      grid.innerHTML = statsHtml(v, null, []); return;
    }
    banner(); setPill('ok', 'VPS online');
    const [s, b] = await Promise.all([API.stats(), API.bots()]);
    state.bots = b.bots; grid.innerHTML = statsHtml(v, s, b.bots);
  } catch (e) { diagnose(e); grid.innerHTML = statsHtml(null, null, []); }
}

/* ===================================================================== VPS === */
async function loadVps() {
  const info = $('#vpsInfo');
  if (!configured()) { info.innerHTML = `<div class="empty">${ico('plug')}<b>Backend not configured</b><span>Set the API URL and token first.</span><a class="btn primary" href="#settings">Open Settings</a></div>`; return; }
  try {
    const v = state.vps = await API.vpsStatus(); banner();
    setPill(v.connected ? 'ok' : 'off', v.connected ? 'VPS online' : 'VPS offline');
    if (v.host && !$('#vHost').value) { $('#vHost').value = v.host; $('#vPort').value = v.port; $('#vUser').value = v.username || ''; }
    const row = (k, val) => `<dt>${k}</dt><dd>${val || '—'}</dd>`;
    info.innerHTML = `<h2>Connection</h2><dl class="kv">
      ${row('Status', v.connected ? '<span class="t-ok">Connected</span>' : '<span class="t-err">Disconnected</span>')}
      ${row('Server', v.host ? esc(`${v.username}@${v.host}:${v.port}`) : '')}
      ${row('Host key', esc(v.fingerprint))}${row('Since', esc(v.connected_at))}
      ${row('SSH login', v.auth_configured ? 'Held in backend memory' : 'Not entered yet')}
      ${row('Host key check', v.fingerprint_pinned ? 'Fingerprint enforced' : 'Trusted on first connect')}
      ${row('Keep running', v.connected ? (v.linger ? 'Enabled' : '<span class="t-err">Run: sudo loginctl enable-linger ' + esc(v.username) + '</span>') : '')}
    </dl>${v.last_error && !v.connected ? `<p class="form-err">${esc(v.last_error)}</p>` : ''}`;
  } catch (e) { diagnose(e); info.innerHTML = `<div class="empty">${ico('alert')}<b>Could not load status</b><span>${esc(e.message)}</span></div>`; }
}
const syncAuth = () => {
  const key = $('#vAuth').value === 'key';
  $('#vPassWrap').hidden = key; $('#vKeyWrap').hidden = !key;
  $('#vPass').required = !key; $('#vKey').required = key;
};
$('#vAuth').addEventListener('change', syncAuth); syncAuth();
const wipeSecrets = () => { $('#vPass').value = ''; $('#vKey').value = ''; $('#vKeyPass').value = ''; };
$('#vpsForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const err = $('#vErr'); err.hidden = true;
  if (!configured()) { toast('Set the backend URL and token in Settings first.', 'warn'); location.hash = 'settings'; return; }
  const body = { host: $('#vHost').value.trim(), port: +$('#vPort').value, username: $('#vUser').value.trim() };
  if ($('#vAuth').value === 'key') {
    body.private_key = $('#vKey').value.trim();
    if ($('#vKeyPass').value) body.key_passphrase = $('#vKeyPass').value;
  } else body.password = $('#vPass').value;
  const fp = $('#vFp').value.trim(); if (fp) body.fingerprint = fp;
  await busy($('#vConnect'), async () => {
    try {
      await API.connect(body);
      wipeSecrets();
      toast('Connected to your VPS.'); loadVps();
    } catch (e) { err.textContent = e.message; err.hidden = false; toast(e.message, 'err'); }
  });
});
$('#vDisconnect').addEventListener('click', async ev => {
  if (!await confirmDialog({ title: 'Disconnect from VPS?', text: 'Your bots keep running on the VPS. The dashboard link is closed and the login is forgotten, so you will enter it again to reconnect.', okText: 'Disconnect' })) return;
  await busy(ev.currentTarget, async () => { try { await API.disconnect(); toast('Disconnected.'); loadVps(); } catch (e) { toast(e.message, 'err'); } });
});

/* ==================================================================== bots === */
const emptyBots = `<div class="empty">${ico('bot')}<b>No bots yet</b><span>Upload a Python file or ZIP project to host your first Telegram bot.</span><a class="btn primary" href="#upload">Upload a bot</a></div>`;
function botCard(b) {
  const running = b.status === 'running';
  const dd = (k, v) => `<dt>${k}</dt><dd>${v || '—'}</dd>`;
  return `<div class="card bot" data-id="${esc(b.id)}">
    <div class="top2"><h3>${esc(b.name)}</h3><span class="badge ${b.status}">${b.status[0].toUpperCase() + b.status.slice(1)}</span></div>
    <dl class="kv">${dd('Main file', esc(b.main))}${dd('Directory', esc(b.dir))}${dd('PID', b.pid)}
      ${dd('CPU / RAM', b.pid ? `${b.cpu_percent ?? '—'}% · ${fmtBytes(b.memory_bytes)}` : '')}${dd('Last start', esc(b.last_start))}
      ${b.last_error ? `<dt>Last error</dt><dd class="errline">${esc(b.last_error)}</dd>` : ''}
      ${!b.installed ? `<dt>Setup</dt><dd class="t-err">Dependencies not installed</dd>` : ''}</dl>
    <div class="acts">
      ${!b.installed ? `<button class="btn sm primary" data-act="install">${ico('download')}Install</button>` : ''}
      ${!running ? `<button class="btn sm primary" data-act="start" ${b.installed ? '' : 'disabled'}>${ico('play')}Start</button>` : ''}
      ${running || b.status === 'failed' ? `<button class="btn sm" data-act="stop">${ico('stop')}Stop</button>` : ''}
      <button class="btn sm" data-act="restart" ${b.installed ? '' : 'disabled'}>${ico('restart')}Restart</button>
      <button class="btn sm" data-act="logs">${ico('file')}Logs</button>
      <button class="btn sm danger" data-act="delete">${ico('trash')}Delete</button>
    </div></div>`;
}
async function loadBots() {
  const grid = $('#botGrid');
  if (!configured()) { grid.innerHTML = `<div class="empty">${ico('alert')}<b>Backend not configured</b><a class="btn primary" href="#settings">Open Settings</a></div>`; return; }
  if (!state.bots.length) grid.innerHTML = '<div class="sk"></div><div class="sk"></div>';
  try {
    const r = await API.bots(); state.bots = r.bots; banner();
    $('#botCount').textContent = `${r.total} total · ${r.running} running · ${r.stopped} stopped · ${r.failed} failed`;
    grid.innerHTML = r.bots.length ? r.bots.map(botCard).join('') : emptyBots;
  } catch (e) {
    diagnose(e);
    grid.innerHTML = e.status === 409 ? `<div class="empty">${ico('plug')}<b>VPS disconnected</b><span>${esc(e.message)}</span><a class="btn primary" href="#vps">Connect VPS</a></div>`
      : `<div class="empty">${ico('alert')}<b>Could not load bots</b><span>${esc(e.message)}</span></div>`;
  }
}
async function runInstall(id, onUpdate) {
  await API.install(id);
  for (let i = 0; i < 300; i++) {
    await sleep(2000);
    const s = await API.installStatus(id); onUpdate && onUpdate(s);
    if (s.state === 'success' || s.state === 'failed') return s;
  }
  throw new ApiError(0, 'Installation is taking too long. Check again later.');
}
$('#botGrid').addEventListener('click', async ev => {
  const btn = ev.target.closest('[data-act]'); if (!btn) return;
  const id = btn.closest('.bot').dataset.id, act = btn.dataset.act, bot = state.bots.find(b => b.id === id);
  if (act === 'logs') { $('#lgBot').dataset.want = id; location.hash = 'logs'; return; }
  if (act === 'delete' && !await confirmDialog({ title: `Delete "${bot.name}"?`, text: 'This stops the bot and permanently removes its files and virtualenv from the VPS.', okText: 'Delete project', danger: true })) return;
  await busy(btn, async () => {
    try {
      if (act === 'install') {
        toast('Installing dependencies…');
        const s = await runInstall(id);
        if (s.state === 'failed') await confirmDialog({ title: 'Installation failed', text: s.log, hideCancel: true, okText: 'Close', pre: true }); else toast('Dependencies installed.');
      } else {
        const r = act === 'delete' ? await API.remove(id) : await API.action(id, act);
        toast(r.message || 'Done.'); await sleep(1500);
      }
    } catch (e) { toast(e.message, 'err'); }
    loadBots();
  });
});

/* ================================================================== upload === */
const up = { project: null, req: null };
function renderFiles() {
  $('#fileList').innerHTML = [['project', up.project], ['req', up.req]].filter(x => x[1]).map(([k, f]) =>
    `<li><span>${esc(f.name)} <span class="muted">${fmtBytes(f.size)}</span></span><button type="button" data-rm="${k}" aria-label="Remove">${ico('x')}</button></li>`).join('');
}
function addFiles(list) {
  for (const f of list) {
    const n = f.name.toLowerCase();
    if (n === 'requirements.txt') up.req = f;
    else if (n.endsWith('.py') || n.endsWith('.zip')) { up.project = f; if (!$('#upName').value) $('#upName').value = f.name.replace(/\.(py|zip)$/i, ''); }
    else toast(`Skipped ${f.name}: only .py, .zip and requirements.txt are accepted.`, 'warn');
  }
  $('#mainChips').hidden = true; renderFiles();
}
const drop = $('#drop');
drop.addEventListener('click', () => $('#picker').click());
drop.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), $('#picker').click()));
$('#picker').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
$('#fileList').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { up[b.dataset.rm === 'req' ? 'req' : 'project'] = null; renderFiles(); } });

function step(name, st) { const li = $(`#steps [data-s="${name}"]`); li.className = st; }
$('#upForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const err = $('#upErr'); err.hidden = true; $('#mainChips').hidden = true;
  if (!configured()) return toast('Set the backend URL and token in Settings first.', 'warn');
  if (!up.project) return toast('Choose a .py or .zip file first.', 'warn');
  const fd = new FormData(); fd.append('name', $('#upName').value.trim()); fd.append('main', $('#upMain').value.trim());
  fd.append('file', up.project); if (up.req) fd.append('requirements', up.req);
  const log = $('#installLog'); log.hidden = true; ['upload', 'copy', 'install'].forEach(s => step(s, '')); $('#upPct').style.width = '0';
  await busy($('#upBtn'), async () => {
    let cur = 'upload';
    try {
      step('upload', 'active');
      const prom = xhrUpload('/api/bots/upload', fd, p => { $('#upPct').style.width = Math.round(p * 100) + '%'; if (p >= 1) { step('upload', 'done'); step('copy', 'active'); cur = 'copy'; } });
      const r = await prom; step('upload', 'done'); step('copy', 'done');
      toast(`Uploaded "${r.name}".`);
      if ($('#upInstall').checked) {
        cur = 'install'; step('install', 'active'); log.hidden = false; log.textContent = 'Starting installation…';
        const s = await runInstall(r.id, s => { log.textContent = s.log || 'Working…'; log.scrollTop = log.scrollHeight; });
        step('install', s.state === 'success' ? 'done' : 'fail');
        s.state === 'success' ? toast('Dependencies installed. You can start the bot now.') : toast('Dependency installation failed. See the log.', 'err');
      }
      up.project = up.req = null; renderFiles(); $('#upName').value = $('#upMain').value = '';
      state.bots = [];
    } catch (e) {
      step(cur, 'fail'); err.textContent = e.message; err.hidden = false; toast(e.message, 'err');
      const files = e.detail && e.detail.py_files;
      if (files && files.length) {
        const c = $('#mainChips'); c.innerHTML = files.map(f => `<button type="button">${esc(f)}</button>`).join(''); c.hidden = false;
      }
    }
  });
});
$('#mainChips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') { $('#upMain').value = e.target.textContent; $('#mainChips').hidden = true; } });

/* =================================================================== logs === */
const L = { id: '', lines: [], cursor: null, timer: null, paused: false };
function stopLogs() { clearInterval(L.timer); L.timer = null; }
async function loadLogsView() {
  const sel = $('#lgBot');
  if (!configured()) { $('#logState').textContent = 'Set the backend URL and token in Settings.'; return; }
  try { state.bots = (await API.bots()).bots; banner(); } catch (e) { diagnose(e); $('#logState').textContent = e.message; return; }
  const want = sel.dataset.want || L.id || (state.bots[0] && state.bots[0].id); delete sel.dataset.want;
  sel.innerHTML = state.bots.length ? state.bots.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('') : '<option value="">No bots</option>';
  if (!state.bots.length) { $('#logBox').innerHTML = `<div class="empty" style="border:0">${ico('terminal')}<b>No bots to show</b><span>Upload a bot to see its output here.</span></div>`; return; }
  sel.value = want; selectBot(sel.value);
}
function selectBot(id) { L.id = id; L.lines = []; L.cursor = null; L.paused = false; setPauseBtn(); renderLogs(); stopLogs(); pollLogs(); L.timer = setInterval(pollLogs, 2500); }
async function pollLogs() {
  if (!L.id || L.paused || document.hidden) return;
  try {
    const r = await API.logs(L.id, L.cursor);
    if (r.cursor) L.cursor = r.cursor;
    if (r.entries.length) { L.lines.push(...r.entries); if (L.lines.length > 3000) L.lines.splice(0, L.lines.length - 3000); renderLogs(); }
    $('#logState').textContent = 'Live · updated ' + new Date().toLocaleTimeString() + ' · refreshes every 2.5s';
  } catch (e) { $('#logState').textContent = 'Error: ' + e.message; }
}
const visibleLines = () => {
  const q = $('#lgSearch').value.toLowerCase(), lv = $('#lgLevel').value;
  return L.lines.filter(l => (lv === 'all' || l.stream === lv) && (!q || l.msg.toLowerCase().includes(q)));
};
function renderLogs() {
  const box = $('#logBox'), v = visibleLines().slice(-1000);
  box.innerHTML = v.length ? v.map(l => `<div class="ln ${l.stream}"><time>${new Date(l.ts * 1000).toLocaleTimeString()}</time><span>${esc(l.msg)}</span></div>`).join('')
    : `<div class="muted">${L.lines.length ? 'No lines match the filter.' : 'No output yet. Start the bot to see logs.'}</div>`;
  if ($('#lgAuto').checked) box.scrollTop = box.scrollHeight;
}
function setPauseBtn() { $('#lgPause').innerHTML = L.paused ? `${ico('play')}<span>Resume</span>` : `${ico('pause')}<span>Pause</span>`; }
$('#lgBot').addEventListener('change', e => selectBot(e.target.value));
$('#lgSearch').addEventListener('input', renderLogs); $('#lgLevel').addEventListener('change', renderLogs);
$('#lgPause').addEventListener('click', () => { L.paused = !L.paused; setPauseBtn(); if (!L.paused) pollLogs(); });
$('#lgClear').addEventListener('click', () => { L.lines = []; renderLogs(); });
$('#lgCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(visibleLines().map(l => `[${new Date(l.ts * 1000).toISOString()}] ${l.stream} ${l.msg}`).join('\n')); toast('Logs copied.'); }
  catch { toast('Copy was blocked by the browser.', 'err'); }
});

/* ================================================================ settings === */
function loadSettings() { $('#sUrl').value = store.apiUrl; $('#sToken').value = ''; $('#sToken').placeholder = store.token ? 'Token saved (hidden). Enter a new one to replace.' : 'API_TOKEN from Render'; }
$('#setForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const url = $('#sUrl').value.trim().replace(/\/+$/, ''), tok = $('#sToken').value.trim();
  if (url && !/^https?:\/\//.test(url)) return toast('API URL must start with https://', 'warn');
  store.apiUrl = url; if (tok) store.setToken(tok, $('#sRemember').checked);
  try { const h = await api('/api/health'); await API.vpsStatus(); toast(`Backend OK${h.vps_connected ? ', VPS connected' : ''}.`); banner(); }
  catch (e) { toast(e.message, 'err'); diagnose(e); }
});
$('#sClear').addEventListener('click', () => { store.setToken('', false); toast('Token removed from this browser.'); loadSettings(); setPill('off', 'Not configured'); });

/* ================================================================== boot === */
buildNav();
$('#refreshBtn').addEventListener('click', () => refresh());
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
go(location.hash.slice(1) || 'dashboard');
})();
