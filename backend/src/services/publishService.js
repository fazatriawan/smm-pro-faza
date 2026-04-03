const axios = require('axios');
const { Post, SocialAccount } = require('../models');

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

  if (!token) throw new Error('No access token for Facebook account');
  if (!pageId) throw new Error('No page ID for Facebook account');

  try {
    if (mediaUrls && mediaUrls.length > 0) {
      const imageUrl = mediaUrls[0].startsWith('http')
        ? mediaUrls[0]
        : `${process.env.BACKEND_URL || 'https://smm-pro-faza.onrender.com'}${mediaUrls[0]}`;

      const res = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/photos`,
        { url: imageUrl, message: caption, access_token: token }
      );
      return res.data.post_id || res.data.id;
    } else {
      const res = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/feed`,
        { message: caption, access_token: token }
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

  if (!token) throw new Error('No access token for Instagram account');
  if (!mediaUrls || mediaUrls.length === 0) throw new Error('Instagram membutuhkan gambar atau video');

  try {
    const imageUrl = mediaUrls[0].startsWith('http')
      ? mediaUrls[0]
      : `${process.env.BACKEND_URL || 'https://smm-pro-faza.onrender.com'}${mediaUrls[0]}`;

    const createRes = await axios.post(
      `https://graph.instagram.com/v18.0/${userId}/media`,
      null,
      { params: { image_url: imageUrl, caption, access_token: token } }
    );

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
