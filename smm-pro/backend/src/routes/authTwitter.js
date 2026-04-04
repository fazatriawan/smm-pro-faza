const router = require('express').Router();
const axios = require('axios');
const crypto = require('crypto');
const { SocialAccount } = require('../models');
const { protect } = require('../middleware/auth');

const CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const REDIRECT_URI = process.env.TWITTER_REDIRECT_URI;

const stateStore = {};

router.get('/twitter', protect, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  stateStore[state] = { userId: req.user._id.toString(), codeVerifier };

  const scopes = [
    'tweet.read',
    'tweet.write',
    'users.read',
    'like.read',
    'like.write',
    'offline.access'
  ].join(' ');

  const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  res.json({ url });
});

router.get('/twitter/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(`${process.env.FRONTEND_URL}/users?error=no_code`);

    const stateData = stateStore[state];
    if (!stateData) return res.redirect(`${process.env.FRONTEND_URL}/users?error=invalid_state`);

    const { userId, codeVerifier } = stateData;
    delete stateStore[state];

    // Tukar code dengan token
    const tokenRes = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
        client_id: CLIENT_ID
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const tokenExpiresAt = new Date(Date.now() + (expires_in || 7200) * 1000);

    // Ambil info user
    const userRes = await axios.get('https://api.twitter.com/2/users/me', {
      params: { 'user.fields': 'id,name,username,profile_image_url' },
      headers: { Authorization: 'Bearer ' + access_token }
    });

    const twUser = userRes.data.data;

    // Simpan akun Twitter
    await SocialAccount.findOneAndUpdate(
      { owner: userId, platform: 'twitter', platformUserId: twUser.id },
      {
        owner: userId,
        label: `@${twUser.username}`,
        platform: 'twitter',
        platformUserId: twUser.id,
        platformUsername: twUser.username,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt,
        isActive: true
      },
      { upsert: true, new: true }
    );

    res.redirect(`${process.env.FRONTEND_URL}/users?connected=twitter`);
  } catch (err) {
    console.error('Twitter OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}/users?error=twitter_failed`);
  }
});

module.exports = router;
