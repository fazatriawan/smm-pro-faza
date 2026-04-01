const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { Analytics, SocialAccount, Post } = require('../models');

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

module.exports = router;
