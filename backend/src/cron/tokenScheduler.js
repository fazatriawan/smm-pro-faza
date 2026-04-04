const cron = require('node-cron');
const { SocialAccount } = require('../models');
const { refreshMetaToken, refreshGoogleToken, refreshTwitterToken } = require('../services/tokenService');

function startTokenScheduler() {
  console.log('🔑 Token Scheduler started');

  // Jalankan setiap hari jam 2 pagi
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('[TokenScheduler] Running daily token refresh check...');

      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Cari semua akun aktif yang tokennya mau expired dalam 7 hari
      const accounts = await SocialAccount.find({
        isActive: true,
        tokenExpiresAt: { $lt: sevenDaysFromNow }
      });

      console.log(`[TokenScheduler] Found ${accounts.length} account(s) needing token refresh`);

      for (const account of accounts) {
        try {
          let result;

          switch (account.platform) {
            case 'facebook':
            case 'facebook_personal':
            case 'instagram':
              result = await refreshMetaToken(account);
              break;
            case 'youtube':
              result = await refreshGoogleToken(account);
              break;
            case 'twitter':
              result = await refreshTwitterToken(account);
              break;
            default:
              console.log(`[TokenScheduler] Skipping ${account.platform} - no refresh logic`);
              continue;
          }

          if (result.success) {
            console.log(`[TokenScheduler] ✅ ${account.label} token refreshed`);
          } else {
            console.log(`[TokenScheduler] ❌ ${account.label} token refresh failed: ${result.error}`);
          }

          // Jeda 2 detik antar akun agar tidak rate limit
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (err) {
          console.error(`[TokenScheduler] Error refreshing ${account.label}:`, err.message);
        }
      }

      console.log('[TokenScheduler] Daily token refresh completed');
    } catch (err) {
      console.error('[TokenScheduler] Cron error:', err.message);
    }
  });
}

module.exports = { startTokenScheduler };
