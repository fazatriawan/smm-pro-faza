// State
let accounts = [];
let settings = {};
let logs = [];
let isRunning = false;
let currentPage = 'dashboard';

// Init
window.addEventListener('DOMContentLoaded', async () => {
  accounts = await window.api.getAccounts();
  settings = await window.api.getSettings();
  logs = await window.api.getLogs();
  showPage('dashboard');

  // Listen automation logs
  window.api.onAutomationLog((log) => {
    logs.unshift({ ...log, timestamp: new Date().toISOString() });
    if (currentPage === 'logs') renderLogs();
    addLiveLog(log);
  });
});

function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`nav-${page}`)?.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', accounts: 'Manajemen Akun',
    automation: 'Automasi', warmup: 'Warm Up',
    logs: 'Log Aktivitas', settings: 'Pengaturan'
  };
  document.getElementById('page-title').textContent = titles[page] || page;

  const content = document.getElementById('content');
  switch (page) {
    case 'dashboard': content.innerHTML = renderDashboard(); break;
    case 'accounts': content.innerHTML = renderAccounts(); break;
    case 'automation': content.innerHTML = renderAutomation(); break;
    case 'warmup': content.innerHTML = renderWarmup(); break;
    case 'logs': content.innerHTML = renderLogs(); break;
    case 'settings': content.innerHTML = renderSettings(); break;
  }
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────
function renderDashboard() {
  const fbAccounts = accounts.filter(a => a.platform === 'facebook').length;
  const igAccounts = accounts.filter(a => a.platform === 'instagram').length;
  const ttAccounts = accounts.filter(a => a.platform === 'tiktok').length;
  const twAccounts = accounts.filter(a => a.platform === 'twitter').length;

  return `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="card" style="text-align:center">
        <div style="font-size:32px;margin-bottom:4px">👤</div>
        <div style="font-size:28px;font-weight:700;color:#7F77DD">${accounts.length}</div>
        <div style="font-size:12px;color:#888">Total Akun</div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:32px;margin-bottom:4px">📋</div>
        <div style="font-size:28px;font-weight:700;color:#1D9E75">${logs.filter(l=>l.type==='success').length}</div>
        <div style="font-size:12px;color:#888">Aksi Berhasil</div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:32px;margin-bottom:4px">❌</div>
        <div style="font-size:28px;font-weight:700;color:#E24B4A">${logs.filter(l=>l.type==='error').length}</div>
        <div style="font-size:12px;color:#888">Aksi Gagal</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Akun per Platform</div>
      <div class="grid-3">
        ${[
          { platform: 'Facebook', count: fbAccounts, color: '#1877F2', icon: '📘' },
          { platform: 'Instagram', count: igAccounts, color: '#D4537E', icon: '📸' },
          { platform: 'TikTok', count: ttAccounts, color: '#333', icon: '🎵' },
          { platform: 'Twitter', count: twAccounts, color: '#1DA1F2', icon: '🐦' },
        ].map(p => `
          <div style="padding:12px;background:#f9f9f9;border-radius:8px;display:flex;align-items:center;gap:10px">
            <span style="font-size:24px">${p.icon}</span>
            <div>
              <div style="font-size:20px;font-weight:700;color:${p.color}">${p.count}</div>
              <div style="font-size:11px;color:#888">${p.platform}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Log Terbaru</div>
      <div class="log-container">
        ${logs.slice(0, 20).map(l => `
          <div class="log-entry ${l.type}">
            [${new Date(l.timestamp).toLocaleTimeString('id-ID')}] ${l.message}
          </div>
        `).join('') || '<div style="color:#666">Belum ada log</div>'}
      </div>
    </div>
  `;
}

// ─── ACCOUNTS ──────────────────────────────────────────────────────────────
function renderAccounts() {
  const platformColors = {
    facebook: '#1877F2', instagram: '#D4537E',
    tiktok: '#333', twitter: '#1DA1F2'
  };

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="card-title" style="margin:0">Daftar Akun (${accounts.length})</div>
        <button class="btn btn-primary" onclick="showAddAccount()">+ Tambah Akun</button>
      </div>

      ${accounts.length === 0 ? `
        <div style="text-align:center;padding:40px;color:#aaa">
          <div style="font-size:48px;margin-bottom:12px">👤</div>
          <div>Belum ada akun. Klik "+ Tambah Akun" untuk mulai.</div>
        </div>
      ` : accounts.map(a => `
        <div class="account-item">
          <div class="account-avatar" style="background:${platformColors[a.platform] || '#888'}">
            ${a.username.charAt(0).toUpperCase()}
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${a.username}</div>
            <div style="font-size:11px;color:#888;margin-top:2px">${a.platform} • ${a.cookies ? '✓ Sesi tersimpan' : '○ Belum login'}</div>
          </div>
          <span class="badge ${a.cookies ? 'badge-success' : 'badge-warn'}">
            ${a.cookies ? 'Aktif' : 'Belum Login'}
          </span>
          <button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" onclick="clearCookies('${a.id}')">Reset Sesi</button>
          <button class="btn btn-danger" style="font-size:12px;padding:5px 10px" onclick="deleteAccount('${a.id}')">Hapus</button>
        </div>
      `).join('')}
    </div>

    <!-- Form Tambah Akun -->
    <div class="card" id="add-account-form" style="display:none">
      <div class="card-title">Tambah Akun Baru</div>
      <div class="form-group">
        <label>Platform</label>
        <select id="new-platform">
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="twitter">Twitter/X</option>
        </select>
      </div>
      <div class="form-group">
        <label>Username / Email</label>
        <input type="text" id="new-username" placeholder="username atau email">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="new-password" placeholder="password">
      </div>
      <div style="font-size:11px;color:#888;margin-bottom:12px;padding:8px;background:#FAEEDA;border-radius:6px">
        ⚠ Password disimpan terenkripsi di komputer kamu. Tidak dikirim ke server manapun.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="saveNewAccount()">Simpan Akun</button>
        <button class="btn btn-secondary" onclick="hideAddAccount()">Batal</button>
      </div>
    </div>
  `;
}

