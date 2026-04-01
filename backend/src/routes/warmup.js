// warmup.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { WarmupLog, SocialAccount } = require('../models');

router.get('/stats', protect, async (req, res) => {
  try {
    const accounts = await SocialAccount.find({ owner: req.user._id }).select('_id');
    const ids = accounts.map(a => a._id);
    const since = new Date(); since.setHours(0,0,0,0);
    const logs = await WarmupLog.find({ account: { $in: ids }, date: { $gte: since } });
    const stats = { like:0, comment:0, follow:0, search:0, save:0, view:0 };
    logs.forEach(l => { if (stats[l.action] !== undefined) stats[l.action]++; });
    res.json(stats);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/logs', protect, async (req, res) => {
  try {
    const accounts = await SocialAccount.find({ owner: req.user._id }).select('_id');
    const ids = accounts.map(a => a._id);
    const logs = await WarmupLog.find({ account: { $in: ids } })
      .populate('account','label platform').sort('-date').limit(100);
    res.json(logs);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
