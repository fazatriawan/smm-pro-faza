const axios = require('axios');
const { AmplifyJob } = require('../models');

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
        results.push({ account: account._id, action: action.type, success: true, executedAt: new Date() });
        console.log('[Amplify] SUCCESS:', action.type, 'by', account.label || account.platformUserId);
      } catch (err) {
        results.push({ account: account._id, action: action.type, success: false, error: err.message, executedAt: new Date() });
        console.log('[Amplify] FAILED:', action.type, 'by', account.label || account.platformUserId, '-', err.message);
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

async function executeAction(account, targetUrl, action, accountIndex) {
  let token = account.accessToken;
  const actorId = account.platformUserId;
  const isPersonal = account.platform === 'facebook_personal';

  if (!token) throw new Error('Token tidak ada');

  console.log('[Amplify] Action:', action.type, '| Platform:', account.platform, '| URL:', targetUrl);

  // ─── YOUTUBE ───────────────────────────────────────────────
  if (account.platform === 'youtube') {
    // Wrapper function agar mudah di-retry
    const doYoutubeAction = async (currentToken) => {
      switch (action.type) {
        case 'like': return await likeYoutube(targetUrl, currentToken, 'like');
        case 'dislike': return await likeYoutube(targetUrl, currentToken, 'dislike');
        case 'comment':
          return await commentYoutube(targetUrl, currentToken, getRandomComment(action.commentTemplates, accountIndex));
        case 'subscribe': return await subscribeYoutube(targetUrl, currentToken);
        case 'save': return await saveYoutube(targetUrl, currentToken);
        default: throw new Error('Aksi ' + action.type + ' tidak tersedia untuk YouTube');
      }
    };

    try {
      // Percobaan Pertama
      return await doYoutubeAction(token);
    } catch (err) {
      // Jika error karena Token Expired (401)
      if (err.status === 401 || err.message.includes('authentication credentials')) {
        console.log(`[Amplify] Token YouTube expired, mencoba auto-refresh...`);
        token = await refreshYouTubeToken(account); // Ambil token baru
        return await doYoutubeAction(token); // Percobaan Kedua dengan token baru
      }
      throw err; // Lempar error jika bukan karena token expired
    }
  }

  // ─── INSTAGRAM ─────────────────────────────────────────────
  if (account.platform === 'instagram') {
    switch (action.type) {
      case 'like': return await likeInstagram(targetUrl, token);
      case 'comment':
        return await commentInstagram(targetUrl, token, getRandomComment(action.commentTemplates, accountIndex));
      case 'save': return await saveInstagram(targetUrl, token);
      case 'follow': throw new Error('Follow Instagram via API tidak tersedia');
      default: throw new Error('Aksi ' + action.type + ' tidak tersedia untuk Instagram');
    }
  }

  // ─── TWITTER ───────────────────────────────────────────────
  if (account.platform === 'twitter') {
    switch (action.type) {
      case 'like': return await likeTweet(targetUrl, token, actorId);
      case 'comment':
        return await replyTweet(targetUrl, token, getRandomComment(action.commentTemplates, accountIndex));
      case 'share': return await retweetTweet(targetUrl, token, actorId);
      case 'bookmark': return await bookmarkTweet(targetUrl, token, actorId);
      case 'follow': throw new Error('Follow Twitter belum diimplementasikan');
      default: throw new Error('Aksi ' + action.type + ' tidak tersedia untuk Twitter');
    }
  }

  // ─── TIKTOK ────────────────────────────────────────────────
  if (account.platform === 'tiktok') {
    switch (action.type) {
      case 'repost': return await repostTiktok(targetUrl, token);
      case 'share': throw new Error('Share TikTok via API belum tersedia');
      case 'follow': throw new Error('Follow TikTok via API belum tersedia');
      default: throw new Error('Aksi ' + action.type + ' tidak tersedia untuk TikTok');
    }
  }

  // ─── FACEBOOK ──────────────────────────────────────────────
  const postId = extractFacebookPostId(targetUrl);
  if (!postId) throw new Error('Tidak bisa extract Post ID dari URL: ' + targetUrl);

  console.log('[Amplify] Facebook PostID:', postId);

  switch (action.type) {
    case 'like': return await likePost(actorId, postId, token);
    case 'comment':
      return await commentPost(actorId, postId, token, getRandomComment(action.commentTemplates, accountIndex));
    case 'share': return await sharePost(actorId, postId, token, isPersonal);
    default: throw new Error('Aksi ' + action.type + ' tidak tersedia untuk Facebook');
  }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
async function refreshYouTubeToken(account) {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', null, {
      params: {
        client_id: process.env.YOUTUBE_CLIENT_ID,        
        client_secret: process.env.YOUTUBE_CLIENT_SECRET, 
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token'
      }
    });
    
    account.accessToken = response.data.access_token;
    await account.save();
    return response.data.access_token;
  } catch (error) {
    console.error("Gagal refresh token YouTube:", error.response?.data || error.message);
    throw new Error("Sesi YouTube telah habis permanen. Harap Re-auth di Dashboard.");
  }
}

