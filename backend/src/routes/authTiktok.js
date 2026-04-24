const router = require('express').Router();
const axios = require('axios');
const crypto = require('crypto');
const { SocialAccount } = require('../models');
const { protect } = require('../middleware/auth');

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI  = process.env.TIKTOK_WEB_REDIRECT_URI;

const stateStore = {};

// Custom form encoding matching TikTok spec
const formEncode = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Step 1 — Redirect ke TikTok login
router.get('/tiktok', protect, (req, res) => {
  const state        = crypto.randomBytes(16).toString('hex');
  const chars        = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes        = crypto.randomBytes(64);
  const codeVerifier = Array.from(bytes, b => chars[b % 62]).join('');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier)
    .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  stateStore[state] = { userId: req.user._id.toString(), codeVerifier };

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key',            CLIENT_KEY);
  url.searchParams.set('response_type',         'code');
  url.searchParams.set('scope',                 'user.info.basic,video.upload,video.publish');
  url.searchParams.set('redirect_uri',          REDIRECT_URI);
  url.searchParams.set('state',                 state);
  url.searchParams.set('code_challenge',        codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  res.json({ url: url.toString() });
});

// Step 2 — Callback
router.get('/tiktok/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(`${process.env.FRONTEND_URL}/users?error=no_code`);

    const stateData = stateStore[state];
    if (!stateData) return res.redirect(`${process.env.FRONTEND_URL}/users?error=invalid_state`);

    const { userId, codeVerifier } = stateData;
    delete stateStore[state];

    const bodyStr = `client_key=${formEncode(CLIENT_KEY)}`
      + `&client_secret=${formEncode(CLIENT_SECRET)}`
      + `&code=${formEncode(code)}`
      + `&grant_type=authorization_code`
      + `&redirect_uri=${formEncode(REDIRECT_URI)}`
      + `&code_verifier=${formEncode(codeVerifier)}`;

    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', bodyStr, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' }
    });

    const tokenData = tokenRes.data;
    const errCode = tokenData.error?.code ?? tokenData.error;
    if (errCode && errCode !== 'ok') {
      console.error('TikTok token error:', tokenData);
      return res.redirect(`${process.env.FRONTEND_URL}/users?error=token_failed`);
    }

    const data = tokenData.data || tokenData;
    const { access_token, refresh_token, expires_in, open_id } = data;

    // Fetch user info
    const infoRes = await axios.get(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const user = infoRes.data?.data?.user || {};
    const username = user.username || user.display_name || open_id;

    await SocialAccount.findOneAndUpdate(
      { owner: userId, platform: 'tiktok', platformUserId: open_id },
      {
        owner: userId,
        label: `@${username}`,
        platform: 'tiktok',
        platformUserId: open_id,
        platformUsername: username,
        accessToken: access_token,
        refreshToken: refresh_token || null,
        tokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
        isActive: true,
      },
      { upsert: true, new: true }
    );

    res.redirect(`${process.env.FRONTEND_URL}/users?connected=tiktok`);
  } catch (err) {
    console.error('TikTok OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}/users?error=tiktok_failed`);
  }
});

module.exports = router;
