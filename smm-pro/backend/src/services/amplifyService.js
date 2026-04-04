const axios = require('axios');
const { AmplifyJob, SocialAccount } = require('../models');

async function runAmplifyJob(jobId) {
  const job = await AmplifyJob.findById(jobId).populate('accounts');
  if (!job) throw new Error('Job not found');

  job.status = 'running';
  await job.save();

  const results = [];

  for (let i = 0; i < job.accounts.length; i++) {
    const account = job.accounts[i];

    for (const action of job.actions) {
      if (!action.enabled) continue;

      try {
        await executeAction(account, job.targetUrl, action, i);
        results.push({
          account: account._id,
          action: action.type,
          success: true,
          executedAt: new Date()
        });
        console.log('[Amplify] SUCCESS:', action.type, 'by', account.label);
      } catch (err) {
        results.push({
          account: account._id,
          action: action.type,
          success: false,
          error: err.message,
          executedAt: new Date()
        });
        console.log('[Amplify] FAILED:', action.type, 'by', account.label, '-', err.message);
      }

      await sleep(2000 + Math.random() * 1000);
    }

    if (i < job.accounts.length - 1) {
      const delay = 30000 + Math.random() * 30000;
      console.log('[Amplify] Waiting', Math.round(delay/1000), 'seconds...');
      await sleep(delay);
    }

    job.results = results;
    await job.save();
  }

  job.status = 'completed';
  job.results = results;
  await job.save();
  return job;
}

function extractFacebookPostId(url) {
  try {
    const reelMatch = url.match(/\/reel\/(\d+)/);
    if (reelMatch) return reelMatch[1];

    const postMatch = url.match(/\/posts\/(\d+)/);
    if (postMatch) return postMatch[1];

    const fbidMatch = url.match(/fbid=(\d+)/);
    if (fbidMatch) return fbidMatch[1];

    const permalinkMatch = url.match(/permalink\/(\d+)/);
    if (permalinkMatch) return permalinkMatch[1];

    const storyMatch = url.match(/story_fbid=(\d+)/);
    if (storyMatch) return storyMatch[1];

    const videoMatch = url.match(/\/videos\/(\d+)/);
    if (videoMatch) return videoMatch[1];

    const shareMatch = url.match(/\/share\/p\/([A-Za-z0-9]+)/);
    if (shareMatch) return shareMatch[1];

    const storyFbidMatch = url.match(/story_fbid=([A-Za-z0-9]+)/);
    const pageIdMatch = url.match(/id=(\d+)/);
    if (storyFbidMatch && pageIdMatch) return pageIdMatch[1] + '_' + storyFbidMatch[1];

    return null;
  } catch {
    return null;
  }
}

function getRandomComment(templates, index) {
  if (!templates || templates.length === 0) return 'Bagus!';
  return templates[index % templates.length];
}

async function executeAction(account, targetUrl, action, accountIndex) {
  const token = account.accessToken;
  const isPersonal = account.platform === 'facebook_personal';
  const actorId = account.platformUserId;

  if (!token) throw new Error('Token tidak ada');

  const postId = extractFacebookPostId(targetUrl);
  if (!postId) throw new Error('Tidak bisa extract Post ID dari URL: ' + targetUrl);

  console.log('[Amplify] PostID:', postId, 'Action:', action.type, 'Actor:', actorId, 'isPersonal:', isPersonal);

  switch (action.type) {
    case 'like':
      if (account.platform === 'youtube') return await likeYoutube(targetUrl, token, 'like');
      return await likePost(actorId, postId, token);
    case 'dislike':
      if (account.platform === 'youtube') return await likeYoutube(targetUrl, token, 'dislike');
      throw new Error('Dislike hanya tersedia untuk YouTube');
    case 'comment':
      const commentText = getRandomComment(action.commentTemplates, accountIndex);
      if (account.platform === 'youtube') return await commentYoutube(targetUrl, token, commentText);
      return await commentPost(actorId, postId, token, commentText);
    case 'share':
      return await sharePost(actorId, postId, token, isPersonal);
    case 'subscribe':
      if (account.platform === 'youtube') return await subscribeYoutube(targetUrl, token);
      throw new Error('Subscribe hanya tersedia untuk YouTube');
    default:
      throw new Error('Aksi tidak dikenal: ' + action.type);
  }
}

async function likePost(pageId, postId, token) {
  try {
    const res = await axios.post(
      'https://graph.facebook.com/v18.0/' + postId + '/likes',
      null,
      { params: { access_token: token } }
    );
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('Like gagal: ' + msg);
  }
}

async function commentPost(pageId, postId, token, message) {
  try {
    const res = await axios.post(
      'https://graph.facebook.com/v18.0/' + postId + '/comments',
      null,
      { params: { message, access_token: token } }
    );
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('Komen gagal: ' + msg);
  }
}

async function sharePost(pageId, postId, token) {
  try {
    const res = await axios.post(
      'https://graph.facebook.com/v18.0/' + pageId + '/feed',
      null,
      { params: {
        link: 'https://www.facebook.com/' + postId,
        access_token: token
      }}
    );
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('Share gagal: ' + msg);
  }
}

async function likeYoutube(url, token, rating = 'like') {
  try {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) throw new Error('Tidak bisa extract Video ID dari URL');

    await axios.post(
      'https://www.googleapis.com/youtube/v3/videos/rate',
      null,
      { params: { id: videoId, rating },
        headers: { Authorization: 'Bearer ' + token } }
    );
    return { success: true };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('YouTube ' + rating + ' gagal: ' + msg);
  }
}

async function subscribeYoutube(url, token) {
  try {
    // Extract channel ID dari URL video
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) throw new Error('Tidak bisa extract Video ID dari URL');

    // Ambil channel ID dari video
    const videoRes = await axios.get(
      'https://www.googleapis.com/youtube/v3/videos',
      { params: { part: 'snippet', id: videoId },
        headers: { Authorization: 'Bearer ' + token } }
    );
    const channelId = videoRes.data.items?.[0]?.snippet?.channelId;
    if (!channelId) throw new Error('Channel ID tidak ditemukan');

    // Subscribe ke channel
    const res = await axios.post(
      'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet',
      { snippet: { resourceId: { kind: 'youtube#channel', channelId } } },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('YouTube subscribe gagal: ' + msg);
  }
}

async function commentYoutube(url, token, message) {
  try {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) throw new Error('Tidak bisa extract Video ID dari URL');

    const res = await axios.post(
      'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet',
      {
        snippet: {
          videoId,
          topLevelComment: {
            snippet: { textOriginal: message }
          }
        }
      },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error('YouTube komen gagal: ' + msg);
  }
}

function extractYoutubeVideoId(url) {
  try {
    const patterns = [
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtu\.be\/([^?]+)/,
      /youtube\.com\/shorts\/([^?]+)/,
      /youtube\.com\/embed\/([^?]+)/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  } catch { return null; }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { runAmplifyJob };
