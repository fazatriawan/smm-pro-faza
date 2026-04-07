const axios = require('axios');
const crypto = require('crypto');

async function amplify(config, settings, onLog) {
  const { accounts, targetUrls, actions, commentTemplates, platform } = config;
  const delay = () => (settings.delayMin + Math.random() * (settings.delayMax - settings.delayMin)) * 1000;

  onLog({ type: 'info', message: `Memulai amplifikasi ${platform} — ${accounts.length} akun, ${targetUrls.length} URL, ${actions.length} aksi` });

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    onLog({ type: 'info', message: `[${i+1}/${accounts.length}] Akun: ${account.label || account.username}` });

    for (const url of targetUrls) {
      for (const action of actions) {
        try {
          await performApiAction(account, platform, action, url, commentTemplates, i, onLog);
          onLog({ type: 'success', message: `✅ ${action} berhasil di ${url.slice(0, 50)}` });
        } catch (err) {
          onLog({ type: 'error', message: `❌ ${action} gagal: ${err.message}` });
        }
        await sleep(delay());
      }
    }

    if (i < accounts.length - 1) {
      const rest = settings.restBetweenAccounts * 1000;
      onLog({ type: 'info', message: `Istirahat ${settings.restBetweenAccounts} detik...` });
      await sleep(rest);
    }
  }

  onLog({ type: 'success', message: '🎉 Amplifikasi selesai!' });
}

async function performApiAction(account, platform, action, url, commentTemplates, index, onLog) {
  const token = account.accessToken;
  const userId = account.platformUserId;

  switch (platform) {
    case 'youtube': return await youtubeAction(action, url, token, commentTemplates, index, onLog);
    case 'facebook': return await facebookAction(action, url, token, userId, commentTemplates, index, onLog);
    case 'instagram': return await instagramAction(action, url, token, commentTemplates, index, onLog);
    case 'twitter': return await twitterAction(action, url, token, userId, commentTemplates, index, onLog);
    case 'threads': return await threadsAction(action, url, token, userId, commentTemplates, index, onLog);
    default: throw new Error(`Platform ${platform} belum didukung`);
  }
}

