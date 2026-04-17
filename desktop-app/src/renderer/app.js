let accounts = [], settings = {}, logs = [], currentPage = 'dashboard';
let bulkPostResults = [];
let editingId = null;
let liveLogs = [];  // log automasi terbaru, tahan saat pindah halaman
const MAX_LIVE_LOGS = 200;  // batasi 200 log terakhir biar tidak boros memory
let isRunning = false;
let oauthAccounts = [];  // akun yang terhubung via OAuth (disimpan di Supabase)

const PLATFORMS = {
  facebook: { label: 'Facebook', icon: '📘', color: '#1877F2', bg: '#E6F1FB' },
  instagram: { label: 'Instagram', icon: '📸', color: '#D4537E', bg: '#FBEAF0' },
  youtube: { label: 'YouTube', icon: '▶️', color: '#FF0000', bg: '#FAECE7' },
  twitter: { label: 'Twitter/X', icon: '🐦', color: '#888780', bg: '#F1EFE8' },
  tiktok: { label: 'TikTok', icon: '🎵', color: '#333', bg: '#f0efec' },
  threads: { label: 'Threads', icon: '🧵', color: '#000', bg: '#f0efec' }};

const ACTIONS = {
  facebook: [
    { key: 'like', label: '👍 Like', color: '#1877F2' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'share', label: '↗ Share', color: '#1D9E75' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' },
    { key: 'add_friend', label: '👤 Add Friend', color: '#7F77DD' },
    { key: 'follow_page', label: '📌 Follow Page', color: '#E24B4A' },
    { key: 'auto_reply', label: '🤖 Auto Reply', color: '#EF9F27' },
    { key: 'scrape_comments', label: '📥 Scrape Komentar', color: '#9B59B6' }],
  instagram: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'repost', label: '🔄 Repost', color: '#1D9E75' },
    { key: 'save', label: '🔖 Save', color: '#7F77DD' },
    { key: 'follow', label: '✅ Follow', color: '#1DA1F2' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' },
    { key: 'story_view', label: '👁 Lihat Story', color: '#E24B4A' },
    { key: 'auto_reply', label: '🤖 Auto Reply', color: '#EF9F27' },
    { key: 'scrape_comments', label: '📥 Scrape Komentar', color: '#9B59B6' }],
  youtube: [
    { key: 'like', label: '👍 Like', color: '#FF0000' },
    { key: 'dislike', label: '👎 Dislike', color: '#E24B4A' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'subscribe', label: '🔔 Subscribe', color: '#FF0000' },
    { key: 'save', label: '📋 Save to Playlist', color: '#7F77DD' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' }],
  twitter: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'retweet', label: '🔄 Retweet', color: '#1D9E75' },
    { key: 'comment', label: '💬 Reply', color: '#378ADD' },
    { key: 'bookmark', label: '🔖 Bookmark', color: '#7F77DD' },
    { key: 'follow', label: '✅ Follow', color: '#1DA1F2' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' }],
  tiktok: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'comment', label: '💬 Komentar', color: '#378ADD' },
    { key: 'share', label: '↗ Share', color: '#1D9E75' },
    { key: 'follow', label: '✅ Follow', color: '#7F77DD' },
    { key: 'save', label: '🔖 Favorit', color: '#EF9F27' },
    { key: 'scroll', label: '📜 Scroll FYP', color: '#888' }],
  threads: [
    { key: 'like', label: '❤️ Like', color: '#D4537E' },
    { key: 'comment', label: '💬 Reply', color: '#378ADD' },
    { key: 'repost', label: '🔄 Repost', color: '#1D9E75' },
    { key: 'follow', label: '✅ Follow', color: '#7F77DD' },
    { key: 'scroll', label: '📜 Scroll Feed', color: '#888' }]};

window.addEventListener('DOMContentLoaded', async () => {
  try {
    accounts = await window.api.getAccounts();
    settings = await window.api.getSettings();
    logs = await window.api.getLogs();
    oauthAccounts = await window.api.getOAuthAccounts().catch(() => []);
    go('dashboard');

    window.api.onLog((log) => {
      logs.unshift({ ...log, timestamp: new Date().toISOString() });
      addToLiveLog(log);
    });

    window.api.onOAuthResult(async (result) => {
      if (result.success) {
        oauthAccounts = await window.api.getOAuthAccounts().catch(() => []);
        if (currentPage === 'accounts') go('accounts');
        alert(`✅ Berhasil! ${result.accounts?.length || 0} akun terhubung.`);
      } else {
        alert(`❌ Koneksi gagal: ${result.error}`);
      }
    });
  } catch (e) {
    console.error('Startup error:', e);
    document.getElementById('content').innerHTML = `
      <div class="card" style="border-left:4px solid #dc2626;margin:20px">
        <div class="card-title" style="color:#dc2626">⚠️ Gagal Memuat Aplikasi</div>
        <div style="font-size:13px;color:#666;margin-bottom:8px">Periksa apakah aplikasi dijalankan melalui Electron (npm start).</div>
        <div style="font-family:monospace;font-size:12px;color:#999">${e.message}</div>
      </div>`;
  }
});

function go(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`nav-${page}`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', accounts:'Akun & User', bulkpost:'Bulk Post', amplify:'Amplifikasi', warmup:'Warm Up', automation:'Automasi', logs:'Log Aktivitas', settings:'Pengaturan' };
  document.getElementById('page-title').textContent = titles[page] || page;
  const pages = { dashboard: pageDashboard, accounts: pageAccounts, bulkpost: pageBulkPost, amplify: pageAmplify, warmup: pageWarmup, automation: pageAutomation, logs: pageLogs, settings: pageSettings };
  try {
    document.getElementById('content').innerHTML = (pages[page] || (() => ''))();
  } catch (e) {
    console.error(`Error rendering page "${page}":`, e);
    document.getElementById('content').innerHTML = `
      <div class="card" style="border-left:4px solid #dc2626">
        <div class="card-title" style="color:#dc2626">⚠️ Error Memuat Halaman</div>
        <div style="font-family:monospace;font-size:12px;color:#666;white-space:pre-wrap">${e.message}</div>
      </div>`;
  }
}

function setRunning(running) {
  isRunning = running;
  document.getElementById('status-dot').className = `status-dot ${running ? 'dot-running' : 'dot-idle'}`;
  document.getElementById('status-text').textContent = running ? 'Berjalan...' : 'Idle';
  document.getElementById('stop-btn').style.display = running ? 'block' : 'none';
}

async function openScreenshotFolder() {
  await window.api.openScreenshotFolder();
}

async function stopAll() {
  await window.api.stopAll();
  setRunning(false);
}