function getRandomComment(templates, index) {
  if (!templates || templates.length === 0) return 'Bagus!';
  return templates[index % templates.length];
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
  } catch { return null; }
}

function extractYoutubeVideoId(url) {
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
}

// ─── YOUTUBE FUNCTIONS ─────────────────────────────────────────────────────
async function likeYoutube(url, token, rating = 'like') {
  try {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) throw new Error('Video ID tidak ditemukan');
    await axios.post(
      'https://www.googleapis.com/youtube/v3/videos/rate',
      null,
      { params: { id: videoId, rating }, headers: { Authorization: 'Bearer ' + token } }
    );
    return { success: true };
  } catch (err) {
    const customErr = new Error('YouTube ' + rating + ' gagal: ' + (err.response?.data?.error?.message || err.message));
    customErr.status = err.response?.status; // Simpan status code untuk deteksi 401
    throw customErr;
  }
}

async function commentYoutube(url, token, message) {
  try {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) throw new Error('Video ID tidak ditemukan');
    const res = await axios.post(
      'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet',
      { snippet: { videoId, topLevelComment: { snippet: { textOriginal: message } } } },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    const customErr = new Error('YouTube komen gagal: ' + (err.response?.data?.error?.message || err.message));
    customErr.status = err.response?.status;
    throw customErr;
  }
}

async function subscribeYoutube(url, token) {
  try {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) throw new Error('Video ID tidak ditemukan');
    const videoRes = await axios.get(
      'https://www.googleapis.com/youtube/v3/videos',
      { params: { part: 'snippet', id: videoId }, headers: { Authorization: 'Bearer ' + token } }
    );
    const channelId = videoRes.data.items?.[0]?.snippet?.channelId;
    if (!channelId) throw new Error('Channel ID tidak ditemukan');
    const res = await axios.post(
      'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet',
      { snippet: { resourceId: { kind: 'youtube#channel', channelId } } },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    const customErr = new Error('YouTube subscribe gagal: ' + (err.response?.data?.error?.message || err.message));
    customErr.status = err.response?.status;
    throw customErr;
  }
}

async function saveYoutube(url, token) {
  try {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) throw new Error('Video ID tidak ditemukan');
    const res = await axios.post(
      'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
      { snippet: { playlistId: 'WL', resourceId: { kind: 'youtube#video', videoId } } },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    const customErr = new Error('YouTube save gagal: ' + (err.response?.data?.error?.message || err.message));
    customErr.status = err.response?.status;
    throw customErr;
  }
}

// ─── INSTAGRAM FUNCTIONS ───────────────────────────────────────────────────
async function extractInstagramMediaId(url, token) {
  const match = url.match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('URL Instagram tidak valid');
  const shortcode = match[1];
  const res = await axios.get('https://graph.instagram.com/v18.0/me/media', {
    params: { fields: 'id,shortcode', access_token: token }
  });
  const media = res.data.data?.find(m => m.shortcode === shortcode);
  if (!media) throw new Error('Media tidak ditemukan atau bukan milik akun ini');
  return media.id;
}

