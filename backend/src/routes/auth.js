const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { User, SocialAccount } = require('../models');
const { protect } = require('../middleware/auth');

// ── TikTok Web OAuth (inline agar selalu terdaftar) ───────────────────────────
const _ttStateStore = {};

router.get('/tiktok', protect, (req, res) => {
  const CLIENT_KEY   = process.env.TIKTOK_CLIENT_KEY;
  const REDIRECT_URI = process.env.TIKTOK_WEB_REDIRECT_URI;

  const state        = crypto.randomBytes(16).toString('hex');
  const chars        = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes        = crypto.randomBytes(64);
  const codeVerifier = Array.from(bytes, b => chars[b % 62]).join('');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier)
    .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  _ttStateStore[state] = { userId: req.user._id.toString(), codeVerifier, ts: Date.now() };
  console.log('[TikTok Web] state generated:', state, 'userId:', req.user._id, 'redirect_uri:', REDIRECT_URI);

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

router.get('/tiktok/callback', async (req, res) => {
  const FRONTEND_URL  = process.env.FRONTEND_URL;
  const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY;
  const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
  const REDIRECT_URI  = process.env.TIKTOK_WEB_REDIRECT_URI;
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(`${FRONTEND_URL}/users?error=no_code`);

    const stateData = _ttStateStore[state];
    console.log('[TikTok Web CB] state:', state, 'found:', !!stateData, 'store keys:', Object.keys(_ttStateStore).length);
    if (!stateData) return res.redirect(`${FRONTEND_URL}/users?error=invalid_state`);

    const { userId, codeVerifier } = stateData;
    delete _ttStateStore[state];

    const body = new URLSearchParams({
      client_key:    CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' }
    });

    const tokenData = tokenRes.data;
    const errCode = tokenData.error?.code ?? tokenData.error;
    if (errCode && errCode !== 'ok') {
      console.error('TikTok token error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/users?error=token_failed`);
    }

    const data = tokenData.data || tokenData;
    const { access_token, refresh_token, expires_in, open_id } = data;

    let username = open_id;
    try {
      const infoRes = await axios.get(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const user = infoRes.data?.data?.user || {};
      username = user.username || user.display_name || open_id;
    } catch (e) {
      console.warn('[TikTok] user info skipped:', e.response?.data?.error?.code || e.message);
    }

    await SocialAccount.findOneAndUpdate(
      { owner: userId, platform: 'tiktok', platformUserId: open_id },
      {
        owner: userId, label: `@${username}`, platform: 'tiktok',
        platformUserId: open_id, platformUsername: username,
        accessToken: access_token, refreshToken: refresh_token || null,
        tokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
        isActive: true,
      },
      { upsert: true, new: true }
    );

    res.redirect(`${FRONTEND_URL}/users?connected=tiktok`);
  } catch (err) {
    console.error('TikTok OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}/users?error=tiktok_failed`);
  }
});

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email sudah terdaftar' });
    const user = await User.create({ name, email, password, role });
    const token = signToken(user._id);
    res.status(201).json({ token, user: { id: user._id, name, email, role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Email atau password salah' });
    const token = signToken(user._id);
    res.json({ token, user: { id: user._id, name: user.name, email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Me
router.get('/me', protect, (req, res) => res.json(req.user));

module.exports = router;
