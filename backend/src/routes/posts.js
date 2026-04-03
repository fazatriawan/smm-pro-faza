const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const { protect } = require('../middleware/auth');
const { Post, SocialAccount } = require('../models');
const { publishPost } = require('../services/publishService');
const { uploadToCloudinary } = require('../services/uploadService');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

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

router.post('/', protect, upload.array('media', 10), async (req, res) => {
  try {
    const { caption, accountIds, scheduledAt, isImmediate, platformOverrides, hashtags, link } = req.body;
    const parsedIds = JSON.parse(accountIds || '[]');
    const parsedOverrides = platformOverrides ? JSON.parse(platformOverrides) : {};

    const accounts = await SocialAccount.find({ _id: { $in: parsedIds }, isActive: true });
    if (!accounts.length) return res.status(400).json({ message: 'Tidak ada akun valid yang dipilih' });

    // Upload ke Cloudinary kalau ada file
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const cloudUrl = await uploadToCloudinary(file.path);
          mediaUrls.push(cloudUrl);
          // Hapus file lokal setelah upload ke Cloudinary
          fs.unlink(file.path, () => {});
        } catch (uploadErr) {
          console.error('Upload error:', uploadErr.message);
        }
      }
    }

    const targetAccounts = accounts.map(a => ({ account: a._id, status: 'pending' }));

    const postData = {
      createdBy: req.user._id,
      caption: caption || '',
      mediaUrls,
      targetAccounts,
      isImmediate: isImmediate === 'true',
      status: isImmediate === 'true' ? 'sending' : 'scheduled',
      platformOverrides: parsedOverrides,
      hashtags: JSON.parse(hashtags || '[]'),
    };

    if (scheduledAt && scheduledAt !== 'undefined') {
      postData.scheduledAt = new Date(scheduledAt);
    }
    if (link && link !== 'undefined') {
      postData.link = link;
    }

    const post = await Post.create(postData);

    if (isImmediate === 'true') {
      publishPost(post._id).catch(console.error);
    }

    res.status(201).json(post);
  } catch (err) {
    console.error('Post creation error:', err);
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('targetAccounts.account', 'label platform platformUsername');
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json(post);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json({ message: 'Post deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
