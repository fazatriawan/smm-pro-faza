const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'SMM-Pro-Desktop/1.0',
        'Accept': 'application/json',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} dari ${url}`));
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Respons bukan JSON valid')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── OPENVERSE (Gratis, TANPA daftar API) ──────────────────────────────────
// Powered by WordPress Foundation — CC-licensed media from Wikipedia, Flickr, dll

async function searchOpenverse(query, page = 1, perPage = 20) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${perPage}&page=${page}&license_type=commercial,modification`;
  const data = await fetchJson(url, {
    'User-Agent': 'SMM-Pro-Desktop/1.0 (educational-non-commercial)',
  });
  if (!data.results) throw new Error('Respons Openverse tidak valid');
  return {
    total: data.result_count || 0,
    items: data.results.map(p => ({
      id: p.id,
      source: 'openverse',
      thumb: p.thumbnail || p.url,
      regular: p.url,
      full: p.url,
      download: p.url,
      author: p.creator || 'Unknown',
      authorUrl: p.creator_url || '',
      pageUrl: p.foreign_landing_url || p.url,
      description: p.title || query,
      color: '#6c63ff',
      license: (p.license || '').toUpperCase(),
      licenseUrl: p.license_url || '',
      attribution: `"${p.title || ''}" by ${p.creator || 'Unknown'} — ${(p.license || '').toUpperCase()}`,
    })),
  };
}

// ─── GIPHY GIF (Demo key built-in — tidak perlu daftar) ────────────────────
// Giphy menyediakan demo key resmi untuk development

const GIPHY_DEMO_KEY = 'dc6zaTOxFJmzC';

async function searchGiphy(query, page = 0, perPage = 20, apiKey = GIPHY_DEMO_KEY) {
  const offset = page * perPage;
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=${perPage}&offset=${offset}&rating=g`;
  const data = await fetchJson(url);
  if (!data.data) throw new Error('Respons Giphy tidak valid');
  return {
    total: data.pagination?.total_count || 0,
    items: data.data.map(g => ({
      id: g.id,
      source: 'giphy',
      thumb: g.images.fixed_height_small?.url || g.images.preview_gif?.url,
      regular: g.images.fixed_height?.url || g.images.downsized?.url,
      full: g.images.original?.url,
      download: g.images.original?.url,
      author: g.username || g.user?.display_name || 'Giphy',
      authorUrl: `https://giphy.com/${g.username || ''}`,
      pageUrl: g.url,
      description: g.title || query,
      color: '#ff6b9e',
      license: 'Giphy',
    })),
  };
}

// ─── UNSPLASH (perlu API key — opsional) ───────────────────────────────────

async function searchUnsplash(query, page = 1, perPage = 20, apiKey) {
  if (!apiKey) throw new Error('Unsplash Access Key belum diisi di Pengaturan → API Keys');
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`;
  const data = await fetchJson(url, { Authorization: `Client-ID ${apiKey}` });
  if (!data.results) throw new Error(data.errors?.[0] || 'Respons Unsplash tidak valid');
  return {
    total: data.total,
    items: data.results.map(p => ({
      id: p.id,
      source: 'unsplash',
      thumb: p.urls.small,
      regular: p.urls.regular,
      full: p.urls.full,
      download: p.links.download,
      author: p.user.name,
      authorUrl: `https://unsplash.com/@${p.user.username}?utm_source=smm_pro&utm_medium=referral`,
      pageUrl: `${p.links.html}?utm_source=smm_pro&utm_medium=referral`,
      description: p.alt_description || p.description || '',
      color: p.color || '#cccccc',
    })),
  };
}

// ─── PEXELS (perlu API key — opsional) ─────────────────────────────────────

async function searchPexels(query, page = 1, perPage = 20, apiKey) {
  if (!apiKey) throw new Error('Pexels API Key belum diisi di Pengaturan → API Keys');
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`;
  const data = await fetchJson(url, { Authorization: apiKey });
  if (!data.photos) throw new Error('Respons Pexels tidak valid');
  return {
    total: data.total_results,
    items: data.photos.map(p => ({
      id: p.id,
      source: 'pexels',
      thumb: p.src.medium,
      regular: p.src.large,
      full: p.src.original,
      download: p.src.original,
      author: p.photographer,
      authorUrl: p.photographer_url,
      pageUrl: p.url,
      description: p.alt || '',
      color: p.avg_color || '#cccccc',
    })),
  };
}

// ─── DOWNLOAD ───────────────────────────────────────────────────────────────

async function downloadPhoto(url, filename) {
  return new Promise((resolve, reject) => {
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(downloadsDir, safeName);
    const file = fs.createWriteStream(filePath);

    const doRequest = (targetUrl) => {
      const lib = targetUrl.startsWith('https') ? https : http;
      lib.get(targetUrl, { headers: { 'User-Agent': 'SMM-Pro-Desktop/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(filePath, () => {});
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(filePath); });
      }).on('error', (err) => {
        file.close();
        fs.unlink(filePath, () => {});
        reject(err);
      });
    };

    doRequest(url);
  });
}

// ─── GOOGLE NEWS RSS (tanpa API key) ───────────────────────────────────────

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/rss+xml, text/xml, */*',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseRss(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      return (re.exec(block) || [])[1]?.trim() || '';
    };
    const link = /<link>([\s\S]*?)<\/link>/i.exec(block)?.[1]?.trim()
      || /<link\s[^>]*href="([^"]+)"/i.exec(block)?.[1]?.trim() || '';
    items.push({
      title: get('title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'),
      link,
      pubDate: get('pubDate'),
      source: get('source'),
      description: get('description').replace(/<[^>]+>/g, '').slice(0, 200),
    });
  }
  return items;
}

async function searchGoogleNews(query, lang = 'id', country = 'ID') {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${country}&ceid=${country}:${lang}`;
  const xml = await fetchText(url);
  return parseRss(xml).slice(0, 20);
}

// ─── REDDIT JSON (tanpa API key) ────────────────────────────────────────────

async function fetchReddit(query, subreddit = '', sort = 'hot', limit = 15) {
  let url;
  if (subreddit) {
    url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}`;
  } else {
    url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=${sort}&limit=${limit}&t=week`;
  }
  const data = await fetchJson(url, {
    'User-Agent': 'SMM-Pro-Desktop/1.0',
    'Accept': 'application/json',
  });
  return (data.data?.children || []).map(c => ({
    title: c.data.title,
    url: c.data.url,
    permalink: `https://www.reddit.com${c.data.permalink}`,
    subreddit: c.data.subreddit,
    score: c.data.score,
    comments: c.data.num_comments,
    author: c.data.author,
    created: new Date(c.data.created_utc * 1000).toLocaleDateString('id-ID'),
    thumbnail: c.data.thumbnail?.startsWith('http') ? c.data.thumbnail : null,
    selftext: (c.data.selftext || '').slice(0, 200),
  }));
}

module.exports = {
  searchOpenverse,
  searchGiphy,
  searchUnsplash,
  searchPexels,
  downloadPhoto,
  searchGoogleNews,
  fetchReddit,
};
