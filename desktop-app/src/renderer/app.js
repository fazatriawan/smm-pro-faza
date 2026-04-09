let accounts = [], settings = {}, logs = [], currentPage = 'dashboard';
let isRunning = false;

const PLATFORMS = {
  facebook: { label: 'Facebook', icon: '📘', color: '#1877F2', bg: '#E6F1FB' },
  instagram: { label: 'Instagram', icon: '📸', color: '#D4537E', bg: '#FBEAF0' },
  youtube: { label: 'YouTube', icon: '▶️', color: '#FF0000', bg: '#FAECE7' },
  twitter: { label: 'Twitter/X', icon: '🐦', color: '#888780', bg: '#F1EFE8' },
  tiktok: { label: 'TikTok', icon: '🎵', color: '#333', bg: '#f0efec' },
  threads: { label: 'Threads', icon: '🧵', color: '#000', bg: '#f0efec' },
};

const ACTIONS = {
  facebook: [
    { key: 'like', label: '👍 Like', color: '#1877F2' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'share', label: '↗ Share', color: '#1D9E75' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' },
    { key: 'add_friend', label: '👤 Add Friend', color: '#7F77DD' },
    { key: 'follow_page', label: '📌 Follow Page', color: '#E24B4A' },
  ],
  instagram: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'save', label: '🔖 Save', color: '#7F77DD' },
    { key: 'follow', label: '✅ Follow', color: '#1D9E75' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' },
    { key: 'story_view', label: '👁 Lihat Story', color: '#E24B4A' },
  ],
  youtube: [
    { key: 'like', label: '👍 Like', color: '#FF0000' },
    { key: 'dislike', label: '👎 Dislike', color: '#E24B4A' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'subscribe', label: '🔔 Subscribe', color: '#FF0000' },
    { key: 'save', label: '📋 Save to Playlist', color: '#7F77DD' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' },
  ],
  twitter: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'retweet', label: '🔄 Retweet', color: '#1D9E75' },
    { key: 'comment', label: '💬 Reply', color: '#378ADD' },
    { key: 'bookmark', label: '🔖 Bookmark', color: '#7F77DD' },
    { key: 'follow', label: '✅ Follow', color: '#1DA1F2' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' },
  ],
  tiktok: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'share', label: '↗ Share', color: '#1D9E75' },
    { key: 'follow', label: '✅ Follow', color: '#7F77DD' },
    { key: 'save', label: '🔖 Favorit', color: '#EF9F27' },
    { key: 'scroll', label: '📜 Scroll FYP', color: '#888' },
  ],
  threads: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'comment', label: '💬 Reply', color: '#378ADD' },
    { key: 'repost', label: '🔄 Repost', color: '#1D9E75' },
    { key: 'follow', label: '✅ Follow', color: '#7F77DD' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' },
  ],
};

window.addEventListener('DOMContentLoaded', async () => {
  accounts = await window.api.getAccounts();
  settings = await window.api.getSettings();
  logs = await window.api.getLogs();
  go('dashboard');

  window.api.onLog((log) => {
    logs.unshift({ ...log, timestamp: new Date().toISOString() });
    addToLiveLog(log);
  });
});

function go(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`nav-${page}`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', accounts:'Akun & User', bulkpost:'Bulk Post', amplify:'Amplifikasi', warmup:'Warm Up', automation:'Automasi', logs:'Log Aktivitas', settings:'Pengaturan' };
  document.getElementById('page-title').textContent = titles[page] || page;
  const pages = { dashboard: pageDashboard, accounts: pageAccounts, bulkpost: pageBulkPost, amplify: pageAmplify, warmup: pageWarmup, automation: pageAutomation, logs: pageLogs, settings: pageSettings };
  document.getElementById('content').innerHTML = (pages[page] || (() => ''))();
}

function setRunning(running) {
  isRunning = running;
  document.getElementById('status-dot').className = `status-dot ${running ? 'dot-running' : 'dot-idle'}`;
  document.getElementById('status-text').textContent = running ? 'Berjalan...' : 'Idle';
  document.getElementById('stop-btn').style.display = running ? 'block' : 'none';
}

async function stopAll() {
  await window.api.stopAll();
  setRunning(false);
}

