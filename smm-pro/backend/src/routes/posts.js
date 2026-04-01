const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { protect } = require('../middleware/auth');
const { Post, SocialAccount } = require('../models');
const { publishPost } = require('../services/publishService');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_PATH || './uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024 } });

// GET posts (paginated)
router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = { createdBy: req.user._id };
    if (status) filter.status = status;
    const posts = await Post.find(filter)
      .populate('targetAccounts.account', 'label platform platformUsername')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Post.countDocuments(filter);
    res.json({ posts, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST create post (bulk)
router.post('/', protect, upload.array('media', 10), async (req, res) => {
  try {
    const { caption, accountIds, scheduledAt, isImmediate, platformOverrides, hashtags, link } = req.body;
    const parsedIds = JSON.parse(accountIds || '[]');
    const parsedOverrides = platformOverrides ? JSON.parse(platformOverrides) : {};

    // Validate accounts belong to user
    const accounts = await SocialAccount.find({ _id: { $in: parsedIds }, isActive: true });
    if (!accounts.length) return res.status(400).json({ message: 'No valid accounts selected' });

    const mediaUrls = (req.files || []).map(f => `/uploads/${f.filename}`);
    const targetAccounts = accounts.map(a => ({ account: a._id, status: 'pending' }));

    const post = await Post.create({
      createdBy: req.user._id,
      caption,
      mediaUrls,
      targetAccounts,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      isImmediate: isImmediate === 'true',
      status: isImmediate === 'true' ? 'sending' : 'scheduled',
      platformOverrides: parsedOverrides,
      hashtags: JSON.parse(hashtags || '[]'),
      link
    });

    // If immediate, publish now
    if (isImmediate === 'true') {
      publishPost(post._id).catch(console.error);
    }

    res.status(201).json(post);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET single post detail
router.get('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('targetAccounts.account', 'label platform platformUsername');
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json(post);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE post
router.delete('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json({ message: 'Post deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
