const axios = require('axios');
const { parseError } = require('../utils/errorHandler');
const cloudinary = require('cloudinary').v2;
const { Post, SocialAccount } = require('../models');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function publishPost(postId) {
  const post = await Post.findById(postId).populate('targetAccounts.account');
  if (!post) throw new Error('Post not found');

  post.status = 'sending';
  await post.save();

  // Posting satu per satu dengan jeda agar tidak kena rate limit
  const results = [];
  for (let i = 0; i < post.targetAccounts.length; i++) {
    // Cek apakah post sudah di-stop user
    const freshPost = await Post.findById(post._id);
    if (!freshPost || freshPost.status === 'failed') {
      console.log('[Publish] Post dihentikan oleh user:', post._id);
      break;
    }

    const target = post.targetAccounts[i];
    const result = await Promise.allSettled([publishToAccount(post, target)]);
    results.push(result[0]);

    // Jeda 3-5 detik antar akun
    if (i < post.targetAccounts.length - 1) {
      const delay = 3000 + Math.random() * 2000;
      console.log(`[Publish] Jeda ${Math.round(delay/1000)}s sebelum akun berikutnya...`);
      await sleep(delay);
    }
  }

  const allSent = results.every(r => r.status === 'fulfilled');
  const anySent = results.some(r => r.status === 'fulfilled');
  post.status = allSent ? 'completed' : anySent ? 'partial' : 'failed';
  await post.save();

  // Hapus media dari Cloudinary setelah 45 menit (video butuh waktu proses di Facebook)
  if (post.mediaUrls && post.mediaUrls.length > 0) {
    setTimeout(async () => {
      for (const url of post.mediaUrls) {
        try {
          const publicId = extractCloudinaryPublicId(url);
          if (publicId) {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'video' })
              .catch(() => cloudinary.uploader.destroy(publicId, { resource_type: 'image' }));
            console.log(`[Cloudinary] Deleted: ${publicId}`);
          }
        } catch (e) {
          console.log('[Cloudinary] Delete error:', e.message);
        }
      }
    }, 45 * 60 * 1000);
  }

  return post;
}

function extractCloudinaryPublicId(url) {
  try {
    const parts = url.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return null;
    const pathAfterUpload = parts.slice(uploadIndex + 2).join('/');
    return pathAfterUpload.replace(/\.[^/.]+$/, '');
  } catch { return null; }
}

function isVideo(url) {
  if (!url) return false;
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v'];
  const urlLower = url.toLowerCase();
  return videoExtensions.some(ext => urlLower.includes(ext)) || urlLower.includes('/video/');
}

// Parse Facebook error jadi pesan yang lebih mudah dipahami
function parseFacebookError(err) {
  const fbErr = err.response?.data?.error;
  if (!fbErr) return err.message;

  const code = fbErr.code;
  const msg = fbErr.message || '';

  switch (code) {
    case 200:
      return 'Tidak punya izin posting di Page ini — pastikan role Admin';
    case 100:
      if (msg.includes('video')) return 'Tidak ada izin publish video di Page ini';
      return `Parameter tidak valid: ${msg}`;
    case 190:
      return 'Token expired atau tidak valid — perlu reconnect akun';
    case 368:
      return 'Akun dibatasi sementara oleh Facebook';
    case 32:
      return 'Rate limit — terlalu banyak request, coba lagi nanti';
    case 4:
      return 'Rate limit aplikasi — coba lagi dalam beberapa menit';
    case 341:
      return 'Limit posting harian tercapai';
    default:
      return `Facebook error #${code}: ${msg.slice(0, 100)}`;
  }
}