function addToLiveLog(log) {
  // Simpan ke state dulu (biar tahan saat pindah halaman)
  liveLogs.unshift({
    ...log,
    timestamp: new Date().toLocaleTimeString('id-ID')
  });
  
  // Batasi jumlah log di memory
  if (liveLogs.length > MAX_LIVE_LOGS) {
    liveLogs = liveLogs.slice(0, MAX_LIVE_LOGS);
  }
  
  // Render ke DOM kalau halaman automation sedang dibuka
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

  const totalSuccess = logs.filter(l => l.type === 'success').length;
  const totalError   = logs.filter(l => l.type === 'error').length;
  const loggedIn     = accounts.filter(a => a.cookies).length;

  // 7-day activity chart
  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  }).reverse();
  const activity = {};
  last7Days.forEach(d => activity[d] = { success: 0, error: 0 });
  logs.forEach(l => {
    if (!l.timestamp) return;
    const date = l.timestamp.split('T')[0];
    if (activity[date]) {
      if (l.type === 'success') activity[date].success++;
      if (l.type === 'error') activity[date].error++;
    }
  });
  const maxAct = Math.max(...Object.values(activity).map(d => d.success + d.error), 1);

  const DAY_SHORT = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];

  return `
    <!-- Stat Cards -->
    <div class="grid-3" style="margin-bottom:16px">
      <div class="stat-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div class="stat-val" style="color:#7a72dc">${accounts.length}</div>
            <div class="stat-label">Total Akun</div>
          </div>
          <div style="width:38px;height:38px;background:rgba(122,114,220,0.10);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">👤</div>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--c-border);font-size:11.5px;color:var(--c-text-3)">
          <span style="color:#7a72dc;font-weight:600">${loggedIn}</span> sudah login
          &nbsp;·&nbsp; <span style="color:var(--c-warn);font-weight:600">${accounts.length - loggedIn}</span> belum
        </div>
      </div>
      <div class="stat-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div class="stat-val" style="color:var(--c-success)">${totalSuccess}</div>
            <div class="stat-label">Aksi Berhasil</div>
          </div>
          <div style="width:38px;height:38px;background:rgba(22,163,74,0.10);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">✅</div>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--c-border);font-size:11.5px;color:var(--c-text-3)">
          ${totalSuccess + totalError > 0
            ? `Tingkat sukses <span style="color:var(--c-success);font-weight:600">${Math.round(totalSuccess/(totalSuccess+totalError)*100)}%</span>`
            : 'Belum ada aktivitas'}
        </div>
      </div>
      <div class="stat-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div class="stat-val" style="color:var(--c-danger)">${totalError}</div>
            <div class="stat-label">Aksi Gagal</div>
          </div>
          <div style="width:38px;height:38px;background:rgba(220,38,38,0.09);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">❌</div>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--c-border);font-size:11.5px;color:var(--c-text-3)">
          ${totalError === 0 ? '<span style="color:var(--c-success);font-weight:600">Tidak ada error</span>' : `<span style="color:var(--c-danger);font-weight:600">${totalError} error</span> tercatat`}
        </div>
      </div>
    </div>

    <!-- Platform breakdown + Chart -->
    <div class="grid-2" style="align-items:start;margin-bottom:16px">
      <div class="card" style="margin-bottom:0">
        <div class="card-title">Akun per Platform</div>
        <div style="display:flex;flex-direction:column;gap:7px">
          ${Object.entries(PLATFORMS).map(([key, p]) => {
            const count = byPlatform[key] || 0;
            const pct = accounts.length ? Math.round((count / accounts.length) * 100) : 0;
            return `
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:28px;height:28px;background:${p.bg};border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${p.icon}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                    <span style="font-size:12px;font-weight:500;color:var(--c-text)">${p.label}</span>
                    <span style="font-size:12px;font-weight:700;color:${p.color}">${count}</span>
                  </div>
                  <div style="height:4px;background:var(--c-hover);border-radius:10px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${p.color};border-radius:10px;transition:width 0.4s ease"></div>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:0">
        <div class="card-title">Performa 7 Hari Terakhir</div>
        <div style="display:flex;align-items:flex-end;gap:5px;height:100px">
          ${last7Days.map(date => {
            const d = activity[date];
            const total = d.success + d.error;
            const hPct = Math.max((total / maxAct) * 100, total > 0 ? 6 : 2);
            const sPct = total === 0 ? 0 : (d.success / total) * 100;
            const ePct = total === 0 ? 0 : (d.error / total) * 100;
            const dayName = DAY_SHORT[new Date(date + 'T12:00:00').getDay()];
            return `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px"
                   title="${date}: ${d.success} sukses, ${d.error} gagal">
                <div style="width:100%;height:80px;display:flex;flex-direction:column;justify-content:flex-end;
                            background:var(--c-hover);border-radius:5px;overflow:hidden;cursor:default">
                  <div style="height:${hPct}%;width:100%;display:flex;flex-direction:column">
                    <div style="flex:${sPct};background:var(--c-success);min-height:${sPct>0?2:0}px"></div>
                    <div style="flex:${ePct};background:var(--c-danger);min-height:${ePct>0?2:0}px"></div>
                  </div>
                </div>
                <span style="font-size:10px;color:var(--c-text-3);font-weight:500">${dayName}</span>
              </div>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:center;gap:16px;margin-top:10px">
          <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--c-text-3)">
            <span style="width:10px;height:10px;background:var(--c-success);border-radius:3px;display:inline-block"></span>Sukses
          </span>
          <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--c-text-3)">
            <span style="width:10px;height:10px;background:var(--c-danger);border-radius:3px;display:inline-block"></span>Gagal
          </span>
        </div>
      </div>
    </div>

    <!-- Recent log -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="card-title" style="margin-bottom:0">Log Terbaru</div>
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px" onclick="go('logs')">Lihat Semua →</button>
      </div>
      <div class="log-box">
        ${logs.slice(0,20).map(l => {
          const ts = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('id-ID') : '--:--';
          return `<div class="log-entry log-${l.type}">[${ts}]  ${l.message}</div>`;
        }).join('') || '<div style="color:#3d4454;padding:8px 0;font-size:12px">Belum ada aktivitas tercatat.</div>'}
      </div>
    </div>`;
}

const LOGIN_INFO = {
  facebook:  { label: 'Email / No. HP',     placeholder: 'email atau nomor HP',    hint: '' },
  instagram: { label: 'Username / Email',    placeholder: 'username atau email',    hint: '' },
  youtube:   { label: 'Email Google',        placeholder: 'email@gmail.com',        hint: '💡 YouTube menggunakan akun Google' },
  twitter:   { label: 'Username / Email / Google', placeholder: 'username, email, atau akun Google', hint: '💡 X/Twitter bisa login via Google' },
  tiktok:    { label: 'Email / No. HP / Google', placeholder: 'email, HP, atau akun Google', hint: '💡 TikTok bisa login via Google atau email' },
  threads:   { label: 'Username Instagram',  placeholder: 'username Instagram',     hint: '💡 Threads login menggunakan akun Instagram' }};

function pageAccounts() {
  // ── Bagian OAuth ──────────────────────────────────────────────────────────
  const oauthByPlatform = {};
  oauthAccounts.forEach(a => {
    if (!oauthByPlatform[a.platform]) oauthByPlatform[a.platform] = [];
    oauthByPlatform[a.platform].push(a);
  });

  const oauthSection = `
    <div class="card" style="border-left:3px solid #7a72dc">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div class="card-title" style="margin:0">🔗 Akun Terhubung (OAuth)</div>
          <div style="font-size:12px;color:var(--c-text-3);margin-top:3px">Untuk posting otomatis via worker</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" style="background:#1877F2;font-size:12px;padding:6px 14px" onclick="connectFacebook()">
            📘 Facebook / Instagram
          </button>
          <button class="btn btn-primary" style="background:#000;font-size:12px;padding:6px 14px" onclick="connectTwitter()">
            🐦 Twitter / X
          </button>
          <button class="btn btn-primary" style="background:#ff0050;font-size:12px;padding:6px 14px" onclick="connectTikTok()">
            🎵 TikTok
          </button>
          <button class="btn btn-primary" style="background:#FF0000;font-size:12px;padding:6px 14px" onclick="connectYoutube()">
            ▶️ YouTube
          </button>
          <button class="btn btn-primary" style="background:#000;font-size:12px;padding:6px 14px" onclick="connectThreads()">
            🧵 Threads
          </button>
        </div>
      </div>

      ${oauthAccounts.length === 0
        ? `<div style="text-align:center;padding:30px;color:#aaa;font-size:13px">
             Belum ada akun terhubung — klik tombol di atas untuk mulai
           </div>`
        : Object.entries(PLATFORMS)
            .filter(([p]) => oauthByPlatform[p]?.length > 0)
            .map(([platform, p]) => `
              <div style="margin-bottom:12px">
                <div style="padding:8px 12px;background:${p.bg};border-radius:8px;display:flex;align-items:center;gap:8px;margin-bottom:6px">
                  <span style="font-size:16px">${p.icon}</span>
                  <span style="font-size:13px;font-weight:600;color:${p.color};flex:1">${p.label}</span>
                  <span style="font-size:12px;color:${p.color}">${oauthByPlatform[platform].length} akun</span>
                </div>
                ${oauthByPlatform[platform].map(a => `
                  <div class="account-row" style="margin-left:8px">
                    <div class="avatar" style="background:${p.color}">${(a.username||'?')[0].toUpperCase()}</div>
                    <div style="flex:1">
                      <div style="font-size:13px;font-weight:500">${a.username || a.platform_uid}</div>
                      <div style="font-size:11px;color:#888;margin-top:2px">ID: ${a.platform_uid}</div>
                    </div>
                    <span class="badge ${a.is_active ? 'badge-success' : 'badge-warn'}">${a.is_active ? 'Aktif' : 'Nonaktif'}</span>
                    <button class="btn btn-danger" style="font-size:11px;padding:4px 8px"
                      onclick="removeOAuthAccount('${a.id}')">Lepas</button>
                  </div>
                `).join('')}
              </div>
            `).join('')
      }
    </div>`;

  // ── Bagian Puppeteer (existing) ───────────────────────────────────────────
  const byPlatform = {};
  accounts.forEach(a => { if (!byPlatform[a.platform]) byPlatform[a.platform] = []; byPlatform[a.platform].push(a); });
  const totalBelumLogin = accounts.filter(a => !a.cookies).length;

  return oauthSection + `
    <!-- Panel Cek Login Massal -->
    <div class="card" style="border-left:3px solid #7a72dc">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="card-title" style="margin:0">🔑 Cek Login Massal</div>
          ${totalBelumLogin > 0
            ? `<span id="not-logged-badge" class="badge badge-warn">${totalBelumLogin} belum login</span>`
            : `<span id="not-logged-badge" class="badge badge-success">Semua aktif</span>`}
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px" onclick="selectLoginAccounts('all')">✅ Semua</button>
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px" onclick="selectLoginAccounts('notlogin')">⚠️ Belum Login</button>
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px" onclick="selectLoginAccounts('none')">✕ Reset</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span id="login-check-count" style="font-size:12px;color:#666;flex:1">0 akun dipilih</span>
        <button class="btn btn-primary" id="login-check-btn" onclick="loginSelectedAccounts()" style="background:#6960c8;padding:8px 18px;font-size:13px">
          🔑 Jalankan Cek Login
        </button>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-title" style="margin:0">Daftar Akun (${accounts.length})</div>
        <button class="btn btn-primary" onclick="cancelEdit(); showForm('add-form')">+ Tambah Akun</button>
      </div>

      ${accounts.length === 0
        ? `<div style="text-align:center;padding:40px;color:#aaa"><div style="font-size:48px;margin-bottom:12px">👤</div><div>Belum ada akun — klik "+ Tambah Akun" untuk mulai</div></div>`
        : Object.entries(PLATFORMS).filter(([p]) => byPlatform[p]?.length > 0).map(([platform, p]) => `
            <div style="margin-bottom:14px">
              <div style="padding:10px 14px;background:${p.bg};border-radius:8px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
                <span style="font-size:18px">${p.icon}</span>
                <span style="font-size:13px;font-weight:600;color:${p.color};flex:1">${p.label}</span>
                <span style="font-size:12px;color:${p.color};font-weight:500">${byPlatform[platform].length} akun</span>
              </div>
              ${byPlatform[platform].map(a => `
                <div class="account-row" style="margin-left:8px">
                  <input type="checkbox" value="${a.id}" class="acc-check" style="width:16px;height:16px;flex-shrink:0;cursor:pointer" onchange="updateLoginCheckCount()">
                  <div class="avatar" style="background:${p.color}">${(a.username||'?')[0].toUpperCase()}</div>
                  <div style="flex:1">
                    <div style="font-size:13px;font-weight:500">${a.username}</div>
                    <div style="font-size:11px;color:#888;margin-top:2px">
                      ${getTwoFALabel(a.twoFAType)} •
                      <span data-acc-status="${a.id}">${a.cookies ? '✅ Sudah Login' : '○ Belum Login'}</span>
                    </div>
                  </div>
                  <span class="badge ${a.cookies ? 'badge-success' : 'badge-warn'}" data-acc-badge="${a.id}">${a.cookies ? 'Aktif' : 'Belum Login'}</span>
                  <button class="btn btn-primary" style="font-size:11px;padding:4px 8px;background:#6960c8" onclick="loginAccount('${a.id}')">🔑 Login</button>
                  <button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="editAccount('${a.id}')">✏️ Edit</button>
                  <button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="clearCookies('${a.id}')">Reset Sesi</button>
                  <button class="btn btn-danger" style="font-size:11px;padding:4px 8px" onclick="deleteAccount('${a.id}')">Hapus</button>
                </div>
              `).join('')}
            </div>
          `).join('')}
    </div>

    <!-- Form Tambah / Edit Akun -->
    <div class="card" id="add-form" style="display:none">
      <div class="card-title">➕ Tambah Akun Baru</div>

      <div class="form-group">
        <label>Platform</label>
        <select id="f-platform" onchange="updateLoginHint()">
          ${Object.entries(PLATFORMS).map(([k,p])=>`<option value="${k}">${p.icon} ${p.label}</option>`).join('')}
        </select>
      </div>

      <!-- Hint login per platform -->
      <div id="f-login-hint" style="display:none;font-size:12px;padding:8px;background:#E6F1FB;border-radius:6px;color:#185FA5;margin-bottom:10px"></div>

      <div class="grid-2">
        <div class="form-group">
          <label id="f-username-label">Email / Username</label>
          <input type="text" id="f-username" placeholder="email atau username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="f-password" placeholder="password akun">
        </div>
      </div>

      <!-- 2FA Section -->
      <div style="background:#F0F0FF;border-radius:8px;padding:14px;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:#7a72dc;margin-bottom:10px">🔐 Verifikasi 2 Langkah (2FA)</div>

        <div class="form-group">
          <label>Metode 2FA yang digunakan akun ini</label>
          <select id="f-2fa-type" onchange="toggle2FA()">
            <option value="none">❌ Tidak Ada 2FA</option>
            <option value="google_auth">📱 Google Authenticator</option>
            <option value="duo_mobile">📱 Duo Mobile</option>
            <option value="2fa_live">🌐 2FA.live / OTP Apps lainnya</option>
            <option value="sms_email">📧 SMS / Email OTP (Manual)</option>
          </select>
        </div>

        <!-- TOTP Secret Key -->
        <div id="totp-section" style="display:none">
          <div style="font-size:12px;color:#7a72dc;background:rgba(122,114,220,0.10);padding:8px;border-radius:6px;margin-bottom:8px">
            📋 <b>Cara dapat Secret Key:</b><br>
            • <b>Google Authenticator:</b> Buka app → tahan akun → Transfer/Export → scan QR dan catat secret<br>
            • <b>Duo Mobile:</b> Settings → Duo account → Show Secret Key<br>
            • <b>2FA.live:</b> Salin secret key saat setup awal
          </div>
          <div class="form-group">
            <label>Secret Key 2FA</label>
            <input type="text" id="f-2fa-secret" placeholder="contoh: JBSWY3DPEHPK3PXP" style="font-family:monospace">
          </div>
        </div>

        <!-- SMS/Email manual -->
        <div id="sms-section" style="display:none;font-size:12px;color:#633806;padding:8px;background:#FAEEDA;border-radius:6px">
          ⏱️ Saat login, robot akan <b>pause 60 detik</b> — silakan buka HP/email dan masukkan kode OTP secara manual di browser yang terbuka.
        </div>
      </div>

      <div style="font-size:11px;color:#888;background:#FAEEDA;padding:8px;border-radius:6px;margin-bottom:12px">
        🔒 Data tersimpan terenkripsi di PC kamu. Tidak pernah dikirim ke server manapun.
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="saveAccount()" style="flex:1;padding:10px">✅ Simpan Akun</button>
        <button class="btn btn-secondary" onclick="cancelEdit()" style="padding:10px">Batal</button>
      </div>
    </div>
  `;
}

function getTwoFALabel(type) {
  const labels = {
    none: '○ Tanpa 2FA',
    google_auth: '🔐 Google Authenticator',
    duo_mobile: '🔐 Duo Mobile',
    '2fa_live': '🔐 2FA.live',
    sms_email: '🔐 SMS/Email OTP'};
  return labels[type] || '○ Tanpa 2FA';
}

function updateLoginHint() {
  const platform = document.getElementById('f-platform').value;
  const info = LOGIN_INFO[platform];
  if (!info) return;

  const label = document.getElementById('f-username-label');
  const input = document.getElementById('f-username');
  const hint = document.getElementById('f-login-hint');

  if (label) label.textContent = info.label;
  if (input) input.placeholder = info.placeholder;

  if (hint) {
    if (info.hint) {
      hint.textContent = info.hint;
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }
}

function toggle2FA() {
  const type = document.getElementById('f-2fa-type').value;
  document.getElementById('totp-section').style.display =
    ['google_auth', 'duo_mobile', '2fa_live'].includes(type) ? 'block' : 'none';
  document.getElementById('sms-section').style.display =
    type === 'sms_email' ? 'block' : 'none';
}

async function saveAccount() {
  const username = document.getElementById('f-username').value.trim();
  const password = document.getElementById('f-password').value;
  const platform = document.getElementById('f-platform').value;

  if (!username) { alert('Username/email tidak boleh kosong!'); return; }
  if (!password && platform !== 'threads') { alert('Password tidak boleh kosong!'); return; }

  const twoFAType = document.getElementById('f-2fa-type').value;
  const twoFactorSecret = document.getElementById('f-2fa-secret')?.value?.trim() || '';

  let payload = {
    platform, username, password,
    twoFAType, twoFactorSecret,
    accountType: 'browser'
  };

  if (editingId) {
    // MODE EDIT: merge dengan data lama, jangan sentuh cookies
    const existing = accounts.find(a => a.id === editingId);
    if (existing) {
      payload = { ...existing, ...payload, id: editingId };
      // Cookies dari existing tetap dipertahankan
    }
  } else {
    // MODE ADD: akun baru, belum login
    payload.cookies = null;
  }

  accounts = await window.api.saveAccount(payload);
  
  editingId = null;
  resetForm();
  hideForm('add-form');
  go('accounts');
}

function resetForm() {
  const fields = ['f-username', 'f-password', 'f-2fa-secret'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const typeEl = document.getElementById('f-2fa-type');
  if (typeEl) typeEl.value = 'none';
  const platformEl = document.getElementById('f-platform');
  if (platformEl) platformEl.value = Object.keys(PLATFORMS)[0];
  if (typeof toggle2FA === 'function') toggle2FA();
  
  // Reset judul form ke mode "Tambah"
  const formTitle = document.querySelector('#add-form-title');
  if (formTitle) formTitle.textContent = '➕ Tambah Akun Baru';
  const saveBtn = document.querySelector('#add-form button.btn-primary');
  if (saveBtn) saveBtn.textContent = '✅ Simpan Akun';
}

function editAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) { alert('Akun tidak ditemukan'); return; }
  
  editingId = id;
  
  // Pre-fill form dengan data akun
  document.getElementById('f-platform').value = acc.platform || 'facebook';
  document.getElementById('f-username').value = acc.username || '';
  document.getElementById('f-password').value = acc.password || '';
  document.getElementById('f-2fa-type').value = acc.twoFAType || 'none';
  const secretEl = document.getElementById('f-2fa-secret');
  if (secretEl) secretEl.value = acc.twoFactorSecret || '';

  // Trigger toggle 2FA supaya section yang sesuai muncul
  if (typeof toggle2FA === 'function') toggle2FA();
  
  // Ubah judul & tombol form ke mode "Edit"
  const formTitle = document.querySelector('#add-form-title');
  if (formTitle) formTitle.textContent = `✏️ Edit Akun: ${acc.username}`;
  const saveBtn = document.querySelector('#add-form button.btn-primary');
  if (saveBtn) saveBtn.textContent = '💾 Update Akun';
  
  showForm('add-form');
  // Scroll ke form biar langsung terlihat
  document.getElementById('add-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  editingId = null;
  resetForm();
  hideForm('add-form');
}

// Login Checker Khusus
async function loginAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  if (isRunning) { alert('Tolong hentikan proses automasi yang berjalan terlebih dahulu.'); return; }
  
  setRunning(true);
  alert(`Memulai sistem cek & login untuk akun:\n${acc.username}\n\nBrowser akan terbuka. Silakan selesaikan Captcha atau 2FA di browser jika diminta.`);
  
  await window.api.startAutomation({
    accounts: [acc],
    platform: acc.platform,
    mode: 'login_only'
  });
  
  accounts = await window.api.getAccounts(); // Refresh agar cookie terbaru terbaca
  if (currentPage === 'accounts') go('accounts');
  setRunning(false);
}
// ─── BATCH LOGIN ───────────────────────────────────────────────────────────
// State overlay — tetap hidup meski halaman di-render ulang
let _bloQueue   = [];   // array of {id, platform, username}
let _bloResults = {};   // id -> 'pending'|'running'|'ok'|'warn'|'fail'

function selectLoginAccounts(mode) {
  const checks = document.querySelectorAll('.acc-check');
  checks.forEach(c => {
    if (mode === 'all') c.checked = true;
    else if (mode === 'none') c.checked = false;
    else if (mode === 'notlogin') {
      const acc = accounts.find(a => a.id === c.value);
      c.checked = !!(acc && !acc.cookies);
    }
  });
  updateLoginCheckCount();
}

function updateLoginCheckCount() {
  const count = document.querySelectorAll('.acc-check:checked').length;
  const el = document.getElementById('login-check-count');
  if (el) el.textContent = `${count} akun dipilih`;
}

/* ── Overlay helpers ──────────────────────────────────────────── */
function _bloGetOverlay() { return document.getElementById('blo-overlay'); }

function _bloCreate(queue) {
  // Hapus overlay lama kalau ada
  const old = _bloGetOverlay();
  if (old) old.remove();

  const rowsHtml = queue.map(a => {
    const p = PLATFORMS[a.platform] || { icon: '🌐', color: '#888' };
    return `
      <div id="blo-row-${a.id}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px">
        <span style="font-size:16px">${p.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:#e6e6e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.username}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${p.label || a.platform}</div>
        </div>
        <span id="blo-status-${a.id}" style="font-size:12px;color:rgba(255,255,255,0.3)">⏳ Antri</span>
      </div>`;
  }).join('');

  const el = document.createElement('div');
  el.id = 'blo-overlay';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center';
  el.innerHTML = `
    <div style="background:#1a1a2e;border-radius:16px;width:500px;max-height:82vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.6);border:1px solid rgba(175,169,236,0.18)">

      <!-- Header -->
      <div style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:12px">
        <span id="blo-dot" style="width:10px;height:10px;border-radius:50%;background:#4CAF50;flex-shrink:0;animation:blink 1s infinite"></span>
        <div style="color:#b3aef0;font-size:15px;font-weight:700;flex:1">🔑 Cek Login Massal</div>
        <span id="blo-counter" style="font-size:12px;color:rgba(255,255,255,0.35);font-variant-numeric:tabular-nums">0 / ${queue.length}</span>
      </div>

      <!-- Daftar akun -->
      <div style="padding:14px 18px;overflow-y:auto;max-height:260px;display:flex;flex-direction:column;gap:6px">
        ${rowsHtml}
      </div>

      <!-- Log terminal -->
      <div id="blo-log" style="flex:1;min-height:110px;max-height:150px;overflow-y:auto;padding:10px 16px;background:#0d1117;font-family:'Consolas',monospace;font-size:11px;line-height:1.7;border-top:1px solid rgba(255,255,255,0.06)"></div>

      <!-- Footer -->
      <div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:12px">
        <div id="blo-summary" style="font-size:12px;color:rgba(255,255,255,0.4);flex:1"></div>
        <button id="blo-close-btn" onclick="closeBatchLoginOverlay()"
          style="padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:#6960c8;color:#fff;opacity:0.4;pointer-events:none">
          Selesai & Tutup
        </button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

function _bloLog(msg, type = 'info') {
  const box = document.getElementById('blo-log');
  if (!box) return;
  const colors = { success: '#3fb950', error: '#f85149', warn: '#d29922', info: '#58a6ff' };
  const div = document.createElement('div');
  div.style.color = colors[type] || colors.info;
  div.textContent = `[${new Date().toLocaleTimeString()}]  ${msg}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function _bloSetStatus(id, state) {
  const el = document.getElementById(`blo-status-${id}`);
  if (!el) return;
  const map = {
    running: { text: '🔄 Proses...', color: '#d29922' },
    ok:      { text: '✅ Berhasil',  color: '#3fb950' },
    warn:    { text: '⚠️ Cookie kosong', color: '#d29922' },
    fail:    { text: '❌ Gagal',     color: '#f85149' },
    pending: { text: '⏳ Antri',     color: 'rgba(255,255,255,0.3)' },
  };
  const s = map[state] || map.pending;
  el.textContent = s.text;
  el.style.color = s.color;
  // Highlight row saat aktif
  const row = document.getElementById(`blo-row-${id}`);
  if (row) row.style.background = state === 'running'
    ? 'rgba(175,169,236,0.12)' : 'rgba(255,255,255,0.04)';
}

function _bloSetCounter(done, total) {
  const el = document.getElementById('blo-counter');
  if (el) el.textContent = `${done} / ${total}`;
}

function _bloFinish(ok, warn, fail) {
  const dot = document.getElementById('blo-dot');
  if (dot) { dot.style.animation = 'none'; dot.style.background = '#3fb950'; }
  const btn = document.getElementById('blo-close-btn');
  if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
  const sum = document.getElementById('blo-summary');
  if (sum) sum.innerHTML =
    `<span style="color:#3fb950">✅ ${ok}</span> &nbsp; <span style="color:#d29922">⚠️ ${warn}</span> &nbsp; <span style="color:#f85149">❌ ${fail}</span>`;
}

function closeBatchLoginOverlay() {
  const o = _bloGetOverlay();
  if (o) o.remove();
  // Refresh halaman akun supaya badge & status ter-update
  if (currentPage === 'accounts') go('accounts');
}

/* ── updateAccountBadge — update DOM tanpa full re-render ─────── */
function updateAccountBadge(id, isLoggedIn) {
  const statusEl = document.querySelector(`[data-acc-status="${id}"]`);
  const badgeEl  = document.querySelector(`[data-acc-badge="${id}"]`);
  if (statusEl) statusEl.textContent = isLoggedIn ? '✅ Sudah Login' : '○ Belum Login';
  if (badgeEl) {
    badgeEl.textContent = isLoggedIn ? '✅ Login' : '○ Belum Login';
    badgeEl.className   = `badge ${isLoggedIn ? 'badge-success' : 'badge-warn'}`;
  }
}

/* ── Main batch login runner ──────────────────────────────────── */
async function loginSelectedAccounts() {
  const checked = Array.from(document.querySelectorAll('.acc-check:checked'));
  if (!checked.length) { alert('Pilih minimal satu akun terlebih dahulu.'); return; }
  if (isRunning) { alert('Hentikan proses yang sedang berjalan terlebih dahulu.'); return; }

  _bloQueue = checked.map(c => {
    const acc = accounts.find(a => a.id === c.value);
    return acc ? { id: acc.id, platform: acc.platform, username: acc.username } : null;
  }).filter(Boolean);

  _bloCreate(_bloQueue);
  setRunning(true);
  _bloLog(`Memulai cek/login untuk ${_bloQueue.length} akun...`, 'info');

  let cntOk = 0, cntWarn = 0, cntFail = 0;
  let done = 0;

  for (const item of _bloQueue) {
    const acc = accounts.find(a => a.id === item.id);
    if (!acc) continue;

    _bloSetStatus(item.id, 'running');
    _bloLog(`⏳ [${acc.platform}] ${acc.username} — memulai...`, 'info');

    try {
      await window.api.startAutomation({
        accounts: [acc],
        platform: acc.platform,
        mode: 'login_only'
      });
      accounts = await window.api.getAccounts();
      const updated = accounts.find(a => a.id === acc.id);
      const ok = !!(updated && updated.cookies);

      if (ok) {
        _bloSetStatus(item.id, 'ok');
        _bloLog(`✅ [${acc.platform}] ${acc.username} — Login berhasil`, 'success');
        cntOk++;
      } else {
        _bloSetStatus(item.id, 'warn');
        _bloLog(`⚠️ [${acc.platform}] ${acc.username} — Cookie tidak tersimpan`, 'warn');
        cntWarn++;
      }
      updateAccountBadge(acc.id, ok);
    } catch (err) {
      _bloSetStatus(item.id, 'fail');
      _bloLog(`❌ [${acc.platform}] ${acc.username} — ${err.message}`, 'error');
      cntFail++;
    }

    done++;
    _bloSetCounter(done, _bloQueue.length);
  }

  _bloLog(`Selesai. Berhasil: ${cntOk}  Peringatan: ${cntWarn}  Gagal: ${cntFail}`, 'info');
  _bloFinish(cntOk, cntWarn, cntFail);
  setRunning(false);

  // Update badge "belum login" di card header (jika halaman accounts masih tampil)
  const notLogged = accounts.filter(a => !a.cookies).length;
  const headerBadge = document.getElementById('not-logged-badge');
  if (headerBadge) {
    headerBadge.textContent = notLogged > 0 ? `${notLogged} belum login` : 'Semua aktif';
    headerBadge.className   = `badge ${notLogged > 0 ? 'badge-warn' : 'badge-success'}`;
  }
}

// ─── BULK POST ─────────────────────────────────────────────────────────────
const PLATFORM_CHAR_LIMITS = {
  facebook:  { text: 63206, caption: 'Tidak ada batas karakter' },
  instagram: { text: 2200,  caption: 'Maks 2.200 karakter' },
  youtube:   { text: 5000,  caption: 'Maks 5.000 karakter (deskripsi)' },
  twitter:   { text: 280,   caption: 'Maks 280 karakter' },
  tiktok:    { text: 2200,  caption: 'Maks 2.200 karakter' },
  threads:   { text: 500,   caption: 'Maks 500 karakter' }};

// ===== BULK POST FIXED SECTION =====
// Ini adalah bagian yang diperbaiki untuk menggantikan bagian yang rusak di app.js

let bpSelectedPlatforms = new Set(['facebook']);
let bpGeneratingAI = false;

function pageBulkPost() {
  bpSelectedPlatforms = new Set(['facebook']);
  return `
    <div class="grid-2" style="align-items:start">
      <div>
        <div class="card">
          <div class="card-title">🎯 Platform Target</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            ${Object.entries(PLATFORMS).map(([k,p]) => `
              <div id="bp-platform-${k}" onclick="toggleBpPlatform('${k}')" 
                style="display:flex;align-items:center;gap:8px;padding:10px;border:1.5px solid ${bpSelectedPlatforms.has(k)?p.color:'#ddd'};border-radius:8px;cursor:pointer;background:${bpSelectedPlatforms.has(k)?p.bg:'#fff'};transition:all 0.1s">
                <input type="checkbox" value="${k}" ${bpSelectedPlatforms.has(k)?'checked':''} 
                  class="bp-platform-check" style="width:15px;height:15px;pointer-events:none">
                <span style="font-size:13px">${p.icon} ${p.label}</span>
              </div>
            `).join('')}
          </div>

          <div class="form-group">
            <label>Pilih Akun</label>
            <div id="bp-accounts" style="max-height:200px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
              ${renderBpAccounts(['facebook'])}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">📝 Konten Post</div>

          <!-- AI Caption Generator -->
          <div style="background:rgba(122,114,220,0.10);border-radius:8px;padding:12px;margin-bottom:12px">
            <div style="font-size:12px;font-weight:600;color:#7a72dc;margin-bottom:8px">🤖 Generate Caption dengan AI</div>
            <div class="form-group" style="margin-bottom:8px">
              <input type="text" id="bp-ai-topic" placeholder="Topik/produk: contoh 'Serum wajah anti aging'...">
            </div>
            <div style="display:flex;gap:6px">
              <select id="bp-ai-tone" style="flex:1;font-size:12px">
                <option value="casual">😊 Santai</option>
                <option value="persuasive">💪 Persuasif</option>
                <option value="informative">📚 Informatif</option>
                <option value="funny">😂 Lucu</option>
                <option value="emotional">😢 Emosional</option>
              </select>
              <button onclick="generateBpCaption()" id="bp-ai-btn"
                style="padding:8px 14px;background:#7F77DD;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:500;white-space:nowrap">
                🤖 Generate
              </button>
            </div>
          </div>

          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <label style="margin:0">Caption</label>
              <span id="bp-char-count" style="font-size:11px;color:#888">0/${PLATFORM_CHAR_LIMITS.facebook.text}</span>
            </div>
            <textarea id="bp-caption" placeholder="Tulis caption disini..." rows="5" 
              oninput="updateBpCharCount()" style="font-size:13px"></textarea>
          </div>

          <div class="form-group">
            <label>Media (Opsional)</label>
            <div id="bp-dropzone" 
              style="border:2px dashed #b3aef0;border-radius:8px;padding:30px;text-align:center;cursor:pointer;background:#FAFAFE;transition:all 0.2s"
              onclick="pickMediaFile()"
              ondragover="event.preventDefault();this.style.borderColor='#7F77DD';this.style.background='#F0EEFF'"
              ondragleave="this.style.borderColor='#b3aef0';this.style.background='#FAFAFE'"
              ondrop="handleBpDrop(event)">
              <div style="font-size:48px;color:#b3aef0">🖼️</div>
              <div style="font-size:13px;color:#666;margin-top:8px">Drag & drop gambar/video disini</div>
              <div style="font-size:11px;color:#999;margin-top:4px">atau klik untuk memilih file</div>
              <input type="hidden" id="bp-media">
            </div>
            <div id="bp-media-preview"></div>
          </div>

          <!-- Jadwal -->
          <div style="background:#f8f7ff;border:1px solid #e0deff;border-radius:8px;padding:12px;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:500">
                <input type="radio" name="bp-schedule" value="now" checked onchange="toggleBpSchedule(this)">
                🚀 Kirim Sekarang
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:500">
                <input type="radio" name="bp-schedule" value="later" onchange="toggleBpSchedule(this)">
                🕐 Jadwalkan
              </label>
            </div>
            <div id="bp-schedule-input" style="display:none">
              <input type="datetime-local" id="bp-scheduled-at"
                style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px"
                min="${new Date().toISOString().slice(0,16)}">
            </div>
          </div>

          <button class="btn btn-success" onclick="runBulkPost()" style="width:100%;padding:12px;font-size:14px" id="bp-btn">
            📢 Kirim ke Queue
          </button>
        </div>
      </div>

      <div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div class="card-title" style="margin:0">Preview & Log</div>
            <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" onclick="exportBulkPostReport()">📊 Export Excel</button>
          </div>

          <div style="margin-bottom:12px">
            <div style="font-size:12px;color:#666">Akun yang dipilih:</div>
            <div id="bp-preview-info" style="font-size:11px;color:#888;margin-top:4px">0 akun dipilih • Facebook</div>
          </div>

          <div id="bp-log" style="height:400px;overflow-y:auto;background:#f9f9f9;border-radius:8px;padding:12px;font-family:'Courier New',monospace;font-size:11px">
            <div style="color:#888">Log akan muncul disini saat proses berjalan...</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBpAccounts(platforms) {
  const filtered = oauthAccounts.filter(a => platforms.includes(a.platform) && a.is_active);

  if (!oauthAccounts.length) return `
    <div style="text-align:center;padding:20px;color:#888;font-size:12px">
      Belum ada akun OAuth — hubungkan dulu di halaman <b>Akun & User</b>
    </div>`;

  if (!filtered.length) return `
    <div style="text-align:center;padding:20px;color:#888;font-size:12px">
      Tidak ada akun terhubung untuk platform yang dipilih
    </div>`;

  return `
    <label style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;font-weight:600;border-bottom:1px solid rgba(0,0,0,0.1)">
      <input type="checkbox" style="width:16px;height:16px;cursor:pointer" onclick="toggleBpAll(this)">
      <span style="font-size:12px">Semua (${filtered.length})</span>
    </label>
    ${filtered.map(a => {
      const p = PLATFORMS[a.platform];
      return `
        <label style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid rgba(0,0,0,0.05);cursor:pointer">
          <input type="checkbox" value="${a.id}" class="bp-check" onclick="updateBpPreview()" style="width:16px;height:16px;cursor:pointer">
          <div class="avatar" style="background:${p?.color||'#888'};width:28px;height:28px;font-size:11px;flex-shrink:0">
            ${(a.username||'?')[0].toUpperCase()}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.username}</div>
            <div style="font-size:10px;color:#888">${p?.icon||''} ${p?.label||a.platform}</div>
          </div>
        </label>`;
    }).join('')}`;
}

function toggleBpAll(checkbox) {
  document.querySelectorAll('.bp-check').forEach(c => c.checked = checkbox.checked);
  updateBpPreview();
}

function toggleBpPlatform(platform) {
  if (bpSelectedPlatforms.has(platform)) {
    bpSelectedPlatforms.delete(platform);
  } else {
    bpSelectedPlatforms.add(platform);
  }
  
  // Update UI
  const el = document.getElementById(`bp-platform-${platform}`);
  if (el) {
    const p = PLATFORMS[platform];
    el.style.borderColor = bpSelectedPlatforms.has(platform) ? p.color : '#ddd';
    el.style.background = bpSelectedPlatforms.has(platform) ? p.bg : '#fff';
    const checkbox = el.querySelector('.bp-platform-check');
    if (checkbox) checkbox.checked = bpSelectedPlatforms.has(platform);
  }
  
  // Update accounts list
  const accountsDiv = document.getElementById('bp-accounts');
  if (accountsDiv) {
    accountsDiv.innerHTML = renderBpAccounts([...bpSelectedPlatforms]);
  }
  
  updateBpPreview();
}

function updateBpPreview() {
  const checked = [...document.querySelectorAll('.bp-check:checked')].length;
  const platforms = [...bpSelectedPlatforms].map(p => PLATFORMS[p]?.label).join(', ');
  const info = document.getElementById('bp-preview-info');
  if (info) info.textContent = `${checked} akun dipilih • ${platforms || 'belum ada platform'}`;
}

function updateBpCharCount() {
  const textarea = document.getElementById('bp-caption');
  const count = document.getElementById('bp-char-count');
  if (!textarea || !count) return;
  
  const length = textarea.value.length;
  const platform = [...bpSelectedPlatforms][0] || 'facebook';
  const limit = PLATFORM_CHAR_LIMITS[platform]?.text || 63206;
  
  count.textContent = `${length}/${limit}`;
  count.style.color = length > limit ? '#dc3545' : '#888';
}

async function pickMediaFile() {
  const file = await window.api.pickFile();
  if (!file) return;
  await uploadAndPreviewMedia(file.path, file.path.split('\\').pop(), file.type, file.size);
}

function handleBpDrop(event) {
  event.preventDefault();
  document.getElementById('bp-dropzone').style.borderColor = '#b3aef0';
  document.getElementById('bp-dropzone').style.background  = '#FAFAFE';
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const videoExts = ['.mp4', '.mov', '.avi', '.webm'];
  const ext  = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const type = videoExts.includes(ext) ? 'video' : 'image';
  uploadAndPreviewMedia(file.path, file.name, type, file.size);
}

async function uploadAndPreviewMedia(filePath, fileName, type, size) {
  // Tampilkan status upload
  const preview = document.getElementById('bp-media-preview');
  const dropzone = document.getElementById('bp-dropzone');
  if (dropzone) dropzone.style.display = 'none';
  if (preview) preview.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f0eeff;border-radius:8px">
      <span style="font-size:22px">⏳</span>
      <div style="flex:1;font-size:12px;color:#7a72dc">Mengupload ke Supabase Storage...</div>
    </div>`;

  const result = await window.api.uploadMedia(filePath);

  if (!result.success) {
    if (preview) preview.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#ffebee;border-radius:8px">
        <span style="font-size:22px">❌</span>
        <div style="flex:1;font-size:12px;color:#c62828">${result.error}</div>
        <button onclick="clearBpMedia()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#888">×</button>
      </div>`;
    if (dropzone) dropzone.style.display = 'block';
    return;
  }

  // Simpan URL publik di hidden input
  document.getElementById('bp-media').value = result.url;
  showMediaPreview(fileName, type, size);
}

function handleBpDrop(event) {
  event.preventDefault();
  document.getElementById('bp-dropzone').style.borderColor = '#b3aef0';
  document.getElementById('bp-dropzone').style.background = '#FAFAFE';
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const videoExts = ['.mp4', '.mov', '.avi', '.webm'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const type = videoExts.includes(ext) ? 'video' : 'image';
  document.getElementById('bp-media').value = file.path;
  showMediaPreview(file.name, type, file.size);
}

function handleBpFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  const videoExts = ['.mp4', '.mov', '.avi', '.webm'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const type = videoExts.includes(ext) ? 'video' : 'image';
  showMediaPreview(file.name, type, file.size);
}

function showMediaPreview(name, type, size) {
  const icon = type === 'video' ? '🎥' : '🖼️';
  const sizeText = size ? ` • ${(size/1024/1024).toFixed(1)}MB` : '';
  document.getElementById('bp-media-preview').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#EAF3DE;border-radius:8px">
      <span style="font-size:28px">${icon}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500;color:#3B6D11">${name}</div>
        <div style="font-size:11px;color:#888">${type === 'video' ? 'Video' : 'Gambar'}${sizeText}</div>
      </div>
      <button onclick="clearBpMedia()" style="background:none;border:none;cursor:pointer;font-size:20px;color:#888;padding:4px">×</button>
    </div>
  `;
  document.getElementById('bp-dropzone').style.display = 'none';
}

function clearBpMedia() {
  document.getElementById('bp-media').value = '';
  document.getElementById('bp-media-preview').innerHTML = '';
  document.getElementById('bp-dropzone').style.display = 'block';
}

async function generateBpCaption() {
  const topic = document.getElementById('bp-ai-topic').value.trim();
  if (!topic) {
    alert('Masukkan topik terlebih dahulu!');
    return;
  }

  const tone = document.getElementById('bp-ai-tone').value;
  const btn = document.getElementById('bp-ai-btn');
  const originalText = btn.textContent;
  
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';
  bpGeneratingAI = true;

  try {
    // Simulasi AI generation (bisa diganti dengan API nyata)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const tones = {
      casual: 'Hai guys! Coba liat nih...',
      persuasive: 'Jangan lewatkan kesempatan ini!',
      informative: 'Berikut adalah informasi penting:',
      funny: 'WKWKWK liat ini deh!',
      emotional: 'Ini bikin hati terharu...'
    };
    
    const generated = `${tones[tone]} ${topic}. Cocok banget buat kamu! Jangan sampai kelewatan ya. #${topic.replace(/\s+/g, '')}`;
    
    document.getElementById('bp-caption').value = generated;
    updateBpCharCount();
    
    // Add to log
    addBpLog('🤖 AI caption generated successfully!', 'success');
    
  } catch (err) {
    addBpLog(`❌ Failed to generate: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    bpGeneratingAI = false;
  }
}

function addBpLog(message, type = 'info') {
  const logDiv = document.getElementById('bp-log');
  if (!logDiv) return;
  
  const entry = document.createElement('div');
  entry.style.marginBottom = '6px';
  entry.style.padding = '4px 8px';
  entry.style.borderRadius = '4px';
  entry.style.background = type === 'error' ? '#FFEBEE' : type === 'success' ? '#E8F5E9' : '#E3F2FD';
  entry.style.color = type === 'error' ? '#C62828' : type === 'success' ? '#2E7D32' : '#1565C0';
  entry.style.fontSize = '11px';
  entry.style.fontFamily = "'Courier New', monospace";
  
  const timestamp = new Date().toLocaleTimeString('id-ID', { hour12: false });
  entry.textContent = `[${timestamp}] ${message}`;
  
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function toggleBpSchedule(radio) {
  const input = document.getElementById('bp-schedule-input');
  if (input) input.style.display = radio.value === 'later' ? 'block' : 'none';
}

async function runBulkPost() {
  const caption = document.getElementById('bp-caption').value.trim();
  if (!caption) { alert('Caption tidak boleh kosong!'); return; }

  const selectedIds = [...document.querySelectorAll('.bp-check:checked')].map(c => c.value);
  if (!selectedIds.length) { alert('Pilih minimal 1 akun!'); return; }

  const scheduleMode  = document.querySelector('input[name="bp-schedule"]:checked')?.value || 'now';
  const scheduledAt   = scheduleMode === 'later'
    ? document.getElementById('bp-scheduled-at')?.value || null
    : null;
  if (scheduleMode === 'later' && !scheduledAt) { alert('Pilih waktu jadwal terlebih dahulu!'); return; }

  const mediaUrl = document.getElementById('bp-media').value.trim();
  const mediaUrls = mediaUrl ? [mediaUrl] : [];

  const btn = document.getElementById('bp-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Mengirim ke queue...';

  const logDiv = document.getElementById('bp-log');
  if (logDiv) logDiv.innerHTML = '';
  addBpLog(`🚀 Mengirim ke ${selectedIds.length} akun...`, 'info');

  const result = await window.api.submitBulkPost({
    content: caption,
    mediaUrls,
    accountIds: selectedIds,
    scheduledAt,
  });

  btn.disabled = false;
  btn.textContent = '📢 Kirim ke Queue';

  if (!result.success) {
    addBpLog(`❌ ${result.error}`, 'error');
    return;
  }

  // Tampilkan hasil per akun
  for (const r of result.results || []) {
    const p = PLATFORMS[r.platform];
    if (r.success) {
      const msg = scheduledAt
        ? `📅 Dijadwalkan: ${p?.icon} ${r.username} (${new Date(scheduledAt).toLocaleString('id-ID')})`
        : `✅ Job dikirim: ${p?.icon} ${r.username} — Job ID: ${r.jobId}`;
      addBpLog(msg, 'success');
    } else {
      addBpLog(`❌ ${p?.icon} ${r.username}: ${r.error}`, 'error');
    }
  }

  const ok   = result.results?.filter(r => r.success).length || 0;
  const fail = result.results?.filter(r => !r.success).length || 0;
  addBpLog(`Selesai — ${ok} berhasil, ${fail} gagal`, 'info');
}

async function exportBulkPostReport() {
  if (!bulkPostResults.length) { alert('Belum ada data. Jalankan bulk post dulu.'); return; }
  const result = await window.api.exportBulkPostReport(bulkPostResults);
  alert(result.success ? `✅ ${result.message}` : `❌ ${result.error}`);
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
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div class="card-title" style="margin:0">Preview & Log</div>
            <button class="btn-secondary" style="font-size:12px" onclick="openScreenshotFolder()">
              📁 Buka Folder Screenshot
            </button>
          </div>
          <div style="font-size:12px;color:#888;margin-bottom:8px" id="amp-preview">Pilih platform, URL, aksi, dan akun</div>
          <div style="font-size:11px;color:#1D9E75;margin-bottom:8px;padding:6px;background:#EAF3DE;border-radius:6px">
            📸 Screenshot otomatis disimpan di: Desktop/SMM-Pro-Screenshots/[tanggal]/
          </div>
          <div class="log-box" id="live-log" style="height:400px"><div style="color:#555">Menunggu...</div></div>
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

function updateWuAccounts() {
  const platform = document.getElementById('wu-platform').value;
  const accountsDiv = document.getElementById('wu-accounts');
  if (accountsDiv) {
    accountsDiv.innerHTML = renderWuAccounts(platform);
  }
}

function renderWuAccounts(platform) {
  const accs = accounts.filter(a => (a.accountType === 'browser' || !a.accountType) && a.platform === platform);
  if (!accs.length) return `<div style="color:#aaa;font-size:12px">Belum ada akun browser untuk platform ini.</div>`;
  
  return `
    <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer;font-weight:600;border-bottom:1px solid rgba(0,0,0,0.05);margin-bottom:4px">
      <input type="checkbox" style="width:15px;height:15px" onchange="toggleWuAll(this)">
      <span style="font-size:12px">Semua Akun (${accs.length})</span>
    </label>
  ` + accs.map(a => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer">
      <input type="checkbox" value="${a.id}" class="wu-check" style="width:15px;height:15px">
      <span style="font-size:12px">${a.username}</span>
    </label>
  `).join('');
}

function toggleWuAll(checkbox) {
  document.querySelectorAll('.wu-check').forEach(c => c.checked = checkbox.checked);
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

  // Rebuild HTML live log dari state liveLogs[]
  const liveLogHTML = liveLogs.length === 0
    ? '<div style="color:#555">Menunggu...</div>'
    : liveLogs.map(log => 
        `<div class="log-entry log-${log.type}">[${log.timestamp}] ${log.message}</div>`
      ).join('');
  
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
            <label>Target URL (Opsional: untuk Auto Reply & Scrape)</label>
            <textarea id="auto-urls" rows="2" placeholder="https://www.facebook.com/groups/..."></textarea>
          </div>
          <div class="form-group">
            <label>Pilih Akun (Browser/Password)</label>
            <div id="auto-accounts" style="max-height:150px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px">
              ${renderAutoAccounts('facebook')}
            </div>
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
          
          ${isRunning 
            ? `<button class="btn btn-danger" id="auto-btn" style="width:100%;padding:10px" onclick="stopAutomationFromUI()">⏹ Hentikan Automasi</button>`
            : `<button class="btn btn-success" id="auto-btn" style="width:100%;padding:10px" onclick="runAutomation()">🤖 Mulai Automasi</button>`
          }
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">
            Live Log 
            ${liveLogs.length > 0 ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;float:right" onclick="clearLiveLog()">🗑 Clear</button>` : ''}
          </div>
          <div class="log-box" id="live-log" style="height:500px">${liveLogHTML}</div>
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
  const accountsDiv = document.getElementById('auto-accounts');
  if (accountsDiv) {
    accountsDiv.innerHTML = renderAutoAccounts(platform);
  }
}

function renderAutoAccounts(platform) {
  const accs = accounts.filter(a => (a.accountType === 'browser' || !a.accountType) && a.platform === platform);
  if (!accs.length) return `<div style="color:#aaa;font-size:12px">Belum ada akun browser untuk platform ini.</div>`;
  
  return `
    <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer;font-weight:600;border-bottom:1px solid rgba(0,0,0,0.05);margin-bottom:4px">
      <input type="checkbox" style="width:15px;height:15px" onchange="toggleAutoAll(this)">
      <span style="font-size:12px">Semua Akun (${accs.length})</span>
    </label>
  ` + accs.map(a => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer">
      <input type="checkbox" value="${a.id}" class="auto-check" style="width:15px;height:15px">
      <span style="font-size:12px">${a.username}</span>
    </label>
  `).join('');
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

function toggleAutoAll(checkbox) {
  document.querySelectorAll('.auto-check').forEach(c => c.checked = checkbox.checked);
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

  if (!selectedIds.length) { alert('Pilih minimal 1 akun!'); return; }
  if (!actions.length) { alert('Pilih minimal 1 aksi!'); return; }

  const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id));

  setRunning(true);
  // Re-render halaman supaya tombol berubah jadi "Hentikan"
  if (currentPage === 'automation') go('automation');

  await window.api.startAutomation({
    accounts: selectedAccounts, platform,
    actions, targetUrls, durationPerAccount: duration,
    commentTemplates: commentTemplates.length ? commentTemplates : ['Bagus!'],
    mode: 'automation'
  });

  setRunning(false);
  // Re-render halaman supaya tombol kembali jadi "Mulai"
  if (currentPage === 'automation') go('automation');
}

function clearLiveLog() {
  if (!confirm('Hapus semua log dari Live Log?')) return;
  liveLogs = [];
  const box = document.getElementById('live-log');
  if (box) box.innerHTML = '<div style="color:#555">Menunggu...</div>';
  // Rebuild header (sembunyikan tombol Clear)
  if (currentPage === 'automation') go('automation');
}

async function stopAutomationFromUI() {
  if (!confirm('Hentikan automasi yang sedang berjalan?')) return;
  try {
    if (window.api.stopAutomation) {
      await window.api.stopAutomation();
    }
    setRunning(false);
    // Re-render halaman supaya tombol kembali jadi Start
    if (currentPage === 'automation') go('automation');
  } catch (e) {
    alert('Gagal menghentikan: ' + e.message);
  }
}

// ─── LOGS ──────────────────────────────────────────────────────────────────
function pageLogs() {
  const successCount = logs.filter(l => l.type === 'success').length;
  const errorCount   = logs.filter(l => l.type === 'error').length;
  const warnCount    = logs.filter(l => l.type === 'warn').length;

  return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="card-title" style="margin:0">Log Aktivitas</div>
          <span class="badge badge-neutral">${logs.length} entri</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-success">${successCount} sukses</span>
          <span class="badge badge-error">${errorCount} gagal</span>
          ${warnCount > 0 ? `<span class="badge badge-warn">${warnCount} warn</span>` : ''}
          <button class="btn btn-secondary" style="font-size:11.5px;padding:4px 11px" onclick="clearLogs()">🗑 Hapus</button>
        </div>
      </div>
      <div class="log-box" style="height:calc(100vh - 200px);min-height:380px">
        ${logs.slice(0,500).map(l => {
          const ts = l.timestamp ? new Date(l.timestamp).toLocaleString('id-ID') : '--';
          return `<div class="log-entry log-${l.type}">[${ts}]  ${l.message}</div>`;
        }).join('') || '<div style="color:#3d4454;padding:8px 0;font-size:12px">Belum ada log aktivitas.</div>'}
      </div>
    </div>`;
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
        <div class="card-title">⚙️ Automasi Browser</div>

        <div class="form-group">
          <label>Mode Browser</label>
          <select id="s-headless">
            <option value="false" ${!settings.headless?'selected':''}>👁 Tampilkan Browser (Visible)</option>
            <option value="true"  ${settings.headless?'selected':''}>🕶 Sembunyikan Browser (Headless)</option>
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
        <div class="grid-2">
          <div class="form-group">
            <label>Istirahat antar Akun (dtk)</label>
            <input type="number" id="s-rest" value="${settings.restBetweenAccounts||30}" min="5">
          </div>
          <div class="form-group">
            <label>Maks Aksi / Jam</label>
            <input type="number" id="s-max" value="${settings.maxActionsPerHour||30}" min="5">
          </div>
        </div>
        <div class="form-group">
          <label>Maks Akun Bersamaan</label>
          <input type="number" id="s-concurrent" value="${settings.maxConcurrent||1}" min="1" max="20">
        </div>

        <!-- Safety tips -->
        <div style="background:var(--c-success-bg);border-radius:var(--r-sm);padding:12px 14px;margin-top:4px">
          <div style="font-size:11.5px;font-weight:600;color:var(--c-success);margin-bottom:6px">Tips Keamanan</div>
          <div style="font-size:11.5px;color:#1a5c35;line-height:1.9">
            ✓ Jeda min 5 detik antar aksi<br>
            ✓ Maks 30 aksi per jam per akun<br>
            ✓ Variasi aksi agar terlihat natural<br>
            ✓ Gunakan akun aktif minimal 1 bulan
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🌐 Koneksi Backend</div>
        <div class="form-group">
          <label>URL Backend</label>
          <input type="text" id="s-api" value="${settings.apiUrl||'https://smm-pro-faza.onrender.com'}">
        </div>
        <div class="form-group">
          <label>Gemini API Key <span style="font-size:10px;color:var(--c-text-3);text-transform:none;font-weight:400">(AI Caption &amp; Komentar)</span></label>
          <input type="password" id="s-gemini" value="${settings.geminiApiKey||''}" placeholder="AIza...">
          <div style="font-size:11px;color:var(--c-text-3);margin-top:5px">Dapatkan di aistudio.google.com</div>
        </div>

        <div style="background:var(--c-info-bg);border-radius:var(--r-sm);padding:12px 14px;margin-top:4px">
          <div style="font-size:11.5px;color:var(--c-info);line-height:1.7">
            💡 Hubungkan ke SMM Pro backend untuk menggunakan token akun yang sudah disimpan di web
          </div>
        </div>
      </div>
    </div>

    <!-- Kredensial API (untuk OAuth & Worker) -->
    <div class="card" style="border-left:3px solid #7a72dc;margin-top:0">
      <div class="card-title">🔐 Kredensial API</div>
      <div style="font-size:12px;color:var(--c-text-3);margin-bottom:14px">
        Isi sekali — dipakai untuk OAuth "Hubungkan Akun" dan worker posting otomatis.
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>Supabase URL</label>
          <input type="text" id="s-supa-url" value="${settings.supabaseUrl||''}" placeholder="https://xxx.supabase.co">
        </div>
        <div class="form-group">
          <label>Supabase Service Key</label>
          <input type="password" id="s-supa-key" value="${settings.supabaseKey||''}" placeholder="eyJhbGci...">
        </div>
      </div>

      <div class="form-group">
        <label>Token Encryption Key <span style="font-size:10px;color:var(--c-text-3);text-transform:none;font-weight:400">(hex 64 karakter — sama dengan worker)</span></label>
        <input type="password" id="s-enc-key" value="${settings.encryptionKey||''}" placeholder="043104693b...">
      </div>

      <div class="form-group">
        <label>Upstash Redis URL <span style="font-size:10px;color:var(--c-text-3);text-transform:none;font-weight:400">(sama dengan UPSTASH_REDIS_URL di worker/.env)</span></label>
        <input type="password" id="s-redis-url" value="${settings.upstashRedisUrl||''}" placeholder="rediss://default:...@....upstash.io:6379">
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>Facebook App ID</label>
          <input type="text" id="s-fb-id" value="${settings.fbAppId||''}" placeholder="1234567890">
        </div>
        <div class="form-group">
          <label>Facebook App Secret</label>
          <input type="password" id="s-fb-secret" value="${settings.fbAppSecret||''}" placeholder="abcdef...">
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>Twitter Client ID</label>
          <input type="text" id="s-tw-id" value="${settings.twClientId||''}" placeholder="xxxx...">
        </div>
        <div class="form-group">
          <label>Twitter Client Secret</label>
          <input type="password" id="s-tw-secret" value="${settings.twClientSecret||''}" placeholder="xxxx...">
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>TikTok Client Key</label>
          <input type="text" id="s-tt-key" value="${settings.tiktokClientKey||''}" placeholder="awxxxxxx">
        </div>
        <div class="form-group">
          <label>TikTok Client Secret</label>
          <input type="password" id="s-tt-secret" value="${settings.tiktokClientSecret||''}" placeholder="xxxx...">
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>YouTube Client ID</label>
          <input type="text" id="s-yt-id" value="${settings.ytClientId||''}" placeholder="xxxx.apps.googleusercontent.com">
        </div>
        <div class="form-group">
          <label>YouTube Client Secret</label>
          <input type="password" id="s-yt-secret" value="${settings.ytClientSecret||''}" placeholder="GOCSPX-...">
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>Threads App ID</label>
          <input type="text" id="s-th-id" value="${settings.threadsAppId||''}" placeholder="123456789">
        </div>
        <div class="form-group">
          <label>Threads App Secret</label>
          <input type="password" id="s-th-secret" value="${settings.threadsAppSecret||''}" placeholder="xxxx...">
        </div>
      </div>

      <div style="background:var(--c-info-bg);border-radius:var(--r-sm);padding:10px 12px;font-size:11.5px;color:var(--c-info)">
        💡 Nilai-nilai ini sama dengan yang ada di <code>worker/.env</code>
      </div>
    </div>

    <button class="btn btn-primary" onclick="saveSettings()"
      style="width:100%;padding:11px;font-size:13px;border-radius:var(--r-sm)">
      💾 Simpan Pengaturan
    </button>`;
}

async function saveSettings() {
  settings = {
    headless: document.getElementById('s-headless').value === 'true',
    delayMin: parseInt(document.getElementById('s-delay-min').value),
    delayMax: parseInt(document.getElementById('s-delay-max').value),
    restBetweenAccounts: parseInt(document.getElementById('s-rest').value),
    maxActionsPerHour: parseInt(document.getElementById('s-max').value),
    maxConcurrent: parseInt(document.getElementById('s-concurrent').value),
    apiUrl: document.getElementById('s-api').value.trim(),
    geminiApiKey: document.getElementById('s-gemini').value.trim(),
    supabaseUrl:   document.getElementById('s-supa-url').value.trim(),
    supabaseKey:   document.getElementById('s-supa-key').value.trim(),
    encryptionKey: document.getElementById('s-enc-key').value.trim(),
    fbAppId:          document.getElementById('s-fb-id').value.trim(),
    fbAppSecret:      document.getElementById('s-fb-secret').value.trim(),
    twClientId:       document.getElementById('s-tw-id').value.trim(),
    twClientSecret:   document.getElementById('s-tw-secret').value.trim(),
    tiktokClientKey:  document.getElementById('s-tt-key').value.trim(),
    tiktokClientSecret: document.getElementById('s-tt-secret').value.trim(),
    ytClientId:       document.getElementById('s-yt-id').value.trim(),
    ytClientSecret:   document.getElementById('s-yt-secret').value.trim(),
    threadsAppId:     document.getElementById('s-th-id').value.trim(),
    threadsAppSecret: document.getElementById('s-th-secret').value.trim(),
    upstashRedisUrl:  document.getElementById('s-redis-url').value.trim(),
  };
  await window.api.saveSettings(settings);

  // Kirim kredensial OAuth ke main process
  if (settings.supabaseUrl && settings.supabaseKey && settings.encryptionKey) {
    await window.api.saveOAuthCredentials({
      supabaseUrl:   settings.supabaseUrl,
      supabaseKey:   settings.supabaseKey,
      encryptionKey: settings.encryptionKey,
    });
  }

  alert('✅ Pengaturan tersimpan!');
}
// ── OAuth ──────────────────────────────────────────────────────────────────
async function connectFacebook() {
  const result = await window.api.connectFacebook();
  if (!result.success) alert(`❌ ${result.error}\n\nIsi dulu di menu Pengaturan → Kredensial API.`);
}

async function connectTwitter() {
  const result = await window.api.connectTwitter();
  if (!result.success) alert(`❌ ${result.error}\n\nIsi dulu di menu Pengaturan → Kredensial API.`);
}

async function connectTikTok() {
  const result = await window.api.connectTikTok();
  if (!result.success) alert(`❌ ${result.error}\n\nIsi dulu di menu Pengaturan → Kredensial API.`);
}

async function connectYoutube() {
  const result = await window.api.connectYoutube();
  if (!result.success) alert(`❌ ${result.error}\n\nIsi dulu di menu Pengaturan → Kredensial API.`);
}

async function connectThreads() {
  const result = await window.api.connectThreads();
  if (!result.success) alert(`❌ ${result.error}\n\nIsi dulu di menu Pengaturan → Kredensial API.`);
}

async function removeOAuthAccount(id) {
  if (!confirm('Lepas akun ini dari SMM Pro?')) return;
  await window.api.deleteOAuthAccount(id);
  oauthAccounts = oauthAccounts.filter(a => a.id !== id);
  go('accounts');
}

function showForm(id) {
  const el = document.getElementById(id); 
  if (el) el.style.display = 'block'; 
}

function hideForm(id) { 
  const el = document.getElementById(id); 
  if (el) el.style.display = 'none'; 
}

function toggleForm(id) { 
  const el = document.getElementById(id); 
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; 
}