function showAddAccount() {
  document.getElementById('add-account-form').style.display = 'block';
}

function hideAddAccount() {
  document.getElementById('add-account-form').style.display = 'none';
}

async function saveNewAccount() {
  const platform = document.getElementById('new-platform').value;
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value;

  if (!username || !password) {
    alert('Username dan password wajib diisi!');
    return;
  }

  accounts = await window.api.saveAccount({ platform, username, password, cookies: null });
  showPage('accounts');
}

async function deleteAccount(id) {
  if (!confirm('Hapus akun ini?')) return;
  accounts = await window.api.deleteAccount(id);
  showPage('accounts');
}

async function clearCookies(id) {
  const account = accounts.find(a => a.id === id);
  if (!account) return;
  account.cookies = null;
  accounts = await window.api.saveAccount(account);
  showPage('accounts');
}

// ─── AUTOMATION ────────────────────────────────────────────────────────────
function renderAutomation() {
  const platforms = ['facebook', 'instagram', 'tiktok', 'twitter'];
  const actionsByPlatform = {
    facebook: ['like', 'comment', 'share', 'scroll', 'add_friend'],
    instagram: ['like', 'comment', 'follow', 'save', 'scroll'],
    tiktok: ['like', 'comment', 'follow', 'scroll'],
    twitter: ['like', 'retweet', 'comment', 'follow']
  };

  return `
    <div class="grid-2">
      <div>
        <div class="card">
          <div class="card-title">Konfigurasi Automasi</div>

          <div class="form-group">
            <label>Platform</label>
            <select id="auto-platform" onchange="updateActionList()">
              ${platforms.map(p => `<option value="${p}">${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Pilih Akun</label>
            <div id="account-checkboxes" style="max-height:150px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
              ${accounts.map(a => `
                <label style="display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer">
                  <input type="checkbox" value="${a.id}" class="account-check"> 
                  <span style="font-size:13px">${a.username} <span style="color:#888;font-size:11px">(${a.platform})</span></span>
                </label>
              `).join('') || '<div style="color:#aaa;font-size:12px">Belum ada akun</div>'}
            </div>
          </div>

          <div class="form-group">
            <label>URL Target (satu per baris)</label>
            <textarea id="auto-urls" rows="4" placeholder="https://facebook.com/...&#10;https://facebook.com/..."></textarea>
          </div>

          <div class="form-group">
            <label>Aksi yang Dilakukan</label>
            <div id="action-list" class="grid-3">
              ${(actionsByPlatform['facebook']).map(action => `
                <label class="action-checkbox" id="action-${action}">
                  <input type="checkbox" value="${action}" class="action-check">
                  <span style="font-size:12px">${action}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-group">
            <label>Template Komentar (satu per baris)</label>
            <textarea id="auto-comments" rows="3" placeholder="Bagus banget!&#10;Keren!&#10;Mantap!"></textarea>
          </div>

          <div class="form-group">
            <label>Durasi per Akun (menit)</label>
            <input type="number" id="auto-duration" value="5" min="1" max="60">
          </div>

          <div style="display:flex;gap:8px">
            <button class="btn btn-success" id="start-btn" onclick="startAutomation()" style="flex:1">
              ▶ Mulai Automasi
            </button>
            <button class="btn btn-danger" id="stop-btn" onclick="stopAutomation()" style="flex:1;display:none">
              ⏹ Stop
            </button>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">Live Log</div>
          <div class="log-container" id="live-log">
            <div style="color:#666">Belum ada aktivitas...</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function updateActionList() {
  const platform = document.getElementById('auto-platform').value;
  const actionsByPlatform = {
    facebook: ['like', 'comment', 'share', 'scroll', 'add_friend'],
    instagram: ['like', 'comment', 'follow', 'save', 'scroll'],
    tiktok: ['like', 'comment', 'follow', 'scroll'],
    twitter: ['like', 'retweet', 'comment', 'follow']
  };

  const actions = actionsByPlatform[platform] || [];
  document.getElementById('action-list').innerHTML = actions.map(action => `
    <label class="action-checkbox" id="action-${action}" onclick="toggleAction(this)">
      <input type="checkbox" value="${action}" class="action-check">
      <span style="font-size:12px">${action}</span>
    </label>
  `).join('');
}

function toggleAction(el) {
  el.classList.toggle('checked');
  el.querySelector('input').checked = el.classList.contains('checked');
}

async function startAutomation() {
  const platform = document.getElementById('auto-platform').value;
  const urlsText = document.getElementById('auto-urls').value;
  const commentsText = document.getElementById('auto-comments').value;
  const duration = parseInt(document.getElementById('auto-duration').value) || 5;

  const targetUrls = urlsText.split('\n').map(u => u.trim()).filter(u => u);
  const commentTemplates = commentsText.split('\n').map(c => c.trim()).filter(c => c);
  const selectedAccountIds = [...document.querySelectorAll('.account-check:checked')].map(c => c.value);
  const selectedActions = [...document.querySelectorAll('.action-check:checked')].map(c => c.value);

  if (!targetUrls.length) { alert('Masukkan minimal 1 URL target!'); return; }
  if (!selectedAccountIds.length) { alert('Pilih minimal 1 akun!'); return; }
  if (!selectedActions.length) { alert('Pilih minimal 1 aksi!'); return; }

  const selectedAccounts = accounts.filter(a => selectedAccountIds.includes(a.id));

  document.getElementById('start-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'block';
  document.getElementById('live-log').innerHTML = '';
  isRunning = true;

  // Update status
  document.getElementById('status-dot').className = 'status-dot status-running';
  document.getElementById('status-text').textContent = 'Berjalan...';

  const result = await window.api.startAutomation({
    accounts: selectedAccounts,
    platform,
    actions: selectedActions,
    targetUrls,
    durationPerAccount: duration,
    commentTemplates
  });

  isRunning = false;
  document.getElementById('start-btn').style.display = 'block';
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('status-dot').className = 'status-dot status-idle';
  document.getElementById('status-text').textContent = 'Idle';
}

async function stopAutomation() {
  await window.api.stopAutomation();
  document.getElementById('start-btn').style.display = 'block';
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('status-dot').className = 'status-dot status-idle';
  document.getElementById('status-text').textContent = 'Idle';
}

function addLiveLog(log) {
  const liveLog = document.getElementById('live-log');
  if (!liveLog) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${log.type}`;
  entry.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${log.message}`;
  liveLog.prepend(entry);
}

// ─── WARM UP ───────────────────────────────────────────────────────────────
function renderWarmup() {
  return `
    <div class="card">
      <div class="card-title">🔥 Warm Up Akun</div>
      <p style="font-size:13px;color:#666;margin-bottom:16px">
        Warm up mensimulasikan aktivitas manusia normal — scroll, like konten random, follow akun, dll.
        Berguna untuk akun baru agar tidak terdeteksi sebagai bot.
      </p>

      <div class="grid-2">
        <div class="form-group">
          <label>Pilih Platform</label>
          <select id="warmup-platform">
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="twitter">Twitter/X</option>
          </select>
        </div>
        <div class="form-group">
          <label>Durasi per Akun (menit)</label>
          <input type="number" id="warmup-duration" value="5" min="1" max="30">
        </div>
      </div>

      <div class="form-group">
        <label>Pilih Akun</label>
        <div style="max-height:150px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
          ${accounts.map(a => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer">
              <input type="checkbox" value="${a.id}" class="warmup-check">
              <span style="font-size:13px">${a.username} (${a.platform})</span>
            </label>
          `).join('') || '<div style="color:#aaa;font-size:12px">Belum ada akun</div>'}
        </div>
      </div>

      <div class="form-group">
        <label>Aktivitas Warm Up</label>
        <div class="grid-3">
          ${['scroll', 'like', 'comment', 'follow', 'watch_video', 'search'].map(a => `
            <label class="action-checkbox" onclick="this.classList.toggle('checked');this.querySelector('input').checked=this.classList.contains('checked')">
              <input type="checkbox" value="${a}">
              <span style="font-size:12px">${a.replace('_', ' ')}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div style="padding:10px;background:#FAEEDA;border-radius:8px;font-size:12px;color:#633806;margin-bottom:16px">
        ⚡ Warm up akan membuka browser dan mensimulasikan aktivitas natural selama durasi yang ditentukan.
        Jeda random otomatis diterapkan antar aktivitas.
      </div>

      <button class="btn btn-success" onclick="startWarmup()" style="width:100%;padding:12px">
        🔥 Mulai Warm Up
      </button>
    </div>

    <div class="card">
      <div class="card-title">Live Log Warm Up</div>
      <div class="log-container" id="warmup-log">
        <div style="color:#666">Belum ada aktivitas...</div>
      </div>
    </div>
  `;
}

async function startWarmup() {
  const platform = document.getElementById('warmup-platform').value;
  const duration = parseInt(document.getElementById('warmup-duration').value) || 5;
  const selectedAccountIds = [...document.querySelectorAll('.warmup-check:checked')].map(c => c.value);
  const selectedActions = [...document.querySelectorAll('#warmup-page .action-checkbox.checked input')].map(c => c.value);

  if (!selectedAccountIds.length) { alert('Pilih minimal 1 akun!'); return; }

  const selectedAccounts = accounts.filter(a => selectedAccountIds.includes(a.id));
  const warmupActions = selectedActions.length > 0 ? selectedActions : ['scroll', 'like'];

  const warmupUrls = {
    facebook: ['https://www.facebook.com/'],
    instagram: ['https://www.instagram.com/'],
    tiktok: ['https://www.tiktok.com/foryou'],
    twitter: ['https://twitter.com/home']
  };

  await window.api.startAutomation({
    accounts: selectedAccounts,
    platform,
    actions: warmupActions,
    targetUrls: warmupUrls[platform] || [],
    durationPerAccount: duration,
    commentTemplates: ['Bagus!', 'Keren!', 'Mantap!']
  });
}

// ─── LOGS ──────────────────────────────────────────────────────────────────
function renderLogs() {
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="card-title" style="margin:0">Log Aktivitas (${logs.length})</div>
        <button class="btn btn-secondary" style="font-size:12px" onclick="clearLogs()">🗑 Hapus Semua</button>
      </div>
      <div class="log-container" style="height:500px">
        ${logs.slice(0, 200).map(l => `
          <div class="log-entry ${l.type}">
            [${new Date(l.timestamp).toLocaleString('id-ID')}] ${l.message}
          </div>
        `).join('') || '<div style="color:#666">Belum ada log</div>'}
      </div>
    </div>
  `;
}

async function clearLogs() {
  if (!confirm('Hapus semua log?')) return;
  logs = await window.api.clearLogs();
  showPage('logs');
}

// ─── SETTINGS ──────────────────────────────────────────────────────────────
function renderSettings() {
  return `
    <div class="card">
      <div class="card-title">⚙️ Pengaturan Automasi</div>

      <div class="form-group">
        <label>Mode Browser</label>
        <select id="setting-headless">
          <option value="false" ${!settings.headless ? 'selected' : ''}>Tampilkan Browser (Visible)</option>
          <option value="true" ${settings.headless ? 'selected' : ''}>Sembunyikan Browser (Headless)</option>
        </select>
        <div style="font-size:11px;color:#888;margin-top:4px">
          Mode Visible: bisa lihat browser bekerja. Mode Headless: lebih cepat tapi tidak terlihat.
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>Jeda Minimum antar Aksi (detik)</label>
          <input type="number" id="setting-delay-min" value="${settings.delayMin || 3}" min="1" max="30">
        </div>
        <div class="form-group">
          <label>Jeda Maksimum antar Aksi (detik)</label>
          <input type="number" id="setting-delay-max" value="${settings.delayMax || 10}" min="2" max="60">
        </div>
      </div>

      <div class="form-group">
        <label>Jeda antar Akun (detik)</label>
        <input type="number" id="setting-rest" value="${settings.restBetweenAccounts || 60}" min="10" max="300">
      </div>

      <div class="form-group">
        <label>Maksimal Aksi per Jam per Akun</label>
        <input type="number" id="setting-max-actions" value="${settings.maxActionsPerHour || 30}" min="5" max="100">
      </div>

      <div style="padding:10px;background:#EAF3DE;border-radius:8px;font-size:12px;color:#3B6D11;margin-bottom:16px">
        💡 Tips: Jeda yang lebih panjang dan aksi yang lebih sedikit = lebih aman dari deteksi bot.
        Disarankan minimal 5 detik antar aksi dan maksimal 30 aksi per jam.
      </div>

      <button class="btn btn-primary" onclick="saveSettings()" style="width:100%">
        💾 Simpan Pengaturan
      </button>
    </div>
  `;
}

async function saveSettings() {
  settings = {
    headless: document.getElementById('setting-headless').value === 'true',
    delayMin: parseInt(document.getElementById('setting-delay-min').value),
    delayMax: parseInt(document.getElementById('setting-delay-max').value),
    restBetweenAccounts: parseInt(document.getElementById('setting-rest').value),
    maxActionsPerHour: parseInt(document.getElementById('setting-max-actions').value)
  };

  await window.api.saveSettings(settings);
  alert('✅ Pengaturan berhasil disimpan!');
}