async function publishToAccount(post, target) {
  const account = target.account;
  if (!account) throw new Error('Account not found');

  try {
    let platformPostId;
    const caption = post.caption || '';

    switch (account.platform) {
      case 'facebook':
        platformPostId = await postToFacebook(account, caption, post.mediaUrls);
        break;
      case 'instagram':
        platformPostId = await postToInstagram(account, caption, post.mediaUrls);
        break;
      case 'twitter':
        platformPostId = await postToTwitter(account, caption, post.mediaUrls);
        break;
      case 'threads':
        platformPostId = await postToThreads(account, caption, post.mediaUrls);
        break;
      case 'youtube':
        platformPostId = await postToYouTube(account, caption, post.mediaUrls);
        break;
      case 'tiktok':
        platformPostId = await postToTikTok(account, caption, post.mediaUrls);
        break;
      default:
        throw new Error(`Platform ${account.platform} belum didukung`);
    }

    await Post.updateOne(
      { _id: post._id, 'targetAccounts._id': target._id },
      { $set: {
        'targetAccounts.$.status': 'sent',
        'targetAccounts.$.platformPostId': platformPostId,
        'targetAccounts.$.sentAt': new Date()
      }}
    );
    return platformPostId;
  } catch (err) {
    const errorMsg = parseFacebookError(err);
    const parsed = parseError(account.platform, err);
    console.error(`Failed to post to ${account.platform} (${account.label}): ${parsed.friendlyMessage}`);
    await Post.updateOne(
      { _id: post._id, 'targetAccounts._id': target._id },
      { $set: {
        'targetAccounts.$.status': 'failed',
        'targetAccounts.$.error': parsed.friendlyMessage,
        'targetAccounts.$.errorMessage': parsed.friendlyMessage,
        'targetAccounts.$.actionNeeded': parsed.actionNeeded
      }}
    );
    throw new Error(parsed.friendlyMessage);
  }
}

