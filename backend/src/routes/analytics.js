const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { Analytics, SocialAccount, Post } = require('../models');
const {
  getPostEngagementRate,
  generatePerformanceReport,
  getTopPerformingContent,
  suggestContentStrategy,
} = require('../services/analyticsEnhancementService');

// GET summary analytics for all user accounts
router.get('/summary', protect, async (req, res) => {
  try {
    const accounts = await SocialAccount.find({ owner: req.user._id, isActive: true });
    const accountIds = accounts.map(a => a._id);
    const since = new Date(); since.setDate(since.getDate() - 30);

    const latest = await Analytics.aggregate([
      { $match: { account: { $in: accountIds } } },
      { $sort: { date: -1 } },
      { $group: { _id: '$account', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } }
    ]);

    const totalFollowers = latest.reduce((s, a) => s + (a.followers || a.subscribers || 0), 0);
    const totalReach = latest.reduce((s, a) => s + (a.reach || 0), 0);
    const totalEngagements = latest.reduce((s, a) => s + (a.engagements || 0), 0);
    const postCount = await Post.countDocuments({ createdBy: req.user._id, createdAt: { $gte: since } });

    const perPlatform = {};
    for (const acc of accounts) {
      const snap = latest.find(l => l.account.toString() === acc._id.toString());
      if (!perPlatform[acc.platform]) perPlatform[acc.platform] = [];
      perPlatform[acc.platform].push({ account: acc.label, ...snap });
    }

    res.json({ totalFollowers, totalReach, totalEngagements, postCount, perPlatform, accounts: latest });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET time-series for one account
router.get('/account/:id', protect, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since = new Date(); since.setDate(since.getDate() - Number(days));
    const data = await Analytics.find({ account: req.params.id, date: { $gte: since } }).sort('date');
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST save analytics snapshot (called by cron or webhook)
router.post('/snapshot', protect, async (req, res) => {
  try {
    const snap = await Analytics.create({ ...req.body, date: new Date() });
    res.status(201).json(snap);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/analytics/engagement-rate/:postId — Hitung engagement rate untuk satu post
router.get('/engagement-rate/:postId', protect, async (req, res) => {
  try {
    const result = await getPostEngagementRate(req.params.postId);
    res.json(result);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/analytics/performance-report?accountId=xxx&startDate=...&endDate=...
router.get('/performance-report', protect, async (req, res) => {
  try {
    const { accountId, startDate, endDate } = req.query;
    if (!accountId) return res.status(400).json({ message: 'accountId wajib diisi' });
    const report = await generatePerformanceReport(accountId, { startDate, endDate });
    res.json(report);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/analytics/top-content?accountId=xxx&limit=10
router.get('/top-content', protect, async (req, res) => {
  try {
    const { accountId, limit } = req.query;
    if (!accountId) return res.status(400).json({ message: 'accountId wajib diisi' });
    const topContent = await getTopPerformingContent(accountId, limit);
    res.json(topContent);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/analytics/content-suggestions?accountId=xxx
router.get('/content-suggestions', protect, async (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ message: 'accountId wajib diisi' });

    const account = await SocialAccount.findById(accountId);
    if (!account) return res.status(404).json({ message: 'Akun tidak ditemukan' });

    // Ambil data analytics 30 hari terakhir
    const since = new Date(); since.setDate(since.getDate() - 30);
    const snapshots = await Analytics.find({ account: accountId, date: { $gte: since } }).sort('date');

    if (!snapshots.length) {
      const suggestions = suggestContentStrategy({ platform: account.platform });
      return res.json(suggestions);
    }

    const totalViews = snapshots.reduce((s, a) => s + (a.views || a.videoViews || 0), 0);
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const followerGrowth = (last.followers || last.subscribers || 0) - (first.followers || first.subscribers || 0);
    const avgEngagementRate = snapshots.length > 0
      ? Math.round(snapshots.reduce((s, a) => {
          const v = a.views || a.videoViews || 1;
          const eng = (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
          return s + (eng / v * 100);
        }, 0) / snapshots.length * 100) / 100
      : 0;

    const suggestions = suggestContentStrategy({
      avgEngagementRate,
      followerGrowth,
      totalViews,
      platform: account.platform,
    });
    res.json(suggestions);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
