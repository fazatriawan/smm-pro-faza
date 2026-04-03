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

  // Hapus media dari Cloudinary setelah terkirim
  if (post.mediaUrls && post.mediaUrls.length > 0) {
    for (const url of post.mediaUrls) {
      try {
        const publicId = extractCloudinaryPublicId(url);
        if (publicId) {
          await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
          console.log(`[Cloudinary] Deleted: ${publicId}`);
        }
      } catch (e) {
        console.log('[Cloudinary] Delete error:', e.message);
      }
    }
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
    console.error(`Failed to post to ${account.platform}:`, err.message);
    await Post.updateOne(
      { _id: post._id, 'targetAccounts._id': target._id },
      { $set: {
        'targetAccounts.$.status': 'failed',
        'targetAccounts.$.error': err.message
      }}
    );
    throw err;
  }
}

async function postToFacebook(account, caption, mediaUrls) {
  const token = account.accessToken;
  const pageId = account.pageId || account.platformUserId;

  if (!token) throw new Error('No access token');
  if (!pageId) throw new Error('No page ID');

  try {
    if (mediaUrls && mediaUrls.length > 0) {
      const mediaUrl = mediaUrls[0];

      if (isVideo(mediaUrl)) {
        // Post video ke Facebook menggunakan form params
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
        // Post gambar ke Facebook
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
      // Post teks saja
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
    const fbError = err.response?.data?.error?.message || err.message;
    throw new Error(`Facebook API error: ${fbError}`);
  }
}

async function postToInstagram(account, caption, mediaUrls) {
  const token = account.accessToken;
  const userId = account.platformUserId;

  if (!token) throw new Error('No access token');
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
    const igError = err.response?.data?.error?.message || err.message;
    throw new Error(`Instagram API error: ${igError}`);
  }
}

module.exports = { publishPost };
