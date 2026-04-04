const router = require('express').Router();
const axios = require('axios');
const { SocialAccount } = require('../models');
const { protect } = require('../middleware/auth');

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI;

// Step 1 — Redirect ke Google login
router.get('/youtube', protect, (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ');

  const state = req.user._id.toString();
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${state}`;
  res.json({ url });
});

// Step 2 — Callback setelah login Google
router.get('/youtube/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/users?error=no_code`);

    // Tukar code dengan token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // Ambil info channel YouTube
    const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet', mine: true },
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const channel = channelRes.data.items?.[0];
    if (!channel) throw new Error('Channel YouTube tidak ditemukan');

    const channelId = channel.id;
    const channelName = channel.snippet.title;
    const channelThumb = channel.snippet.thumbnails?.default?.url;

    // Simpan akun YouTube
    await SocialAccount.findOneAndUpdate(
      { owner: userId, platform: 'youtube', platformUserId: channelId },
      {
        owner: userId,
        label: `@${channelName}`,
        platform: 'youtube',
        platformUserId: channelId,
        platformUsername: channelName,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt,
        isActive: true
      },
      { upsert: true, new: true }
    );

    res.redirect(`${process.env.FRONTEND_URL}/users?connected=youtube`);
  } catch (err) {
    console.error('YouTube OAuth error:', err.message);
    res.redirect(`${process.env.FRONTEND_URL}/users?error=youtube_failed`);
  }
});

module.exports = router;
