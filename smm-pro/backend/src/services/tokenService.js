const axios = require('axios');
const { SocialAccount } = require('../models');

// ─── META (Facebook & Instagram) ──────────────────────────────────────────
async function refreshMetaToken(account) {
  try {
    console.log(`[TokenService] Refreshing Meta token for: ${account.label}`);

    const res = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        fb_exchange_token: account.accessToken
      }
    });

    const newToken = res.data.access_token;
    const expiresIn = res.data.expires_in || 5184000; // 60 hari default
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    await SocialAccount.findByIdAndUpdate(account._id, {
      accessToken: newToken,
      tokenExpiresAt,
      isActive: true
    });

    console.log(`[TokenService] ✅ Meta token refreshed for: ${account.label}, expires: ${tokenExpiresAt}`);
    return { success: true, tokenExpiresAt };

  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`[TokenService] ❌ Meta token refresh failed for ${account.label}: ${msg}`);

    // Nonaktifkan akun jika refresh gagal
    await SocialAccount.findByIdAndUpdate(account._id, {
      isActive: false,
      tokenError: `Token refresh gagal: ${msg}. Silakan hubungkan ulang akun.`
    });

    return { success: false, error: msg };
  }
}

// ─── GOOGLE (YouTube) ──────────────────────────────────────────────────────
async function refreshGoogleToken(account) {
  try {
    console.log(`[TokenService] Refreshing Google token for: ${account.label}`);

    if (!account.refreshToken) {
      throw new Error('Refresh token tidak tersedia — user perlu login ulang');
    }

    const res = await axios.post('https://oauth2.googleapis.com/token', {
      grant_type: 'refresh_token',
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: account.refreshToken
    });

    const newToken = res.data.access_token;
    const expiresIn = res.data.expires_in || 3600; // 1 jam default
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    await SocialAccount.findByIdAndUpdate(account._id, {
      accessToken: newToken,
      tokenExpiresAt,
      isActive: true
    });

    console.log(`[TokenService] ✅ Google token refreshed for: ${account.label}, expires: ${tokenExpiresAt}`);
    return { success: true, tokenExpiresAt };

  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    console.error(`[TokenService] ❌ Google token refresh failed for ${account.label}: ${msg}`);

    await SocialAccount.findByIdAndUpdate(account._id, {
      isActive: false,
      tokenError: `Token refresh gagal: ${msg}. Silakan hubungkan ulang akun YouTube.`
    });

    return { success: false, error: msg };
  }
}

// ─── TWITTER ───────────────────────────────────────────────────────────────
async function refreshTwitterToken(account) {
  try {
    console.log(`[TokenService] Refreshing Twitter token for: ${account.label}`);

    if (!account.refreshToken) {
      throw new Error('Refresh token tidak tersedia — user perlu login ulang');
    }

    const credentials = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString('base64');

    const res = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: process.env.TWITTER_CLIENT_ID
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const newToken = res.data.access_token;
    const newRefreshToken = res.data.refresh_token;
    const expiresIn = res.data.expires_in || 7200;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    await SocialAccount.findByIdAndUpdate(account._id, {
      accessToken: newToken,
      refreshToken: newRefreshToken,
      tokenExpiresAt,
      isActive: true
    });

    console.log(`[TokenService] ✅ Twitter token refreshed for: ${account.label}`);
    return { success: true, tokenExpiresAt };

  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    console.error(`[TokenService] ❌ Twitter token refresh failed for ${account.label}: ${msg}`);

    await SocialAccount.findByIdAndUpdate(account._id, {
      isActive: false,
      tokenError: `Token refresh gagal: ${msg}. Silakan hubungkan ulang akun Twitter.`
    });

    return { success: false, error: msg };
  }
}

// ─── AUTO REFRESH ───────────────────────────────────────────────────────────
async function refreshTokenIfNeeded(account) {
  if (!account.tokenExpiresAt) return { success: true, skipped: true };

  const now = new Date();
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  if (account.tokenExpiresAt > sevenDaysFromNow) {
    return { success: true, skipped: true };
  }

  console.log(`[TokenService] Token for ${account.label} expires soon, refreshing...`);

  switch (account.platform) {
    case 'facebook':
    case 'facebook_personal':
    case 'instagram':
      return await refreshMetaToken(account);
    case 'youtube':
      return await refreshGoogleToken(account);
    case 'twitter':
      return await refreshTwitterToken(account);
    default:
      return { success: true, skipped: true };
  }
}

module.exports = { refreshMetaToken, refreshGoogleToken, refreshTwitterToken, refreshTokenIfNeeded };
