const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { Post } = require('../models');

// GET upcoming scheduled posts
router.get('/', protect, async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {
      createdBy: req.user._id,
      status: { $in: ['scheduled', 'sending'] }
    };
    if (from) filter.scheduledAt = { $gte: new Date(from) };
    if (to) filter.scheduledAt = { ...filter.scheduledAt, $lte: new Date(to) };
    const posts = await Post.find(filter)
      .populate('targetAccounts.account', 'label platform')
      .sort('scheduledAt');
    res.json(posts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH reschedule
router.patch('/:id', protect, async (req, res) => {
  try {
    const { scheduledAt } = req.body;
    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user._id, status: 'scheduled' },
      { scheduledAt: new Date(scheduledAt) },
      { new: true }
    );
    if (!post) return res.status(404).json({ message: 'Post not found or not reschedulable' });
    res.json(post);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
