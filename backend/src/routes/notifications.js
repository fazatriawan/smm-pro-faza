const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { Notification, SocialAccount } = require('../models');

// GET notifications (all accounts of user)
router.get('/', protect, async (req, res) => {
  try {
    const { platform, isRead, page = 1, limit = 50 } = req.query;
    const userAccounts = await SocialAccount.find({ owner: req.user._id }).select('_id');
    const accountIds = userAccounts.map(a => a._id);
    const filter = { account: { $in: accountIds } };
    if (platform) filter.platform = platform;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    const notifs = await Notification.find(filter)
      .populate('account', 'label platform platformUsername')
      .sort('-receivedAt')
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const unreadCount = await Notification.countDocuments({ account: { $in: accountIds }, isRead: false });
    res.json({ notifications: notifs, unreadCount });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH mark as read
router.patch('/:id/read', protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH mark all read
router.patch('/mark-all-read', protect, async (req, res) => {
  try {
    const userAccounts = await SocialAccount.find({ owner: req.user._id }).select('_id');
    const accountIds = userAccounts.map(a => a._id);
    await Notification.updateMany({ account: { $in: accountIds } }, { isRead: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
