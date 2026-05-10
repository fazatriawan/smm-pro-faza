const router = require('express').Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const { SocialAccount } = require('../models');
const { verifyAccountStatus, verifyAllAccounts } = require('../services/accountStatusService');
const { refreshTokenIfNeeded } = require('../services/tokenRefreshService');
const { encrypt, decrypt } = require('../utils/crypto');

// ─── Helper: fetch posts per platform ────────────────────────────────────────
async function fetchInstagramPosts(account, limit) {
  const res = await axios.get(`https://graph.instagram.com/${account.platformUserId}/media`, {
    params: { fields: 'id,caption,media_type,permalink,timestamp,thumbnail_url,media_url', access_token: account.accessToken, limit }
  });
  return (res.data.data || []).map(p => ({
    id: p.id,
    url: p.permalink,
    caption: p.caption || '',
    thumbnail: p.thumbnail_url || p.media_url || null,
    type: p.media_type?.toLowerCase() || 'image',
    date: p.timestamp,
  }));
}

async function fetchFacebookPosts(account, limit) {
  const pageId = account.pageId || account.platformUserId;
  const res = await axios.get(`https://graph.facebook.com/v18.0/${pageId}/posts`, {
    params: { fields: 'id,message,permalink_url,created_time,full_picture', access_token: account.accessToken, limit }
  });
  return (res.data.data || []).map(p => ({
    id: p.id,
    url: p.permalink_url,
    caption: p.message || '',
    thumbnail: p.full_picture || null,
    type: 'post',
    date: p.created_time,
  }));
}

async function fetchYoutubePosts(account, limit) {
  const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails', mine: true },
    headers: { Authorization: `Bearer ${account.accessToken}` }
  });
  const uploadsId = channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error('Tidak bisa menemukan playlist uploads YouTube');

  const listRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: { part: 'snippet', playlistId: uploadsId, maxResults: limit },
    headers: { Authorization: `Bearer ${account.accessToken}` }
  });
  return (listRes.data.items || []).map(item => {
    const videoId = item.snippet?.resourceId?.videoId;
    return {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      caption: item.snippet?.title || '',
      thumbnail: item.snippet?.thumbnails?.medium?.url || null,
      type: 'video',
      date: item.snippet?.publishedAt,
    };
  });
}

async function fetchThreadsPosts(account, limit) {
  const res = await axios.get(`https://graph.threads.net/v1.0/${account.platformUserId}/threads`, {
    params: { fields: 'id,text,timestamp,permalink', access_token: account.accessToken, limit }
  });
  return (res.data.data || []).map(p => ({
    id: p.id,
    url: p.permalink,
    caption: p.text || '',
    thumbnail: null,
    type: 'thread',
    date: p.timestamp,
  }));
}

