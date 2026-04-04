const router = require('express').Router();
const axios = require('axios');
const { SocialAccount } = require('../models');
const { protect } = require('../middleware/auth');

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI;
const META_PERSONAL_REDIRECT_URI = process.env.META_PERSONAL_REDIRECT_URI || 
  process.env.META_REDIRECT_URI.replace('/callback', '/personal/callback');

// Step 1 — Redirect ke Facebook login (Pages)
router.get('/facebook', protect, (req, res) => {
  const scopes = [
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'public_profile'
  ].join(',');

  const state = req.user._id.toString();
  const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&scope=${scopes}&state=${state}`;
  res.json({ url });
});

// Step 1B — Redirect ke Facebook login (Personal)
router.get('/facebook/personal', protect, (req, res) => {
  const scopes = 'public_profile';

  const state = req.user._id.toString() + ':personal';
  const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&scope=${scopes}&state=${state}`;
  res.json({ url });
});

// Step 2 — Callback (Pages + Personal)
router.get('/meta/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/users?error=no_code`);

    const isPersonal = state?.includes(':personal');
    const userId = state?.replace(':personal', '');

    // Tukar code dengan short token
    const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: META_REDIRECT_URI,
        code
      }
    });
    const shortToken = tokenRes.data.access_token;

    // Tukar ke long-lived token (60 hari)
    const longTokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: shortToken
      }
    });
    const longToken = longTokenRes.data.access_token;
    const expiresIn = longTokenRes.data.expires_in || 5184000; // 60 hari default
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // Ambil info user
    const userRes = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: { access_token: longToken, fields: 'id,name' }
    });
    const fbUser = userRes.data;

    if (isPersonal) {
      // Simpan sebagai akun personal
      await SocialAccount.findOneAndUpdate(
        { owner: userId, platform: 'facebook_personal', platformUserId: fbUser.id },
        {
          owner: userId,
          label: `@${fbUser.name} (Personal)`,
          platform: 'facebook_personal',
          platformUserId: fbUser.id,
          platformUsername: fbUser.name,
          accessToken: longToken,
          tokenExpiresAt,
          isActive: true
        },
        { upsert: true, new: true }
      );

      return res.redirect(`${process.env.FRONTEND_URL}/users?connected=personal`);
    }

    // Ambil daftar Pages
    const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: longToken }
    });
    const pages = pagesRes.data.data || [];

    // Simpan setiap Page
    for (const page of pages) {
      await SocialAccount.findOneAndUpdate(
        { owner: userId, platform: 'facebook', platformUserId: page.id },
        {
          owner: userId,
          label: `@${page.name}`,
          platform: 'facebook',
          platformUserId: page.id,
          platformUsername: page.name,
          accessToken: page.access_token,
          pageId: page.id,
          tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );

      // Cek IG bisnis terhubung
      try {
        const igRes = await axios.get(`https://graph.facebook.com/v18.0/${page.id}`, {
          params: { fields: 'instagram_business_account', access_token: page.access_token }
        });
        const igAccount = igRes.data.instagram_business_account;
        if (igAccount) {
          const igInfoRes = await axios.get(`https://graph.facebook.com/v18.0/${igAccount.id}`, {
            params: { fields: 'id,username', access_token: page.access_token }
          });
          await SocialAccount.findOneAndUpdate(
            { owner: userId, platform: 'instagram', platformUserId: igAccount.id },
            {
              owner: userId,
              label: `@${igInfoRes.data.username}`,
              platform: 'instagram',
              platformUserId: igAccount.id,
              platformUsername: igInfoRes.data.username,
              accessToken: page.access_token,
              pageId: page.id,
              isActive: true
            },
            { upsert: true, new: true }
          );
        }
      } catch (e) {
        console.log('No IG for page:', page.name);
      }
    }

    res.redirect(`${process.env.FRONTEND_URL}/users?connected=facebook`);
  } catch (err) {
    console.error('Meta OAuth error:', err.message);
    res.redirect(`${process.env.FRONTEND_URL}/users?error=oauth_failed`);
  }
});

module.exports = router;
