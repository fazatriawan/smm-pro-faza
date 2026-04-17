const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const os = require('os');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Gunakan plugin stealth untuk menghindari deteksi
puppeteer.use(StealthPlugin());

async function bulkPost(config, settings, onLog) {
  const { accounts, caption, mediaPath, platform, scheduledAt } = config;
  const apiUrl = settings.apiUrl || 'https://smm-pro-faza.onrender.com';

  onLog({ type: 'info', message: `Memulai bulk post ke ${accounts.length} akun ${platform}` });

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    onLog({ type: 'info', message: `[${i+1}/${accounts.length}] Posting ke: ${account.label || account.username}` });

    try {
      switch (platform) {
        case 'facebook':
          await postToFacebook(account, caption, mediaPath, onLog);
          break;
        case 'instagram':
          await postToInstagram(account, caption, mediaPath, onLog);
          break;
        case 'youtube':
          await postToYouTube(account, caption, mediaPath, onLog);
          break;
        case 'twitter':
          await postToTwitter(account, caption, onLog);
          break;
        case 'threads':
          await postToThreads(account, caption, mediaPath, onLog);
          break;
        case 'tiktok':
          onLog({ type: 'warn', message: 'TikTok posting via API belum tersedia, skip...' });
          break;
        default:
          onLog({ type: 'warn', message: `Platform ${platform} belum didukung` });
      }

      onLog({ type: 'success', message: `✅ Berhasil posting ke ${account.label || account.username}` });

      // Jeda antar akun
      if (i < accounts.length - 1) {
        const delay = 3000 + Math.random() * 3000;
        await sleep(delay);
      }

    } catch (err) {
      onLog({ type: 'error', message: `❌ Gagal posting ke ${account.label || account.username}: ${err.message}` });
    }
  }

  onLog({ type: 'success', message: '🎉 Bulk post selesai!' });
}

async function postToFacebook(account, caption, mediaPath, onLog) {
  const token = account.accessToken;
  const pageId = account.pageId || account.platformUserId;

  if (!token) throw new Error('Token tidak ada');

  if (mediaPath) {
    const isVideo = ['.mp4', '.mov', '.avi', '.webm'].some(ext => mediaPath.toLowerCase().includes(ext));
    
    if (isVideo) {
      const params = new URLSearchParams();
      params.append('description', caption);
      params.append('access_token', token);

      const res = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/videos`,
        params,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return res.data;
    } else {
      // Upload gambar
      const form = new FormData();
      form.append('source', fs.createReadStream(mediaPath));
      form.append('message', caption);
      form.append('access_token', token);

      const res = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/photos`,
        form,
        { headers: form.getHeaders() }
      );
      return res.data;
    }
  } else {
    const params = new URLSearchParams();
    params.append('message', caption);
    params.append('access_token', token);

    const res = await axios.post(
      `https://graph.facebook.com/v18.0/${pageId}/feed`,
      params,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return res.data;
  }
}

async function postToInstagram(account, caption, mediaPath, onLog) {
  const token = account.accessToken;
  const userId = account.platformUserId;

  if (!token) throw new Error('Token tidak ada');
  if (!mediaPath) throw new Error('Instagram membutuhkan media');

  // Upload ke Cloudinary dulu jika file lokal
  let mediaUrl = mediaPath;
  if (!mediaPath.startsWith('http')) {
    throw new Error('Instagram membutuhkan URL media publik. Upload ke Cloudinary dulu.');
  }

  const isVideo = ['.mp4', '.mov', '.avi', '.webm'].some(ext => mediaUrl.toLowerCase().includes(ext));

  const createParams = isVideo
    ? { media_type: 'REELS', video_url: mediaUrl, caption, access_token: token }
    : { image_url: mediaUrl, caption, access_token: token };

  const createRes = await axios.post(
    `https://graph.instagram.com/v18.0/${userId}/media`,
    null, { params: createParams }
  );

  if (isVideo) await sleep(5000);

  const publishRes = await axios.post(
    `https://graph.instagram.com/v18.0/${userId}/media_publish`,
    null, { params: { creation_id: createRes.data.id, access_token: token } }
  );
  return publishRes.data;
}

async function postToYouTube(account, caption, mediaPath, onLog) {
  const token = account.accessToken;
  if (!token) throw new Error('Token YouTube tidak ada');
  if (!mediaPath) throw new Error('YouTube membutuhkan video');

  const isVideo = ['.mp4', '.mov', '.avi', '.webm', '.m4v'].some(ext => mediaPath.toLowerCase().includes(ext));
  if (!isVideo) throw new Error('YouTube hanya menerima video');

  onLog({ type: 'info', message: 'Mengupload video ke YouTube...' });

  const videoBuffer = fs.readFileSync(mediaPath);
  const videoSize = videoBuffer.length;

  const initRes = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      snippet: { title: caption.slice(0, 100), description: caption, categoryId: '22' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': videoSize
      }
    }
  );

  const uploadUrl = initRes.headers.location;
  const uploadRes = await axios.put(uploadUrl, videoBuffer, {
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': videoSize },
    maxBodyLength: Infinity, maxContentLength: Infinity
  });

  onLog({ type: 'success', message: `YouTube video uploaded: ${uploadRes.data?.id}` });
  return uploadRes.data;
}

async function postToTwitter(account, caption, onLog) {
  const token = account.accessToken;
  if (!token) throw new Error('Token Twitter tidak ada');

  const res = await axios.post(
    'https://api.twitter.com/2/tweets',
    { text: caption.slice(0, 280) },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

async function postToThreads(account, caption, mediaPath, onLog) {
  const token = account.accessToken;
  const userId = account.platformUserId;
  if (!token) throw new Error('Token Threads tidak ada');

  let mediaType = 'TEXT';
  let mediaUrl = null;

  if (mediaPath && mediaPath.startsWith('http')) {
    const isVideo = ['.mp4', '.mov', '.avi', '.webm'].some(ext => mediaPath.toLowerCase().includes(ext));
    mediaType = isVideo ? 'VIDEO' : 'IMAGE';
    mediaUrl = mediaPath;
  }

  const params = { media_type: mediaType, text: caption, access_token: token };
  if (mediaUrl && mediaType === 'IMAGE') params.image_url = mediaUrl;
  if (mediaUrl && mediaType === 'VIDEO') params.video_url = mediaUrl;

  const containerRes = await axios.post(
    `https://graph.threads.net/v1.0/${userId}/threads`,
    null, { params }
  );

  if (mediaType === 'VIDEO') await sleep(5000);

  const publishRes = await axios.post(
    `https://graph.threads.net/v1.0/${userId}/threads_publish`,
    null, { params: { creation_id: containerRes.data.id, access_token: token } }
  );
  return publishRes.data;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { bulkPost };
