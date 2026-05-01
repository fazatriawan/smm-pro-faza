/**
 * Token Refresh Service
 * 
 * Auto-refreshes access tokens for all supported platforms before actions.
 * Called before amplify, posting, or any API operation.
 */

const axios = require('axios');

/**
 * Refresh token for a social account if needed
 * @param {Object} account - SocialAccount document from MongoDB
 * @returns {Promise<String|null>} - New access token or null if no refresh needed
 */
async function refreshTokenIfNeeded(account) {
  // Skip if no refresh token available
  if (!account.refreshToken) {
    console.log(`[TokenRefresh] No refresh token for ${account.platform} / ${account.label}`);
    return null;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = new Date();
  const expiresAt = account.tokenExpiresAt;
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt && new Date(expiresAt).getTime() - now.getTime() > fiveMinutes) {
    console.log(`[TokenRefresh] Token still valid for ${account.platform} / ${account.label}`);
    return null; // Token still valid
  }

  console.log(`[TokenRefresh] Token expired or expiring soon for ${account.platform} / ${account.label}. Refreshing...`);

  try {
    const newToken = await refreshByPlatform(account);
    if (newToken) {
      account.accessToken = newToken.accessToken;
      if (newToken.refreshToken) account.refreshToken = newToken.refreshToken;
      if (newToken.expiresAt) account.tokenExpiresAt = newToken.expiresAt;
      await account.save();
      console.log(`[TokenRefresh] Success for ${account.platform} / ${account.label}`);
      return newToken.accessToken;
    }
  } catch (err) {
    console.error(`[TokenRefresh] Failed for ${account.platform} / ${account.label}:`, err.message);
  }

  return null;
}

/**
 * Refresh token by platform type
 */
async function refreshByPlatform(account) {
  switch (account.platform) {
    case 'youtube':
      return await refreshYouTube(account);
    case 'facebook':
    case 'facebook_personal':
      return await refreshFacebook(account);
    case 'instagram':
      return await refreshInstagram(account);
    case 'twitter':
      return await refreshTwitter(account);
    case 'tiktok':
      return await refreshTikTok(account);
    case 'threads':
      return await refreshThreads(account);
    default:
      console.log(`[TokenRefresh] Platform ${account.platform} not supported for auto-refresh`);
      return null;
  }
}

// ─── YOUTUBE ────────────────────────────────────────────────────────────────
async function refreshYouTube(account) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET not set');
  }

  const res = await axios.post('https://oauth2.googleapis.com/token', null, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token'
    }
  });

  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000);
  return {
    accessToken: res.data.access_token,
    refreshToken: account.refreshToken, // Google refresh token usually doesn't change
    expiresAt
  };
}

// ─── FACEBOOK ───────────────────────────────────────────────────────────────
async function refreshFacebook(account) {
  // Facebook long-lived token: exchange for new one
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('FACEBOOK_APP_ID or FACEBOOK_APP_SECRET not set');
  }

  // Get app access token
  const appTokenRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
    params: {
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'client_credentials'
    }
  });

  // Debug/inspect current token to get expiry info
  const debugRes = await axios.get('https://graph.facebook.com/debug_token', {
    params: {
      input_token: account.accessToken,
      access_token: appTokenRes.data.access_token
    }
  });

  const tokenData = debugRes.data.data;
  const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null;

  // If token is long-lived (60 days) and not near expiry, don't refresh
  if (expiresAt && expiresAt.getTime() - Date.now() > 24 * 60 * 60 * 1000) {
    return { accessToken: account.accessToken, expiresAt };
  }

  // Exchange for new long-lived token
  const exchangeRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: account.accessToken
    }
  });

  const newExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // ~60 days
  return {
    accessToken: exchangeRes.data.access_token,
    expiresAt: newExpiresAt
  };
}

// ─── INSTAGRAM ──────────────────────────────────────────────────────────────
async function refreshInstagram(account) {
  // Instagram uses Facebook's token system
  return await refreshFacebook(account);
}

// ─── TWITTER ────────────────────────────────────────────────────────────────
async function refreshTwitter(account) {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('TWITTER_CLIENT_ID or TWITTER_CLIENT_SECRET not set');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await axios.post('https://api.twitter.com/2/oauth2/token', {
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token'
  }, {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000);
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || account.refreshToken,
    expiresAt
  };
}

// ─── TIKTOK ─────────────────────────────────────────────────────────────────
async function refreshTikTok(account) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET not set');
  }

  const res = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken
  });

  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000);
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || account.refreshToken,
    expiresAt
  };
}

// ─── THREADS ────────────────────────────────────────────────────────────────
async function refreshThreads(account) {
  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('THREADS_APP_ID or THREADS_APP_SECRET not set');
  }

  const res = await axios.get('https://graph.threads.net/refresh_access_token', {
    params: {
      grant_type: 'th_refresh_token',
      access_token: account.refreshToken
    }
  });

  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000);
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || account.refreshToken,
    expiresAt
  };
}

module.exports = { refreshTokenIfNeeded };