async function likeInstagram(url, token) {
  try {
    const mediaId = await extractInstagramMediaId(url, token);
    const res = await axios.post(
      'https://graph.instagram.com/v18.0/' + mediaId + '/likes',
      null,
      { params: { access_token: token } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Instagram like gagal: ' + (err.response?.data?.error?.message || err.message));
  }
}

async function commentInstagram(url, token, message) {
  try {
    const mediaId = await extractInstagramMediaId(url, token);
    const res = await axios.post(
      'https://graph.instagram.com/v18.0/' + mediaId + '/comments',
      null,
      { params: { message, access_token: token } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Instagram komen gagal: ' + (err.response?.data?.error?.message || err.message));
  }
}

async function saveInstagram(url, token) {
  try {
    const mediaId = await extractInstagramMediaId(url, token);
    const res = await axios.post(
      'https://graph.instagram.com/v18.0/' + mediaId + '/saved',
      null,
      { params: { access_token: token } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Instagram save gagal: ' + (err.response?.data?.error?.message || err.message));
  }
}

// ─── TWITTER FUNCTIONS ─────────────────────────────────────────────────────
function extractTwitterTweetId(url) {
  const match = url.match(/status\/([0-9]+)/);
  return match ? match[1] : null;
}

async function likeTweet(url, token, userId) {
  try {
    const tweetId = extractTwitterTweetId(url);
    if (!tweetId) throw new Error('Tweet ID tidak ditemukan');
    const res = await axios.post(
      'https://api.twitter.com/2/users/' + userId + '/likes',
      { tweet_id: tweetId },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Twitter like gagal: ' + (err.response?.data?.detail || err.message));
  }
}

async function replyTweet(url, token, message) {
  try {
    const tweetId = extractTwitterTweetId(url);
    if (!tweetId) throw new Error('Tweet ID tidak ditemukan');
    const res = await axios.post(
      'https://api.twitter.com/2/tweets',
      { text: message, reply: { in_reply_to_tweet_id: tweetId } },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Twitter reply gagal: ' + (err.response?.data?.detail || err.message));
  }
}

async function retweetTweet(url, token, userId) {
  try {
    const tweetId = extractTwitterTweetId(url);
    if (!tweetId) throw new Error('Tweet ID tidak ditemukan');
    const res = await axios.post(
      'https://api.twitter.com/2/users/' + userId + '/retweets',
      { tweet_id: tweetId },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Retweet gagal: ' + (err.response?.data?.detail || err.message));
  }
}

async function bookmarkTweet(url, token, userId) {
  try {
    const tweetId = extractTwitterTweetId(url);
    if (!tweetId) throw new Error('Tweet ID tidak ditemukan');
    const res = await axios.post(
      'https://api.twitter.com/2/users/' + userId + '/bookmarks',
      { tweet_id: tweetId },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Bookmark gagal: ' + (err.response?.data?.detail || err.message));
  }
}

// ─── TIKTOK FUNCTIONS ──────────────────────────────────────────────────────
async function repostTiktok(url, token) {
  try {
    const match = url.match(/video\/([0-9]+)/);
    if (!match) throw new Error('Video ID TikTok tidak ditemukan');
    const res = await axios.post(
      'https://open.tiktokapis.com/v2/repost/create/',
      { item_id: match[1] },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    throw new Error('TikTok repost gagal: ' + (err.response?.data?.error?.message || err.message));
  }
}

// ─── FACEBOOK FUNCTIONS ────────────────────────────────────────────────────
async function likePost(pageId, postId, token) {
  try {
    const res = await axios.post(
      'https://graph.facebook.com/v18.0/' + postId + '/likes',
      null,
      { params: { access_token: token } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Like gagal: ' + (err.response?.data?.error?.message || err.message));
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
    throw new Error('Komen gagal: ' + (err.response?.data?.error?.message || err.message));
  }
}

async function sharePost(pageId, postId, token, isPersonal) {
  try {
    const res = await axios.post(
      'https://graph.facebook.com/v18.0/' + pageId + '/feed',
      null,
      { params: { link: 'https://www.facebook.com/' + postId, access_token: token } }
    );
    return res.data;
  } catch (err) {
    throw new Error('Share gagal: ' + (err.response?.data?.error?.message || err.message));
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { runAmplifyJob };