async function postToFacebook(account, caption, mediaUrls) {
  const token = account.accessToken;
  const pageId = account.pageId || account.platformUserId;

  if (!token) throw new Error('Token tidak ada — perlu reconnect akun');
  if (!pageId) throw new Error('Page ID tidak ada');

  try {
    if (mediaUrls && mediaUrls.length > 0) {
      const mediaUrl = mediaUrls[0];

      if (isVideo(mediaUrl)) {
        const params = new URLSearchParams();
        params.append('file_url', mediaUrl);
        params.append('description', caption);
        params.append('published', 'true');
        params.append('access_token', token);

        const res = await axios.post(
          `https://graph.facebook.com/v18.0/${pageId}/videos`,
          params,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return res.data.id;
      } else {
        const params = new URLSearchParams();
        params.append('url', mediaUrl);
        params.append('message', caption);
        params.append('access_token', token);

        const res = await axios.post(
          `https://graph.facebook.com/v18.0/${pageId}/photos`,
          params,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return res.data.post_id || res.data.id;
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
      return res.data.id;
    }
  } catch (err) {
    throw err;
  }
}

async function postToInstagram(account, caption, mediaUrls) {
  const token = account.accessToken;
  const userId = account.platformUserId;

  if (!token) throw new Error('Token tidak ada — perlu reconnect akun');
  if (!mediaUrls || mediaUrls.length === 0) throw new Error('Instagram membutuhkan media');

  try {
    const mediaUrl = mediaUrls[0];
    let createParams;

    if (isVideo(mediaUrl)) {
      createParams = {
        media_type: 'REELS',
        video_url: mediaUrl,
        caption,
        access_token: token
      };
    } else {
      createParams = {
        image_url: mediaUrl,
        caption,
        access_token: token
      };
    }

    const createRes = await axios.post(
      `https://graph.instagram.com/v18.0/${userId}/media`,
      null,
      { params: createParams }
    );

    if (isVideo(mediaUrl)) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const publishRes = await axios.post(
      `https://graph.instagram.com/v18.0/${userId}/media_publish`,
      null,
      { params: { creation_id: createRes.data.id, access_token: token } }
    );
    return publishRes.data.id;
  } catch (err) {
    throw err;
  }
}

async function postToThreads(account, caption, mediaUrls) {
  const token = account.accessToken;
  const userId = account.platformUserId;
  if (!token) throw new Error('Token Threads tidak ada');

  try {
    let mediaType = 'TEXT';
    let mediaUrl = null;

    if (mediaUrls && mediaUrls.length > 0) {
      const url = mediaUrls[0].toLowerCase();
      const isVideo = ['.mp4','.mov','.avi','.webm'].some(ext => url.includes(ext));
      mediaType = isVideo ? 'VIDEO' : 'IMAGE';
      mediaUrl = mediaUrls[0];
    }

    // Step 1 — Buat container
    const params = {
      media_type: mediaType,
      text: caption,
      access_token: token
    };
    if (mediaUrl) {
      if (mediaType === 'IMAGE') params.image_url = mediaUrl;
      if (mediaType === 'VIDEO') params.video_url = mediaUrl;
    }

    const containerRes = await axios.post(
      `https://graph.threads.net/v1.0/${userId}/threads`,
      null,
      { params }
    );
    const containerId = containerRes.data.id;
    if (!containerId) throw new Error('Container ID tidak ditemukan');

    // Tunggu sebentar untuk video
    if (mediaType === 'VIDEO') {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Step 2 — Publish
    const publishRes = await axios.post(
      `https://graph.threads.net/v1.0/${userId}/threads_publish`,
      null,
      { params: { creation_id: containerId, access_token: token } }
    );

    return publishRes.data.id;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('Threads API error: ' + msg);
  }
}

async function postToTwitter(account, caption, mediaUrls) {
  const token = account.accessToken;
  if (!token) throw new Error('Token Twitter tidak ada');

  try {
    const body = { text: caption.slice(0, 280) };
    const res = await axios.post(
      'https://api.twitter.com/2/tweets',
      body,
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data?.data?.id;
  } catch (err) {
    const msg = err.response?.data?.detail || err.response?.data?.title || err.message;
    throw new Error('Twitter API error: ' + msg);
  }
}

async function postToYouTube(account, caption, mediaUrls) {
  const token = account.accessToken;
  if (!token) throw new Error('Token YouTube tidak ada');
  if (!mediaUrls || mediaUrls.length === 0) throw new Error('YouTube membutuhkan video');

  // Validasi harus video
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v'];
  const mediaUrl = mediaUrls[0].toLowerCase();
  const isVideo = videoExtensions.some(ext => mediaUrl.includes(ext)) || mediaUrl.includes('/video/');
  if (!isVideo) throw new Error('YouTube hanya menerima video, bukan gambar');

  try {
    const videoUrl = mediaUrls[0];
    const title = caption.slice(0, 100) || 'Video';
    const description = caption || '';

    // Download video dari Cloudinary
    const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    const videoBuffer = Buffer.from(videoRes.data);
    const videoSize = videoBuffer.length;

    // Step 1 — Inisiasi resumable upload
    const initRes = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        snippet: {
          title,
          description,
          tags: ['shorts'],
          categoryId: '22'
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false
        }
      },
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': videoSize
        }
      }
    );

    const uploadUrl = initRes.headers.location;
    if (!uploadUrl) throw new Error('Upload URL tidak ditemukan');

    // Step 2 — Upload video
    const uploadRes = await axios.put(uploadUrl, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoSize
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const videoId = uploadRes.data?.id;
    console.log('[YouTube] Video uploaded:', videoId);
    return videoId;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('YouTube upload gagal: ' + msg);
  }
}

async function postToTikTok(account, caption, mediaUrls) {
  const token = account.accessToken;
  if (!token) throw new Error('Token TikTok tidak ada');
  if (!mediaUrls || mediaUrls.length === 0) throw new Error('TikTok membutuhkan video');

  const videoUrl = mediaUrls[0];
  if (!isVideo(videoUrl)) throw new Error('TikTok hanya menerima video, bukan gambar');

  console.log('[TikTok] Video URL:', videoUrl);

  try {
    // Step 1 — Download video dari Cloudinary ke buffer
    console.log('[TikTok] Downloading video...');
    const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    const videoBuffer = Buffer.from(videoRes.data);
    const videoSize = videoBuffer.length;
    console.log('[TikTok] Downloaded, size:', videoSize);

    // Step 2 — Init upload dengan FILE_UPLOAD + post_info (private untuk unaudited app)
    const safeCaption = (caption || '').replace(/\r\n|\r|\n/g, ' ').trim();
    const initBody = {
      post_info: {
        title: safeCaption,
        privacy_level: 'SELF'
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1
      }
    };

    console.log('[TikTok] Init upload...');
    const initRes = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      initBody,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[TikTok] Init response:', JSON.stringify(initRes.data));

    const data = initRes.data?.data;
    const err = initRes.data?.error;
    if (err && err.code !== 'ok') {
      throw new Error(`TikTok init error: ${err.code} — ${err.message || ''}`);
    }

    const uploadUrl = data?.upload_url;
    const publishId = data?.publish_id;
    if (!uploadUrl) throw new Error('TikTok tidak mengembalikan upload_url');

    // Step 3 — Upload video bytes ke TikTok
    console.log('[TikTok] Uploading bytes to TikTok...');
    await axios.put(uploadUrl, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoSize
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log('[TikTok] Upload success, publish_id:', publishId);
    return publishId;
  } catch (err) {
    console.error('[TikTok] Full error response:', err.response?.data);
    const msg = err.response?.data?.error?.message || err.response?.data?.error?.code || err.message;
    throw new Error('TikTok upload gagal: ' + msg);
  }
}

module.exports = { publishPost };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
