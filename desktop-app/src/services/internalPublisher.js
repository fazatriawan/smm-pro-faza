// src/services/internalPublisher.js
// Direct in-process publisher — no Redis/BullMQ needed
// Ported from worker/src/publishers/* (ESM → CommonJS)

const crypto = require('crypto');

// ─── Crypto helpers ────────────────────────────────────────────────────────────
function decrypt(stored, encryptionKey) {
  if (!stored) return stored;
  if (!stored.includes(':')) return stored; // fallback plaintext
  const key = Buffer.from(encryptionKey || '', 'hex');
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

// ─── Facebook ──────────────────────────────────────────────────────────────────
const FB_BASE = 'https://graph.facebook.com/v19.0';

async function apiFetchFb(url, method, token, body) {
  const reqBody = { ...body, access_token: token };
  const res  = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(reqBody),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Facebook non-JSON (${res.status}): ${text}`); }
  if (!res.ok) {
    const code = data.error?.code;
    if (code === 32 || code === 613) { const e = new Error(`Facebook rate limit: ${data.error.message}`); e.isRateLimit = true; throw e; }
    if (code === 190)                { const e = new Error(`Facebook token tidak valid (code 190)`); e.isAuthError = true; throw e; }
    throw new Error(`Facebook API error (${data.error?.code}): ${data.error?.message || res.statusText}`);
  }
  return data;
}

async function publishToFacebook({ token, content, mediaUrls = [], platformUid }) {
  const pageId    = platformUid || 'me';
  const validUrls = (mediaUrls || []).filter(u => typeof u === 'string' && /^https?:\/\//i.test(u));

  if (validUrls.length > 0) {
    const photoIds = await Promise.all(
      validUrls.slice(0, 10).map(async url => {
        const r = await apiFetchFb(`${FB_BASE}/${pageId}/photos`, 'POST', token, { url, published: false });
        return r.id;
      })
    );
    const res = await apiFetchFb(`${FB_BASE}/${pageId}/feed`, 'POST', token, {
      message:        content,
      attached_media: photoIds.map(id => ({ media_fbid: id })),
    });
    return { postId: res.id };
  }

  const res = await apiFetchFb(`${FB_BASE}/${pageId}/feed`, 'POST', token, { message: content });
  return { postId: res.id };
}

// ─── Instagram ─────────────────────────────────────────────────────────────────
async function publishToInstagram({ token, content, mediaUrls = [], platformUid }) {
  const igUserId = platformUid;
  if (!igUserId) throw new Error('Instagram Business Account ID tidak ditemukan');

  if (!mediaUrls || mediaUrls.length === 0) {
    throw new Error('Instagram membutuhkan minimal 1 gambar/video untuk posting');
  }

  async function createContainer(params) {
    const res  = await fetch(`${FB_BASE}/${igUserId}/media`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...params, access_token: token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`IG create container gagal: ${data.error?.message}`);
    return data;
  }

  async function waitForContainer(containerId) {
    for (let i = 0; i < 10; i++) {
      const res  = await fetch(`${FB_BASE}/${containerId}?fields=status_code&access_token=${token}`);
      const data = await res.json();
      if (data.status_code === 'FINISHED') return;
      if (data.status_code === 'ERROR')    throw new Error('IG media container gagal diproses');
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('IG media container timeout');
  }

  async function publishContainer(containerId) {
    const res  = await fetch(`${FB_BASE}/${igUserId}/media_publish`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ creation_id: containerId, access_token: token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`IG publish gagal: ${data.error?.message}`);
    return data;
  }

  if (mediaUrls.length === 1) {
    const container = await createContainer({ image_url: mediaUrls[0], caption: content });
    await waitForContainer(container.id);
    const result = await publishContainer(container.id);
    return { postId: result.id };
  }

  // Carousel
  const children = await Promise.all(
    mediaUrls.slice(0, 10).map(url =>
      createContainer({ image_url: url, is_carousel_item: true })
    )
  );
  const carousel = await createContainer({
    media_type: 'CAROUSEL',
    caption:    content,
    children:   children.map(c => c.id).join(','),
  });
  await waitForContainer(carousel.id);
  const result = await publishContainer(carousel.id);
  return { postId: result.id };
}

// ─── Twitter ───────────────────────────────────────────────────────────────────
async function publishToTwitter({ token, content }) {
  const res = await fetch('https://api.twitter.com/2/tweets', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: content.slice(0, 280) }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Twitter non-JSON (${res.status}): ${text}`); }
  if (!res.ok) {
    const status = data.status;
    if (status === 429)              { const e = new Error('Twitter rate limit tercapai'); e.isRateLimit = true; throw e; }
    if (status === 401 || status === 403) { const e = new Error(`Twitter auth error: ${data.detail || data.title}`); e.isAuthError = true; throw e; }
    throw new Error(`Twitter API error: ${data.detail || data.title || JSON.stringify(data)}`);
  }
  return { postId: data.data?.id };
}

