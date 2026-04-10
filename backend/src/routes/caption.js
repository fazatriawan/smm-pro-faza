const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { optimizeCaption, generateHashtags, adaptCaptionBatch } = require('../services/captionService');

// POST /api/caption/optimize — Optimasi caption untuk satu platform
router.post('/optimize', protect, (req, res) => {
  try {
    const { caption, platform } = req.body;
    if (!caption || !platform) {
      return res.status(400).json({ message: 'caption dan platform wajib diisi' });
    }
    const result = optimizeCaption(caption, platform);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/caption/optimize-batch — Optimasi caption untuk semua platform sekaligus
router.post('/optimize-batch', protect, (req, res) => {
  try {
    const { caption, platforms } = req.body;
    if (!caption) {
      return res.status(400).json({ message: 'caption wajib diisi' });
    }
    const result = adaptCaptionBatch(caption, platforms);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/caption/hashtags — Generate hashtag untuk satu platform
router.post('/hashtags', protect, (req, res) => {
  try {
    const { content, platform, count } = req.body;
    if (!platform) {
      return res.status(400).json({ message: 'platform wajib diisi' });
    }
    const hashtags = generateHashtags(content || '', platform, count);
    res.json({ platform, hashtags, count: hashtags.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