// GET all accounts (admin sees all active, operator sees own active)
router.get('/', protect, async (req, res) => {
  try {
    const { loginType } = req.query;
    const baseFilter = { isActive: true };
    let filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, owner: req.user._id };
    if (loginType) filter = { ...filter, loginType };
    const accounts = await SocialAccount.find(filter)
      .populate('owner', 'name email')
      .sort('-connectedAt');
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET OAuth accounts only
router.get('/oauth', protect, async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { isActive: true, loginType: 'oauth' }
      : { isActive: true, owner: req.user._id, loginType: 'oauth' };
    const accounts = await SocialAccount.find(filter)
      .populate('owner', 'name email')
      .sort('-connectedAt');
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET Automation accounts only
router.get('/automation', protect, async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { isActive: true, loginType: 'automation' }
      : { isActive: true, owner: req.user._id, loginType: 'automation' };
    const accounts = await SocialAccount.find(filter)
      .populate('owner', 'name email')
      .sort('-connectedAt');
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET by user
router.get('/user/:userId', protect, async (req, res) => {
  try {
    const accounts = await SocialAccount.find({ owner: req.params.userId, isActive: true });
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /:id/posts — scrape recent posts from a connected account
router.get('/:id/posts', protect, async (req, res) => {
  try {
    const account = await SocialAccount.findOne({ _id: req.params.id, isActive: true });
    if (!account) return res.status(404).json({ message: 'Akun tidak ditemukan' });
    if (req.user.role !== 'admin' && String(account.owner) !== String(req.user._id))
      return res.status(403).json({ message: 'Forbidden' });

    const SUPPORTED = ['instagram', 'facebook', 'facebook_personal', 'youtube', 'threads'];
    if (!SUPPORTED.includes(account.platform))
      return res.status(400).json({ message: `Platform ${account.platform} belum didukung untuk fitur ini` });

    await refreshTokenIfNeeded(account).catch(e =>
      console.warn(`[PostBrowser] Refresh token gagal: ${e.message}`)
    );

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    let posts = [];

    if (account.platform === 'instagram') posts = await fetchInstagramPosts(account, limit);
    else if (account.platform === 'facebook' || account.platform === 'facebook_personal') posts = await fetchFacebookPosts(account, limit);
    else if (account.platform === 'youtube') posts = await fetchYoutubePosts(account, limit);
    else if (account.platform === 'threads') posts = await fetchThreadsPosts(account, limit);

    res.json({ posts, account: { label: account.label, platform: account.platform, username: account.platformUsername } });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`[PostBrowser] Error:`, msg);
    res.status(500).json({ message: msg });
  }
});

// POST manually add account (after OAuth, token is stored here)
router.post('/', protect, async (req, res) => {
  try {
    const { label, platform, platformUserId, platformUsername, accessToken, refreshToken, tokenExpiresAt, pageId } = req.body;
    const account = await SocialAccount.create({
      owner: req.user._id, label, platform,
      platformUserId, platformUsername,
      accessToken, refreshToken, tokenExpiresAt, pageId
    });
    res.status(201).json(account);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST create automation account directly from web app (username + password)
router.post('/automation', protect, async (req, res) => {
  try {
    const { label, platform, platformUsername, password } = req.body;
    if (!label || !platform || !platformUsername || !password) {
      return res.status(400).json({ message: 'label, platform, platformUsername, dan password wajib diisi' });
    }
    if (!['instagram', 'facebook', 'twitter', 'youtube', 'tiktok', 'threads'].includes(platform)) {
      return res.status(400).json({ message: 'Platform tidak didukung' });
    }

    const encryptedPassword = encrypt(password);

    const account = await SocialAccount.findOneAndUpdate(
      { owner: req.user._id, platform, platformUserId: platformUsername },
      {
        $set: {
          owner: req.user._id,
          label,
          platform,
          platformUserId: platformUsername,
          platformUsername,
          loginType: 'automation',
          isActive: true,
          connectionStatus: 'unknown',
          automationData: {
            password: encryptedPassword,
            cookies: null,
            userAgent: null,
            lastLoginAt: null,
          }
        }
      },
      { upsert: true, new: true }
    );

    // Don't return password in response
    const response = account.toObject();
    if (response.automationData?.password) {
      response.automationData.password = '***ENCRYPTED***';
    }

    res.status(201).json({ message: 'Akun automation berhasil ditambahkan', account: response });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH update warmup settings
router.patch('/:id/warmup', protect, async (req, res) => {
  try {
    const account = await SocialAccount.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
      { $set: { warmup: req.body } },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json(account);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE / deactivate
router.delete('/:id', protect, async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, owner: req.user._id };
    const account = await SocialAccount.findOneAndUpdate(
      filter,
      { isActive: false },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json({ message: 'Account disconnected' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH update access token
router.patch('/:id', protect, async (req, res) => {
  try {
    const { accessToken } = req.body;
    const account = await SocialAccount.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { accessToken } },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json(account);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST sync accounts from desktop app (automation accounts) - uses API key
router.post('/sync-desktop', async (req, res) => {
  try {
    // Simple API key auth for desktop sync
    const apiKey = req.headers['x-desktop-api-key'];
    if (apiKey !== process.env.DESKTOP_API_KEY) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const { userId, accounts } = req.body;
    if (!userId || !accounts) {
      return res.status(400).json({ message: 'userId and accounts required' });
    }

    const results = [];
    for (const acc of accounts) {
      const update = {
        owner: userId,
        label: acc.label || acc.username,
        platform: acc.platform,
        platformUserId: acc.platformUserId || acc.username,
        platformUsername: acc.platformUsername || acc.username,
        loginType: 'automation',
        isActive: true,
        automationData: {
          password: acc.password,
          cookies: acc.cookies,
          twoFactorSecret: acc.twoFactorSecret,
          userAgent: acc.userAgent,
          lastLoginAt: acc.lastLoginAt,
          lastWarmupAt: acc.lastWarmupAt
        }
      };

      const lookupKey = acc.platformUserId || acc.username;
      const account = await SocialAccount.findOneAndUpdate(
        { owner: userId, platform: acc.platform, platformUserId: lookupKey },
        { $set: update },
        { upsert: true, new: true }
      );
      results.push(account);
    }

    res.status(201).json({ message: 'Accounts synced', count: results.length, accounts: results });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET automation accounts for desktop sync
router.get('/sync-desktop/:userId', async (req, res) => {
  try {
    const apiKey = req.headers['x-desktop-api-key'];
    if (apiKey !== process.env.DESKTOP_API_KEY) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const accounts = await SocialAccount.find({
      owner: req.params.userId,
      isActive: true
    }).sort('-connectedAt');

    // Decrypt automation passwords for desktop app
    const decryptedAccounts = accounts.map(acc => {
      const obj = acc.toObject();
      if (obj.automationData?.password) {
        obj.automationData.password = decrypt(obj.automationData.password);
      }
      return obj;
    });

    res.json(decryptedAccounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE automation account by desktop
router.delete('/sync-desktop/:userId/:platform/:username', async (req, res) => {
  try {
    const apiKey = req.headers['x-desktop-api-key'];
    if (apiKey !== process.env.DESKTOP_API_KEY) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    await SocialAccount.findOneAndUpdate(
      { owner: req.params.userId, platform: req.params.platform, platformUserId: req.params.username },
      { isActive: false }
    );
    res.json({ message: 'Account removed from sync' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST sync accounts from desktop app (automation accounts)
router.post('/sync', protect, async (req, res) => {
  try {
    const { accounts } = req.body;
    const results = [];

    for (const acc of accounts) {
      const update = {
        owner: req.user._id,
        label: acc.label || acc.username,
        platform: acc.platform,
        platformUserId: acc.platformUserId || acc.username,
        platformUsername: acc.platformUsername || acc.username,
        loginType: 'automation',
        isActive: true,
        automationData: {
          password: acc.password,
          cookies: acc.cookies,
          twoFactorSecret: acc.twoFactorSecret,
          userAgent: acc.userAgent,
          lastLoginAt: acc.lastLoginAt,
          lastWarmupAt: acc.lastWarmupAt
        }
      };

      const lookupKey = acc.platformUserId || acc.username;
      const account = await SocialAccount.findOneAndUpdate(
        { owner: req.user._id, platform: acc.platform, platformUserId: lookupKey },
        { $set: update },
        { upsert: true, new: true }
      );
      results.push(account);
    }

    res.status(201).json({ message: 'Accounts synced', count: results.length, accounts: results });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE automation account by platform + username (for desktop sync)
router.delete('/sync/:platform/:username', protect, async (req, res) => {
  try {
    await SocialAccount.findOneAndUpdate(
      { owner: req.user._id, platform: req.params.platform, platformUserId: req.params.username },
      { isActive: false }
    );
    res.json({ message: 'Account removed from sync' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST verify single account status
router.post('/:id/verify', protect, async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { _id: req.params.id, isActive: true }
      : { _id: req.params.id, owner: req.user._id, isActive: true };

    const account = await SocialAccount.findOne(filter);
    if (!account) return res.status(404).json({ message: 'Akun tidak ditemukan' });

    const status = await verifyAccountStatus(account);

    // Update DB
    await SocialAccount.findByIdAndUpdate(account._id, {
      connectionStatus: status.status,
      lastVerifiedAt: new Date(),
      statusMessage: status.message
    });

    res.json({ accountId: account._id, ...status });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST verify all accounts status
router.post('/verify-all', protect, async (req, res) => {
  try {
    const results = await verifyAllAccounts(req.user._id, req.user.role === 'admin');
    res.json({
      message: `${results.length} akun diverifikasi`,
      connected: results.filter(r => r.status === 'connected').length,
      disconnected: results.filter(r => r.status === 'disconnected').length,
      expired: results.filter(r => r.status === 'expired').length,
      unknown: results.filter(r => r.status === 'unknown').length,
      results
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
