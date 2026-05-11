const https = require('https');
const http = require('http');

// 25+ platform definitions inspired by Sherlock & GhostTrack
const PLATFORMS = [
  { id: 'github',     name: 'GitHub',      icon: '🐙', url: 'https://github.com/{u}',                         cat: 'Dev' },
  { id: 'reddit',     name: 'Reddit',      icon: '🔴', url: 'https://www.reddit.com/user/{u}',                 cat: 'Forum' },
  { id: 'instagram',  name: 'Instagram',   icon: '📸', url: 'https://www.instagram.com/{u}/',                  cat: 'Social' },
  { id: 'twitter',    name: 'Twitter/X',   icon: '🐦', url: 'https://twitter.com/{u}',                         cat: 'Social' },
  { id: 'tiktok',     name: 'TikTok',      icon: '🎵', url: 'https://www.tiktok.com/@{u}',                     cat: 'Social' },
  { id: 'youtube',    name: 'YouTube',     icon: '▶️', url: 'https://www.youtube.com/@{u}',                    cat: 'Video' },
  { id: 'threads',    name: 'Threads',     icon: '🧵', url: 'https://www.threads.net/@{u}',                    cat: 'Social' },
  { id: 'linkedin',   name: 'LinkedIn',    icon: '💼', url: 'https://www.linkedin.com/in/{u}',                 cat: 'Professional' },
  { id: 'pinterest',  name: 'Pinterest',   icon: '📌', url: 'https://www.pinterest.com/{u}/',                  cat: 'Social' },
  { id: 'twitch',     name: 'Twitch',      icon: '🎮', url: 'https://www.twitch.tv/{u}',                       cat: 'Video' },
  { id: 'snapchat',   name: 'Snapchat',    icon: '👻', url: 'https://www.snapchat.com/add/{u}',                cat: 'Social' },
  { id: 'telegram',   name: 'Telegram',    icon: '✈️', url: 'https://t.me/{u}',                                cat: 'Messaging' },
  { id: 'tumblr',     name: 'Tumblr',      icon: '📝', url: 'https://{u}.tumblr.com',                          cat: 'Blog' },
  { id: 'medium',     name: 'Medium',      icon: '📰', url: 'https://medium.com/@{u}',                         cat: 'Blog' },
  { id: 'soundcloud', name: 'SoundCloud',  icon: '🎧', url: 'https://soundcloud.com/{u}',                      cat: 'Music' },
  { id: 'spotify',    name: 'Spotify',     icon: '🟢', url: 'https://open.spotify.com/user/{u}',               cat: 'Music' },
  { id: 'vimeo',      name: 'Vimeo',       icon: '🎬', url: 'https://vimeo.com/{u}',                           cat: 'Video' },
  { id: 'behance',    name: 'Behance',     icon: '🎨', url: 'https://www.behance.net/{u}',                     cat: 'Design' },
  { id: 'dribbble',   name: 'Dribbble',    icon: '🏀', url: 'https://dribbble.com/{u}',                        cat: 'Design' },
  { id: 'steam',      name: 'Steam',       icon: '🕹️', url: 'https://steamcommunity.com/id/{u}',               cat: 'Gaming' },
  { id: 'quora',      name: 'Quora',       icon: '❓', url: 'https://www.quora.com/profile/{u}',               cat: 'Forum' },
  { id: 'flickr',     name: 'Flickr',      icon: '📷', url: 'https://www.flickr.com/people/{u}',               cat: 'Photo' },
  { id: 'deviantart', name: 'DeviantArt',  icon: '🖼️', url: 'https://www.deviantart.com/{u}',                  cat: 'Design' },
  { id: 'vk',         name: 'VK',          icon: '🌐', url: 'https://vk.com/{u}',                              cat: 'Social' },
  { id: 'ask',        name: 'Ask.fm',      icon: '💬', url: 'https://ask.fm/{u}',                              cat: 'Social' },
];

function checkUrl(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    let done = false;

    const finish = (result) => {
      if (!done) { done = true; resolve(result); }
    };

    const timer = setTimeout(() => finish({ status: 0, error: 'timeout' }), timeoutMs);

    try {
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        timeout: timeoutMs,
      }, (res) => {
        clearTimeout(timer);
        let status = res.statusCode;
        const location = res.headers.location || '';

        // Redirect to login/signup = user likely doesn't exist
        if (status >= 300 && status < 400) {
          const isAuthWall = /login|signup|accounts\/login|challenge|register/i.test(location);
          status = isAuthWall ? 404 : 200;
        }

        res.resume();
        finish({ status });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        finish({ status: 0, error: err.message });
      });
    } catch (err) {
      clearTimeout(timer);
      finish({ status: 0, error: err.message });
    }
  });
}

function mapStatus(httpStatus) {
  if (httpStatus === 200)                      return 'found';
  if (httpStatus === 404)                      return 'not_found';
  if (httpStatus === 403 || httpStatus === 401) return 'protected';
  if (httpStatus === 0)                        return 'error';
  return 'unknown';
}

async function huntUsername(config, onProgress) {
  const { username } = config;
  if (!username || !username.trim()) throw new Error('Username tidak boleh kosong');

  const u = username.trim().replace(/^@/, '');
  onProgress({ type: 'info', message: `🕵️ Mencari "${u}" di ${PLATFORMS.length} platform secara paralel...` });

  // Run all checks in parallel batches of 6
  const results = [];
  const batchSize = 6;

  for (let i = 0; i < PLATFORMS.length; i += batchSize) {
    const batch = PLATFORMS.slice(i, i + batchSize);
    const batchRes = await Promise.all(batch.map(async (p) => {
      const url = p.url.replace(/{u}/g, u);
      const { status, error } = await checkUrl(url);
      const statusLabel = mapStatus(status);

      const emoji = { found: '✅', not_found: '❌', protected: '🔒', error: '⚠️', unknown: '❓' }[statusLabel] || '❓';
      onProgress({
        type: statusLabel === 'found' ? 'success' : 'info',
        message: `${emoji} ${p.name} (${p.cat}): ${
          statusLabel === 'found' ? 'Ditemukan' :
          statusLabel === 'not_found' ? 'Tidak ada' :
          statusLabel === 'protected' ? 'Diproteksi' :
          statusLabel === 'error' ? `Error${error ? ': ' + error : ''}` : 'Tidak diketahui'
        }`,
      });

      return { platform: p.name, icon: p.icon, cat: p.cat, url, status: statusLabel, httpCode: status };
    }));
    results.push(...batchRes);
  }

  const found     = results.filter(r => r.status === 'found').length;
  const notFound  = results.filter(r => r.status === 'not_found').length;
  const other     = results.length - found - notFound;

  onProgress({ type: 'success', message: `🎉 Selesai! ✅ ${found} ditemukan | ❌ ${notFound} tidak ada | ⚠️ ${other} tidak pasti` });

  return { success: true, username: u, results, summary: { found, notFound, other, total: results.length } };
}

module.exports = { huntUsername, PLATFORMS };
