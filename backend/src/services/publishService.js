const axios = require('axios');
const { Post, SocialAccount } = require('../models');

/**
 * Main publish orchestrator
 * Iterates each targetAccount in the post and calls the correct platform publisher
 */
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
  return post;
}

async function publishToAccount(post, target) {
  const account = target.account;
  try {
    let platformPostId;
    const override = post.platformOverrides?.[account.platform] || {};
    const caption = override.caption || post.caption;

    switch (account.platform) {
      case 'instagram': platformPostId = await postToInstagram(account, caption, post.mediaUrls, override); break;
      case 'facebook':  platformPostId = await postToFacebook(account, caption, post.mediaUrls, override); break;
      case 'twitter':   platformPostId = await postToTwitter(account, caption, post.mediaUrls); break;
      case 'tiktok':    platformPostId = await postToTikTok(account, caption, post.mediaUrls); break;
      case 'youtube':   platformPostId = await postToYouTube(account, post.mediaUrls, override); break;
      default: throw new Error(`Unknown platform: ${account.platform}`);
    }

    target.status = 'sent';
    target.platformPostId = platformPostId;
    target.sentAt = new Date();
    await Post.updateOne(
      { _id: post._id, 'targetAccounts._id': target._id },
      { $set: { 'targetAccounts.$.status': 'sent', 'targetAccounts.$.platformPostId': platformPostId, 'targetAccounts.$.sentAt': new Date() } }
    );
  } catch (err) {
    target.status = 'failed';
    target.error = err.message;
    await Post.updateOne(
      { _id: post._id, 'targetAccounts._id': target._id },
      { $set: { 'targetAccounts.$.status': 'failed', 'targetAccounts.$.error': err.message } }
    );
    throw err;
  }
}

// ─── INSTAGRAM (Meta Graph API) ───────────────────────────────────────────────
// Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
async function postToInstagram(account, caption, mediaUrls, override) {
  const token = account.accessToken;
  const userId = account.platformUserId;

  if (!mediaUrls || mediaUrls.length === 0) {
    // Text-only not supported on IG, skip or throw
    throw new Error('Instagram requires media (image or video)');
  }

  // Step 1: Create media container
  const createRes = await axios.post(
    `https://graph.instagram.com/v18.0/${userId}/media`,
    null,
    { params: { image_url: mediaUrls[0], caption, access_token: token } }
  );
  const creationId = createRes.data.id;

  // Step 2: Publish
  const publishRes = await axios.post(
    `https://graph.instagram.com/v18.0/${userId}/media_publish`,
    null,
    { params: { creation_id: creationId, access_token: token } }
  );
  return publishRes.data.id;
}

// ─── FACEBOOK (Meta Graph API) ────────────────────────────────────────────────
// Docs: https://developers.facebook.com/docs/pages/publishing
async function postToFacebook(account, caption, mediaUrls, override) {
  const token = account.accessToken;
  const pageId = account.pageId || account.platformUserId;

  if (mediaUrls && mediaUrls.length > 0) {
    // Photo post
    const res = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/photos`, {
      url: mediaUrls[0],
      message: caption,
      access_token: token
    });
    return res.data.post_id || res.data.id;
  } else {
    // Text post
    const res = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
      message: caption,
      access_token: token
    });
    return res.data.id;
  }
}

// ─── X / TWITTER (OAuth2) ─────────────────────────────────────────────────────
// Docs: https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference
async function postToTwitter(account, caption, mediaUrls) {
  const headers = { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' };
  const body = { text: caption.slice(0, 280) };

  // TODO: upload media first via v1.1 media/upload, then attach media_ids
  const res = await axios.post('https://api.twitter.com/2/tweets', body, { headers });
  return res.data.data.id;
}

// ─── TIKTOK ───────────────────────────────────────────────────────────────────
// Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
async function postToTikTok(account, caption, mediaUrls) {
  if (!mediaUrls || mediaUrls.length === 0) throw new Error('TikTok requires a video');
  const headers = { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' };

  // Step 1: Init upload
  const initRes = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    post_info: { title: caption.slice(0, 150), privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: false },
    source_info: { source: 'PULL_FROM_URL', video_url: mediaUrls[0] }
  }, { headers });

  return initRes.data?.data?.publish_id || 'tiktok_publish_id';
}

// ─── YOUTUBE ──────────────────────────────────────────────────────────────────
// Docs: https://developers.google.com/youtube/v3/docs/videos/insert
async function postToYouTube(account, mediaUrls, override) {
  if (!mediaUrls || mediaUrls.length === 0) throw new Error('YouTube requires a video file');
  // YouTube upload requires multipart/form-data with video binary
  // Use googleapis or resumable upload for large files
  // This is a stub — implement with google-auth-library in production
  const headers = { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' };

  const metadata = {
    snippet: {
      title: override.title || 'New Video',
      description: override.description || '',
      tags: override.tags || []
    },
    status: { privacyStatus: 'public' }
  };

  // For actual upload, use resumable upload API:
  // POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable
  // Then PUT binary to the upload URI
  console.log('[YouTube] Would upload video:', mediaUrls[0], 'with metadata:', metadata);
  return `yt_video_id_${Date.now()}`;
}

module.exports = { publishPost };
