const axios = require('axios');
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

  const results = await Promise.allSettled(
    post.targetAccounts.map(target => publishToAccount(post, target))
  );

  const allSent = results.every(r => r.status === 'fulfilled');
  const anySent = results.some(r => r.status === 'fulfilled');
  post.status = allSent ? 'completed' : anySent ? 'partial' : 'failed';
  await post.save();

  // Hapus media dari Cloudinary setelah 5 menit
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
    }, 5 * 60 * 1000);
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
      case 'youtube':
        platformPostId = await postToYouTube(account, caption, post.mediaUrls);
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
    console.error(`Failed to post to ${account.platform} (${account.label}): ${errorMsg}`);
    await Post.updateOne(
      { _id: post._id, 'targetAccounts._id': target._id },
      { $set: {
        'targetAccounts.$.status': 'failed',
        'targetAccounts.$.error': errorMsg
      }}
    );
    throw new Error(errorMsg);
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

module.exports = { publishPost };
