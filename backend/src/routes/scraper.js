const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { SocialAccount } = require('../models');
const {
  instagramPostScraper,
  resultsToCsv: instagramResultsToCsv,
} = require('../services/instagramPostScraperService');
const {
  threadsPostScraper,
  resultsToCsv: threadsResultsToCsv,
} = require('../services/threadsPostScraperService');

const MAX_USERNAMES = 200;

function parseUsernames(raw) {
  return Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
}

async function validateAccount(req, accountId, platform) {
  if (!accountId) return null;
  const account = await SocialAccount.findOne({
    _id: accountId,
    isActive: true,
    platform,
  });
  if (!account) return { error: 404, message: `Akun ${platform} tidak ditemukan` };
  if (req.user.role !== 'admin' && String(account.owner) !== String(req.user._id)) {
    return { error: 403, message: 'Forbidden' };
  }
  return account;
}

// POST /api/scraper/instagram — ambil link profil / postingan terbaru
router.post('/instagram', protect, async (req, res) => {
  try {
    const usernames = parseUsernames(req.body.usernames);
    if (!usernames.length) {
      return res.status(400).json({ message: 'Masukkan minimal 1 username' });
    }
    if (usernames.length > MAX_USERNAMES) {
      return res.status(400).json({ message: `Maksimal ${MAX_USERNAMES} username per request` });
    }

    const accountId = req.body.accountId || null;
    const check = await validateAccount(req, accountId, 'instagram');
    if (check?.error) return res.status(check.error).json({ message: check.message });

    const logs = [];
    const onLog = (log) => logs.push({ ...log, at: new Date().toISOString() });

    const result = await instagramPostScraper(
      { usernames, accountId, scrapePosts: Boolean(accountId) },
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
    const usernames = parseUsernames(req.body.usernames);
    if (!usernames.length) {
      return res.status(400).json({ message: 'Masukkan minimal 1 username' });
    }
    if (usernames.length > MAX_USERNAMES) {
      return res.status(400).json({ message: `Maksimal ${MAX_USERNAMES} username per request` });
    }

    const accountId = req.body.accountId || null;
    const check = await validateAccount(req, accountId, 'threads');
    if (check?.error) return res.status(check.error).json({ message: check.message });

    const logs = [];
    const onLog = (log) => logs.push({ ...log, at: new Date().toISOString() });

    const result = await threadsPostScraper(
      { usernames, accountId, scrapePosts: Boolean(accountId) },
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