// ─── YOUTUBE ──────────────────────────────────────────────────────────────
async function youtubeAction(action, url, token, commentTemplates, index, onLog) {
  const videoId = extractYoutubeId(url);
  if (!videoId) throw new Error('Video ID tidak ditemukan');

  switch (action) {
    case 'like':
    case 'dislike':
      await axios.post('https://www.googleapis.com/youtube/v3/videos/rate', null, {
        params: { id: videoId, rating: action },
        headers: { Authorization: `Bearer ${token}` }
      });
      break;
    case 'comment':
      const ytComment = getComment(commentTemplates, index);
      await axios.post(
        'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet',
        { snippet: { videoId, topLevelComment: { snippet: { textOriginal: ytComment } } } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      break;
    case 'subscribe':
      const videoRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'snippet', id: videoId },
        headers: { Authorization: `Bearer ${token}` }
      });
      const channelId = videoRes.data.items?.[0]?.snippet?.channelId;
      if (!channelId) throw new Error('Channel ID tidak ditemukan');
      await axios.post(
        'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet',
        { snippet: { resourceId: { kind: 'youtube#channel', channelId } } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      break;
    case 'save':
      await axios.post(
        'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
        { snippet: { playlistId: 'WL', resourceId: { kind: 'youtube#video', videoId } } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk YouTube`);
  }
}

// ─── FACEBOOK ─────────────────────────────────────────────────────────────
async function facebookAction(action, url, token, userId, commentTemplates, index, onLog) {
  const postId = extractFacebookId(url);
  if (!postId) throw new Error('Post ID tidak ditemukan');

  switch (action) {
    case 'like':
      await axios.post(`https://graph.facebook.com/v18.0/${postId}/likes`, null, { params: { access_token: token } });
      break;
    case 'comment':
      const fbComment = getComment(commentTemplates, index);
      await axios.post(`https://graph.facebook.com/v18.0/${postId}/comments`, null, { params: { message: fbComment, access_token: token } });
      break;
    case 'share':
      await axios.post(`https://graph.facebook.com/v18.0/${userId}/feed`, null, {
        params: { link: url, access_token: token }
      });
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Facebook`);
  }
}

// ─── INSTAGRAM ────────────────────────────────────────────────────────────
async function instagramAction(action, url, token, commentTemplates, index, onLog) {
  const shortcode = url.match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/)?.[1];
  if (!shortcode) throw new Error('Post ID Instagram tidak ditemukan');

  const mediaRes = await axios.get('https://graph.instagram.com/v18.0/me/media', {
    params: { fields: 'id,shortcode', access_token: token }
  });
  const media = mediaRes.data.data?.find(m => m.shortcode === shortcode);
  if (!media) throw new Error('Media tidak ditemukan');

  switch (action) {
    case 'like':
      await axios.post(`https://graph.instagram.com/v18.0/${media.id}/likes`, null, { params: { access_token: token } });
      break;
    case 'comment':
      const igComment = getComment(commentTemplates, index);
      await axios.post(`https://graph.instagram.com/v18.0/${media.id}/comments`, null, { params: { message: igComment, access_token: token } });
      break;
    case 'save':
      await axios.post(`https://graph.instagram.com/v18.0/${media.id}/saved`, null, { params: { access_token: token } });
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Instagram`);
  }
}

// ─── TWITTER ──────────────────────────────────────────────────────────────
async function twitterAction(action, url, token, userId, commentTemplates, index, onLog) {
  const tweetId = url.match(/status\/([0-9]+)/)?.[1];
  if (!tweetId) throw new Error('Tweet ID tidak ditemukan');

  switch (action) {
    case 'like':
      await axios.post(`https://api.twitter.com/2/users/${userId}/likes`, { tweet_id: tweetId }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      break;
    case 'retweet':
      await axios.post(`https://api.twitter.com/2/users/${userId}/retweets`, { tweet_id: tweetId }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      break;
    case 'comment':
      const twComment = getComment(commentTemplates, index);
      await axios.post('https://api.twitter.com/2/tweets',
        { text: twComment, reply: { in_reply_to_tweet_id: tweetId } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      break;
    case 'bookmark':
      await axios.post(`https://api.twitter.com/2/users/${userId}/bookmarks`, { tweet_id: tweetId }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Twitter`);
  }
}

// ─── THREADS ──────────────────────────────────────────────────────────────
async function threadsAction(action, url, token, userId, commentTemplates, index, onLog) {
  const postId = url.match(/threads\.net\/@[^/]+\/post\/([A-Za-z0-9_-]+)/)?.[1];
  if (!postId) throw new Error('Post ID Threads tidak ditemukan');

  switch (action) {
    case 'like':
      await axios.post(`https://graph.threads.net/v1.0/${postId}/likes`, null, { params: { access_token: token } });
      break;
    case 'comment':
    case 'reply':
      const thComment = getComment(commentTemplates, index);
      const containerRes = await axios.post(`https://graph.threads.net/v1.0/${userId}/threads`, null, {
        params: { media_type: 'TEXT', text: thComment, reply_to_id: postId, access_token: token }
      });
      await axios.post(`https://graph.threads.net/v1.0/${userId}/threads_publish`, null, {
        params: { creation_id: containerRes.data.id, access_token: token }
      });
      break;
    case 'repost':
      await axios.post(`https://graph.threads.net/v1.0/${postId}/repost`, null, { params: { access_token: token } });
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Threads`);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────
function extractYoutubeId(url) {
  const patterns = [/youtube\.com\/watch\?v=([^&]+)/, /youtu\.be\/([^?]+)/, /youtube\.com\/shorts\/([^?]+)/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function extractFacebookId(url) {
  const patterns = [/\/reel\/(\d+)/, /\/posts\/(\d+)/, /fbid=(\d+)/, /story_fbid=(\d+)/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  const storyMatch = url.match(/story_fbid=([A-Za-z0-9]+)/);
  const idMatch = url.match(/id=(\d+)/);
  if (storyMatch && idMatch) return `${idMatch[1]}_${storyMatch[1]}`;
  return null;
}

function getComment(templates, index) {
  if (!templates || templates.length === 0) return 'Bagus!';
  return templates[index % templates.length];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { amplify };
