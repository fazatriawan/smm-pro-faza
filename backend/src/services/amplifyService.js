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
  const pageId = account.pageId || account.platformUserId;

  if (!token) throw new Error('Token tidak ada');

  const postId = extractFacebookPostId(targetUrl);
  if (!postId) throw new Error('Tidak bisa extract Post ID dari URL: ' + targetUrl);

  console.log('[Amplify] PostID:', postId, 'Action:', action.type, 'PageID:', pageId);

  switch (action.type) {
    case 'like':
      return await likePost(pageId, postId, token);
    case 'comment':
      const commentText = getRandomComment(action.commentTemplates, accountIndex);
      return await commentPost(pageId, postId, token, commentText);
    case 'share':
      return await sharePost(pageId, postId, token);
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { runAmplifyJob };
