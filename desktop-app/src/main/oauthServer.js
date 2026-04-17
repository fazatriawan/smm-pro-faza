// src/main/oauthServer.js
// Local HTTP server — tangkap callback OAuth dari browser
const http = require('http');

const PORT = 42813;
let server = null;
const pending = {};   // { platform: callbackFn }

function startOAuthServer(mainWindow) {
  if (server) return;

  server = http.createServer(async (req, res) => {
    const url   = new URL(req.url, `http://localhost:${PORT}`);
    const parts = url.pathname.split('/').filter(Boolean); // ['oauth', 'facebook', 'callback']

    if (parts[0] !== 'oauth' || parts[2] !== 'callback') {
      res.writeHead(404); res.end('Not found'); return;
    }

    const platform = parts[1];
    const code     = url.searchParams.get('code');
    const error    = url.searchParams.get('error');
    console.log(`[OAuth Callback] platform=${platform} code=${code ? code.substring(0,10)+'...' : 'null'} error=${error} error_description=${url.searchParams.get('error_description')}`);

    if (error || !code) {
      const msg = url.searchParams.get('error_description') || error || 'Tidak ada code';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage('❌ Koneksi Gagal', msg, false));
      mainWindow?.webContents.send('oauth-result', { platform, success: false, error: msg });
      return;
    }

    if (!pending[platform]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage('❌ Sesi Kedaluwarsa', 'Coba hubungkan ulang dari SMM Pro.', false));
      return;
    }

    try {
      const result = await pending[platform](code);
      delete pending[platform];
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage(
        '✅ Berhasil Terhubung!',
        `${result.accounts.length} akun berhasil ditambahkan. Kembali ke SMM Pro.`,
        true
      ));
      mainWindow?.webContents.send('oauth-result', { platform, success: true, accounts: result.accounts });
    } catch (err) {
      delete pending[platform];
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage('❌ Koneksi Gagal', err.message, false));
      mainWindow?.webContents.send('oauth-result', { platform, success: false, error: err.message });
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[OAuthServer] Listening on http://localhost:${PORT}`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.warn(`[OAuthServer] Port ${PORT} sudah dipakai, skip.`);
  });
}

function setPending(platform, fn) { pending[platform] = fn; }

function htmlPage(title, message, success) {
  const color = success ? '#22c55e' : '#ef4444';
  const icon  = success ? '✅' : '❌';
  return `<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>${title}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:system-ui,sans-serif;background:#f0eff8;min-height:100vh;display:flex;align-items:center;justify-content:center}
      .card{background:#fff;border-radius:16px;padding:40px 48px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.12);max-width:420px;width:90%}
      .icon{font-size:48px;margin-bottom:16px}
      h2{font-size:20px;color:${color};margin-bottom:10px}
      p{font-size:14px;color:#555;line-height:1.6}
      .note{margin-top:20px;font-size:12px;color:#aaa}
    </style>
  </head><body><div class="card">
    <div class="icon">${icon}</div>
    <h2>${title}</h2>
    <p>${message}</p>
    <p class="note">Tutup tab ini dan kembali ke SMM Pro.</p>
  </div></body></html>`;
}

module.exports = { startOAuthServer, setPending, PORT };
