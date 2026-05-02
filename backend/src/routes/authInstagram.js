const router = require('express').Router();
const axios = require('axios');
const { SocialAccount } = require('../models');
const { protect } = require('../middleware/auth');

// Instagram Login API pakai App ID tersendiri (bukan META_APP_ID)
const APP_ID = process.env.INSTAGRAM_APP_ID;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI;

// Step 1 — Generate Instagram OAuth URL (tanpa Facebook Page)
router.get('/instagram', protect, (req, res) => {
  if (!APP_ID || !REDIRECT_URI) {
    return res.status(500).json({ message: 'INSTAGRAM_REDIRECT_URI belum diset di environment' });
  }

  const scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
  ].join(',');

  const state = req.user._id.toString();
  const url = `https://www.instagram.com/oauth/authorize` +
    `?client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scopes}` +
    `&state=${state}`;

  console.log('[Instagram Login] state:', state, 'redirect_uri:', REDIRECT_URI);
  res.json({ url });
});

// Step 2 — Callback: tukar code → token → simpan akun
router.get('/instagram/callback', async (req, res) => {
  const FE = process.env.FRONTEND_URL;
  try {
    const { code, state: userId, error } = req.query;

    if (error) {
      console.error('[Instagram Login] User denied:', error);
      return res.redirect(`${FE}/users?error=instagram_denied`);
    }
    if (!code) return res.redirect(`${FE}/users?error=instagram_no_code`);

    // Tukar code dengan short-lived token
    const body = new URLSearchParams({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code,
    });

    const tokenRes = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token: shortToken, user_id: igUserId } = tokenRes.data;
    console.log('[Instagram Login] short token ok, ig_user_id:', igUserId);

    // Tukar ke long-lived token (berlaku 60 hari)
    const longTokenRes = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: APP_SECRET,
        access_token: shortToken,
      },
    });
    const longToken = longTokenRes.data.access_token;
    const expiresIn = longTokenRes.data.expires_in || 5184000;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // Ambil info profil Instagram
    const userRes = await axios.get('https://graph.instagram.com/me', {
      params: {
        fields: 'id,username,name,account_type',
        access_token: longToken,
      },
    });
    const igUser = userRes.data;
    console.log('[Instagram Login] user:', igUser.username, 'type:', igUser.account_type);

    // Simpan ke database
    await SocialAccount.findOneAndUpdate(
      { owner: userId, platform: 'instagram', platformUserId: igUser.id },
      {
        owner: userId,
        label: `@${igUser.username}`,
        platform: 'instagram',
        platformUserId: igUser.id,
        platformUsername: igUser.username,
        accessToken: longToken,
        tokenExpiresAt,
        isActive: true,
      },
      { upsert: true, new: true }
    );

    res.redirect(`${FE}/users?connected=instagram`);
  } catch (err) {
    console.error('[Instagram Login] Error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}/users?error=instagram_oauth_failed`);
  }
});

module.exports = router;