function addToLiveLog(log) {
  const box = document.getElementById('live-log');
  if (!box) return;
  if (box.innerHTML.includes('Menunggu')) box.innerHTML = '';
  const el = document.createElement('div');
  el.className = `log-entry log-${log.type}`;
  el.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${log.message}`;
  box.prepend(el);
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────
function pageDashboard() {
  const byPlatform = {};
  accounts.forEach(a => { byPlatform[a.platform] = (byPlatform[a.platform]||0)+1; });
  return `
    <div class="grid-3" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-val" style="color:#7F77DD">${accounts.length}</div><div class="stat-label">Total Akun</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#1D9E75">${logs.filter(l=>l.type==='success').length}</div><div class="stat-label">Aksi Berhasil</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#E24B4A">${logs.filter(l=>l.type==='error').length}</div><div class="stat-label">Aksi Gagal</div></div>
    </div>
    <div class="card">
      <div class="card-title">Akun per Platform</div>
      <div class="grid-3">
        ${Object.entries(PLATFORMS).map(([key, p]) => `
          <div style="padding:10px;background:${p.bg};border-radius:8px;display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">${p.icon}</span>
            <div><div style="font-size:20px;font-weight:700;color:${p.color}">${byPlatform[key]||0}</div><div style="font-size:11px;color:#888">${p.label}</div></div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Log Terbaru</div>
      <div class="log-box">
        ${logs.slice(0,15).map(l=>`<div class="log-entry log-${l.type}">[${new Date(l.timestamp).toLocaleTimeString('id-ID')}] ${l.message}</div>`).join('') || '<div style="color:#555">Belum ada log</div>'}
      </div>
    </div>
  `;
}

// ─── ACCOUNTS ──────────────────────────────────────────────────────────────
function pageAccounts() {
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-title" style="margin:0">Daftar Akun (${accounts.length})</div>
        <button class="btn btn-primary" onclick="showForm('add-form')">+ Tambah Akun</button>
      </div>
      ${accounts.length === 0 ? `<div style="text-align:center;padding:30px;color:#aaa"><div style="font-size:40px;margin-bottom:8px">👤</div>Belum ada akun</div>` :
        accounts.map(a => `
          <div class="account-row">
            <div class="avatar" style="background:${PLATFORMS[a.platform]?.color||'#888'}">${(a.username||'?')[0].toUpperCase()}</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:500">${a.username}</div>
              <div style="font-size:11px;color:#888">${PLATFORMS[a.platform]?.label||a.platform} • ${a.twoFAType !== 'none' ? '🔐 2FA' : '○ No 2FA'} • ${a.cookies ? '✓ Login' : '○ Belum Login'}</div>
            </div>
            <span class="badge ${a.cookies ? 'badge-success' : 'badge-warn'}">${a.cookies ? 'Aktif' : 'Belum Login'}</span>
            <button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="clearCookies('${a.id}')">Reset</button>
            <button class="btn btn-danger" style="font-size:11px;padding:4px 8px" onclick="deleteAccount('${a.id}')">Hapus</button>
          </div>
        `).join('')}
    </div>

    <div class="card" id="add-form" style="display:none">
      <div class="card-title">Tambah Akun Baru</div>
      <div class="grid-2">
        <div class="form-group">
          <label>Platform</label>
          <select id="f-platform">
            ${Object.entries(PLATFORMS).map(([k,p])=>`<option value="${k}">${p.icon} ${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Username / Email</label>
          <input type="text" id="f-username" placeholder="email atau username">
        </div>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="f-password" placeholder="password">
      </div>
      <div style="background:#E6F1FB;border-radius:8px;padding:12px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;color:#185FA5;margin-bottom:8px">🔐 Pengaturan 2FA</div>
        <div class="form-group">
          <label>Metode 2FA</label>
          <select id="f-2fa-type" onchange="toggle2FA()">
            <option value="none">Tidak Ada 2FA</option>
            <option value="totp">Authenticator App (Google/Authy)</option>
            <option value="email">Email / SMS (Manual)</option>
          </select>
        </div>
        <div id="totp-section" style="display:none">
          <label style="font-size:12px;color:#888">Secret Key dari Authenticator App</label>
          <input type="text" id="f-2fa-secret" placeholder="JBSWY3DPEHPK3PXP">
          <div style="font-size:11px;color:#888;margin-top:4px">Cara dapat: Buka Authenticator App → Edit akun → Salin secret key</div>
        </div>
        <div id="email-2fa-section" style="display:none;font-size:12px;color:#185FA5;padding:6px;background:#fff;border-radius:6px">
          ℹ️ App akan pause 60 detik saat 2FA muncul — isi kode secara manual di browser
        </div>
      </div>
      <div style="font-size:11px;color:#888;background:#FAEEDA;padding:8px;border-radius:6px;margin-bottom:10px">
        ⚠️ Data disimpan terenkripsi di PC kamu. Tidak dikirim ke server manapun.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="saveAccount()">Simpan</button>
        <button class="btn btn-secondary" onclick="hideForm('add-form')">Batal</button>
      </div>
    </div>

    <!-- Token API Section -->
    <div class="card">
      <div class="card-title">🔑 Akun API (Token) — untuk Bulk Post & Amplifikasi</div>
      <div style="font-size:12px;color:#888;margin-bottom:12px">Tambahkan akun dengan token API untuk bulk post & amplifikasi tanpa browser</div>
      <div id="api-form" style="display:none">
        <div class="grid-2">
          <div class="form-group">
            <label>Platform</label>
            <select id="api-platform">
              ${Object.entries(PLATFORMS).map(([k,p])=>`<option value="${k}">${p.icon} ${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Label / Nama</label>
            <input type="text" id="api-label" placeholder="@nama_akun">
          </div>
        </div>
        <div class="form-group">
          <label>User ID / Page ID</label>
          <input type="text" id="api-userid" placeholder="ID platform">
        </div>
        <div class="form-group">
          <label>Access Token</label>
          <input type="password" id="api-token" placeholder="token API">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="saveApiAccount()">Simpan Token</button>
          <button class="btn btn-secondary" onclick="hideForm('api-form')">Batal</button>
        </div>
      </div>
      <button class="btn btn-secondary" onclick="toggleForm('api-form')" style="width:100%">+ Tambah Akun Token API</button>
    </div>
  `;
}

function toggle2FA() {
  const type = document.getElementById('f-2fa-type').value;
  document.getElementById('totp-section').style.display = type === 'totp' ? 'block' : 'none';
  document.getElementById('email-2fa-section').style.display = type === 'email' ? 'block' : 'none';
}

async function saveAccount() {
  const username = document.getElementById('f-username').value.trim();
  const password = document.getElementById('f-password').value;
  if (!username || !password) { alert('Username dan password wajib!'); return; }
  accounts = await window.api.saveAccount({
    platform: document.getElementById('f-platform').value,
    username, password,
    twoFAType: document.getElementById('f-2fa-type').value,
    twoFactorSecret: document.getElementById('f-2fa-secret')?.value?.trim() || '',
    accountType: 'browser', cookies: null
  });
  go('accounts');
}

async function saveApiAccount() {
  const label = document.getElementById('api-label').value.trim();
  const token = document.getElementById('api-token').value.trim();
  if (!label || !token) { alert('Label dan token wajib!'); return; }
  accounts = await window.api.saveAccount({
    platform: document.getElementById('api-platform').value,
    username: label, label,
    platformUserId: document.getElementById('api-userid').value.trim(),
    accessToken: token,
    accountType: 'api'
  });
  go('accounts');
}

async function deleteAccount(id) {
  if (!confirm('Hapus akun ini?')) return;
  accounts = await window.api.deleteAccount(id);
  go('accounts');
}

async function clearCookies(id) {
  accounts = await window.api.clearCookies(id);
  go('accounts');
}

function showForm(id) { document.getElementById(id).style.display = 'block'; }
function hideForm(id) { document.getElementById(id).style.display = 'none'; }
function toggleForm(id) { const el = document.getElementById(id); el.style.display = el.style.display === 'none' ? 'block' : 'none'; }

// ─── BULK POST ─────────────────────────────────────────────────────────────
let bpPlatform = 'facebook', bpSelectedAccounts = new Set();

function pageBulkPost() {
  bpPlatform = 'facebook';
  bpSelectedAccounts = new Set();
  return `
    <div class="grid-2" style="align-items:start">
      <div>
        <div class="card">
          <div class="card-title">Platform Target</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
            ${Object.entries(PLATFORMS).map(([k,p]) => `
              <div class="platform-tab ${k==='facebook'?'active':''}" id="bp-tab-${k}"
                onclick="setBpPlatform('${k}')"
                style="${k==='facebook'?`background:${p.bg};color:${p.color};border-color:${p.color}`:''}">
                ${p.icon} ${p.label}
              </div>
            `).join('')}
          </div>

          <div class="form-group">
            <label>Pilih Akun</label>
            <div id="bp-accounts" style="max-height:160px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
              ${renderBpAccounts('facebook')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Konten Post</div>
          <div class="form-group">
            <label>Caption</label>
            <textarea id="bp-caption" rows="4" placeholder="Tulis caption..."></textarea>
          </div>
          <div class="form-group">
            <label>Media (path file lokal atau URL)</label>
            <input type="text" id="bp-media" placeholder="C:\\foto.jpg atau https://...">
          </div>
          <div class="form-group">
            <label>Waktu Posting</label>
            <select id="bp-timing">
              <option value="now">Kirim Sekarang</option>
              <option value="schedule">Jadwalkan</option>
            </select>
          </div>
          <button class="btn btn-success" onclick="runBulkPost()" style="width:100%;padding:10px;margin-top:4px" id="bp-btn">
            📢 Posting Serentak Sekarang
          </button>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">Preview & Log</div>
          <div style="font-size:12px;color:#888;margin-bottom:8px" id="bp-preview-info">Pilih platform dan akun</div>
          <div class="log-box" id="live-log" style="height:400px"><div style="color:#555">Menunggu...</div></div>
        </div>
      </div>
    </div>
  `;
}

function renderBpAccounts(platform) {
  const filtered = accounts.filter(a => a.platform === platform);
  if (!filtered.length) return '<div style="color:#aaa;font-size:12px;padding:4px">Belum ada akun untuk platform ini. Tambahkan di menu Akun & User.</div>';
  return filtered.map(a => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer;border-radius:5px" onmouseover="this.style.background='#f0efec'" onmouseout="this.style.background='transparent'">
      <input type="checkbox" value="${a.id}" class="bp-check" style="width:15px;height:15px;cursor:pointer" onchange="updateBpPreview()">
      <span style="font-size:12px;flex:1">${a.label || a.username}</span>
      <span style="font-size:10px;color:${a.cookies||a.accessToken?'#1D9E75':'#aaa'}">${a.cookies||a.accessToken?'●':'○'}</span>
    </label>
  `).join('');
}

function setBpPlatform(platform) {
  bpPlatform = platform;
  bpSelectedAccounts = new Set();
  const p = PLATFORMS[platform];
  document.querySelectorAll('.platform-tab').forEach(t => {
    t.classList.remove('active');
    t.style.background = '';
    t.style.color = '';
    t.style.borderColor = '';
  });
  const tab = document.getElementById(`bp-tab-${platform}`);
  if (tab) {
    tab.classList.add('active');
    tab.style.background = p.bg;
    tab.style.color = p.color;
    tab.style.borderColor = p.color;
  }
  document.getElementById('bp-accounts').innerHTML = renderBpAccounts(platform);
  updateBpPreview();
}

function updateBpPreview() {
  const checked = [...document.querySelectorAll('.bp-check:checked')].length;
  const info = document.getElementById('bp-preview-info');
  if (info) info.textContent = `${checked} akun dipilih untuk posting ke ${PLATFORMS[bpPlatform]?.label}`;
}

async function runBulkPost() {
  const caption = document.getElementById('bp-caption').value.trim();
  if (!caption) { alert('Caption tidak boleh kosong!'); return; }

  const selectedIds = [...document.querySelectorAll('.bp-check:checked')].map(c => c.value);
  if (!selectedIds.length) { alert('Pilih minimal 1 akun!'); return; }

  const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id));
  const mediaPath = document.getElementById('bp-media').value.trim();

  document.getElementById('bp-btn').disabled = true;
  document.getElementById('bp-btn').textContent = '⟳ Mengirim...';
  setRunning(true);

  const result = await window.api.bulkPost({
    accounts: selectedAccounts,
    caption, mediaPath: mediaPath || null,
    platform: bpPlatform
  });

  setRunning(false);
  document.getElementById('bp-btn').disabled = false;
  document.getElementById('bp-btn').textContent = '📢 Posting Serentak Sekarang';

  if (!result.success) alert(`Error: ${result.error}`);
}

// ─── AMPLIFIKASI ───────────────────────────────────────────────────────────
let ampPlatform = 'youtube', ampSelectedActions = new Set(), ampSelectedAccounts = new Set();

function pageAmplify() {
  ampPlatform = 'youtube';
  ampSelectedActions = new Set();
  ampSelectedAccounts = new Set();
  return `
    <div class="grid-2" style="align-items:start">
      <div>
        <div class="card">
          <div class="card-title">Platform</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${Object.entries(PLATFORMS).map(([k,p]) => `
              <div class="platform-tab ${k==='youtube'?'active':''}" id="amp-tab-${k}"
                onclick="setAmpPlatform('${k}')"
                style="${k==='youtube'?`background:${p.bg};color:${p.color};border-color:${p.color}`:''}">
                ${p.icon} ${p.label}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-title">URL Target (satu per baris)</div>
          <textarea id="amp-urls" rows="4" placeholder="https://youtube.com/watch?v=...&#10;https://youtube.com/watch?v=..."></textarea>
        </div>

        <div class="card">
          <div class="card-title">Pilih Aksi</div>
          <div id="amp-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${renderAmpActions('youtube')}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Template Komentar (satu per baris)</div>
          <textarea id="amp-comments" rows="3" placeholder="Bagus banget!&#10;Keren!&#10;Mantap bro!"></textarea>
        </div>

        <div class="card">
          <div class="card-title">Pilih Akun</div>
          <div id="amp-accounts" style="max-height:180px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
            ${renderAmpAccounts('youtube')}
          </div>
        </div>

        <button class="btn btn-success" onclick="runAmplify()" style="width:100%;padding:10px" id="amp-btn">
          ⚡ Jalankan Amplifikasi
        </button>
      </div>

      <div>
        <div class="card">
          <div class="card-title">Preview</div>
          <div style="font-size:12px;color:#888;margin-bottom:8px" id="amp-preview">Pilih platform, URL, aksi, dan akun</div>
          <div class="log-box" id="live-log" style="height:450px"><div style="color:#555">Menunggu...</div></div>
        </div>
      </div>
    </div>
  `;
}

function renderAmpActions(platform) {
  const actions = ACTIONS[platform] || [];
  return actions.map(a => `
    <div id="amp-action-${a.key}" class="action-btn" onclick="toggleAmpAction('${a.key}','${a.color}')">
      ${a.label}
    </div>
  `).join('');
}

function renderAmpAccounts(platform) {
  const filtered = accounts.filter(a => a.platform === platform);
  if (!filtered.length) return '<div style="color:#aaa;font-size:12px;padding:4px">Belum ada akun untuk platform ini</div>';
  return `
    <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer;font-weight:600;border-bottom:1px solid #f0efec;margin-bottom:4px">
      <input type="checkbox" id="amp-check-all" style="width:15px;height:15px" onchange="toggleAmpAll(this)">
      <span style="font-size:12px">Semua Akun (${filtered.length})</span>
    </label>
    ${filtered.map(a => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer;border-radius:5px">
        <input type="checkbox" value="${a.id}" class="amp-check" style="width:15px;height:15px">
        <span style="font-size:12px;flex:1">${a.label || a.username}</span>
        <span style="font-size:10px;color:${a.accessToken?'#1D9E75':'#aaa'}">${a.accessToken?'● API':'○'}</span>
      </label>
    `).join('')}
  `;
}

function toggleAmpAll(checkbox) {
  document.querySelectorAll('.amp-check').forEach(c => c.checked = checkbox.checked);
}

function setAmpPlatform(platform) {
  ampPlatform = platform;
  ampSelectedActions = new Set();
  const p = PLATFORMS[platform];
  document.querySelectorAll('.platform-tab').forEach(t => { t.classList.remove('active'); t.style.cssText = ''; });
  const tab = document.getElementById(`amp-tab-${platform}`);
  if (tab) { tab.classList.add('active'); tab.style.background = p.bg; tab.style.color = p.color; tab.style.borderColor = p.color; }
  document.getElementById('amp-actions').innerHTML = renderAmpActions(platform);
  document.getElementById('amp-accounts').innerHTML = renderAmpAccounts(platform);
}

function toggleAmpAction(key, color) {
  const btn = document.getElementById(`amp-action-${key}`);
  if (!btn) return;
  if (ampSelectedActions.has(key)) {
    ampSelectedActions.delete(key);
    btn.style.cssText = '';
    btn.classList.remove('selected');
  } else {
    ampSelectedActions.add(key);
    btn.style.border = `1.5px solid ${color}`;
    btn.style.background = `${color}18`;
    btn.style.color = color;
    btn.classList.add('selected');
  }
}

async function runAmplify() {
  const urlsText = document.getElementById('amp-urls').value;
  const commentsText = document.getElementById('amp-comments').value;
  const targetUrls = urlsText.split('\n').map(u=>u.trim()).filter(u=>u);
  const commentTemplates = commentsText.split('\n').map(c=>c.trim()).filter(c=>c);
  const selectedIds = [...document.querySelectorAll('.amp-check:checked')].map(c=>c.value);
  const actions = [...ampSelectedActions];

  if (!targetUrls.length) { alert('Masukkan minimal 1 URL!'); return; }
  if (!selectedIds.length) { alert('Pilih minimal 1 akun!'); return; }
  if (!actions.length) { alert('Pilih minimal 1 aksi!'); return; }

  const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id));

  document.getElementById('amp-btn').disabled = true;
  document.getElementById('amp-btn').textContent = '⟳ Berjalan...';
  setRunning(true);

  const result = await window.api.amplify({
    accounts: selectedAccounts,
    platform: ampPlatform,
    targetUrls, actions,
    commentTemplates: commentTemplates.length ? commentTemplates : ['Bagus!', 'Keren!', 'Mantap!']
  });

  setRunning(false);
  document.getElementById('amp-btn').disabled = false;
  document.getElementById('amp-btn').textContent = '⚡ Jalankan Amplifikasi';
  if (!result.success) alert(`Error: ${result.error}`);
}

// ─── WARM UP ───────────────────────────────────────────────────────────────
function pageWarmup() {
  return `
    <div class="grid-2" style="align-items:start">
      <div>
        <div class="card">
          <div class="card-title">🔥 Konfigurasi Warm Up</div>
          <div class="form-group">
            <label>Platform</label>
            <select id="wu-platform">
              ${Object.entries(PLATFORMS).map(([k,p])=>`<option value="${k}">${p.icon} ${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Durasi per Akun (menit)</label>
            <input type="number" id="wu-duration" value="5" min="1" max="60">
          </div>
          <div class="form-group">
            <label>Pilih Akun (Browser/Password)</label>
            <div style="max-height:160px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
              ${accounts.filter(a=>a.accountType==='browser'||!a.accountType).map(a=>`
                <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer">
                  <input type="checkbox" value="${a.id}" class="wu-check" style="width:15px;height:15px">
                  <span style="font-size:12px">${a.username} (${a.platform})</span>
                </label>
              `).join('') || '<div style="color:#aaa;font-size:12px">Tambahkan akun browser di menu Akun & User</div>'}
            </div>
          </div>
          <div class="form-group">
            <label>Aktivitas Warm Up</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${['scroll','like','comment','follow','watch'].map(a=>`
                <label style="display:flex;align-items:center;gap:6px;padding:6px;border:1px solid #ddd;border-radius:6px;cursor:pointer">
                  <input type="checkbox" value="${a}" class="wu-action" style="width:14px;height:14px"> <span style="font-size:12px">${a}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div style="background:#FAEEDA;border-radius:8px;padding:10px;font-size:12px;color:#633806;margin-bottom:10px">
            ⚡ Browser akan terbuka dan mensimulasikan aktivitas manusia selama durasi yang ditentukan
          </div>
          <button class="btn btn-success" onclick="runWarmup()" style="width:100%;padding:10px" id="wu-btn">🔥 Mulai Warm Up</button>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Live Log</div>
          <div class="log-box" id="live-log" style="height:450px"><div style="color:#555">Menunggu...</div></div>
        </div>
      </div>
    </div>
  `;
}

async function runWarmup() {
  const platform = document.getElementById('wu-platform').value;
  const duration = parseInt(document.getElementById('wu-duration').value) || 5;
  const selectedIds = [...document.querySelectorAll('.wu-check:checked')].map(c=>c.value);
  const actions = [...document.querySelectorAll('.wu-action:checked')].map(c=>c.value);

  if (!selectedIds.length) { alert('Pilih minimal 1 akun!'); return; }

  const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id));
  const warmupUrls = { facebook:['https://www.facebook.com/'], instagram:['https://www.instagram.com/'], tiktok:['https://www.tiktok.com/foryou'], twitter:['https://twitter.com/home'], youtube:['https://www.youtube.com/'], threads:['https://www.threads.net/'] };

  document.getElementById('wu-btn').disabled = true;
  setRunning(true);

  await window.api.startAutomation({
    accounts: selectedAccounts, platform,
    actions: actions.length ? actions : ['scroll','like'],
    targetUrls: warmupUrls[platform] || [],
    durationPerAccount: duration,
    commentTemplates: ['Bagus!','Keren!','Mantap!'],
    mode: 'warmup'
  });

  setRunning(false);
  document.getElementById('wu-btn').disabled = false;
}

// ─── AUTOMASI ──────────────────────────────────────────────────────────────
let autoSelectedActions = new Set();

function pageAutomation() {
  autoSelectedActions = new Set();
  return `
    <div class="grid-2" style="align-items:start">
      <div>
        <div class="card">
          <div class="card-title">🤖 Konfigurasi Automasi</div>
          <div class="form-group">
            <label>Platform</label>
            <select id="auto-platform" onchange="updateAutoActions()">
              ${Object.entries(PLATFORMS).map(([k,p])=>`<option value="${k}">${p.icon} ${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Pilih Akun (Browser/Password)</label>
            <div style="max-height:150px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
              ${accounts.filter(a=>a.accountType==='browser'||!a.accountType).map(a=>`
                <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer">
                  <input type="checkbox" value="${a.id}" class="auto-check" style="width:15px;height:15px">
                  <span style="font-size:12px">${a.username} (${PLATFORMS[a.platform]?.label||a.platform})</span>
                </label>
              `).join('') || '<div style="color:#aaa;font-size:12px">Tambahkan akun browser di menu Akun & User</div>'}
            </div>
          </div>
          <div class="form-group">
            <label>URL Target (satu per baris)</label>
            <textarea id="auto-urls" rows="3" placeholder="https://facebook.com/..."></textarea>
          </div>
          <div class="form-group">
            <label>Pilih Aksi</label>
            <div id="auto-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${renderAutoActions('facebook')}
            </div>
          </div>
          <div class="form-group">
            <label>Template Komentar</label>
            <textarea id="auto-comments" rows="2" placeholder="Bagus!&#10;Keren!"></textarea>
          </div>
          <div class="form-group">
            <label>Durasi per Akun (menit)</label>
            <input type="number" id="auto-duration" value="5" min="1" max="60">
          </div>
          <button class="btn btn-success" onclick="runAutomation()" style="width:100%;padding:10px" id="auto-btn">🤖 Mulai Automasi</button>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Live Log</div>
          <div class="log-box" id="live-log" style="height:500px"><div style="color:#555">Menunggu...</div></div>
        </div>
      </div>
    </div>
  `;
}

function renderAutoActions(platform) {
  const actions = ACTIONS[platform] || [];
  return actions.map(a => `
    <div id="auto-action-${a.key}" class="action-btn" onclick="toggleAutoAction('${a.key}','${a.color}')">
      ${a.label}
    </div>
  `).join('');
}

function updateAutoActions() {
  const platform = document.getElementById('auto-platform').value;
  autoSelectedActions = new Set();
  document.getElementById('auto-actions').innerHTML = renderAutoActions(platform);
}

function toggleAutoAction(key, color) {
  const btn = document.getElementById(`auto-action-${key}`);
  if (!btn) return;
  if (autoSelectedActions.has(key)) {
    autoSelectedActions.delete(key);
    btn.style.cssText = '';
  } else {
    autoSelectedActions.add(key);
    btn.style.border = `1.5px solid ${color}`;
    btn.style.background = `${color}18`;
    btn.style.color = color;
  }
}

async function runAutomation() {
  const platform = document.getElementById('auto-platform').value;
  const urlsText = document.getElementById('auto-urls').value;
  const commentsText = document.getElementById('auto-comments').value;
  const duration = parseInt(document.getElementById('auto-duration').value) || 5;
  const targetUrls = urlsText.split('\n').map(u=>u.trim()).filter(u=>u);
  const commentTemplates = commentsText.split('\n').map(c=>c.trim()).filter(c=>c);
  const selectedIds = [...document.querySelectorAll('.auto-check:checked')].map(c=>c.value);
  const actions = [...autoSelectedActions];

  if (!targetUrls.length) { alert('Masukkan minimal 1 URL!'); return; }
  if (!selectedIds.length) { alert('Pilih minimal 1 akun!'); return; }
  if (!actions.length) { alert('Pilih minimal 1 aksi!'); return; }

  const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id));

  document.getElementById('auto-btn').disabled = true;
  setRunning(true);

  await window.api.startAutomation({
    accounts: selectedAccounts, platform,
    actions, targetUrls, durationPerAccount: duration,
    commentTemplates: commentTemplates.length ? commentTemplates : ['Bagus!'],
    mode: 'automation'
  });

  setRunning(false);
  document.getElementById('auto-btn').disabled = false;
}

// ─── LOGS ──────────────────────────────────────────────────────────────────
function pageLogs() {
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-title" style="margin:0">Log Aktivitas (${logs.length})</div>
        <button class="btn btn-secondary" style="font-size:12px" onclick="clearLogs()">🗑 Hapus Semua</button>
      </div>
      <div class="log-box" style="height:520px">
        ${logs.slice(0,300).map(l=>`<div class="log-entry log-${l.type}">[${new Date(l.timestamp).toLocaleString('id-ID')}] ${l.message}</div>`).join('') || '<div style="color:#555">Belum ada log</div>'}
      </div>
    </div>
  `;
}

async function clearLogs() {
  if (!confirm('Hapus semua log?')) return;
  logs = await window.api.clearLogs();
  go('logs');
}

// ─── SETTINGS ──────────────────────────────────────────────────────────────
function pageSettings() {
  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">⚙️ Pengaturan Automasi Browser</div>
        <div class="form-group">
          <label>Mode Browser</label>
          <select id="s-headless">
            <option value="false" ${!settings.headless?'selected':''}>Tampilkan Browser (Visible)</option>
            <option value="true" ${settings.headless?'selected':''}>Sembunyikan Browser (Headless)</option>
          </select>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label>Jeda Min (detik)</label>
            <input type="number" id="s-delay-min" value="${settings.delayMin||3}" min="1">
          </div>
          <div class="form-group">
            <label>Jeda Max (detik)</label>
            <input type="number" id="s-delay-max" value="${settings.delayMax||10}" min="2">
          </div>
        </div>
        <div class="form-group">
          <label>Istirahat antar Akun (detik)</label>
          <input type="number" id="s-rest" value="${settings.restBetweenAccounts||30}" min="5">
        </div>
        <div class="form-group">
          <label>Maks Aksi per Jam</label>
          <input type="number" id="s-max" value="${settings.maxActionsPerHour||30}" min="5">
        </div>
      </div>
      <div class="card">
        <div class="card-title">🌐 Koneksi ke SMM Pro Web</div>
        <div class="form-group">
          <label>URL Backend API</label>
          <input type="text" id="s-api" value="${settings.apiUrl||'https://smm-pro-faza.onrender.com'}">
        </div>
        <div style="background:#EAF3DE;border-radius:8px;padding:10px;font-size:12px;color:#3B6D11;margin-bottom:12px">
          💡 Hubungkan ke SMM Pro backend untuk menggunakan token akun yang sudah disimpan di web
        </div>
        <div class="card-title">💡 Tips Keamanan</div>
        <div style="font-size:12px;color:#666;line-height:1.8">
          ✓ Jeda min 5 detik antar aksi<br>
          ✓ Maks 30 aksi per jam per akun<br>
          ✓ Istirahat 2-3 jam antar sesi<br>
          ✓ Variasi aksi agar terlihat natural<br>
          ✓ Gunakan akun yang sudah aktif minimal 1 bulan
        </div>
      </div>
    </div>
    <button class="btn btn-primary" onclick="saveSettings()" style="width:100%;padding:10px;margin-top:4px">💾 Simpan Pengaturan</button>
  `;
}

async function saveSettings() {
  settings = {
    headless: document.getElementById('s-headless').value === 'true',
    delayMin: parseInt(document.getElementById('s-delay-min').value),
    delayMax: parseInt(document.getElementById('s-delay-max').value),
    restBetweenAccounts: parseInt(document.getElementById('s-rest').value),
    maxActionsPerHour: parseInt(document.getElementById('s-max').value),
    maxConcurrent: parseInt(document.getElementById('s-concurrent').value),
    apiUrl: document.getElementById('s-api').value.trim()
  };
  await window.api.saveSettings(settings);
  alert('✅ Pengaturan tersimpan!');
}