// ─── Threads ───────────────────────────────────────────────────────────────────
const THREADS_BASE = 'https://graph.threads.net/v1.0';

async function apiFetchThreads(url, method, token, body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (method === 'POST' && body) {
    options.body = JSON.stringify({ ...body, access_token: token });
  } else if (method === 'GET' && !url.includes('access_token')) {
    url += (url.includes('?') ? '&' : '?') + `access_token=${token}`;
  }
  const res  = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    const code = data.error?.code;
    if (code === 32 || code === 613) { const e = new Error(`Threads rate limit: ${data.error.message}`); e.isRateLimit = true; throw e; }
    if (code === 190)                { const e = new Error('Threads token tidak valid'); e.isAuthError = true; throw e; }
    throw new Error(`Threads API error: ${data.error?.message || res.statusText}`);
  }
  return data;
}

async function publishToThreads({ token, content, mediaUrls = [], platformUid }) {
  const threadsUserId = platformUid;
  if (!threadsUserId) throw new Error('Threads user ID tidak ditemukan di akun');

  let containerId;

  if (mediaUrls.length > 1) {
    const children = await Promise.all(
      mediaUrls.slice(0, 10).map(url =>
        apiFetchThreads(`${THREADS_BASE}/${threadsUserId}/threads`, 'POST', token, {
          media_type: 'IMAGE', image_url: url, is_carousel_item: true,
        })
      )
    );
    containerId = await apiFetchThreads(`${THREADS_BASE}/${threadsUserId}/threads`, 'POST', token, {
      media_type: 'CAROUSEL',
      text:       content,
      children:   children.map(c => c.id).join(','),
    });
  } else if (mediaUrls.length === 1) {
    containerId = await apiFetchThreads(`${THREADS_BASE}/${threadsUserId}/threads`, 'POST', token, {
      media_type: 'IMAGE', image_url: mediaUrls[0], text: content,
    });
  } else {
    containerId = await apiFetchThreads(`${THREADS_BASE}/${threadsUserId}/threads`, 'POST', token, {
      media_type: 'TEXT', text: content,
    });
  }

  // Wait for container ready (max 30s)
  for (let i = 0; i < 15; i++) {
    const data = await apiFetchThreads(
      `${THREADS_BASE}/${containerId.id}?fields=status,error_message`,
      'GET', token
    );
    if (data.status === 'FINISHED') break;
    if (data.status === 'ERROR') throw new Error(`Threads container error: ${data.error_message}`);
    await new Promise(r => setTimeout(r, 2000));
  }

  const result = await apiFetchThreads(
    `${THREADS_BASE}/${threadsUserId}/threads_publish`,
    'POST', token,
    { creation_id: containerId.id }
  );
  return { postId: result.id };
}

