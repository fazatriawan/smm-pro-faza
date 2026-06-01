const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { SocialAccount } = require('../models');
const { refreshTokenIfNeeded } = require('../services/tokenRefreshService');
const {
  instagramPostScraper,
  resultsToCsv: instagramResultsToCsv,
} = require('../services/instagramPostScraperService');
const {
  threadsPostScraper,
  resultsToCsv: threadsResultsToCsv,
} = require('../services/threadsPostScraperService');

const { normalizeScraperUsernames } = require('../utils/scraperUsername');

const MAX_USERNAMES = 200;

function parseLines(raw) {
  return Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
}

// POST /api/scraper/instagram — ambil link profil / postingan terbaru
router.post('/instagram', protect, async (req, res) => {
  try {
    const lines = parseLines(req.body.usernames);
    const usernames = normalizeScraperUsernames(lines, 'instagram');
    if (!usernames.length) {
      return res.status(400).json({
        message: 'Masukkan minimal 1 username atau URL profil Instagram yang valid',
      });
    }
    if (usernames.length > MAX_USERNAMES) {
      return res.status(400).json({ message: `Maksimal ${MAX_USERNAMES} username per request` });
    }

    let igAccount = null;
    const accountId = req.body.accountId || null;
    if (accountId && req.body.profileOnly !== true) {
      const account = await SocialAccount.findOne({
        _id: accountId,
        isActive: true,
        platform: 'instagram',
      });
      if (!account) {
        return res.status(404).json({ message: 'Akun Instagram tidak ditemukan' });
      }
      if (req.user.role !== 'admin' && String(account.owner) !== String(req.user._id)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      await refreshTokenIfNeeded(account).catch(() => {});
      igAccount = {
        platformUserId: account.platformUserId,
        platformUsername: account.platformUsername,
        label: account.label,
        accessToken: account.accessToken,
      };
    }

    const logs = [];
    const onLog = (log) => logs.push({ ...log, at: new Date().toISOString() });

    const result = await instagramPostScraper(
      { usernames, profileOnly: req.body.profileOnly === true, igAccount },
      onLog
    );

    res.json({ ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/scraper/threads — ambil link profil / postingan terbaru Threads
router.post('/threads', protect, async (req, res) => {
  try {
    const lines = parseLines(req.body.usernames);
    const usernames = normalizeScraperUsernames(lines, 'threads');
    if (!usernames.length) {
      return res.status(400).json({
        message: 'Masukkan minimal 1 username atau URL profil Threads yang valid',
      });
    }
    if (usernames.length > MAX_USERNAMES) {
      return res.status(400).json({ message: `Maksimal ${MAX_USERNAMES} username per request` });
    }

    const logs = [];
    const onLog = (log) => logs.push({ ...log, at: new Date().toISOString() });

    const result = await threadsPostScraper(
      { usernames, profileOnly: req.body.profileOnly === true },
      onLog
    );

    res.json({ ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/scraper/instagram/export — unduh CSV
router.post('/instagram/export', protect, (req, res) => {
  try {
    const { results } = req.body;
    if (!Array.isArray(results) || !results.length) {
      return res.status(400).json({ message: 'Tidak ada hasil untuk diekspor' });
    }
    const csv = instagramResultsToCsv(results);
    const filename = `hasil_instagram_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/scraper/threads/export — unduh CSV
router.post('/threads/export', protect, (req, res) => {
  try {
    const { results } = req.body;
    if (!Array.isArray(results) || !results.length) {
      return res.status(400).json({ message: 'Tidak ada hasil untuk diekspor' });
    }
    const csv = threadsResultsToCsv(results);
    const filename = `hasil_threads_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
