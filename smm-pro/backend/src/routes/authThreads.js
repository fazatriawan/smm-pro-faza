const router = require('express').Router();
const axios = require('axios');
const { SocialAccount } = require('../models');
const { protect } = require('../middleware/auth');

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const THREADS_REDIRECT_URI = process.env.THREADS_REDIRECT_URI || 'https://smm-pro-faza.onrender.com/api/auth/threads/callback';

// Step 1 — Redirect ke Threads login
router.get('/threads', protect, (req, res) => {
  const scopes = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_replies',
    'threads_read_engagement'
  ].join(',');

  const state = req.user._id.toString();
  const url = `https://threads.net/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(THREADS_REDIRECT_URI)}&scope=${scopes}&response_type=code&state=${state}`;
  res.json({ url });
});

// Step 2 — Callback
router.get('/threads/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/users?error=no_code`);

    // Tukar code dengan short-lived token
    const tokenRes = await axios.post(
      'https://graph.threads.net/oauth/access_token',
      new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: THREADS_REDIRECT_URI,
        code
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const shortToken = tokenRes.data.access_token;
    const threadsUserId = tokenRes.data.user_id;

    // Tukar ke long-lived token (60 hari)
    const longTokenRes = await axios.get('https://graph.threads.net/access_token', {
      params: {
        grant_type: 'th_exchange_token',
        client_secret: META_APP_SECRET,
        access_token: shortToken
      }
    });

    const longToken = longTokenRes.data.access_token;
    const expiresIn = longTokenRes.data.expires_in || 5184000;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // Ambil info profil
    const profileRes = await axios.get(`https://graph.threads.net/v1.0/${threadsUserId}`, {
      params: {
        fields: 'id,username,name,threads_profile_picture_url,threads_biography',
        access_token: longToken
      }
    });

    const profile = profileRes.data;

    // Simpan akun Threads
    await SocialAccount.findOneAndUpdate(
      { owner: userId, platform: 'threads', platformUserId: profile.id },
      {
        owner: userId,
        label: `@${profile.username}`,
        platform: 'threads',
        platformUserId: profile.id,
        platformUsername: profile.username,
        accessToken: longToken,
        tokenExpiresAt,
        isActive: true
      },
      { upsert: true, new: true }
    );

    res.redirect(`${process.env.FRONTEND_URL}/users?connected=threads`);
  } catch (err) {
    console.error('Threads OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}/users?error=threads_failed`);
  }
});

module.exports = router;