// ─── YouTube ───────────────────────────────────────────────────────────────────
async function publishToYoutube({ token, content, mediaUrls = [] }) {
  if (!mediaUrls || !mediaUrls.length) {
    throw new Error('YouTube membutuhkan minimal 1 URL video untuk posting');
  }

  const videoUrl = mediaUrls[0];
  const lines       = content.trim().split('\n');
  const title       = lines[0].slice(0, 100) || 'Video SMM Pro';
  const description = lines.slice(2).join('\n').slice(0, 5000) || content;
  const tags        = (content.match(/#(\w+)/g) || []).map(t => t.slice(1)).slice(0, 30);

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Gagal download video: ${videoRes.statusText}`);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const contentType = videoRes.headers.get('content-type') || 'video/mp4';

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        'Authorization':           `Bearer ${token}`,
        'Content-Type':            'application/json',
        'X-Upload-Content-Type':   contentType,
        'X-Upload-Content-Length': videoBuffer.length.toString(),
      },
      body: JSON.stringify({
        snippet: { title, description, tags, categoryId: '22' },
        status:  { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    const reason = err.error?.errors?.[0]?.reason || '';
    if (initRes.status === 401 || initRes.status === 403) { const e = new Error(`YouTube auth error: ${err.error?.message}`); e.isAuthError = true; throw e; }
    if (initRes.status === 429 || reason === 'quotaExceeded') { const e = new Error('YouTube quota habis'); e.isRateLimit = true; throw e; }
    throw new Error(`YouTube init error (${initRes.status}): ${err.error?.message || ''}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube tidak mengembalikan upload URL');

  const uploadRes = await fetch(uploadUrl, {
    method:  'PUT',
    headers: {
      'Authorization':  `Bearer ${token}`,
      'Content-Type':   contentType,
      'Content-Length': videoBuffer.length.toString(),
    },
    body: videoBuffer,
  });

  if (!uploadRes.ok && uploadRes.status !== 308) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(`YouTube upload error (${uploadRes.status}): ${err.error?.message || ''}`);
  }

  const data = await uploadRes.json();
  return { postId: data.id };
}

// ─── TikTok ────────────────────────────────────────────────────────────────────
async function apiFetchTikTok(url, method, token, body) {
  const res  = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== 'ok') {
    const code = data.error?.code || '';
    if (code.includes('rate_limit') || res.status === 429) { const e = new Error(`TikTok rate limit: ${data.error?.message}`); e.isRateLimit = true; throw e; }
    if (res.status === 401 || code.includes('access_token')) { const e = new Error(`TikTok token tidak valid: ${data.error?.message}`); e.isAuthError = true; throw e; }
    throw new Error(`TikTok API error: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

async function publishToTikTok({ token, content, mediaUrls = [] }) {
  if (!mediaUrls || !mediaUrls.length) throw new Error('TikTok membutuhkan minimal 1 video untuk posting');

  const videoUrl = mediaUrls[0];

  // Query creator info
  const creatorRes  = await apiFetchTikTok('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', 'POST', token, {});
  const creatorInfo = creatorRes.data;

  // Download video
  const videoRes    = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Gagal download video TikTok: ${videoRes.statusText}`);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const videoSize   = videoBuffer.length;

  // Init upload
  const initBody = {
    post_info: {
      title:            content.slice(0, 2200),
      privacy_level:    creatorInfo.privacy_level_options?.[0] || 'PUBLIC_TO_EVERYONE',
      disable_duet:     false,
      disable_comment:  false,
      disable_stitch:   false,
      video_cover_timestamp_ms: 1000,
    },
    source_info: {
      source:            'FILE_UPLOAD',
      video_size:        videoSize,
      chunk_size:        videoSize,
      total_chunk_count: 1,
    },
  };
  const initRes = await apiFetchTikTok('https://open.tiktokapis.com/v2/post/publish/video/init/', 'POST', token, initBody);
  const { publish_id, upload_url } = initRes.data;

  // Upload video
  const upRes = await fetch(upload_url, {
    method:  'PUT',
    headers: {
      'Content-Type':  'video/mp4',
      'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
      'Content-Length': videoSize.toString(),
    },
    body: videoBuffer,
  });
  if (!upRes.ok) {
    const text = await upRes.text().catch(() => '');
    throw new Error(`TikTok upload gagal (${upRes.status}): ${text}`);
  }

  // Poll status
  for (let i = 0; i < 20; i++) {
    const statusRes = await apiFetchTikTok('https://open.tiktokapis.com/v2/post/publish/status/fetch/', 'POST', token, { publish_id });
    const status    = statusRes.data?.status;
    if (status === 'PUBLISH_COMPLETE') return { postId: statusRes.data.publicaly_available_post_id?.[0] || publish_id };
    if (status === 'FAILED')           throw new Error(`TikTok publish gagal: ${statusRes.data?.fail_reason}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('TikTok publish timeout');
}

// ─── Main publishJob ───────────────────────────────────────────────────────────

async function publishJob(supabase, encryptionKey, job) {
  const { postTargetId, platform, accountId, content, mediaUrls = [] } = job;

  // Mark as processing
  await supabase.from('post_targets').update({ status: 'processing' }).eq('id', postTargetId);

  // Fetch account
  const { data: account, error: accErr } = await supabase
    .from('social_accounts')
    .select('id, platform, username, platform_uid, access_token')
    .eq('id', accountId)
    .single();

  if (accErr || !account) throw new Error(`Akun ${accountId} tidak ditemukan`);

  const token = decrypt(account.access_token, encryptionKey);
  const platformUid = account.platform_uid;

  let result;
  switch (platform) {
    case 'facebook':  result = await publishToFacebook({ token, content, mediaUrls, platformUid }); break;
    case 'instagram': result = await publishToInstagram({ token, content, mediaUrls, platformUid }); break;
    case 'twitter':   result = await publishToTwitter({ token, content, mediaUrls }); break;
    case 'threads':   result = await publishToThreads({ token, content, mediaUrls, platformUid }); break;
    case 'youtube':   result = await publishToYoutube({ token, content, mediaUrls }); break;
    case 'tiktok':    result = await publishToTikTok({ token, content, mediaUrls }); break;
    default:          throw new Error(`Platform tidak didukung: ${platform}`);
  }

  // Update post_target as published
  await supabase.from('post_targets').update({
    status:    'published',
    post_url:  result.postId ? String(result.postId) : null,
    published_at: new Date().toISOString(),
  }).eq('id', postTargetId);

  return { platform, username: account.username, postId: result.postId };
}

module.exports = { publishJob };
