const axios = require('axios');
const { SocialAccount } = require('../models');

/**
 * Verify account connection status by checking tokens
 * @param {Object} account - SocialAccount document
 * @returns {Promise<{status: string, message: string}>}
 */
async function verifyAccountStatus(account) {
  try {
    // Automation accounts: check last login time
    if (account.loginType === 'automation') {
      const lastLogin = account.automationData?.lastLoginAt;
      if (!lastLogin) {
        return { status: 'unknown', message: 'Belum pernah login' };
      }
      const daysSinceLogin = (Date.now() - new Date(lastLogin).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLogin > 7) {
        return { status: 'unknown', message: `Login terakhir ${Math.floor(daysSinceLogin)} hari lalu` };
      }
      return { status: 'connected', message: 'Akun aktif (automation)' };
    }

    // OAuth accounts: check token validity
    if (!account.accessToken) {
      return { status: 'disconnected', message: 'Tidak ada token' };
    }

    // Check if token is expired
    if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) {
      // Try to refresh if refresh token exists
      if (account.refreshToken) {
        const refreshed = await tryRefreshToken(account);
        if (refreshed) {
          return { status: 'connected', message: 'Token berhasil di-refresh' };
        }
        return { status: 'expired', message: 'Token expired dan refresh gagal' };
      }
      return { status: 'expired', message: 'Token expired tanpa refresh token' };
    }

    // Token still valid, verify with platform API
    const platformStatus = await verifyWithPlatform(account);
    return platformStatus;

  } catch (err) {
    return { status: 'unknown', message: err.message || 'Gagal memverifikasi' };
  }
}

/**
 * Try to refresh token (basic implementation)
 */
async function tryRefreshToken(account) {
  try {
    // This is a simplified check - actual refresh logic depends on platform
    // For now, we just check if refreshToken exists
    return !!account.refreshToken;
  } catch (err) {
    return false;
  }
}

/**
 * Verify token with platform-specific API
 */
async function verifyWithPlatform(account) {
  const { platform, accessToken } = account;

  switch (platform) {
    case 'youtube':
      return verifyYouTube(accessToken);
    case 'facebook':
    case 'facebook_personal':
      return verifyFacebook(accessToken);
    case 'instagram':
      return verifyInstagram(accessToken);
    case 'twitter':
      return verifyTwitter(accessToken);
    case 'tiktok':
      return verifyTikTok(accessToken);
    case 'threads':
      return verifyThreads(accessToken);
    default:
      return { status: 'unknown', message: `Platform ${platform} belum didukung` };
  }
}

async function verifyYouTube(accessToken) {
  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000
    });
    if (res.data.items?.length > 0) {
      return { status: 'connected', message: `Channel: ${res.data.items[0].snippet.title}` };
    }
    return { status: 'disconnected', message: 'Channel tidak ditemukan' };
  } catch (err) {
    if (err.response?.status === 401) {
      return { status: 'expired', message: 'Token tidak valid (401)' };
    }
    return { status: 'unknown', message: `Error: ${err.response?.status || err.message}` };
  }
}

async function verifyFacebook(accessToken) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v18.0/me?access_token=${accessToken}&fields=id,name`, {
      timeout: 10000
    });
    return { status: 'connected', message: `Account: ${res.data.name}` };
  } catch (err) {
    if (err.response?.data?.error?.code === 190) {
      return { status: 'expired', message: 'Token expired (190)' };
    }
    if (err.response?.status === 401) {
      return { status: 'expired', message: 'Token tidak valid (401)' };
    }
    return { status: 'unknown', message: `Error: ${err.response?.status || err.message}` };
  }
}

async function verifyInstagram(accessToken) {
  try {
    const res = await axios.get(`https://graph.instagram.com/me?access_token=${accessToken}&fields=id,username`, {
      timeout: 10000
    });
    return { status: 'connected', message: `Account: ${res.data.username}` };
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      return { status: 'expired', message: 'Token tidak valid' };
    }
    return { status: 'unknown', message: `Error: ${err.response?.status || err.message}` };
  }
}

async function verifyTwitter(accessToken) {
  try {
    const res = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000
    });
    return { status: 'connected', message: `Account: ${res.data.data?.username}` };
  } catch (err) {
    if (err.response?.status === 401) {
      return { status: 'expired', message: 'Token tidak valid (401)' };
    }
    return { status: 'unknown', message: `Error: ${err.response?.status || err.message}` };
  }
}

async function verifyTikTok(accessToken) {
  // TikTok API requires specific implementation
  // For now, check token existence and expiry
  return { status: 'unknown', message: 'TikTok verification belum diimplementasikan' };
}

async function verifyThreads(accessToken) {
  try {
    const res = await axios.get('https://graph.threads.net/me?fields=id,username', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000
    });
    return { status: 'connected', message: `Account: ${res.data.username}` };
  } catch (err) {
    if (err.response?.status === 401) {
      return { status: 'expired', message: 'Token tidak valid (401)' };
    }
    return { status: 'unknown', message: `Error: ${err.response?.status || err.message}` };
  }
}

/**
 * Verify all accounts and update their status in DB
 */
async function verifyAllAccounts(userId, isAdmin = false) {
  const filter = isAdmin ? { isActive: true } : { isActive: true, owner: userId };
  const accounts = await SocialAccount.find(filter);

  const results = [];
  for (const account of accounts) {
    const status = await verifyAccountStatus(account);

    // Update DB
    await SocialAccount.findByIdAndUpdate(account._id, {
      connectionStatus: status.status,
      lastVerifiedAt: new Date(),
      statusMessage: status.message
    });

    results.push({
      _id: account._id,
      platform: account.platform,
      label: account.label,
      loginType: account.loginType,
      ...status
    });
  }

  return results;
}

module.exports = {
  verifyAccountStatus,
  verifyAllAccounts
};
